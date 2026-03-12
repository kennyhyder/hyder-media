#!/usr/bin/env python3
"""
Enrich grid_dc_sites with nearest fiber optic route distance.

Source: OpenStreetMap via Overpass API
  https://overpass-api.de/api/interpreter

Fields populated:
- nearest_fiber_route_km  (numeric 8,2) — distance to nearest fiber optic cable route

Usage:
  python3 -u scripts/enrich-osm-fiber.py
  python3 -u scripts/enrich-osm-fiber.py --dry-run
  python3 -u scripts/enrich-osm-fiber.py --skip-download
  python3 -u scripts/enrich-osm-fiber.py --skip-download --dry-run
"""

import os
import sys
import json
import math
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

# macOS system Python SSL fix
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    SSL_CTX.load_verify_locations(certifi.where())
except ImportError:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

# Load env from grid's own .env.local first, fallback to solar
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
EARTH_RADIUS_KM = 6371.0
MAX_SEARCH_KM = 200.0
GRID_CELL_DEG = 1.0  # ~111 km at equator

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = """[out:json][timeout:300];
(
  way["man_made"="pipeline"]["substance"="fibre_optic"](24.0,-125.0,50.0,-66.0);
  way["utility"="fibre_optic_cable"](24.0,-125.0,50.0,-66.0);
  way["telecom"="cable"](24.0,-125.0,50.0,-66.0);
  way["communication"="line"](24.0,-125.0,50.0,-66.0);
  way["man_made"="submarine_cable"](24.0,-125.0,50.0,-66.0);
);
out geom;
"""
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm_fiber_routes.json')


def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:200]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def load_paginated(table, select='*', filters='', page_size=1000):
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path, headers_extra={
            'Prefer': 'count=exact',
            'Range-Unit': 'items',
        })
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


# -- Haversine math --------------------------------------------------------

def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_to_segment_distance(plat, plng, slat1, slng1, slat2, slng2):
    """
    Approximate closest distance from point (plat, plng) to line segment
    (slat1,slng1)-(slat2,slng2) in km.

    Projects the point onto the segment in a local Cartesian approximation,
    then uses Haversine for the final distance.
    """
    # Convert to local Cartesian (km) centered at segment midpoint
    mid_lat = (slat1 + slat2) / 2.0
    cos_lat = math.cos(math.radians(mid_lat))
    km_per_deg_lat = 111.32
    km_per_deg_lng = 111.32 * cos_lat

    # Segment vector in km
    bx = (slng2 - slng1) * km_per_deg_lng
    by = (slat2 - slat1) * km_per_deg_lat

    # Point vector relative to segment start
    px = (plng - slng1) * km_per_deg_lng
    py = (plat - slat1) * km_per_deg_lat

    seg_len_sq = bx * bx + by * by
    if seg_len_sq < 1e-12:
        # Degenerate segment (single point)
        return haversine(plat, plng, slat1, slng1)

    # Project point onto segment, clamp t to [0, 1]
    t = max(0.0, min(1.0, (px * bx + py * by) / seg_len_sq))

    # Closest point on segment in geographic coords
    closest_lng = slng1 + t * (slng2 - slng1)
    closest_lat = slat1 + t * (slat2 - slat1)

    return haversine(plat, plng, closest_lat, closest_lng)


# -- Fiber route download --------------------------------------------------

def download_fiber_routes():
    """Download all fiber optic routes from OpenStreetMap Overpass API."""
    print("\n[Phase 1] Downloading fiber optic routes from Overpass API...")
    print(f"  Query:\n{OVERPASS_QUERY[:200].strip()}...")

    post_data = urllib.parse.urlencode({'data': OVERPASS_QUERY}).encode('utf-8')
    req = urllib.request.Request(
        OVERPASS_URL,
        data=post_data,
        headers={
            'User-Agent': 'GridScout/1.0',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        method='POST'
    )

    for attempt in range(3):
        try:
            print(f"  Sending request (attempt {attempt + 1}/3, timeout 600s)...")
            with urllib.request.urlopen(req, timeout=600, context=SSL_CTX) as resp:
                raw = resp.read()
                print(f"  Response received: {len(raw) / (1024 * 1024):.1f} MB")
                data = json.loads(raw.decode())
            break
        except Exception as e:
            if attempt < 2:
                wait = 30 * (attempt + 1)
                print(f"  Retry {attempt + 1}: {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                print(f"  FATAL download error: {e}")
                raise

    elements = data.get('elements', [])
    print(f"  Raw elements from Overpass: {len(elements)}")

    # Convert to standardized format: [{id, coords: [[lng, lat], ...]}, ...]
    routes = []
    for elem in elements:
        geom = elem.get('geometry', [])
        if len(geom) < 2:
            continue
        coords = [[pt['lon'], pt['lat']] for pt in geom]
        routes.append({
            'id': elem.get('id'),
            'coords': coords,
        })

    print(f"  Valid fiber route segments: {len(routes)}")

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(routes, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return routes


def load_cached_fiber_routes():
    """Load fiber route data from cache file."""
    print(f"\n[Phase 1] Loading cached fiber route data from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        routes = json.load(f)
    print(f"  Loaded {len(routes)} fiber route segments from cache")
    return routes


# -- Spatial grid index -----------------------------------------------------

def build_spatial_index(routes):
    """
    Build a grid index mapping 1-degree cells to route segment indices.
    Each segment is indexed in every cell its coordinates touch.
    """
    print("\n  Building spatial grid index...")
    grid = {}  # (cell_lat, cell_lng) -> set of route indices
    for idx, route in enumerate(routes):
        cells_seen = set()
        for coord in route['coords']:
            lng, lat = coord[0], coord[1]
            cell = (int(math.floor(lat)), int(math.floor(lng)))
            if cell not in cells_seen:
                cells_seen.add(cell)
                if cell not in grid:
                    grid[cell] = []
                grid[cell].append(idx)
    print(f"  Index covers {len(grid)} grid cells")
    return grid


def get_nearby_route_indices(grid, lat, lng):
    """Get route indices from cells within ~200 km of a point."""
    search_cells = int(math.ceil(MAX_SEARCH_KM / 111.0)) + 1
    center_cell_lat = int(math.floor(lat))
    center_cell_lng = int(math.floor(lng))

    indices = set()
    for dlat in range(-search_cells, search_cells + 1):
        for dlng in range(-search_cells, search_cells + 1):
            cell = (center_cell_lat + dlat, center_cell_lng + dlng)
            if cell in grid:
                for idx in grid[cell]:
                    indices.add(idx)
    return indices


# -- Main -------------------------------------------------------------------

def find_nearest_fiber_route(lat, lng, routes, grid_index):
    """Find minimum distance from point to any fiber route segment."""
    nearby_indices = get_nearby_route_indices(grid_index, lat, lng)
    if not nearby_indices:
        return None

    min_dist = float('inf')
    for idx in nearby_indices:
        coords = routes[idx]['coords']
        # Check each consecutive pair of coordinates as a segment
        for i in range(len(coords) - 1):
            lng1, lat1 = coords[i][0], coords[i][1]
            lng2, lat2 = coords[i + 1][0], coords[i + 1][1]
            d = point_to_segment_distance(lat, lng, lat1, lng1, lat2, lng2)
            if d < min_dist:
                min_dist = d
                if min_dist < 0.01:  # Close enough, no need to keep checking
                    return round(min_dist, 2)

    return round(min_dist, 2) if min_dist < float('inf') else None


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Fiber Optic Route Proximity")
    print("=" * 50)

    # Phase 1: Get fiber route data
    if skip_download and os.path.exists(CACHE_FILE):
        routes = load_cached_fiber_routes()
    else:
        routes = download_fiber_routes()

    if not routes:
        print("ERROR: No fiber route data available.")
        return

    # Build spatial index
    grid_index = build_spatial_index(routes)

    # Phase 2: Load DC sites
    print(f"\n[Phase 2] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,nearest_fiber_route_km',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('nearest_fiber_route_km') is None]
    print(f"  {len(sites_to_process)} sites need fiber route distance")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Calculate distances
    print(f"\n  Calculating nearest fiber route distance for {len(sites_to_process)} sites...")
    results = {}  # site_id -> distance_km
    no_route = 0
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        lat = site['latitude']
        lng = site['longitude']
        dist = find_nearest_fiber_route(lat, lng, routes, grid_index)
        if dist is not None:
            results[site['id']] = dist
        else:
            no_route += 1

        if (i + 1) % 1000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({len(results)} found, {no_route} no fiber route nearby, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Final: {len(results)} with fiber route distance, {no_route} no fiber route within {MAX_SEARCH_KM} km")

    if not results:
        print("  No results to patch.")
        return

    # Stats
    distances = sorted(results.values())
    n = len(distances)
    print(f"\n  Distance statistics:")
    print(f"    Min:    {distances[0]:.2f} km")
    print(f"    Max:    {distances[-1]:.2f} km")
    print(f"    Mean:   {sum(distances) / n:.2f} km")
    print(f"    Median: {distances[n // 2]:.2f} km")
    print(f"    p10:    {distances[int(n * 0.1)]:.2f} km")
    print(f"    p90:    {distances[int(n * 0.9)]:.2f} km")

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, dist in samples:
            print(f"  Would patch {site_id}: nearest_fiber_route_km={dist}")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")
    import subprocess

    # Generate SQL with temp table + UPDATE JOIN
    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_fiber_route_update.sql')
    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _fiber_dist (id UUID, dist NUMERIC(8,2));\n")
        f.write("COPY _fiber_dist (id, dist) FROM STDIN;\n")
        for site_id, dist in results.items():
            f.write(f"{site_id}\t{dist}\n")
        f.write("\\.\n")
        f.write("UPDATE grid_dc_sites SET nearest_fiber_route_km = _fiber_dist.dist "
                "FROM _fiber_dist WHERE grid_dc_sites.id = _fiber_dist.id;\n")
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE nearest_fiber_route_km IS NOT NULL;\n")

    db_password = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password

    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-f', sql_file],
        capture_output=True, text=True, env=env, timeout=120
    )

    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    else:
        print(f"  psql output: {result.stdout.strip()}")

    # Cleanup
    try:
        os.remove(sql_file)
    except OSError:
        pass

    print(f"\nDone! {len(results)} sites patched via psql.")


if __name__ == '__main__':
    main()

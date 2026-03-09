#!/usr/bin/env python3
"""
Enrich grid_dc_sites with nearest natural gas pipeline distance.

Source: EIA Natural Gas Pipelines via geo.dot.gov ArcGIS FeatureServer
  https://geo.dot.gov/server/rest/services/Hosted/Natural_Gas_Pipelines_US_EIA/FeatureServer/0

Fields populated:
- nearest_gas_pipeline_km  (numeric 8,2) — distance to nearest gas pipeline segment

Usage:
  python3 -u scripts/enrich-gas-pipelines.py
  python3 -u scripts/enrich-gas-pipelines.py --dry-run
  python3 -u scripts/enrich-gas-pipelines.py --skip-download
  python3 -u scripts/enrich-gas-pipelines.py --skip-download --dry-run
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

PIPELINE_URL = (
    "https://geo.dot.gov/server/rest/services/Hosted/"
    "Natural_Gas_Pipelines_US_EIA/FeatureServer/0/query"
)
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'gas_pipelines.json')


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


# ── Haversine math ──────────────────────────────────────────────

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
    ax = (slng1 - slng1) * km_per_deg_lng  # always 0 relative to slng1
    ay = 0.0
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


# ── Pipeline download ───────────────────────────────────────────

def download_pipelines():
    """Download all pipeline segments from EIA ArcGIS FeatureServer."""
    print("\n[Phase 1] Downloading pipeline data from EIA FeatureServer...")
    all_features = []
    offset = 0
    page_size = 2000

    while True:
        params = urllib.parse.urlencode({
            'where': '1=1',
            'outFields': 'objectid,operator,SHAPE__Length',
            'returnGeometry': 'true',
            'outSR': '4326',
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        })
        url = f"{PIPELINE_URL}?{params}"
        req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
                    data = json.loads(resp.read().decode())
                break
            except Exception as e:
                if attempt < 2:
                    print(f"  Retry {attempt + 1}: {e}")
                    time.sleep(5 * (attempt + 1))
                else:
                    print(f"  FATAL download error at offset {offset}: {e}")
                    raise

        features = data.get('features', [])
        if not features:
            break

        # Extract polyline coords from each feature
        for feat in features:
            geom = feat.get('geometry')
            if not geom:
                continue
            paths = geom.get('paths', [])
            if not paths:
                continue
            # Flatten all paths into a list of [lng, lat] coordinate pairs
            coords = []
            for path in paths:
                coords.extend(path)
            if len(coords) >= 2:
                all_features.append({
                    'id': feat.get('attributes', {}).get('objectid'),
                    'coords': coords,  # [[lng, lat], ...]
                })

        offset += page_size
        if len(features) < page_size:
            break

        if offset % 10000 == 0:
            print(f"  Downloaded {offset} features...")

    print(f"  Total pipeline segments: {len(all_features)}")

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(all_features, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return all_features


def load_cached_pipelines():
    """Load pipeline data from cache file."""
    print(f"\n[Phase 1] Loading cached pipeline data from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        pipelines = json.load(f)
    print(f"  Loaded {len(pipelines)} pipeline segments from cache")
    return pipelines


# ── Spatial grid index ──────────────────────────────────────────

def build_spatial_index(pipelines):
    """
    Build a grid index mapping 1-degree cells to pipeline segment indices.
    Each segment is indexed in every cell its coordinates touch.
    """
    print("\n  Building spatial grid index...")
    grid = {}  # (cell_lat, cell_lng) -> set of pipeline indices
    for idx, pipe in enumerate(pipelines):
        cells_seen = set()
        for coord in pipe['coords']:
            lng, lat = coord[0], coord[1]
            cell = (int(math.floor(lat)), int(math.floor(lng)))
            if cell not in cells_seen:
                cells_seen.add(cell)
                if cell not in grid:
                    grid[cell] = []
                grid[cell].append(idx)
    print(f"  Index covers {len(grid)} grid cells")
    return grid


def get_nearby_pipeline_indices(grid, lat, lng):
    """Get pipeline indices from cells within ~200 km of a point."""
    # At worst case (equator), 1 degree ~= 111 km, so 200 km ~= 2 degrees
    # At higher latitudes, lng degrees are smaller, so we need more cells
    search_cells = int(math.ceil(MAX_SEARCH_KM / 111.0)) + 1  # typically 2-3
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


# ── Main ────────────────────────────────────────────────────────

def find_nearest_pipeline(lat, lng, pipelines, grid_index):
    """Find minimum distance from point to any pipeline segment."""
    nearby_indices = get_nearby_pipeline_indices(grid_index, lat, lng)
    if not nearby_indices:
        return None

    min_dist = float('inf')
    for idx in nearby_indices:
        coords = pipelines[idx]['coords']
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

    print("GridScout: Enrich Gas Pipeline Proximity")
    print("=" * 50)

    # Phase 1: Get pipeline data
    if skip_download and os.path.exists(CACHE_FILE):
        pipelines = load_cached_pipelines()
    else:
        pipelines = download_pipelines()

    if not pipelines:
        print("ERROR: No pipeline data available.")
        return

    # Build spatial index
    grid_index = build_spatial_index(pipelines)

    # Phase 2: Load DC sites
    print(f"\n[Phase 2] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,nearest_gas_pipeline_km',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('nearest_gas_pipeline_km') is None]
    print(f"  {len(sites_to_process)} sites need gas pipeline distance")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Calculate distances
    print(f"\n  Calculating nearest pipeline distance for {len(sites_to_process)} sites...")
    results = {}  # site_id -> distance_km
    no_pipeline = 0
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        lat = site['latitude']
        lng = site['longitude']
        dist = find_nearest_pipeline(lat, lng, pipelines, grid_index)
        if dist is not None:
            results[site['id']] = dist
        else:
            no_pipeline += 1

        if (i + 1) % 1000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({len(results)} found, {no_pipeline} no pipeline nearby, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Final: {len(results)} with pipeline distance, {no_pipeline} no pipeline within {MAX_SEARCH_KM} km")

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
            print(f"  Would patch {site_id}: nearest_gas_pipeline_km={dist}")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")
    import subprocess
    import tempfile

    # Generate SQL with temp table + UPDATE JOIN
    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_gas_pipeline_update.sql')
    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _gas_dist (id UUID, dist NUMERIC(8,2));\n")
        f.write("COPY _gas_dist (id, dist) FROM STDIN;\n")
        for site_id, dist in results.items():
            f.write(f"{site_id}\t{dist}\n")
        f.write("\\.\n")
        f.write("UPDATE grid_dc_sites SET nearest_gas_pipeline_km = _gas_dist.dist "
                "FROM _gas_dist WHERE grid_dc_sites.id = _gas_dist.id;\n")
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE nearest_gas_pipeline_km IS NOT NULL;\n")

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

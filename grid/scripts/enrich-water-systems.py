#!/usr/bin/env python3
"""
Enrich grid_dc_sites with nearest public water system data from EPA SDWIS.

Source: EPA SDWIS FeatureServer (Safe Drinking Water Information System)
  https://geopub.epa.gov/arcgis/rest/services/SDWIS/SDWISFeatureService/FeatureServer/0

Fields populated:
- nearest_water_system_km    (numeric 8,2)  — distance to nearest community water system
- nearest_water_system_name  (text)         — name of nearest water system
- water_system_pop_served    (integer)      — population served by nearest water system

Usage:
  python3 -u scripts/enrich-water-systems.py
  python3 -u scripts/enrich-water-systems.py --dry-run
  python3 -u scripts/enrich-water-systems.py --skip-download
  python3 -u scripts/enrich-water-systems.py --skip-download --dry-run
"""

import os
import sys
import json
import math
import time
import ssl
import subprocess
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

WATER_SYSTEM_BASE = "https://data.epa.gov/efservice/WATER_SYSTEM"
ZCTA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'zcta_centroids.txt')
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'epa_water_systems.json')


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


# -- Water system download -------------------------------------------------

def load_zcta_centroids():
    """Load zip code centroids from Census ZCTA file."""
    centroids = {}
    if not os.path.exists(ZCTA_FILE):
        print(f"  WARNING: ZCTA file not found at {ZCTA_FILE}")
        return centroids
    with open(ZCTA_FILE, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('GEOID'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7:
                zc = parts[0].strip()
                try:
                    lat = float(parts[5].strip())
                    lng = float(parts[6].strip())
                    centroids[zc] = (lat, lng)
                except (ValueError, IndexError):
                    pass
    return centroids


def download_water_systems():
    """Download active community water systems from EPA Envirofacts + geocode via zip."""
    print("\n[Phase 1] Downloading water systems from EPA Envirofacts API...")

    # Load zip centroids for geocoding
    print("  Loading ZCTA centroids for zip geocoding...")
    zcta = load_zcta_centroids()
    print(f"  Loaded {len(zcta)} zip centroids")

    all_systems = []
    states = [
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
        'DC', 'PR',
    ]

    for si, st in enumerate(states):
        offset = 0
        page_size = 10000
        state_count = 0
        while True:
            url = (f"{WATER_SYSTEM_BASE}/STATE_CODE/{st}"
                   f"/WATER_SYSTEM_TYPE_CODE/CWS/PWS_ACTIVITY_CODE/A"
                   f"/rows/{offset}:{offset + page_size}/JSON")
            req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
                        data = json.loads(resp.read().decode())
                    break
                except Exception as e:
                    if attempt < 2:
                        time.sleep(3 * (attempt + 1))
                    else:
                        print(f"  Error fetching {st} offset {offset}: {e}")
                        data = []

            if not data or not isinstance(data, list):
                break

            for rec in data:
                zc = (rec.get('zip_code') or '').strip()[:5]
                coords = zcta.get(zc)
                if not coords:
                    continue
                name = (rec.get('pws_name') or '').strip()
                pop = rec.get('population_served_count')
                if pop is not None:
                    try:
                        pop = int(pop)
                    except (ValueError, TypeError):
                        pop = None
                all_systems.append({
                    'id': rec.get('pwsid'),
                    'name': name,
                    'pop': pop,
                    'lat': coords[0],
                    'lng': coords[1],
                })
                state_count += 1

            if len(data) < page_size:
                break
            offset += page_size

        if (si + 1) % 10 == 0:
            print(f"  States: {si + 1}/{len(states)}, systems so far: {len(all_systems)}")

    print(f"  Total community water systems with coords: {len(all_systems)}")

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(all_systems, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return all_systems


def load_cached_water_systems():
    """Load water system data from cache file."""
    print(f"\n[Phase 1] Loading cached water system data from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        systems = json.load(f)
    print(f"  Loaded {len(systems)} water systems from cache")
    return systems


# -- Spatial grid index -----------------------------------------------------

def build_spatial_index(systems):
    """
    Build a grid index mapping 1-degree cells to water system indices.
    Each system is indexed in its cell.
    """
    print("\n  Building spatial grid index...")
    grid = {}  # (cell_lat, cell_lng) -> list of system indices
    for idx, ws in enumerate(systems):
        cell = (int(math.floor(ws['lat'])), int(math.floor(ws['lng'])))
        if cell not in grid:
            grid[cell] = []
        grid[cell].append(idx)
    print(f"  Index covers {len(grid)} grid cells")
    return grid


def get_nearby_system_indices(grid, lat, lng):
    """Get water system indices from cells within ~200 km of a point."""
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


# -- Main -------------------------------------------------------------------

def find_nearest_water_system(lat, lng, systems, grid_index):
    """Find nearest water system to a point. Returns (distance_km, system_index) or (None, None)."""
    nearby_indices = get_nearby_system_indices(grid_index, lat, lng)
    if not nearby_indices:
        return None, None

    min_dist = float('inf')
    best_idx = None
    for idx in nearby_indices:
        ws = systems[idx]
        d = haversine(lat, lng, ws['lat'], ws['lng'])
        if d < min_dist:
            min_dist = d
            best_idx = idx
            if min_dist < 0.01:  # Close enough
                break

    if min_dist < float('inf') and best_idx is not None:
        return round(min_dist, 2), best_idx
    return None, None


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Water System Proximity")
    print("=" * 50)

    # Phase 1: Get water system data
    if skip_download and os.path.exists(CACHE_FILE):
        systems = load_cached_water_systems()
    else:
        systems = download_water_systems()

    if not systems:
        print("ERROR: No water system data available.")
        return

    # Build spatial index
    grid_index = build_spatial_index(systems)

    # Phase 2: Load DC sites
    print(f"\n[Phase 2] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,nearest_water_system_km',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('nearest_water_system_km') is None]
    print(f"  {len(sites_to_process)} sites need water system distance")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Calculate distances
    print(f"\n  Calculating nearest water system for {len(sites_to_process)} sites...")
    results = {}  # site_id -> (distance_km, system_name, pop_served)
    no_system = 0
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        lat = site['latitude']
        lng = site['longitude']
        dist, ws_idx = find_nearest_water_system(lat, lng, systems, grid_index)
        if dist is not None and ws_idx is not None:
            ws = systems[ws_idx]
            results[site['id']] = (dist, ws['name'], ws['pop'])
        else:
            no_system += 1

        if (i + 1) % 1000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({len(results)} found, {no_system} no system nearby, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Final: {len(results)} with water system, {no_system} none within {MAX_SEARCH_KM} km")

    if not results:
        print("  No results to patch.")
        return

    # Stats
    distances = sorted([r[0] for r in results.values()])
    pops = [r[2] for r in results.values() if r[2] is not None]
    n = len(distances)
    print(f"\n  Distance statistics:")
    print(f"    Min:    {distances[0]:.2f} km")
    print(f"    Max:    {distances[-1]:.2f} km")
    print(f"    Mean:   {sum(distances) / n:.2f} km")
    print(f"    Median: {distances[n // 2]:.2f} km")
    print(f"    p10:    {distances[int(n * 0.1)]:.2f} km")
    print(f"    p90:    {distances[int(n * 0.9)]:.2f} km")
    if pops:
        pops_sorted = sorted(pops)
        pn = len(pops_sorted)
        print(f"\n  Population served statistics:")
        print(f"    Min:    {pops_sorted[0]:,}")
        print(f"    Max:    {pops_sorted[-1]:,}")
        print(f"    Mean:   {sum(pops_sorted) // pn:,}")
        print(f"    Median: {pops_sorted[pn // 2]:,}")

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, (dist, name, pop) in samples:
            pop_str = f"{pop:,}" if pop else 'N/A'
            print(f"  Would patch {site_id}: {dist:.2f} km to '{name}' (pop {pop_str})")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")

    # Generate SQL with temp table + UPDATE JOIN
    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_water_system_update.sql')
    with open(sql_file, 'w') as f:
        f.write("-- Add columns if they don't exist\n")
        f.write("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_water_system_km NUMERIC(8,2);\n")
        f.write("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_water_system_name TEXT;\n")
        f.write("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS water_system_pop_served INTEGER;\n\n")
        f.write("CREATE TEMP TABLE _water_sys (id UUID, dist NUMERIC(8,2), ws_name TEXT, pop INTEGER);\n")
        f.write("COPY _water_sys (id, dist, ws_name, pop) FROM STDIN;\n")
        for site_id, (dist, name, pop) in results.items():
            # Escape name for COPY format: replace tabs/newlines/backslashes
            safe_name = (name or '').replace('\\', '\\\\').replace('\t', ' ').replace('\n', ' ')
            pop_val = str(pop) if pop is not None else '\\N'
            f.write(f"{site_id}\t{dist}\t{safe_name}\t{pop_val}\n")
        f.write("\\.\n\n")
        f.write("UPDATE grid_dc_sites SET\n")
        f.write("  nearest_water_system_km = _water_sys.dist,\n")
        f.write("  nearest_water_system_name = _water_sys.ws_name,\n")
        f.write("  water_system_pop_served = _water_sys.pop\n")
        f.write("FROM _water_sys WHERE grid_dc_sites.id = _water_sys.id;\n\n")
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE nearest_water_system_km IS NOT NULL;\n")

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

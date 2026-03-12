#!/usr/bin/env python3
"""
Enrich grid_dc_sites with OSM industrial/commercial landuse zone proximity.

Source: OpenStreetMap Overpass API
  https://overpass-api.de/api/interpreter

Downloads all US landuse=industrial and landuse=commercial zone centroids,
then checks if each DC site is within 2km of any zone centroid.

Fields populated:
- osm_landuse       TEXT    — 'industrial', 'commercial', or NULL
- in_industrial_zone BOOLEAN — TRUE if within 2km of industrial zone centroid

Usage:
  python3 -u scripts/enrich-osm-landuse.py
  python3 -u scripts/enrich-osm-landuse.py --dry-run
  python3 -u scripts/enrich-osm-landuse.py --skip-download
  python3 -u scripts/enrich-osm-landuse.py --skip-download --dry-run
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

EARTH_RADIUS_KM = 6371.0
MAX_SEARCH_KM = 2.0
GRID_CELL_DEG = 0.05  # ~5.5 km at equator — fine-grained for 2km search

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm_landuse_zones.json')


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


# -- Haversine math --

def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# -- Overpass download --

def download_landuse_zones():
    """Download US industrial + commercial landuse zone centroids from Overpass API in tiles."""
    print("\n[Phase 1] Downloading landuse zones from Overpass API (tiled)...")

    # Split US into 6x6 degree tiles to avoid Overpass timeout
    tiles = []
    for lat_start in range(24, 50, 6):
        for lng_start in range(-125, -66, 6):
            lat_end = min(lat_start + 6, 50)
            lng_end = min(lng_start + 6, -66)
            tiles.append((lat_start, lng_start, lat_end, lng_end))

    print(f"  Split into {len(tiles)} tiles (6x6 degrees each)")

    all_zones = []
    seen_ids = set()

    for tile_i, (s, w, n, e) in enumerate(tiles):
        query = f"""[out:json][timeout:180];
(
  way["landuse"="industrial"]({s},{w},{n},{e});
  way["landuse"="commercial"]({s},{w},{n},{e});
);
out center;
"""
        post_data = urllib.parse.urlencode({'data': query.strip()}).encode('utf-8')
        req = urllib.request.Request(
            OVERPASS_URL,
            data=post_data,
            headers={'User-Agent': 'GridScout/1.0', 'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST'
        )

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=240, context=SSL_CTX) as resp:
                    raw = resp.read().decode()
                    data = json.loads(raw)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(30)
                    continue
                elif e.code == 504 and attempt < 2:
                    time.sleep(30)
                    continue
                err_body = e.read().decode() if e.fp else ''
                print(f"  Tile {tile_i}: HTTP {e.code}: {err_body[:200]}")
                data = {'elements': []}
                break
            except Exception as ex:
                if attempt < 2:
                    time.sleep(10)
                    continue
                print(f"  Tile {tile_i}: Error: {ex}")
                data = {'elements': []}
                break

        elements = data.get('elements', [])
        new_count = 0
        for el in elements:
            center = el.get('center')
            if not center:
                continue
            osm_id = el.get('id')
            if osm_id in seen_ids:
                continue
            seen_ids.add(osm_id)
            lat = center.get('lat')
            lon = center.get('lon')
            if lat is None or lon is None:
                continue
            landuse = el.get('tags', {}).get('landuse', 'unknown')
            all_zones.append({'lat': lat, 'lon': lon, 'landuse': landuse, 'osm_id': osm_id})
            new_count += 1

        if (tile_i + 1) % 10 == 0 or (tile_i + 1) == len(tiles):
            print(f"  Tiles: {tile_i + 1}/{len(tiles)}, zones so far: {len(all_zones)} (+{new_count} this tile)")

        # Small delay between tiles to be polite
        time.sleep(1)

    print(f"\n  Total zones: {len(all_zones)}")
    industrial = sum(1 for z in all_zones if z['landuse'] == 'industrial')
    commercial = sum(1 for z in all_zones if z['landuse'] == 'commercial')
    print(f"    Industrial: {industrial}")
    print(f"    Commercial: {commercial}")

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(all_zones, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return all_zones


def load_cached_zones():
    """Load landuse zone data from cache file."""
    print(f"\n[Phase 1] Loading cached landuse zones from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        zones = json.load(f)
    industrial = sum(1 for z in zones if z['landuse'] == 'industrial')
    commercial = sum(1 for z in zones if z['landuse'] == 'commercial')
    print(f"  Loaded {len(zones)} zones ({industrial} industrial, {commercial} commercial)")
    return zones


# -- Spatial grid index --

def build_spatial_index(zones):
    """
    Build a grid index mapping small cells to zone indices.
    Cell size = 0.05 degrees (~5.5 km) for efficient 2km proximity search.
    """
    print("\n  Building spatial grid index...")
    grid = {}  # (cell_lat, cell_lng) -> list of zone indices
    for idx, zone in enumerate(zones):
        lat, lon = zone['lat'], zone['lon']
        cell_lat = int(math.floor(lat / GRID_CELL_DEG))
        cell_lng = int(math.floor(lon / GRID_CELL_DEG))
        cell = (cell_lat, cell_lng)
        if cell not in grid:
            grid[cell] = []
        grid[cell].append(idx)
    print(f"  Index covers {len(grid)} grid cells")
    return grid


def find_nearest_zone(lat, lng, zones, grid_index):
    """
    Find the nearest industrial/commercial zone centroid within 2km.
    Returns (distance_km, landuse_type) or (None, None).
    """
    # Search radius in cells: 2km / (5.5km/cell) = ~0.4, so check +/- 1 cell
    center_cell_lat = int(math.floor(lat / GRID_CELL_DEG))
    center_cell_lng = int(math.floor(lng / GRID_CELL_DEG))

    min_dist = float('inf')
    best_landuse = None

    for dlat in range(-1, 2):
        for dlng in range(-1, 2):
            cell = (center_cell_lat + dlat, center_cell_lng + dlng)
            if cell not in grid_index:
                continue
            for idx in grid_index[cell]:
                zone = zones[idx]
                d = haversine(lat, lng, zone['lat'], zone['lon'])
                if d < min_dist:
                    min_dist = d
                    best_landuse = zone['landuse']
                    if min_dist < 0.01:
                        return round(min_dist, 3), best_landuse

    if min_dist <= MAX_SEARCH_KM:
        return round(min_dist, 3), best_landuse
    return None, None


# -- Main --

def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich OSM Landuse Zones")
    print("=" * 50)

    # Phase 1: Get landuse zone data
    if skip_download and os.path.exists(CACHE_FILE):
        zones = load_cached_zones()
    else:
        zones = download_landuse_zones()

    if not zones:
        print("ERROR: No landuse zone data available.")
        return

    # Build spatial index
    grid_index = build_spatial_index(zones)

    # Phase 2: Load DC sites
    print(f"\n[Phase 2] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,osm_landuse,in_industrial_zone',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('osm_landuse') is None]
    print(f"  {len(sites_to_process)} sites need landuse enrichment")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Calculate zone proximity
    print(f"\n  Checking landuse zone proximity for {len(sites_to_process)} sites...")
    results = {}  # site_id -> (osm_landuse, in_industrial_zone)
    no_zone = 0
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        lat = site['latitude']
        lng = site['longitude']
        dist, landuse = find_nearest_zone(lat, lng, zones, grid_index)

        if landuse is not None:
            in_industrial = landuse == 'industrial'
            results[site['id']] = (landuse, in_industrial)
        else:
            no_zone += 1

        if (i + 1) % 5000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            industrial_count = sum(1 for _, (lu, _) in results.items() if lu == 'industrial')
            commercial_count = sum(1 for _, (lu, _) in results.items() if lu == 'commercial')
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({industrial_count} industrial, {commercial_count} commercial, "
                  f"{no_zone} no zone, {rate:.0f} sites/sec)")

    industrial_total = sum(1 for _, (lu, _) in results.items() if lu == 'industrial')
    commercial_total = sum(1 for _, (lu, _) in results.items() if lu == 'commercial')
    print(f"\n  Final: {len(results)} in zone ({industrial_total} industrial, "
          f"{commercial_total} commercial), {no_zone} not in any zone")

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, (landuse, in_ind) in samples:
            print(f"  Would patch {site_id}: osm_landuse={landuse}, in_industrial_zone={in_ind}")
        print(f"\n  Would patch {len(results)} sites total")
        print(f"  Would leave {no_zone} sites with NULL osm_landuse (no zone within {MAX_SEARCH_KM} km)")
        return

    if not results:
        print("  No results to patch.")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")
    import subprocess

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_osm_landuse_update.sql')
    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _landuse (id UUID, landuse TEXT, in_industrial BOOLEAN);\n")
        f.write("COPY _landuse (id, landuse, in_industrial) FROM STDIN;\n")
        for site_id, (landuse, in_industrial) in results.items():
            f.write(f"{site_id}\t{landuse}\t{'t' if in_industrial else 'f'}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "osm_landuse = _landuse.landuse, "
            "in_industrial_zone = _landuse.in_industrial "
            "FROM _landuse WHERE grid_dc_sites.id = _landuse.id;\n"
        )
        f.write(
            "SELECT osm_landuse, COUNT(*) AS cnt "
            "FROM grid_dc_sites WHERE osm_landuse IS NOT NULL "
            "GROUP BY osm_landuse ORDER BY cnt DESC;\n"
        )

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

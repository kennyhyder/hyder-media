#!/usr/bin/env python3
"""
Ingest large warehouses and industrial buildings from OpenStreetMap
as potential datacenter conversion sites (site_type='warehouse').

Queries Overpass API state-by-state for:
  - building=warehouse with area > 5000 sq m or height > 10 m
  - building=industrial with area > 5000 sq m
  - landuse=industrial with name (named industrial parks)

Computes nearest substation for each warehouse using grid-based spatial index.
Skips buildings within 500m of existing DC sites to avoid duplicates.

Expected: ~5,000-15,000 viable warehouse sites across US.

Usage:
  python3 -u scripts/ingest-osm-warehouses.py                # Full run
  python3 -u scripts/ingest-osm-warehouses.py --dry-run       # Preview without inserting
  python3 -u scripts/ingest-osm-warehouses.py --state CA      # Single state
  python3 -u scripts/ingest-osm-warehouses.py --limit 500     # Limit total records
  python3 -u scripts/ingest-osm-warehouses.py --skip-download # Use cached data
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm_warehouses')
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MIN_AREA_SQ_M = 5000       # ~54,000 sq ft — large enough for edge DC conversion
SQFT_PER_SQM = 10.7639
DEDUP_RADIUS_KM = 0.5      # Skip warehouses within 500m of existing DC sites
SUBSTATION_MAX_KM = 50      # Max distance to associate a substation
OVERPASS_DELAY = 10         # Seconds between state queries

# State → ISO region mapping
STATE_ISO = {
    'TX': 'ERCOT', 'CA': 'CAISO', 'NY': 'NYISO', 'CT': 'ISO-NE', 'MA': 'ISO-NE',
    'ME': 'ISO-NE', 'NH': 'ISO-NE', 'RI': 'ISO-NE', 'VT': 'ISO-NE',
    'PA': 'PJM', 'NJ': 'PJM', 'MD': 'PJM', 'DE': 'PJM', 'DC': 'PJM',
    'VA': 'PJM', 'WV': 'PJM', 'OH': 'PJM', 'IN': 'PJM', 'IL': 'PJM',
    'MI': 'PJM', 'KY': 'PJM', 'NC': 'PJM',
    'MN': 'MISO', 'IA': 'MISO', 'WI': 'MISO', 'MO': 'MISO', 'AR': 'MISO',
    'MS': 'MISO', 'LA': 'MISO',
    'OK': 'SPP', 'KS': 'SPP', 'NE': 'SPP', 'SD': 'SPP', 'ND': 'SPP',
    'NM': 'SPP', 'MT': 'SPP',
    'OR': 'WECC', 'WA': 'WECC', 'ID': 'WECC', 'UT': 'WECC', 'WY': 'WECC',
    'CO': 'WECC', 'AZ': 'WECC', 'NV': 'WECC',
    'GA': 'SERC', 'FL': 'SERC', 'AL': 'SERC', 'SC': 'SERC', 'TN': 'SERC',
}

# State bounding boxes for fallback coordinate → state lookup
STATE_BOUNDS = {
    'AL': (30.2, -88.5, 35.0, -84.9), 'AK': (51.2, -180.0, 71.4, -130.0),
    'AZ': (31.3, -114.8, 37.0, -109.0), 'AR': (33.0, -94.6, 36.5, -89.6),
    'CA': (32.5, -124.5, 42.0, -114.1), 'CO': (36.9, -109.1, 41.0, -102.0),
    'CT': (41.0, -73.7, 42.1, -71.8), 'DE': (38.4, -75.8, 39.8, -75.0),
    'DC': (38.8, -77.1, 39.0, -76.9), 'FL': (24.5, -87.6, 31.0, -80.0),
    'GA': (30.4, -85.6, 35.0, -80.8), 'HI': (18.9, -160.3, 22.2, -154.8),
    'ID': (42.0, -117.2, 49.0, -111.0), 'IL': (36.9, -91.5, 42.5, -87.0),
    'IN': (37.8, -88.1, 41.8, -84.8), 'IA': (40.4, -96.6, 43.5, -90.1),
    'KS': (37.0, -102.1, 40.0, -94.6), 'KY': (36.5, -89.6, 39.1, -82.0),
    'LA': (28.9, -94.0, 33.0, -89.0), 'ME': (43.0, -71.1, 47.5, -66.9),
    'MD': (37.9, -79.5, 39.7, -75.0), 'MA': (41.2, -73.5, 42.9, -69.9),
    'MI': (41.7, -90.4, 48.3, -82.4), 'MN': (43.5, -97.2, 49.4, -89.5),
    'MS': (30.2, -91.7, 35.0, -88.1), 'MO': (36.0, -95.8, 40.6, -89.1),
    'MT': (44.4, -116.1, 49.0, -104.0), 'NE': (40.0, -104.1, 43.0, -95.3),
    'NV': (35.0, -120.0, 42.0, -114.0), 'NH': (42.7, -72.6, 45.3, -71.0),
    'NJ': (38.9, -75.6, 41.4, -73.9), 'NM': (31.3, -109.1, 37.0, -103.0),
    'NY': (40.5, -79.8, 45.0, -71.9), 'NC': (33.8, -84.3, 36.6, -75.5),
    'ND': (45.9, -104.1, 49.0, -96.6), 'OH': (38.4, -84.8, 42.0, -80.5),
    'OK': (33.6, -103.0, 37.0, -94.4), 'OR': (42.0, -124.6, 46.3, -116.5),
    'PA': (39.7, -80.5, 42.3, -74.7), 'RI': (41.1, -71.9, 42.0, -71.1),
    'SC': (32.0, -83.4, 35.2, -78.5), 'SD': (42.5, -104.1, 46.0, -96.4),
    'TN': (34.9, -90.3, 36.7, -81.6), 'TX': (25.8, -106.7, 36.5, -93.5),
    'UT': (37.0, -114.1, 42.0, -109.0), 'VT': (42.7, -73.4, 45.0, -71.5),
    'VA': (36.5, -83.7, 39.5, -75.2), 'WA': (45.5, -124.8, 49.0, -116.9),
    'WV': (37.2, -82.6, 40.6, -77.7), 'WI': (42.5, -92.9, 47.1, -86.2),
    'WY': (41.0, -111.1, 45.0, -104.1),
}

# All 50 US states + DC
US_STATES = sorted(STATE_BOUNDS.keys())


# ─── Supabase helpers ───────────────────────────────────────────────

def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data, allow_nan=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def load_paginated(table, select, extra_filter='', page_size=1000):
    """Load all records from a table with pagination."""
    records = []
    offset = 0
    while True:
        path = f'{table}?select={select}{extra_filter}&order=id&limit={page_size}&offset={offset}'
        rows = supabase_request('GET', path)
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break
    return records


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', ''):
        return None
    return s[:max_len] if len(s) > max_len else s


# ─── Geospatial helpers ─────────────────────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def build_grid_index(items, lat_key='latitude', lng_key='longitude', cell_size=0.1):
    """Build spatial grid index for fast nearest-neighbor queries."""
    index = {}
    for item in items:
        lat = item.get(lat_key)
        lng = item.get(lng_key)
        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(item)
    return index


def find_nearest(lat, lng, spatial_index, cell_size=0.1, max_km=50):
    """Find nearest item from spatial index within max_km."""
    cell_lat = int(lat / cell_size)
    cell_lng = int(lng / cell_size)
    search_cells = max(2, int(max_km / (111 * cell_size)) + 1)

    best = None
    best_dist = float('inf')

    for di in range(-search_cells, search_cells + 1):
        for dj in range(-search_cells, search_cells + 1):
            cell = (cell_lat + di, cell_lng + dj)
            for item in spatial_index.get(cell, []):
                dist = haversine_km(lat, lng, float(item['latitude']), float(item['longitude']))
                if dist < best_dist:
                    best_dist = dist
                    best = item

    if best and best_dist <= max_km:
        return best, round(best_dist, 2)
    return None, None


def find_county_for_point(lat, lng, counties):
    """Find the nearest county for a point (simple nearest-centroid)."""
    best = None
    best_dist = float('inf')
    for county in counties:
        if county.get('latitude') and county.get('longitude'):
            dist = haversine_km(lat, lng, float(county['latitude']), float(county['longitude']))
            if dist < best_dist:
                best_dist = dist
                best = county
    return best


# ─── Overpass API ────────────────────────────────────────────────────

def build_overpass_query(state_code):
    """Build Overpass QL query for a single US state.

    Uses ISO3166-2 area codes which Overpass resolves to state boundaries.
    Queries building=warehouse, building=industrial, and named landuse=industrial.
    Uses `out center body;` to get centroid + tags + bounds.
    """
    return f"""
[out:json][timeout:180][maxsize:536870912];
area["ISO3166-2"="US-{state_code}"]->.searchArea;
(
  way["building"="warehouse"](area.searchArea);
  way["building"="industrial"](area.searchArea);
  way["landuse"="industrial"]["name"](area.searchArea);
);
out center body;
"""


def download_state_data(state_code, skip_download=False):
    """Download OSM warehouse/industrial data for a single state."""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache_path = os.path.join(DATA_DIR, f'osm_warehouses_{state_code}.json')

    # Use cached data if available
    if os.path.exists(cache_path):
        if skip_download:
            with open(cache_path, 'r') as f:
                return json.load(f)
        age_days = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age_days < 30:
            with open(cache_path, 'r') as f:
                return json.load(f)

    if skip_download:
        return None

    query = build_overpass_query(state_code)
    data = urllib.parse.urlencode({'data': query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data)
    req.add_header('User-Agent', 'GridScout/1.0 (warehouse-research)')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                result = json.loads(resp.read().decode())
                with open(cache_path, 'w') as f:
                    json.dump(result, f)
                return result
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code == 429 or e.code == 504:
                wait = 30 * (attempt + 1)
                print(f"    Overpass {e.code}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            print(f"    Overpass HTTP {e.code}: {error_body[:200]}")
            if attempt < 2:
                time.sleep(15 * (attempt + 1))
                continue
            return None
        except Exception as e:
            print(f"    Overpass error: {e}")
            if attempt < 2:
                time.sleep(15 * (attempt + 1))
                continue
            return None

    return None


# ─── OSM parsing ─────────────────────────────────────────────────────

def calculate_way_area(bounds):
    """Estimate area in sq meters from OSM way bounds."""
    if not bounds:
        return None
    min_lat = bounds.get('minlat')
    max_lat = bounds.get('maxlat')
    min_lon = bounds.get('minlon')
    max_lon = bounds.get('maxlon')
    if None in (min_lat, max_lat, min_lon, max_lon):
        return None

    lat_mid = (min_lat + max_lat) / 2.0
    lat_dist_m = abs(max_lat - min_lat) * 111320
    lon_dist_m = abs(max_lon - min_lon) * 111320 * math.cos(math.radians(lat_mid))
    return lat_dist_m * lon_dist_m


def parse_elements(data, state_code):
    """Parse Overpass API response elements into warehouse records."""
    if not data or 'elements' not in data:
        return []

    records = []
    seen_ids = set()

    for elem in data['elements']:
        osm_id = elem.get('id')
        if osm_id in seen_ids:
            continue
        seen_ids.add(osm_id)

        tags = elem.get('tags', {})
        osm_type = elem.get('type', 'way')

        # Get center coordinates
        if osm_type == 'node':
            lat = elem.get('lat')
            lng = elem.get('lon')
        else:
            center = elem.get('center', {})
            lat = center.get('lat')
            lng = center.get('lon')
        if not lat or not lng:
            continue

        # Skip if clearly outside US
        if lat < 18 or lat > 72 or lng < -180 or lng > -66:
            continue

        # Calculate area from bounds
        area_sqm = calculate_way_area(elem.get('bounds'))

        # Check explicit area tag
        osm_area = tags.get('building:area') or tags.get('area')
        if osm_area:
            try:
                area_sqm = float(osm_area)
            except (ValueError, TypeError):
                pass

        # Check height tag
        height_str = tags.get('height', '')
        height_m = None
        if height_str:
            try:
                height_m = float(height_str.replace('m', '').replace("'", '').strip())
            except (ValueError, TypeError):
                pass

        # Determine building category
        building_type = tags.get('building', '')
        landuse = tags.get('landuse', '')

        if building_type in ('warehouse', 'industrial'):
            # For buildings: require area > 5000 sq m OR height > 10 m
            if area_sqm and area_sqm < MIN_AREA_SQ_M:
                if not (height_m and height_m > 10):
                    continue
            elif not area_sqm:
                # No area estimate — only keep if tall or named
                if not (height_m and height_m > 10) and not tags.get('name'):
                    continue
        elif landuse == 'industrial':
            # Named industrial parks — always keep (name required in query)
            pass
        else:
            continue

        name = safe_str(tags.get('name'))
        operator = safe_str(tags.get('operator'))
        city = safe_str(tags.get('addr:city'))

        # Build address
        address_parts = []
        for akey in ('addr:housenumber', 'addr:street'):
            av = safe_str(tags.get(akey))
            if av:
                address_parts.append(av)
        address = ' '.join(address_parts) if address_parts else None

        # Determine subtype
        if building_type == 'warehouse':
            subtype = 'warehouse'
        elif building_type == 'industrial':
            subtype = 'industrial'
        elif landuse == 'industrial':
            subtype = 'industrial_park'
        else:
            subtype = 'other'

        # Generate display name
        if name:
            display_name = name
        elif operator:
            display_name = f"{operator} {subtype.replace('_', ' ').title()}"
        elif city:
            display_name = f"Industrial Building - {city}, {state_code}"
        else:
            display_name = f"Industrial Building - {state_code}"

        source_id = f"osm_warehouse_{osm_id}"

        records.append({
            'osm_id': osm_id,
            'source_record_id': source_id,
            'name': display_name[:200],
            'site_type': 'warehouse',
            'state': state_code,
            'city': city,
            'latitude': round(lat, 7),
            'longitude': round(lng, 7),
            'address': address,
            'zipcode': safe_str(tags.get('addr:postcode')),
            'operator': operator,
            'subtype': subtype,
            'area_sqm': area_sqm,
            'height_m': height_m,
        })

    return records


# ─── Existing record checks ─────────────────────────────────────────

def get_existing_source_ids(prefix='osm_warehouse_'):
    """Load existing source_record_ids with our prefix from grid_dc_sites."""
    existing = set()
    offset = 0
    encoded = urllib.parse.quote(f'{prefix}%', safe='')
    while True:
        result = supabase_request(
            'GET',
            f'grid_dc_sites?select=source_record_id&source_record_id=like.{encoded}&limit=1000&offset={offset}'
        )
        if not result:
            break
        for r in result:
            if r.get('source_record_id'):
                existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    return existing


# ─── Main ────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("GridScout OSM Warehouse/Industrial Building Ingestion")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    # Parse --state XX (single state)
    target_state = None
    for i, arg in enumerate(sys.argv):
        if arg == '--state' and i + 1 < len(sys.argv):
            target_state = sys.argv[i + 1].upper()

    # Parse --limit N
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            try:
                limit = int(sys.argv[i + 1])
            except ValueError:
                pass

    if target_state:
        if target_state not in US_STATES:
            print(f"ERROR: Unknown state '{target_state}'")
            sys.exit(1)
        states_to_process = [target_state]
        print(f"  Target state: {target_state}")
    else:
        states_to_process = US_STATES
        print(f"  Querying all {len(states_to_process)} states")

    if limit:
        print(f"  Limit: {limit} records")
    if skip_download:
        print(f"  Using cached data only (--skip-download)")
    if dry_run:
        print(f"  [DRY RUN MODE]")

    os.makedirs(DATA_DIR, exist_ok=True)

    # ── Step 1: Download OSM data state by state ──
    print(f"\n[Step 1] Downloading OSM warehouse data...")
    all_records = []
    state_counts = {}

    for idx, state in enumerate(states_to_process):
        sys.stdout.write(f"  [{idx + 1}/{len(states_to_process)}] {state}...")
        sys.stdout.flush()

        data = download_state_data(state, skip_download=skip_download)
        if not data:
            print(f" skipped (no data)")
            state_counts[state] = 0
            continue

        total_elements = len(data.get('elements', []))
        records = parse_elements(data, state)
        state_counts[state] = len(records)
        all_records.extend(records)
        print(f" {total_elements} elements -> {len(records)} qualifying")

        if limit and len(all_records) >= limit:
            all_records = all_records[:limit]
            print(f"  Reached limit of {limit} records, stopping downloads.")
            break

        # Rate-limit Overpass API between state queries
        if not skip_download and idx < len(states_to_process) - 1:
            cache_path = os.path.join(DATA_DIR, f'osm_warehouses_{state}.json')
            was_cached = os.path.exists(cache_path) and (time.time() - os.path.getmtime(cache_path)) / 86400 < 30
            if not was_cached:
                time.sleep(OVERPASS_DELAY)

    print(f"\n  Total qualifying buildings: {len(all_records)}")

    if not all_records:
        print("  No warehouses found. Exiting.")
        return

    # ── Step 2: Load existing DC sites for proximity dedup ──
    print(f"\n[Step 2] Loading existing DC sites for proximity check...")
    existing_sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  {len(existing_sites)} existing DC sites loaded")
    dc_index = build_grid_index(existing_sites, cell_size=0.01)  # ~1km cells for fine dedup

    # Skip warehouses within 500m of existing DC sites
    filtered = []
    skipped_proximity = 0
    for rec in all_records:
        nearest_dc, dist = find_nearest(
            rec['latitude'], rec['longitude'], dc_index,
            cell_size=0.01, max_km=DEDUP_RADIUS_KM
        )
        if nearest_dc and dist is not None and dist <= DEDUP_RADIUS_KM:
            skipped_proximity += 1
            continue
        filtered.append(rec)

    print(f"  Skipped {skipped_proximity} warehouses within {DEDUP_RADIUS_KM} km of existing DC sites")
    print(f"  {len(filtered)} warehouses after proximity filter")
    all_records = filtered

    # ── Step 3: Load substations for nearest-substation computation ──
    print(f"\n[Step 3] Loading substations for nearest-substation lookup...")
    substations = load_paginated(
        'grid_substations',
        'id,name,latitude,longitude,max_voltage_kv',
        '&max_voltage_kv=gte.69&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  {len(substations)} substations loaded (>= 69 kV)")
    sub_index = build_grid_index(substations, cell_size=0.1)

    # ── Step 4: Load county data for FIPS/county assignment ──
    print(f"\n[Step 4] Loading county data...")
    counties = load_paginated('grid_county_data', 'fips_code,state,county_name,latitude,longitude')
    print(f"  {len(counties)} counties loaded")

    # ── Step 5: Compute nearest substation + assign county ──
    print(f"\n[Step 5] Computing nearest substations and county assignments...")
    sub_found = 0
    county_found = 0

    for rec in all_records:
        lat, lng = rec['latitude'], rec['longitude']

        # Find nearest substation
        nearest_sub, sub_dist = find_nearest(lat, lng, sub_index, cell_size=0.1, max_km=SUBSTATION_MAX_KM)
        if nearest_sub:
            rec['nearest_substation_name'] = nearest_sub.get('name')
            rec['nearest_substation_id'] = nearest_sub.get('id')
            rec['nearest_substation_distance_km'] = sub_dist
            voltage = float(nearest_sub['max_voltage_kv']) if nearest_sub.get('max_voltage_kv') else None
            rec['substation_voltage_kv'] = voltage
            sub_found += 1
        else:
            rec['nearest_substation_name'] = None
            rec['nearest_substation_id'] = None
            rec['nearest_substation_distance_km'] = None
            rec['substation_voltage_kv'] = None

        # Assign county
        county = find_county_for_point(lat, lng, counties)
        if county:
            rec['fips_code'] = county['fips_code']
            rec['county'] = county['county_name']
            county_found += 1

    pct_sub = 100 * sub_found / len(all_records) if all_records else 0
    pct_cty = 100 * county_found / len(all_records) if all_records else 0
    print(f"  Substations found: {sub_found}/{len(all_records)} ({pct_sub:.1f}%)")
    print(f"  Counties assigned: {county_found}/{len(all_records)} ({pct_cty:.1f}%)")

    # ── Summary stats ──
    states_dist = {}
    subtypes = {}
    for r in all_records:
        s = r.get('state', '??')
        states_dist[s] = states_dist.get(s, 0) + 1
        st = r.get('subtype', 'unknown')
        subtypes[st] = subtypes.get(st, 0) + 1

    print(f"\nBy type:")
    for t, c in sorted(subtypes.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")
    print(f"\nBy state (top 15):")
    for s, c in sorted(states_dist.items(), key=lambda x: -x[1])[:15]:
        print(f"  {s}: {c}")

    # Area stats
    areas_sqft = [r['area_sqm'] * SQFT_PER_SQM for r in all_records if r.get('area_sqm')]
    if areas_sqft:
        print(f"\nArea stats (sqft):")
        print(f"  Min: {min(areas_sqft):,.0f}")
        print(f"  Max: {max(areas_sqft):,.0f}")
        print(f"  Avg: {sum(areas_sqft) / len(areas_sqft):,.0f}")
        print(f"  Median: {sorted(areas_sqft)[len(areas_sqft) // 2]:,.0f}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert up to {len(all_records)} warehouse records into grid_dc_sites.")
        print("\nSample records:")
        for r in all_records[:5]:
            sqft = round(r['area_sqm'] * SQFT_PER_SQM) if r.get('area_sqm') else '?'
            sub_km = r.get('nearest_substation_distance_km', '?')
            print(f"  {r['source_record_id']} | {r['state']} | {r['name'][:50]} | "
                  f"{sqft} sqft | nearest sub: {sub_km} km")
        return

    # ── Step 6: Get or create data source ──
    print(f"\n[Step 6] Getting data source...")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.osm_warehouses&select=id')
    data_source_id = ds[0]['id'] if ds else None
    if not data_source_id:
        print("  Creating osm_warehouses data source...")
        result = supabase_request('POST', 'grid_data_sources', [{
            'name': 'osm_warehouses',
            'url': 'https://wiki.openstreetmap.org/wiki/Tag:building%3Dwarehouse',
            'description': 'OpenStreetMap warehouse/industrial buildings as edge DC conversion candidates',
        }], {'Prefer': 'return=representation'})
        if result:
            data_source_id = result[0]['id']

    # ── Step 7: Check existing records ──
    print(f"\n[Step 7] Checking existing records...")
    existing_ids = get_existing_source_ids()
    print(f"  {len(existing_ids)} existing warehouse records in DB")

    # ── Step 8: Build insert records ──
    now = datetime.now(timezone.utc).isoformat()
    new_records = []
    for r in all_records:
        if r['source_record_id'] in existing_ids:
            continue

        rec = {
            'source_record_id': r['source_record_id'],
            'name': r['name'],
            'site_type': 'warehouse',
            'state': r['state'],
            'county': r.get('county'),
            'fips_code': r.get('fips_code'),
            'latitude': r['latitude'],
            'longitude': r['longitude'],
            'nearest_substation_name': r.get('nearest_substation_name'),
            'nearest_substation_id': r.get('nearest_substation_id'),
            'nearest_substation_distance_km': r.get('nearest_substation_distance_km'),
            'substation_voltage_kv': r.get('substation_voltage_kv'),
            'iso_region': STATE_ISO.get(r['state']),
            'former_use': r.get('subtype'),  # warehouse/industrial/industrial_park
            'acreage': round(r['area_sqm'] / 4046.86, 2) if r.get('area_sqm') else None,
            'available_capacity_mw': None,
            'created_at': now,
        }

        if data_source_id:
            rec['data_source_id'] = data_source_id

        new_records.append(rec)

    print(f"  {len(new_records)} new records to insert ({len(all_records) - len(new_records)} already exist)")

    if not new_records:
        print("  Nothing to insert.")
        return

    # ── Step 9: Insert in batches ──
    print(f"\n[Step 9] Inserting {len(new_records)} records...")
    created = 0
    errors = 0

    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {'Prefer': 'return=minimal'})
            created += len(batch)
            if created % 500 == 0 or i + BATCH_SIZE >= len(new_records):
                print(f"  Inserted {created}/{len(new_records)}...")
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            # Fall back to one-by-one
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_dc_sites', [rec], {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"    Record error ({rec['source_record_id']}): {e2}")

    # Update data source count
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': len(existing_ids) + created,
            'last_import': now,
        })

    print(f"\n{'=' * 60}")
    print(f"OSM Warehouse Ingestion Complete")
    print(f"  Created: {created}")
    print(f"  Skipped (existing): {len(all_records) - len(new_records)}")
    print(f"  Skipped (proximity): {skipped_proximity}")
    print(f"  Errors: {errors}")
    print(f"  Total warehouse records in DB: {len(existing_ids) + created}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

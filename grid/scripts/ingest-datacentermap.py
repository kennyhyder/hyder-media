#!/usr/bin/env python3
"""
Ingest datacenter locations from HIFLD ArcGIS FeatureServer into grid_datacenters,
then recompute nearest_dc_distance_km for all grid_dc_sites.

Data Source: HIFLD Data Centers (Homeland Infrastructure Foundation-Level Data)
  https://services1.arcgis.com/Hp6G80Pky0om6HgQ/arcgis/rest/services/Data_Centers/FeatureServer/0

Fallback: If HIFLD endpoint is unreachable, aggregates existing grid_datacenters
  (PNNL + PeeringDB + OSM) as the DC inventory for nearest-DC computation.

After inserting new DCs, updates grid_dc_sites with:
  - nearest_dc_id
  - nearest_dc_name
  - nearest_dc_distance_km

Usage:
  python3 -u scripts/ingest-datacentermap.py              # Full run
  python3 -u scripts/ingest-datacentermap.py --dry-run    # Preview without changes
  python3 -u scripts/ingest-datacentermap.py --skip-download  # Use cached HIFLD data
  python3 -u scripts/ingest-datacentermap.py --update-only    # Skip ingestion, just update nearest DC
"""

import os
import sys
import json
import math
import time
import re
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
MAX_SEARCH_KM = 250.0
GRID_CELL_DEG = 0.5

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'dc_inventory')
CACHE_FILE = os.path.join(DATA_DIR, 'hifld_data_centers.json')

HIFLD_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om6HgQ/arcgis/rest/services/"
    "Data_Centers/FeatureServer/0/query"
)


# ── Supabase helpers ──────────────────────────────────────────

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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                print(f"  Error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            raise


def load_paginated(table, select='*', filters='', page_size=1000):
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


# ── Utility functions ─────────────────────────────────────────

def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', '', '-'):
        return None
    return s[:max_len] if len(s) > max_len else s


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def normalize_name(name):
    """Normalize datacenter name for dedup comparison."""
    if not name:
        return ''
    s = name.lower().strip()
    for remove in ['data center', 'data centre', 'datacenter', 'datacentre',
                    'dc', 'facility', 'campus', 'building', 'bldg',
                    'inc', 'inc.', 'llc', 'corp', 'corporation', 'co.']:
        s = s.replace(remove, '')
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def haversine_m(lat1, lng1, lat2, lng2):
    return haversine_km(lat1, lng1, lat2, lng2) * 1000.0


def classify_dc_type(name, operator):
    """Classify datacenter type from name/operator."""
    text = ((name or '') + ' ' + (operator or '')).lower()
    if any(h in text for h in ['amazon', 'aws', 'google', 'microsoft', 'azure',
                                'meta', 'facebook', 'apple', 'oracle']):
        return 'hyperscale'
    if any(c in text for c in ['equinix', 'digital realty', 'coresite', 'cyrusone',
                                'qts', 'switch', 'databank', 'flexential',
                                'tierpoint', 'cologix', 'vantage',
                                'stack', 'aligned', 'compass', 'colocation', 'colo']):
        return 'colocation'
    if any(e in text for e in ['edge', 'micro', 'modular']):
        return 'edge'
    return 'enterprise'


# State bounding boxes for coordinate-to-state lookup
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

US_STATES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI',
    'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME',
    'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
    'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI',
    'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
    'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
    'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
}


def coords_to_state(lat, lng):
    for state, (s, w, n, e) in STATE_BOUNDS.items():
        if s <= lat <= n and w <= lng <= e:
            return state
    return None


# ── Phase 1: HIFLD Download ──────────────────────────────────

def download_hifld():
    """Download all datacenter records from HIFLD ArcGIS FeatureServer."""
    print("\n[Phase 1] Downloading datacenter data from HIFLD ArcGIS...")
    os.makedirs(DATA_DIR, exist_ok=True)

    all_features = []
    offset = 0
    page_size = 2000

    while True:
        params = urllib.parse.urlencode({
            'where': '1=1',
            'outFields': '*',
            'returnGeometry': 'true',
            'outSR': '4326',
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        })
        url = f"{HIFLD_URL}?{params}"
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
                    return None

        # Check for error response
        if 'error' in data:
            print(f"  ArcGIS error: {data['error']}")
            return None

        features = data.get('features', [])
        if not features:
            break

        all_features.extend(features)
        offset += page_size

        if len(features) < page_size:
            break

        if offset % 5000 == 0:
            print(f"  Downloaded {offset} features...")

    print(f"  Total HIFLD datacenter features: {len(all_features)}")

    # Cache to file
    with open(CACHE_FILE, 'w') as f:
        json.dump(all_features, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return all_features


def load_cached_hifld():
    """Load HIFLD data from cache file."""
    print(f"\n[Phase 1] Loading cached HIFLD data from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        features = json.load(f)
    print(f"  Loaded {len(features)} datacenter features from cache")
    return features


def parse_hifld(features):
    """Parse HIFLD ArcGIS features into datacenter records for grid_datacenters."""
    records = []
    skipped = 0

    for feat in features:
        attrs = feat.get('attributes', {})
        geom = feat.get('geometry', {})

        lat = safe_float(geom.get('y'))
        lng = safe_float(geom.get('x'))

        if not lat or not lng:
            skipped += 1
            continue

        # Skip non-US coordinates
        if lat < 18 or lat > 72 or lng < -180 or lng > -66:
            skipped += 1
            continue

        # Extract fields — HIFLD field names vary; try common patterns
        name = (safe_str(attrs.get('NAME'))
                or safe_str(attrs.get('FACNAME'))
                or safe_str(attrs.get('name'))
                or safe_str(attrs.get('facname')))
        operator = (safe_str(attrs.get('OPERATOR'))
                    or safe_str(attrs.get('OWNER'))
                    or safe_str(attrs.get('operator'))
                    or safe_str(attrs.get('owner'))
                    or safe_str(attrs.get('COMPANY')))
        city = (safe_str(attrs.get('CITY'))
                or safe_str(attrs.get('city')))
        state = (safe_str(attrs.get('STATE'))
                 or safe_str(attrs.get('state')))
        address = (safe_str(attrs.get('ADDRESS'))
                   or safe_str(attrs.get('STREET'))
                   or safe_str(attrs.get('address')))

        # Normalize state
        if state and len(state) > 2:
            state = US_STATES.get(state, state)
        if not state or len(state) != 2:
            state = coords_to_state(lat, lng)
        if not state:
            skipped += 1
            continue

        state = state.upper()

        # Try to get capacity from sqft or other fields
        sqft = safe_float(attrs.get('SQFT') or attrs.get('sqft'))

        # Build a unique source_record_id from HIFLD OBJECTID
        oid = attrs.get('OBJECTID') or attrs.get('objectid') or attrs.get('FID')
        if oid is not None:
            source_id = f"hifld_dc_{oid}"
        else:
            # Fallback: use lat/lng hash
            source_id = f"hifld_dc_{lat:.5f}_{lng:.5f}"

        dc_type = classify_dc_type(name, operator)

        records.append({
            'source_record_id': source_id,
            'name': name or f"HIFLD DC {oid or ''}".strip(),
            'operator': operator,
            'city': city,
            'state': state,
            'latitude': round(lat, 7),
            'longitude': round(lng, 7),
            'capacity_mw': None,
            'sqft': sqft,
            'dc_type': dc_type,
            'year_built': None,
        })

    print(f"  Parsed {len(records)} valid US datacenter records ({skipped} skipped)")
    return records


# ── Phase 2: Dedup + Insert ───────────────────────────────────

def load_existing():
    """Load all existing grid_datacenters records for dedup."""
    return load_paginated(
        'grid_datacenters',
        'id,source_record_id,name,operator,city,state,latitude,longitude,dc_type',
    )


def is_duplicate(new_rec, existing_records):
    """Check if new_rec duplicates any existing record (500m proximity or name overlap)."""
    new_lat = new_rec['latitude']
    new_lng = new_rec['longitude']
    new_name_norm = normalize_name(new_rec.get('name', ''))
    new_state = new_rec.get('state', '')

    for ex in existing_records:
        ex_lat = float(ex.get('latitude', 0) or 0)
        ex_lng = float(ex.get('longitude', 0) or 0)

        if not ex_lat or not ex_lng:
            continue

        # Quick bounding box check (~5km)
        if abs(new_lat - ex_lat) > 0.05 or abs(new_lng - ex_lng) > 0.05:
            continue

        dist = haversine_m(new_lat, new_lng, ex_lat, ex_lng)

        # Proximity match: <500m
        if dist < 500:
            return ex

        # Name similarity: same state + name overlap
        if new_state and new_state == ex.get('state', ''):
            ex_name_norm = normalize_name(ex.get('name', ''))
            if new_name_norm and ex_name_norm:
                if new_name_norm in ex_name_norm or ex_name_norm in new_name_norm:
                    return ex
                new_words = set(new_name_norm.split())
                ex_words = set(ex_name_norm.split())
                if new_words and ex_words:
                    overlap = len(new_words & ex_words)
                    total = min(len(new_words), len(ex_words))
                    if total > 0 and overlap / total >= 0.6 and overlap >= 2:
                        return ex

    return None


def get_or_create_source(name, url, description):
    """Get or create a data source entry."""
    encoded_name = urllib.parse.quote(name, safe='')
    ds = supabase_request('GET', f'grid_data_sources?name=eq.{encoded_name}&select=id')
    if ds:
        return ds[0]['id']
    result = supabase_request('POST', 'grid_data_sources', [{
        'name': name,
        'url': url,
        'description': description,
    }], {'Prefer': 'return=representation'})
    return result[0]['id'] if result else None


# ── Phase 3: Update nearest DC on grid_dc_sites ──────────────

def build_grid_index(items, cell_size=0.5):
    """Build spatial grid index for point items."""
    index = {}
    for item in items:
        lat = float(item.get('latitude', 0) or 0)
        lng = float(item.get('longitude', 0) or 0)
        if not lat or not lng:
            continue
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(item)
    return index


def find_nearest(lat, lng, spatial_index, cell_size=0.5, max_km=250):
    """Find nearest item from spatial index."""
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


def update_nearest_dc(dc_records, dry_run=False):
    """Recompute nearest_dc for all grid_dc_sites using expanded DC inventory."""
    print(f"\n[Phase 3] Updating nearest DC for grid_dc_sites...")
    print(f"  DC inventory size: {len(dc_records)}")

    # Build spatial index from all DCs
    dc_index = build_grid_index(dc_records, cell_size=GRID_CELL_DEG)
    print(f"  DC spatial index: {len(dc_index)} grid cells")

    # Load all grid_dc_sites with coordinates
    print("  Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,nearest_dc_distance_km',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    if not sites:
        print("  No sites to process.")
        return

    # Compute nearest DC for each site
    print(f"  Computing nearest DC for {len(sites)} sites...")
    results = {}  # site_id -> (dc_id, dc_name, distance_km)
    no_dc = 0
    t0 = time.time()

    for i, site in enumerate(sites):
        lat = float(site['latitude'])
        lng = float(site['longitude'])
        nearest, dist = find_nearest(lat, lng, dc_index, cell_size=GRID_CELL_DEG, max_km=MAX_SEARCH_KM)

        if nearest and dist is not None:
            results[site['id']] = (nearest['id'], nearest.get('name'), dist)
        else:
            no_dc += 1

        if (i + 1) % 5000 == 0 or (i + 1) == len(sites):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"    Progress: {i + 1}/{len(sites)} "
                  f"({len(results)} found, {no_dc} no DC nearby, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Final: {len(results)} with nearest DC, {no_dc} no DC within {MAX_SEARCH_KM} km")

    if not results:
        print("  No results to patch.")
        return

    # Distance stats
    distances = sorted(r[2] for r in results.values())
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
        for site_id, (dc_id, dc_name, dist) in samples:
            print(f"  Would patch {site_id}: nearest_dc={dc_name} ({dist:.2f} km)")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Patch via psql (bulk UPDATE is much faster than REST API)
    print(f"\n  Patching {len(results)} sites via psql...")
    sql_file = os.path.join(DATA_DIR, '_nearest_dc_update.sql')

    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _dc_nearest (id UUID, dc_id UUID, dc_name TEXT, dist NUMERIC(8,2));\n")
        f.write("COPY _dc_nearest (id, dc_id, dc_name, dist) FROM STDIN;\n")
        for site_id, (dc_id, dc_name, dist) in results.items():
            # Escape tab/newline in dc_name for COPY format
            safe_name = (dc_name or '').replace('\t', ' ').replace('\n', ' ').replace('\\', '\\\\')
            f.write(f"{site_id}\t{dc_id}\t{safe_name}\t{dist}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "nearest_dc_id = n.dc_id::uuid, "
            "nearest_dc_name = n.dc_name, "
            "nearest_dc_distance_km = n.dist "
            "FROM _dc_nearest n WHERE grid_dc_sites.id = n.id;\n"
        )
        f.write(
            "SELECT COUNT(*) AS updated FROM grid_dc_sites "
            "WHERE nearest_dc_id IS NOT NULL;\n"
        )

    db_password = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password

    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-f', sql_file],
        capture_output=True, text=True, env=env, timeout=300
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

    print(f"\n  Done! {len(results)} sites patched with nearest DC data.")


# ── Main ──────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv
    update_only = '--update-only' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("=" * 60)
    print("GridScout: Ingest Datacenter Locations (HIFLD + Nearest DC)")
    print("=" * 60)

    hifld_records = []
    hifld_ok = False

    if not update_only:
        # Phase 1: Download/load HIFLD data
        if skip_download and os.path.exists(CACHE_FILE):
            features = load_cached_hifld()
        else:
            features = download_hifld()

        if features:
            hifld_records = parse_hifld(features)
            hifld_ok = True
        else:
            print("\n  WARNING: HIFLD endpoint not available. Skipping HIFLD ingestion.")
            print("  Will still update nearest DC using existing grid_datacenters inventory.")

        # Phase 2: Dedup + Insert (only if we got HIFLD data)
        if hifld_ok and hifld_records:
            print(f"\n[Phase 2] Dedup against existing grid_datacenters...")

            existing = load_existing()
            print(f"  {len(existing)} existing records in DB")

            # Filter by source_record_id (fast exact match)
            existing_ids = {r['source_record_id'] for r in existing if r.get('source_record_id')}
            id_filtered = [r for r in hifld_records if r['source_record_id'] not in existing_ids]
            id_skipped = len(hifld_records) - len(id_filtered)
            print(f"  Skipped {id_skipped} by source_record_id match")

            # Spatial + name dedup against existing
            net_new = []
            patches = []
            for rec in id_filtered:
                match = is_duplicate(rec, existing)
                if match:
                    # Enrich existing if missing fields
                    patch = {}
                    if not match.get('operator') and rec.get('operator'):
                        patch['operator'] = rec['operator']
                    if not match.get('city') and rec.get('city'):
                        patch['city'] = rec['city']
                    if not match.get('dc_type') and rec.get('dc_type'):
                        patch['dc_type'] = rec['dc_type']
                    if not match.get('sqft') and rec.get('sqft'):
                        patch['sqft'] = rec['sqft']
                    if patch:
                        patches.append((match['id'], patch))
                else:
                    net_new.append(rec)

            print(f"  Spatial/name dedup removed: {len(id_filtered) - len(net_new)}")
            print(f"  Enrichment patches for existing: {len(patches)}")
            print(f"  Net new to insert: {len(net_new)}")

            # State breakdown
            states = {}
            for r in net_new:
                s = r.get('state', '??')
                states[s] = states.get(s, 0) + 1
            if states:
                print(f"\n  Net new by state (top 15):")
                for s, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
                    print(f"    {s}: {c}")

            if dry_run:
                print(f"\n  [DRY RUN] Would insert {len(net_new)} and apply {len(patches)} patches.")
            else:
                # Get/create data source
                ds_id = get_or_create_source(
                    'hifld_data_centers',
                    'https://hifld-geoplatform.opendata.arcgis.com/datasets/data-centers',
                    'HIFLD Homeland Infrastructure Foundation-Level Data: Data Centers'
                )

                # Apply enrichment patches
                if patches:
                    print(f"\n  Applying {len(patches)} enrichment patches...")
                    patch_ok = 0
                    patch_err = 0
                    for ex_id, patch in patches:
                        try:
                            supabase_request('PATCH', f'grid_datacenters?id=eq.{ex_id}', patch)
                            patch_ok += 1
                        except Exception as e:
                            patch_err += 1
                            if patch_err <= 5:
                                print(f"    Patch error: {e}")
                    print(f"    {patch_ok} patched, {patch_err} errors")

                # Insert net new
                if net_new:
                    print(f"\n  Inserting {len(net_new)} new records...")
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc).isoformat()

                    for r in net_new:
                        if ds_id:
                            r['data_source_id'] = ds_id
                        r['created_at'] = now

                    created = 0
                    errors = 0
                    for i in range(0, len(net_new), BATCH_SIZE):
                        batch = net_new[i:i + BATCH_SIZE]
                        try:
                            supabase_request('POST', 'grid_datacenters', batch,
                                             {'Prefer': 'return=minimal'})
                            created += len(batch)
                            if created % 200 == 0 or i + BATCH_SIZE >= len(net_new):
                                print(f"    Inserted {created}/{len(net_new)}...")
                        except Exception as e:
                            print(f"    Batch error at {i}: {e}")
                            for rec in batch:
                                try:
                                    supabase_request('POST', 'grid_datacenters', [rec],
                                                     {'Prefer': 'return=minimal'})
                                    created += 1
                                except Exception as e2:
                                    errors += 1
                                    if errors <= 10:
                                        print(f"    Record error ({rec['source_record_id']}): {e2}")

                    print(f"    Created: {created}, Errors: {errors}")

    # Phase 3: Update nearest DC on grid_dc_sites
    # Load the full DC inventory (all sources)
    print(f"\n  Loading full DC inventory from grid_datacenters...")
    all_dcs = load_paginated(
        'grid_datacenters',
        'id,name,operator,latitude,longitude,dc_type',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Total DC inventory: {len(all_dcs)} datacenters")

    if not all_dcs:
        print("  ERROR: No datacenters in inventory. Cannot update nearest DC.")
        return

    update_nearest_dc(all_dcs, dry_run=dry_run)

    print(f"\n{'=' * 60}")
    print(f"Ingest Datacenter Map Complete")
    if hifld_ok:
        print(f"  HIFLD records parsed: {len(hifld_records)}")
    else:
        print(f"  HIFLD: skipped (endpoint unavailable or --update-only)")
    print(f"  Total DC inventory: {len(all_dcs)}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

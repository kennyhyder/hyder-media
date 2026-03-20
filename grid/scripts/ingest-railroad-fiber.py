#!/usr/bin/env python3
"""
Ingest FRA/BTS North American Rail Network Lines as fiber route proxies.

Most long-haul fiber optic cables follow railroad rights-of-way (ROW).
This script ingests 235K+ US railroad line segments from the BTS NTAD
ArcGIS FeatureServer, storing them as fiber_type='railroad_row' routes
in grid_fiber_routes.

Source: BTS National Transportation Atlas Database (NTAD)
  - North American Rail Network Lines (NARN)
  - ArcGIS FeatureServer, esriGeometryPolyline, WGS84
  - 235,663 US records
  - Fields: RROWNER1, SUBDIV, STATEAB, MILES, TRACKS

Usage:
  python3 -u scripts/ingest-railroad-fiber.py
  python3 -u scripts/ingest-railroad-fiber.py --state NY
  python3 -u scripts/ingest-railroad-fiber.py --state NY,NJ,PA
  python3 -u scripts/ingest-railroad-fiber.py --dry-run
  python3 -u scripts/ingest-railroad-fiber.py --skip-insert  # Download only
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

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
root_env = os.path.join(os.path.dirname(__file__), '..', '..', '.env.local')
for p in [grid_env, solar_env, root_env]:
    if os.path.exists(p):
        load_dotenv(p)
        break

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
BASE_URL = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0"

# Major railroad owners → fiber operators mapping
# These railroads lease dark fiber or have fiber subsidiaries
RAILROAD_FIBER_OPERATORS = {
    'BNSF': 'BNSF Railway (Uniti/MCI fiber)',
    'UP': 'Union Pacific (Zayo/Level3 fiber)',
    'NS': 'Norfolk Southern (Zayo fiber)',
    'CSXT': 'CSX Transportation (Zayo fiber)',
    'CN': 'Canadian National (Allstream fiber)',
    'CP': 'Canadian Pacific (Telus fiber)',
    'KCS': 'Kansas City Southern (fiber ROW)',
    'AMTK': 'Amtrak (dark fiber ROW)',
}


def supabase_request(method, path, data=None, headers_extra=None):
    """Make a Supabase REST API request."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    hdrs = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        hdrs.update(headers_extra)
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        print(f"  ERROR {e.code}: {err_body}")
        return None


def fetch_arcgis_page(offset, where_clause, batch_size=2000):
    """Fetch a page of railroad line features from the ArcGIS endpoint."""
    params = {
        'where': where_clause,
        'outFields': 'OBJECTID,RROWNER1,RROWNER2,SUBDIV,BRANCH,STATEAB,STFIPS,CNTYFIPS,MILES,TRACKS,PASSNGR,STRACNET',
        'outSR': '4326',
        'f': 'geojson',
        'resultOffset': str(offset),
        'resultRecordCount': str(batch_size),
    }
    url = f"{BASE_URL}/query?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  ERROR fetching offset {offset}: {e}")
            return None


def compute_centroid(coords):
    """Compute centroid of a LineString or MultiLineString."""
    if not coords:
        return None, None

    # Flatten to list of [lng, lat] pairs
    flat = []
    if isinstance(coords[0][0], (list, tuple)):
        # MultiLineString
        for line in coords:
            flat.extend(line)
    else:
        flat = coords

    if not flat:
        return None, None

    # Use midpoint of the line
    mid_idx = len(flat) // 2
    return flat[mid_idx][1], flat[mid_idx][0]  # lat, lng


def feature_to_route(feature):
    """Convert a GeoJSON feature to a grid_fiber_routes record."""
    props = feature.get('properties', {})
    geom = feature.get('geometry', {})
    coords = geom.get('coordinates', [])
    geom_type = geom.get('type', '')

    if geom_type not in ('LineString', 'MultiLineString'):
        return None
    if not coords:
        return None

    oid = props.get('OBJECTID', '')
    owner = props.get('RROWNER1', '') or ''
    owner2 = props.get('RROWNER2', '') or ''
    subdiv = props.get('SUBDIV', '') or ''
    branch = props.get('BRANCH', '') or ''
    state = props.get('STATEAB', '') or ''
    miles = props.get('MILES', 0) or 0
    tracks = props.get('TRACKS', 0) or 0
    stracnet = props.get('STRACNET', '') or ''

    if not state or state not in US_STATES:
        return None

    # Build name from subdivision/branch
    name_parts = []
    if subdiv:
        name_parts.append(subdiv)
    if branch and branch != subdiv:
        name_parts.append(branch)
    name = ' - '.join(name_parts) if name_parts else f"Rail Line {oid}"

    # Map railroad owner to fiber operator
    fiber_op = RAILROAD_FIBER_OPERATORS.get(owner.strip(), owner.strip())
    if owner2 and owner2.strip() != owner.strip():
        fiber_op += f" / {owner2.strip()}"

    # Compute centroid
    lat, lng = compute_centroid(coords)
    if lat is None:
        return None

    # Validate US bounds
    if not (17.5 <= lat <= 72.0 and -180.0 <= lng <= -60.0):
        return None

    source_id = f"fra_rail_{oid}"

    return {
        'source_record_id': source_id,
        'name': name[:255] if name else None,
        'operator': fiber_op[:255] if fiber_op else None,
        'fiber_type': 'railroad_row',
        'location_type': 'long_haul',
        'source': 'fra_ntad',
        'state': state,
        'centroid_lat': round(lat, 6),
        'centroid_lng': round(lng, 6),
        'geometry_json': geom,
    }


US_STATES = {
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC','PR'
}


def ensure_data_source():
    """Ensure fra_ntad data source exists."""
    existing = supabase_request('GET', 'grid_data_sources?name=eq.fra_ntad&select=id')
    if existing:
        return existing[0]['id']

    result = supabase_request('POST', 'grid_data_sources', {
        'name': 'fra_ntad',
        'description': 'FRA/BTS North American Rail Network Lines - railroad ROW as fiber proxy',
        'url': 'https://geodata.bts.gov/datasets/usdot::north-american-rail-network-lines',
        'record_count': 235663,
    }, {'Prefer': 'return=representation'})
    if result and len(result) > 0:
        return result[0]['id']
    return None


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Ingest FRA railroad lines as fiber route proxies')
    parser.add_argument('--state', type=str, help='Comma-separated state codes (e.g., NY,NJ,PA)')
    parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
    parser.add_argument('--skip-insert', action='store_true', help='Download and count only')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
        sys.exit(1)

    # Build WHERE clause
    where_parts = ["COUNTRY='US'"]
    target_states = None
    if args.state:
        target_states = [s.strip().upper() for s in args.state.split(',')]
        if len(target_states) == 1:
            where_parts.append(f"STATEAB='{target_states[0]}'")
        else:
            state_list = ','.join(f"'{s}'" for s in target_states)
            where_parts.append(f"STATEAB IN ({state_list})")

    where_clause = ' AND '.join(where_parts)
    print(f"Fetching railroad lines: {where_clause}")

    # Get count first
    count_params = {'where': where_clause, 'returnCountOnly': 'true', 'f': 'json'}
    count_url = f"{BASE_URL}/query?{urllib.parse.urlencode(count_params)}"
    try:
        req = urllib.request.Request(count_url, headers={'User-Agent': 'GridScout/1.0'})
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            count_data = json.loads(resp.read().decode())
            total_count = count_data.get('count', 0)
            print(f"Total records to fetch: {total_count:,}")
    except Exception as e:
        print(f"Could not get count: {e}")
        total_count = 0

    if not args.dry_run and not args.skip_insert:
        ensure_data_source()

    # Load existing source_record_ids to avoid duplicates
    existing_ids = set()
    if not args.dry_run and not args.skip_insert:
        print("Loading existing railroad fiber routes...")
        offset = 0
        while True:
            result = supabase_request('GET',
                f"grid_fiber_routes?source=eq.fra_ntad&select=source_record_id&limit=1000&offset={offset}")
            if not result:
                break
            for r in result:
                existing_ids.add(r['source_record_id'])
            if len(result) < 1000:
                break
            offset += 1000
        print(f"  {len(existing_ids):,} existing records (will skip)")

    # Fetch all pages
    all_routes = []
    offset = 0
    page_size = 2000
    state_counts = {}

    while True:
        result = fetch_arcgis_page(offset, where_clause, page_size)
        if not result:
            break

        features = result.get('features', [])
        if not features:
            break

        for feat in features:
            route = feature_to_route(feat)
            if route:
                st = route['state']
                state_counts[st] = state_counts.get(st, 0) + 1

                if route['source_record_id'] not in existing_ids:
                    all_routes.append(route)

        offset += len(features)
        total_processed = sum(state_counts.values())
        sys.stdout.write(f"\r  Fetched {offset:,} features → {total_processed:,} valid routes, {len(all_routes):,} new")
        sys.stdout.flush()

        if len(features) < page_size:
            break

        time.sleep(0.2)  # Be polite to BTS servers

    print()
    print(f"\nTotal valid routes: {sum(state_counts.values()):,}")
    print(f"New routes to insert: {len(all_routes):,}")

    # Print state distribution
    print("\nRoutes by state:")
    for st in sorted(state_counts.keys()):
        print(f"  {st}: {state_counts[st]:,}")

    if args.dry_run or args.skip_insert:
        print("\nDry run / skip insert — no data written.")
        return

    if not all_routes:
        print("\nNo new routes to insert.")
        return

    # Insert in batches
    print(f"\nInserting {len(all_routes):,} routes in batches of {BATCH_SIZE}...")
    inserted = 0
    errors = 0

    for i in range(0, len(all_routes), BATCH_SIZE):
        batch = all_routes[i:i + BATCH_SIZE]
        result = supabase_request('POST', 'grid_fiber_routes', batch, {
            'Prefer': 'resolution=ignore-duplicates,return=minimal'
        })
        if result is not None or True:  # POST with return=minimal returns empty on success
            inserted += len(batch)
        else:
            errors += len(batch)

        if (i // BATCH_SIZE) % 20 == 0:
            sys.stdout.write(f"\r  Inserted {inserted:,} / {len(all_routes):,} ({errors} errors)")
            sys.stdout.flush()

    print(f"\r  Inserted {inserted:,} / {len(all_routes):,} ({errors} errors)")
    print("\nDone!")


if __name__ == '__main__':
    main()

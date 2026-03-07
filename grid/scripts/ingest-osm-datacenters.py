#!/usr/bin/env python3
"""
Ingest US datacenter locations from OpenStreetMap via Overpass API.
Target: grid_datacenters table

OSM tags: man_made=data_centre or building=data_center (US spelling)
Expected: ~1,400+ US datacenter facilities with operator names, coordinates.

Usage:
  python3 -u scripts/ingest-osm-datacenters.py              # Download + ingest
  python3 -u scripts/ingest-osm-datacenters.py --dry-run    # Preview without inserting
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
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm_dc')
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass query for US datacenters
OVERPASS_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  nwr["man_made"="data_centre"](area.us);
  nwr["building"="data_center"](area.us);
  nwr["building"="data_centre"](area.us);
);
out center tags;
"""


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


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', ''):
        return None
    return s[:max_len] if len(s) > max_len else s


def download_osm_datacenters():
    """Download datacenter data from OSM Overpass API."""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache_path = os.path.join(DATA_DIR, 'osm_datacenters.json')

    # Use cached data if less than 7 days old
    if os.path.exists(cache_path):
        age_days = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age_days < 7:
            print(f"  Using cached OSM data ({age_days:.1f} days old)")
            with open(cache_path, 'r') as f:
                return json.load(f)

    print("  Querying Overpass API...")
    data = urllib.parse.urlencode({'data': OVERPASS_QUERY}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data)
    req.add_header('User-Agent', 'GridScout/1.0 (datacenter-research)')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read().decode())
                # Cache the result
                with open(cache_path, 'w') as f:
                    json.dump(result, f)
                return result
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                time.sleep(10 * (attempt + 1))

    return None


# State lookup from coordinates (approximate bounding boxes)
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


def coords_to_state(lat, lng):
    """Simple point-in-bounding-box state lookup."""
    for state, (s, w, n, e) in STATE_BOUNDS.items():
        if s <= lat <= n and w <= lng <= e:
            return state
    return None


def parse_osm_elements(data):
    """Parse Overpass API response into datacenter records."""
    if not data or 'elements' not in data:
        return []

    records = []
    seen_osm_ids = set()

    for elem in data['elements']:
        osm_id = elem.get('id')
        if osm_id in seen_osm_ids:
            continue
        seen_osm_ids.add(osm_id)

        tags = elem.get('tags', {})
        osm_type = elem.get('type', 'node')

        # Get coordinates (use center for ways/relations)
        if osm_type == 'node':
            lat = elem.get('lat')
            lng = elem.get('lon')
        else:
            center = elem.get('center', {})
            lat = center.get('lat')
            lng = center.get('lon')

        if not lat or not lng:
            continue

        # Skip if outside continental US (rough check)
        if lat < 24 or lat > 50 or lng < -125 or lng > -66:
            if lat < 18 or lat > 72:  # Also skip non-Alaska/Hawaii extremes
                continue

        name = safe_str(tags.get('name'))
        operator = safe_str(tags.get('operator'))
        city = safe_str(tags.get('addr:city'))
        state = safe_str(tags.get('addr:state'))

        # Try to determine state from coordinates if not tagged
        if not state:
            state = coords_to_state(lat, lng)

        if not state:
            continue

        # Normalize state
        if state and len(state) > 2:
            state = state[:2].upper()

        dc_type = None
        if operator:
            op_lower = operator.lower()
            if any(h in op_lower for h in ['amazon', 'aws', 'google', 'microsoft', 'azure', 'meta', 'facebook', 'apple', 'oracle']):
                dc_type = 'hyperscale'
            elif any(c in op_lower for c in ['equinix', 'digital realty', 'coresite', 'cyrusone', 'qts', 'switch', 'databank']):
                dc_type = 'colocation'
            else:
                dc_type = 'enterprise'

        source_id = f"osm_{osm_type[0]}{osm_id}"

        records.append({
            'source_record_id': source_id,
            'name': name or (f"{operator} DC" if operator else f"Datacenter {osm_id}"),
            'operator': operator,
            'city': city,
            'state': state,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'capacity_mw': None,
            'sqft': None,
            'dc_type': dc_type,
            'year_built': None,
        })

    return records


def get_existing_ids():
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_datacenters?select=source_record_id&limit=1000&offset={offset}'
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


def main():
    print("=" * 60)
    print("GridScout OSM Datacenter Ingestion")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    print("\nDownloading OSM datacenter data...")
    data = download_osm_datacenters()
    if not data:
        print("ERROR: Could not download OSM data")
        sys.exit(1)

    total_elements = len(data.get('elements', []))
    print(f"  {total_elements} total OSM elements")

    print("\nParsing records...")
    records = parse_osm_elements(data)
    print(f"  {len(records)} US datacenter records parsed")

    # Summary
    states = {}
    operators = {}
    types = {}
    for r in records:
        s = r.get('state', '??')
        states[s] = states.get(s, 0) + 1
        o = r.get('operator') or 'Unknown'
        operators[o] = operators.get(o, 0) + 1
        t = r.get('dc_type') or 'unknown'
        types[t] = types.get(t, 0) + 1

    print(f"\nBy state (top 15):")
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
        print(f"  {s}: {c}")
    print(f"\nBy type:")
    for t, c in sorted(types.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")
    print(f"\nBy operator (top 15):")
    for o, c in sorted(operators.items(), key=lambda x: -x[1])[:15]:
        print(f"  {o}: {c}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert up to {len(records)} datacenter records.")
        return

    # Get or create data source
    ds = supabase_request('GET', 'grid_data_sources?name=eq.osm_datacenters&select=id')
    data_source_id = ds[0]['id'] if ds else None
    if not data_source_id:
        print("\nCreating osm_datacenters data source...")
        result = supabase_request('POST', 'grid_data_sources', [{
            'name': 'osm_datacenters',
            'url': 'https://wiki.openstreetmap.org/wiki/Tag:man_made%3Ddata_centre',
            'description': 'OpenStreetMap datacenter facilities (man_made=data_centre)',
        }], {'Prefer': 'return=representation'})
        if result:
            data_source_id = result[0]['id']

    # Load existing records
    print("\nLoading existing records...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing records in DB")

    # Filter new records
    new_records = []
    for r in records:
        if r['source_record_id'] in existing_ids:
            continue
        if data_source_id:
            r['data_source_id'] = data_source_id
        r['created_at'] = datetime.now(timezone.utc).isoformat()
        new_records.append(r)

    print(f"  {len(new_records)} new records to insert ({len(records) - len(new_records)} already exist)")

    # Insert in batches
    created = 0
    errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_datacenters', batch, {'Prefer': 'return=minimal'})
            created += len(batch)
            if created % 200 == 0:
                print(f"  Inserted {created}...")
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_datacenters', [rec], {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Record error ({rec['source_record_id']}): {e2}")

    # Update data source count
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': len(existing_ids) + created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"OSM Datacenter Ingestion Complete")
    print(f"  Created: {created}")
    print(f"  Skipped (existing): {len(records) - len(new_records)}")
    print(f"  Errors: {errors}")
    print(f"  Total in DB: {len(existing_ids) + created}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

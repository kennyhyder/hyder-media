#!/usr/bin/env python3
"""
Ingest EPA ACRES brownfield/contaminated sites into grid_dc_sites.

Source: EPA ACRES ArcGIS REST API
URL: https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/
     ACRES_Brownfield_Assessments/FeatureServer/0/query

Paginates through all records (resultRecordCount=1000, resultOffset).
Filters to US states with valid lat/lng.
Inserts into grid_dc_sites with site_type='industrial'.

Usage:
    python3 -u scripts/ingest-epa-acres.py
    python3 -u scripts/ingest-epa-acres.py --dry-run
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

ARCGIS_URL = (
    'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/'
    'All%20ACRES%20Properties%208_30_2021/FeatureServer/0/query'
)

US_STATES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
    'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
    'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
    'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
    'WV', 'WI', 'WY',
}

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


def fetch_arcgis_page(offset=0, page_size=1000):
    """Fetch a page of results from EPA ACRES ArcGIS."""
    params = urllib.parse.urlencode({
        'where': '1=1',
        'outFields': '*',
        'f': 'json',
        'resultRecordCount': page_size,
        'resultOffset': offset,
    })
    url = f"{ARCGIS_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < 2:
                print(f"  Retry {attempt + 1}: {e}")
                time.sleep(2 ** attempt)
                continue
            raise


def safe_float(val):
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN check
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def get_or_create_data_source():
    ds = supabase_request('GET', 'grid_data_sources?name=eq.epa_acres&select=id')
    if ds:
        return ds[0]['id']
    supabase_request('POST', 'grid_data_sources', [{
        'name': 'epa_acres',
        'description': 'EPA ACRES Brownfield Assessment sites',
        'url': 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/ACRES_Brownfield_Assessments/FeatureServer',
    }], {'Prefer': 'return=representation'})
    ds = supabase_request('GET', 'grid_data_sources?name=eq.epa_acres&select=id')
    return ds[0]['id'] if ds else None


def main():
    print("=" * 60)
    print("GridScout: Ingest EPA ACRES Brownfield Sites")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Fetch all records from ArcGIS
    print("\n[Step 1] Fetching EPA ACRES records...")
    all_features = []
    offset = 0
    page_size = 1000

    while True:
        data = fetch_arcgis_page(offset, page_size)
        features = data.get('features', [])
        if not features:
            break
        all_features.extend(features)
        offset += len(features)
        print(f"  Fetched {offset} records...")
        if not data.get('exceededTransferLimit', False) and len(features) < page_size:
            break
        time.sleep(0.5)

    print(f"  Total fetched: {len(all_features)}")

    # Step 2: Transform and filter
    print("\n[Step 2] Transforming records...")
    data_source_id = None if dry_run else get_or_create_data_source()

    candidates = []
    skipped_no_coords = 0
    skipped_no_state = 0
    seen_ids = set()

    for feat in all_features:
        attrs = feat.get('attributes', {})

        lat = safe_float(attrs.get('LATITUDE_MEASURE'))
        lng = safe_float(attrs.get('LONGITUDE_MEASURE'))

        # Fall back to geometry if no explicit lat/lng
        # Note: geometry is Web Mercator (EPSG:3857), not WGS84
        if (lat is None or lng is None) and feat.get('geometry'):
            # Skip Web Mercator geometry — not directly usable as lat/lng
            pass

        if lat is None or lng is None or abs(lat) > 90 or abs(lng) > 180:
            skipped_no_coords += 1
            continue

        state = safe_str(attrs.get('LABEL_STATE'))
        if not state or state not in US_STATES:
            skipped_no_state += 1
            continue

        # Build unique ID from PROPERTY_ID or ObjectId
        prop_id = safe_str(attrs.get('PROPERTY_ID')) or safe_str(attrs.get('ObjectId'))
        if not prop_id:
            continue
        source_id = f"epa_acres_{prop_id}"

        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)

        name = safe_str(attrs.get('PROPERTY_NAME')) or 'EPA Brownfield Site'
        address_parts = []
        street = safe_str(attrs.get('ADDRESS1'))
        city = safe_str(attrs.get('CITY'))
        if street:
            address_parts.append(street)
        if city:
            address_parts.append(city)
        if state:
            address_parts.append(state)
        zip_code = safe_str(attrs.get('ZIP_CODE'))
        if zip_code:
            address_parts.append(zip_code)
        address = ', '.join(address_parts) if address_parts else None

        candidates.append({
            'source_record_id': source_id,
            'name': name[:200] if name else None,
            'site_type': 'industrial',
            'state': state,
            'county': safe_str(attrs.get('COUNTY')),
            'address': address[:300] if address else None,
            'latitude': lat,
            'longitude': lng,
            'iso_region': STATE_ISO.get(state),
            'data_source_id': data_source_id,
        })

    print(f"  Valid candidates: {len(candidates)}")
    print(f"  Skipped (no coords): {skipped_no_coords}")
    print(f"  Skipped (no/bad state): {skipped_no_state}")

    # Stats
    states = {}
    for c in candidates:
        st = c.get('state', 'UNK')
        states[st] = states.get(st, 0) + 1
    top_states = dict(sorted(states.items(), key=lambda x: -x[1])[:10])
    print(f"  Top states: {top_states}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(candidates)} EPA ACRES sites")
        for c in candidates[:5]:
            print(f"  {c['source_record_id']} {c['state']} {c['name'][:50]}")
        return

    # Step 3: Insert into grid_dc_sites
    print(f"\n[Step 3] Inserting {len(candidates)} sites...")
    created = 0
    errors = 0

    # Ensure all records have same keys
    all_keys = set()
    for rec in candidates:
        all_keys.update(rec.keys())

    for i in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[i:i + BATCH_SIZE]
        normalized = [{k: rec.get(k) for k in all_keys} for rec in batch]

        try:
            supabase_request(
                'POST', 'grid_dc_sites', normalized,
                {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
            )
            created += len(batch)
        except Exception:
            for rec in normalized:
                try:
                    supabase_request(
                        'POST', 'grid_dc_sites', [rec],
                        {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
                    )
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Error: {e2}")

        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  Progress: {min(i + BATCH_SIZE, len(candidates))}/{len(candidates)} ({created} ok, {errors} err)")

    print(f"\n  Created: {created}, Errors: {errors}")

    # Update data source
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print("\nDone!")


if __name__ == '__main__':
    main()

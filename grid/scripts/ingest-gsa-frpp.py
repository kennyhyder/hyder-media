#!/usr/bin/env python3
"""
Ingest GSA Federal Real Property Profile (FRPP) excess/underutilized properties.

Source: data.gov FRPP Public Dataset (FY 2024)
URL: https://catalog.data.gov/dataset/fy-2024-federal-real-property-profile-frpp-public-dataset

Downloads the Excel file, filters to excess/underutilized properties with
sufficient size (>=5 acres OR >=50,000 sq ft), and inserts into grid_dc_sites.

Usage:
    python3 -u scripts/ingest-gsa-frpp.py
    python3 -u scripts/ingest-gsa-frpp.py --dry-run
    python3 -u scripts/ingest-gsa-frpp.py --skip-download
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
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'gsa_frpp')

# Known download URL for FRPP (may need updating annually)
FRPP_URL = 'https://inventory.data.gov/dataset/5752ee7f-9e8b-467a-aa5a-274b4bd1bc29/resource/1a94a302-b3c9-433d-ac97-43db73fa6d04/download/frpp_public_dataset_fy24_07022025.xlsx'

# Utilization statuses to include
TARGET_UTILIZATION = {'Excess', 'Not Utilized', 'Underutilized', 'Unutilized'}

# Property use types to EXCLUDE (residential)
EXCLUDE_USES = {
    'Family Housing', 'Unaccompanied Personnel Housing', 'Dormitory',
    'Residential', 'Housing',
}

MIN_ACRES = 5
MIN_SQFT = 50000

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


def safe_float(val):
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def find_col(headers, candidates):
    """Find column index by trying multiple header name variants."""
    for name in candidates:
        nl = name.lower().strip()
        for i, h in enumerate(headers):
            if h and h.lower().strip() == nl:
                return i
    return None


def download_frpp():
    """Download FRPP Excel file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    filepath = os.path.join(DATA_DIR, 'frpp_public_dataset.xlsx')

    if os.path.exists(filepath):
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  Using cached file ({size_mb:.1f} MB)")
        return filepath

    print(f"  Downloading from {FRPP_URL}...")
    req = urllib.request.Request(FRPP_URL, headers={'User-Agent': 'GridScout/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            with open(filepath, 'wb') as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  Downloaded {size_mb:.1f} MB")
    except Exception as e:
        print(f"  Download failed: {e}")
        print(f"  Please manually download from: https://catalog.data.gov/dataset/fy-2024-federal-real-property-profile-frpp-public-dataset")
        print(f"  Save to: {filepath}")
        sys.exit(1)

    return filepath


def get_or_create_data_source():
    ds = supabase_request('GET', 'grid_data_sources?name=eq.gsa_frpp&select=id')
    if ds:
        return ds[0]['id']
    supabase_request('POST', 'grid_data_sources', [{
        'name': 'gsa_frpp',
        'description': 'GSA Federal Real Property Profile - excess/underutilized federal properties',
        'url': 'https://catalog.data.gov/dataset/fy-2024-federal-real-property-profile-frpp-public-dataset',
    }], {'Prefer': 'return=representation'})
    ds = supabase_request('GET', 'grid_data_sources?name=eq.gsa_frpp&select=id')
    return ds[0]['id'] if ds else None


def main():
    print("=" * 60)
    print("GridScout: Ingest GSA Federal Real Property (FRPP)")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    try:
        import openpyxl
    except ImportError:
        print("ERROR: openpyxl required. Install: pip3 install openpyxl")
        sys.exit(1)

    # Step 1: Download FRPP data
    print("\n[Step 1] Getting FRPP data...")
    if skip_download:
        filepath = os.path.join(DATA_DIR, 'frpp_public_dataset.xlsx')
        if not os.path.exists(filepath):
            print(f"  File not found: {filepath}")
            sys.exit(1)
    else:
        filepath = download_frpp()

    # Step 2: Parse Excel
    print("\n[Step 2] Parsing Excel file...")
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active

    rows = ws.iter_rows(values_only=True)
    headers = [str(h).strip() if h else '' for h in next(rows)]
    print(f"  Columns: {len(headers)}")

    # Find column indices
    col_uid = find_col(headers, ['Real Property Unique Identifier', 'RP Unique Identifier', 'Unique Identifier'])
    col_lat = find_col(headers, ['Latitude'])
    col_lng = find_col(headers, ['Longitude'])
    col_sqft = find_col(headers, ['Square Feet (Bldg)', 'Square Feet', 'Sq Feet'])
    col_acres = find_col(headers, ['Acres'])
    col_use = find_col(headers, ['Real Property Use', 'Property Use'])
    col_util = find_col(headers, ['Utilization'])
    col_cond = find_col(headers, ['Condition'])
    col_agency = find_col(headers, ['Agency Bureau', 'Bureau'])
    col_state = find_col(headers, ['State', 'State Name', 'State Territory'])
    col_city = find_col(headers, ['City', 'City Name'])
    col_zip = find_col(headers, ['ZIP', 'ZIP Code', 'Zip Code'])
    col_name = find_col(headers, ['Installation Name', 'Property Name', 'Facility Name'])
    col_addr = find_col(headers, ['Street Address', 'Address'])

    if col_lat is None or col_lng is None:
        print(f"  ERROR: Cannot find Latitude/Longitude columns")
        print(f"  Headers: {headers[:20]}")
        sys.exit(1)

    print(f"  Key columns: lat={col_lat}, lng={col_lng}, util={col_util}, use={col_use}, acres={col_acres}, sqft={col_sqft}")

    # Step 3: Transform and filter
    print("\n[Step 3] Transforming records...")
    data_source_id = None if dry_run else get_or_create_data_source()

    candidates = []
    total_rows = 0
    skipped_util = 0
    skipped_use = 0
    skipped_size = 0
    skipped_coords = 0
    skipped_state = 0
    seen_ids = set()

    for row in rows:
        total_rows += 1

        # Filter by utilization
        util = safe_str(row[col_util]) if col_util is not None else None
        if util and util not in TARGET_UTILIZATION:
            skipped_util += 1
            continue

        # Filter by use type (exclude residential)
        use = safe_str(row[col_use]) if col_use is not None else None
        if use:
            excluded = False
            for exc in EXCLUDE_USES:
                if exc.lower() in use.lower():
                    excluded = True
                    break
            if excluded:
                skipped_use += 1
                continue

        # Filter by size
        acres = safe_float(row[col_acres]) if col_acres is not None else None
        sqft = safe_float(row[col_sqft]) if col_sqft is not None else None
        if (acres is None or acres < MIN_ACRES) and (sqft is None or sqft < MIN_SQFT):
            skipped_size += 1
            continue

        # Filter by coordinates
        lat = safe_float(row[col_lat])
        lng = safe_float(row[col_lng])
        if lat is None or lng is None or abs(lat) > 90 or abs(lng) > 180:
            skipped_coords += 1
            continue
        if lat == 0 and lng == 0:
            skipped_coords += 1
            continue

        # Filter by state
        state = safe_str(row[col_state]) if col_state is not None else None
        # Handle full state names → abbreviations
        if state and len(state) > 2:
            # Try to find abbreviation from state name
            state_map = {
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
            state = state_map.get(state, state[:2].upper())

        if not state or state not in US_STATES:
            skipped_state += 1
            continue

        # Build unique ID
        uid = safe_str(row[col_uid]) if col_uid is not None else None
        if not uid:
            uid = f"{lat}_{lng}_{total_rows}"
        source_id = f"gsa_frpp_{uid}"
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)

        name = safe_str(row[col_name]) if col_name is not None else None
        if not name:
            name = f"Federal Property ({use or 'General'})"

        agency = safe_str(row[col_agency]) if col_agency is not None else None
        condition = safe_str(row[col_cond]) if col_cond is not None else None

        # Build address
        addr = safe_str(row[col_addr]) if col_addr is not None else None
        city = safe_str(row[col_city]) if col_city is not None else None
        zip_code = safe_str(row[col_zip]) if col_zip is not None else None
        address_parts = [p for p in [addr, city, state, zip_code] if p]
        address = ', '.join(address_parts) if address_parts else None

        # Build former_use from property use + agency
        former_use_parts = [p for p in [use, f"({agency})" if agency else None] if p]
        former_use = ' '.join(former_use_parts) if former_use_parts else None

        candidates.append({
            'source_record_id': source_id,
            'name': name[:200] if name else None,
            'site_type': 'federal_excess',
            'state': state,
            'county': None,
            'address': address[:300] if address else None,
            'latitude': lat,
            'longitude': lng,
            'acreage': acres,
            'former_use': former_use[:300] if former_use else None,
            'cleanup_status': f"Condition: {condition}" if condition else None,
            'iso_region': STATE_ISO.get(state),
            'data_source_id': data_source_id,
        })

    wb.close()

    print(f"  Total rows: {total_rows}")
    print(f"  Valid candidates: {len(candidates)}")
    print(f"  Skipped (utilization): {skipped_util}")
    print(f"  Skipped (use type): {skipped_use}")
    print(f"  Skipped (too small): {skipped_size}")
    print(f"  Skipped (no coords): {skipped_coords}")
    print(f"  Skipped (no/bad state): {skipped_state}")

    states = {}
    for c in candidates:
        st = c.get('state', 'UNK')
        states[st] = states.get(st, 0) + 1
    top_states = dict(sorted(states.items(), key=lambda x: -x[1])[:10])
    print(f"  Top states: {top_states}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(candidates)} GSA FRPP sites")
        for c in candidates[:5]:
            print(f"  {c['source_record_id']} {c['state']} {c['name'][:50]} ({c.get('acreage')} acres)")
        return

    # Step 4: Insert
    print(f"\n[Step 4] Inserting {len(candidates)} sites...")
    created = 0
    errors = 0

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

    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print("\nDone!")


if __name__ == '__main__':
    main()

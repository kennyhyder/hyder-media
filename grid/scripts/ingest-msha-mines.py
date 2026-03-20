#!/usr/bin/env python3
"""
Ingest MSHA abandoned/closed surface mines into grid_dc_sites.

Source: MSHA Mines Database (pipe-delimited text in ZIP)
URL: https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA/MinesPub.zip

Filters to:
- Surface mines only (Underground not suitable for DC)
- Abandoned, NonProducing, or Temporarily Idle status
- Valid US lat/lng coordinates

Usage:
    python3 -u scripts/ingest-msha-mines.py
    python3 -u scripts/ingest-msha-mines.py --dry-run
    python3 -u scripts/ingest-msha-mines.py --skip-download
"""

import os
import sys
import json
import time
import zipfile
import io
import csv
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'msha')
MSHA_URL = 'https://arlweb.msha.gov/opengovernmentdata/DataSets/Mines.zip'

# Mine statuses indicating closed/abandoned
TARGET_STATUS = {'Abandoned', 'NonProducing', 'Temporarily Idled'}

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
        v = str(val).strip()
        if not v:
            return None
        f = float(v)
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


def download_msha():
    """Download and extract MSHA mines ZIP."""
    os.makedirs(DATA_DIR, exist_ok=True)
    zip_path = os.path.join(DATA_DIR, 'Mines.zip')

    if not os.path.exists(zip_path):
        print(f"  Downloading from {MSHA_URL}...")
        # Akamai CDN requires full browser headers to avoid 403
        import subprocess
        result = subprocess.run([
            'curl', '-L', '-o', zip_path, MSHA_URL,
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '-H', 'Accept-Language: en-US,en;q=0.9',
            '-H', 'Accept-Encoding: gzip, deflate, br',
            '-H', 'Sec-Fetch-Dest: document',
            '-H', 'Sec-Fetch-Mode: navigate',
            '-H', 'Sec-Fetch-Site: none',
            '--compressed',
            '--max-time', '120',
        ], capture_output=True, text=True)
        if result.returncode != 0 or not os.path.exists(zip_path):
            print(f"  ERROR: Download failed (exit {result.returncode})")
            if result.stderr:
                print(f"  {result.stderr[:200]}")
            sys.exit(1)
        size_mb = os.path.getsize(zip_path) / (1024 * 1024)
        if size_mb < 1:
            os.remove(zip_path)
            print(f"  ERROR: Downloaded file too small ({size_mb:.2f} MB) - likely blocked by CDN")
            sys.exit(1)
        print(f"  Downloaded {size_mb:.1f} MB")
    else:
        size_mb = os.path.getsize(zip_path) / (1024 * 1024)
        print(f"  Using cached ZIP ({size_mb:.1f} MB)")

    return zip_path


def get_or_create_data_source():
    ds = supabase_request('GET', 'grid_data_sources?name=eq.msha_mines&select=id')
    if ds:
        return ds[0]['id']
    supabase_request('POST', 'grid_data_sources', [{
        'name': 'msha_mines',
        'description': 'MSHA abandoned/idle surface mines database',
        'url': 'https://arlweb.msha.gov/opengovernmentdata/DataSets/Mines.zip',
    }], {'Prefer': 'return=representation'})
    ds = supabase_request('GET', 'grid_data_sources?name=eq.msha_mines&select=id')
    return ds[0]['id'] if ds else None


def main():
    print("=" * 60)
    print("GridScout: Ingest MSHA Abandoned/Idle Surface Mines")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    # Step 1: Download data
    print("\n[Step 1] Getting MSHA data...")
    if skip_download:
        zip_path = os.path.join(DATA_DIR, 'Mines.zip')
        if not os.path.exists(zip_path):
            print(f"  File not found: {zip_path}")
            sys.exit(1)
    else:
        zip_path = download_msha()

    # Step 2: Parse pipe-delimited file from ZIP
    print("\n[Step 2] Parsing mines data...")
    with zipfile.ZipFile(zip_path) as zf:
        # Find the text file inside
        txt_files = [n for n in zf.namelist() if n.lower().endswith('.txt')]
        if not txt_files:
            print(f"  ERROR: No .txt file found in ZIP. Contents: {zf.namelist()}")
            sys.exit(1)
        txt_name = txt_files[0]
        print(f"  Reading {txt_name}...")

        with zf.open(txt_name) as f:
            content = io.TextIOWrapper(f, encoding='latin-1')
            reader = csv.DictReader(content, delimiter='|')

            # Find field names
            fields = reader.fieldnames
            if fields:
                fields = [f.strip() for f in fields]
                reader.fieldnames = fields
            print(f"  Columns: {len(fields)}")

            data_source_id = None if dry_run else get_or_create_data_source()

            candidates = []
            total_rows = 0
            skipped_status = 0
            skipped_type = 0
            skipped_coords = 0
            skipped_state = 0
            seen_ids = set()

            for row in reader:
                total_rows += 1

                # Filter by status
                status = safe_str(row.get('CURRENT_MINE_STATUS'))
                if status not in TARGET_STATUS:
                    skipped_status += 1
                    continue

                # Filter by mine type (Surface only)
                mine_type = safe_str(row.get('MINE_TYPE'))
                if mine_type and mine_type.strip().lower() not in ('surface', 'facility'):
                    skipped_type += 1
                    continue

                # Filter by coordinates
                lat = safe_float(row.get('LATITUDE'))
                lng = safe_float(row.get('LONGITUDE'))
                if lat is None or lng is None or abs(lat) > 90 or abs(lng) > 180:
                    skipped_coords += 1
                    continue
                if lat == 0 and lng == 0:
                    skipped_coords += 1
                    continue

                # Filter by state
                state = safe_str(row.get('STATE'))
                if not state or state not in US_STATES:
                    skipped_state += 1
                    continue

                # Build unique ID
                mine_id = safe_str(row.get('MINE_ID'))
                if not mine_id:
                    continue
                source_id = f"msha_{mine_id}"
                if source_id in seen_ids:
                    continue
                seen_ids.add(source_id)

                name = safe_str(row.get('MINE_NAME')) or 'Mine Site'
                county = safe_str(row.get('FIPS_CNTY_NM')) or safe_str(row.get('COUNTY'))
                commodity = safe_str(row.get('PRIMARY_CANVASS'))
                operator = safe_str(row.get('CURRENT_OPERATOR_NAME'))

                # Build former_use
                former_use_parts = []
                if commodity:
                    former_use_parts.append(f"Mining: {commodity}")
                if mine_type:
                    former_use_parts.append(f"Type: {mine_type}")
                if status:
                    former_use_parts.append(f"Status: {status}")
                former_use = '; '.join(former_use_parts) if former_use_parts else None

                candidates.append({
                    'source_record_id': source_id,
                    'name': name[:200] if name else None,
                    'site_type': 'mine',
                    'state': state,
                    'county': county,
                    'latitude': lat,
                    'longitude': lng,
                    'former_use': former_use[:300] if former_use else None,
                    'cleanup_status': status,
                    'iso_region': STATE_ISO.get(state),
                    'data_source_id': data_source_id,
                })

    print(f"  Total rows: {total_rows}")
    print(f"  Valid candidates: {len(candidates)}")
    print(f"  Skipped (status): {skipped_status}")
    print(f"  Skipped (mine type): {skipped_type}")
    print(f"  Skipped (no coords): {skipped_coords}")
    print(f"  Skipped (no/bad state): {skipped_state}")

    states = {}
    for c in candidates:
        st = c.get('state', 'UNK')
        states[st] = states.get(st, 0) + 1
    top_states = dict(sorted(states.items(), key=lambda x: -x[1])[:10])
    print(f"  Top states: {top_states}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(candidates)} MSHA mine sites")
        for c in candidates[:5]:
            print(f"  {c['source_record_id']} {c['state']} {c['name'][:50]}")
        return

    # Step 3: Insert
    print(f"\n[Step 3] Inserting {len(candidates)} sites...")
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

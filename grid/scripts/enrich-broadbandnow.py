#!/usr/bin/env python3
"""
Enhance fiber/broadband data using BroadbandNow open data (CC BY 4.0).

Source: BroadbandNow Open Data GitHub repository
URL: https://github.com/BroadbandNow/Open-Data

Downloads zip-level broadband provider data and enhances grid_dc_sites
with fiber provider counts and max available speeds.

BroadbandNow publishes CSV files with broadband availability by zip code.
The exact file format may vary — this script handles the known formats:
  - broadband_data.csv / broadband_data_zipcode.csv
  - Columns typically include: zip, provider_count, max_download, max_upload,
    fiber_providers, cable_providers, dsl_providers, etc.

If the repository structure changes, update BROADBAND_CSV_URL below.

Usage:
    python3 -u scripts/enrich-broadbandnow.py
    python3 -u scripts/enrich-broadbandnow.py --dry-run
    python3 -u scripts/enrich-broadbandnow.py --skip-download
"""

import os
import sys
import json
import csv
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
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'broadbandnow')

# BroadbandNow raw CSV URLs (try in order)
BROADBAND_CSV_URLS = [
    'https://raw.githubusercontent.com/BroadbandNow/Open-Data/master/broadband_data.csv',
    'https://raw.githubusercontent.com/BroadbandNow/Open-Data/master/broadband_data_zipcode.csv',
    'https://raw.githubusercontent.com/BroadbandNow/Open-Data/master/data/broadband_data.csv',
]


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


def safe_float(val):
    if val is None:
        return None
    try:
        v = str(val).strip().replace(',', '')
        if not v:
            return None
        f = float(v)
        if f != f:
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_int(val):
    f = safe_float(val)
    if f is None:
        return None
    return int(f)


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def download_broadband_csv():
    """Download BroadbandNow CSV data."""
    os.makedirs(DATA_DIR, exist_ok=True)
    filepath = os.path.join(DATA_DIR, 'broadband_data.csv')

    if os.path.exists(filepath):
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  Using cached file ({size_mb:.1f} MB)")
        return filepath

    for url in BROADBAND_CSV_URLS:
        print(f"  Trying: {url.split('/')[-1]}...")
        req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(filepath, 'wb') as f:
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            if size_mb > 0.01:
                print(f"  Downloaded {size_mb:.1f} MB")
                return filepath
            else:
                os.remove(filepath)
                print(f"  File too small, trying next URL...")
        except Exception as e:
            print(f"  Failed: {e}")
            if os.path.exists(filepath):
                os.remove(filepath)
            continue

    print("\n  ERROR: Could not download BroadbandNow data from any URL")
    print("  Manual download: https://github.com/BroadbandNow/Open-Data")
    print(f"  Save CSV to: {filepath}")
    sys.exit(1)


def find_col_idx(headers, candidates):
    """Find column index by trying multiple header name variants (case-insensitive)."""
    for name in candidates:
        nl = name.lower().strip()
        for i, h in enumerate(headers):
            if h and h.lower().strip() == nl:
                return i
    return None


def parse_broadband_csv(filepath):
    """Parse BroadbandNow CSV into zip → broadband data mapping.

    Returns dict: zip_code → {fiber_providers, total_providers, max_down_mbps, max_up_mbps}
    """
    zip_data = {}

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        headers = next(reader)
        headers = [h.strip() for h in headers]

        print(f"  Columns ({len(headers)}): {headers[:15]}")

        # Find column indices — try many variants
        col_zip = find_col_idx(headers, ['zip', 'zip_code', 'zipcode', 'postal_code', 'ZIP'])
        col_fiber = find_col_idx(headers, [
            'fiber_providers', 'fiber_count', 'num_fiber_providers',
            'fiber_provider_count', 'providers_fiber',
        ])
        col_total = find_col_idx(headers, [
            'total_providers', 'provider_count', 'num_providers',
            'providers', 'broadband_providers',
        ])
        col_max_down = find_col_idx(headers, [
            'max_download', 'max_down_mbps', 'max_dl_speed',
            'max_advertised_download', 'download_speed',
        ])
        col_max_up = find_col_idx(headers, [
            'max_upload', 'max_up_mbps', 'max_ul_speed',
            'max_advertised_upload', 'upload_speed',
        ])

        if col_zip is None:
            print(f"  ERROR: Cannot find zip code column in headers: {headers}")
            return {}

        print(f"  Column indices: zip={col_zip}, fiber={col_fiber}, total={col_total}, "
              f"max_down={col_max_down}, max_up={col_max_up}")

        for row in reader:
            if len(row) <= col_zip:
                continue
            zip_code = safe_str(row[col_zip])
            if not zip_code or len(zip_code) < 5:
                continue
            zip_code = zip_code[:5].zfill(5)

            entry = {}
            if col_fiber is not None and len(row) > col_fiber:
                entry['fiber_providers'] = safe_int(row[col_fiber])
            if col_total is not None and len(row) > col_total:
                entry['total_providers'] = safe_int(row[col_total])
            if col_max_down is not None and len(row) > col_max_down:
                entry['max_down_mbps'] = safe_float(row[col_max_down])
            if col_max_up is not None and len(row) > col_max_up:
                entry['max_up_mbps'] = safe_float(row[col_max_up])

            if entry:
                zip_data[zip_code] = entry

    return zip_data


def main():
    print("=" * 60)
    print("GridScout: Enrich Fiber Data (BroadbandNow)")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    # Step 1: Get broadband data
    print("\n[Step 1] Getting BroadbandNow data...")
    if skip_download:
        filepath = os.path.join(DATA_DIR, 'broadband_data.csv')
        if not os.path.exists(filepath):
            print(f"  File not found: {filepath}")
            sys.exit(1)
    else:
        filepath = download_broadband_csv()

    # Step 2: Parse CSV
    print("\n[Step 2] Parsing broadband CSV...")
    zip_data = parse_broadband_csv(filepath)
    print(f"  {len(zip_data)} zip codes with broadband data")

    if not zip_data:
        print("\n  No broadband data parsed. The CSV format may have changed.")
        print("  Check https://github.com/BroadbandNow/Open-Data for current format.")
        return

    # Show sample
    sample_zips = list(zip_data.items())[:3]
    for z, d in sample_zips:
        print(f"  Sample: {z} → {d}")

    # Step 3: Load DC sites with zip codes
    print("\n[Step 3] Loading DC sites...")
    # Load sites that have a zip code (extracted from address or fips_code)
    # We need to match on zip — sites may have zip in address field
    sites = load_paginated(
        'grid_dc_sites',
        'id,address,fips_code,state',
        '&address=not.is.null'
    )
    print(f"  {len(sites)} sites with addresses loaded")

    # Step 4: Match sites to zip data
    print("\n[Step 4] Matching sites to broadband data...")
    patches = []

    for site in sites:
        # Extract zip from address (last 5 digits if present)
        address = site.get('address', '') or ''
        zip_code = None

        # Try to find 5-digit zip in address
        import re
        zip_match = re.search(r'\b(\d{5})\b', address)
        if zip_match:
            zip_code = zip_match.group(1)

        if not zip_code:
            continue

        bbn = zip_data.get(zip_code)
        if not bbn:
            continue

        patch = {'id': site['id']}
        if bbn.get('fiber_providers') is not None:
            patch['fcc_fiber_providers'] = bbn['fiber_providers']
        if bbn.get('max_down_mbps') is not None:
            patch['fcc_max_down_mbps'] = bbn['max_down_mbps']
        if bbn.get('max_up_mbps') is not None:
            patch['fcc_max_up_mbps'] = bbn['max_up_mbps']

        if len(patch) > 1:  # Has at least one data field beyond 'id'
            patches.append(patch)

    print(f"  Matched: {len(patches)} sites")

    if dry_run:
        print(f"\n[DRY RUN] Would update {len(patches)} DC sites with broadband data")
        for p in patches[:5]:
            print(f"  {p['id'][:12]}... fiber={p.get('fcc_fiber_providers')} "
                  f"down={p.get('fcc_max_down_mbps')} up={p.get('fcc_max_up_mbps')}")
        return

    # Step 5: Update sites
    print(f"\n[Step 5] Updating {len(patches)} sites...")
    updated = 0
    errors = 0

    for patch in patches:
        site_id = patch.pop('id')
        try:
            supabase_request(
                'PATCH',
                f'grid_dc_sites?id=eq.{site_id}',
                patch
            )
            updated += 1
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error: {e}")

        if updated % 500 == 0 and updated > 0:
            print(f"  Progress: {updated}/{len(patches)} ({errors} err)")

    print(f"\n  Updated: {updated}, Errors: {errors}")
    print("\nDone!")


if __name__ == '__main__':
    main()

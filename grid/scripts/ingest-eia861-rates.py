#!/usr/bin/env python3
"""
Ingest EIA-861 utility electricity rates by zip code, aggregate to county level.

Sources:
  - OpenEI: iou_zipcodes_2024.csv + non_iou_zipcodes_2024.csv
    URL: https://data.openei.org/submissions/8563
  - Census ZCTA-to-County relationship file (zip -> FIPS mapping)
    URL: https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt

Target: grid_county_data table (patches avg_industrial_rate_cents_kwh, avg_commercial_rate_cents_kwh)

Usage:
  python3 -u scripts/ingest-eia861-rates.py
  python3 -u scripts/ingest-eia861-rates.py --dry-run
  python3 -u scripts/ingest-eia861-rates.py --skip-download
"""

import os
import sys
import json
import csv
import time
import math
import urllib.request
import urllib.error
import urllib.parse
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv

# Try grid .env.local first, fall back to solar
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
load_dotenv(env_path)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'eia861')
BATCH_SIZE = 50

OPENEI_BASE = 'https://data.openei.org/files/8563'
IOU_FILE = 'iou_zipcodes_2024.csv'
NON_IOU_FILE = 'non_iou_zipcodes_2024.csv'

ZCTA_COUNTY_URL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt'
ZCTA_COUNTY_FILE = 'zcta_county_crosswalk.txt'


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
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def safe_float(val):
    """Parse a float value, returning None for missing/invalid data."""
    if val is None or val == '' or val == ' ':
        return None
    try:
        v = val.strip().replace(',', '')
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (ValueError, TypeError):
        return None


def download_file(url, local_path):
    """Download a file if not already cached."""
    if os.path.exists(local_path):
        size_mb = os.path.getsize(local_path) / (1024 * 1024)
        print(f"  Using cached file ({size_mb:.1f} MB): {os.path.basename(local_path)}")
        return

    print(f"  Downloading: {url}")
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0')

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        print(f"  ERROR: HTTP {e.code} downloading {url}")
        sys.exit(1)

    with open(local_path, 'wb') as f:
        f.write(data)
    size_mb = len(data) / (1024 * 1024)
    print(f"  Downloaded {size_mb:.1f} MB")


def build_zip_to_county_map():
    """
    Build zip -> county FIPS mapping from Census ZCTA-to-County relationship file.

    The file is pipe-delimited with 18 columns. Key columns:
      - GEOID_ZCTA5_20 (index 1): 5-digit ZCTA (zip) code
      - GEOID_COUNTY_20 (index 9): 5-digit county FIPS code
      - AREALAND_PART (index 16): land area of the intersection

    A zip may span multiple counties. We pick the county with the largest
    land area overlap (AREALAND_PART).
    """
    crosswalk_path = os.path.join(DATA_DIR, ZCTA_COUNTY_FILE)
    download_file(ZCTA_COUNTY_URL, crosswalk_path)

    print("  Parsing ZCTA-to-County crosswalk...")
    # Track all county overlaps per zip, keep the one with largest area
    zip_county_areas = {}  # zip -> {fips: area}

    line_count = 0
    with open(crosswalk_path, 'r', encoding='utf-8-sig') as f:
        for line in f:
            line_count += 1
            if line_count == 1:
                # Skip header
                continue

            parts = line.strip().split('|')
            if len(parts) < 17:
                continue

            zcta = parts[1].strip()
            county_fips = parts[9].strip()
            area_land_str = parts[16].strip()

            # Skip rows with empty ZCTA or county
            if not zcta or not county_fips or len(zcta) != 5 or len(county_fips) != 5:
                continue

            try:
                area_land = int(area_land_str) if area_land_str else 0
            except ValueError:
                area_land = 0

            if zcta not in zip_county_areas:
                zip_county_areas[zcta] = {}
            zip_county_areas[zcta][county_fips] = zip_county_areas[zcta].get(county_fips, 0) + area_land

    # Pick the county with the largest area for each zip
    zip_to_county = {}
    for zcta, counties in zip_county_areas.items():
        best_fips = max(counties, key=counties.get)
        zip_to_county[zcta] = best_fips

    print(f"  Mapped {len(zip_to_county)} zip codes to counties")
    return zip_to_county


def parse_rate_csv(csv_path, zip_to_county):
    """
    Parse an EIA-861 rate CSV and accumulate rates by county FIPS.

    CSV columns: zip, eiaid, utility_name, state, service_type, ownership,
                 comm_rate, ind_rate, res_rate

    Rates are in $/kWh (e.g., 0.148 = 14.8 cents/kWh).

    Returns count of rows processed and rows matched to a county.
    Updates county_rates dict in place.
    """
    rows_total = 0
    rows_matched = 0
    rows_no_county = 0

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for row in reader:
            rows_total += 1

            zip_code = row.get('zip', '').strip()
            if not zip_code:
                continue

            # Zero-pad zip codes to 5 digits
            zip_code = zip_code.zfill(5)

            comm_rate = safe_float(row.get('comm_rate', ''))
            ind_rate = safe_float(row.get('ind_rate', ''))

            # Skip rows where both rates are missing or zero
            if (comm_rate is None or comm_rate == 0) and (ind_rate is None or ind_rate == 0):
                continue

            # Map zip to county FIPS
            fips = zip_to_county.get(zip_code)
            if not fips:
                rows_no_county += 1
                continue

            rows_matched += 1

            if fips not in county_rates:
                county_rates[fips] = {
                    'ind_rates': [],
                    'comm_rates': [],
                }

            if ind_rate is not None and ind_rate > 0:
                county_rates[fips]['ind_rates'].append(ind_rate)
            if comm_rate is not None and comm_rate > 0:
                county_rates[fips]['comm_rates'].append(comm_rate)

    return rows_total, rows_matched, rows_no_county


def main():
    parser = argparse.ArgumentParser(description='Ingest EIA-861 utility rates by zip code')
    parser.add_argument('--dry-run', action='store_true', help='Preview without patching DB')
    parser.add_argument('--skip-download', action='store_true', help='Use existing downloaded files')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    print("=" * 60)
    print("EIA-861 Utility Rate Ingestion")
    print("=" * 60)
    start = time.time()

    os.makedirs(DATA_DIR, exist_ok=True)

    # Step 1: Download CSV files
    print("\n[1/5] Downloading rate data...")
    iou_path = os.path.join(DATA_DIR, IOU_FILE)
    non_iou_path = os.path.join(DATA_DIR, NON_IOU_FILE)

    if not args.skip_download:
        download_file(f"{OPENEI_BASE}/{IOU_FILE}", iou_path)
        download_file(f"{OPENEI_BASE}/{NON_IOU_FILE}", non_iou_path)
    else:
        for p in [iou_path, non_iou_path]:
            if not os.path.exists(p):
                print(f"  ERROR: {p} not found. Run without --skip-download first.")
                sys.exit(1)
            print(f"  Using existing: {os.path.basename(p)}")

    # Step 2: Build zip-to-county mapping
    print("\n[2/5] Building ZIP-to-county FIPS mapping...")
    zip_to_county = build_zip_to_county_map()

    # Step 3: Parse rate CSVs
    print("\n[3/5] Parsing rate CSVs...")
    global county_rates
    county_rates = {}

    print("  Parsing IOU rates...")
    iou_total, iou_matched, iou_no_county = parse_rate_csv(iou_path, zip_to_county)
    print(f"    {iou_total:,} rows, {iou_matched:,} matched to counties, {iou_no_county:,} no county mapping")

    print("  Parsing non-IOU rates...")
    non_iou_total, non_iou_matched, non_iou_no_county = parse_rate_csv(non_iou_path, zip_to_county)
    print(f"    {non_iou_total:,} rows, {non_iou_matched:,} matched to counties, {non_iou_no_county:,} no county mapping")

    print(f"\n  Total: {len(county_rates):,} counties with rate data")

    # Step 4: Aggregate rates to county averages
    print("\n[4/5] Aggregating rates to county averages...")
    county_averages = {}
    for fips, data in county_rates.items():
        avg_ind = None
        avg_comm = None

        if data['ind_rates']:
            # Average $/kWh -> cents/kWh
            avg_ind = round(sum(data['ind_rates']) / len(data['ind_rates']) * 100, 2)
        if data['comm_rates']:
            avg_comm = round(sum(data['comm_rates']) / len(data['comm_rates']) * 100, 2)

        if avg_ind is not None or avg_comm is not None:
            county_averages[fips] = {
                'avg_industrial_rate_cents_kwh': avg_ind,
                'avg_commercial_rate_cents_kwh': avg_comm,
            }

    print(f"  {len(county_averages):,} counties with averaged rates")

    # Show rate distribution
    ind_rates = [v['avg_industrial_rate_cents_kwh'] for v in county_averages.values()
                 if v['avg_industrial_rate_cents_kwh'] is not None]
    comm_rates = [v['avg_commercial_rate_cents_kwh'] for v in county_averages.values()
                  if v['avg_commercial_rate_cents_kwh'] is not None]

    if ind_rates:
        print(f"\n  Industrial rate distribution (cents/kWh):")
        print(f"    Min: {min(ind_rates):.2f}  Median: {sorted(ind_rates)[len(ind_rates)//2]:.2f}  "
              f"Max: {max(ind_rates):.2f}  Avg: {sum(ind_rates)/len(ind_rates):.2f}")
        print(f"    Counties with industrial rate: {len(ind_rates):,}")

    if comm_rates:
        print(f"\n  Commercial rate distribution (cents/kWh):")
        print(f"    Min: {min(comm_rates):.2f}  Median: {sorted(comm_rates)[len(comm_rates)//2]:.2f}  "
              f"Max: {max(comm_rates):.2f}  Avg: {sum(comm_rates)/len(comm_rates):.2f}")
        print(f"    Counties with commercial rate: {len(comm_rates):,}")

    # Show top 10 cheapest and most expensive
    if ind_rates:
        sorted_counties = sorted(
            [(fips, v['avg_industrial_rate_cents_kwh']) for fips, v in county_averages.items()
             if v['avg_industrial_rate_cents_kwh'] is not None],
            key=lambda x: x[1]
        )
        print(f"\n  Top 5 cheapest industrial (cents/kWh):")
        for fips, rate in sorted_counties[:5]:
            print(f"    {fips}: {rate:.2f}")
        print(f"  Top 5 most expensive industrial (cents/kWh):")
        for fips, rate in sorted_counties[-5:]:
            print(f"    {fips}: {rate:.2f}")

    if args.dry_run:
        print(f"\n  DRY RUN — would patch {len(county_averages):,} grid_county_data records")
        elapsed = time.time() - start
        print(f"\nDone (dry run) in {elapsed:.1f}s")
        return

    # Step 5: Fetch existing grid_county_data FIPS codes and patch
    print("\n[5/5] Patching grid_county_data...")

    # Load all existing FIPS codes from grid_county_data
    existing_fips = set()
    offset = 0
    while True:
        path = f"grid_county_data?select=fips_code&offset={offset}&limit=1000"
        rows = supabase_request('GET', path)
        if not rows:
            break
        for r in rows:
            if r.get('fips_code'):
                existing_fips.add(r['fips_code'])
        if len(rows) < 1000:
            break
        offset += 1000

    print(f"  Found {len(existing_fips):,} counties in grid_county_data")

    # Match and patch
    matched = 0
    unmatched = 0
    patched = 0
    errors = 0

    fips_list = sorted(county_averages.keys())
    for i, fips in enumerate(fips_list):
        if fips not in existing_fips:
            unmatched += 1
            continue

        matched += 1
        data = county_averages[fips]

        # Build patch payload — only include non-None values
        patch = {}
        if data['avg_industrial_rate_cents_kwh'] is not None:
            patch['avg_industrial_rate_cents_kwh'] = data['avg_industrial_rate_cents_kwh']
        if data['avg_commercial_rate_cents_kwh'] is not None:
            patch['avg_commercial_rate_cents_kwh'] = data['avg_commercial_rate_cents_kwh']

        if not patch:
            continue

        fips_encoded = urllib.parse.quote(fips, safe='')
        path = f"grid_county_data?fips_code=eq.{fips_encoded}"

        try:
            supabase_request('PATCH', path, patch)
            patched += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  ERROR patching {fips}: {e}")

        if (i + 1) % 100 == 0:
            print(f"  Progress: {i+1:,}/{len(fips_list):,} processed, {patched:,} patched, {errors} errors")

    print(f"\n  Results:")
    print(f"    Counties in rate data: {len(county_averages):,}")
    print(f"    Matched to grid_county_data: {matched:,}")
    print(f"    Not in grid_county_data: {unmatched:,}")
    print(f"    Patched: {patched:,}")
    print(f"    Errors: {errors}")

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s")


if __name__ == '__main__':
    main()

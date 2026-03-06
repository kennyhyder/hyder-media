#!/usr/bin/env python3
"""
Ingest BLS Quarterly Census of Employment and Wages (QCEW) county-level data.
Source: BLS annual singlefile CSV (free, no auth)
Target: grid_county_data table (updates employment columns)

Downloads annual average QCEW data and populates:
  - construction_employment, construction_wages_avg (NAICS 23)
  - it_employment, it_wages_avg (NAICS 5112 + 5182)
  - total_employment (NAICS 10 = Total, all industries)

URL pattern: https://data.bls.gov/cew/data/files/{year}/csv/{year}_annual_singlefile.zip
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
import io
import zipfile
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'bls_qcew')
BATCH_SIZE = 50

# BLS ownership code 5 = private
PRIVATE_OWN_CODE = '5'

# NAICS industry codes of interest
NAICS_CONSTRUCTION = '23'       # Construction
NAICS_SOFTWARE = '5112'         # Software Publishers
NAICS_DATA_PROCESSING = '5182'  # Data Processing, Hosting, and Related Services
NAICS_TOTAL = '10'              # Total, All Industries


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


def safe_int(val):
    """Parse an integer value, returning None for missing/invalid data."""
    if val is None or val == '' or val == ' ':
        return None
    try:
        v = val.strip().replace(',', '')
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return int(f)
    except (ValueError, TypeError):
        return None


def safe_float(val):
    """Parse a float value, returning None for missing/invalid data."""
    if val is None or val == '' or val == ' ':
        return None
    try:
        v = val.strip().replace(',', '')
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 2)
    except (ValueError, TypeError):
        return None


def download_qcew(year):
    """Download and extract BLS QCEW annual singlefile CSV."""
    os.makedirs(DATA_DIR, exist_ok=True)

    csv_filename = f"{year}.annual.singlefile.csv"
    csv_path = os.path.join(DATA_DIR, csv_filename)

    if os.path.exists(csv_path):
        size_mb = os.path.getsize(csv_path) / (1024 * 1024)
        print(f"  Using cached CSV ({size_mb:.1f} MB)")
        return csv_path

    zip_url = f"https://data.bls.gov/cew/data/files/{year}/csv/{year}_annual_singlefile.zip"
    zip_path = os.path.join(DATA_DIR, f"{year}_annual_singlefile.zip")

    print(f"  Downloading BLS QCEW {year} data from:")
    print(f"    {zip_url}")
    req = urllib.request.Request(zip_url)
    req.add_header('User-Agent', 'GridScout/1.0')

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        print(f"  ERROR: HTTP {e.code} downloading QCEW data")
        if e.code == 404:
            print(f"  Year {year} data may not be available yet. Try an earlier year.")
        sys.exit(1)

    with open(zip_path, 'wb') as f:
        f.write(data)
    print(f"  Downloaded {len(data) / (1024 * 1024):.1f} MB ZIP")

    with zipfile.ZipFile(zip_path, 'r') as zf:
        csv_files = [n for n in zf.namelist() if n.endswith('.csv')]
        if not csv_files:
            print("ERROR: No CSV found in ZIP")
            sys.exit(1)
        print(f"  Extracting {csv_files[0]}...")
        zf.extract(csv_files[0], DATA_DIR)
        extracted = os.path.join(DATA_DIR, csv_files[0])
        if extracted != csv_path:
            os.rename(extracted, csv_path)

    size_mb = os.path.getsize(csv_path) / (1024 * 1024)
    print(f"  Extracted CSV ({size_mb:.1f} MB)")
    return csv_path


def parse_qcew_csv(csv_path):
    """
    Parse BLS QCEW CSV and aggregate employment data by county FIPS.

    Returns dict keyed by 5-digit FIPS code:
    {
        'XXXXX': {
            'construction_employment': int,
            'construction_wages_avg': float,
            'it_employment': int,       # sum of NAICS 5112 + 5182
            'it_wages_avg': float,      # weighted average of 5112 + 5182
            'total_employment': int,
        }
    }
    """
    # Accumulate data per county
    # For IT, we need to sum 5112 + 5182, so track them separately first
    counties = {}

    print("  Scanning CSV rows (this may take a minute for ~4M rows)...")
    row_count = 0
    matched_count = 0

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for row in reader:
            row_count += 1

            # Only private ownership
            if row.get('own_code', '').strip() != PRIVATE_OWN_CODE:
                continue

            # Only county-level records (5-digit FIPS, no state/national/MSA aggregates)
            fips = row.get('area_fips', '').strip()
            if not fips or len(fips) != 5:
                continue

            # Skip US-level or state-level codes
            # State FIPS have county part "000", e.g., "06000" for California
            if fips.endswith('000'):
                continue

            # Skip unknown/suppressed county codes ending in 999
            if fips.endswith('999'):
                continue

            industry = row.get('industry_code', '').strip()

            # Only care about our target NAICS codes
            if industry not in (NAICS_CONSTRUCTION, NAICS_SOFTWARE, NAICS_DATA_PROCESSING, NAICS_TOTAL):
                continue

            employment = safe_int(row.get('annual_avg_emplvl'))
            avg_pay = safe_float(row.get('avg_annual_pay'))
            estabs = safe_int(row.get('annual_avg_estabs'))

            if fips not in counties:
                counties[fips] = {
                    'construction_employment': None,
                    'construction_wages_avg': None,
                    'it_5112_employment': None,
                    'it_5112_wages': None,
                    'it_5182_employment': None,
                    'it_5182_wages': None,
                    'total_employment': None,
                }

            rec = counties[fips]

            if industry == NAICS_CONSTRUCTION:
                rec['construction_employment'] = employment
                rec['construction_wages_avg'] = avg_pay
                matched_count += 1

            elif industry == NAICS_SOFTWARE:
                rec['it_5112_employment'] = employment
                rec['it_5112_wages'] = avg_pay
                matched_count += 1

            elif industry == NAICS_DATA_PROCESSING:
                rec['it_5182_employment'] = employment
                rec['it_5182_wages'] = avg_pay
                matched_count += 1

            elif industry == NAICS_TOTAL:
                rec['total_employment'] = employment
                matched_count += 1

            if row_count % 1000000 == 0:
                print(f"    Scanned {row_count:,} rows, {matched_count:,} matched, {len(counties):,} counties...")

    print(f"  Scanned {row_count:,} total rows, {matched_count:,} matched across {len(counties):,} counties")

    # Now aggregate IT employment (5112 + 5182) and compute weighted average wage
    results = {}
    for fips, data in counties.items():
        it_employment = None
        it_wages_avg = None

        emp_5112 = data['it_5112_employment']
        wage_5112 = data['it_5112_wages']
        emp_5182 = data['it_5182_employment']
        wage_5182 = data['it_5182_wages']

        # Sum IT employment from both NAICS codes
        if emp_5112 is not None or emp_5182 is not None:
            it_employment = (emp_5112 or 0) + (emp_5182 or 0)
            if it_employment == 0:
                it_employment = None

        # Weighted average IT wages
        if it_employment and it_employment > 0:
            weighted_sum = 0
            weight_total = 0
            if emp_5112 and wage_5112:
                weighted_sum += emp_5112 * wage_5112
                weight_total += emp_5112
            if emp_5182 and wage_5182:
                weighted_sum += emp_5182 * wage_5182
                weight_total += emp_5182
            if weight_total > 0:
                it_wages_avg = round(weighted_sum / weight_total, 2)

        results[fips] = {
            'construction_employment': data['construction_employment'],
            'construction_wages_avg': data['construction_wages_avg'],
            'it_employment': it_employment,
            'it_wages_avg': it_wages_avg,
            'total_employment': data['total_employment'],
        }

    return results


def load_existing_fips():
    """Load all FIPS codes that already exist in grid_county_data."""
    fips_set = set()
    offset = 0
    page_size = 1000

    while True:
        rows = supabase_request(
            'GET',
            f'grid_county_data?select=fips_code&limit={page_size}&offset={offset}&order=fips_code'
        )
        if not rows:
            break
        for r in rows:
            fips_set.add(r['fips_code'])
        if len(rows) < page_size:
            break
        offset += page_size

    return fips_set


def main():
    print("=" * 60)
    print("GridScout BLS QCEW Employment Data Ingestion")
    print("=" * 60)

    parser = argparse.ArgumentParser(description='Ingest BLS QCEW data')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing to database')
    parser.add_argument('--year', type=int, default=2023, help='QCEW data year (default: 2023)')
    args = parser.parse_args()

    dry_run = args.dry_run
    year = args.year

    print(f"  Year: {year}")
    print(f"  Dry run: {dry_run}")

    # Download QCEW data
    print(f"\nStep 1: Download QCEW {year} data")
    csv_path = download_qcew(year)

    # Parse CSV
    print(f"\nStep 2: Parse QCEW CSV")
    county_data = parse_qcew_csv(csv_path)
    print(f"  {len(county_data):,} counties with employment data")

    # Stats summary
    has_construction = sum(1 for v in county_data.values() if v['construction_employment'] is not None)
    has_it = sum(1 for v in county_data.values() if v['it_employment'] is not None)
    has_total = sum(1 for v in county_data.values() if v['total_employment'] is not None)
    print(f"  Construction employment: {has_construction:,} counties")
    print(f"  IT employment (5112+5182): {has_it:,} counties")
    print(f"  Total employment: {has_total:,} counties")

    if dry_run:
        print(f"\n[DRY RUN] Would update employment data for {len(county_data):,} counties")
        # Show sample records
        sample_fips = sorted(county_data.keys())[:10]
        for fips in sample_fips:
            d = county_data[fips]
            print(f"  {fips}: construction={d['construction_employment']}, "
                  f"construction_wages=${d['construction_wages_avg']}, "
                  f"IT={d['it_employment']}, IT_wages=${d['it_wages_avg']}, "
                  f"total={d['total_employment']}")
        if len(county_data) > 10:
            print(f"  ... and {len(county_data) - 10:,} more")
        return

    # Load existing FIPS codes from grid_county_data
    print(f"\nStep 3: Load existing county records")
    existing_fips = load_existing_fips()
    print(f"  {len(existing_fips):,} counties already in grid_county_data")

    # Filter to only counties that exist in the table
    fips_to_update = [f for f in county_data.keys() if f in existing_fips]
    fips_missing = [f for f in county_data.keys() if f not in existing_fips]
    print(f"  {len(fips_to_update):,} counties to update")
    if fips_missing:
        print(f"  {len(fips_missing):,} counties in BLS data but not in grid_county_data (skipped)")

    # PATCH employment data into grid_county_data
    print(f"\nStep 4: Update employment data")
    patched = 0
    errors = 0

    for i, fips in enumerate(fips_to_update):
        data = county_data[fips]

        # Build patch payload — only include non-None fields
        patch = {
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }

        if data['construction_employment'] is not None:
            patch['construction_employment'] = data['construction_employment']
        if data['construction_wages_avg'] is not None:
            patch['construction_wages_avg'] = data['construction_wages_avg']
        if data['it_employment'] is not None:
            patch['it_employment'] = data['it_employment']
        if data['it_wages_avg'] is not None:
            patch['it_wages_avg'] = data['it_wages_avg']
        if data['total_employment'] is not None:
            patch['total_employment'] = data['total_employment']

        # Skip if nothing to patch beyond updated_at
        if len(patch) <= 1:
            continue

        fips_encoded = urllib.parse.quote(fips, safe='')
        try:
            supabase_request(
                'PATCH',
                f'grid_county_data?fips_code=eq.{fips_encoded}',
                patch
            )
            patched += 1
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error patching {fips}: {e}")

        if (i + 1) % 200 == 0:
            print(f"  Progress: {i + 1}/{len(fips_to_update)} ({patched} patched, {errors} errors)")

    # Update data source record
    print(f"\nStep 5: Update data source metadata")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.bls_qcew&select=id')
    if ds:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
            'record_count': patched,
            'last_import': datetime.now(timezone.utc).isoformat()
        })
        print(f"  Updated bls_qcew data source record")
    else:
        print(f"  WARNING: bls_qcew data source not found in grid_data_sources")

    print(f"\n{'=' * 60}")
    print(f"BLS QCEW Ingestion Complete (Year {year})")
    print(f"  Counties patched: {patched}")
    print(f"  Counties skipped (not in grid_county_data): {len(fips_missing)}")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

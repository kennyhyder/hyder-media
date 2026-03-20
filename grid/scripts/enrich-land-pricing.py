#!/usr/bin/env python3
"""
Enrich grid_county_data with county-level agricultural land pricing from USDA NASS.

Source: USDA NASS Quick Stats API
API: https://quickstats.nass.usda.gov/api/api_GET/

Queries county-level land values (farmland average $/acre) and updates
grid_county_data with land_price_per_acre.

Requires: USDA_NASS_API_KEY env var (free: https://quickstats.nass.usda.gov/api/)
Falls back to DEMO_KEY if not set (rate-limited to 5 req/hr).

Migration: grid/supabase/migrations/20260319_land_pricing.sql

Usage:
    python3 -u scripts/enrich-land-pricing.py
    python3 -u scripts/enrich-land-pricing.py --dry-run
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
NASS_API_KEY = os.environ.get('USDA_NASS_API_KEY', 'DEMO_KEY')

BATCH_SIZE = 50
NASS_URL = 'https://quickstats.nass.usda.gov/api/api_GET/'

# State FIPS → abbreviation (for mapping NASS state codes)
STATE_FIPS = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
    '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
    '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
    '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
    '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
    '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
    '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
    '54': 'WV', '55': 'WI', '56': 'WY',
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


def fetch_nass_land_values(year=2024):
    """Fetch county-level land values from USDA NASS Quick Stats API.

    We query: AG LAND, INCL BUILDINGS - VALUE, MEASURED IN $/ACRE
    at the COUNTY aggregation level for the specified year.
    """
    params = {
        'key': NASS_API_KEY,
        'commodity_desc': 'AG LAND',
        'statisticcat_desc': 'VALUE',
        'unit_desc': '$ / ACRE',
        'domain_desc': 'TOTAL',
        'agg_level_desc': 'COUNTY',
        'year': year,
        'format': 'JSON',
    }
    url = f"{NASS_URL}?{urllib.parse.urlencode(params)}"
    print(f"  Querying NASS API for {year} county land values...")

    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                return data.get('data', [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  Rate limited. Waiting 60s...")
                time.sleep(60)
                continue
            error_body = e.read().decode() if e.fp else ''
            print(f"  HTTP {e.code}: {error_body[:300]}")
            if attempt < 2:
                time.sleep(5)
                continue
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(5)
                continue
            raise

    return []


def safe_float(val):
    if val is None:
        return None
    try:
        # NASS uses commas in numbers
        v = str(val).strip().replace(',', '')
        if not v or v == '(D)' or v == '(Z)':
            return None
        f = float(v)
        if f != f:
            return None
        return f
    except (ValueError, TypeError):
        return None


def main():
    print("=" * 60)
    print("GridScout: Enrich County Land Pricing (USDA NASS)")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    if NASS_API_KEY == 'DEMO_KEY':
        print("\n  WARNING: Using DEMO_KEY (5 requests/hour limit)")
        print("  Get free key at: https://quickstats.nass.usda.gov/api/")
        print("  Set USDA_NASS_API_KEY in .env.local")

    # Step 1: Fetch NASS land values
    print("\n[Step 1] Fetching USDA NASS land values...")

    # Try most recent year first, fall back to prior years
    nass_records = []
    for year in [2024, 2023, 2022]:
        nass_records = fetch_nass_land_values(year)
        if nass_records:
            print(f"  Got {len(nass_records)} records for {year}")
            break
        print(f"  No data for {year}, trying {year - 1}...")
        time.sleep(2)

    if not nass_records:
        print("  ERROR: No NASS land value data available")
        sys.exit(1)

    # Step 2: Build FIPS → price mapping
    print("\n[Step 2] Building county FIPS → price mapping...")
    fips_to_price = {}
    used_year = None

    for rec in nass_records:
        state_fips = rec.get('state_fips_code', '').zfill(2)
        county_fips = rec.get('county_code', '').zfill(3)

        if not state_fips or not county_fips or county_fips == '000':
            continue

        fips = state_fips + county_fips
        value = safe_float(rec.get('Value'))
        if value is None or value <= 0:
            continue

        # Keep highest value if multiple entries per county
        if fips not in fips_to_price or value > fips_to_price[fips]:
            fips_to_price[fips] = value

        if used_year is None:
            used_year = rec.get('year')

    print(f"  {len(fips_to_price)} counties with land prices (year: {used_year})")

    # Show price distribution
    prices = sorted(fips_to_price.values())
    if prices:
        print(f"  Price range: ${prices[0]:,.0f}/acre - ${prices[-1]:,.0f}/acre")
        median_idx = len(prices) // 2
        print(f"  Median: ${prices[median_idx]:,.0f}/acre")

    # Step 3: Load counties from DB
    print("\n[Step 3] Loading counties from grid_county_data...")
    counties = load_paginated('grid_county_data', 'id,fips_code')
    print(f"  {len(counties)} counties loaded")

    # Step 4: Match and update
    print("\n[Step 4] Matching land prices to counties...")
    patches = []
    matched = 0
    no_match = 0

    for county in counties:
        fips = county.get('fips_code')
        if not fips:
            continue

        price = fips_to_price.get(fips)
        if price is not None:
            patches.append({
                'id': county['id'],
                'fips_code': fips,
                'land_price_per_acre': price,
                'land_price_year': int(used_year) if used_year else None,
                'land_price_source': 'USDA NASS',
            })
            matched += 1
        else:
            no_match += 1

    print(f"  Matched: {matched}")
    print(f"  No match: {no_match}")

    if dry_run:
        print(f"\n[DRY RUN] Would update {len(patches)} counties with land prices")
        for p in patches[:5]:
            print(f"  FIPS {p['fips_code']}: ${p['land_price_per_acre']:,.0f}/acre")
        return

    # Step 5: Update counties
    print(f"\n[Step 5] Updating {len(patches)} counties...")
    updated = 0
    errors = 0

    for patch in patches:
        county_id = patch.pop('id')
        fips = patch.pop('fips_code')
        try:
            supabase_request(
                'PATCH',
                f'grid_county_data?fips_code=eq.{urllib.parse.quote(fips, safe="")}',
                patch
            )
            updated += 1
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error updating {fips}: {e}")

        if updated % 200 == 0 and updated > 0:
            print(f"  Progress: {updated}/{len(patches)} ({errors} err)")

    print(f"\n  Updated: {updated}, Errors: {errors}")
    print("\nDone!")


if __name__ == '__main__':
    main()

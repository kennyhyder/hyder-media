#!/usr/bin/env python3
"""
Fetch county-level agricultural land values from USDA NASS QuickStats API
and update avg_land_value_per_acre_usd in grid_county_data table.

API key is free from https://quickstats.nass.usda.gov/api/
Set USDA_NASS_API_KEY in grid/.env.local.

If no API key is set, falls back to hardcoded state-level estimates from
the 2024 USDA Land Values Summary.

Usage:
    python3 -u scripts/ingest-usda-land-values.py
    python3 -u scripts/ingest-usda-land-values.py --dry-run
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
NASS_API_KEY = os.environ.get('USDA_NASS_API_KEY', '')

NASS_BASE = 'https://quickstats.nass.usda.gov/api/api_GET/'

# 2024 USDA Land Values Summary ($/acre, farm real estate including land + buildings)
STATE_LAND_VALUES = {
    'AL': 4400, 'AK': 1500, 'AZ': 2170, 'AR': 4200, 'CA': 12600,
    'CO': 2440, 'CT': 14900, 'DE': 9900, 'FL': 9400, 'GA': 5050,
    'HI': 11100, 'ID': 4300, 'IL': 9200, 'IN': 8300, 'IA': 9800,
    'KS': 2520, 'KY': 5200, 'LA': 4600, 'ME': 3100, 'MD': 10900,
    'MA': 15600, 'MI': 7200, 'MN': 6200, 'MS': 3500, 'MO': 4400,
    'MT': 1090, 'NE': 3500, 'NV': 1340, 'NH': 6400, 'NJ': 17200,
    'NM': 690, 'NY': 4800, 'NC': 5850, 'ND': 2520, 'OH': 8200,
    'OK': 2550, 'OR': 3100, 'PA': 8100, 'RI': 17900, 'SC': 4200,
    'SD': 2300, 'TN': 5400, 'TX': 2900, 'UT': 2800, 'VT': 4000,
    'VA': 5900, 'WA': 4300, 'WV': 2700, 'WI': 6400, 'WY': 780,
    'DC': 0,
}

# State FIPS code -> abbreviation
STATE_FIPS_TO_ABBR = {
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

ALL_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
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
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def fetch_nass_county_values():
    """Fetch county-level ag land values from USDA NASS QuickStats API, state by state.

    Tries 2024 first, falls back to 2023, then 2022.
    Returns dict of {fips_code: value_per_acre} and {state: avg_value} for fallback.
    """
    fips_values = {}
    state_averages = {}  # computed from API county data

    print(f"  Querying {len(ALL_STATES)} states...")
    for i, state in enumerate(ALL_STATES):
        found_year = None
        for year in ['2024', '2023', '2022']:
            params = {
                'key': NASS_API_KEY,
                'commodity_desc': 'AG LAND',
                'statisticcat_desc': 'ASSET VALUE',
                'unit_desc': '$ / ACRE',
                'agg_level_desc': 'COUNTY',
                'year': year,
                'state_alpha': state,
                'domain_desc': 'TOTAL',
                'format': 'JSON',
            }

            url = NASS_BASE + '?' + urllib.parse.urlencode(params)
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0')

            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode())
                    records = data.get('data', [])
                    if records:
                        state_vals = []
                        for rec in records:
                            state_fips = rec.get('state_fips_code', '').strip()
                            county_code = rec.get('county_code', '').strip()
                            value_str = str(rec.get('Value', '')).replace(',', '').strip()

                            # Skip suppressed/missing values
                            if value_str in ('', '(D)', '(Z)', '(NA)', '(S)'):
                                continue
                            if not state_fips or not county_code or county_code == '000':
                                continue

                            try:
                                value = float(value_str)
                                if value > 0:
                                    fips = f"{state_fips.zfill(2)}{county_code.zfill(3)}"
                                    fips_values[fips] = value
                                    state_vals.append(value)
                            except ValueError:
                                continue

                        if state_vals:
                            state_averages[state] = sum(state_vals) / len(state_vals)
                            found_year = year
                            break  # Got data for this state, skip older years
            except urllib.error.HTTPError as e:
                if e.code == 413:
                    # Too many results — shouldn't happen with state filter, but handle it
                    print(f"  {state}: API returned 413, skipping")
                    break
                # Other HTTP errors — try next year
                pass
            except Exception:
                pass

            time.sleep(1.0)  # Rate limit: ~1 req/sec

        if found_year:
            if (i + 1) % 10 == 0:
                print(f"  {i + 1}/{len(ALL_STATES)} states queried ({len(fips_values)} counties so far)")
        else:
            print(f"  {state}: no county data found (2022-2024)")

        time.sleep(0.5)  # Small delay between states

    print(f"  {len(fips_values)} counties with NASS data across {len(state_averages)} states")
    return fips_values, state_averages


def main():
    print("=" * 60)
    print("GridScout: USDA NASS County Land Value Ingestion")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    # Step 1: Fetch land value data
    fips_values = {}
    state_averages = {}
    use_api = bool(NASS_API_KEY)

    if use_api:
        print("\n[Step 1] Fetching county-level values from USDA NASS API...")
        fips_values, state_averages = fetch_nass_county_values()
    else:
        print("\n[Step 1] No USDA_NASS_API_KEY set — using state-level estimates")
        print("  Get a free key at https://quickstats.nass.usda.gov/api/")

    # State-level fallback (always available — hardcoded 2024 USDA data)
    # For counties not in NASS, use API-computed state average first, then hardcoded
    print(f"\n  State-level fallback: {len(STATE_LAND_VALUES)} states (2024 USDA Land Values Summary)")

    # Print summary stats
    if fips_values:
        values = sorted(fips_values.values())
        mid = len(values) // 2
        median = values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2
        print(f"\n  County-level stats:")
        print(f"    Counties: {len(fips_values)}")
        print(f"    Min:    ${values[0]:,.0f}/acre")
        print(f"    Median: ${median:,.0f}/acre")
        print(f"    Max:    ${values[-1]:,.0f}/acre")

    # Step 2: Load existing counties from grid_county_data
    print("\n[Step 2] Loading grid_county_data records...")
    counties = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_county_data?select=id,fips_code,state&limit=1000&offset={offset}')
        if not batch:
            break
        counties.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(counties)} counties in DB")

    if not counties:
        print("ERROR: No counties found in grid_county_data. Run ingest-fema-nri.py first.")
        sys.exit(1)

    # Step 3: Build FIPS -> value map for each county
    # Priority: (1) NASS county value, (2) NASS state average, (3) hardcoded state value
    county_level = 0
    state_api_level = 0
    state_hardcoded_level = 0
    no_data = 0

    patches = []  # list of (county_id, fips_code, value)
    for county in counties:
        fips = county.get('fips_code')
        state = county.get('state')
        cid = county.get('id')
        value = None

        if fips and fips in fips_values:
            value = fips_values[fips]
            county_level += 1
        elif state and state in state_averages:
            value = round(state_averages[state], 2)
            state_api_level += 1
        elif state and state in STATE_LAND_VALUES:
            value = STATE_LAND_VALUES[state]
            state_hardcoded_level += 1
        else:
            no_data += 1
            continue

        if value and value > 0:
            patches.append((cid, fips, value))

    print(f"\n  Resolution breakdown:")
    print(f"    County-level (NASS API):      {county_level}")
    print(f"    State avg (NASS API):         {state_api_level}")
    print(f"    State estimate (hardcoded):   {state_hardcoded_level}")
    print(f"    No data:                      {no_data}")
    print(f"    Total to patch:               {len(patches)}")

    if dry_run:
        print(f"\n[DRY RUN] Would patch {len(patches)} counties. No changes made.")
        # Show some examples
        for cid, fips, val in patches[:10]:
            source = 'county' if fips in fips_values else 'state-avg' if (STATE_FIPS_TO_ABBR.get(fips[:2], '') in state_averages) else 'hardcoded'
            print(f"    {fips}: ${val:,.0f}/acre ({source})")
        if len(patches) > 10:
            print(f"    ... and {len(patches) - 10} more")
        return

    # Step 4: Patch grid_county_data in batches
    print(f"\n[Step 3] Patching {len(patches)} counties...")
    patched = 0
    errors = 0

    for i, (cid, fips, value) in enumerate(patches):
        try:
            supabase_request('PATCH',
                f'grid_county_data?id=eq.{cid}',
                {'avg_land_value_per_acre_usd': value})
            patched += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error patching {fips}: {e}")

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i + 1}/{len(patches)} ({patched} ok, {errors} err)")

    # Final summary
    print(f"\n{'=' * 60}")
    print(f"USDA Land Value Ingestion Complete")
    print(f"{'=' * 60}")
    print(f"  Data source:        {'NASS API (county-level)' if use_api else 'State-level estimates'}")
    print(f"  Counties patched:   {patched}")
    print(f"  County-level data:  {county_level}")
    print(f"  State-level fallback: {state_api_level + state_hardcoded_level}")
    print(f"  No data:            {no_data}")
    print(f"  Errors:             {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Populate NOAA climate normals into grid_county_data.
Source: State-average CDD/HDD/mean temp from NOAA 1991-2020 US Climate Normals.
Target: grid_county_data table (PATCH existing rows by state)

Uses state-level averages (30-year normals) applied to all counties in each state.
CDD varies more by state than within-state, making this accurate enough for DC site
scoring where climate is a 2% weight factor.

Data: NOAA US Climate Normals 1991-2020, base 65 deg F
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

# State-average annual Cooling Degree Days (NOAA 1991-2020 normals, base 65 deg F)
# Lower CDD = cooler climate = better for datacenter cooling efficiency
STATE_CDD = {
    'AL': 2100, 'AK': 0, 'AZ': 3400, 'AR': 1900, 'CA': 1000, 'CO': 700,
    'CT': 700, 'DE': 1100, 'DC': 1500, 'FL': 3500, 'GA': 2200, 'HI': 4400,
    'ID': 500, 'IL': 1100, 'IN': 1000, 'IA': 900, 'KS': 1400, 'KY': 1300,
    'LA': 2700, 'ME': 300, 'MD': 1300, 'MA': 600, 'MI': 700, 'MN': 600,
    'MS': 2400, 'MO': 1500, 'MT': 400, 'NE': 1000, 'NV': 2000, 'NH': 400,
    'NJ': 1000, 'NM': 1400, 'NY': 700, 'NC': 1600, 'ND': 500, 'OH': 900,
    'OK': 1900, 'OR': 300, 'PA': 800, 'RI': 600, 'SC': 2000, 'SD': 700,
    'TN': 1600, 'TX': 2600, 'UT': 1000, 'VT': 400, 'VA': 1300, 'WA': 300,
    'WV': 800, 'WI': 600, 'WY': 300,
}

# State-average annual Heating Degree Days (NOAA 1991-2020 normals, base 65 deg F)
STATE_HDD = {
    'AL': 2800, 'AK': 10000, 'AZ': 1500, 'AR': 3400, 'CA': 2500, 'CO': 6200,
    'CT': 5800, 'DE': 4500, 'DC': 4200, 'FL': 700, 'GA': 2400, 'HI': 0,
    'ID': 6400, 'IL': 5600, 'IN': 5500, 'IA': 6500, 'KS': 5000, 'KY': 4300,
    'LA': 1700, 'ME': 7500, 'MD': 4400, 'MA': 5900, 'MI': 6600, 'MN': 7700,
    'MS': 2400, 'MO': 4700, 'MT': 7600, 'NE': 6200, 'NV': 3700, 'NH': 7200,
    'NJ': 4900, 'NM': 4000, 'NY': 6100, 'NC': 3300, 'ND': 8600, 'OH': 5400,
    'OK': 3600, 'OR': 4700, 'PA': 5600, 'RI': 5600, 'SC': 2400, 'SD': 7300,
    'TN': 3600, 'TX': 1800, 'UT': 5500, 'VT': 7400, 'VA': 4000, 'WA': 5000,
    'WV': 5000, 'WI': 7200, 'WY': 7600,
}

# State-average annual mean temperature (deg F, NOAA 1991-2020 normals)
STATE_MEAN_TEMP = {
    'AL': 63, 'AK': 27, 'AZ': 63, 'AR': 60, 'CA': 59, 'CO': 46,
    'CT': 50, 'DE': 55, 'DC': 57, 'FL': 72, 'GA': 64, 'HI': 77,
    'ID': 44, 'IL': 52, 'IN': 52, 'IA': 48, 'KS': 55, 'KY': 56,
    'LA': 67, 'ME': 42, 'MD': 55, 'MA': 49, 'MI': 45, 'MN': 42,
    'MS': 64, 'MO': 56, 'MT': 42, 'NE': 49, 'NV': 50, 'NH': 43,
    'NJ': 53, 'NM': 53, 'NY': 46, 'NC': 59, 'ND': 40, 'OH': 51,
    'OK': 60, 'OR': 49, 'PA': 50, 'RI': 50, 'SC': 63, 'SD': 45,
    'TN': 58, 'TX': 65, 'UT': 49, 'VT': 43, 'VA': 55, 'WA': 48,
    'WV': 52, 'WI': 44, 'WY': 41,
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


def main():
    print("=" * 60)
    print("GridScout NOAA Climate Normals Ingestion")
    print("=" * 60)
    print("  Source: NOAA US Climate Normals 1991-2020 (state averages)")
    print(f"  States: {len(STATE_CDD)} with CDD/HDD/mean temp data")

    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("\n[DRY RUN] Would patch the following state climate data:")
        print(f"  {'State':<6} {'CDD':>6} {'HDD':>6} {'Mean F':>7}")
        print(f"  {'-'*5:<6} {'-'*5:>6} {'-'*5:>6} {'-'*5:>7}")
        for state in sorted(STATE_CDD.keys()):
            cdd = STATE_CDD[state]
            hdd = STATE_HDD.get(state, 0)
            temp = STATE_MEAN_TEMP.get(state, 0)
            print(f"  {state:<6} {cdd:>6} {hdd:>6} {temp:>7}")
        print(f"\n  Total: {len(STATE_CDD)} states would be patched")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    # Patch all counties in each state with that state's climate normals
    patched = 0
    errors = 0
    total_counties = 0

    for state in sorted(STATE_CDD.keys()):
        cdd = STATE_CDD[state]
        hdd = STATE_HDD.get(state, 0)
        temp = STATE_MEAN_TEMP.get(state, 0)

        state_encoded = urllib.parse.quote(state)
        try:
            supabase_request(
                'PATCH',
                f'grid_county_data?state=eq.{state_encoded}',
                {
                    'cooling_degree_days': cdd,
                    'heating_degree_days': hdd,
                    'mean_annual_temp_f': temp,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            patched += 1
        except Exception as e:
            errors += 1
            print(f"  Error patching {state}: {e}")

    # Count how many county rows were affected
    try:
        result = supabase_request(
            'GET',
            'grid_county_data?cooling_degree_days=not.is.null&select=id',
            headers_extra={'Prefer': 'count=exact', 'Range': '0-0'}
        )
        # The count comes from the Content-Range header, but we can approximate
        # by querying with a high limit
        count_result = supabase_request(
            'GET',
            'grid_county_data?cooling_degree_days=not.is.null&select=fips_code'
        )
        if count_result:
            total_counties = len(count_result)
    except Exception:
        pass

    # Update data source timestamp
    try:
        ds = supabase_request('GET', 'grid_data_sources?name=eq.noaa_climate&select=id')
        if ds:
            supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
                'record_count': total_counties or patched,
                'last_import': datetime.now(timezone.utc).isoformat()
            })
    except Exception as e:
        print(f"  Warning: Could not update data source: {e}")

    print(f"\n{'=' * 60}")
    print(f"NOAA Climate Normals Ingestion Complete")
    print(f"  States patched: {patched}/{len(STATE_CDD)}")
    if total_counties:
        print(f"  County rows with climate data: {total_counties}")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

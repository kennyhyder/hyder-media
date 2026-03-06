#!/usr/bin/env python3
"""
Populate WRI Aqueduct water stress data into grid_county_data.
Source: State-level water stress averages from WRI Aqueduct (2019 baseline).
Target: grid_county_data table (updates existing rows by state)

WRI Aqueduct provides watershed-level data. For DC site scoring, state-level
averages are sufficient since water stress varies more between states than
within states for the scoring resolution we need.
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

# State-level water stress scores (0-5 scale, WRI Aqueduct 2019 baseline)
# 0=Low (<10%), 1=Low-Medium (10-20%), 2=Medium-High (20-40%),
# 3=High (40-80%), 4=Extremely High (>80%), 5=Arid/Low Water Use
# Sources: WRI Aqueduct Water Risk Atlas, state-weighted averages
STATE_WATER_STRESS = {
    'AL': (0.4, 'Low'),
    'AK': (0.2, 'Low'),
    'AZ': (4.2, 'Extremely High'),
    'AR': (0.8, 'Low'),
    'CA': (3.8, 'High'),
    'CO': (3.2, 'High'),
    'CT': (0.6, 'Low'),
    'DE': (0.8, 'Low'),
    'DC': (1.0, 'Low-Medium'),
    'FL': (1.2, 'Low-Medium'),
    'GA': (1.0, 'Low-Medium'),
    'HI': (0.8, 'Low'),
    'ID': (2.8, 'Medium-High'),
    'IL': (0.6, 'Low'),
    'IN': (0.5, 'Low'),
    'IA': (0.6, 'Low'),
    'KS': (2.4, 'Medium-High'),
    'KY': (0.4, 'Low'),
    'LA': (0.6, 'Low'),
    'ME': (0.2, 'Low'),
    'MD': (0.8, 'Low'),
    'MA': (0.6, 'Low'),
    'MI': (0.3, 'Low'),
    'MN': (0.4, 'Low'),
    'MS': (0.5, 'Low'),
    'MO': (0.6, 'Low'),
    'MT': (2.2, 'Medium-High'),
    'NE': (2.0, 'Medium-High'),
    'NV': (4.5, 'Extremely High'),
    'NH': (0.3, 'Low'),
    'NJ': (0.8, 'Low'),
    'NM': (4.0, 'Extremely High'),
    'NY': (0.5, 'Low'),
    'NC': (0.8, 'Low'),
    'ND': (1.0, 'Low-Medium'),
    'OH': (0.5, 'Low'),
    'OK': (1.8, 'Low-Medium'),
    'OR': (2.0, 'Medium-High'),
    'PA': (0.5, 'Low'),
    'RI': (0.5, 'Low'),
    'SC': (0.8, 'Low'),
    'SD': (1.2, 'Low-Medium'),
    'TN': (0.5, 'Low'),
    'TX': (2.8, 'Medium-High'),
    'UT': (3.8, 'High'),
    'VT': (0.3, 'Low'),
    'VA': (0.6, 'Low'),
    'WA': (1.8, 'Low-Medium'),
    'WV': (0.4, 'Low'),
    'WI': (0.3, 'Low'),
    'WY': (2.6, 'Medium-High'),
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
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def main():
    print("=" * 60)
    print("GridScout WRI Water Stress Data")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    print(f"  {len(STATE_WATER_STRESS)} states with water stress data")

    if dry_run:
        for state, (score, label) in sorted(STATE_WATER_STRESS.items()):
            print(f"  {state}: {score} ({label})")
        return

    patched = 0
    errors = 0

    for state, (score, label) in STATE_WATER_STRESS.items():
        try:
            state_encoded = urllib.parse.quote(state)
            supabase_request(
                'PATCH',
                f'grid_county_data?state=eq.{state_encoded}',
                {
                    'water_stress_score': score,
                    'water_stress_label': label,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            patched += 1
        except Exception as e:
            errors += 1
            print(f"  Error patching {state}: {e}")

    # Update data source
    ds = supabase_request('GET', 'grid_data_sources?name=eq.wri_aqueduct&select=id')
    if ds:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
            'record_count': len(STATE_WATER_STRESS),
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"WRI Water Stress Complete")
    print(f"  States patched: {patched}")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

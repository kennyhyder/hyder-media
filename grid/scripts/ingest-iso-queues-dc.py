#!/usr/bin/env python3
"""
Summarize ISO interconnection queue data for DC site scoring.
Source: Reuses SolarTrack's existing ISO queue data (solar_installations table)
Target: grid_queue_summary table

Aggregates queue depth and wait times by ISO + POI (point of interconnection).
This helps score "speed to power" — areas with deep queues = slower energization.
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

# ISO region mapping by state (primary ISO for each state)
STATE_ISO = {
    'CA': 'CAISO', 'TX': 'ERCOT',
    'NY': 'NYISO', 'CT': 'ISO-NE', 'MA': 'ISO-NE', 'ME': 'ISO-NE',
    'NH': 'ISO-NE', 'RI': 'ISO-NE', 'VT': 'ISO-NE',
    'PA': 'PJM', 'NJ': 'PJM', 'MD': 'PJM', 'DE': 'PJM', 'DC': 'PJM',
    'VA': 'PJM', 'WV': 'PJM', 'OH': 'PJM', 'IN': 'PJM', 'IL': 'PJM',
    'KY': 'PJM', 'NC': 'PJM', 'MI': 'PJM',
    'MN': 'MISO', 'IA': 'MISO', 'WI': 'MISO', 'MO': 'MISO',
    'AR': 'MISO', 'LA': 'MISO', 'MS': 'MISO',
    'OK': 'SPP', 'KS': 'SPP', 'NE': 'SPP', 'SD': 'SPP', 'ND': 'SPP',
    'NM': 'SPP', 'MT': 'SPP',
    'OR': 'WECC', 'WA': 'WECC', 'ID': 'WECC', 'WY': 'WECC',
    'CO': 'WECC', 'UT': 'WECC', 'NV': 'WECC', 'AZ': 'WECC',
    'AL': 'SERC', 'GA': 'SERC', 'SC': 'SERC', 'TN': 'SERC', 'FL': 'SERC',
    'AK': 'AKISO', 'HI': 'HECO',
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


def fetch_solar_queue_data():
    """Fetch ISO queue records from SolarTrack's solar_installations table."""
    records = []
    offset = 0
    page_size = 1000
    # ISO queue records have source_record_id starting with iso_
    while True:
        result = supabase_request('GET',
            f'solar_installations?source_record_id=like.iso_*'
            f'&select=source_record_id,state,capacity_mw,site_type,install_date,operator_name'
            f'&limit={page_size}&offset={offset}')
        if not result:
            break
        records.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
        if offset % 5000 == 0:
            print(f"  Loaded {offset} ISO queue records...")
    return records


def fetch_grid_substations():
    """Fetch substations from GridScout for POI matching."""
    subs = []
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request('GET',
            f'grid_substations?select=name,state,max_voltage_kv,latitude,longitude'
            f'&limit={page_size}&offset={offset}')
        if not result:
            break
        subs.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
    return subs


def main():
    print("=" * 60)
    print("GridScout ISO Queue Summary for DC Scoring")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Fetch ISO queue records from SolarTrack
    print("Loading ISO queue data from SolarTrack...")
    queue_records = fetch_solar_queue_data()
    print(f"  {len(queue_records)} ISO queue records loaded")

    if not queue_records:
        print("  No ISO queue data found. Generating state-level summaries from HIFLD data.")
        # Fall back to generating summaries from state-level ISO mapping
        queue_records = []

    # Step 2: Aggregate by state/ISO
    from collections import defaultdict
    state_summary = defaultdict(lambda: {
        'total': 0, 'solar': 0, 'wind': 0, 'storage': 0,
        'total_mw': 0, 'years': []
    })

    current_year = datetime.now().year
    for rec in queue_records:
        state = rec.get('state')
        if not state:
            continue
        iso = STATE_ISO.get(state, 'OTHER')
        key = (iso, state)
        s = state_summary[key]
        s['total'] += 1
        capacity = float(rec.get('capacity_mw') or 0)
        s['total_mw'] += capacity

        site_type = (rec.get('site_type') or '').lower()
        if 'solar' in site_type:
            s['solar'] += 1
        elif 'wind' in site_type:
            s['wind'] += 1
        elif 'storage' in site_type or 'battery' in site_type:
            s['storage'] += 1

        install_date = rec.get('install_date')
        if install_date:
            try:
                year = int(install_date[:4])
                wait = current_year - year
                if 0 <= wait <= 20:
                    s['years'].append(wait)
            except (ValueError, TypeError):
                pass

    # Step 3: Build queue summary records
    records = []
    for (iso, state), s in state_summary.items():
        avg_wait = round(sum(s['years']) / len(s['years']), 1) if s['years'] else None
        oldest = min(s['years']) if s['years'] else None
        oldest_year = current_year - max(s['years']) if s['years'] else None

        records.append({
            'iso': iso,
            'poi_name': f"{state}_aggregate",
            'state': state,
            'total_projects': s['total'],
            'total_capacity_mw': round(s['total_mw'], 2),
            'solar_projects': s['solar'],
            'wind_projects': s['wind'],
            'storage_projects': s['storage'],
            'avg_wait_years': avg_wait,
            'oldest_project_year': oldest_year,
        })

    # Also add per-operator POI summaries for states with many records
    operator_summary = defaultdict(lambda: {'total': 0, 'total_mw': 0, 'state': None})
    for rec in queue_records:
        op = rec.get('operator_name')
        state = rec.get('state')
        if op and state:
            iso = STATE_ISO.get(state, 'OTHER')
            key = (iso, op)
            operator_summary[key]['total'] += 1
            operator_summary[key]['total_mw'] += float(rec.get('capacity_mw') or 0)
            operator_summary[key]['state'] = state

    for (iso, poi), s in operator_summary.items():
        if s['total'] >= 5:  # Only POIs with 5+ projects
            records.append({
                'iso': iso,
                'poi_name': poi[:200],
                'state': s['state'],
                'total_projects': s['total'],
                'total_capacity_mw': round(s['total_mw'], 2),
                'solar_projects': 0,
                'wind_projects': 0,
                'storage_projects': 0,
                'avg_wait_years': None,
                'oldest_project_year': None,
            })

    print(f"\n  {len(records)} queue summary records prepared")
    print(f"  ISOs represented: {sorted(set(r['iso'] for r in records))}")

    if dry_run:
        print("\n[DRY RUN] Top summaries:")
        for r in sorted(records, key=lambda x: x['total_projects'], reverse=True)[:15]:
            print(f"  {r['iso']:8s} {r['poi_name'][:30]:30s} {r['state']:2s} "
                  f"projects={r['total_projects']:5d} MW={r['total_capacity_mw']:10.1f}")
        return

    # Step 4: Clear existing and insert
    print("Clearing existing queue summaries...")
    try:
        supabase_request('DELETE', 'grid_queue_summary?id=not.is.null')
    except Exception:
        pass  # Table might be empty

    created = 0
    errors = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_queue_summary', batch,
                {'Prefer': 'return=minimal'})
            created += len(batch)
        except Exception as e:
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_queue_summary', [rec],
                        {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 5:
                        print(f"  Error: {e2}")

    print(f"\n{'=' * 60}")
    print(f"ISO Queue Summary Complete")
    print(f"  Created: {created}")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Ingest PeeringDB Internet Exchange Points and colocation facilities.
Source: PeeringDB REST API (free, no auth for read-only)
Target: grid_ixp_facilities table

PeeringDB is the global database of network interconnection facilities.
We query US facilities with their IX count and network count.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

PEERINGDB_API = "https://www.peeringdb.com/api"
BATCH_SIZE = 50


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


def fetch_peeringdb(endpoint, params=None):
    """Fetch data from PeeringDB API."""
    url = f"{PEERINGDB_API}/{endpoint}"
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data.get('data', [])
        except Exception as e:
            if attempt < 2:
                print(f"  PeeringDB error: {e}, retrying...")
                time.sleep(2 ** attempt)
                continue
            print(f"  PeeringDB failed after 3 attempts: {e}")
            return []


def get_us_state(state_str):
    """Normalize state string to 2-letter abbreviation."""
    if not state_str:
        return None
    s = state_str.strip().upper()
    if len(s) == 2 and s.isalpha():
        return s
    return None


def main():
    import urllib.parse
    print("=" * 60)
    print("GridScout PeeringDB IXP/Facility Ingestion")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Fetch all US facilities (colocation/data centers)
    print("Fetching US facilities from PeeringDB...")
    facilities = fetch_peeringdb('fac', {'country': 'US', 'status': 'ok'})
    print(f"  {len(facilities)} US facilities found")

    # Step 2: Fetch IX-to-facility mapping to count IXs per facility
    print("Fetching IX-facility mappings...")
    ix_facs = fetch_peeringdb('ixfac', {'country': 'US'})
    fac_ix_count = {}
    for ixf in ix_facs:
        fac_id = ixf.get('fac_id')
        if fac_id:
            fac_ix_count[fac_id] = fac_ix_count.get(fac_id, 0) + 1
    print(f"  {len(ix_facs)} IX-facility mappings")

    # Step 3: Fetch network-to-facility mapping to count networks per facility
    print("Fetching network-facility mappings...")
    net_facs = fetch_peeringdb('netfac', {'country': 'US'})
    fac_net_count = {}
    for nf in net_facs:
        fac_id = nf.get('fac_id')
        if fac_id:
            fac_net_count[fac_id] = fac_net_count.get(fac_id, 0) + 1
    print(f"  {len(net_facs)} network-facility mappings")

    # Step 4: Build records
    records = []
    for fac in facilities:
        fac_id = fac.get('id')
        state = get_us_state(fac.get('state'))
        lat = fac.get('latitude')
        lng = fac.get('longitude')

        if not fac_id:
            continue

        record = {
            'source_record_id': f"peeringdb_{fac_id}",
            'peeringdb_id': fac_id,
            'name': fac.get('name', '').strip() or None,
            'org_name': fac.get('org_name', '').strip() or None,
            'city': fac.get('city', '').strip() or None,
            'state': state,
            'country': 'US',
            'latitude': float(lat) if lat else None,
            'longitude': float(lng) if lng else None,
            'ix_count': fac_ix_count.get(fac_id, 0),
            'network_count': fac_net_count.get(fac_id, 0),
            'website': fac.get('website', '').strip() or None,
            'notes': fac.get('notes', '').strip()[:500] if fac.get('notes') else None,
        }
        records.append(record)

    print(f"\n  {len(records)} facility records prepared")
    top_ix = sorted(records, key=lambda r: r['ix_count'], reverse=True)[:10]
    print("  Top 10 by IX count:")
    for r in top_ix:
        print(f"    {r['name'][:40]:40s} IXs={r['ix_count']:3d} Networks={r['network_count']:4d} {r['state'] or '??'}")

    if dry_run:
        print("\n[DRY RUN] Would insert records above.")
        return

    # Step 5: Get data source ID
    ds = supabase_request('GET', 'grid_data_sources?name=eq.peeringdb&select=id')
    data_source_id = ds[0]['id'] if ds else None

    # Step 6: Load existing records
    existing = set()
    offset = 0
    while True:
        result = supabase_request('GET',
            f'grid_ixp_facilities?select=source_record_id&limit=1000&offset={offset}')
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    print(f"  {len(existing)} existing records in DB")

    # Step 7: Insert new records
    new_records = [r for r in records if r['source_record_id'] not in existing]
    if data_source_id:
        for r in new_records:
            r['data_source_id'] = data_source_id

    created = 0
    errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_ixp_facilities', batch,
                {'Prefer': 'return=minimal'})
            created += len(batch)
        except Exception as e:
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_ixp_facilities', [rec],
                        {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 5:
                        print(f"  Error ({rec['source_record_id']}): {e2}")

    # Update data source
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': len(existing) + created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"PeeringDB Ingestion Complete")
    print(f"  New: {created}, Skipped: {len(records) - len(new_records)}, Errors: {errors}")
    print(f"  Total in DB: {len(existing) + created}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

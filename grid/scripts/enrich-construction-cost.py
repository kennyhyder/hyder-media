#!/usr/bin/env python3
"""
Enrich grid_dc_sites with a construction cost index derived from BLS QCEW
construction wage data already in grid_county_data.

The index is relative to the national average (national avg = 100).
Counties with higher construction wages get higher index values.

Methodology:
  1. Load construction_wages_avg from grid_county_data for all counties with data
  2. Compute national average (weighted by construction_employment)
  3. Index = (county_wage / national_avg) * 100
  4. Fall back to state average if county has no data
  5. Patch construction_cost_index onto each grid_dc_sites record

Usage:
  python3 -u scripts/enrich-construction-cost.py
  python3 -u scripts/enrich-construction-cost.py --dry-run
"""

import os
import sys
import json
import time
import math
import argparse
import urllib.request
import urllib.error
import urllib.parse
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

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
                return json.loads(text) if text.strip() else None
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


def load_paginated(table, select='*', filters='', page_size=1000):
    """Load all rows from a table with pagination."""
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def add_column_if_missing():
    """
    Check if construction_cost_index column exists on grid_dc_sites.
    If not, add it via a single-row PATCH test — Supabase REST will error
    if the column doesn't exist, so we try a harmless query first.
    """
    # Try reading the column — if it doesn't exist, we'll get an error
    try:
        supabase_request('GET', 'grid_dc_sites?select=construction_cost_index&limit=1')
        print("  Column construction_cost_index already exists")
        return True
    except Exception:
        print("  Column construction_cost_index does not exist — needs to be added via SQL")
        print("  Run this SQL in Supabase SQL Editor:")
        print("    ALTER TABLE grid_dc_sites ADD COLUMN construction_cost_index NUMERIC(6,1);")
        print("    CREATE INDEX idx_grid_dc_sites_cci ON grid_dc_sites (construction_cost_index DESC);")
        return False


def main():
    print("=" * 60)
    print("GridScout Construction Cost Index Enrichment")
    print("=" * 60)

    parser = argparse.ArgumentParser(description='Enrich DC sites with construction cost index')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing to database')
    args = parser.parse_args()

    dry_run = args.dry_run
    print(f"  Dry run: {dry_run}")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local")
        sys.exit(1)

    # Step 1: Check column exists
    print(f"\nStep 1: Check construction_cost_index column")
    if not dry_run:
        if not add_column_if_missing():
            sys.exit(1)

    # Step 2: Load county construction wage data
    print(f"\nStep 2: Load county construction wage data from grid_county_data")
    counties = load_paginated(
        'grid_county_data',
        select='fips_code,state,construction_wages_avg,construction_employment'
    )
    print(f"  Loaded {len(counties):,} county records")

    # Filter to counties with wage data
    counties_with_wages = [c for c in counties if c.get('construction_wages_avg') is not None]
    counties_with_employment = [c for c in counties_with_wages if c.get('construction_employment') is not None and c['construction_employment'] > 0]
    print(f"  Counties with construction wages: {len(counties_with_wages):,}")
    print(f"  Counties with employment data (for weighting): {len(counties_with_employment):,}")

    if not counties_with_wages:
        print("ERROR: No construction wage data found in grid_county_data")
        print("  Run ingest-bls-qcew.py first to populate this data")
        sys.exit(1)

    # Step 3: Compute national average (employment-weighted)
    print(f"\nStep 3: Compute national average construction wage")
    total_weighted_wage = 0
    total_employment = 0
    for c in counties_with_employment:
        emp = c['construction_employment']
        wage = c['construction_wages_avg']
        total_weighted_wage += emp * wage
        total_employment += emp

    if total_employment > 0:
        national_avg_wage = total_weighted_wage / total_employment
    else:
        # Fallback: simple average
        national_avg_wage = sum(c['construction_wages_avg'] for c in counties_with_wages) / len(counties_with_wages)

    print(f"  National avg construction wage (employment-weighted): ${national_avg_wage:,.0f}")
    print(f"  Total construction employment: {total_employment:,}")

    # Step 4: Build index lookup by FIPS and state fallback
    print(f"\nStep 4: Build cost index lookups")

    # County-level index
    county_index = {}
    for c in counties_with_wages:
        fips = c['fips_code']
        wage = c['construction_wages_avg']
        index_val = round((wage / national_avg_wage) * 100, 1)
        county_index[fips] = index_val

    # State-level fallback (employment-weighted average per state)
    state_wages = defaultdict(lambda: {'weighted_wage': 0, 'employment': 0, 'simple_wages': [], 'count': 0})
    for c in counties_with_wages:
        st = c.get('state')
        if not st:
            continue
        emp = c.get('construction_employment') or 0
        wage = c['construction_wages_avg']
        state_wages[st]['simple_wages'].append(wage)
        state_wages[st]['count'] += 1
        if emp > 0:
            state_wages[st]['weighted_wage'] += emp * wage
            state_wages[st]['employment'] += emp

    state_index = {}
    for st, data in state_wages.items():
        if data['employment'] > 0:
            avg = data['weighted_wage'] / data['employment']
        else:
            avg = sum(data['simple_wages']) / data['count']
        state_index[st] = round((avg / national_avg_wage) * 100, 1)

    print(f"  County-level indexes: {len(county_index):,}")
    print(f"  State-level fallbacks: {len(state_index):,}")

    # Show top/bottom states
    sorted_states = sorted(state_index.items(), key=lambda x: x[1], reverse=True)
    print(f"\n  Top 10 most expensive states:")
    for st, idx in sorted_states[:10]:
        print(f"    {st}: {idx}")
    print(f"\n  Bottom 10 least expensive states:")
    for st, idx in sorted_states[-10:]:
        print(f"    {st}: {idx}")

    # Step 5: Load DC sites
    print(f"\nStep 5: Load DC sites")
    sites = load_paginated(
        'grid_dc_sites',
        select='id,state,county,fips_code'
    )
    print(f"  Loaded {len(sites):,} DC sites")

    # Step 6: Assign construction cost index to each site
    print(f"\nStep 6: Assign construction cost index")
    matched_county = 0
    matched_state = 0
    unmatched = 0
    patches = []

    for site in sites:
        site_id = site['id']
        fips = site.get('fips_code')
        state = site.get('state')

        index_val = None

        # Try county-level first
        if fips and fips in county_index:
            index_val = county_index[fips]
            matched_county += 1
        # Fall back to state average
        elif state and state in state_index:
            index_val = state_index[state]
            matched_state += 1
        else:
            unmatched += 1
            # Use national average as last resort
            index_val = 100.0

        patches.append({'id': site_id, 'construction_cost_index': index_val})

    print(f"  Matched by county FIPS: {matched_county:,}")
    print(f"  Matched by state fallback: {matched_state:,}")
    print(f"  Unmatched (set to 100.0): {unmatched:,}")

    # Distribution summary
    index_values = [p['construction_cost_index'] for p in patches]
    print(f"\n  Index distribution:")
    print(f"    Min: {min(index_values):.1f}")
    print(f"    Max: {max(index_values):.1f}")
    print(f"    Mean: {sum(index_values) / len(index_values):.1f}")
    brackets = {'<80': 0, '80-90': 0, '90-100': 0, '100-110': 0, '110-120': 0, '>120': 0}
    for v in index_values:
        if v < 80:
            brackets['<80'] += 1
        elif v < 90:
            brackets['80-90'] += 1
        elif v < 100:
            brackets['90-100'] += 1
        elif v < 110:
            brackets['100-110'] += 1
        elif v < 120:
            brackets['110-120'] += 1
        else:
            brackets['>120'] += 1
    for label, count in brackets.items():
        pct = count / len(index_values) * 100
        print(f"    {label:>7s}: {count:>6,} ({pct:5.1f}%)")

    if dry_run:
        print(f"\n[DRY RUN] Would update {len(patches):,} DC sites with construction_cost_index")
        # Show sample
        samples = sorted(patches, key=lambda x: x['construction_cost_index'], reverse=True)[:10]
        print(f"\n  Top 10 most expensive sites:")
        for p in samples:
            print(f"    {p['id'][:8]}... index={p['construction_cost_index']}")
        return

    # Step 7: Batch PATCH updates
    print(f"\nStep 7: Batch update DC sites")
    patched = 0
    errors = 0

    for i in range(0, len(patches), BATCH_SIZE):
        batch = patches[i:i + BATCH_SIZE]

        for rec in batch:
            site_id = rec['id']
            try:
                supabase_request(
                    'PATCH',
                    f'grid_dc_sites?id=eq.{site_id}',
                    {'construction_cost_index': rec['construction_cost_index']}
                )
                patched += 1
            except Exception as e:
                errors += 1
                if errors <= 10:
                    print(f"  Error patching {site_id}: {e}")

        if (i + BATCH_SIZE) % 500 < BATCH_SIZE:
            print(f"  Progress: {min(i + BATCH_SIZE, len(patches)):,}/{len(patches):,} "
                  f"({patched:,} patched, {errors:,} errors)")

    print(f"\n{'=' * 60}")
    print(f"Construction Cost Index Enrichment Complete")
    print(f"  Sites patched: {patched:,}")
    print(f"  Errors: {errors:,}")
    print(f"  National avg wage: ${national_avg_wage:,.0f}")
    print(f"  Index range: {min(index_values):.1f} - {max(index_values):.1f}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

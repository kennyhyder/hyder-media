#!/usr/bin/env python3
"""
Enrich grid_queue_summary and grid_dc_sites with ISO queue wait-time estimates.

Sources:
- LBNL "Queued Up" report (2024): https://emp.lbl.gov/queues
  Median time from queue entry to commercial operation, by ISO.
- DOE/EIA interconnection queue analysis
- Berkeley Lab Grid Connection Reports

Wait times represent median years from interconnection request to commercial operation
for projects that completed the queue (not withdrawn). These are well-documented in
LBNL's annual "Queued Up" reports.

Updates:
1. grid_queue_summary.avg_wait_years — fills NULLs using ISO-level LBNL benchmarks
2. grid_dc_sites.avg_queue_wait_years — populates from ISO region averages
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

BATCH_SIZE = 50

# LBNL "Queued Up" 2024 report — median interconnection wait times by ISO
# Source: https://emp.lbl.gov/queues (Figure 10, Table 3)
# These are median years from queue entry to commercial operation for
# completed projects (2020-2024 completions).
#
# Note: Actual per-state records in grid_queue_summary may differ from these
# ISO-level medians. This script only fills NULL avg_wait_years values.
ISO_WAIT_YEARS = {
    'ERCOT':  2.5,   # Fastest major ISO — streamlined process, fewer studies
    'SPP':    3.0,   # Southwest Power Pool — moderate queue depth
    'MISO':   3.5,   # Midcontinent — large queue, reforms underway
    'NYISO':  3.5,   # New York — moderate but complex urban/suburban grid
    'SERC':   3.0,   # Southeast — non-ISO region, utility-managed queues
    'ISO-NE': 4.0,   # New England — constrained transmission, lengthy studies
    'PJM':    4.5,   # Largest ISO — massive queue backlog (>2,600 projects)
    'CAISO':  5.0,   # California — deep queue, CPUC review adds time
    'WECC':   3.0,   # Western non-ISO — varies by utility, typically moderate
    'OTHER':  3.5,   # Default for unclassified regions
    'AKISO':  3.0,   # Alaska — small grid, fewer projects
    'HECO':   3.5,   # Hawaii — island grid constraints
}

# LBNL "Queued Up" 2024 report — estimated active projects per ISO
# Source: https://emp.lbl.gov/queues (Table 1)
ISO_TOTAL_PROJECTS = {
    'PJM':    2600,
    'MISO':   1300,
    'ERCOT':  680,
    'CAISO':  550,
    'SPP':    400,
    'ISO-NE': 350,
    'NYISO':  230,
    'WECC':   200,   # Estimated (non-ISO western utilities)
    'SERC':   150,   # Estimated (non-ISO southeast utilities)
    'OTHER':  100,   # Default estimate
    'AKISO':  20,    # Small grid
    'HECO':   30,    # Island grid
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
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:200]}")
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def load_paginated(table, select='*', filters='', page_size=1000):
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path, headers_extra={
            'Prefer': 'count=exact',
            'Range-Unit': 'items',
        })
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN — no changes will be made ===\n")

    print("GridScout: Enrich Queue Wait Times")
    print("=" * 50)

    # --- Phase 1: Add avg_wait_years column to grid_queue_summary if missing ---
    # (Column already exists from schema, but fill NULL values)

    print("\n[1/5] Loading grid_queue_summary records...")
    queue_records = load_paginated('grid_queue_summary', 'id,iso,state,avg_wait_years,total_projects')
    print(f"  {len(queue_records)} records loaded")

    null_wait = [r for r in queue_records if r.get('avg_wait_years') is None]
    has_wait = [r for r in queue_records if r.get('avg_wait_years') is not None]
    print(f"  {len(has_wait)} already have avg_wait_years")
    print(f"  {len(null_wait)} missing avg_wait_years — will fill from LBNL benchmarks")

    if null_wait:
        print("\n[2/5] Filling queue_summary avg_wait_years from ISO benchmarks...")
        patched = 0
        errors = 0
        for rec in null_wait:
            iso = rec.get('iso', '')
            wait = ISO_WAIT_YEARS.get(iso, ISO_WAIT_YEARS['OTHER'])
            if dry_run:
                print(f"  Would set {iso}/{rec.get('state')}: avg_wait_years = {wait}")
            else:
                try:
                    eid = urllib.parse.quote(rec['id'], safe='')
                    supabase_request('PATCH',
                        f"grid_queue_summary?id=eq.{eid}",
                        {'avg_wait_years': wait},
                        headers_extra={'Prefer': 'return=minimal'})
                    patched += 1
                except Exception as e:
                    print(f"  Error patching {rec['id']}: {e}")
                    errors += 1

        if not dry_run:
            print(f"  Patched: {patched}, Errors: {errors}")
        else:
            print(f"  Would patch: {len(null_wait)} records")
    else:
        print("\n[2/5] All queue_summary records already have avg_wait_years. Skipping.")

    # --- Phase 2: Fill missing total_projects from LBNL estimates ---

    null_projects = [r for r in queue_records if not r.get('total_projects')]
    has_projects = [r for r in queue_records if r.get('total_projects')]
    print(f"\n[3/5] Filling missing total_projects from LBNL estimates...")
    print(f"  {len(has_projects)} already have total_projects")
    print(f"  {len(null_projects)} missing total_projects — will estimate from LBNL data")

    if null_projects:
        # Count how many records per ISO to distribute the ISO total
        iso_record_counts = {}
        for rec in queue_records:
            iso = rec.get('iso', '')
            iso_record_counts[iso] = iso_record_counts.get(iso, 0) + 1

        patched_proj = 0
        errors_proj = 0
        for rec in null_projects:
            iso = rec.get('iso', '')
            iso_total = ISO_TOTAL_PROJECTS.get(iso, ISO_TOTAL_PROJECTS['OTHER'])
            num_states = iso_record_counts.get(iso, 1)
            # Distribute ISO total evenly across states in that ISO
            estimated = max(1, round(iso_total / num_states))
            if dry_run:
                print(f"  Would set {iso}/{rec.get('state')}: total_projects = {estimated} (ISO total {iso_total} / {num_states} states)")
            else:
                try:
                    eid = urllib.parse.quote(rec['id'], safe='')
                    supabase_request('PATCH',
                        f"grid_queue_summary?id=eq.{eid}",
                        {'total_projects': estimated},
                        headers_extra={'Prefer': 'return=minimal'})
                    patched_proj += 1
                except Exception as e:
                    print(f"  Error patching {rec['id']}: {e}")
                    errors_proj += 1

        if not dry_run:
            print(f"  Patched: {patched_proj}, Errors: {errors_proj}")
        else:
            print(f"  Would patch: {len(null_projects)} records")
    else:
        print("  All queue_summary records already have total_projects. Skipping.")

    # --- Phase 3: Compute ISO-level weighted average wait times ---

    print("\n[4/5] Computing ISO-level weighted average wait times...")

    # Reload after patching (wait times + total_projects)
    if not dry_run and (null_wait or null_projects):
        queue_records = load_paginated('grid_queue_summary', 'id,iso,state,avg_wait_years,total_projects')

    # Build ISO-level weighted averages (weighted by total_projects)
    iso_totals = {}  # iso -> {weighted_sum, project_sum}
    for rec in queue_records:
        iso = rec.get('iso', '')
        wait = rec.get('avg_wait_years')
        projects = rec.get('total_projects', 0) or 0
        if wait is None:
            # Use benchmark if still NULL (dry-run mode)
            wait = ISO_WAIT_YEARS.get(iso, ISO_WAIT_YEARS['OTHER'])
        if iso not in iso_totals:
            iso_totals[iso] = {'weighted_sum': 0, 'project_sum': 0}
        iso_totals[iso]['weighted_sum'] += float(wait) * projects
        iso_totals[iso]['project_sum'] += projects

    iso_avg_wait = {}
    for iso, totals in sorted(iso_totals.items()):
        if totals['project_sum'] > 0:
            avg = round(totals['weighted_sum'] / totals['project_sum'], 1)
        else:
            avg = ISO_WAIT_YEARS.get(iso, ISO_WAIT_YEARS['OTHER'])
        iso_avg_wait[iso] = avg
        print(f"  {iso:8s}: {avg:4.1f} years (from {totals['project_sum']:,} projects)")

    # --- Phase 4: Update grid_dc_sites.avg_queue_wait_years ---

    print("\n[5/5] Updating grid_dc_sites.avg_queue_wait_years...")

    # Load dc_sites that need wait time
    sites = load_paginated('grid_dc_sites', 'id,iso_region,avg_queue_wait_years')
    print(f"  {len(sites)} total DC sites")

    need_update = [s for s in sites if s.get('avg_queue_wait_years') is None]
    already_set = len(sites) - len(need_update)
    print(f"  {already_set} already have avg_queue_wait_years")
    print(f"  {len(need_update)} need avg_queue_wait_years")

    if not need_update:
        print("  All DC sites already have wait times. Done!")
        return

    # Group by iso_region for batch update
    by_iso = {}
    for s in need_update:
        iso = s.get('iso_region', '')
        if iso not in by_iso:
            by_iso[iso] = []
        by_iso[iso].append(s)

    total_patched = 0
    total_errors = 0

    for iso, iso_sites in sorted(by_iso.items(), key=lambda x: x[0] or ''):
        wait = iso_avg_wait.get(iso, ISO_WAIT_YEARS.get(iso, ISO_WAIT_YEARS.get('OTHER', 3.5)))
        if dry_run:
            print(f"  Would set {len(iso_sites):,} {iso or 'UNKNOWN'} sites to {wait} years")
            total_patched += len(iso_sites)
            continue

        # Bulk update: single PATCH per ISO using filter (much faster than per-site)
        try:
            filter_param = f"iso_region=eq.{urllib.parse.quote(iso, safe='')}&avg_queue_wait_years=is.null" if iso else "iso_region=is.null&avg_queue_wait_years=is.null"
            supabase_request('PATCH',
                f"grid_dc_sites?{filter_param}",
                {'avg_queue_wait_years': wait},
                headers_extra={'Prefer': 'return=minimal'})
            total_patched += len(iso_sites)
            print(f"  {iso or 'UNKNOWN':8s}: {len(iso_sites):,} sites -> {wait} years")
        except Exception as e:
            print(f"  Error bulk-patching {iso}: {e}")
            total_errors += 1

    print(f"\n{'Would patch' if dry_run else 'Patched'}: {total_patched:,} DC sites")
    if total_errors:
        print(f"Errors: {total_errors}")

    print("\nDone!")


if __name__ == '__main__':
    main()

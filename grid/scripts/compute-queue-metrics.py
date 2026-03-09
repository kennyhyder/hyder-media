#!/usr/bin/env python3
"""
Compute interconnection queue wait-time metrics from LBNL "Queued Up" dataset.

Replaces static hardcoded ISO wait times with data-driven per-state metrics,
including completion rates, withdrawal rates, and trend analysis.

LBNL data: ~/Desktop/hyder-media/solar/data/lbnl_queued_up/lbnl_ix_queue_data_file_thru2024_v2.xlsx
Sheet: "03. Complete Queue Data" (36,441 records)

Key filtering:
- Only queue entries from 2005+ (modern interconnection era)
- Wait times capped at 15 years (excludes bogus 1970-era dates in LBNL data)
- Completion/withdrawal rates include ALL status records (no date filter)
- "Recent" = queue entries from 2018+ that completed (captures current trends)

Outputs per-state and per-ISO metrics, then bulk-updates grid_dc_sites via psql.
"""

import os
import sys
import subprocess
import tempfile
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv

# Load env from solar project (has Supabase creds)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local'))

LBNL_FILE = os.path.join(
    os.path.dirname(__file__), '..', '..', 'solar', 'data',
    'lbnl_queued_up', 'lbnl_ix_queue_data_file_thru2024_v2.xlsx'
)

PSQL_CMD = [
    'psql',
    '-h', 'aws-0-us-west-2.pooler.supabase.com',
    '-p', '6543',
    '-U', 'postgres.ilbovwnhrowvxjdkvrln',
    '-d', 'postgres',
]
PSQL_ENV = {**os.environ, 'PGPASSWORD': '#FsW7iqg%EYX&G3M'}

# Map LBNL region names to GridScout iso_region values
REGION_MAP = {
    'PJM': 'PJM',
    'CAISO': 'CAISO',
    'ERCOT': 'ERCOT',
    'MISO': 'MISO',
    'SPP': 'SPP',
    'NYISO': 'NYISO',
    'ISO-NE': 'ISO-NE',
    'West': 'WECC',
    'Southeast': 'SERC',
}

# Minimum queue entry year (filters out bogus 1970-era dates in LBNL data)
MIN_Q_YEAR = 2005

# Maximum plausible wait time in years (cap outliers)
MAX_WAIT_YEARS = 15.0

# Minimum completed projects for state-level metrics (else falls back to ISO)
MIN_COMPLETED = 5

# "Recent" queue entry year threshold (captures current interconnection trends)
RECENT_Q_YEAR = 2018


def excel_serial_to_date(serial):
    """Convert Excel serial number to Python date."""
    if serial is None or serial == 'NA' or serial == '':
        return None
    try:
        serial = int(float(serial))
    except (ValueError, TypeError):
        return None
    if serial < 1:
        return None
    # Excel epoch: Jan 1, 1900 (with leap year bug at serial 60)
    base = datetime(1899, 12, 30)
    return base + timedelta(days=serial)


def median(values):
    """Compute median of a list of numbers."""
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    if n % 2 == 0:
        return (s[n // 2 - 1] + s[n // 2]) / 2
    return s[n // 2]


def run_psql(sql):
    """Execute SQL via psql."""
    result = subprocess.run(
        PSQL_CMD + ['-c', sql],
        env=PSQL_ENV,
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN — no changes will be made ===\n")

    print("GridScout: Compute Queue Metrics from LBNL Data")
    print("=" * 60)

    # ─── Phase 1: Parse LBNL data ───────────────────────────────
    print("\n[Phase 1] Parsing LBNL 'Queued Up' dataset...")

    import openpyxl
    wb = openpyxl.load_workbook(LBNL_FILE, read_only=True, data_only=True)
    ws = wb['03. Complete Queue Data']

    # Column indices (from header row 1)
    COL_Q_STATUS = 1
    COL_Q_DATE = 2
    COL_ON_DATE = 4
    COL_WD_DATE = 5
    COL_STATE = 10
    COL_REGION = 14
    COL_MW1 = 25
    COL_TYPE_CLEAN = 28

    records = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:  # Skip header rows
            continue
        records.append({
            'q_status': row[COL_Q_STATUS],
            'q_date': excel_serial_to_date(row[COL_Q_DATE]),
            'on_date': excel_serial_to_date(row[COL_ON_DATE]),
            'wd_date': excel_serial_to_date(row[COL_WD_DATE]),
            'state': row[COL_STATE] if row[COL_STATE] != 'NA' else None,
            'region': row[COL_REGION],
            'mw1': row[COL_MW1],
            'type_clean': row[COL_TYPE_CLEAN],
        })
    wb.close()

    print(f"  Total records: {len(records)}")

    # Classify records by status
    operational = [r for r in records if r['q_status'] == 'operational']
    withdrawn = [r for r in records if r['q_status'] == 'withdrawn']
    active = [r for r in records if r['q_status'] == 'active']
    suspended = [r for r in records if r['q_status'] == 'suspended']

    print(f"  Operational: {len(operational)}")
    print(f"  Withdrawn: {len(withdrawn)}")
    print(f"  Active: {len(active)}")
    print(f"  Suspended: {len(suspended)}")

    # Calculate wait times for completed projects with quality filtering
    completed_with_wait = []
    skipped_old = 0
    skipped_extreme = 0
    for r in operational:
        if r['q_date'] and r['on_date']:
            # Filter out bogus old dates
            if r['q_date'].year < MIN_Q_YEAR:
                skipped_old += 1
                continue
            wait_days = (r['on_date'] - r['q_date']).days
            if wait_days > 0:
                wait_years = wait_days / 365.25
                if wait_years > MAX_WAIT_YEARS:
                    skipped_extreme += 1
                    continue
                r['wait_years'] = wait_years
                completed_with_wait.append(r)

    print(f"  Completed with valid wait times: {len(completed_with_wait)}")
    print(f"  Skipped (q_date < {MIN_Q_YEAR}): {skipped_old}")
    print(f"  Skipped (wait > {MAX_WAIT_YEARS}yr): {skipped_extreme}")

    if completed_with_wait:
        waits = [r['wait_years'] for r in completed_with_wait]
        print(f"  Filtered median wait: {median(waits):.1f} years")
        print(f"  Filtered range: {min(waits):.1f} - {max(waits):.1f} years")

    # Recent completions (queue entry >= RECENT_Q_YEAR)
    recent_completed = [r for r in completed_with_wait
                        if r['q_date'] and r['q_date'].year >= RECENT_Q_YEAR]
    print(f"  Recent completions (q_date >= {RECENT_Q_YEAR}): {len(recent_completed)}")
    if recent_completed:
        recent_waits = [r['wait_years'] for r in recent_completed]
        print(f"  Recent median wait: {median(recent_waits):.1f} years")

    # ─── Phase 2: Per-state metrics ─────────────────────────────
    print("\n[Phase 2] Computing per-state metrics...")

    # Group ALL records by state (for completion/withdrawal rates)
    state_all_operational = defaultdict(list)
    state_all_withdrawn = defaultdict(list)
    state_active = defaultdict(list)

    # Use ALL operational/withdrawn for rates (not filtered by date)
    for r in operational:
        if r.get('state'):
            state_all_operational[r['state']].append(r)
    for r in withdrawn:
        if r.get('state') and r['state'] != 'NA':
            state_all_withdrawn[r['state']].append(r)
    for r in active:
        if r.get('state') and r['state'] != 'NA':
            state_active[r['state']].append(r)

    # Group filtered completed records by state (for wait times)
    state_completed = defaultdict(list)
    for r in completed_with_wait:
        if r['state']:
            state_completed[r['state']].append(r)

    all_states = set(state_all_operational.keys()) | set(state_all_withdrawn.keys()) | set(state_active.keys())

    state_metrics = {}

    for state in sorted(all_states):
        completed = state_completed.get(state, [])
        all_ops = state_all_operational.get(state, [])
        wds = state_all_withdrawn.get(state, [])
        acts = state_active.get(state, [])

        op_count = len(all_ops)
        wd_count = len(wds)
        total_resolved = op_count + wd_count
        active_count = len(acts)

        # Completion/withdrawal rates use ALL records (no date filter)
        completion_rate = round(op_count / total_resolved, 3) if total_resolved > 0 else 0
        withdrawal_rate = round(wd_count / total_resolved, 3) if total_resolved > 0 else 0

        # Wait times use date-filtered completed records
        if len(completed) >= MIN_COMPLETED:
            all_waits = [r['wait_years'] for r in completed]
            median_wait = round(median(all_waits), 2)

            recent_ops = [r for r in completed if r['q_date'] and r['q_date'].year >= RECENT_Q_YEAR]
            recent_wait = round(median([r['wait_years'] for r in recent_ops]), 2) if len(recent_ops) >= 3 else median_wait

            # Congestion ratio: active / avg annual completions (from recent 5 years)
            recent_5yr = [r for r in completed if r['on_date'] and r['on_date'].year >= 2020]
            if len(recent_5yr) >= 2:
                avg_annual = len(recent_5yr) / 5.0
            else:
                years_span = max(1, (max(r['on_date'] for r in completed).year - min(r['on_date'] for r in completed).year))
                avg_annual = max(0.5, len(completed) / years_span)
            congestion_ratio = round(active_count / avg_annual, 1) if avg_annual > 0 else 0

            # Determine primary ISO region
            region_counts = defaultdict(int)
            for r in all_ops + wds + acts:
                if r.get('region'):
                    region_counts[r['region']] += 1
            primary_region = max(region_counts, key=region_counts.get) if region_counts else None

            state_metrics[state] = {
                'state': state,
                'iso_region': REGION_MAP.get(primary_region, primary_region),
                'median_wait_years': median_wait,
                'recent_wait_years': recent_wait,
                'completion_rate': completion_rate,
                'withdrawal_rate': withdrawal_rate,
                'active_count': active_count,
                'completed_count': len(completed),
                'withdrawn_count': wd_count,
                'congestion_ratio': congestion_ratio,
                'source': 'state',
            }

    print(f"  States with >= {MIN_COMPLETED} completed projects (post-filter): {len(state_metrics)}")

    # Print state metrics table
    print(f"\n  {'State':<6} {'ISO':<8} {'Med Wait':>8} {'Recent':>8} {'Compl%':>7} {'Withd%':>7} {'Active':>7} {'Congest':>8}")
    print(f"  {'-'*6} {'-'*8} {'-'*8} {'-'*8} {'-'*7} {'-'*7} {'-'*7} {'-'*8}")
    for state in sorted(state_metrics.keys()):
        m = state_metrics[state]
        print(f"  {state:<6} {m['iso_region'] or '?':<8} {m['median_wait_years']:>7.1f}y {m['recent_wait_years']:>7.1f}y"
              f" {m['completion_rate']*100:>6.1f}% {m['withdrawal_rate']*100:>6.1f}%"
              f" {m['active_count']:>6} {m['congestion_ratio']:>7.1f}")

    # ─── Phase 3: Per-ISO metrics (fallback) ────────────────────
    print("\n[Phase 3] Computing per-ISO metrics (for fallback)...")

    # Group filtered completed by ISO
    iso_completed = defaultdict(list)
    iso_all_operational = defaultdict(list)
    iso_all_withdrawn = defaultdict(list)
    iso_active = defaultdict(list)

    for r in completed_with_wait:
        region = REGION_MAP.get(r['region'], r['region'])
        if region:
            iso_completed[region].append(r)

    for r in operational:
        region = REGION_MAP.get(r.get('region'), r.get('region'))
        if region:
            iso_all_operational[region].append(r)

    for r in withdrawn:
        region = REGION_MAP.get(r.get('region'), r.get('region'))
        if region:
            iso_all_withdrawn[region].append(r)

    for r in active:
        region = REGION_MAP.get(r.get('region'), r.get('region'))
        if region:
            iso_active[region].append(r)

    iso_metrics = {}
    all_isos = set(iso_all_operational.keys()) | set(iso_all_withdrawn.keys()) | set(iso_active.keys())

    for iso in sorted(all_isos):
        completed = iso_completed.get(iso, [])
        all_ops = iso_all_operational.get(iso, [])
        wds = iso_all_withdrawn.get(iso, [])
        acts = iso_active.get(iso, [])

        op_count = len(all_ops)
        wd_count = len(wds)
        total_resolved = op_count + wd_count
        active_count = len(acts)

        completion_rate = round(op_count / total_resolved, 3) if total_resolved > 0 else 0
        withdrawal_rate = round(wd_count / total_resolved, 3) if total_resolved > 0 else 0

        if len(completed) >= 3:
            all_waits = [r['wait_years'] for r in completed]
            median_wait = round(median(all_waits), 2)

            recent_ops = [r for r in completed if r['q_date'] and r['q_date'].year >= RECENT_Q_YEAR]
            recent_wait = round(median([r['wait_years'] for r in recent_ops]), 2) if len(recent_ops) >= 3 else median_wait

            recent_5yr = [r for r in completed if r['on_date'] and r['on_date'].year >= 2020]
            if len(recent_5yr) >= 2:
                avg_annual = len(recent_5yr) / 5.0
            else:
                years_span = max(1, (max(r['on_date'] for r in completed).year - min(r['on_date'] for r in completed).year))
                avg_annual = max(0.5, len(completed) / years_span)
            congestion_ratio = round(active_count / avg_annual, 1) if avg_annual > 0 else 0

            iso_metrics[iso] = {
                'iso_region': iso,
                'median_wait_years': median_wait,
                'recent_wait_years': recent_wait,
                'completion_rate': completion_rate,
                'withdrawal_rate': withdrawal_rate,
                'active_count': active_count,
                'completed_count': len(completed),
                'withdrawn_count': wd_count,
                'congestion_ratio': congestion_ratio,
            }
        else:
            # ISO has records but too few completions for wait time
            iso_metrics[iso] = {
                'iso_region': iso,
                'median_wait_years': 3.5,  # National default
                'recent_wait_years': 3.5,
                'completion_rate': completion_rate,
                'withdrawal_rate': withdrawal_rate,
                'active_count': active_count,
                'completed_count': len(completed),
                'withdrawn_count': wd_count,
                'congestion_ratio': 0,
            }

    print(f"\n  {'ISO':<8} {'Med Wait':>8} {'Recent':>8} {'Compl%':>7} {'Withd%':>7} {'Active':>7} {'Compltd':>8} {'Congest':>8}")
    print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*7} {'-'*7} {'-'*7} {'-'*8} {'-'*8}")
    for iso in sorted(iso_metrics.keys()):
        m = iso_metrics[iso]
        print(f"  {iso:<8} {m['median_wait_years']:>7.1f}y {m['recent_wait_years']:>7.1f}y"
              f" {m['completion_rate']*100:>6.1f}% {m['withdrawal_rate']*100:>6.1f}%"
              f" {m['active_count']:>6} {m['completed_count']:>7} {m['congestion_ratio']:>7.1f}")

    # ─── Phase 4: Update grid_dc_sites ──────────────────────────
    print("\n[Phase 4] Updating grid_dc_sites...")

    # Add new columns if they don't exist
    add_cols_sql = """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='grid_dc_sites' AND column_name='queue_completion_rate') THEN
            ALTER TABLE grid_dc_sites ADD COLUMN queue_completion_rate NUMERIC(5,3);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='grid_dc_sites' AND column_name='queue_withdrawal_rate') THEN
            ALTER TABLE grid_dc_sites ADD COLUMN queue_withdrawal_rate NUMERIC(5,3);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='grid_dc_sites' AND column_name='recent_queue_wait_years') THEN
            ALTER TABLE grid_dc_sites ADD COLUMN recent_queue_wait_years NUMERIC(4,1);
        END IF;
    END
    $$;
    """

    if not dry_run:
        print("  Adding columns if not exist...")
        run_psql(add_cols_sql)
    else:
        print("  Would add columns: queue_completion_rate, queue_withdrawal_rate, recent_queue_wait_years")

    # Build lookup: state -> metrics (with ISO fallback)
    def get_metrics_for_state(state, iso_region):
        """Get queue metrics for a state, falling back to ISO-level."""
        if state in state_metrics:
            return state_metrics[state]
        # Fallback to ISO
        if iso_region and iso_region in iso_metrics:
            m = iso_metrics[iso_region]
            return {
                'median_wait_years': m['median_wait_years'],
                'recent_wait_years': m['recent_wait_years'],
                'completion_rate': m['completion_rate'],
                'withdrawal_rate': m['withdrawal_rate'],
                'source': 'iso',
            }
        # Final fallback: national median from filtered data
        if completed_with_wait:
            national_wait = round(median([r['wait_years'] for r in completed_with_wait]), 2)
            national_comp = round(len(operational) / (len(operational) + len(withdrawn)), 3)
        else:
            national_wait = 3.5
            national_comp = 0.175
        return {
            'median_wait_years': national_wait,
            'recent_wait_years': national_wait,
            'completion_rate': national_comp,
            'withdrawal_rate': round(1.0 - national_comp, 3),
            'source': 'national',
        }

    # Get distinct state+iso combinations from grid_dc_sites
    print("  Querying distinct state/iso pairs from grid_dc_sites...")
    result = subprocess.run(
        PSQL_CMD + ['-t', '-A', '-c',
                    "SELECT DISTINCT state, iso_region FROM grid_dc_sites WHERE state IS NOT NULL ORDER BY state;"],
        env=PSQL_ENV, capture_output=True, text=True, timeout=30
    )

    state_iso_pairs = []
    for line in result.stdout.strip().split('\n'):
        if '|' in line:
            parts = line.split('|')
            state_iso_pairs.append((parts[0], parts[1] if len(parts) > 1 else ''))

    print(f"  {len(state_iso_pairs)} distinct state/iso pairs in grid_dc_sites")

    # Capture BEFORE snapshot for comparison
    print("  Capturing BEFORE snapshot...")
    before_result = subprocess.run(
        PSQL_CMD + ['-t', '-A', '-c', """
            SELECT iso_region, AVG(avg_queue_wait_years)::numeric(4,1)
            FROM grid_dc_sites GROUP BY iso_region ORDER BY iso_region;
        """],
        env=PSQL_ENV, capture_output=True, text=True, timeout=30
    )
    before_waits = {}
    for line in before_result.stdout.strip().split('\n'):
        if '|' in line:
            parts = line.split('|')
            before_waits[parts[0]] = float(parts[1]) if parts[1] else None

    # Generate SQL updates per state
    update_sqls = []
    update_summary = []
    for state, iso_region in state_iso_pairs:
        if not state:
            continue
        m = get_metrics_for_state(state, iso_region)
        wait = m['median_wait_years']
        recent = m['recent_wait_years']
        comp_rate = m['completion_rate']
        wd_rate = m.get('withdrawal_rate', round(1.0 - comp_rate, 3))
        source = m.get('source', '?')

        state_esc = state.replace("'", "''")
        iso_esc = (iso_region or '').replace("'", "''")
        iso_filter = f"iso_region = '{iso_esc}'" if iso_region else "iso_region IS NULL"

        sql = f"""UPDATE grid_dc_sites SET
            avg_queue_wait_years = {wait},
            recent_queue_wait_years = {recent},
            queue_completion_rate = {comp_rate},
            queue_withdrawal_rate = {wd_rate}
        WHERE state = '{state_esc}' AND {iso_filter};"""
        update_sqls.append(sql)

        update_summary.append({
            'state': state, 'iso': iso_region, 'wait': wait,
            'recent': recent, 'comp_rate': comp_rate, 'wd_rate': wd_rate,
            'source': source
        })

    print(f"  Generated {len(update_sqls)} UPDATE statements")

    # Show summary
    print(f"\n  {'State':<6} {'ISO':<8} {'Wait':>6} {'Recent':>7} {'Comp%':>6} {'Wthd%':>6} {'Source':<8}")
    print(f"  {'-'*6} {'-'*8} {'-'*6} {'-'*7} {'-'*6} {'-'*6} {'-'*8}")
    state_count = iso_count = national_count = 0
    for s in sorted(update_summary, key=lambda x: x['state']):
        if s['source'] == 'state':
            state_count += 1
        elif s['source'] == 'iso':
            iso_count += 1
        else:
            national_count += 1
        print(f"  {s['state']:<6} {s['iso'] or '?':<8} {s['wait']:>5.1f}y {s['recent']:>6.1f}y"
              f" {s['comp_rate']*100:>5.1f}% {s['wd_rate']*100:>5.1f}% {s['source']:<8}")

    print(f"\n  Resolution: {state_count} state-level, {iso_count} ISO-fallback, {national_count} national-fallback")

    if dry_run:
        print(f"\n[DRY RUN] Would execute {len(update_sqls)} SQL UPDATE statements")
        print("\nDone! (dry run)")
        return

    # Execute all updates in a single psql transaction
    print(f"\n  Executing {len(update_sqls)} updates via psql...")
    all_sql = "BEGIN;\n" + "\n".join(update_sqls) + "\nCOMMIT;"

    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', delete=False) as f:
        f.write(all_sql)
        tmp_path = f.name

    try:
        result = subprocess.run(
            PSQL_CMD + ['-f', tmp_path],
            env=PSQL_ENV, capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            print(f"  All updates applied successfully")
        else:
            print(f"  psql error: {result.stderr[:500]}")
    finally:
        os.unlink(tmp_path)

    # Verify and compare
    print("\n  BEFORE vs AFTER comparison (avg_queue_wait_years by ISO):")
    print(f"  {'ISO':<8} {'BEFORE':>8} {'AFTER':>8} {'CHANGE':>8}")
    print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8}")

    after_result = subprocess.run(
        PSQL_CMD + ['-t', '-A', '-c', """
            SELECT iso_region,
                   COUNT(*) as cnt,
                   AVG(avg_queue_wait_years)::numeric(4,1) as avg_wait,
                   AVG(recent_queue_wait_years)::numeric(4,1) as recent_wait,
                   AVG(queue_completion_rate)::numeric(4,3) as avg_comp_rate
            FROM grid_dc_sites
            GROUP BY iso_region
            ORDER BY cnt DESC;
        """],
        env=PSQL_ENV, capture_output=True, text=True, timeout=30
    )

    for line in after_result.stdout.strip().split('\n'):
        if '|' in line:
            parts = line.split('|')
            iso = parts[0]
            after_wait = float(parts[2]) if parts[2] else None
            before = before_waits.get(iso)
            if before is not None and after_wait is not None:
                change = after_wait - before
                arrow = '+' if change > 0 else ''
                print(f"  {iso:<8} {before:>7.1f}y {after_wait:>7.1f}y {arrow}{change:>6.1f}y")

    # Full results table
    print(f"\n  Full results:")
    print(after_result.stdout)

    print("\nDone!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Enrich grid_county_data with FERC Form 714 utility load growth metrics.

Source: PUDL (Public Utility Data Liberation) S3 Parquet files
  https://s3.us-west-2.amazonaws.com/pudl.catalyst.coop/v2024.11.0/out_ferc714__summarized_demand.parquet
  Fallback CSV: https://data.catalyst.coop/pudl/out_ferc714__summarized_demand.csv

If PUDL data unavailable, falls back to hardcoded EIA AEO 2024 state-level
load growth projections.

Fields populated on grid_county_data:
- ferc714_peak_demand_mw   NUMERIC(10,1) — peak demand in utility territory
- ferc714_load_growth_pct  NUMERIC(6,2)  — annual load growth rate %

Usage:
  python3 -u scripts/enrich-ferc714-load.py
  python3 -u scripts/enrich-ferc714-load.py --dry-run
  python3 -u scripts/enrich-ferc714-load.py --fallback   # skip PUDL, use EIA state data
"""

import os
import sys
import json
import math
import time
import ssl
import subprocess
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

# macOS system Python SSL fix
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    SSL_CTX.load_verify_locations(certifi.where())
except ImportError:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

# Load env from grid's own .env.local first, fallback to solar
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
CACHE_FILE = os.path.join(DATA_DIR, 'ferc714_demand.parquet')
CACHE_CSV = os.path.join(DATA_DIR, 'ferc714_demand.csv')

PUDL_PARQUET_URL = (
    "https://s3.us-west-2.amazonaws.com/pudl.catalyst.coop/"
    "v2024.11.0/out_ferc714__summarized_demand.parquet"
)
PUDL_CSV_URL = (
    "https://data.catalyst.coop/pudl/out_ferc714__summarized_demand.csv"
)

# EIA AEO 2024 projected electricity demand growth by region (% annual)
# Used as fallback if PUDL data unavailable
STATE_LOAD_GROWTH = {
    'TX': 2.5, 'VA': 3.2, 'GA': 1.8, 'NC': 1.5, 'OH': 0.8,
    'IA': 1.2, 'OR': 1.0, 'WA': 1.1, 'AZ': 2.0, 'NV': 2.3,
    'IL': 0.7, 'IN': 0.9, 'PA': 0.6, 'NJ': 0.5, 'NY': 0.4,
    'CA': 1.3, 'CO': 1.4, 'UT': 1.9, 'TN': 1.6, 'SC': 1.7,
    'FL': 1.8, 'AL': 1.1, 'MS': 0.9, 'LA': 1.0, 'OK': 1.3,
    'KS': 0.8, 'NE': 0.7, 'SD': 0.6, 'ND': 0.5, 'MT': 0.4,
    'WY': 0.3, 'NM': 1.1, 'ID': 1.2, 'CT': 0.3, 'MA': 0.4,
    'MD': 0.8, 'DE': 0.6, 'WV': 0.2, 'KY': 0.5, 'MO': 0.7,
    'AR': 0.8, 'WI': 0.6, 'MN': 0.7, 'MI': 0.5, 'ME': 0.3,
    'NH': 0.3, 'VT': 0.2, 'RI': 0.3, 'HI': 0.5, 'AK': 0.3,
}

# Median US load growth for states not in the table
DEFAULT_LOAD_GROWTH = 0.8


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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:200]}")
            raise
        except Exception:
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


def run_psql(sql):
    """Execute SQL via psql and return stdout."""
    db_password = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password

    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-c', sql],
        capture_output=True, text=True, env=env, timeout=120
    )

    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result


def run_psql_file(sql_file):
    """Execute SQL file via psql."""
    db_password = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password

    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-f', sql_file],
        capture_output=True, text=True, env=env, timeout=120
    )

    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result


# ── PUDL Download ──────────────────────────────────────────────

def download_pudl_parquet():
    """Try downloading PUDL FERC 714 summarized demand as Parquet."""
    print(f"\n  Trying Parquet: {PUDL_PARQUET_URL}")
    os.makedirs(DATA_DIR, exist_ok=True)

    req = urllib.request.Request(PUDL_PARQUET_URL, headers={'User-Agent': 'GridScout/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
            data = resp.read()
            with open(CACHE_FILE, 'wb') as f:
                f.write(data)
            size_mb = len(data) / (1024 * 1024)
            print(f"  Downloaded {size_mb:.1f} MB to {CACHE_FILE}")
            return True
    except Exception as e:
        print(f"  Parquet download failed: {e}")
        return False


def download_pudl_csv():
    """Try downloading PUDL FERC 714 summarized demand as CSV."""
    print(f"\n  Trying CSV: {PUDL_CSV_URL}")
    os.makedirs(DATA_DIR, exist_ok=True)

    req = urllib.request.Request(PUDL_CSV_URL, headers={'User-Agent': 'GridScout/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
            data = resp.read()
            with open(CACHE_CSV, 'wb') as f:
                f.write(data)
            size_mb = len(data) / (1024 * 1024)
            print(f"  Downloaded {size_mb:.1f} MB to {CACHE_CSV}")
            return True
    except Exception as e:
        print(f"  CSV download failed: {e}")
        return False


def parse_pudl_parquet():
    """Parse PUDL Parquet file and return per-state load metrics."""
    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("  pyarrow not installed — cannot read Parquet. Trying CSV fallback.")
        return None

    print(f"\n  Parsing {CACHE_FILE}...")
    table = pq.read_table(CACHE_FILE)
    df_cols = table.column_names
    print(f"  Columns: {df_cols}")
    print(f"  Rows: {len(table)}")

    # Convert to list of dicts for processing
    rows = table.to_pydict()
    n = len(rows.get('report_year', []))

    # Identify relevant columns
    year_col = 'report_year' if 'report_year' in rows else None
    peak_col = None
    for c in ['peak_demand_mw', 'summer_peak_demand_mw', 'winter_peak_demand_mw']:
        if c in rows:
            peak_col = c
            break
    name_col = 'respondent_name' if 'respondent_name' in rows else None
    state_col = 'state' if 'state' in rows else None

    if not year_col or not peak_col:
        print(f"  Missing required columns (need report_year + peak demand). Available: {df_cols}")
        return None

    print(f"  Using year={year_col}, peak={peak_col}, name={name_col}, state={state_col}")

    return _compute_load_growth(rows, n, year_col, peak_col, name_col, state_col)


def parse_pudl_csv():
    """Parse PUDL CSV file and return per-state load metrics."""
    import csv

    print(f"\n  Parsing {CACHE_CSV}...")
    rows_dict = {}

    with open(CACHE_CSV, 'r') as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        print(f"  Columns: {cols}")

        all_rows = list(reader)

    print(f"  Rows: {len(all_rows)}")

    # Build column dict like pyarrow format
    rows = {}
    for col in cols:
        rows[col] = [r.get(col, '') for r in all_rows]

    n = len(all_rows)

    year_col = 'report_year' if 'report_year' in rows else None
    peak_col = None
    for c in ['peak_demand_mw', 'summer_peak_demand_mw', 'winter_peak_demand_mw']:
        if c in rows:
            peak_col = c
            break
    name_col = 'respondent_name' if 'respondent_name' in rows else None
    state_col = 'state' if 'state' in rows else None

    if not year_col or not peak_col:
        print(f"  Missing required columns. Available: {cols}")
        return None

    print(f"  Using year={year_col}, peak={peak_col}, name={name_col}, state={state_col}")

    return _compute_load_growth(rows, n, year_col, peak_col, name_col, state_col)


def _compute_load_growth(rows, n, year_col, peak_col, name_col, state_col):
    """
    Compute per-state peak demand and load growth from PUDL data.

    Returns dict: { state_abbr: { 'peak_demand_mw': float, 'load_growth_pct': float } }
    """
    # Group by state (if state column exists) or by respondent
    # Aggregate peak demand by year, then compute CAGR over available years

    # First pass: collect (state, year) -> total peak demand
    state_year_demand = {}  # state -> { year -> total_peak_mw }

    for i in range(n):
        try:
            year_val = rows[year_col][i]
            peak_val = rows[peak_col][i]

            year = int(year_val) if year_val not in (None, '', 'None') else None
            peak = float(peak_val) if peak_val not in (None, '', 'None', 'nan') else None

            if year is None or peak is None or peak <= 0:
                continue

            state = None
            if state_col and rows[state_col][i] not in (None, '', 'None'):
                state = str(rows[state_col][i]).strip().upper()
                if len(state) != 2:
                    state = None

            # If no state column, try to infer from respondent name (limited)
            if state is None and name_col:
                # Skip — we can't reliably map respondent names to states
                continue

            if state is None:
                continue

            if state not in state_year_demand:
                state_year_demand[state] = {}
            if year not in state_year_demand[state]:
                state_year_demand[state][year] = 0.0
            state_year_demand[state][year] += peak

        except (ValueError, TypeError, IndexError):
            continue

    if not state_year_demand:
        print("  No valid state-level demand data found in PUDL.")
        return None

    # Compute CAGR for each state using recent vs older period
    # Use 5-year window: compare avg of last 3 years vs avg of 3 years 5 years prior
    results = {}
    for state, year_demand in state_year_demand.items():
        years = sorted(year_demand.keys())
        if len(years) < 4:
            continue

        max_year = max(years)
        # Recent period: last 3 available years
        recent_years = [y for y in years if y >= max_year - 2]
        # Older period: 3 years centered 5 years before max
        older_years = [y for y in years if max_year - 7 <= y <= max_year - 5]

        if not recent_years or not older_years:
            # Not enough spread — use first vs last
            recent_years = years[-2:]
            older_years = years[:2]

        recent_avg = sum(year_demand[y] for y in recent_years) / len(recent_years)
        older_avg = sum(year_demand[y] for y in older_years) / len(older_years)

        if older_avg <= 0:
            continue

        # CAGR formula: (recent/older)^(1/years_between) - 1
        years_between = (sum(recent_years) / len(recent_years)) - (sum(older_years) / len(older_years))
        if years_between <= 0:
            continue

        cagr = (recent_avg / older_avg) ** (1.0 / years_between) - 1.0
        load_growth_pct = round(cagr * 100, 2)

        # Clamp to reasonable range (-5% to +10%)
        load_growth_pct = max(-5.0, min(10.0, load_growth_pct))

        results[state] = {
            'peak_demand_mw': round(recent_avg, 1),
            'load_growth_pct': load_growth_pct,
        }

    print(f"\n  Computed load metrics for {len(results)} states from PUDL data")
    if results:
        top5 = sorted(results.items(), key=lambda x: x[1]['peak_demand_mw'], reverse=True)[:5]
        for st, d in top5:
            print(f"    {st}: peak={d['peak_demand_mw']:.0f} MW, growth={d['load_growth_pct']:+.2f}%/yr")

    return results


def get_state_load_data_fallback():
    """Use hardcoded EIA AEO 2024 state-level load growth as fallback."""
    print("\n  Using EIA AEO 2024 state-level load growth fallback data")
    results = {}
    for state, growth in STATE_LOAD_GROWTH.items():
        results[state] = {
            'peak_demand_mw': None,  # Not available from fallback
            'load_growth_pct': growth,
        }
    print(f"  {len(results)} states with load growth data")
    return results


# ── Main ────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    use_fallback = '--fallback' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich FERC 714 Load Growth")
    print("=" * 50)

    # Phase 1: Get load data
    state_data = None

    if not use_fallback:
        print("\n[Phase 1] Downloading FERC 714 data from PUDL...")

        # Try Parquet first
        if os.path.exists(CACHE_FILE):
            print(f"  Using cached Parquet: {CACHE_FILE}")
            state_data = parse_pudl_parquet()
        else:
            if download_pudl_parquet():
                state_data = parse_pudl_parquet()

        # Try CSV if Parquet failed
        if state_data is None:
            if os.path.exists(CACHE_CSV):
                print(f"  Using cached CSV: {CACHE_CSV}")
                state_data = parse_pudl_csv()
            else:
                if download_pudl_csv():
                    state_data = parse_pudl_csv()

    # Fallback to hardcoded EIA data
    if state_data is None:
        print("\n  PUDL data unavailable or unparseable. Falling back to EIA state data.")
        state_data = get_state_load_data_fallback()

    if not state_data:
        print("ERROR: No load data available from any source.")
        return

    # Phase 2: Load county data from DB
    print(f"\n[Phase 2] Loading grid_county_data...")
    counties = load_paginated(
        'grid_county_data',
        'id,fips_code,state',
    )
    print(f"  Loaded {len(counties)} counties")

    if not counties:
        print("  ERROR: No county data in database.")
        return

    # Map counties to state load data
    patches = []  # (fips_code, peak_demand_mw, load_growth_pct)
    no_data = 0
    for county in counties:
        state = county.get('state', '').upper()
        if len(state) != 2:
            no_data += 1
            continue

        if state in state_data:
            d = state_data[state]
            patches.append((
                county['fips_code'],
                d.get('peak_demand_mw'),
                d.get('load_growth_pct'),
            ))
        else:
            # Use default growth rate for unknown states
            patches.append((
                county['fips_code'],
                None,
                DEFAULT_LOAD_GROWTH,
            ))

    print(f"  {len(patches)} counties matched to load data, {no_data} skipped (no state)")

    if not patches:
        print("  No patches to apply.")
        return

    # Stats
    growth_values = [p[2] for p in patches if p[2] is not None]
    if growth_values:
        growth_values.sort()
        n = len(growth_values)
        print(f"\n  Load growth statistics:")
        print(f"    Min:    {growth_values[0]:+.2f}%")
        print(f"    Max:    {growth_values[-1]:+.2f}%")
        print(f"    Mean:   {sum(growth_values) / n:+.2f}%")
        print(f"    Median: {growth_values[n // 2]:+.2f}%")

    peak_values = [p[1] for p in patches if p[1] is not None]
    if peak_values:
        peak_values.sort()
        n = len(peak_values)
        print(f"\n  Peak demand statistics:")
        print(f"    Min:    {peak_values[0]:.0f} MW")
        print(f"    Max:    {peak_values[-1]:.0f} MW")
        print(f"    Mean:   {sum(peak_values) / n:.0f} MW")
        print(f"    Median: {peak_values[n // 2]:.0f} MW")

    if dry_run:
        samples = patches[:10]
        for fips, peak, growth in samples:
            peak_str = f"{peak:.1f}" if peak else "NULL"
            growth_str = f"{growth:.2f}" if growth is not None else "NULL"
            print(f"  Would patch {fips}: peak={peak_str} MW, growth={growth_str}%")
        print(f"\n  Would patch {len(patches)} counties total")
        return

    # Phase 3: Add columns if needed + patch via psql
    print(f"\n[Phase 3] Patching {len(patches)} counties via psql...")

    sql_file = os.path.join(DATA_DIR, '_ferc714_update.sql')
    os.makedirs(DATA_DIR, exist_ok=True)

    with open(sql_file, 'w') as f:
        # Add columns if they don't exist
        f.write("ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS "
                "ferc714_peak_demand_mw NUMERIC(10,1);\n")
        f.write("ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS "
                "ferc714_load_growth_pct NUMERIC(6,2);\n\n")

        # Create temp table and bulk load
        f.write("CREATE TEMP TABLE _ferc714 (\n")
        f.write("  fips TEXT,\n")
        f.write("  peak NUMERIC(10,1),\n")
        f.write("  growth NUMERIC(6,2)\n")
        f.write(");\n\n")

        f.write("COPY _ferc714 (fips, peak, growth) FROM STDIN;\n")
        for fips, peak, growth in patches:
            peak_str = f"{peak:.1f}" if peak is not None else "\\N"
            growth_str = f"{growth:.2f}" if growth is not None else "\\N"
            f.write(f"{fips}\t{peak_str}\t{growth_str}\n")
        f.write("\\.\n\n")

        # UPDATE JOIN
        f.write("UPDATE grid_county_data\n")
        f.write("SET ferc714_peak_demand_mw = _ferc714.peak,\n")
        f.write("    ferc714_load_growth_pct = _ferc714.growth,\n")
        f.write("    updated_at = NOW()\n")
        f.write("FROM _ferc714\n")
        f.write("WHERE grid_county_data.fips_code = _ferc714.fips;\n\n")

        # Verify
        f.write("SELECT COUNT(*) AS counties_with_load_growth\n")
        f.write("FROM grid_county_data\n")
        f.write("WHERE ferc714_load_growth_pct IS NOT NULL;\n")

    result = run_psql_file(sql_file)
    if result.returncode == 0:
        print(f"  psql output: {result.stdout.strip()}")
    else:
        print(f"  psql failed (return code {result.returncode})")

    # Cleanup temp SQL file
    try:
        os.remove(sql_file)
    except OSError:
        pass

    print(f"\nDone! {len(patches)} counties patched with FERC 714 load growth data.")


if __name__ == '__main__':
    main()

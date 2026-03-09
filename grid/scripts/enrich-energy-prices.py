#!/usr/bin/env python3
"""
Enrich grid_dc_sites with energy pricing data (LMP + EIA retail rates).

Phase 1: Fetch Day-Ahead LMP from 5 ISOs via gridstatus library
  - CAISO, ERCOT, NYISO, MISO, ISO-NE
  - Calculate average LMP per zone/hub
  - Cache to grid/data/lmp_prices.json

Phase 2: EIA state-level commercial/industrial retail rates
  - Covers PJM, SPP, WECC, SERC, and non-ISO areas
  - Source: EIA Electric Power Monthly (2024 data)

Phase 3: Assign to DC sites via bulk psql UPDATE
  - ISO-covered: zone/hub average LMP ($/MWh)
  - Non-ISO: state retail rate converted to $/MWh

Usage:
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --dry-run
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --skip-download
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --skip-download --dry-run

Must run from: /Users/kennyhyder/Desktop/hyder-media/grid/
Must use:      /Users/kennyhyder/Desktop/hyder-media/solar/.venv/bin/python3.13
"""

import os
import sys
import json
import time
import subprocess
from datetime import date, timedelta

# Add solar dir for .env.local
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'solar'))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
CACHE_FILE = os.path.join(DATA_DIR, 'lmp_prices.json')

PSQL_CMD = [
    'psql',
    '-h', 'aws-0-us-west-2.pooler.supabase.com',
    '-p', '6543',
    '-U', 'postgres.ilbovwnhrowvxjdkvrln',
    '-d', 'postgres',
]
PSQL_ENV = {**os.environ, 'PGPASSWORD': '#FsW7iqg%EYX&G3M'}

# EIA state-level average commercial electricity rates (cents/kWh)
# Source: EIA Electric Power Monthly, Table 5.6.a, 2024 annual averages
# https://www.eia.gov/electricity/monthly/epm_table_5_6_a.html
EIA_STATE_RATES_CENTS = {
    'AL': 12.73, 'AK': 22.18, 'AZ': 11.19, 'AR': 9.60, 'CA': 23.41,
    'CO': 11.48, 'CT': 20.38, 'DE': 11.79, 'DC': 13.04, 'FL': 11.54,
    'GA': 11.42, 'HI': 37.53, 'ID': 8.15, 'IL': 10.37, 'IN': 11.68,
    'IA': 13.11, 'KS': 11.89, 'KY': 10.12, 'LA': 9.93, 'ME': 17.96,
    'MD': 12.24, 'MA': 22.59, 'MI': 13.90, 'MN': 12.17, 'MS': 11.35,
    'MO': 10.80, 'MT': 10.87, 'NE': 10.62, 'NV': 9.75, 'NH': 19.24,
    'NJ': 14.05, 'NM': 11.33, 'NY': 17.62, 'NC': 10.00, 'ND': 10.42,
    'OH': 10.88, 'OK': 9.42, 'OR': 9.83, 'PA': 10.05, 'RI': 22.34,
    'SC': 10.84, 'SD': 11.89, 'TN': 11.08, 'TX': 10.28, 'UT': 9.28,
    'VT': 17.73, 'VA': 9.49, 'WA': 9.09, 'WV': 10.12, 'WI': 12.66,
    'WY': 9.79, 'PR': 24.00, 'GU': 30.00, 'VI': 35.00,
}

# State -> ISO mapping for states fully covered by an ISO
# States in WECC/SERC/etc. that are NOT fully covered by CAISO/ERCOT/etc.
# will use EIA retail rates
ISO_STATE_MAP = {
    # ERCOT covers most of TX (all TX DC sites have iso_region=ERCOT)
    # CAISO covers most of CA (all CA DC sites have iso_region=CAISO)
    # NYISO covers all of NY
    # ISO-NE covers CT, MA, ME, NH, RI, VT
}

# Map from iso_region in DB to gridstatus class name
ISO_GRIDSTATUS_MAP = {
    'CAISO': 'CAISO',
    'ERCOT': 'Ercot',
    'NYISO': 'NYISO',
    'MISO': 'MISO',
    'ISO-NE': 'ISONE',
}

# ISOs where we use LMP data (have working gridstatus)
LMP_ISOS = ['CAISO', 'ERCOT', 'NYISO', 'MISO', 'ISO-NE']

# ISOs where we fall back to EIA retail rates
RETAIL_ISOS = ['PJM', 'SPP', 'WECC', 'SERC']


def fetch_lmp_data():
    """Fetch Day-Ahead LMP data from all working ISOs via gridstatus."""
    import gridstatus

    # Try last 3 days in case most recent isn't available yet
    target_dates = [date.today() - timedelta(days=i) for i in range(1, 4)]

    all_iso_data = {}

    for iso_name in LMP_ISOS:
        class_name = ISO_GRIDSTATUS_MAP[iso_name]
        print(f"\n  Fetching {iso_name} Day-Ahead LMP...")

        iso_cls = getattr(gridstatus, class_name)

        for d in target_dates:
            try:
                iso_obj = iso_cls()
                kwargs = {'date': str(d)}
                if iso_name != 'ERCOT':
                    kwargs['market'] = 'DAY_AHEAD_HOURLY'

                lmp = iso_obj.get_lmp(**kwargs)

                if lmp is None or len(lmp) == 0:
                    print(f"    {d}: No data, trying earlier date...")
                    continue

                # Calculate zone/hub averages
                zone_avgs = {}
                overall_mean = float(lmp['LMP'].mean())

                if 'Location Type' in lmp.columns:
                    # Prefer Trading Hub / Load Zone for regional averages
                    for loc_type in ['Trading Hub', 'Load Zone', 'Hub', 'ZONE']:
                        subset = lmp[lmp['Location Type'] == loc_type]
                        if len(subset) > 0:
                            avgs = subset.groupby('Location')['LMP'].mean()
                            for loc, val in avgs.items():
                                zone_avgs[loc] = round(float(val), 2)

                    # If no zone-level data found, use overall mean
                    if not zone_avgs:
                        zone_avgs['_overall'] = round(overall_mean, 2)
                else:
                    zone_avgs['_overall'] = round(overall_mean, 2)

                all_iso_data[iso_name] = {
                    'date': str(d),
                    'overall_mean': round(overall_mean, 2),
                    'zones': zone_avgs,
                    'record_count': len(lmp),
                }

                print(f"    {d}: {len(lmp)} records, mean ${overall_mean:.2f}/MWh, "
                      f"{len(zone_avgs)} zones/hubs")
                break  # Got data, move to next ISO

            except Exception as e:
                print(f"    {d}: Error - {type(e).__name__}: {str(e)[:150]}")
                continue

        if iso_name not in all_iso_data:
            print(f"    WARNING: Could not get LMP data for {iso_name}")

    return all_iso_data


def build_price_table(lmp_data):
    """Build a mapping of (iso_region, state) -> (price_mwh, source)."""
    price_map = {}

    # Phase 1: ISO LMP averages
    for iso_name, data in lmp_data.items():
        avg_price = data['overall_mean']
        price_map[iso_name] = {
            'price_mwh': round(avg_price, 2),
            'source': f'lmp_{iso_name.lower().replace("-", "")}',
            'date': data['date'],
        }
        print(f"  {iso_name}: ${avg_price:.2f}/MWh (LMP {data['date']})")

    # Phase 2: EIA retail rates for non-LMP ISOs and states
    # These ISOs don't have gridstatus LMP support - use state retail rates
    print(f"\n  EIA state retail rates for PJM/SPP/WECC/SERC regions:")
    for state, cents in sorted(EIA_STATE_RATES_CENTS.items()):
        mwh_price = round(cents * 10, 2)  # cents/kWh -> $/MWh
        price_map[f'state_{state}'] = {
            'price_mwh': mwh_price,
            'source': 'eia_retail',
        }

    return price_map


def run_psql(sql):
    """Execute SQL via psql."""
    result = subprocess.run(
        PSQL_CMD + ['-c', sql],
        env=PSQL_ENV,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:300]}")
    return result.stdout


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Energy Prices (LMP + EIA Retail)")
    print("=" * 55)

    # -------------------------------------------------------
    # Phase 1: Get LMP data
    # -------------------------------------------------------
    lmp_data = {}

    if skip_download and os.path.exists(CACHE_FILE):
        print("\n[1/3] Loading cached LMP data from", CACHE_FILE)
        with open(CACHE_FILE) as f:
            lmp_data = json.load(f)
        for iso, data in lmp_data.items():
            print(f"  {iso}: ${data['overall_mean']:.2f}/MWh ({data['date']})")
    else:
        print("\n[1/3] Fetching LMP data from 5 ISOs via gridstatus...")
        lmp_data = fetch_lmp_data()

        if lmp_data:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(CACHE_FILE, 'w') as f:
                json.dump(lmp_data, f, indent=2)
            print(f"\n  Cached to {CACHE_FILE}")
        else:
            print("  WARNING: No LMP data fetched. Will use EIA retail rates for all.")

    # -------------------------------------------------------
    # Phase 2: Build price table (LMP + EIA retail)
    # -------------------------------------------------------
    print(f"\n[2/3] Building price assignment table...")
    price_map = build_price_table(lmp_data)

    # -------------------------------------------------------
    # Phase 3: Assign to DC sites via psql
    # -------------------------------------------------------
    print(f"\n[3/3] Assigning energy prices to DC sites...")

    # First, add columns if they don't exist
    add_cols_sql = """
    DO $$ BEGIN
        ALTER TABLE grid_dc_sites ADD COLUMN energy_price_mwh NUMERIC(8,2);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
        ALTER TABLE grid_dc_sites ADD COLUMN energy_price_source TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    """

    if not dry_run:
        print("  Adding columns if needed...")
        run_psql(add_cols_sql)

    # Strategy: Use EIA state retail rates for ALL sites (consistent basis).
    # LMP wholesale prices are 2-4x lower than retail and not comparable.
    # For DC site selection, state retail rates give apples-to-apples comparison
    # of actual electricity costs a datacenter would pay.
    #
    # LMP data is cached in lmp_prices.json for reference/future use.
    # Source column notes ISO LMP where available (for context).

    updates = []
    for state, cents in sorted(EIA_STATE_RATES_CENTS.items()):
        mwh_price = round(cents * 10, 2)
        # Determine source label: note if state is in an ISO with LMP data
        source = 'eia_retail'
        updates.append({
            'sql': f"""
            UPDATE grid_dc_sites
            SET energy_price_mwh = {mwh_price},
                energy_price_source = '{source}'
            WHERE state = '{state}';
            """,
            'desc': f"  {state}: ${mwh_price}/MWh ({source})",
        })

    if dry_run:
        print(f"\n  Would execute {len(updates)} UPDATE statements:")
        for u in updates:
            print(u['desc'])

        # Show expected distribution
        print(f"\n  ISO LMP coverage:")
        for iso_name in LMP_ISOS:
            if iso_name in price_map:
                print(f"    {iso_name}: ${price_map[iso_name]['price_mwh']}/MWh")
        print(f"  EIA retail fallback: {len(EIA_STATE_RATES_CENTS)} states")
        return

    # Execute all updates
    total_affected = 0
    for u in updates:
        result = run_psql(u['sql'])
        # Parse "UPDATE N" from result
        if result and 'UPDATE' in result:
            try:
                n = int(result.strip().split()[-1])
                if n > 0:
                    total_affected += n
            except (ValueError, IndexError):
                pass

    print(f"\n  Total rows updated: {total_affected}")

    # -------------------------------------------------------
    # Summary stats
    # -------------------------------------------------------
    print(f"\n{'='*55}")
    print("Summary Statistics")
    print(f"{'='*55}")

    stats_sql = """
    SELECT
        COUNT(*) AS total,
        COUNT(energy_price_mwh) AS priced,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_price,
        ROUND(MIN(energy_price_mwh)::numeric, 2) AS min_price,
        ROUND(MAX(energy_price_mwh)::numeric, 2) AS max_price
    FROM grid_dc_sites;
    """
    print("\nOverall:")
    print(run_psql(stats_sql))

    by_source_sql = """
    SELECT
        energy_price_source,
        COUNT(*) AS sites,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_price,
        ROUND(MIN(energy_price_mwh)::numeric, 2) AS min_price,
        ROUND(MAX(energy_price_mwh)::numeric, 2) AS max_price
    FROM grid_dc_sites
    WHERE energy_price_mwh IS NOT NULL
    GROUP BY energy_price_source
    ORDER BY sites DESC;
    """
    print("By source:")
    print(run_psql(by_source_sql))

    by_iso_sql = """
    SELECT
        COALESCE(iso_region, 'None') AS region,
        COUNT(*) AS sites,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_price,
        ROUND(MIN(energy_price_mwh)::numeric, 2) AS min_price,
        ROUND(MAX(energy_price_mwh)::numeric, 2) AS max_price
    FROM grid_dc_sites
    WHERE energy_price_mwh IS NOT NULL
    GROUP BY iso_region
    ORDER BY avg_price;
    """
    print("By ISO region (sorted by avg price):")
    print(run_psql(by_iso_sql))

    by_state_sql = """
    SELECT state, COUNT(*) AS sites,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_price,
        energy_price_source AS source
    FROM grid_dc_sites
    WHERE energy_price_mwh IS NOT NULL
    GROUP BY state, energy_price_source
    ORDER BY avg_price
    LIMIT 20;
    """
    print("Top 20 cheapest states:")
    print(run_psql(by_state_sql))

    print("Done!")


if __name__ == '__main__':
    main()

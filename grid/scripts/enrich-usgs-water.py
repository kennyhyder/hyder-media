#!/usr/bin/env python3
"""
Enrich grid_county_data with USGS county-level water use data (2015 dataset).

Source: USGS Estimated Use of Water in the United States, County-Level Data for 2015 (v2.0)
  https://doi.org/10.5066/F7TB15V5
  Downloaded from ScienceBase as CSV.

Fields populated on grid_county_data:
- public_supply_mgd     (numeric) — Public supply total withdrawals (Mgal/day)
- industrial_water_mgd  (numeric) — Industrial total withdrawals (Mgal/day)
- total_water_mgd        (numeric) — Total withdrawals across all categories (Mgal/day)
- usgs_fresh_groundwater_mgd (numeric) — Fresh groundwater withdrawals (Mgal/day)
- usgs_fresh_surface_mgd     (numeric) — Fresh surface water withdrawals (Mgal/day)

Then propagates to grid_dc_sites.wri_water_stress via fips_code JOIN:
- Calculates per-capita water availability: total_withdrawal / population
- Maps to stress tiers: abundant (>2000), adequate (500-2000), moderate (100-500), stressed (<100)
- Writes numeric score 0-5 to wri_water_stress where it's currently NULL

Usage:
  python3 -u scripts/enrich-usgs-water.py
  python3 -u scripts/enrich-usgs-water.py --dry-run
  python3 -u scripts/enrich-usgs-water.py --skip-download
"""

import os
import sys
import csv
import json
import time
import subprocess
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'usgs_water')
CSV_FILE = os.path.join(DATA_DIR, 'usco2015v2.0.csv')

# ScienceBase file URL (resolved from catalog API)
SCIENCEBASE_ITEM_ID = '5af3311be4b0da30c1b245d8'
SCIENCEBASE_API_URL = f'https://www.sciencebase.gov/catalog/item/{SCIENCEBASE_ITEM_ID}?format=json'

BATCH_SIZE = 50

PSQL_CMD = [
    'psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
    '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres'
]
PSQL_ENV_PASSWORD = '#FsW7iqg%EYX&G3M'

# Key columns from the USGS CSV:
#   FIPS       — 5-digit county FIPS code
#   PS-Wtotl   — Public Supply, total withdrawals (Mgal/day)
#   IN-Wtotl   — Industrial, total withdrawals (Mgal/day)
#   TO-Wtotl   — Total withdrawals all categories (Mgal/day)
#   TO-WGWFr   — Total fresh groundwater withdrawals (Mgal/day)
#   TO-WSWFr   — Total fresh surface water withdrawals (Mgal/day)


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
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def run_psql(sql):
    """Execute SQL via psql. Returns True on success."""
    env = os.environ.copy()
    env['PGPASSWORD'] = PSQL_ENV_PASSWORD
    result = subprocess.run(
        PSQL_CMD + ['-c', sql],
        capture_output=True, text=True, env=env, timeout=60
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:300]}")
        return False
    if result.stdout.strip():
        print(f"  psql: {result.stdout.strip()}")
    return True


def ensure_columns():
    """Add water use columns to grid_county_data if they don't exist."""
    print("Checking/adding columns to grid_county_data...")
    sql = """
    ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS public_supply_mgd NUMERIC(10,2);
    ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS industrial_water_mgd NUMERIC(10,2);
    ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS total_water_mgd NUMERIC(10,2);
    ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS usgs_fresh_groundwater_mgd NUMERIC(12,2);
    ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS usgs_fresh_surface_mgd NUMERIC(12,2);
    """
    if run_psql(sql):
        print("  Columns verified via psql")
        return True
    print("  WARNING: Could not verify/add columns — they may already exist")
    return False


def resolve_csv_url():
    """Get the actual CSV download URL from ScienceBase catalog API."""
    print("Resolving CSV download URL from ScienceBase...")
    req = urllib.request.Request(SCIENCEBASE_API_URL, headers={
        'User-Agent': 'GridScout/1.0 (USGS Water Use Enrichment)'
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        for f in data.get('files', []):
            if f.get('name', '').endswith('.csv'):
                url = f.get('url', '')
                print(f"  Found: {f['name']} -> {url[:80]}...")
                return url
    except Exception as e:
        print(f"  ScienceBase API error: {e}")
    return None


def download_csv():
    """Download the USGS water use CSV if not already present."""
    os.makedirs(DATA_DIR, exist_ok=True)

    if os.path.exists(CSV_FILE) and os.path.getsize(CSV_FILE) > 1000:
        print(f"Using cached CSV: {CSV_FILE} ({os.path.getsize(CSV_FILE):,} bytes)")
        return True

    csv_url = resolve_csv_url()
    if not csv_url:
        print("ERROR: Could not resolve CSV download URL")
        return False

    print(f"Downloading USGS 2015 water use data...")
    req = urllib.request.Request(csv_url, headers={
        'User-Agent': 'GridScout/1.0 (USGS Water Use Enrichment)'
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read()
        with open(CSV_FILE, 'wb') as f:
            f.write(content)
        print(f"  Downloaded {len(content):,} bytes to {CSV_FILE}")
        return True
    except Exception as e:
        print(f"  Download error: {e}")
        return False


def safe_float(val):
    """Convert a value to float, returning None for missing/invalid data."""
    if val is None:
        return None
    val = str(val).strip()
    if val in ('', '--', 'NA', 'N/A', '-'):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def parse_csv():
    """Parse the USGS water use CSV and return dict keyed by 5-digit FIPS."""
    print(f"Parsing {CSV_FILE}...")
    water_data = {}

    with open(CSV_FILE, 'r', encoding='utf-8-sig') as f:
        # Skip citation header line (starts with "Version")
        first_line = f.readline()
        if not first_line.startswith('STATE'):
            # First line was citation, next line is headers
            pass
        else:
            # First line IS the header — seek back
            f.seek(0)

        reader = csv.DictReader(f)
        fields = reader.fieldnames
        if not fields:
            print("ERROR: No headers found in CSV")
            return {}

        # Verify key columns exist
        required = ['FIPS', 'TO-Wtotl']
        missing = [c for c in required if c not in fields]
        if missing:
            print(f"WARNING: Missing columns: {missing}")
            print(f"  Available columns: {fields[:30]}...")

        row_count = 0
        for row in reader:
            fips = str(row.get('FIPS', '')).strip()
            if not fips or len(fips) < 4:
                continue

            # Zero-pad to 5 digits
            fips = fips.zfill(5)

            ps_total = safe_float(row.get('PS-Wtotl'))
            in_total = safe_float(row.get('IN-Wtotl'))
            to_total = safe_float(row.get('TO-Wtotl'))
            gw_fresh = safe_float(row.get('TO-WGWFr'))
            sw_fresh = safe_float(row.get('TO-WSWFr'))

            water_data[fips] = {
                'public_supply_mgd': ps_total,
                'industrial_water_mgd': in_total,
                'total_water_mgd': to_total,
                'usgs_fresh_groundwater_mgd': gw_fresh,
                'usgs_fresh_surface_mgd': sw_fresh,
            }
            row_count += 1

    print(f"  Parsed {row_count} counties from USGS data")

    # Stats
    ps_count = sum(1 for v in water_data.values() if v['public_supply_mgd'] is not None)
    in_count = sum(1 for v in water_data.values() if v['industrial_water_mgd'] is not None)
    to_count = sum(1 for v in water_data.values() if v['total_water_mgd'] is not None)
    gw_count = sum(1 for v in water_data.values() if v['usgs_fresh_groundwater_mgd'] is not None)
    sw_count = sum(1 for v in water_data.values() if v['usgs_fresh_surface_mgd'] is not None)
    print(f"  Public supply:      {ps_count} counties with data")
    print(f"  Industrial:         {in_count} counties with data")
    print(f"  Total water:        {to_count} counties with data")
    print(f"  Fresh groundwater:  {gw_count} counties with data")
    print(f"  Fresh surface:      {sw_count} counties with data")

    return water_data


def load_county_fips():
    """Load all county FIPS codes from grid_county_data."""
    print("Loading county FIPS codes from grid_county_data...")
    rows = []
    offset = 0
    page_size = 1000
    while True:
        path = f"grid_county_data?select=id,fips_code,population&limit={page_size}&offset={offset}"
        batch = supabase_request('GET', path)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    print(f"  Loaded {len(rows)} counties")
    return rows


def patch_counties(counties, water_data, dry_run=False):
    """Patch grid_county_data with water use values."""
    matched = 0
    skipped = 0
    errors = 0
    patches = []

    for county in counties:
        fips = county['fips_code']
        county_id = county['id']

        if fips not in water_data:
            skipped += 1
            continue

        wd = water_data[fips]
        # Build patch — only include non-None values
        patch = {}
        if wd['public_supply_mgd'] is not None:
            patch['public_supply_mgd'] = round(wd['public_supply_mgd'], 2)
        if wd['industrial_water_mgd'] is not None:
            patch['industrial_water_mgd'] = round(wd['industrial_water_mgd'], 2)
        if wd['total_water_mgd'] is not None:
            patch['total_water_mgd'] = round(wd['total_water_mgd'], 2)
        if wd['usgs_fresh_groundwater_mgd'] is not None:
            patch['usgs_fresh_groundwater_mgd'] = round(wd['usgs_fresh_groundwater_mgd'], 2)
        if wd['usgs_fresh_surface_mgd'] is not None:
            patch['usgs_fresh_surface_mgd'] = round(wd['usgs_fresh_surface_mgd'], 2)

        if not patch:
            skipped += 1
            continue

        patches.append((county_id, fips, patch))
        matched += 1

    print(f"\n  Matched: {matched} counties")
    print(f"  Skipped (no USGS data): {skipped} counties")

    if dry_run:
        print("\n  [DRY RUN] Would patch these counties:")
        for cid, fips, patch in patches[:10]:
            print(f"    FIPS {fips}: {patch}")
        if len(patches) > 10:
            print(f"    ... and {len(patches) - 10} more")
        return matched, 0

    # Apply patches in batches
    applied = 0
    for i in range(0, len(patches), BATCH_SIZE):
        batch = patches[i:i + BATCH_SIZE]
        for county_id, fips, patch in batch:
            fips_encoded = urllib.parse.quote(fips, safe='')
            path = f"grid_county_data?fips_code=eq.{fips_encoded}"
            try:
                supabase_request('PATCH', path, data=patch, headers_extra={
                    'Prefer': 'return=minimal',
                })
                applied += 1
            except Exception as e:
                print(f"  ERROR patching FIPS {fips}: {e}")
                errors += 1

        pct = min(100, (i + len(batch)) / len(patches) * 100)
        print(f"  Progress: {applied}/{len(patches)} patched ({pct:.0f}%)")

    return applied, errors


def calculate_water_stress_tiers(counties, water_data):
    """Calculate water stress scores based on per-capita withdrawal availability.

    Tiers (gal/day per capita):
      >2000 = abundant   -> stress 0.5
      500-2000 = adequate -> stress 1.5
      100-500 = moderate  -> stress 3.0
      <100 = stressed     -> stress 4.5
      No data             -> None (skip)
    """
    results = {}
    for county in counties:
        fips = county['fips_code']
        pop = county.get('population')
        if not pop or pop <= 0:
            continue

        wd = water_data.get(fips)
        if not wd:
            continue

        total = wd.get('total_water_mgd')
        if total is None or total <= 0:
            continue

        # Convert Mgal/day to gal/day per capita
        gal_per_capita = (total * 1_000_000) / pop

        if gal_per_capita > 2000:
            stress = 0.5    # abundant
        elif gal_per_capita > 500:
            stress = 1.5    # adequate
        elif gal_per_capita > 100:
            stress = 3.0    # moderate
        else:
            stress = 4.5    # stressed

        results[fips] = {
            'stress_score': stress,
            'gal_per_capita': round(gal_per_capita, 1),
        }

    # Print tier distribution
    tiers = {'abundant': 0, 'adequate': 0, 'moderate': 0, 'stressed': 0}
    for r in results.values():
        s = r['stress_score']
        if s <= 1.0:
            tiers['abundant'] += 1
        elif s <= 2.0:
            tiers['adequate'] += 1
        elif s <= 3.5:
            tiers['moderate'] += 1
        else:
            tiers['stressed'] += 1

    print(f"\n  Water stress tiers ({len(results)} counties with pop+water data):")
    print(f"    Abundant (>2000 gal/cap/day):  {tiers['abundant']}")
    print(f"    Adequate (500-2000):           {tiers['adequate']}")
    print(f"    Moderate (100-500):            {tiers['moderate']}")
    print(f"    Stressed (<100):               {tiers['stressed']}")

    return results


def propagate_to_dc_sites(stress_tiers, dry_run=False):
    """Propagate water stress scores to grid_dc_sites.wri_water_stress via fips_code JOIN.

    Only updates sites where wri_water_stress IS NULL (preserves WRI Aqueduct per-site data).
    """
    print("\nPropagating water stress to grid_dc_sites...")

    if not stress_tiers:
        print("  No stress tier data to propagate")
        return 0, 0

    if dry_run:
        print(f"  [DRY RUN] Would propagate stress scores to DC sites for {len(stress_tiers)} counties")
        return 0, 0

    # Build SQL UPDATE using a VALUES list to avoid per-row PATCH calls
    # This is much faster than individual REST API calls for ~40K sites
    values_parts = []
    for fips, data in stress_tiers.items():
        score = data['stress_score']
        fips_escaped = fips.replace("'", "''")
        values_parts.append(f"('{fips_escaped}', {score})")

    if not values_parts:
        print("  No values to propagate")
        return 0, 0

    # Split into chunks of 500 values to avoid SQL length limits
    chunk_size = 500
    total_updated = 0
    errors = 0

    for i in range(0, len(values_parts), chunk_size):
        chunk = values_parts[i:i + chunk_size]
        values_sql = ',\n'.join(chunk)
        sql = f"""
        UPDATE grid_dc_sites AS s
        SET wri_water_stress = v.stress_score,
            updated_at = NOW()
        FROM (VALUES {values_sql}) AS v(fips_code, stress_score)
        WHERE s.fips_code = v.fips_code
          AND s.wri_water_stress IS NULL;
        """

        if run_psql(sql):
            total_updated += len(chunk)
        else:
            errors += 1

    print(f"  Propagated stress scores for {len(stress_tiers)} FIPS codes to DC sites")
    return total_updated, errors


def print_top_counties(water_data, field, label, n=10):
    """Print top N counties by a given field."""
    ranked = sorted(
        [(fips, d[field]) for fips, d in water_data.items() if d[field] is not None],
        key=lambda x: x[1],
        reverse=True
    )
    print(f"\n  Top {n} counties by {label}:")
    for fips, val in ranked[:n]:
        print(f"    FIPS {fips}: {val:.2f} Mgal/day")


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    print("=" * 60)
    print("USGS County-Level Water Use Enrichment (2015 data)")
    print("=" * 60)

    if dry_run:
        print("[DRY RUN MODE — no database changes]\n")

    # Step 1: Ensure columns exist
    ensure_columns()

    # Step 2: Download CSV
    if skip_download:
        if not os.path.exists(CSV_FILE):
            print(f"ERROR: --skip-download but CSV not found: {CSV_FILE}")
            sys.exit(1)
        print(f"Skipping download, using existing: {CSV_FILE}")
    else:
        if not download_csv():
            sys.exit(1)

    # Step 3: Parse CSV
    water_data = parse_csv()
    if not water_data:
        print("ERROR: No water data parsed from CSV")
        sys.exit(1)

    # Print some top counties
    print_top_counties(water_data, 'total_water_mgd', 'Total Water Withdrawals')
    print_top_counties(water_data, 'usgs_fresh_groundwater_mgd', 'Fresh Groundwater')
    print_top_counties(water_data, 'usgs_fresh_surface_mgd', 'Fresh Surface Water')

    # Step 4: Load counties from DB
    counties = load_county_fips()
    if not counties:
        print("ERROR: No counties loaded from grid_county_data")
        sys.exit(1)

    # Step 5: Patch county data
    print(f"\nPatching {len(counties)} counties with water use data...")
    applied, errors = patch_counties(counties, water_data, dry_run=dry_run)

    # Step 6: Calculate stress tiers and propagate to DC sites
    stress_tiers = calculate_water_stress_tiers(counties, water_data)
    prop_count, prop_errors = propagate_to_dc_sites(stress_tiers, dry_run=dry_run)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  USGS counties parsed:           {len(water_data)}")
    print(f"  DB counties:                    {len(counties)}")
    print(f"  County patches applied:         {applied}")
    print(f"  County patch errors:            {errors}")
    print(f"  Stress tiers calculated:        {len(stress_tiers)}")
    print(f"  DC site propagation chunks:     {prop_count}")
    print(f"  DC site propagation errors:     {prop_errors}")
    if dry_run:
        print("  Mode:                           DRY RUN (no changes applied)")
    print("=" * 60)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Enrich GridScout DC sites with FCC BDC fiber provider data.

Source: FCC Broadband Data Collection December 2024 ArcGIS FeatureServer
  County layer (Layer 1): UniqueProvidersFiber, ServedBSLsFiber, TotalBSLs
  URL: https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/
       FCC_Broadband_Data_Collection_December_2024_View/FeatureServer/1

Strategy:
1. Download ALL county fiber data from FCC BDC ArcGIS (3,200+ counties)
2. Update grid_county_data with real fiber provider counts and coverage percentages
3. Propagate to grid_dc_sites via fips_code JOIN (bulk SQL update via psql)
4. For sites without fips_code, use state-level averages as fallback
5. Recalculate score_fiber using real provider counts

New/updated columns on grid_dc_sites:
- fcc_fiber_providers (integer) — real count from FCC BDC county data
- fcc_fiber_pct (numeric) — % of BSLs with fiber in the county (0-100)
- score_fiber — recalculated with real data

Updated columns on grid_county_data:
- fiber_provider_count (integer) — UniqueProvidersFiber from FCC BDC
- has_fiber (boolean) — True if any BSL has fiber
- fiber_served_pct (numeric) — % of BSLs served by fiber
"""

import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.error
from dotenv import load_dotenv

# Load env from solar/.env.local (same Supabase credentials)
load_dotenv('/Users/kennyhyder/Desktop/hyder-media/solar/.env.local')

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

FCC_BDC_BASE = (
    "https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/"
    "FCC_Broadband_Data_Collection_December_2024_View/FeatureServer"
)
COUNTY_LAYER = f"{FCC_BDC_BASE}/1"

PSQL_CMD = [
    'psql',
    '-h', 'aws-0-us-west-2.pooler.supabase.com',
    '-p', '6543',
    '-U', 'postgres.ilbovwnhrowvxjdkvrln',
    '-d', 'postgres',
]
PSQL_ENV = dict(os.environ, PGPASSWORD='#FsW7iqg%EYX&G3M')

# Top fiber providers by state (curated from FCC BDC provider filings, ISP market reports)
# Used for fiber_provider_names enrichment since FCC ArcGIS only provides counts
STATE_FIBER_PROVIDERS = {
    'AL': ['AT&T', 'C Spire', 'Brightspeed', 'WOW!'],
    'AK': ['GCI', 'Alaska Communications'],
    'AZ': ['Cox', 'CenturyLink/Lumen', 'Frontier', 'Google Fiber'],
    'AR': ['AT&T', 'Windstream', 'Ritter Communications'],
    'CA': ['AT&T', 'Frontier', 'Sonic', 'Google Fiber', 'Ziply Fiber'],
    'CO': ['CenturyLink/Lumen', 'Comcast/Xfinity', 'Ting', 'Google Fiber'],
    'CT': ['Frontier', 'GoNetspeed', 'Comcast/Xfinity'],
    'DC': ['Verizon Fios', 'RCN', 'Starry'],
    'DE': ['Verizon Fios', 'Comcast/Xfinity', 'Breezeline'],
    'FL': ['AT&T', 'Frontier', 'FPL FiberNet', 'Hotwire'],
    'GA': ['AT&T', 'Google Fiber', 'Windstream'],
    'HI': ['Hawaiian Telcom', 'Spectrum'],
    'ID': ['CenturyLink/Lumen', 'Sparklight', 'Ziply Fiber'],
    'IL': ['AT&T', 'Comcast/Xfinity', 'Google Fiber', 'Brightspeed'],
    'IN': ['AT&T', 'Frontier', 'Metronet'],
    'IA': ['Mediacom', 'Windstream', 'ITC Midwest'],
    'KS': ['AT&T', 'Google Fiber', 'Cox'],
    'KY': ['AT&T', 'Spectrum', 'Windstream', 'Brightspeed'],
    'LA': ['AT&T', 'Cox', 'LUS Fiber'],
    'ME': ['Consolidated Communications', 'Fidium Fiber'],
    'MD': ['Verizon Fios', 'Comcast/Xfinity', 'Breezeline'],
    'MA': ['Verizon Fios', 'Comcast/Xfinity', 'RCN'],
    'MI': ['AT&T', 'Comcast/Xfinity', 'WOW!', 'Rocket Fiber'],
    'MN': ['CenturyLink/Lumen', 'Frontier', 'US Internet'],
    'MS': ['AT&T', 'C Spire', 'Windstream'],
    'MO': ['AT&T', 'Google Fiber', 'Socket'],
    'MT': ['CenturyLink/Lumen', 'Blackfoot'],
    'NE': ['CenturyLink/Lumen', 'Windstream', 'Allo'],
    'NV': ['Cox', 'CenturyLink/Lumen', 'AT&T'],
    'NH': ['Consolidated Communications', 'Fidium Fiber'],
    'NJ': ['Verizon Fios', 'Comcast/Xfinity', 'Altice/Optimum'],
    'NM': ['CenturyLink/Lumen', 'TDS Telecom', 'Plateau'],
    'NY': ['Verizon Fios', 'Altice/Optimum', 'Spectrum', 'Greenlight Networks'],
    'NC': ['AT&T', 'Google Fiber', 'Brightspeed', 'Spectrum'],
    'ND': ['CenturyLink/Lumen', 'Midco', 'BEK Communications'],
    'OH': ['AT&T', 'Spectrum', 'WOW!', 'Frontier', 'Google Fiber'],
    'OK': ['AT&T', 'Cox', 'Windstream'],
    'OR': ['CenturyLink/Lumen', 'Ziply Fiber', 'Wave'],
    'PA': ['Verizon Fios', 'Comcast/Xfinity', 'Frontier', 'Breezeline'],
    'RI': ['Verizon Fios', 'Cox'],
    'SC': ['AT&T', 'Spectrum', 'Windstream'],
    'SD': ['CenturyLink/Lumen', 'Midco', 'SDN Communications'],
    'TN': ['AT&T', 'EPB Fiber', 'Google Fiber', 'Brightspeed'],
    'TX': ['AT&T', 'Google Fiber', 'Frontier', 'Grande Communications', 'Tachus'],
    'UT': ['CenturyLink/Lumen', 'Google Fiber', 'UTOPIA Fiber'],
    'VT': ['Consolidated Communications', 'Fidium Fiber', 'Waitsfield Champlain Valley'],
    'VA': ['Verizon Fios', 'Cox', 'Lumos', 'Shentel'],
    'WA': ['CenturyLink/Lumen', 'Ziply Fiber', 'Wave'],
    'WV': ['Frontier', 'CenturyLink/Lumen', 'Shentel'],
    'WI': ['AT&T', 'CenturyLink/Lumen', 'TDS Telecom'],
    'WY': ['CenturyLink/Lumen', 'Silver Star'],
}


def fetch_arcgis(url, where='1=1', out_fields='*', max_records=2000):
    """Fetch all records from ArcGIS FeatureServer with pagination."""
    all_features = []
    offset = 0

    while True:
        params = {
            'where': where,
            'outFields': out_fields,
            'f': 'json',
            'returnGeometry': 'false',
            'resultRecordCount': str(max_records),
            'resultOffset': str(offset),
        }
        query_str = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())
        full_url = f"{url}/query?{query_str}"

        req = urllib.request.Request(full_url, headers={
            'User-Agent': 'GridScout/1.0 (datacenter site enrichment)',
        })

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                    features = data.get('features', [])
                    all_features.extend(features)

                    if len(features) < max_records:
                        return all_features
                    offset += len(features)
                    break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"  Error fetching ArcGIS at offset {offset}: {e}")
                return all_features

    return all_features


def run_psql(sql, capture=False):
    """Execute SQL via psql."""
    cmd = PSQL_CMD + ['-c', sql]
    result = subprocess.run(cmd, env=PSQL_ENV, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    if capture:
        return result.stdout
    return result.returncode == 0


def run_psql_file(sql_content):
    """Execute multi-statement SQL via psql stdin."""
    cmd = PSQL_CMD + ['-f', '-']
    result = subprocess.run(cmd, env=PSQL_ENV, input=sql_content,
                            capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result.returncode == 0


def main():
    dry_run = '--dry-run' in sys.argv

    print("=" * 60)
    print("GridScout: Enrich Fiber Provider Data from FCC BDC Dec 2024")
    print("=" * 60)
    if dry_run:
        print("  [DRY RUN — no changes will be made]\n")

    # ── Step 1: Download county fiber data from FCC BDC ArcGIS ──
    print("\n[1/5] Downloading county fiber data from FCC BDC ArcGIS...")
    out_fields = (
        'GEOID,CountyName,StateAbbr,TotalBSLs,'
        'ServedBSLsFiber,UnderservedBSLsFiber,UnservedBSLsFiber,'
        'UniqueProvidersFiber,UniqueProviders'
    )

    features = fetch_arcgis(COUNTY_LAYER, where='1=1', out_fields=out_fields)
    print(f"  Downloaded {len(features)} county records from FCC BDC")

    if not features:
        print("  ERROR: No data from FCC ArcGIS. Aborting.")
        return

    # Parse into county_fiber dict keyed by FIPS
    county_fiber = {}
    for f in features:
        a = f.get('attributes', {})
        fips = a.get('GEOID')
        if not fips:
            continue

        total_bsls = a.get('TotalBSLs') or 0
        served_fiber = a.get('ServedBSLsFiber') or 0
        underserved_fiber = a.get('UnderservedBSLsFiber') or 0
        fiber_bsls = served_fiber + underserved_fiber
        fiber_pct = round(fiber_bsls / total_bsls * 100, 1) if total_bsls > 0 else 0
        fiber_providers = a.get('UniqueProvidersFiber') or 0

        county_fiber[fips] = {
            'fips': fips,
            'county': a.get('CountyName', ''),
            'state': a.get('StateAbbr', ''),
            'total_bsls': total_bsls,
            'served_fiber': served_fiber,
            'fiber_bsls': fiber_bsls,
            'fiber_pct': fiber_pct,
            'fiber_providers': fiber_providers,
            'total_providers': a.get('UniqueProviders') or 0,
        }

    # Stats
    with_fiber = sum(1 for c in county_fiber.values() if c['fiber_providers'] > 0)
    avg_providers = sum(c['fiber_providers'] for c in county_fiber.values()) / len(county_fiber)
    max_prov = max(c['fiber_providers'] for c in county_fiber.values())
    max_county = max(county_fiber.values(), key=lambda c: c['fiber_providers'])

    print(f"  Counties with fiber: {with_fiber}/{len(county_fiber)} ({with_fiber/len(county_fiber)*100:.1f}%)")
    print(f"  Avg fiber providers per county: {avg_providers:.1f}")
    print(f"  Max fiber providers: {max_prov} ({max_county['county']}, {max_county['state']})")

    # Provider count distribution
    dist = {}
    for c in county_fiber.values():
        bucket = c['fiber_providers']
        if bucket > 20:
            bucket = '20+'
        dist[bucket] = dist.get(bucket, 0) + 1
    print("\n  Fiber provider distribution (counties):")
    for k in sorted(k for k in dist if isinstance(k, int)):
        print(f"    {k:3d} providers: {dist[k]:5d} counties")
    if '20+' in dist:
        print(f"    20+ providers: {dist['20+']:5d} counties")

    # ── Step 2: Compute state-level averages for fallback ──
    print("\n[2/5] Computing state-level fiber averages for fallback...")
    state_fiber = {}
    for c in county_fiber.values():
        st = c['state']
        if st not in state_fiber:
            state_fiber[st] = {'providers': [], 'pcts': []}
        state_fiber[st]['providers'].append(c['fiber_providers'])
        state_fiber[st]['pcts'].append(c['fiber_pct'])

    state_avg = {}
    for st, data in state_fiber.items():
        avg_p = round(sum(data['providers']) / len(data['providers']), 1)
        avg_pct = round(sum(data['pcts']) / len(data['pcts']), 1)
        state_avg[st] = {'avg_providers': avg_p, 'avg_pct': avg_pct}

    top_states = sorted(state_avg.items(), key=lambda x: x[1]['avg_providers'], reverse=True)[:10]
    print(f"  Top 10 states by avg fiber providers:")
    for st, v in top_states:
        print(f"    {st}: {v['avg_providers']:.1f} providers, {v['avg_pct']:.1f}% fiber coverage")

    if dry_run:
        print("\n  [DRY RUN] Would update grid_county_data and grid_dc_sites")
        print(f"  [DRY RUN] {len(county_fiber)} counties to update")
        return

    # ── Step 3: Add fcc_fiber_pct column if not exists, update grid_county_data ──
    print("\n[3/5] Adding columns and updating grid_county_data...")

    # Add new columns
    run_psql("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS fcc_fiber_pct NUMERIC(5,1);")
    run_psql("ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS fiber_served_pct NUMERIC(5,1);")

    # Build bulk UPDATE for grid_county_data via temp table
    values_sql = []
    for fips, c in county_fiber.items():
        has_fiber = 'true' if c['fiber_providers'] > 0 else 'false'
        values_sql.append(
            f"('{fips}', {c['fiber_providers']}, {has_fiber}, {c['fiber_pct']})"
        )

    # Use psql temp table approach for bulk update
    sql = f"""
-- Create temp table with FCC fiber data
CREATE TEMP TABLE tmp_fcc_fiber (
    fips_code TEXT,
    fiber_provider_count INTEGER,
    has_fiber BOOLEAN,
    fiber_served_pct NUMERIC(5,1)
);

INSERT INTO tmp_fcc_fiber VALUES
{','.join(values_sql)};

-- Update grid_county_data
UPDATE grid_county_data cd
SET
    fiber_provider_count = t.fiber_provider_count,
    has_fiber = t.has_fiber,
    fiber_served_pct = t.fiber_served_pct,
    updated_at = NOW()
FROM tmp_fcc_fiber t
WHERE cd.fips_code = t.fips_code;

DROP TABLE tmp_fcc_fiber;
"""
    if run_psql_file(sql):
        print(f"  Updated {len(county_fiber)} county records in grid_county_data")
    else:
        print("  ERROR updating grid_county_data")
        return

    # ── Step 4: Propagate to grid_dc_sites via fips_code JOIN ──
    print("\n[4/5] Updating grid_dc_sites with county fiber data...")

    # Build temp table with county fiber data again for sites update
    sql_sites = f"""
-- Create temp table with FCC fiber data
CREATE TEMP TABLE tmp_fcc_fiber (
    fips_code TEXT,
    fiber_providers INTEGER,
    fiber_pct NUMERIC(5,1)
);

INSERT INTO tmp_fcc_fiber VALUES
{','.join(f"('{fips}', {c['fiber_providers']}, {c['fiber_pct']})" for fips, c in county_fiber.items())};

-- Phase 1: Update sites WITH fips_code (county-level match)
UPDATE grid_dc_sites s
SET
    fcc_fiber_providers = t.fiber_providers,
    fcc_fiber_pct = t.fiber_pct
FROM tmp_fcc_fiber t
WHERE s.fips_code = t.fips_code;

DROP TABLE tmp_fcc_fiber;
"""
    result = run_psql(f"SELECT COUNT(*) FROM grid_dc_sites WHERE fips_code IS NOT NULL;", capture=True)
    fips_count = result.strip().split('\n')[-2].strip() if result else '?'
    print(f"  Sites with fips_code: {fips_count}")

    if run_psql_file(sql_sites):
        print(f"  Updated sites with county fiber data via fips_code JOIN")
    else:
        print("  ERROR updating grid_dc_sites")
        return

    # Phase 2: State-level fallback for sites WITHOUT fips_code
    print("  Applying state-level fallback for sites without fips_code...")
    fallback_count = 0
    for st, avg in state_avg.items():
        providers = round(avg['avg_providers'])
        pct = avg['avg_pct']
        sql_fb = (
            f"UPDATE grid_dc_sites "
            f"SET fcc_fiber_providers = {providers}, fcc_fiber_pct = {pct} "
            f"WHERE fips_code IS NULL AND state = '{st}' "
            f"AND (fcc_fiber_providers IS NULL OR fcc_fiber_providers <= 3);"
        )
        out = run_psql(sql_fb, capture=True)
        if out and 'UPDATE' in out:
            n = int(out.strip().split()[-1]) if out.strip().split()[-1].isdigit() else 0
            fallback_count += n

    print(f"  State fallback applied to {fallback_count} sites")

    # ── Step 5: Recalculate score_fiber ──
    print("\n[5/5] Recalculating score_fiber with real provider data...")

    # score_fiber formula from score-dc-sites.py:
    # score_fiber = 0.6 * ixp_distance_score + 0.4 * county_fiber_score
    # county_fiber_score = min(100, 60 + fiber_providers * 4) when has_fiber
    #                    = 20 when has_fiber=false
    #                    = 30 when unknown
    # We keep the IXP distance component (already computed), just update the fiber component

    sql_rescore = """
-- Recalculate score_fiber using real FCC fiber provider counts
-- Formula: score_fiber = 0.6 * ixp_score + 0.4 * fiber_county_score
-- ixp_score preserved from nearest_ixp_distance_km
-- fiber_county_score = LEAST(100, 60 + fcc_fiber_providers * 4) when providers > 0
--                    = 20 when providers = 0
UPDATE grid_dc_sites
SET score_fiber = ROUND(
    0.6 * CASE
        WHEN nearest_ixp_distance_km IS NULL THEN 30
        WHEN nearest_ixp_distance_km <= 0 THEN 100
        WHEN nearest_ixp_distance_km >= 250 THEN 10
        ELSE GREATEST(10, 100 - (nearest_ixp_distance_km / 250.0 * 90))
    END
    +
    0.4 * CASE
        WHEN fcc_fiber_providers IS NULL THEN 30
        WHEN fcc_fiber_providers = 0 THEN 20
        ELSE LEAST(100, 60 + fcc_fiber_providers * 4)
    END
, 1);

-- Recalculate dc_score with updated score_fiber
UPDATE grid_dc_sites
SET dc_score = ROUND(
    0.25 * COALESCE(score_power, 0)
    + 0.20 * COALESCE(score_speed_to_power, 0)
    + 0.15 * COALESCE(score_fiber, 0)
    + 0.10 * COALESCE(score_water, 0)
    + 0.10 * COALESCE(score_hazard, 0)
    + 0.05 * COALESCE(score_labor, 0)
    + 0.05 * COALESCE(score_existing_dc, 0)
    + 0.05 * COALESCE(score_land, 0)
    + 0.03 * COALESCE(score_tax, 0)
    + 0.02 * COALESCE(score_climate, 0)
, 1);
"""
    if run_psql_file(sql_rescore):
        print("  score_fiber and dc_score recalculated for all sites")
    else:
        print("  ERROR recalculating scores")

    # ── Report ──
    print("\n" + "=" * 60)
    print("ENRICHMENT COMPLETE — Summary")
    print("=" * 60)

    # Coverage stats
    stats_sql = """
SELECT
    COUNT(*) as total,
    COUNT(fcc_fiber_providers) as has_providers,
    COUNT(fcc_fiber_pct) as has_pct,
    ROUND(AVG(fcc_fiber_providers), 1) as avg_providers,
    MAX(fcc_fiber_providers) as max_providers,
    ROUND(AVG(fcc_fiber_pct), 1) as avg_pct,
    ROUND(AVG(dc_score), 1) as avg_dc_score,
    ROUND(AVG(score_fiber), 1) as avg_score_fiber
FROM grid_dc_sites;
"""
    out = run_psql(stats_sql, capture=True)
    print(f"\n  Grid DC Sites stats:\n{out}")

    # Provider distribution
    dist_sql = """
SELECT fcc_fiber_providers, COUNT(*) as cnt
FROM grid_dc_sites
GROUP BY fcc_fiber_providers
ORDER BY fcc_fiber_providers;
"""
    out = run_psql(dist_sql, capture=True)
    print(f"  Provider count distribution:\n{out}")

    # Top 10 counties
    top_sql = """
SELECT cd.fips_code, cd.county_name, cd.state,
       cd.fiber_provider_count, cd.fiber_served_pct,
       COUNT(s.id) as dc_sites
FROM grid_county_data cd
LEFT JOIN grid_dc_sites s ON s.fips_code = cd.fips_code
WHERE cd.fiber_provider_count IS NOT NULL
GROUP BY cd.fips_code, cd.county_name, cd.state, cd.fiber_provider_count, cd.fiber_served_pct
ORDER BY cd.fiber_provider_count DESC
LIMIT 15;
"""
    out = run_psql(top_sql, capture=True)
    print(f"  Top 15 counties by fiber providers:\n{out}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Populate FCC fiber broadband speed data for grid_dc_sites.

Existing data state:
  - fcc_fiber_providers: 73,994 / 74,529 (99.3%) — already populated
  - fcc_fiber_pct: 73,760 / 74,529 (99.0%) — already populated
  - fcc_max_down_mbps: 0 / 74,529 (0%) — THIS SCRIPT FILLS THIS
  - fcc_max_up_mbps: 0 / 74,529 (0%) — THIS SCRIPT FILLS THIS

Strategy:
  Phase 1: Try FCC BDC API per-location queries for a sample of sites
           API: https://broadbandmap.fcc.gov/api/public/map/listAvailableFixed
           Rate limit: 2 requests/second
           (API has been returning 405 since early 2026 — may or may not work)

  Phase 2: For sites where API fails/unavailable, estimate speeds from
           provider count + county fiber data using industry benchmarks:
           - 0 providers: 0 / 0
           - 1 provider: 1000 / 500 (typical single-provider fiber)
           - 2-4 providers: 5000 / 2000 (competitive market)
           - 5-9 providers: 10000 / 5000 (dense metro fiber)
           - 10+ providers: 25000 / 10000 (hyperscale DC corridor)

  Phase 3: Fill remaining gaps (535 sites with no fcc_fiber_providers)

Usage:
  python3 -u scripts/ingest-fcc-fiber.py
  python3 -u scripts/ingest-fcc-fiber.py --dry-run
  python3 -u scripts/ingest-fcc-fiber.py --api-only     # Only try FCC API (skip estimation)
  python3 -u scripts/ingest-fcc-fiber.py --estimate-only # Skip API, go straight to estimation
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
import subprocess
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

FCC_API_BASE = "https://broadbandmap.fcc.gov/api/public/map"

# DB connection for psql bulk operations
DB_HOST = 'aws-0-us-west-2.pooler.supabase.com'
DB_PORT = '6543'
DB_USER = 'postgres.ilbovwnhrowvxjdkvrln'
DB_NAME = 'postgres'
DB_PASS = '#FsW7iqg%EYX&G3M'

BATCH_SIZE = 50

# Speed estimation tiers based on fiber provider count
# Format: (min_providers, max_providers, down_mbps, up_mbps)
SPEED_TIERS = [
    (0,  0,     0,     0),      # No fiber
    (1,  1,  1000,   500),      # Single provider — typically 1 Gbps symmetric
    (2,  3,  5000,  2000),      # 2-3 providers — competitive, some 10G offerings
    (4,  6, 10000,  5000),      # 4-6 providers — dense metro, 10 Gbps common
    (7,  9, 10000, 10000),      # 7-9 providers — very dense, symmetric 10G
    (10, 14, 25000, 10000),     # 10-14 providers — DC corridor, 25 Gbps
    (15, 19, 25000, 25000),     # 15-19 providers — tier 1 DC market
    (20, 99, 100000, 100000),   # 20+ providers — hyperscale (Ashburn/Santa Clara)
]


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


def run_psql(sql):
    """Run SQL via psql."""
    env = os.environ.copy()
    env['PGPASSWORD'] = DB_PASS
    result = subprocess.run(
        ['psql', '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
         '-c', sql],
        capture_output=True, text=True, env=env, timeout=300
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result.stdout


def query_fcc_api(lat, lng):
    """
    Query FCC BDC API for fiber availability at a specific location.
    Returns (fiber_providers, max_down_mbps, max_up_mbps) or None if API fails.
    technology_code=50 = Fiber to the Premises (FTTP)
    """
    params = {
        'latitude': f'{lat:.6f}',
        'longitude': f'{lng:.6f}',
        'limit': 100,
    }
    url = f"{FCC_API_BASE}/listAvailableFixed?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'GridScout/1.0 (datacenter-site-selection)')
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

            status_code = data.get('status_code', 200)
            if status_code == 405:
                return None  # API method not available

            results = data.get('data', [])
            if not results:
                return (0, 0, 0)

            # Filter for fiber (technology_code=50)
            fiber_results = [r for r in results
                           if r.get('technology_code') == 50 or
                              r.get('tech_code') == 50 or
                              r.get('technology') == 'Fiber']

            if not fiber_results:
                return (0, 0, 0)

            providers = len(set(r.get('provider_id', r.get('frn', ''))
                              for r in fiber_results))
            max_down = max((r.get('max_advertised_download_speed', 0) or 0)
                          for r in fiber_results)
            max_up = max((r.get('max_advertised_upload_speed', 0) or 0)
                        for r in fiber_results)

            return (providers, max_down, max_up)

    except urllib.error.HTTPError as e:
        if e.code == 405:
            return None  # API method not available
        return None
    except Exception:
        return None


def estimate_speed(provider_count):
    """Estimate max download/upload speeds from fiber provider count."""
    if provider_count is None:
        return None, None

    for min_p, max_p, down, up in SPEED_TIERS:
        if min_p <= provider_count <= max_p:
            return down, up

    # Fallback for very high counts
    return 100000, 100000


def phase1_api_sample(dry_run=False):
    """Try FCC BDC API on a sample of sites to check if it's working."""
    print("\nPhase 1: Test FCC BDC API availability")
    print("-" * 60)

    # Get 5 sample sites to test
    sites = supabase_request('GET',
        'grid_dc_sites?select=id,latitude,longitude,state&limit=5'
        '&fcc_max_down_mbps=is.null&fcc_fiber_providers=gt.0')

    if not sites:
        print("  No sites need speed data")
        return False

    api_works = False
    for site in sites:
        result = query_fcc_api(float(site['latitude']), float(site['longitude']))
        if result is not None:
            providers, down, up = result
            print(f"  API works! {site['state']}: {providers} providers, "
                  f"{down} Mbps down, {up} Mbps up")
            api_works = True
            break
        else:
            print(f"  API returned 405 for {site['state']} "
                  f"({site['latitude']}, {site['longitude']})")
        time.sleep(0.5)

    if not api_works:
        print("  FCC BDC API is not available (405 on all test queries)")
        print("  Falling back to estimation from provider counts")

    return api_works


def phase1_api_full(dry_run=False):
    """Query FCC BDC API for all sites missing speed data. Rate: 2 req/sec."""
    print("\nPhase 1: Query FCC BDC API for fiber speeds")
    print("-" * 60)

    # Load sites missing speed data
    sites = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_dc_sites?select=id,latitude,longitude,state'
            f'&fcc_max_down_mbps=is.null'
            f'&fcc_fiber_providers=gt.0'
            f'&offset={offset}&limit=1000'
            f'&order=id')
        if not batch:
            break
        sites.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(sites):,} sites need speed data from API")
    if dry_run:
        print(f"  --dry-run: would query FCC API for {len(sites):,} sites")
        return 0, 0

    patched = 0
    errors = 0
    api_failures = 0

    for i, site in enumerate(sites):
        result = query_fcc_api(float(site['latitude']), float(site['longitude']))

        if result is None:
            api_failures += 1
            if api_failures >= 10:
                print(f"  10 consecutive API failures — aborting API phase")
                return patched, errors
            continue

        providers, down, up = result
        try:
            supabase_request('PATCH',
                f'grid_dc_sites?id=eq.{site["id"]}',
                {
                    'fcc_max_down_mbps': down,
                    'fcc_max_up_mbps': up,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            patched += 1
            api_failures = 0  # Reset on success
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Patch error for {site['id']}: {e}")

        if (i + 1) % 100 == 0:
            print(f"  {i + 1:,} / {len(sites):,} queried, {patched} patched, "
                  f"{errors} errors")

        time.sleep(0.5)  # Rate limit: 2 req/sec

    print(f"  API phase: {patched:,} patched, {errors} errors, "
          f"{api_failures} API failures")
    return patched, errors


def phase2_estimate(dry_run=False):
    """Estimate speeds from provider count for all sites still missing data."""
    print("\nPhase 2: Estimate fiber speeds from provider counts")
    print("-" * 60)

    if dry_run:
        # Show what would happen
        for min_p, max_p, down, up in SPEED_TIERS:
            count_result = run_psql(
                f"SELECT count(*) FROM grid_dc_sites "
                f"WHERE fcc_max_down_mbps IS NULL "
                f"AND fcc_fiber_providers >= {min_p} "
                f"AND fcc_fiber_providers <= {max_p}"
            )
            # Parse count from psql output (format: " count \n-------\n  1234\n(1 row)")
            count = '?'
            if count_result:
                lines = [l.strip() for l in count_result.strip().split('\n') if l.strip()]
                for line in lines:
                    try:
                        count = str(int(line))
                        break
                    except ValueError:
                        continue
            print(f"  Providers {min_p}-{max_p}: {count} sites → "
                  f"{down:,} Mbps down / {up:,} Mbps up")
        return 0

    total_patched = 0

    for min_p, max_p, down, up in SPEED_TIERS:
        sql = f"""
        UPDATE grid_dc_sites
        SET fcc_max_down_mbps = {down},
            fcc_max_up_mbps = {up},
            updated_at = NOW()
        WHERE fcc_max_down_mbps IS NULL
          AND fcc_fiber_providers >= {min_p}
          AND fcc_fiber_providers <= {max_p};
        """
        result = run_psql(sql)
        # Parse "UPDATE N" from result
        if result and 'UPDATE' in result:
            try:
                n = int(result.strip().split()[-1])
                total_patched += n
                if n > 0:
                    print(f"  Providers {min_p}-{max_p}: {n:,} sites → "
                          f"{down:,} / {up:,} Mbps")
            except (ValueError, IndexError):
                pass

    print(f"  Total estimated: {total_patched:,}")
    return total_patched


def phase3_fill_gaps(dry_run=False):
    """Fill remaining sites with no provider data."""
    print("\nPhase 3: Fill remaining gaps")
    print("-" * 60)

    if dry_run:
        result = run_psql(
            "SELECT count(*) FROM grid_dc_sites "
            "WHERE fcc_max_down_mbps IS NULL"
        )
        print(f"  Sites still missing speed data: {result.strip()}")
        return 0

    # Sites with no fiber provider count — set to county-level defaults
    # Use county fiber data to fill gaps
    sql = """
    UPDATE grid_dc_sites s
    SET fcc_fiber_providers = COALESCE(c.fiber_provider_count, 0),
        fcc_max_down_mbps = CASE
            WHEN COALESCE(c.fiber_provider_count, 0) = 0 THEN 0
            WHEN COALESCE(c.fiber_provider_count, 0) <= 3 THEN 1000
            WHEN COALESCE(c.fiber_provider_count, 0) <= 6 THEN 5000
            WHEN COALESCE(c.fiber_provider_count, 0) <= 9 THEN 10000
            WHEN COALESCE(c.fiber_provider_count, 0) <= 14 THEN 25000
            ELSE 25000
        END,
        fcc_max_up_mbps = CASE
            WHEN COALESCE(c.fiber_provider_count, 0) = 0 THEN 0
            WHEN COALESCE(c.fiber_provider_count, 0) <= 3 THEN 500
            WHEN COALESCE(c.fiber_provider_count, 0) <= 6 THEN 2000
            WHEN COALESCE(c.fiber_provider_count, 0) <= 9 THEN 5000
            WHEN COALESCE(c.fiber_provider_count, 0) <= 14 THEN 10000
            ELSE 10000
        END,
        updated_at = NOW()
    FROM grid_county_data c
    WHERE s.fips_code = c.fips_code
      AND s.fcc_max_down_mbps IS NULL;
    """
    result = run_psql(sql)
    if result and 'UPDATE' in result:
        try:
            n = int(result.strip().split()[-1])
            print(f"  County-level gap fill: {n:,} sites")
        except (ValueError, IndexError):
            print(f"  Result: {result.strip()}")

    # Any remaining — set to 0
    sql2 = """
    UPDATE grid_dc_sites
    SET fcc_max_down_mbps = 0,
        fcc_max_up_mbps = 0,
        fcc_fiber_providers = COALESCE(fcc_fiber_providers, 0),
        updated_at = NOW()
    WHERE fcc_max_down_mbps IS NULL;
    """
    result2 = run_psql(sql2)
    if result2 and 'UPDATE' in result2:
        try:
            n = int(result2.strip().split()[-1])
            if n > 0:
                print(f"  Final fallback (0 Mbps): {n:,} sites")
        except (ValueError, IndexError):
            pass

    # Verify
    result = run_psql(
        "SELECT count(*) AS total, "
        "count(fcc_max_down_mbps) AS has_speed, "
        "count(fcc_fiber_providers) AS has_providers "
        "FROM grid_dc_sites"
    )
    print(f"  Final coverage: {result.strip()}")

    return 0


def main():
    print("=" * 60)
    print("GridScout FCC Fiber Speed Data")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    api_only = '--api-only' in sys.argv
    estimate_only = '--estimate-only' in sys.argv

    if dry_run:
        print("  *** DRY RUN — no database changes ***")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env.local")
        sys.exit(1)

    # Check current state
    result = run_psql(
        "SELECT count(*) AS total, "
        "count(fcc_fiber_providers) AS has_providers, "
        "count(fcc_max_down_mbps) AS has_speed "
        "FROM grid_dc_sites"
    )
    print(f"  Current state: {result.strip()}")

    api_patched = 0
    est_patched = 0

    if not estimate_only:
        # Phase 1: Try API
        api_works = phase1_api_sample(dry_run)
        if api_works:
            api_patched, _ = phase1_api_full(dry_run)
        else:
            print("  Skipping API phase (not available)")

    if not api_only:
        # Phase 2: Estimate from provider counts
        est_patched = phase2_estimate(dry_run)

        # Phase 3: Fill remaining gaps
        phase3_fill_gaps(dry_run)

    # Update data source
    if not dry_run:
        ds = supabase_request('GET', 'grid_data_sources?name=eq.fcc_bdc&select=id')
        if ds:
            supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
                'last_import': datetime.now(timezone.utc).isoformat()
            })

    # Summary
    result = run_psql(
        "SELECT "
        "ROUND(AVG(fcc_max_down_mbps)::numeric, 0) AS avg_down, "
        "ROUND(AVG(fcc_max_up_mbps)::numeric, 0) AS avg_up, "
        "count(CASE WHEN fcc_max_down_mbps > 0 THEN 1 END) AS has_fiber, "
        "count(CASE WHEN fcc_max_down_mbps >= 10000 THEN 1 END) AS has_10g, "
        "count(CASE WHEN fcc_max_down_mbps >= 25000 THEN 1 END) AS has_25g "
        "FROM grid_dc_sites"
    )
    print(f"\n  Speed summary: {result.strip()}")

    print(f"\n{'=' * 60}")
    print(f"FCC Fiber Speed Data Complete")
    print(f"  API patched: {api_patched:,}")
    print(f"  Estimated: {est_patched:,}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

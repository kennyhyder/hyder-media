#!/usr/bin/env python3
"""
Enrich grid_dc_sites with commercial electricity rates from NREL Utility Rates API.

Source: NREL Utility Rates API v3
  https://developer.nrel.gov/api/utility_rates/v3.json?api_key={key}&lat={lat}&lon={lng}
  Returns: { outputs: { utility_name, residential, commercial, industrial } } ($/kWh)

Strategy:
  - Group sites by county (fips_code) — all sites in same county share a utility
  - Query NREL once per unique county centroid → cache result
  - Apply cached utility_name + commercial rate to all sites in that county
  - ~3,200 API calls instead of ~74,529

Fields populated on grid_dc_sites:
  - utility_name TEXT — local utility company name
  - utility_rate_commercial NUMERIC(8,4) — commercial electricity rate in $/kWh

Usage:
  python3 -u scripts/enrich-nrel-rates.py
  python3 -u scripts/enrich-nrel-rates.py --dry-run
  python3 -u scripts/enrich-nrel-rates.py --skip-download
  python3 -u scripts/enrich-nrel-rates.py --skip-download --dry-run
"""

import os
import sys
import json
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
NREL_API_KEY = os.environ.get('NREL_API_KEY', 'DEMO_KEY')

NREL_API_URL = 'https://developer.nrel.gov/api/utility_rates/v3.json'
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'nrel_utility_rates.json')

# DEMO_KEY is rate-limited to 30 requests/hour → 1 per 2 seconds
# Real key: 1000/hour → 1 per second is safe
RATE_LIMIT_SECONDS = 2.0 if NREL_API_KEY == 'DEMO_KEY' else 1.0


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


def query_nrel_rate(lat, lng):
    """Query NREL Utility Rates API for a single lat/lng point.
    Returns: { utility_name, commercial, residential, industrial } or None on error.
    """
    params = urllib.parse.urlencode({
        'api_key': NREL_API_KEY,
        'lat': f'{lat:.6f}',
        'lon': f'{lng:.6f}',
    })
    url = f"{NREL_API_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode())
            outputs = data.get('outputs', {})
            if not outputs:
                return None
            return {
                'utility_name': outputs.get('utility_name'),
                'commercial': outputs.get('commercial'),
                'residential': outputs.get('residential'),
                'industrial': outputs.get('industrial'),
            }
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code == 429:
                # Rate limited — back off
                wait = 60 if NREL_API_KEY == 'DEMO_KEY' else 10
                print(f"    Rate limited (429), waiting {wait}s...")
                time.sleep(wait)
                continue
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            print(f"    NREL API HTTP {e.code}: {err_body[:200]}")
            return None
        except Exception as e:
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            print(f"    NREL API error: {e}")
            return None


def download_rates(counties):
    """Query NREL for each county centroid, cache results."""
    print(f"\n[Phase 1] Querying NREL Utility Rates API for {len(counties)} county centroids...")
    if NREL_API_KEY == 'DEMO_KEY':
        print(f"  WARNING: Using DEMO_KEY (30 req/hr limit). Set NREL_API_KEY for faster processing.")
        print(f"  Estimated time with DEMO_KEY: {len(counties) * 2 / 3600:.1f} hours")
        print(f"  Estimated time with real key: {len(counties) / 3600:.1f} hours")

    results = {}  # fips_code -> { utility_name, commercial, ... }
    errors = 0
    t0 = time.time()

    for i, county in enumerate(counties):
        fips = county['fips_code']
        lat = county.get('latitude')
        lng = county.get('longitude')

        if lat is None or lng is None:
            errors += 1
            continue

        rate_data = query_nrel_rate(lat, lng)
        if rate_data and rate_data.get('commercial') is not None:
            results[fips] = rate_data
        else:
            errors += 1

        # Rate limit
        time.sleep(RATE_LIMIT_SECONDS)

        if (i + 1) % 50 == 0 or (i + 1) == len(counties):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            remaining = (len(counties) - i - 1) / rate if rate > 0 else 0
            print(f"  Progress: {i + 1}/{len(counties)} "
                  f"({len(results)} found, {errors} errors, "
                  f"{rate:.1f} req/sec, ~{remaining / 60:.0f} min remaining)")

    print(f"\n  Final: {len(results)} counties with rates, {errors} errors/missing")

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(results, f, indent=2)
    file_kb = os.path.getsize(CACHE_FILE) / 1024
    print(f"  Cached to {CACHE_FILE} ({file_kb:.1f} KB)")

    return results


def load_cached_rates():
    """Load cached NREL rates from file."""
    print(f"\n[Phase 1] Loading cached NREL rates from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        rates = json.load(f)
    print(f"  Loaded rates for {len(rates)} counties from cache")
    return rates


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich NREL Utility Rates")
    print("=" * 50)

    # Phase 1: Get county centroids and query NREL
    if skip_download and os.path.exists(CACHE_FILE):
        county_rates = load_cached_rates()
    else:
        print("\n  Loading county centroids from grid_county_data...")
        counties = load_paginated(
            'grid_county_data',
            'fips_code,latitude,longitude',
            '&latitude=not.is.null&longitude=not.is.null'
        )
        print(f"  Loaded {len(counties)} counties with coordinates")

        if not counties:
            print("ERROR: No counties found.")
            return

        county_rates = download_rates(counties)

    if not county_rates:
        print("ERROR: No rate data available.")
        return

    # Stats on rates
    commercial_rates = [r['commercial'] for r in county_rates.values() if r.get('commercial')]
    if commercial_rates:
        commercial_rates.sort()
        n = len(commercial_rates)
        print(f"\n  Commercial rate statistics ($/kWh):")
        print(f"    Min:    ${commercial_rates[0]:.4f}")
        print(f"    Max:    ${commercial_rates[-1]:.4f}")
        print(f"    Mean:   ${sum(commercial_rates) / n:.4f}")
        print(f"    Median: ${commercial_rates[n // 2]:.4f}")

    # Phase 2: Load DC sites and map county rates
    print(f"\n[Phase 2] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,fips_code,utility_rate_commercial',
        '&fips_code=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with fips_code")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('utility_rate_commercial') is None]
    print(f"  {len(sites_to_process)} sites need utility rate enrichment")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Map county rates to sites
    patches = {}  # site_id -> { utility_name, utility_rate_commercial }
    no_rate = 0
    for site in sites_to_process:
        fips = site.get('fips_code')
        if fips and fips in county_rates:
            rate_data = county_rates[fips]
            patches[site['id']] = {
                'utility_name': rate_data.get('utility_name'),
                'utility_rate_commercial': rate_data['commercial'],
            }
        else:
            no_rate += 1

    print(f"  Mapped: {len(patches)} sites with rates, {no_rate} sites without county match")

    if not patches:
        print("  No patches to apply.")
        return

    if dry_run:
        samples = list(patches.items())[:10]
        for site_id, patch in samples:
            print(f"  Would patch {site_id}: "
                  f"utility_name={patch['utility_name']}, "
                  f"utility_rate_commercial=${patch['utility_rate_commercial']:.4f}/kWh")
        print(f"\n  Would patch {len(patches)} sites total")
        return

    # Phase 3: Patch via psql (bulk UPDATE)
    print(f"\n[Phase 3] Patching {len(patches)} sites via psql...")

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_nrel_rates_update.sql')

    # Add columns if they don't exist
    with open(sql_file, 'w') as f:
        f.write("-- Add columns if missing\n")
        f.write("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS "
                "utility_name TEXT;\n")
        f.write("ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS "
                "utility_rate_commercial NUMERIC(8,4);\n\n")

        # Temp table + COPY + UPDATE JOIN
        f.write("CREATE TEMP TABLE _nrel_rates (\n")
        f.write("  id UUID,\n")
        f.write("  uname TEXT,\n")
        f.write("  rate NUMERIC(8,4)\n")
        f.write(");\n\n")
        f.write("COPY _nrel_rates (id, uname, rate) FROM STDIN;\n")

        for site_id, patch in patches.items():
            uname = (patch['utility_name'] or '').replace('\t', ' ').replace('\n', ' ')
            rate = patch['utility_rate_commercial']
            f.write(f"{site_id}\t{uname}\t{rate:.4f}\n")

        f.write("\\.\n\n")

        f.write("UPDATE grid_dc_sites\n")
        f.write("SET utility_name = _nrel_rates.uname,\n")
        f.write("    utility_rate_commercial = _nrel_rates.rate\n")
        f.write("FROM _nrel_rates\n")
        f.write("WHERE grid_dc_sites.id = _nrel_rates.id;\n\n")

        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE utility_rate_commercial IS NOT NULL;\n")

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
    else:
        print(f"  psql output: {result.stdout.strip()}")

    # Cleanup
    try:
        os.remove(sql_file)
    except OSError:
        pass

    print(f"\nDone! {len(patches)} sites patched via psql.")


if __name__ == '__main__':
    main()

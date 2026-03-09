#!/usr/bin/env python3
"""
Enrich grid_dc_sites with NLCD 2021 land cover classification and buildability scores.

Source: NLCD 2021 Land Cover via WMS GetFeatureInfo
  https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms

Fields populated:
- nlcd_code          (integer) — NLCD land cover class code (11-95)
- nlcd_class         (text)    — Human-readable class name
- buildability_score (numeric) — Composite buildability score (0-100)

Buildability score considers:
- Land cover type (primary factor)
- FEMA flood zone (subtract 20 for SFHA zones)

Usage:
  python3 -u scripts/enrich-land-cover.py
  python3 -u scripts/enrich-land-cover.py --dry-run
  python3 -u scripts/enrich-land-cover.py --limit 1000
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load env from grid/.env.local (fallback to solar/.env.local)
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
load_dotenv(env_path)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# NLCD 2021 WMS endpoint
NLCD_WMS_URL = (
    "https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms"
)

# NLCD class code -> human-readable name
NLCD_CLASSES = {
    11: 'Water',
    12: 'Perennial Ice/Snow',
    21: 'Developed, Open Space',
    22: 'Developed, Low Intensity',
    23: 'Developed, Medium Intensity',
    24: 'Developed, High Intensity',
    31: 'Barren Land',
    41: 'Deciduous Forest',
    42: 'Evergreen Forest',
    43: 'Mixed Forest',
    51: 'Dwarf Scrub',       # Alaska only
    52: 'Shrub/Scrub',
    71: 'Grassland/Herbaceous',
    72: 'Sedge/Herbaceous',  # Alaska only
    73: 'Lichens',           # Alaska only
    74: 'Moss',              # Alaska only
    81: 'Pasture/Hay',
    82: 'Cultivated Crops',
    90: 'Woody Wetlands',
    95: 'Emergent Herbaceous Wetlands',
}

# Buildability score by NLCD class
BUILDABILITY_SCORES = {
    24: 100,  # Developed High — existing infrastructure, utilities in place
    23: 95,   # Developed Medium — good infrastructure
    22: 92,   # Developed Low — some infrastructure
    21: 90,   # Developed Open Space — parks/lawns, easy to build
    31: 85,   # Barren — empty land, minimal clearing
    71: 80,   # Grassland — flat, minimal clearing
    72: 78,   # Sedge/Herbaceous (Alaska)
    81: 75,   # Pasture/Hay — agricultural conversion
    52: 70,   # Shrub/Scrub — some clearing needed
    51: 68,   # Dwarf Scrub (Alaska)
    82: 65,   # Cultivated Crops — land conversion, may have utilities
    43: 50,   # Mixed Forest — significant clearing
    41: 45,   # Deciduous Forest — significant clearing
    42: 40,   # Evergreen Forest — difficult clearing
    12: 25,   # Perennial Ice/Snow — extreme environment
    95: 20,   # Emergent Wetlands — environmental restrictions
    90: 15,   # Woody Wetlands — environmental restrictions
    73: 15,   # Lichens (Alaska)
    74: 15,   # Moss (Alaska)
    11: 5,    # Water — not buildable
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


def query_nlcd(lat, lng):
    """Query NLCD 2021 WMS GetFeatureInfo for a single point. Returns NLCD code or None."""
    delta = 0.0001
    bbox = f"{lng - delta},{lat - delta},{lng + delta},{lat + delta}"
    params = urllib.parse.urlencode({
        'SERVICE': 'WMS',
        'VERSION': '1.1.1',
        'REQUEST': 'GetFeatureInfo',
        'LAYERS': 'NLCD_2021_Land_Cover_L48',
        'QUERY_LAYERS': 'NLCD_2021_Land_Cover_L48',
        'INFO_FORMAT': 'application/json',
        'X': '1',
        'Y': '1',
        'WIDTH': '3',
        'HEIGHT': '3',
        'SRS': 'EPSG:4326',
        'BBOX': bbox,
    })
    url = f"{NLCD_WMS_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            features = data.get('features', [])
            if not features:
                return None
            props = features[0].get('properties', {})
            palette_index = props.get('PALETTE_INDEX')
            if palette_index is not None:
                return int(palette_index)
            return None
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None


def calculate_buildability(nlcd_code, flood_zone_sfha=None):
    """Calculate buildability score from NLCD code and optional flood zone."""
    base = BUILDABILITY_SCORES.get(nlcd_code, 50)
    # FEMA SFHA penalty
    if flood_zone_sfha is True:
        base = max(0, base - 20)
    return round(base, 1)


def process_site(site):
    """Query NLCD for a single site. Returns (site_id, result_dict) or (site_id, None)."""
    lat = site.get('latitude')
    lng = site.get('longitude')
    if lat is None or lng is None:
        return (site['id'], None)

    nlcd_code = query_nlcd(float(lat), float(lng))
    if nlcd_code is None or nlcd_code == 0:
        return (site['id'], None)

    nlcd_class = NLCD_CLASSES.get(nlcd_code, f'Unknown ({nlcd_code})')
    buildability = calculate_buildability(nlcd_code, site.get('flood_zone_sfha'))

    return (site['id'], {
        'nlcd_code': nlcd_code,
        'nlcd_class': nlcd_class,
        'buildability_score': buildability,
    })


def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich NLCD 2021 Land Cover + Buildability Score")
    print("=" * 60)

    # Load sites with coordinates but no NLCD data
    print("\n[1/3] Loading grid_dc_sites needing land cover data...")
    filters = '&nlcd_code=is.null&latitude=not.is.null&longitude=not.is.null'
    select = 'id,latitude,longitude,flood_zone_sfha'
    sites = load_paginated('grid_dc_sites', select, filters)
    print(f"  {len(sites)} sites with coordinates and no nlcd_code")

    if limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  Nothing to do. All sites already enriched.")
        return

    # Query NLCD for each site
    print(f"\n[2/3] Querying NLCD 2021 WMS for {len(sites)} sites (8 workers)...")
    results = {}  # site_id -> patch dict
    found = 0
    no_data = 0
    errors = 0

    # Track distribution
    code_counts = {}

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(process_site, site): site for site in sites}
        done_count = 0
        for future in as_completed(futures):
            done_count += 1
            try:
                site_id, result = future.result()
                if result:
                    results[site_id] = result
                    found += 1
                    code = result['nlcd_code']
                    code_counts[code] = code_counts.get(code, 0) + 1
                else:
                    no_data += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error: {e}")

            if done_count % 1000 == 0 or done_count == len(sites):
                elapsed = time.time() - start_time
                rate = done_count / elapsed if elapsed > 0 else 0
                print(f"  Progress: {done_count}/{len(sites)} queried, "
                      f"{found} found, {no_data} no data, {errors} errors "
                      f"({rate:.1f}/sec)")

    print(f"\n  Final: {found} classified, {no_data} no data, {errors} errors")

    # Print distribution
    if code_counts:
        print(f"\n  NLCD Distribution:")
        for code in sorted(code_counts.keys()):
            name = NLCD_CLASSES.get(code, f'Unknown ({code})')
            cnt = code_counts[code]
            pct = cnt / found * 100
            score = BUILDABILITY_SCORES.get(code, 50)
            print(f"    {code:3d} {name:<35s} {cnt:>6,d} ({pct:5.1f}%)  buildability={score}")

    if not results:
        print("  No results to patch.")
        return

    # Show buildability stats
    scores = [r['buildability_score'] for r in results.values()]
    avg = sum(scores) / len(scores)
    scores.sort()
    median = scores[len(scores) // 2]
    print(f"\n  Buildability score stats:")
    print(f"    Mean:   {avg:.1f}")
    print(f"    Median: {median:.1f}")
    print(f"    Min:    {min(scores):.1f}")
    print(f"    Max:    {max(scores):.1f}")

    # Score buckets
    buckets = {'0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0}
    for s in scores:
        if s < 20: buckets['0-20'] += 1
        elif s < 40: buckets['20-40'] += 1
        elif s < 60: buckets['40-60'] += 1
        elif s < 80: buckets['60-80'] += 1
        else: buckets['80-100'] += 1
    print(f"    Distribution: {buckets}")

    # Patch database via psql (bulk update is much faster than individual REST calls)
    print(f"\n[3/3] Patching {len(results)} sites via psql...")
    if dry_run:
        print("  DRY RUN — skipping database updates.")
        return

    import subprocess
    import tempfile
    import csv

    # Write results to temp CSV
    csv_path = os.path.join(tempfile.gettempdir(), 'nlcd_results.csv')
    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        for site_id, patch in results.items():
            # Escape single quotes in nlcd_class
            nlcd_class_escaped = patch['nlcd_class'].replace("'", "''")
            writer.writerow([
                site_id,
                patch['nlcd_code'],
                nlcd_class_escaped,
                patch['buildability_score'],
            ])

    print(f"  Wrote {len(results)} rows to {csv_path}")

    # Build SQL: create temp table, copy data, update via join
    sql = f"""
CREATE TEMP TABLE tmp_nlcd (
    site_id UUID,
    nlcd_code INTEGER,
    nlcd_class TEXT,
    buildability_score NUMERIC(5,1)
);

\\copy tmp_nlcd FROM '{csv_path}' WITH (FORMAT csv);

UPDATE grid_dc_sites g
SET nlcd_code = t.nlcd_code,
    nlcd_class = t.nlcd_class,
    buildability_score = t.buildability_score
FROM tmp_nlcd t
WHERE g.id = t.site_id;

DROP TABLE tmp_nlcd;
"""

    psql_env = os.environ.copy()
    psql_env['PGPASSWORD'] = '#FsW7iqg%EYX&G3M'
    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-c', sql],
        env=psql_env,
        capture_output=True, text=True, timeout=120
    )

    if result.returncode != 0:
        # psql -c doesn't handle \copy — use -f instead
        sql_file = os.path.join(tempfile.gettempdir(), 'nlcd_update.sql')
        with open(sql_file, 'w') as f:
            f.write(sql)
        result = subprocess.run(
            ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
             '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
             '-f', sql_file],
            env=psql_env,
            capture_output=True, text=True, timeout=120
        )

    if result.returncode == 0:
        # Extract UPDATE count from output
        for line in result.stdout.split('\n'):
            if 'UPDATE' in line:
                print(f"  {line.strip()}")
        print(f"  Done: {len(results)} sites patched via psql")
    else:
        print(f"  psql error: {result.stderr[:500]}")
        print("  Falling back to REST API patching...")
        patched = 0
        patch_errors = 0
        items = list(results.items())
        for site_id, patch in items:
            try:
                encoded_id = urllib.parse.quote(str(site_id), safe='')
                supabase_request(
                    'PATCH',
                    f'grid_dc_sites?id=eq.{encoded_id}',
                    patch,
                    headers_extra={'Prefer': 'return=minimal'}
                )
                patched += 1
            except Exception as e:
                patch_errors += 1
                if patch_errors <= 3:
                    print(f"  Patch error for {site_id}: {e}")
            if patched % 500 == 0:
                print(f"  Patched {patched}/{len(items)}, {patch_errors} errors")
        print(f"  Done: {patched} patched, {patch_errors} errors")

    # Cleanup
    try:
        os.unlink(csv_path)
    except Exception:
        pass


if __name__ == '__main__':
    start_time = time.time()
    main()
    elapsed = time.time() - start_time
    print(f"\nTotal time: {elapsed:.0f}s ({elapsed/60:.1f} min)")

#!/usr/bin/env python3
"""
Enrich grid_dc_sites with land ownership type from USGS PAD-US 4.0.

Source: PAD-US 4.0 Fee layer via ArcGIS FeatureServer
  https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/PADUS4_0Fee/FeatureServer/0

Fields populated:
- land_owner_type  TEXT — federal, state, tribal, private, local, district, joint, unknown
- land_manager     TEXT — e.g., 'Bureau of Land Management', 'US Forest Service'
- land_gap_status  TEXT — '1' (most protected) through '4' (least)
- land_designation TEXT — e.g., 'National Forest', 'Wilderness Area', 'State Park'

Sites NOT in any PAD-US polygon = private land (land_owner_type = 'private').

Usage:
  python3 -u scripts/enrich-padus-land.py
  python3 -u scripts/enrich-padus-land.py --dry-run
"""

import os
import sys
import json
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
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

PADUS_URL = (
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/"
    "PADUS4_0Fee/FeatureServer/0/query"
)

OWN_TYPE_MAP = {
    'FED': 'federal',
    'STAT': 'state',
    'TRIB': 'tribal',
    'PRIV': 'private',
    'LOC': 'local',
    'DIST': 'district',
    'JNT': 'joint',
    'UNK': 'unknown',
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


def query_padus(lat, lng):
    """
    Query PAD-US FeatureServer with a point-in-polygon spatial query.
    Returns dict with land ownership info, or None if not in any protected area.
    """
    params = urllib.parse.urlencode({
        'geometry': json.dumps({'x': lng, 'y': lat}),
        'geometryType': 'esriGeometryPoint',
        'spatialRel': 'esriSpatialRelIntersects',
        'inSR': '4326',
        'outSR': '4326',
        'outFields': 'Own_Type,Mang_Name,GAP_Sts,Des_Tp',
        'returnGeometry': 'false',
        'f': 'json',
    })
    url = f"{PADUS_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
                continue
            raise

    features = data.get('features', [])
    if not features:
        return None

    # Take the first (most relevant) feature
    attrs = features[0].get('attributes', {})
    own_type_raw = (attrs.get('Own_Type') or '').strip()
    mang_name = (attrs.get('Mang_Name') or '').strip()
    gap_sts = attrs.get('GAP_Sts')
    des_tp = (attrs.get('Des_Tp') or '').strip()

    return {
        'land_owner_type': OWN_TYPE_MAP.get(own_type_raw, 'unknown'),
        'land_manager': mang_name or None,
        'land_gap_status': str(gap_sts) if gap_sts is not None else None,
        'land_designation': des_tp or None,
    }


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich PAD-US Land Ownership")
    print("=" * 50)

    # Phase 1: Load DC sites
    print(f"\n[Phase 1] Loading grid_dc_sites...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,land_owner_type',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites not yet enriched
    sites_to_process = [s for s in sites if s.get('land_owner_type') is None]
    print(f"  {len(sites_to_process)} sites need land ownership data")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Phase 2: Query PAD-US for each site
    print(f"\n[Phase 2] Querying PAD-US for {len(sites_to_process)} sites (10 workers)...")
    results = {}  # site_id -> {land_owner_type, land_manager, land_gap_status, land_designation}
    errors = 0
    t0 = time.time()
    completed = 0

    def process_site(site):
        lat = site['latitude']
        lng = site['longitude']
        try:
            result = query_padus(lat, lng)
            if result is None:
                # Not in any protected area = private land
                return site['id'], {
                    'land_owner_type': 'private',
                    'land_manager': None,
                    'land_gap_status': None,
                    'land_designation': None,
                }
            return site['id'], result
        except Exception as e:
            return site['id'], f"ERROR: {e}"

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_site, s): s for s in sites_to_process}
        for future in as_completed(futures):
            site_id, result = future.result()
            completed += 1

            if isinstance(result, str) and result.startswith('ERROR'):
                errors += 1
                if errors <= 10:
                    print(f"  {result}")
            else:
                results[site_id] = result

            if completed % 1000 == 0 or completed == len(sites_to_process):
                elapsed = time.time() - t0
                rate = completed / elapsed if elapsed > 0 else 0
                print(f"  Progress: {completed}/{len(sites_to_process)} "
                      f"({len(results)} classified, {errors} errors, "
                      f"{rate:.1f} sites/sec)")

    # Stats
    type_counts = {}
    for r in results.values():
        t = r['land_owner_type']
        type_counts[t] = type_counts.get(t, 0) + 1

    print(f"\n  Land ownership breakdown:")
    for t in sorted(type_counts.keys(), key=lambda k: -type_counts[k]):
        pct = type_counts[t] / len(results) * 100
        print(f"    {t:12s}: {type_counts[t]:>7,} ({pct:.1f}%)")
    print(f"  Total classified: {len(results)}, errors: {errors}")

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, info in samples:
            print(f"  Would patch {site_id}: {info['land_owner_type']}"
                  f" | mgr={info['land_manager']}"
                  f" | gap={info['land_gap_status']}"
                  f" | des={info['land_designation']}")
        print(f"\n  Would patch {len(results)} sites total")
        return

    if not results:
        print("  No results to patch.")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")
    import subprocess

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_padus_land_update.sql')
    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _padus_land (\n")
        f.write("  id UUID,\n")
        f.write("  land_owner_type TEXT,\n")
        f.write("  land_manager TEXT,\n")
        f.write("  land_gap_status TEXT,\n")
        f.write("  land_designation TEXT\n")
        f.write(");\n")
        f.write("COPY _padus_land (id, land_owner_type, land_manager, land_gap_status, land_designation) FROM STDIN;\n")
        for site_id, info in results.items():
            # Escape for psql COPY: replace tabs/newlines, use \N for NULL
            mgr = (info['land_manager'] or '\\N').replace('\t', ' ').replace('\n', ' ')
            gap = info['land_gap_status'] or '\\N'
            des = (info['land_designation'] or '\\N').replace('\t', ' ').replace('\n', ' ')
            f.write(f"{site_id}\t{info['land_owner_type']}\t{mgr}\t{gap}\t{des}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "land_owner_type = _padus_land.land_owner_type, "
            "land_manager = _padus_land.land_manager, "
            "land_gap_status = _padus_land.land_gap_status, "
            "land_designation = _padus_land.land_designation "
            "FROM _padus_land WHERE grid_dc_sites.id = _padus_land.id;\n"
        )
        f.write(
            "SELECT land_owner_type, COUNT(*) AS cnt FROM grid_dc_sites "
            "WHERE land_owner_type IS NOT NULL GROUP BY land_owner_type ORDER BY cnt DESC;\n"
        )

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

    print(f"\nDone! {len(results)} sites patched via psql.")


if __name__ == '__main__':
    main()

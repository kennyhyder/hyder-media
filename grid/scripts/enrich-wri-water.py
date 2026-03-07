#!/usr/bin/env python3
"""
Enrich grid_dc_sites with WRI Aqueduct 4.0 water stress data at sub-basin granularity.

Source: WRI Aqueduct 4.0 ArcGIS REST API
  https://services.arcgis.com/PlLtMfJYmpDBZP0o/ArcGIS/rest/services/Aqueduct40_waterrisk_annual_global_v01/FeatureServer/0

Fields populated:
- wri_water_stress   (numeric 0-5) — baseline water stress (bws_raw)
- wri_water_depletion (numeric 0-5) — baseline water depletion (bwd_raw)
- wri_basin_name     (text) — sub-basin name (name_1)

Usage:
  python3 -u scripts/enrich-wri-water.py
  python3 -u scripts/enrich-wri-water.py --dry-run
  python3 -u scripts/enrich-wri-water.py --limit 100
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

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

WRI_BASE_URL = (
    "https://services.arcgis.com/PlLtMfJYmpDBZP0o/ArcGIS/rest/services/"
    "Aqueduct40_waterrisk_annual_global_v01/FeatureServer/0/query"
)


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


def query_wri(lat, lng):
    """Query WRI Aqueduct 4.0 for a single point. Returns dict or None."""
    params = urllib.parse.urlencode({
        'geometry': f'{lng},{lat}',
        'geometryType': 'esriGeometryPoint',
        'inSR': '4326',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': 'name_0,name_1,bws_raw,bwd_raw,bws_label,bwd_label',
        'returnGeometry': 'false',
        'f': 'json',
    })
    url = f"{WRI_BASE_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            features = data.get('features', [])
            if not features:
                return None
            attrs = features[0].get('attributes', {})
            bws = attrs.get('bws_raw')
            bwd = attrs.get('bwd_raw')
            basin = attrs.get('name_1')
            # bws_raw/bwd_raw can be -1 (no data) or None
            if bws is not None and bws < 0:
                bws = None
            if bwd is not None and bwd < 0:
                bwd = None
            return {
                'wri_water_stress': round(bws, 4) if bws is not None else None,
                'wri_water_depletion': round(bwd, 4) if bwd is not None else None,
                'wri_basin_name': basin,
            }
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


def process_site(site):
    """Query WRI for a single site. Returns (site_id, result_dict) or (site_id, None)."""
    lat = site.get('latitude')
    lng = site.get('longitude')
    if lat is None or lng is None:
        return (site['id'], None)
    result = query_wri(lat, lng)
    time.sleep(0.2)  # Rate limit
    return (site['id'], result)


def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich WRI Aqueduct 4.0 Water Stress")
    print("=" * 50)

    # Load sites with coordinates but no water stress data
    print("\n[1/3] Loading grid_dc_sites needing water stress data...")
    filters = '&wri_water_stress=is.null&latitude=not.is.null&longitude=not.is.null'
    sites = load_paginated('grid_dc_sites', 'id,latitude,longitude', filters)
    print(f"  {len(sites)} sites with coordinates and no wri_water_stress")

    if limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  Nothing to do. All sites already enriched.")
        return

    # Query WRI for each site
    print(f"\n[2/3] Querying WRI Aqueduct 4.0 for {len(sites)} sites...")
    results = {}  # site_id -> patch dict
    found = 0
    no_data = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_site, site): site for site in sites}
        done_count = 0
        for future in as_completed(futures):
            done_count += 1
            try:
                site_id, result = future.result()
                if result and (result['wri_water_stress'] is not None or result['wri_water_depletion'] is not None):
                    results[site_id] = result
                    found += 1
                else:
                    no_data += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error: {e}")

            if done_count % 200 == 0 or done_count == len(sites):
                print(f"  Progress: {done_count}/{len(sites)} queried, "
                      f"{found} found, {no_data} no data, {errors} errors")

    print(f"\n  Final: {found} found, {no_data} no data, {errors} errors")

    if not results:
        print("  No results to patch.")
        return

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, data in samples:
            print(f"  Would patch {site_id}: stress={data['wri_water_stress']}, "
                  f"depletion={data['wri_water_depletion']}, basin={data['wri_basin_name']}")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Batch PATCH to Supabase
    print(f"\n[3/3] Patching {len(results)} sites to Supabase...")
    patched = 0
    patch_errors = 0
    items = list(results.items())

    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        for site_id, data in batch:
            try:
                eid = urllib.parse.quote(site_id, safe='')
                supabase_request('PATCH',
                    f"grid_dc_sites?id=eq.{eid}",
                    data,
                    headers_extra={'Prefer': 'return=minimal'})
                patched += 1
            except Exception as e:
                patch_errors += 1
                if patch_errors <= 5:
                    print(f"  Patch error for {site_id}: {e}")

        if (i + BATCH_SIZE) % 500 < BATCH_SIZE or i + BATCH_SIZE >= len(items):
            print(f"  Patched {patched}/{len(results)}, {patch_errors} errors")

    print(f"\nDone! Patched: {patched}, Errors: {patch_errors}")


if __name__ == '__main__':
    main()

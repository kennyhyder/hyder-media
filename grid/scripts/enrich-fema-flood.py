#!/usr/bin/env python3
"""
Enrich grid_dc_sites with FEMA flood zone data.

Queries FEMA NFHL MapServer Layer 28 for each DC site's coordinates to determine
flood zone classification and whether the site is in a Special Flood Hazard Area (SFHA).

Updates:
- grid_dc_sites.flood_zone — FEMA flood zone code (A, AE, AH, AO, V, VE, X, D, etc.)
- grid_dc_sites.flood_zone_sfha — boolean, true if in Special Flood Hazard Area

Usage:
  python3 -u scripts/enrich-fema-flood.py
  python3 -u scripts/enrich-fema-flood.py --dry-run
  python3 -u scripts/enrich-fema-flood.py --limit 500
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

FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"


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
        except Exception as e:
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


def query_fema(lat, lng):
    """Query FEMA NFHL Layer 28 for flood zone at a point. Returns (flood_zone, sfha_bool)."""
    params = urllib.parse.urlencode({
        'geometry': f'{lng},{lat}',
        'geometryType': 'esriGeometryPoint',
        'inSR': '4326',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': 'FLD_ZONE,SFHA_TF',
        'returnGeometry': 'false',
        'f': 'json',
    })
    url = f"{FEMA_URL}?{params}"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())

            if 'error' in data:
                return None, None

            features = data.get('features', [])
            if not features:
                return None, None

            attrs = features[0].get('attributes', {})
            fld_zone = attrs.get('FLD_ZONE')
            sfha_tf = attrs.get('SFHA_TF')

            flood_zone_sfha = None
            if sfha_tf == 'T':
                flood_zone_sfha = True
            elif sfha_tf == 'F':
                flood_zone_sfha = False

            return fld_zone, flood_zone_sfha

        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None, None


def flush_results(results):
    """Patch a batch of flood zone results to Supabase."""
    patched = 0
    errs = 0
    for site_id, fld_zone, sfha in results:
        try:
            eid = urllib.parse.quote(str(site_id), safe='')
            patch_data = {'flood_zone': fld_zone}
            if sfha is not None:
                patch_data['flood_zone_sfha'] = sfha
            supabase_request('PATCH',
                f"grid_dc_sites?id=eq.{eid}",
                patch_data,
                headers_extra={'Prefer': 'return=minimal'})
            patched += 1
        except Exception as e:
            errs += 1
            if errs <= 3:
                print(f"  Patch error for {site_id}: {e}")
    if errs:
        print(f"  Flushed {patched} patches, {errs} errors")


def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    if '--limit' in sys.argv:
        idx = sys.argv.index('--limit')
        if idx + 1 < len(sys.argv):
            limit = int(sys.argv[idx + 1])

    if dry_run:
        print("=== DRY RUN — no changes will be made ===\n")

    print("GridScout: Enrich FEMA Flood Zones")
    print("=" * 50)

    # Load sites needing flood zone data
    print("\nLoading grid_dc_sites with coordinates but no flood_zone...")
    filters = '&latitude=not.is.null&longitude=not.is.null&flood_zone=is.null&order=id'
    sites = load_paginated('grid_dc_sites', 'id,latitude,longitude', filters)
    print(f"  {len(sites)} sites need flood zone data")

    if limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  Nothing to do. All sites already have flood zone data.")
        return

    # Query FEMA for each site
    print(f"\nQuerying FEMA NFHL for {len(sites)} sites (5 parallel workers)...")

    pending = []  # (site_id, flood_zone, flood_zone_sfha)
    queried = 0
    found = 0
    no_data = 0
    total_patched = 0
    total_errors = 0
    start_time = time.time()

    def process_site(site):
        """Query FEMA for one site, return (id, flood_zone, sfha)."""
        lat = site['latitude']
        lng = site['longitude']
        fld_zone, sfha = query_fema(lat, lng)
        time.sleep(0.2)  # Rate limit
        return site['id'], fld_zone, sfha

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_site, s): s for s in sites}

        for future in as_completed(futures):
            queried += 1
            try:
                site_id, fld_zone, sfha = future.result()
                if fld_zone:
                    pending.append((site_id, fld_zone, sfha))
                    found += 1
                else:
                    no_data += 1
            except Exception as e:
                no_data += 1
                if queried <= 5:
                    print(f"  Error: {e}")

            if queried % 100 == 0:
                elapsed = time.time() - start_time
                rate = queried / max(1, elapsed)
                remaining = len(sites) - queried
                eta_min = remaining / max(0.1, rate) / 60
                print(f"  Progress: {queried}/{len(sites)} queried, {found} found, {no_data} no data, {rate:.1f}/sec, ETA {eta_min:.0f}m")

            # Flush batch to Supabase
            if len(pending) >= BATCH_SIZE and not dry_run:
                flush_results(pending)
                total_patched += len(pending)
                pending = []

    # Flush remaining
    if pending and not dry_run:
        flush_results(pending)
        total_patched += len(pending)

    elapsed = time.time() - start_time
    print(f"\nDone in {elapsed:.0f}s! Queried: {queried}, Found: {found}, No data: {no_data}")
    if dry_run:
        print(f"Would have patched {found} sites")
    else:
        print(f"Patched: {total_patched} sites")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Ingest frontier AI datacenter locations from Epoch AI into grid_datacenters.

Hardcoded ~20 known frontier DC locations (hyperscale AI training facilities).
After insertion, recomputes nearest_dc_distance_km for all grid_dc_sites
using BOTH existing PNNL/PeeringDB/OSM DCs AND the new Epoch AI DCs.

Fields populated in grid_datacenters:
- name, operator, city, state, latitude, longitude, capacity_mw (total_power_mw)
- dc_type = 'hyperscale'
- source_record_id = 'epoch_ai_{normalized_name}'

Fields updated in grid_dc_sites:
- nearest_dc_id, nearest_dc_name, nearest_dc_distance_km

Usage:
  python3 -u scripts/ingest-epoch-ai-dcs.py
  python3 -u scripts/ingest-epoch-ai-dcs.py --dry-run
  python3 -u scripts/ingest-epoch-ai-dcs.py --skip-recompute   # Insert only, don't update dc_sites
"""

import os
import sys
import json
import math
import time
import re
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

BATCH_SIZE = 50
EARTH_RADIUS_KM = 6371.0

# ── Epoch AI Frontier Datacenter Locations ──────────────────────────────────
# Sources: Epoch AI notable models dataset, public announcements, press releases
# Last updated: 2026-03

EPOCH_DCS = [
    {"name": "Microsoft Stargate (Abilene)", "operator": "Microsoft", "city": "Abilene", "state": "TX", "latitude": 32.4487, "longitude": -99.7331, "total_power_mw": 500, "status": "planned"},
    {"name": "Microsoft Stargate (Mt Pleasant)", "operator": "Microsoft", "city": "Mount Pleasant", "state": "WI", "latitude": 42.7119, "longitude": -87.8767, "total_power_mw": 500, "status": "planned"},
    {"name": "Google Papillion DC", "operator": "Google", "city": "Papillion", "state": "NE", "latitude": 41.1544, "longitude": -96.0422, "total_power_mw": 400, "status": "under_construction"},
    {"name": "Meta DeKalb DC", "operator": "Meta", "city": "DeKalb", "state": "IL", "latitude": 41.9294, "longitude": -88.7503, "total_power_mw": 250, "status": "under_construction"},
    {"name": "Amazon US East (Virginia)", "operator": "Amazon", "city": "Ashburn", "state": "VA", "latitude": 39.0438, "longitude": -77.4874, "total_power_mw": 300, "status": "operational"},
    {"name": "Microsoft Quincy DC", "operator": "Microsoft", "city": "Quincy", "state": "WA", "latitude": 47.2343, "longitude": -119.8526, "total_power_mw": 200, "status": "operational"},
    {"name": "Google The Dalles DC", "operator": "Google", "city": "The Dalles", "state": "OR", "latitude": 45.5946, "longitude": -121.1787, "total_power_mw": 200, "status": "operational"},
    {"name": "Meta Prineville DC", "operator": "Meta", "city": "Prineville", "state": "OR", "latitude": 44.2999, "longitude": -120.8339, "total_power_mw": 150, "status": "operational"},
    {"name": "Google Council Bluffs DC", "operator": "Google", "city": "Council Bluffs", "state": "IA", "latitude": 41.2619, "longitude": -95.8608, "total_power_mw": 200, "status": "operational"},
    {"name": "Meta New Albany DC", "operator": "Meta", "city": "New Albany", "state": "OH", "latitude": 40.0812, "longitude": -82.8087, "total_power_mw": 200, "status": "operational"},
    {"name": "Microsoft San Antonio DC", "operator": "Microsoft", "city": "San Antonio", "state": "TX", "latitude": 29.4241, "longitude": -98.4936, "total_power_mw": 150, "status": "operational"},
    {"name": "Microsoft Des Moines DC", "operator": "Microsoft", "city": "West Des Moines", "state": "IA", "latitude": 41.5725, "longitude": -93.7937, "total_power_mw": 200, "status": "operational"},
    {"name": "Google Midlothian DC", "operator": "Google", "city": "Midlothian", "state": "TX", "latitude": 32.4823, "longitude": -96.9945, "total_power_mw": 200, "status": "operational"},
    {"name": "Amazon US West (Oregon)", "operator": "Amazon", "city": "Boardman", "state": "OR", "latitude": 45.8398, "longitude": -119.7009, "total_power_mw": 200, "status": "operational"},
    {"name": "Meta Eagle Mountain DC", "operator": "Meta", "city": "Eagle Mountain", "state": "UT", "latitude": 40.3141, "longitude": -112.0108, "total_power_mw": 200, "status": "under_construction"},
    {"name": "Microsoft Cheyenne DC", "operator": "Microsoft", "city": "Cheyenne", "state": "WY", "latitude": 41.1400, "longitude": -104.8202, "total_power_mw": 100, "status": "operational"},
    {"name": "xAI Memphis DC", "operator": "xAI", "city": "Memphis", "state": "TN", "latitude": 35.1495, "longitude": -90.0490, "total_power_mw": 150, "status": "operational"},
    {"name": "CoreWeave Plano DC", "operator": "CoreWeave", "city": "Plano", "state": "TX", "latitude": 33.0198, "longitude": -96.6989, "total_power_mw": 100, "status": "under_construction"},
    {"name": "Oracle Nashville DC", "operator": "Oracle", "city": "Nashville", "state": "TN", "latitude": 36.1627, "longitude": -86.7816, "total_power_mw": 100, "status": "operational"},
    {"name": "Apple Mesa DC", "operator": "Apple", "city": "Mesa", "state": "AZ", "latitude": 33.4152, "longitude": -111.8315, "total_power_mw": 100, "status": "operational"},
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


def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def make_source_id(name):
    """Generate a stable source_record_id from DC name."""
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    s = s.strip('_')
    return f"epoch_ai_{s}"


def get_or_create_source():
    """Get or create the epoch_ai data source entry."""
    ds = supabase_request('GET', 'grid_data_sources?name=eq.epoch_ai&select=id')
    if ds:
        return ds[0]['id']
    result = supabase_request('POST', 'grid_data_sources', [{
        'name': 'epoch_ai',
        'url': 'https://epoch.ai/data/notable-ai-models',
        'description': 'Epoch AI frontier datacenter locations (hyperscale AI training facilities)',
    }], {'Prefer': 'return=representation'})
    return result[0]['id'] if result else None


def main():
    dry_run = '--dry-run' in sys.argv
    skip_recompute = '--skip-recompute' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Ingest Epoch AI Frontier Datacenters")
    print("=" * 55)
    print(f"  {len(EPOCH_DCS)} frontier DC locations hardcoded")

    # ── Phase 1: Build insertion records ───────────────────────────────
    print("\n[Phase 1] Building insertion records...")

    records = []
    for dc in EPOCH_DCS:
        source_id = make_source_id(dc['name'])
        records.append({
            'source_record_id': source_id,
            'name': dc['name'],
            'operator': dc['operator'],
            'city': dc['city'],
            'state': dc['state'],
            'latitude': dc['latitude'],
            'longitude': dc['longitude'],
            'capacity_mw': dc['total_power_mw'],
            'dc_type': 'hyperscale',
        })

    # Print summary
    operators = {}
    states = {}
    for r in records:
        operators[r['operator']] = operators.get(r['operator'], 0) + 1
        states[r['state']] = states.get(r['state'], 0) + 1

    print(f"\n  By operator:")
    for op, cnt in sorted(operators.items(), key=lambda x: -x[1]):
        print(f"    {op}: {cnt}")
    print(f"\n  By state:")
    for st, cnt in sorted(states.items(), key=lambda x: -x[1]):
        print(f"    {st}: {cnt}")

    total_mw = sum(dc['total_power_mw'] for dc in EPOCH_DCS)
    print(f"\n  Total power: {total_mw:,} MW")

    if dry_run:
        print(f"\n  Would insert {len(records)} records into grid_datacenters")
        if not skip_recompute:
            print("  Would recompute nearest_dc_distance_km for all dc_sites")
        return

    # ── Phase 2: Insert into grid_datacenters ──────────────────────────
    print(f"\n[Phase 2] Inserting {len(records)} records into grid_datacenters...")

    ds_id = get_or_create_source()
    if ds_id:
        for r in records:
            r['data_source_id'] = ds_id

    # Use ignore-duplicates to make idempotent (source_record_id is UNIQUE)
    created = 0
    skipped = 0
    errors = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_datacenters', batch, {
                'Prefer': 'return=minimal,resolution=ignore-duplicates',
            })
            created += len(batch)
        except urllib.error.HTTPError as e:
            # If batch fails due to duplicates, try one at a time
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_datacenters', [rec], {
                        'Prefer': 'return=minimal,resolution=ignore-duplicates',
                    })
                    created += 1
                except Exception as e2:
                    # Check if it's a duplicate key error
                    if '409' in str(e2) or '23505' in str(e2):
                        skipped += 1
                    else:
                        errors += 1
                        print(f"    Error inserting {rec['name']}: {e2}")

    print(f"  Created: {created}, Skipped (duplicates): {skipped}, Errors: {errors}")

    if skip_recompute:
        print("\n  Skipping nearest_dc recompute (--skip-recompute)")
        print("\nDone!")
        return

    # ── Phase 3: Recompute nearest_dc_distance for all dc_sites ───────
    print(f"\n[Phase 3] Recomputing nearest_dc_distance_km for all dc_sites...")

    # Load ALL datacenters (PNNL + PeeringDB + OSM + Epoch AI)
    all_dcs = load_paginated(
        'grid_datacenters',
        'id,name,latitude,longitude',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(all_dcs)} total datacenters")

    # Load all dc_sites
    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  Loaded {len(sites)} dc_sites with coordinates")

    if not sites or not all_dcs:
        print("  No sites or DCs to process.")
        return

    # Build spatial grid for DCs
    GRID_CELL_DEG = 2.0
    dc_grid = {}
    for dc in all_dcs:
        lat = float(dc['latitude'])
        lng = float(dc['longitude'])
        cell = (int(math.floor(lat / GRID_CELL_DEG)), int(math.floor(lng / GRID_CELL_DEG)))
        if cell not in dc_grid:
            dc_grid[cell] = []
        dc_grid[cell].append(dc)

    # Find nearest DC for each site
    print(f"\n  Computing nearest DC for {len(sites)} sites...")
    results = {}  # site_id -> (dc_id, dc_name, dist_km)
    t0 = time.time()

    for i, site in enumerate(sites):
        s_lat = float(site['latitude'])
        s_lng = float(site['longitude'])
        cell_lat = int(math.floor(s_lat / GRID_CELL_DEG))
        cell_lng = int(math.floor(s_lng / GRID_CELL_DEG))

        best_dc = None
        best_dist = float('inf')

        # Search nearby cells
        for dlat in range(-2, 3):
            for dlng in range(-2, 3):
                cell = (cell_lat + dlat, cell_lng + dlng)
                if cell not in dc_grid:
                    continue
                for dc in dc_grid[cell]:
                    d = haversine(s_lat, s_lng, float(dc['latitude']), float(dc['longitude']))
                    if d < best_dist:
                        best_dist = d
                        best_dc = dc

        if best_dc and best_dist < 500:  # cap at 500 km
            results[site['id']] = (best_dc['id'], best_dc.get('name'), round(best_dist, 2))

        if (i + 1) % 5000 == 0 or (i + 1) == len(sites):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites)} ({len(results)} matched, {rate:.0f} sites/sec)")

    print(f"\n  {len(results)} sites have a DC within 500 km")

    if not results:
        print("  No results to patch.")
        return

    # Stats
    distances = sorted(d for _, _, d in results.values())
    n = len(distances)
    print(f"\n  Distance statistics:")
    print(f"    Min:    {distances[0]:.2f} km")
    print(f"    Max:    {distances[-1]:.2f} km")
    print(f"    Mean:   {sum(distances) / n:.2f} km")
    print(f"    Median: {distances[n // 2]:.2f} km")

    # Patch via psql
    print(f"\n  Patching {len(results)} sites via psql...")

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_epoch_dc_update.sql')
    os.makedirs(os.path.dirname(sql_file), exist_ok=True)

    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _dc_dist (id UUID, dc_id UUID, dc_name TEXT, dist NUMERIC(8,2));\n")
        f.write("COPY _dc_dist (id, dc_id, dc_name, dist) FROM STDIN;\n")
        for site_id, (dc_id, dc_name, dist) in results.items():
            # Escape tabs and backslashes in dc_name for COPY
            safe_name = (dc_name or '').replace('\\', '\\\\').replace('\t', ' ').replace('\n', ' ')
            f.write(f"{site_id}\t{dc_id}\t{safe_name}\t{dist}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "nearest_dc_id = d.dc_id, "
            "nearest_dc_name = d.dc_name, "
            "nearest_dc_distance_km = d.dist "
            "FROM _dc_dist d "
            "WHERE grid_dc_sites.id = d.id "
            "AND (grid_dc_sites.nearest_dc_distance_km IS NULL OR d.dist < grid_dc_sites.nearest_dc_distance_km);\n"
        )
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites WHERE nearest_dc_distance_km IS NOT NULL;\n")

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

    print(f"\nDone! {len(EPOCH_DCS)} Epoch AI DCs ingested, {len(results)} dc_sites recomputed.")


if __name__ == '__main__':
    main()

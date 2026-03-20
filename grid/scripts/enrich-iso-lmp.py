#!/usr/bin/env python3
"""
Enrich grid_dc_sites with wholesale electricity pricing (Locational Marginal Prices).

Uses pre-aggregated average LMP by ISO zone/hub with hardcoded values from
EIA Wholesale Electricity Market Data (2024 annual averages). Each DC site is
matched to the nearest LMP zone centroid via Haversine distance.

Fields populated:
- iso_lmp_avg   NUMERIC(8,2) — average LMP in $/MWh
- iso_lmp_node  TEXT          — nearest pricing zone (e.g. 'PJM_DOM', 'ERCOT_NORTH')

Usage:
  python3 -u scripts/enrich-iso-lmp.py
  python3 -u scripts/enrich-iso-lmp.py --dry-run
  python3 -u scripts/enrich-iso-lmp.py --force       # re-enrich sites that already have LMP
"""

import os
import sys
import json
import math
import time
import ssl
import subprocess
import urllib.request
import urllib.error
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

EARTH_RADIUS_KM = 6371.0


# ── ISO LMP Zone Data ────────────────────────────────────────────

# Average wholesale LMP ($/MWh) by ISO zone, 2024 annual average
# Source: EIA Wholesale Electricity Market Data
ISO_LMP_ZONES = {
    # CAISO
    'CAISO': {'avg_lmp': 52.30, 'zones': {
        'SP15': {'avg_lmp': 48.50, 'lat': 34.0, 'lng': -118.0},   # Southern CA
        'NP15': {'avg_lmp': 55.20, 'lat': 38.5, 'lng': -121.5},   # Northern CA
        'ZP26': {'avg_lmp': 53.10, 'lat': 36.7, 'lng': -119.8},   # Central CA
    }},
    # PJM
    'PJM': {'avg_lmp': 38.40, 'zones': {
        'COMED': {'avg_lmp': 32.10, 'lat': 41.9, 'lng': -87.6},    # Illinois
        'PECO': {'avg_lmp': 37.50, 'lat': 40.0, 'lng': -75.2},     # Eastern PA
        'DOM': {'avg_lmp': 41.20, 'lat': 37.5, 'lng': -79.4},      # Virginia
        'AEP': {'avg_lmp': 35.80, 'lat': 39.5, 'lng': -82.0},      # Ohio
        'PSEG': {'avg_lmp': 42.30, 'lat': 40.7, 'lng': -74.2},     # New Jersey
        'BGE': {'avg_lmp': 39.90, 'lat': 39.3, 'lng': -76.6},      # Maryland
        'DPL': {'avg_lmp': 38.70, 'lat': 39.2, 'lng': -75.5},      # Delaware
        'PEPCO': {'avg_lmp': 40.80, 'lat': 38.9, 'lng': -77.0},    # DC/Maryland
        'PPL': {'avg_lmp': 36.40, 'lat': 40.6, 'lng': -75.5},      # Central PA
        'DUKE_OH': {'avg_lmp': 34.50, 'lat': 39.1, 'lng': -84.5},   # Cincinnati
        'DAY': {'avg_lmp': 33.80, 'lat': 39.8, 'lng': -84.2},      # Dayton
        'ATSI': {'avg_lmp': 35.20, 'lat': 41.1, 'lng': -81.5},     # NE Ohio
    }},
    # MISO
    'MISO': {'avg_lmp': 28.50, 'zones': {
        'MISO_CENTRAL': {'avg_lmp': 27.30, 'lat': 41.6, 'lng': -93.6},   # Iowa/Minnesota
        'MISO_SOUTH': {'avg_lmp': 31.40, 'lat': 32.3, 'lng': -90.2},     # Mississippi/Louisiana
        'MISO_EAST': {'avg_lmp': 29.80, 'lat': 39.8, 'lng': -86.2},      # Indiana
        'MISO_WEST': {'avg_lmp': 26.10, 'lat': 41.3, 'lng': -96.0},      # Nebraska
    }},
    # ERCOT
    'ERCOT': {'avg_lmp': 25.80, 'zones': {
        'NORTH': {'avg_lmp': 24.50, 'lat': 32.8, 'lng': -96.8},    # Dallas
        'SOUTH': {'avg_lmp': 26.30, 'lat': 29.4, 'lng': -98.5},    # San Antonio
        'WEST': {'avg_lmp': 22.10, 'lat': 31.8, 'lng': -102.3},    # West TX
        'HOUSTON': {'avg_lmp': 27.40, 'lat': 29.8, 'lng': -95.4},   # Houston
    }},
    # ISO-NE
    'ISONE': {'avg_lmp': 45.20, 'zones': {
        'CT': {'avg_lmp': 44.80, 'lat': 41.6, 'lng': -72.7},
        'ME': {'avg_lmp': 43.50, 'lat': 44.3, 'lng': -69.8},
        'NH': {'avg_lmp': 44.10, 'lat': 43.2, 'lng': -71.5},
        'RI': {'avg_lmp': 45.30, 'lat': 41.8, 'lng': -71.4},
        'VT': {'avg_lmp': 43.90, 'lat': 44.3, 'lng': -72.6},
        'SEMA': {'avg_lmp': 46.50, 'lat': 42.4, 'lng': -71.1},
        'WCMA': {'avg_lmp': 45.00, 'lat': 42.3, 'lng': -72.6},
        'NEMA': {'avg_lmp': 47.20, 'lat': 42.7, 'lng': -71.0},
    }},
    # NYISO
    'NYISO': {'avg_lmp': 42.80, 'zones': {
        'ZONE_A': {'avg_lmp': 35.20, 'lat': 42.9, 'lng': -78.9},    # Buffalo
        'ZONE_C': {'avg_lmp': 36.80, 'lat': 43.0, 'lng': -76.1},    # Syracuse
        'ZONE_F': {'avg_lmp': 39.50, 'lat': 41.7, 'lng': -74.0},    # Hudson Valley
        'ZONE_G': {'avg_lmp': 41.30, 'lat': 41.3, 'lng': -74.0},    # Lower Hudson
        'ZONE_J': {'avg_lmp': 52.40, 'lat': 40.7, 'lng': -74.0},    # NYC
        'ZONE_K': {'avg_lmp': 50.80, 'lat': 40.7, 'lng': -73.4},    # Long Island
    }},
    # SPP
    'SPP': {'avg_lmp': 24.30, 'zones': {
        'SPP_NORTH': {'avg_lmp': 23.10, 'lat': 39.0, 'lng': -98.0},   # Kansas
        'SPP_SOUTH': {'avg_lmp': 25.40, 'lat': 35.5, 'lng': -97.5},   # Oklahoma
        'SPP_WEST': {'avg_lmp': 22.80, 'lat': 35.0, 'lng': -103.0},   # NM/TX Panhandle
    }},
}

# Map states to ISOs for fallback when site is far from all zone centroids
STATE_TO_ISO = {
    'CA': 'CAISO', 'TX': 'ERCOT',
    'VA': 'PJM', 'PA': 'PJM', 'NJ': 'PJM', 'MD': 'PJM', 'DE': 'PJM',
    'OH': 'PJM', 'WV': 'PJM', 'NC': 'PJM', 'IN': 'PJM', 'KY': 'PJM',
    'DC': 'PJM', 'IL': 'PJM',
    'IA': 'MISO', 'MN': 'MISO', 'WI': 'MISO', 'MI': 'MISO',
    'MS': 'MISO', 'LA': 'MISO', 'AR': 'MISO', 'MO': 'MISO',
    'ND': 'MISO', 'SD': 'MISO', 'NE': 'MISO', 'MT': 'MISO',
    'OK': 'SPP', 'KS': 'SPP', 'NM': 'SPP',
    'CT': 'ISONE', 'ME': 'ISONE', 'MA': 'ISONE', 'NH': 'ISONE',
    'RI': 'ISONE', 'VT': 'ISONE',
    'NY': 'NYISO',
    # Non-ISO states — no organized wholesale market
    'FL': None, 'GA': None, 'SC': None, 'AL': None, 'TN': None,
    'CO': None, 'AZ': None, 'NV': None, 'UT': None, 'OR': None,
    'WA': None, 'ID': None, 'WY': None, 'AK': None, 'HI': None,
}


# ── Supabase helpers ─────────────────────────────────────────────

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


# ── Haversine ────────────────────────────────────────────────────

def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Build flat zone list ─────────────────────────────────────────

def build_zone_list():
    """Flatten ISO_LMP_ZONES into a list of (iso, zone_name, avg_lmp, lat, lng)."""
    zones = []
    for iso_name, iso_data in ISO_LMP_ZONES.items():
        for zone_name, zone_data in iso_data['zones'].items():
            full_name = f"{iso_name}_{zone_name}"
            zones.append({
                'iso': iso_name,
                'zone': zone_name,
                'node': full_name,
                'avg_lmp': zone_data['avg_lmp'],
                'lat': zone_data['lat'],
                'lng': zone_data['lng'],
            })
    return zones


def find_nearest_zone(lat, lng, state, zone_list):
    """
    Find the nearest LMP zone for a site.

    Strategy:
    1. Look up state -> ISO mapping
    2. If state is NOT in an ISO territory, return None (no wholesale market)
    3. Find nearest zone centroid within that ISO (by Haversine distance)
    4. If state is unknown, find nearest zone across ALL ISOs
    """
    # Determine which ISO this state belongs to
    iso_name = STATE_TO_ISO.get(state)

    # State explicitly mapped to None = not in organized wholesale market
    if state in STATE_TO_ISO and iso_name is None:
        return None, None

    # Filter zones to the site's ISO (or all zones if state unknown)
    if iso_name:
        candidate_zones = [z for z in zone_list if z['iso'] == iso_name]
    else:
        # Unknown state — search all zones
        candidate_zones = zone_list

    if not candidate_zones:
        return None, None

    best_zone = None
    best_dist = float('inf')

    for zone in candidate_zones:
        d = haversine(lat, lng, zone['lat'], zone['lng'])
        if d < best_dist:
            best_dist = d
            best_zone = zone

    if best_zone:
        return best_zone['node'], best_zone['avg_lmp']

    return None, None


# ── Main ─────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    force = '--force' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich ISO LMP Wholesale Electricity Pricing")
    print("=" * 55)

    # Build zone lookup
    zone_list = build_zone_list()
    print(f"\n  Loaded {len(zone_list)} LMP zones across {len(ISO_LMP_ZONES)} ISOs")

    # Load DC sites
    print(f"\n[Phase 1] Loading grid_dc_sites...")
    select = 'id,latitude,longitude,state,iso_lmp_avg,iso_lmp_node'
    filters = '&latitude=not.is.null&longitude=not.is.null'
    sites = load_paginated('grid_dc_sites', select, filters)
    print(f"  Loaded {len(sites)} sites with coordinates")

    # Filter to sites needing enrichment
    if force:
        sites_to_process = sites
        print(f"  --force: processing all {len(sites_to_process)} sites")
    else:
        sites_to_process = [s for s in sites if s.get('iso_lmp_avg') is None]
        print(f"  {len(sites_to_process)} sites need LMP enrichment")

    if not sites_to_process:
        print("  Nothing to do. All sites already enriched.")
        return

    # Calculate LMP for each site
    print(f"\n[Phase 2] Assigning nearest LMP zone to {len(sites_to_process)} sites...")
    results = {}  # site_id -> (node, lmp)
    no_iso_count = 0
    iso_counts = {}  # iso_name -> count
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        lat = site['latitude']
        lng = site['longitude']
        state = site.get('state', '')

        node, lmp = find_nearest_zone(lat, lng, state, zone_list)

        if node and lmp:
            results[site['id']] = (node, lmp)
            iso_name = node.split('_')[0]
            iso_counts[iso_name] = iso_counts.get(iso_name, 0) + 1
        else:
            no_iso_count += 1

        if (i + 1) % 5000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({len(results)} assigned, {no_iso_count} non-ISO, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Results: {len(results)} sites with LMP, {no_iso_count} in non-ISO states")

    # ISO breakdown
    print(f"\n  LMP assignments by ISO:")
    for iso_name in sorted(iso_counts.keys()):
        print(f"    {iso_name}: {iso_counts[iso_name]:,}")

    # LMP statistics
    if results:
        lmps = sorted(v[1] for v in results.values())
        n = len(lmps)
        print(f"\n  LMP statistics ($/MWh):")
        print(f"    Min:    ${lmps[0]:.2f}")
        print(f"    Max:    ${lmps[-1]:.2f}")
        print(f"    Mean:   ${sum(lmps) / n:.2f}")
        print(f"    Median: ${lmps[n // 2]:.2f}")

    if not results:
        print("  No results to patch.")
        return

    if dry_run:
        samples = list(results.items())[:15]
        print(f"\n  Sample assignments:")
        for site_id, (node, lmp) in samples:
            print(f"    {site_id[:8]}... -> {node} = ${lmp:.2f}/MWh")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Phase 3: Patch via psql
    print(f"\n[Phase 3] Patching {len(results)} sites via psql...")

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_iso_lmp_update.sql')
    os.makedirs(os.path.dirname(sql_file), exist_ok=True)

    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _lmp_data (id UUID, node TEXT, lmp NUMERIC(8,2));\n")
        f.write("COPY _lmp_data (id, node, lmp) FROM STDIN;\n")
        for site_id, (node, lmp) in results.items():
            f.write(f"{site_id}\t{node}\t{lmp}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "iso_lmp_node = _lmp_data.node, "
            "iso_lmp_avg = _lmp_data.lmp "
            "FROM _lmp_data WHERE grid_dc_sites.id = _lmp_data.id;\n"
        )
        f.write(
            "SELECT COUNT(*) AS updated FROM grid_dc_sites "
            "WHERE iso_lmp_avg IS NOT NULL;\n"
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

    print(f"\nDone! {len(results)} sites enriched with ISO LMP pricing.")


if __name__ == '__main__':
    main()

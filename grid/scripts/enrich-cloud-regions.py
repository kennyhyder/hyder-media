#!/usr/bin/env python3
"""
Enrich grid_dc_sites with nearest cloud provider region.

For each DC site with coordinates, calculates Haversine distance to all
US cloud region locations (AWS, Azure, Google Cloud, Oracle) and stores
the nearest provider, region name, and distance in km.

Columns updated:
- nearest_cloud_region (text) — e.g. "us-east-1"
- nearest_cloud_provider (text) — e.g. "AWS"
- nearest_cloud_distance_km (numeric) — e.g. 42.7

Usage:
  python3 -u scripts/enrich-cloud-regions.py
  python3 -u scripts/enrich-cloud-regions.py --dry-run
  python3 -u scripts/enrich-cloud-regions.py --force    # Re-enrich all sites (not just NULLs)
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

EARTH_RADIUS_KM = 6371.0

# ── US Cloud Region Locations ───────────────────────────────────────────────
# Source: AWS/Azure/GCP/Oracle region documentation and known datacenter locations
# Coordinates represent approximate datacenter cluster locations

CLOUD_REGIONS = [
    # AWS
    {"provider": "AWS", "region": "us-east-1", "city": "Ashburn, VA", "lat": 39.0438, "lng": -77.4874},
    {"provider": "AWS", "region": "us-east-2", "city": "Columbus, OH", "lat": 39.9612, "lng": -82.9988},
    {"provider": "AWS", "region": "us-west-1", "city": "San Francisco, CA", "lat": 37.7749, "lng": -122.4194},
    {"provider": "AWS", "region": "us-west-2", "city": "Portland, OR", "lat": 45.5155, "lng": -122.6789},
    # Azure
    {"provider": "Azure", "region": "eastus", "city": "Boydton, VA", "lat": 36.6677, "lng": -78.3875},
    {"provider": "Azure", "region": "eastus2", "city": "Boydton, VA", "lat": 36.6677, "lng": -78.3875},
    {"provider": "Azure", "region": "centralus", "city": "Des Moines, IA", "lat": 41.5868, "lng": -93.6250},
    {"provider": "Azure", "region": "westus", "city": "San Francisco, CA", "lat": 37.7749, "lng": -122.4194},
    {"provider": "Azure", "region": "westus2", "city": "Quincy, WA", "lat": 47.2343, "lng": -119.8526},
    {"provider": "Azure", "region": "westus3", "city": "Phoenix, AZ", "lat": 33.4484, "lng": -112.0740},
    {"provider": "Azure", "region": "southcentralus", "city": "San Antonio, TX", "lat": 29.4241, "lng": -98.4936},
    {"provider": "Azure", "region": "northcentralus", "city": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
    {"provider": "Azure", "region": "westcentralus", "city": "Cheyenne, WY", "lat": 41.1400, "lng": -104.8202},
    # Google Cloud
    {"provider": "Google", "region": "us-east1", "city": "Moncks Corner, SC", "lat": 33.1960, "lng": -80.0131},
    {"provider": "Google", "region": "us-east4", "city": "Ashburn, VA", "lat": 39.0438, "lng": -77.4874},
    {"provider": "Google", "region": "us-east5", "city": "Columbus, OH", "lat": 39.9612, "lng": -82.9988},
    {"provider": "Google", "region": "us-central1", "city": "Council Bluffs, IA", "lat": 41.2619, "lng": -95.8608},
    {"provider": "Google", "region": "us-west1", "city": "The Dalles, OR", "lat": 45.5946, "lng": -121.1787},
    {"provider": "Google", "region": "us-west2", "city": "Los Angeles, CA", "lat": 34.0522, "lng": -118.2437},
    {"provider": "Google", "region": "us-west3", "city": "Salt Lake City, UT", "lat": 40.7608, "lng": -111.8910},
    {"provider": "Google", "region": "us-west4", "city": "Las Vegas, NV", "lat": 36.1699, "lng": -115.1398},
    {"provider": "Google", "region": "us-south1", "city": "Dallas, TX", "lat": 32.7767, "lng": -96.7970},
    # Oracle
    {"provider": "Oracle", "region": "us-ashburn-1", "city": "Ashburn, VA", "lat": 39.0438, "lng": -77.4874},
    {"provider": "Oracle", "region": "us-phoenix-1", "city": "Phoenix, AZ", "lat": 33.4484, "lng": -112.0740},
    {"provider": "Oracle", "region": "us-chicago-1", "city": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
    {"provider": "Oracle", "region": "us-sanjose-1", "city": "San Jose, CA", "lat": 37.3382, "lng": -121.8863},
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


# ── Haversine math ──────────────────────────────────────────────

def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km between two points."""
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_cloud_region(lat, lng):
    """Return (provider, region, distance_km) for the nearest cloud region."""
    best = None
    best_dist = float('inf')
    for cr in CLOUD_REGIONS:
        dist = haversine(lat, lng, cr['lat'], cr['lng'])
        if dist < best_dist:
            best_dist = dist
            best = cr
    return best['provider'], best['region'], round(best_dist, 2)


# ── Main ────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    force = '--force' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Nearest Cloud Region")
    print("=" * 50)

    # Count cloud regions by provider
    provider_counts = {}
    for cr in CLOUD_REGIONS:
        provider_counts[cr['provider']] = provider_counts.get(cr['provider'], 0) + 1
    summary = ', '.join(f"{p}: {c}" for p, c in sorted(provider_counts.items()))
    print(f"  Cloud regions configured: {len(CLOUD_REGIONS)} ({summary})")

    # Phase 1: Load DC sites
    print(f"\n[Phase 1] Loading grid_dc_sites...")
    if force:
        filters = '&latitude=not.is.null&longitude=not.is.null'
        print("  --force: re-enriching ALL sites with coordinates")
    else:
        filters = '&latitude=not.is.null&longitude=not.is.null&nearest_cloud_region=is.null'

    sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude',
        filters
    )
    print(f"  {len(sites)} sites to process")

    if not sites:
        print("  All sites already have nearest cloud region. Done!")
        return

    # Phase 2: Calculate nearest cloud region for each site
    print(f"\n[Phase 2] Calculating nearest cloud region for {len(sites):,} sites...")

    results = {}  # site_id -> (provider, region, dist_km)
    provider_dist = {}
    region_dist = {}
    t0 = time.time()

    for i, site in enumerate(sites):
        lat = site.get('latitude')
        lng = site.get('longitude')
        if lat is None or lng is None:
            continue

        provider, region, dist_km = find_nearest_cloud_region(float(lat), float(lng))
        results[site['id']] = (provider, region, dist_km)
        provider_dist[provider] = provider_dist.get(provider, 0) + 1
        region_dist[region] = region_dist.get(region, 0) + 1

        if (i + 1) % 5000 == 0 or (i + 1) == len(sites):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites):,} ({rate:.0f} sites/sec)")

    # Print distribution
    print(f"\n  Provider distribution:")
    for provider in sorted(provider_dist.keys()):
        print(f"    {provider:8s}: {provider_dist[provider]:,}")

    print(f"\n  Top 10 nearest regions:")
    for region, count in sorted(region_dist.items(), key=lambda x: -x[1])[:10]:
        print(f"    {region:20s}: {count:,}")

    # Distance stats
    distances = sorted(d for _, _, d in results.values())
    n = len(distances)
    print(f"\n  Distance statistics:")
    print(f"    Min:    {distances[0]:.2f} km")
    print(f"    Max:    {distances[-1]:.2f} km")
    print(f"    Mean:   {sum(distances) / n:.2f} km")
    print(f"    Median: {distances[n // 2]:.2f} km")
    print(f"    p10:    {distances[int(n * 0.1)]:.2f} km")
    print(f"    p90:    {distances[int(n * 0.9)]:.2f} km")

    if dry_run:
        samples = list(results.items())[:10]
        for site_id, (provider, region, dist) in samples:
            print(f"  Would patch {site_id[:12]}...: {provider} {region} ({dist} km)")
        print(f"\n  Would patch {len(results):,} sites total")
        return

    # Phase 3: Patch via psql (bulk UPDATE is ~1000x faster than REST API)
    print(f"\n[Phase 3] Patching {len(results):,} sites via psql...")

    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_cloud_region_update.sql')
    os.makedirs(os.path.dirname(sql_file), exist_ok=True)

    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _cloud_region (id UUID, provider TEXT, region TEXT, dist NUMERIC(8,2));\n")
        f.write("COPY _cloud_region (id, provider, region, dist) FROM STDIN;\n")
        for site_id, (provider, region, dist) in results.items():
            f.write(f"{site_id}\t{provider}\t{region}\t{dist}\n")
        f.write("\\.\n")
        f.write(
            "UPDATE grid_dc_sites SET "
            "nearest_cloud_provider = c.provider, "
            "nearest_cloud_region = c.region, "
            "nearest_cloud_distance_km = c.dist "
            "FROM _cloud_region c "
            "WHERE grid_dc_sites.id = c.id;\n"
        )
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE nearest_cloud_region IS NOT NULL;\n")

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

    print(f"\nDone! {len(results):,} sites patched via psql.")


if __name__ == '__main__':
    main()

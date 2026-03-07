#!/usr/bin/env python3
"""
Enrich grid_dc_sites with nearest cloud region (AWS/Azure/GCP).

For each DC site with coordinates, calculates Haversine distance to all
US cloud region locations and stores the nearest provider, region name,
and distance in km.

Columns updated:
- nearest_cloud_region (text) — e.g. "us-east-1"
- nearest_cloud_provider (text) — e.g. "AWS"
- nearest_cloud_distance_km (numeric) — e.g. 42.7
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# --- US Cloud Region Locations (lat, lng) ---

CLOUD_REGIONS = [
    # AWS
    {"provider": "AWS", "region": "us-east-1",    "lat": 39.0438,  "lng": -77.4874},
    {"provider": "AWS", "region": "us-east-2",    "lat": 39.9612,  "lng": -82.9988},
    {"provider": "AWS", "region": "us-west-1",    "lat": 37.3382,  "lng": -121.8863},
    {"provider": "AWS", "region": "us-west-2",    "lat": 45.5945,  "lng": -122.1561},
    # Azure
    {"provider": "Azure", "region": "eastus",         "lat": 37.3719,  "lng": -79.8164},
    {"provider": "Azure", "region": "eastus2",        "lat": 36.6681,  "lng": -78.3889},
    {"provider": "Azure", "region": "westus",         "lat": 37.783,   "lng": -122.417},
    {"provider": "Azure", "region": "westus2",        "lat": 47.233,   "lng": -119.852},
    {"provider": "Azure", "region": "westus3",        "lat": 33.448,   "lng": -112.074},
    {"provider": "Azure", "region": "centralus",      "lat": 41.8781,  "lng": -93.0977},
    {"provider": "Azure", "region": "southcentralus", "lat": 29.4167,  "lng": -98.5},
    {"provider": "Azure", "region": "northcentralus", "lat": 41.8781,  "lng": -87.6298},
    # GCP
    {"provider": "GCP", "region": "us-east1",    "lat": 33.196,   "lng": -80.013},
    {"provider": "GCP", "region": "us-east4",    "lat": 39.0438,  "lng": -77.4874},
    {"provider": "GCP", "region": "us-east5",    "lat": 40.4406,  "lng": -79.9959},
    {"provider": "GCP", "region": "us-central1", "lat": 41.2619,  "lng": -95.8608},
    {"provider": "GCP", "region": "us-south1",   "lat": 32.7767,  "lng": -96.797},
    {"provider": "GCP", "region": "us-west1",    "lat": 45.5945,  "lng": -122.1561},
    {"provider": "GCP", "region": "us-west2",    "lat": 34.0522,  "lng": -118.2437},
    {"provider": "GCP", "region": "us-west3",    "lat": 40.7608,  "lng": -111.891},
    {"provider": "GCP", "region": "us-west4",    "lat": 36.1699,  "lng": -115.1398},
]


def haversine_km(lat1, lng1, lat2, lng2):
    """Calculate distance in km between two points using Haversine formula."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_cloud_region(lat, lng):
    """Return (provider, region, distance_km) for the nearest cloud region."""
    best = None
    best_dist = float('inf')
    for cr in CLOUD_REGIONS:
        dist = haversine_km(lat, lng, cr['lat'], cr['lng'])
        if dist < best_dist:
            best_dist = dist
            best = cr
    return best['provider'], best['region'], round(best_dist, 1)


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


def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    if dry_run:
        print("=== DRY RUN — no changes will be made ===\n")

    print("GridScout: Enrich Nearest Cloud Region")
    print("=" * 50)
    print(f"  Cloud regions configured: {len(CLOUD_REGIONS)} (AWS: 4, Azure: 8, GCP: 9)")

    # Load DC sites with coordinates but no cloud region yet
    print("\n[1/2] Loading grid_dc_sites needing cloud region...")
    filters = '&latitude=not.is.null&longitude=not.is.null&nearest_cloud_region=is.null'
    sites = load_paginated('grid_dc_sites', 'id,latitude,longitude', filters)
    print(f"  {len(sites)} sites with coordinates and no cloud region")

    if limit and len(sites) > limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  All sites already have nearest cloud region. Done!")
        return

    # Calculate nearest cloud region for each site
    print(f"\n[2/2] Calculating nearest cloud region for {len(sites):,} sites...")

    patches = []
    provider_counts = {}
    region_counts = {}

    for site in sites:
        lat = site.get('latitude')
        lng = site.get('longitude')
        if lat is None or lng is None:
            continue

        provider, region, dist_km = find_nearest_cloud_region(float(lat), float(lng))
        patches.append({
            'id': site['id'],
            'nearest_cloud_provider': provider,
            'nearest_cloud_region': region,
            'nearest_cloud_distance_km': dist_km,
        })
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        region_counts[region] = region_counts.get(region, 0) + 1

    # Print distribution summary
    print(f"\n  Provider distribution:")
    for provider in sorted(provider_counts.keys()):
        print(f"    {provider:6s}: {provider_counts[provider]:,}")

    print(f"\n  Top 10 nearest regions:")
    for region, count in sorted(region_counts.items(), key=lambda x: -x[1])[:10]:
        print(f"    {region:20s}: {count:,}")

    if dry_run:
        # Show a few examples
        print(f"\n  Sample assignments (first 5):")
        for p in patches[:5]:
            print(f"    {p['id'][:8]}... -> {p['nearest_cloud_provider']} {p['nearest_cloud_region']} ({p['nearest_cloud_distance_km']} km)")
        print(f"\n  Would patch: {len(patches):,} sites")
        return

    # Batch PATCH to Supabase
    total_patched = 0
    total_errors = 0

    for i in range(0, len(patches), BATCH_SIZE):
        batch = patches[i:i + BATCH_SIZE]
        for patch in batch:
            site_id = patch['id']
            patch_data = {
                'nearest_cloud_provider': patch['nearest_cloud_provider'],
                'nearest_cloud_region': patch['nearest_cloud_region'],
                'nearest_cloud_distance_km': patch['nearest_cloud_distance_km'],
            }
            try:
                eid = urllib.parse.quote(site_id, safe='')
                supabase_request('PATCH',
                    f"grid_dc_sites?id=eq.{eid}",
                    patch_data,
                    headers_extra={'Prefer': 'return=minimal'})
                total_patched += 1
            except Exception as e:
                print(f"  Error patching {site_id}: {e}")
                total_errors += 1

        pct = min(100, (i + len(batch)) / len(patches) * 100)
        print(f"  Progress: {i + len(batch):,}/{len(patches):,} ({pct:.1f}%) — {total_patched:,} patched, {total_errors} errors")

    print(f"\n  Patched: {total_patched:,}, Errors: {total_errors}")
    print("\nDone!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Cross-reference brownfield sites with nearest substations.
For each brownfield site, find the nearest substation and store distance + voltage.
Also cross-references IXP facilities with nearest substations.

Target: grid_brownfield_sites (nearest_substation_id, nearest_substation_distance_km)
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
SEARCH_RADIUS_KM = 100  # Max distance to search for nearest substation


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


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in kilometers."""
    R = 6371.0
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def load_all_substations():
    """Load all substations with coordinates."""
    print("  Loading substations...")
    substations = []
    offset = 0
    page_size = 1000
    while True:
        rows = supabase_request(
            'GET',
            f'grid_substations?select=id,name,latitude,longitude,max_voltage_kv'
            f'&latitude=not.is.null&longitude=not.is.null'
            f'&order=id&limit={page_size}&offset={offset}'
        )
        if not rows:
            break
        substations.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break
    print(f"  Loaded {len(substations)} substations")
    return substations


def build_spatial_index(substations, cell_size=0.5):
    """Build a grid-based spatial index for fast nearest-neighbor lookup."""
    index = {}
    for sub in substations:
        lat, lng = float(sub['latitude']), float(sub['longitude'])
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(sub)
    return index, cell_size


def find_nearest_substation(lat, lng, spatial_index, cell_size, max_km=100):
    """Find nearest substation using spatial index."""
    cell_lat = int(lat / cell_size)
    cell_lng = int(lng / cell_size)

    # Search radius in grid cells (~1 degree ≈ 111 km)
    search_cells = max(2, int(max_km / (111 * cell_size)) + 1)

    best = None
    best_dist = float('inf')

    for di in range(-search_cells, search_cells + 1):
        for dj in range(-search_cells, search_cells + 1):
            cell = (cell_lat + di, cell_lng + dj)
            for sub in spatial_index.get(cell, []):
                dist = haversine_km(lat, lng, float(sub['latitude']), float(sub['longitude']))
                if dist < best_dist:
                    best_dist = dist
                    best = sub

    if best and best_dist <= max_km:
        return best, round(best_dist, 2)
    return None, None


def crossref_brownfields(substations, spatial_index, cell_size, dry_run=False):
    """Link brownfield sites to nearest substations."""
    print("\n[Phase 1] Brownfield → Substation cross-reference")

    # Load brownfield sites with coordinates
    brownfields = []
    offset = 0
    page_size = 1000
    while True:
        rows = supabase_request(
            'GET',
            f'grid_brownfield_sites?select=id,name,latitude,longitude'
            f'&latitude=not.is.null&longitude=not.is.null'
            f'&order=id&limit={page_size}&offset={offset}'
        )
        if not rows:
            break
        brownfields.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break

    print(f"  {len(brownfields)} brownfield sites with coordinates")
    if not brownfields:
        print("  No brownfield sites to process")
        return

    matched = 0
    errors = 0
    patches = []

    for i, bf in enumerate(brownfields):
        lat, lng = float(bf['latitude']), float(bf['longitude'])
        sub, dist = find_nearest_substation(lat, lng, spatial_index, cell_size)

        if sub:
            patches.append({
                'id': bf['id'],
                'nearest_substation_id': sub['id'],
                'nearest_substation_distance_km': dist,
            })
            matched += 1

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i + 1}/{len(brownfields)} ({matched} matched)")

    print(f"  {matched}/{len(brownfields)} brownfields matched to substations")

    if dry_run:
        for p in patches[:5]:
            print(f"    {p['id'][:8]}... → substation {p['nearest_substation_id'][:8]}... ({p['nearest_substation_distance_km']} km)")
        return

    # Apply patches
    for i in range(0, len(patches), BATCH_SIZE):
        batch = patches[i:i + BATCH_SIZE]
        for patch in batch:
            try:
                supabase_request(
                    'PATCH',
                    f'grid_brownfield_sites?id=eq.{patch["id"]}',
                    {
                        'nearest_substation_id': patch['nearest_substation_id'],
                        'nearest_substation_distance_km': patch['nearest_substation_distance_km'],
                    }
                )
            except Exception as e:
                errors += 1
                if errors <= 10:
                    print(f"  Error: {e}")

        if (i // BATCH_SIZE) % 20 == 0 and i > 0:
            print(f"  Patched {min(i + BATCH_SIZE, len(patches))}/{len(patches)}")

    print(f"  Patched {len(patches) - errors} brownfield sites, {errors} errors")


def main():
    print("=" * 60)
    print("GridScout Brownfield-Substation Cross-Reference")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Load substations and build spatial index
    substations = load_all_substations()
    if not substations:
        print("ERROR: No substations found. Run ingest-hifld.py first.")
        sys.exit(1)

    spatial_index, cell_size = build_spatial_index(substations)

    # Cross-reference brownfield sites
    crossref_brownfields(substations, spatial_index, cell_size, dry_run)

    print(f"\n{'=' * 60}")
    print("Cross-Reference Complete")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

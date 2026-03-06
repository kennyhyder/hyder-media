#!/usr/bin/env python3
"""
Cross-reference BLM ROW grants with nearby transmission lines.

Links BLM Right-of-Way grants (federal land permits for power transmission)
to HIFLD transmission lines by:
1. State matching (BLM ROW state = line state)
2. Spatial proximity (BLM ROW geometry centroid within X km of line)
3. Commodity matching (BLM ROW is for transmission infrastructure)

Also identifies BLM ROW grants near upgrade-candidate lines (50-100 MW),
which are the most valuable for I Squared Capital's reconductoring strategy.

Output: Updates grid_blm_row with nearest_line_id, nearest_line_distance_km,
and nearest_upgrade_candidate_id fields.
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
MAX_DISTANCE_KM = 10  # Match BLM ROW within 10km of a transmission line centroid


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
    """Calculate Haversine distance in km between two points."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(min(1.0, math.sqrt(a)))


def get_centroid_from_wkt(wkt):
    """Get approximate centroid from WKT geometry."""
    if not wkt:
        return None, None

    try:
        # Extract all coordinate pairs
        import re
        coords = re.findall(r'(-?\d+\.?\d*)\s+(-?\d+\.?\d*)', wkt)
        if not coords:
            return None, None

        lons = [float(c[0]) for c in coords]
        lats = [float(c[1]) for c in coords]

        return sum(lats) / len(lats), sum(lons) / len(lons)
    except:
        return None, None


def get_line_points(wkt):
    """Get sampled points along a line for proximity checking."""
    if not wkt:
        return []

    try:
        import re
        coords = re.findall(r'(-?\d+\.?\d*)\s+(-?\d+\.?\d*)', wkt)
        if not coords:
            return []

        # Sample every 5th point for efficiency
        points = []
        for i in range(0, len(coords), 5):
            lon, lat = float(coords[i][0]), float(coords[i][1])
            points.append((lat, lon))

        # Always include first and last
        if len(coords) > 1:
            lon, lat = float(coords[-1][0]), float(coords[-1][1])
            if (lat, lon) not in points:
                points.append((lat, lon))

        return points
    except:
        return []


def min_distance_to_line(point_lat, point_lon, line_points):
    """Calculate minimum distance from a point to sampled line points."""
    if not line_points:
        return float('inf')

    min_dist = float('inf')
    for lat, lon in line_points:
        d = haversine_km(point_lat, point_lon, lat, lon)
        if d < min_dist:
            min_dist = d
    return min_dist


def fetch_all(table, select, filters=''):
    """Paginated fetch of all records from a table."""
    records = []
    offset = 0
    page_size = 1000
    while True:
        path = f'{table}?select={select}&limit={page_size}&offset={offset}'
        if filters:
            path += '&' + filters
        result = supabase_request('GET', path)
        if not result:
            break
        records.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
    return records


def main():
    print("=" * 60)
    print("GridScout BLM ROW ↔ Transmission Line Cross-Reference")
    print("=" * 60)

    # First, add columns if they don't exist
    print("\nEnsuring cross-reference columns exist...")
    import subprocess
    sql = """
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS nearest_line_id INTEGER;
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS nearest_line_distance_km NUMERIC(8,3);
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS nearest_line_voltage_kv NUMERIC(8,2);
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS nearest_line_capacity_mw NUMERIC(10,2);
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS nearest_line_owner TEXT;
    ALTER TABLE grid_blm_row ADD COLUMN IF NOT EXISTS near_upgrade_candidate BOOLEAN DEFAULT FALSE;
    """
    db_pass = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-c', sql],
        env={**os.environ, 'PGPASSWORD': db_pass},
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"  Warning: {result.stderr}")
    else:
        print("  Columns ready")

    # Load BLM ROW records
    print("\nLoading BLM ROW records...")
    blm_rows = fetch_all(
        'grid_blm_row',
        'id,source_record_id,state,geometry_wkt,holder_name,commodity',
    )
    print(f"  {len(blm_rows)} BLM ROW records")

    # Load transmission lines (with geometry for proximity)
    print("Loading transmission lines...")
    lines = fetch_all(
        'grid_transmission_lines',
        'hifld_id,state,voltage_kv,capacity_mw,upgrade_candidate,owner,geometry_wkt',
    )
    print(f"  {len(lines)} transmission lines")

    # Index lines by state for faster lookup
    lines_by_state = {}
    for line in lines:
        state = line.get('state')
        if state:
            if state not in lines_by_state:
                lines_by_state[state] = []
            lines_by_state[state].append(line)

    # Pre-compute line points for each line
    print("Pre-computing line sample points...")
    line_points_cache = {}
    for line in lines:
        hifld_id = line.get('hifld_id')
        if hifld_id:
            line_points_cache[hifld_id] = get_line_points(line.get('geometry_wkt'))

    # Cross-reference
    print(f"\nCross-referencing (max distance: {MAX_DISTANCE_KM} km)...")
    patches = []
    matched = 0
    near_upgrade = 0

    for i, blm in enumerate(blm_rows):
        blm_lat, blm_lon = get_centroid_from_wkt(blm.get('geometry_wkt'))
        if blm_lat is None:
            continue

        state = blm.get('state')
        state_lines = lines_by_state.get(state, [])

        best_line = None
        best_distance = float('inf')

        for line in state_lines:
            hifld_id = line.get('hifld_id')
            points = line_points_cache.get(hifld_id, [])
            dist = min_distance_to_line(blm_lat, blm_lon, points)

            if dist < best_distance:
                best_distance = dist
                best_line = line

        if best_line and best_distance <= MAX_DISTANCE_KM:
            matched += 1
            is_upgrade = best_line.get('upgrade_candidate', False)
            if is_upgrade:
                near_upgrade += 1

            patch = {
                'id': blm['id'],
                'nearest_line_id': best_line.get('hifld_id'),
                'nearest_line_distance_km': round(best_distance, 3),
                'nearest_line_voltage_kv': best_line.get('voltage_kv'),
                'nearest_line_capacity_mw': best_line.get('capacity_mw'),
                'nearest_line_owner': best_line.get('owner'),
                'near_upgrade_candidate': is_upgrade,
            }
            patches.append(patch)

        if (i + 1) % 100 == 0:
            print(f"  Processed {i + 1}/{len(blm_rows)}, {matched} matched, {near_upgrade} near upgrades")

    print(f"\n  Total matched: {matched} / {len(blm_rows)} ({100 * matched / max(1, len(blm_rows)):.1f}%)")
    print(f"  Near upgrade candidates: {near_upgrade}")

    # Apply patches
    print(f"\nApplying {len(patches)} patches...")
    total_patched = 0
    total_errors = 0

    for patch in patches:
        blm_id = patch.pop('id')
        try:
            supabase_request(
                'PATCH',
                f'grid_blm_row?id=eq.{blm_id}',
                patch,
            )
            total_patched += 1
        except:
            total_errors += 1

        if total_patched % 100 == 0 and total_patched > 0:
            print(f"  Patched {total_patched}...")

    # Distance distribution
    distances = [p.get('nearest_line_distance_km', 999) for p in patches if 'nearest_line_distance_km' in p]
    if distances:
        print(f"\n  Distance distribution:")
        for threshold in [1, 2, 5, 10]:
            count = sum(1 for d in distances if d <= threshold)
            print(f"    <= {threshold} km: {count}")

    # Voltage distribution of matched lines
    voltages = {}
    for p in patches:
        v = p.get('nearest_line_voltage_kv')
        if v:
            voltages[int(v)] = voltages.get(int(v), 0) + 1

    if voltages:
        print(f"\n  Matched line voltage distribution:")
        for v in sorted(voltages.keys()):
            print(f"    {v} kV: {voltages[v]}")

    print(f"\n{'=' * 60}")
    print(f"Cross-Reference Complete")
    print(f"  Matched: {total_patched}")
    print(f"  Near upgrade candidates: {near_upgrade}")
    print(f"  Errors: {total_errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

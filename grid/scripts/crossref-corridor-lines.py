#!/usr/bin/env python3
"""
Cross-reference energy corridors (grid_corridors) with nearby transmission lines
(grid_transmission_lines).

For each corridor polygon, finds which transmission lines pass through or near
the corridor by:
1. Computing corridor bounding box from WKT geometry
2. Rough filter: checking if sampled line points fall within expanded bounding box
3. Fine filter: checking actual proximity (within 5km of corridor boundary)

Updates grid_corridors with:
- transmission_line_count: number of lines passing through/near the corridor
- upgrade_candidate_count: how many of those are upgrade candidates (50-100 MW)
- transmission_line_ids: array of hifld_id values for matched lines
- total_capacity_mw: sum of matched lines' capacity

This helps I Squared Capital identify which energy corridors already have
transmission infrastructure (and which have upgrade-ready lines).
"""

import os
import sys
import json
import math
import re
import time
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
PROXIMITY_KM = 5  # Match lines within 5km of corridor boundary
BBOX_BUFFER_DEG = 0.1  # ~11km buffer on bounding box for rough filter
LINE_SAMPLE_STEP = 5  # Sample every 5th vertex along each line


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


def parse_coords_from_wkt(wkt):
    """Extract all (lon, lat) coordinate pairs from any WKT geometry."""
    if not wkt:
        return []
    coords = re.findall(r'(-?\d+\.?\d*)\s+(-?\d+\.?\d*)', wkt)
    return [(float(c[0]), float(c[1])) for c in coords]


def get_bounding_box(wkt):
    """Get (min_lon, min_lat, max_lon, max_lat) bounding box from WKT polygon."""
    coords = parse_coords_from_wkt(wkt)
    if not coords:
        return None
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (min(lons), min(lats), max(lons), max(lats))


def get_polygon_boundary_points(wkt, step=10):
    """
    Get sampled boundary points from a POLYGON or MULTIPOLYGON WKT.
    Returns list of (lat, lon) tuples.
    """
    coords = parse_coords_from_wkt(wkt)
    if not coords:
        return []
    points = []
    for i in range(0, len(coords), step):
        lon, lat = coords[i]
        points.append((lat, lon))
    # Always include last point
    if coords:
        lon, lat = coords[-1]
        if (lat, lon) not in points:
            points.append((lat, lon))
    return points


def get_line_points(wkt):
    """Get sampled points along a LINESTRING WKT for proximity checking."""
    coords = parse_coords_from_wkt(wkt)
    if not coords:
        return []
    points = []
    for i in range(0, len(coords), LINE_SAMPLE_STEP):
        lon, lat = coords[i]
        points.append((lat, lon))
    # Always include first and last
    if len(coords) > 1:
        lon, lat = coords[-1]
        if (lat, lon) not in points:
            points.append((lat, lon))
    return points


def point_in_bbox(lat, lon, bbox, buffer=0):
    """Check if a point falls within a bounding box (with optional buffer in degrees)."""
    min_lon, min_lat, max_lon, max_lat = bbox
    return (min_lat - buffer <= lat <= max_lat + buffer and
            min_lon - buffer <= lon <= max_lon + buffer)


def min_distance_point_to_boundary(point_lat, point_lon, boundary_points):
    """Calculate minimum distance from a point to sampled boundary points (km)."""
    if not boundary_points:
        return float('inf')
    min_dist = float('inf')
    for blat, blon in boundary_points:
        d = haversine_km(point_lat, point_lon, blat, blon)
        if d < min_dist:
            min_dist = d
    return min_dist


def min_distance_line_to_corridor(line_points, corridor_bbox, corridor_boundary_points):
    """
    Calculate minimum distance from any sampled line point to the corridor boundary.
    First does a rough bounding-box check, then fine Haversine distance.
    Returns (min_distance_km, points_inside_bbox_count).
    """
    if not line_points or not corridor_bbox:
        return float('inf'), 0

    min_dist = float('inf')
    bbox_hits = 0

    for lat, lon in line_points:
        # Rough filter: is this line point inside the expanded corridor bbox?
        if point_in_bbox(lat, lon, corridor_bbox, buffer=BBOX_BUFFER_DEG):
            bbox_hits += 1
            # Fine filter: actual distance to corridor boundary
            d = min_distance_point_to_boundary(lat, lon, corridor_boundary_points)
            if d < min_dist:
                min_dist = d

    return min_dist, bbox_hits


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


def ensure_columns():
    """Add cross-reference columns to grid_corridors if they don't exist."""
    print("Ensuring cross-reference columns exist on grid_corridors...")
    sql = """
    ALTER TABLE grid_corridors ADD COLUMN IF NOT EXISTS transmission_line_count INTEGER;
    ALTER TABLE grid_corridors ADD COLUMN IF NOT EXISTS upgrade_candidate_count INTEGER;
    ALTER TABLE grid_corridors ADD COLUMN IF NOT EXISTS transmission_line_ids INTEGER[];
    ALTER TABLE grid_corridors ADD COLUMN IF NOT EXISTS total_capacity_mw NUMERIC(10,2);
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
        print(f"  Warning: {result.stderr.strip()}")
    else:
        print("  Columns ready")


def main():
    print("=" * 60)
    print("GridScout Corridor <-> Transmission Line Cross-Reference")
    print("=" * 60)
    start_time = time.time()

    # Step 0: Ensure columns exist
    ensure_columns()

    # Step 1: Load corridors
    print("\nLoading corridors from grid_corridors...")
    corridors = fetch_all(
        'grid_corridors',
        'id,source_record_id,corridor_type,name,states,geometry_wkt'
    )
    print(f"  {len(corridors)} corridors loaded")

    # Filter to corridors with geometry
    corridors_with_geom = [c for c in corridors if c.get('geometry_wkt')]
    corridors_no_geom = len(corridors) - len(corridors_with_geom)
    if corridors_no_geom:
        print(f"  {corridors_no_geom} corridors have no geometry (skipped)")
    print(f"  {len(corridors_with_geom)} corridors with geometry to process")

    if not corridors_with_geom:
        print("\nNo corridors with geometry found. Nothing to cross-reference.")
        return

    # Step 2: Load transmission lines
    print("\nLoading transmission lines from grid_transmission_lines...")
    lines = fetch_all(
        'grid_transmission_lines',
        'hifld_id,state,voltage_kv,capacity_mw,upgrade_candidate,owner,geometry_wkt'
    )
    print(f"  {len(lines)} transmission lines loaded")

    # Pre-compute line sample points and filter to lines with geometry
    print("Pre-computing line sample points...")
    line_data = []  # list of (line_record, line_points)
    skipped_no_geom = 0
    for line in lines:
        wkt = line.get('geometry_wkt')
        if not wkt:
            skipped_no_geom += 1
            continue
        pts = get_line_points(wkt)
        if pts:
            line_data.append((line, pts))
    print(f"  {len(line_data)} lines with sample points ({skipped_no_geom} skipped, no geometry)")

    # Step 3: Cross-reference each corridor against all lines
    print(f"\nCross-referencing corridors with lines (proximity: {PROXIMITY_KM} km)...\n")
    patches = []
    total_matched_lines = 0
    total_upgrade_candidates = 0

    for idx, corridor in enumerate(corridors_with_geom):
        c_id = corridor['id']
        c_name = corridor.get('name') or corridor.get('source_record_id', '?')
        c_wkt = corridor['geometry_wkt']
        c_states = corridor.get('states') or []

        # Compute corridor bounding box and boundary points
        c_bbox = get_bounding_box(c_wkt)
        if not c_bbox:
            continue
        c_boundary = get_polygon_boundary_points(c_wkt, step=10)
        if not c_boundary:
            continue

        matched_line_ids = []
        matched_upgrade_count = 0
        matched_capacity_sum = 0.0

        for line, line_pts in line_data:
            hifld_id = line.get('hifld_id')
            if not hifld_id:
                continue

            # Optional: state pre-filter (if corridor has states and line has state)
            line_state = line.get('state')
            if c_states and line_state and line_state not in c_states:
                continue

            # Check proximity: rough bbox then fine Haversine
            min_dist, bbox_hits = min_distance_line_to_corridor(
                line_pts, c_bbox, c_boundary
            )

            if bbox_hits > 0 and min_dist <= PROXIMITY_KM:
                matched_line_ids.append(hifld_id)
                if line.get('upgrade_candidate'):
                    matched_upgrade_count += 1
                cap = line.get('capacity_mw')
                if cap is not None:
                    matched_capacity_sum += float(cap)

        line_count = len(matched_line_ids)
        total_matched_lines += line_count
        total_upgrade_candidates += matched_upgrade_count

        patch = {
            'transmission_line_count': line_count,
            'upgrade_candidate_count': matched_upgrade_count,
            'transmission_line_ids': matched_line_ids if matched_line_ids else None,
            'total_capacity_mw': round(matched_capacity_sum, 2) if matched_capacity_sum > 0 else None,
        }
        patches.append((c_id, patch))

        if line_count > 0:
            print(f"  [{idx + 1}/{len(corridors_with_geom)}] {c_name}: "
                  f"{line_count} lines, {matched_upgrade_count} upgrade candidates, "
                  f"{matched_capacity_sum:.1f} MW total")
        elif (idx + 1) % 50 == 0:
            print(f"  [{idx + 1}/{len(corridors_with_geom)}] Processed...")

    # Step 4: Apply patches via Supabase REST API
    print(f"\nApplying {len(patches)} corridor updates...")
    total_patched = 0
    total_errors = 0

    for c_id, patch in patches:
        try:
            supabase_request(
                'PATCH',
                f'grid_corridors?id=eq.{c_id}',
                patch,
            )
            total_patched += 1
        except Exception as e:
            total_errors += 1
            if total_errors <= 5:
                print(f"  Error patching {c_id}: {e}")

        if total_patched % 100 == 0 and total_patched > 0:
            print(f"  Patched {total_patched}...")

    # Step 5: Summary statistics
    elapsed = time.time() - start_time
    corridors_with_lines = sum(1 for _, p in patches if p['transmission_line_count'] and p['transmission_line_count'] > 0)
    corridors_with_upgrades = sum(1 for _, p in patches if p['upgrade_candidate_count'] and p['upgrade_candidate_count'] > 0)

    # Line count distribution
    line_counts = [p['transmission_line_count'] for _, p in patches if p['transmission_line_count']]
    if line_counts:
        avg_lines = sum(line_counts) / len(line_counts)
        max_lines = max(line_counts)
    else:
        avg_lines = 0
        max_lines = 0

    # Corridor type breakdown
    type_counts = {}
    for corridor in corridors_with_geom:
        ctype = corridor.get('corridor_type', 'unknown')
        if ctype not in type_counts:
            type_counts[ctype] = {'total': 0, 'with_lines': 0, 'upgrade': 0}
        type_counts[ctype]['total'] += 1

    for i, (c_id, patch) in enumerate(patches):
        if i < len(corridors_with_geom):
            ctype = corridors_with_geom[i].get('corridor_type', 'unknown')
            if patch['transmission_line_count'] and patch['transmission_line_count'] > 0:
                type_counts[ctype]['with_lines'] += 1
            if patch['upgrade_candidate_count'] and patch['upgrade_candidate_count'] > 0:
                type_counts[ctype]['upgrade'] += 1

    print(f"\n{'=' * 60}")
    print(f"Cross-Reference Complete ({elapsed:.1f}s)")
    print(f"{'=' * 60}")
    print(f"  Corridors processed:          {len(corridors_with_geom)}")
    print(f"  Corridors with nearby lines:  {corridors_with_lines}")
    print(f"  Corridors with upgrade cands: {corridors_with_upgrades}")
    print(f"  Total line matches:           {total_matched_lines}")
    print(f"  Total upgrade candidates:     {total_upgrade_candidates}")
    if corridors_with_lines:
        print(f"  Avg lines per corridor:       {avg_lines:.1f}")
        print(f"  Max lines in one corridor:    {max_lines}")

    if type_counts:
        print(f"\n  By corridor type:")
        for ctype, counts in sorted(type_counts.items()):
            print(f"    {ctype}: {counts['total']} total, "
                  f"{counts['with_lines']} with lines, "
                  f"{counts['upgrade']} with upgrades")

    print(f"\n  Patched: {total_patched}")
    print(f"  Errors:  {total_errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

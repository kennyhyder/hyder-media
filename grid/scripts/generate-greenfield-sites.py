#!/usr/bin/env python3
"""
Generate greenfield DC candidate sites by sampling points along
high-voltage (115+ kV) transmission lines.

These represent undeveloped locations along major transmission corridors
where new datacenter construction could tap into existing high-capacity
power infrastructure without needing a brownfield or existing substation.

Algorithm:
1. Load all transmission lines with voltage >= 115 kV and geometry_wkt
2. Parse WKT LINESTRING/MULTILINESTRING geometry into coordinate sequences
3. Walk each line, sampling a candidate point every ~10 km
4. Skip any point within 3 km of an existing DC site (substation/brownfield)
5. Deduplicate candidates within 1 km of each other (keep highest voltage)
6. Assign county FIPS codes via nearest-county-centroid lookup
7. Insert as site_type='greenfield' into grid_dc_sites

Target: grid_dc_sites table (site_type = 'greenfield')
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
SAMPLE_INTERVAL_KM = 10.0    # Sample a point every 10 km along each line
MIN_VOLTAGE_KV = 115          # Only sample along 115+ kV lines (supports 20-50 MW DC loads)
EXCLUSION_RADIUS_KM = 3.0    # Skip points within 3 km of existing DC sites
DEDUP_RADIUS_KM = 1.0        # Deduplicate candidates within 1 km

# State FIPS -> abbreviation
STATE_FIPS = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
    '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
    '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
    '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
    '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
    '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
    '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
    '54': 'WV', '55': 'WI', '56': 'WY',
}

# ISO region mapping by state
STATE_ISO = {
    'TX': 'ERCOT', 'CA': 'CAISO', 'NY': 'NYISO', 'CT': 'ISO-NE', 'MA': 'ISO-NE',
    'ME': 'ISO-NE', 'NH': 'ISO-NE', 'RI': 'ISO-NE', 'VT': 'ISO-NE',
    'PA': 'PJM', 'NJ': 'PJM', 'MD': 'PJM', 'DE': 'PJM', 'DC': 'PJM',
    'VA': 'PJM', 'WV': 'PJM', 'OH': 'PJM', 'IN': 'PJM', 'IL': 'PJM',
    'MI': 'PJM', 'KY': 'PJM', 'NC': 'PJM',
    'MN': 'MISO', 'IA': 'MISO', 'WI': 'MISO', 'MO': 'MISO', 'AR': 'MISO',
    'MS': 'MISO', 'LA': 'MISO',
    'OK': 'SPP', 'KS': 'SPP', 'NE': 'SPP', 'SD': 'SPP', 'ND': 'SPP',
    'NM': 'SPP', 'MT': 'SPP',
    'OR': 'WECC', 'WA': 'WECC', 'ID': 'WECC', 'UT': 'WECC', 'WY': 'WECC',
    'CO': 'WECC', 'AZ': 'WECC', 'NV': 'WECC',
    'GA': 'SERC', 'FL': 'SERC', 'AL': 'SERC', 'SC': 'SERC', 'TN': 'SERC',
}

# Voltage -> estimated available capacity
VOLTAGE_CAPACITY = {
    765: 1500,
    500: 1000,
    345: 600,
    230: 300,
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
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def load_paginated(table, select, extra_filter='', page_size=1000):
    """Load all records from a table with pagination."""
    records = []
    offset = 0
    while True:
        path = f'{table}?select={select}{extra_filter}&order=id&limit={page_size}&offset={offset}'
        rows = supabase_request('GET', path)
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break
    return records


def parse_wkt(wkt):
    """Parse WKT LINESTRING or MULTILINESTRING into list of coordinate sequences.
    Returns list of lists of (lat, lng) tuples.
    """
    if not wkt:
        return []

    polylines = []

    if wkt.startswith('MULTILINESTRING'):
        inner = wkt.replace('MULTILINESTRING((', '', 1)
        if inner.endswith('))'):
            inner = inner[:-2]
        parts = inner.split('),(')
        for part in parts:
            coords = parse_coord_string(part)
            if coords:
                polylines.append(coords)
    elif wkt.startswith('LINESTRING'):
        inner = wkt.replace('LINESTRING(', '', 1)
        if inner.endswith(')'):
            inner = inner[:-1]
        coords = parse_coord_string(inner)
        if coords:
            polylines.append(coords)

    return polylines


def parse_coord_string(s):
    """Parse 'lng lat, lng lat, ...' into [(lat, lng), ...]."""
    coords = []
    for pair in s.split(','):
        parts = pair.strip().split()
        if len(parts) >= 2:
            try:
                lng = float(parts[0])
                lat = float(parts[1])
                if abs(lat) <= 90 and abs(lng) <= 180:
                    coords.append((lat, lng))
            except ValueError:
                continue
    return coords


def interpolate_point(lat1, lng1, lat2, lng2, fraction):
    """Linearly interpolate between two points by fraction (0 to 1)."""
    return (
        lat1 + (lat2 - lat1) * fraction,
        lng1 + (lng2 - lng1) * fraction,
    )


def sample_along_line(coords, interval_km):
    """Sample points at regular intervals along a coordinate sequence.
    Returns list of (lat, lng) sample points.
    """
    if len(coords) < 2:
        return []

    samples = []
    accumulated = 0.0

    for i in range(len(coords) - 1):
        lat1, lng1 = coords[i]
        lat2, lng2 = coords[i + 1]
        seg_dist = haversine_km(lat1, lng1, lat2, lng2)

        if seg_dist < 0.001:
            continue

        # Walk along this segment
        while accumulated <= seg_dist:
            if accumulated == 0 and i == 0:
                # Skip the very first point (that's the substation endpoint)
                accumulated += interval_km
                continue

            frac = accumulated / seg_dist
            if frac > 1.0:
                break

            pt = interpolate_point(lat1, lng1, lat2, lng2, frac)
            samples.append(pt)
            accumulated += interval_km

        accumulated -= seg_dist  # Carry remainder to next segment

    return samples


def build_grid_index(items, cell_size=0.05):
    """Build spatial grid index from list of (lat, lng, ...) items.
    Items can be dicts with 'latitude'/'longitude' or tuples.
    """
    index = {}
    for item in items:
        if isinstance(item, dict):
            lat = float(item.get('latitude', 0))
            lng = float(item.get('longitude', 0))
        else:
            lat, lng = item[0], item[1]
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(item)
    return index


def is_near_existing(lat, lng, existing_index, radius_km, cell_size=0.05):
    """Check if point is within radius_km of any point in the spatial index."""
    cell = (int(lat / cell_size), int(lng / cell_size))
    # Check surrounding cells
    search_cells = int(math.ceil(radius_km / (cell_size * 111.0))) + 1
    for di in range(-search_cells, search_cells + 1):
        for dj in range(-search_cells, search_cells + 1):
            for item in existing_index.get((cell[0] + di, cell[1] + dj), []):
                if isinstance(item, dict):
                    elat = float(item['latitude'])
                    elng = float(item['longitude'])
                else:
                    elat, elng = item[0], item[1]
                dist = haversine_km(lat, lng, elat, elng)
                if dist < radius_km:
                    return True
    return False


def voltage_to_capacity(voltage_kv):
    """Map voltage to estimated available capacity."""
    if voltage_kv >= 500:
        return 1000
    elif voltage_kv >= 345:
        return 600
    elif voltage_kv >= 230:
        return 300
    return 100


def deduplicate_sites(candidates, radius_km=1.0):
    """Deduplicate candidate sites within radius_km. Keep highest voltage."""
    candidates.sort(key=lambda x: x.get('substation_voltage_kv') or 0, reverse=True)

    kept = []
    grid = {}
    cell_size = 0.02

    for site in candidates:
        lat, lng = site['latitude'], site['longitude']
        cell = (int(lat / cell_size), int(lng / cell_size))

        is_dup = False
        for di in range(-1, 2):
            for dj in range(-1, 2):
                for existing in grid.get((cell[0] + di, cell[1] + dj), []):
                    dist = haversine_km(lat, lng, existing['latitude'], existing['longitude'])
                    if dist < radius_km:
                        is_dup = True
                        break
                if is_dup:
                    break
            if is_dup:
                break

        if not is_dup:
            kept.append(site)
            if cell not in grid:
                grid[cell] = []
            grid[cell].append(site)

    return kept


def find_county_for_point(lat, lng, county_index, cell_size=1.0):
    """Find the nearest county for a point using spatial grid index."""
    cell = (int(lat / cell_size), int(lng / cell_size))
    best = None
    best_dist = float('inf')
    for di in range(-2, 3):
        for dj in range(-2, 3):
            for county in county_index.get((cell[0] + di, cell[1] + dj), []):
                clat = county.get('latitude') or county.get('centroid_lat')
                clng = county.get('longitude') or county.get('centroid_lng')
                if clat and clng:
                    dist = haversine_km(lat, lng, float(clat), float(clng))
                    if dist < best_dist:
                        best_dist = dist
                        best = county
    return best


def main():
    print("=" * 60)
    print("GridScout Greenfield Site Generation")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Load high-voltage transmission lines with geometry
    print(f"\n[Step 1] Loading transmission lines >= {MIN_VOLTAGE_KV} kV with geometry...")
    lines = load_paginated(
        'grid_transmission_lines',
        'id,hifld_id,voltage_kv,capacity_mw,owner,state,sub_1,sub_2,naession,geometry_wkt',
        f'&voltage_kv=gte.{MIN_VOLTAGE_KV}&geometry_wkt=not.is.null'
    )
    print(f"  {len(lines)} lines loaded")

    # Voltage distribution
    v_dist = {}
    for ln in lines:
        v = int(float(ln.get('voltage_kv') or 0))
        v_dist[v] = v_dist.get(v, 0) + 1
    print(f"  Voltage distribution: {dict(sorted(v_dist.items()))}")

    # Step 2: Load existing DC sites for exclusion
    print("\n[Step 2] Loading existing DC sites for exclusion zone...")
    existing_sites = load_paginated(
        'grid_dc_sites',
        'id,latitude,longitude,site_type',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  {len(existing_sites)} existing DC sites loaded")

    # Build spatial index for existing sites
    existing_index = build_grid_index(existing_sites, cell_size=0.05)

    # Step 3: Load counties for FIPS assignment
    print("\n[Step 3] Loading county centroids...")
    counties = load_paginated(
        'grid_county_data',
        'fips_code,state,county_name,latitude,longitude'
    )
    print(f"  {len(counties)} counties loaded")

    county_index = {}
    cell_size_county = 1.0
    for c in counties:
        lat = c.get('latitude')
        lng = c.get('longitude')
        if lat and lng:
            cell = (int(float(lat) / cell_size_county), int(float(lng) / cell_size_county))
            if cell not in county_index:
                county_index[cell] = []
            county_index[cell].append(c)

    # Step 4: Get data source
    print("\n[Step 4] Getting data source...")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.greenfield_generation&select=id')
    if not ds:
        supabase_request('POST', 'grid_data_sources', [{
            'name': 'greenfield_generation',
            'description': 'Greenfield DC candidate sites sampled along 230+ kV transmission lines',
            'url': None,
        }], {'Prefer': 'return=representation'})
        ds = supabase_request('GET', 'grid_data_sources?name=eq.greenfield_generation&select=id')
    data_source_id = ds[0]['id'] if ds else None

    # Step 5: Sample points along each line
    print(f"\n[Step 5] Sampling points every {SAMPLE_INTERVAL_KM} km along {len(lines)} lines...")
    candidates = []
    lines_sampled = 0
    total_raw_points = 0
    excluded_points = 0

    for i, line in enumerate(lines):
        wkt = line.get('geometry_wkt')
        if not wkt:
            continue

        polylines = parse_wkt(wkt)
        if not polylines:
            continue

        voltage = float(line.get('voltage_kv') or 230)
        capacity = voltage_to_capacity(voltage)
        state = line.get('state') or ''
        line_id = line.get('id')
        owner = line.get('owner')
        line_name = line.get('naession') or f"{line.get('sub_1', '?')} - {line.get('sub_2', '?')}"

        lines_sampled += 1

        for coords in polylines:
            samples = sample_along_line(coords, SAMPLE_INTERVAL_KM)
            total_raw_points += len(samples)

            for lat, lng in samples:
                # Skip points outside continental US bounds.
                # Alaska and Hawaii excluded: HIFLD transmission line dataset
                # has limited coverage outside CONUS, and federal energy corridor
                # data does not extend to AK/HI, making greenfield sampling unreliable.
                if lat < 24 or lat > 50 or lng < -125 or lng > -66:
                    excluded_points += 1
                    continue

                # Skip if too close to existing site
                if is_near_existing(lat, lng, existing_index, EXCLUSION_RADIUS_KM, cell_size=0.05):
                    excluded_points += 1
                    continue

                candidates.append({
                    'source_record_id': f'gf_{line_id[:8]}_{lat:.4f}_{lng:.4f}',
                    'name': f'Greenfield ({line_name[:30]})',
                    'site_type': 'greenfield',
                    'state': state,
                    'latitude': round(lat, 6),
                    'longitude': round(lng, 6),
                    'substation_voltage_kv': voltage,
                    'available_capacity_mw': capacity,
                    'nearest_substation_name': line.get('sub_1'),
                    'iso_region': STATE_ISO.get(state),
                    'data_source_id': data_source_id,
                })

        if (i + 1) % 1000 == 0:
            print(f"  Processed {i + 1}/{len(lines)} lines, {len(candidates)} candidates so far...")

    print(f"  Lines sampled: {lines_sampled}")
    print(f"  Raw sample points: {total_raw_points}")
    print(f"  Excluded (near existing or out of bounds): {excluded_points}")
    print(f"  Candidates after exclusion: {len(candidates)}")

    # Step 6: Deduplicate within 1 km
    print(f"\n[Step 6] Deduplicating within {DEDUP_RADIUS_KM} km...")
    deduped = deduplicate_sites(candidates, DEDUP_RADIUS_KM)
    print(f"  {len(deduped)} sites after dedup ({len(candidates) - len(deduped)} removed)")

    # Step 7: Assign county FIPS codes
    print("\n[Step 7] Assigning county FIPS codes...")
    assigned = 0
    for site in deduped:
        county = find_county_for_point(site['latitude'], site['longitude'], county_index, cell_size_county)
        if county:
            site['fips_code'] = county['fips_code']
            site['county'] = county['county_name']
            if not site.get('state') and county.get('state'):
                site['state'] = county['state']
            assigned += 1
    print(f"  {assigned}/{len(deduped)} sites assigned to counties")

    # Step 8: Fix state from FIPS if missing
    for site in deduped:
        if not site.get('state') and site.get('fips_code'):
            state_fips = site['fips_code'][:2]
            site['state'] = STATE_FIPS.get(state_fips, '')
            if site['state']:
                site['iso_region'] = STATE_ISO.get(site['state'])

    # Stats
    states = {}
    for s in deduped:
        st = s.get('state', 'UNK')
        states[st] = states.get(st, 0) + 1

    print(f"\n  Top states: {dict(sorted(states.items(), key=lambda x: -x[1])[:15])}")
    print(f"  Total states: {len(states)}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(deduped)} greenfield DC sites")
        for s in deduped[:10]:
            print(f"  {s['source_record_id']} {s['state']} {s['name'][:50]} ({s.get('substation_voltage_kv')} kV)")
        return

    # Step 9: Delete existing greenfield sites and insert new
    print(f"\n[Step 9] Inserting {len(deduped)} greenfield DC sites...")

    # Clear existing greenfield sites
    print("  Clearing existing greenfield sites...")
    supabase_request('DELETE', 'grid_dc_sites?source_record_id=like.gf_*')

    created = 0
    errors = 0

    for i in range(0, len(deduped), BATCH_SIZE):
        batch = deduped[i:i + BATCH_SIZE]

        # Ensure all records in batch have same keys (PostgREST requirement)
        all_keys = set()
        for rec in batch:
            all_keys.update(rec.keys())

        normalized = []
        for rec in batch:
            norm = {k: rec.get(k) for k in all_keys}
            normalized.append(norm)

        try:
            supabase_request(
                'POST',
                'grid_dc_sites',
                normalized,
                {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
            )
            created += len(batch)
        except Exception:
            # Fall back to individual inserts
            for rec in normalized:
                try:
                    supabase_request(
                        'POST',
                        'grid_dc_sites',
                        [rec],
                        {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
                    )
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Error: {e2}")

        if (i + BATCH_SIZE) % 500 == 0 or i + BATCH_SIZE >= len(deduped):
            print(f"  Progress: {min(i + BATCH_SIZE, len(deduped))}/{len(deduped)} ({created} ok, {errors} err)")

    # Update data source
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"Greenfield Site Generation Complete")
    print(f"  Sites created: {created}")
    print(f"  Errors: {errors}")
    print(f"  Lines sampled: {lines_sampled} (>= {MIN_VOLTAGE_KV} kV)")
    print(f"  Raw sample points: {total_raw_points}")
    print(f"  Excluded (near existing): {excluded_points}")
    print(f"  Deduped: {len(candidates) - len(deduped)}")
    print(f"  States covered: {len(states)}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

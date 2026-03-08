#!/usr/bin/env python3
"""
Generate candidate DC sites from substations and brownfield sites.

Phase 3a of the GridScout DC plan:
- Every substation >= 69 kV → candidate at substation location
- Every brownfield site → candidate at brownfield location
- Deduplicate sites within 1 km (keep highest-voltage substation)

Target: grid_dc_sites table
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
DEDUP_RADIUS_KM = 1.0  # Sites within 1 km are considered duplicates
MIN_VOLTAGE_KV = 69    # Minimum substation voltage for DC site candidacy

# State FIPS → abbreviation
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


def find_county_for_point(lat, lng, counties):
    """Find the nearest county for a point (simple nearest-centroid)."""
    best = None
    best_dist = float('inf')
    for county in counties:
        if county.get('latitude') and county.get('longitude'):
            dist = haversine_km(lat, lng, float(county['latitude']), float(county['longitude']))
            if dist < best_dist:
                best_dist = dist
                best = county
    return best


def build_grid_index(items, lat_key='latitude', lng_key='longitude', cell_size=0.5):
    """Build spatial grid index."""
    index = {}
    for item in items:
        lat = item.get(lat_key)
        lng = item.get(lng_key)
        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(item)
    return index


def deduplicate_sites(candidates, radius_km=1.0):
    """Deduplicate candidate sites within radius_km. Keep highest voltage."""
    # Sort by voltage descending so highest-voltage sites are kept
    candidates.sort(key=lambda x: x.get('substation_voltage_kv') or 0, reverse=True)

    kept = []
    grid = {}
    cell_size = 0.02  # ~2 km grid cells

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
                        # If brownfield, mark existing site with brownfield data
                        if site.get('brownfield_id') and not existing.get('brownfield_id'):
                            existing['brownfield_id'] = site['brownfield_id']
                            existing['former_use'] = site.get('former_use')
                            existing['existing_capacity_mw'] = site.get('existing_capacity_mw')
                            existing['retirement_date'] = site.get('retirement_date')
                            existing['cleanup_status'] = site.get('cleanup_status')
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


def main():
    print("=" * 60)
    print("GridScout DC Site Generation")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Load substations >= 69 kV
    print("\n[Step 1] Loading substations >= 69 kV...")
    substations = load_paginated(
        'grid_substations',
        'id,name,state,latitude,longitude,max_voltage_kv',
        f'&max_voltage_kv=gte.{MIN_VOLTAGE_KV}&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  {len(substations)} substations loaded")

    # Step 2: Load brownfield sites
    print("\n[Step 2] Loading brownfield sites...")
    brownfields = load_paginated(
        'grid_brownfield_sites',
        'id,name,site_type,former_use,state,county,latitude,longitude,'
        'existing_capacity_mw,retirement_date,cleanup_status,acreage,'
        'nearest_substation_id,nearest_substation_distance_km',
        '&latitude=not.is.null&longitude=not.is.null'
    )
    print(f"  {len(brownfields)} brownfield sites loaded")

    # Step 3: Load county data for FIPS lookup
    print("\n[Step 3] Loading county centroids for FIPS lookup...")
    counties = load_paginated(
        'grid_county_data',
        'fips_code,state,county_name,latitude,longitude'
    )
    print(f"  {len(counties)} counties loaded")

    # Build county spatial index
    county_index = build_grid_index(counties, cell_size=1.0)

    # Step 4: Load existing DC sites to get data_source_id
    print("\n[Step 4] Getting data source...")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.dc_site_generation&select=id')
    if not ds:
        # Create data source
        supabase_request('POST', 'grid_data_sources', [{
            'name': 'dc_site_generation',
            'description': 'Generated DC candidate sites from substations + brownfields',
            'url': None,
        }], {'Prefer': 'return=representation'})
        ds = supabase_request('GET', 'grid_data_sources?name=eq.dc_site_generation&select=id')

    data_source_id = ds[0]['id'] if ds else None

    # Step 5: Generate candidate sites from substations
    print("\n[Step 5] Generating candidate sites...")
    candidates = []

    for sub in substations:
        lat, lng = float(sub['latitude']), float(sub['longitude'])
        state = sub.get('state', '')
        voltage = float(sub['max_voltage_kv']) if sub.get('max_voltage_kv') else None

        # Estimate available capacity from voltage
        # Rule of thumb: 69kV ≈ 50MW, 115kV ≈ 100MW, 230kV ≈ 300MW, 345kV ≈ 600MW, 500kV ≈ 1000MW
        capacity = None
        if voltage:
            if voltage >= 500:
                capacity = 1000
            elif voltage >= 345:
                capacity = 600
            elif voltage >= 230:
                capacity = 300
            elif voltage >= 115:
                capacity = 100
            else:
                capacity = 50

        candidates.append({
            'source_record_id': f'sub_{sub["id"][:12]}',
            'name': sub.get('name') or f'Substation Site',
            'site_type': 'substation',
            'state': state,
            'latitude': lat,
            'longitude': lng,
            'nearest_substation_id': sub['id'],
            'nearest_substation_name': sub.get('name'),
            'nearest_substation_distance_km': 0,
            'substation_voltage_kv': voltage,
            'available_capacity_mw': capacity,
            'iso_region': STATE_ISO.get(state),
            'data_source_id': data_source_id,
        })

    print(f"  {len(candidates)} substation candidates")

    # Step 6: Generate candidate sites from brownfields
    bf_count = 0
    for bf in brownfields:
        lat, lng = float(bf['latitude']), float(bf['longitude'])
        state = bf.get('state', '')

        sub_id = bf.get('nearest_substation_id')
        sub_dist = bf.get('nearest_substation_distance_km')
        voltage = None

        # Look up substation voltage if cross-referenced
        if sub_id:
            for sub in substations:
                if sub['id'] == sub_id:
                    voltage = float(sub['max_voltage_kv']) if sub.get('max_voltage_kv') else None
                    break

        existing_cap = float(bf['existing_capacity_mw']) if bf.get('existing_capacity_mw') else None

        candidates.append({
            'source_record_id': f'bf_{bf["id"][:12]}',
            'name': bf.get('name') or 'Brownfield Site',
            'site_type': 'brownfield',
            'state': state,
            'latitude': lat,
            'longitude': lng,
            'nearest_substation_id': sub_id,
            'nearest_substation_distance_km': float(sub_dist) if sub_dist else None,
            'substation_voltage_kv': voltage,
            'available_capacity_mw': existing_cap,  # Brownfield: available = existing grid connection
            'brownfield_id': bf['id'],
            'former_use': bf.get('former_use'),
            'existing_capacity_mw': existing_cap,
            'retirement_date': bf.get('retirement_date'),
            'cleanup_status': bf.get('cleanup_status'),
            'acreage': float(bf['acreage']) if bf.get('acreage') else None,
            'iso_region': STATE_ISO.get(state),
            'data_source_id': data_source_id,
        })
        bf_count += 1

    print(f"  {bf_count} brownfield candidates")
    print(f"  {len(candidates)} total candidates before dedup")

    # Step 7: Deduplicate within 1 km
    print(f"\n[Step 7] Deduplicating within {DEDUP_RADIUS_KM} km...")
    deduped = deduplicate_sites(candidates, DEDUP_RADIUS_KM)
    print(f"  {len(deduped)} sites after dedup ({len(candidates) - len(deduped)} removed)")

    # Step 8: Assign county FIPS codes
    print("\n[Step 8] Assigning county FIPS codes...")
    assigned = 0
    for site in deduped:
        county = find_county_for_point(site['latitude'], site['longitude'], counties)
        if county:
            site['fips_code'] = county['fips_code']
            site['county'] = county['county_name']
            assigned += 1
    print(f"  {assigned}/{len(deduped)} sites assigned to counties")

    # Stats
    types = {}
    states = {}
    for s in deduped:
        types[s['site_type']] = types.get(s['site_type'], 0) + 1
        st = s.get('state', 'UNK')
        states[st] = states.get(st, 0) + 1

    print(f"\n  Site types: {dict(sorted(types.items()))}")
    print(f"  Top states: {dict(sorted(states.items(), key=lambda x: -x[1])[:10])}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(deduped)} DC sites")
        for s in deduped[:5]:
            print(f"  {s['source_record_id']} {s['state']} {s['name'][:40]} ({s['site_type']}, {s.get('substation_voltage_kv')} kV)")
        return

    # Step 9: Insert new sites, then clean up stale ones (swap pattern for atomicity)
    # Instead of DELETE-then-INSERT (which leaves data unavailable between operations),
    # we INSERT with ignore-duplicates first, then DELETE any old records whose
    # source_record_id is no longer in the new set.
    print(f"\n[Step 9] Upserting {len(deduped)} DC sites...")

    new_source_ids = {rec['source_record_id'] for rec in deduped}

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
        except Exception as e:
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

        if (i // BATCH_SIZE) % 50 == 0:
            print(f"  Progress: {min(i + BATCH_SIZE, len(deduped))}/{len(deduped)} ({created} ok, {errors} err)")

    # Clean up stale records that are no longer in the new candidate set
    print("  Cleaning up stale records...")
    stale_deleted = 0
    for prefix in ['sub_', 'bf_']:
        old_records = load_paginated(
            'grid_dc_sites',
            'id,source_record_id',
            f'&source_record_id=like.{prefix}*'
        )
        stale_ids = [r['id'] for r in old_records if r['source_record_id'] not in new_source_ids]
        for j in range(0, len(stale_ids), BATCH_SIZE):
            batch_ids = stale_ids[j:j + BATCH_SIZE]
            id_filter = ','.join(batch_ids)
            try:
                supabase_request('DELETE',
                    f'grid_dc_sites?id=in.({urllib.parse.quote(id_filter, safe=",.-")})')
                stale_deleted += len(batch_ids)
            except Exception as e:
                print(f"  Error deleting stale batch: {e}")
    if stale_deleted:
        print(f"  Deleted {stale_deleted} stale records")

    # Update data source
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"DC Site Generation Complete")
    print(f"  Sites created: {created}")
    print(f"  Errors: {errors}")
    print(f"  Substation sites: {types.get('substation', 0)}")
    print(f"  Brownfield sites: {types.get('brownfield', 0)}")
    print(f"  Deduped: {len(candidates) - len(deduped)}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

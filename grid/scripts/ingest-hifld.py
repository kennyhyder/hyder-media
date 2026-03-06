#!/usr/bin/env python3
"""
Ingest HIFLD Electric Power Transmission Lines for all 50 US states.
Source: ArcGIS REST API (free, no auth)
Target: grid_transmission_lines table

Downloads line segments with voltage, owner, substations, and geometry.
Uses spatial bounding box queries per state (HIFLD has no STATE field).

Usage:
  python3 -u scripts/ingest-hifld.py              # All 50 states
  python3 -u scripts/ingest-hifld.py --states TX CA NY  # Specific states
  python3 -u scripts/ingest-hifld.py --new-only    # Only states not yet ingested
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

HIFLD_URL = "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0"

# State bounding boxes (xmin, ymin, xmax, ymax) in WGS84 — All 50 states + DC
STATE_BBOXES = {
    # Western states (original 8)
    'TX': (-106.65, 25.84, -93.51, 36.50),
    'NM': (-109.05, 31.33, -103.00, 37.00),
    'AZ': (-114.82, 31.33, -109.04, 37.00),
    'NV': (-120.01, 35.00, -114.04, 42.00),
    'CO': (-109.06, 36.99, -102.04, 41.00),
    'UT': (-114.05, 37.00, -109.04, 42.00),
    'WY': (-111.06, 40.99, -104.05, 45.01),
    'CA': (-124.41, 32.53, -114.13, 42.01),
    # Pacific Northwest
    'OR': (-124.57, 41.99, -116.46, 46.29),
    'WA': (-124.85, 45.54, -116.92, 49.00),
    # Mountain West
    'MT': (-116.05, 44.36, -104.04, 49.00),
    'ID': (-117.24, 41.99, -111.04, 49.00),
    # Great Plains
    'ND': (-104.05, 45.93, -96.55, 49.00),
    'SD': (-104.06, 42.48, -96.44, 45.95),
    'NE': (-104.06, 39.99, -95.31, 43.00),
    'KS': (-102.05, 36.99, -94.59, 40.00),
    'OK': (-103.00, 33.62, -94.43, 37.00),
    # Upper Midwest
    'MN': (-97.24, 43.50, -89.49, 49.38),
    'IA': (-96.64, 40.37, -90.14, 43.50),
    'WI': (-92.89, 42.49, -86.25, 47.08),
    'MI': (-90.42, 41.70, -82.12, 48.31),
    # Great Lakes / Midwest
    'IL': (-91.51, 36.97, -87.02, 42.51),
    'IN': (-88.10, 37.77, -84.78, 41.76),
    'OH': (-84.82, 38.40, -80.52, 42.33),
    'MO': (-95.77, 35.99, -89.10, 40.61),
    # South Central
    'AR': (-94.62, 33.00, -89.64, 36.50),
    'LA': (-94.04, 28.93, -88.82, 33.02),
    'MS': (-91.66, 30.17, -88.10, 35.00),
    'AL': (-88.47, 30.22, -84.89, 35.01),
    # Southeast
    'TN': (-90.31, 34.98, -81.65, 36.68),
    'KY': (-89.57, 36.50, -81.96, 39.15),
    'WV': (-82.64, 37.20, -77.72, 40.64),
    'VA': (-83.68, 36.54, -75.24, 39.47),
    'NC': (-84.32, 33.84, -75.46, 36.59),
    'SC': (-83.35, 32.03, -78.54, 35.22),
    'GA': (-85.61, 30.36, -80.84, 35.00),
    'FL': (-87.63, 24.52, -80.03, 31.00),
    # Mid-Atlantic
    'PA': (-80.52, 39.72, -74.69, 42.27),
    'NY': (-79.76, 40.50, -71.86, 45.02),
    'NJ': (-75.56, 38.93, -73.89, 41.36),
    'DE': (-75.79, 38.45, -75.05, 39.84),
    'MD': (-79.49, 37.91, -75.05, 39.72),
    'DC': (-77.12, 38.79, -76.91, 38.99),
    # New England
    'CT': (-73.73, 40.98, -71.79, 42.05),
    'RI': (-71.86, 41.15, -71.12, 42.02),
    'MA': (-73.51, 41.24, -69.93, 42.89),
    'VT': (-73.44, 42.73, -71.50, 45.02),
    'NH': (-72.56, 42.70, -70.70, 45.31),
    'ME': (-71.08, 43.06, -66.95, 47.46),
    # Hawaii and Alaska (large bboxes, may have limited HIFLD data)
    'HI': (-160.25, 18.91, -154.81, 22.24),
    'AK': (-179.15, 51.21, -129.98, 71.39),
}

BATCH_SIZE = 50


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
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                print(f"  Error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            raise


def get_data_source_id():
    result = supabase_request('GET', 'grid_data_sources?name=eq.hifld_transmission&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print("ERROR: hifld_transmission data source not found. Run schema.sql first.")
    sys.exit(1)


def fetch_hifld_features(bbox, offset=0, batch_size=2000):
    """Fetch features using spatial envelope query."""
    xmin, ymin, xmax, ymax = bbox
    geometry_json = json.dumps({
        'xmin': xmin, 'ymin': ymin,
        'xmax': xmax, 'ymax': ymax,
        'spatialReference': {'wkid': 4326}
    })

    params = {
        'where': '1=1',
        'geometry': geometry_json,
        'geometryType': 'esriGeometryEnvelope',
        'spatialRel': 'esriSpatialRelIntersects',
        'inSR': '4326',
        'outFields': '*',
        'outSR': '4326',
        'f': 'json',
        'resultOffset': offset,
        'resultRecordCount': batch_size,
    }
    url = f"{HIFLD_URL}/query?{urllib.parse.urlencode(params)}"

    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
                if 'error' in data:
                    print(f"  ArcGIS error: {data['error']}")
                    return [], False
                return data.get('features', []), data.get('exceededTransferLimit', False)
        except Exception as e:
            if attempt < 2:
                print(f"  Fetch error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  Fetch failed after 3 attempts: {e}")
            return [], False


def paths_to_wkt(paths):
    """Convert ArcGIS polyline paths to WKT LINESTRING or MULTILINESTRING."""
    if not paths or len(paths) == 0:
        return None
    if len(paths) == 1:
        if len(paths[0]) < 2:
            return None
        coords = ', '.join(f"{p[0]} {p[1]}" for p in paths[0])
        return f"LINESTRING({coords})"
    else:
        lines = []
        for path in paths:
            if len(path) < 2:
                continue
            coords = ', '.join(f"{p[0]} {p[1]}" for p in path)
            lines.append(f"({coords})")
        if not lines:
            return None
        return f"MULTILINESTRING({', '.join(lines)})"


def get_line_centroid(paths):
    """Get approximate centroid of a polyline."""
    if not paths:
        return None, None
    all_points = []
    for path in paths:
        all_points.extend(path)
    if not all_points:
        return None, None
    mid = all_points[len(all_points) // 2]
    return mid[1], mid[0]  # lat, lon


def calculate_line_length_miles(paths):
    if not paths:
        return None
    total_km = 0
    for path in paths:
        for i in range(len(path) - 1):
            lon1, lat1 = math.radians(path[i][0]), math.radians(path[i][1])
            lon2, lat2 = math.radians(path[i + 1][0]), math.radians(path[i + 1][1])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
            c = 2 * math.asin(min(1.0, math.sqrt(a)))
            total_km += 6371 * c
    return round(total_km * 0.621371, 3)


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', '-999', '-9999', 'not available'):
        return None
    return s[:max_len] if len(s) > max_len else s


def feature_to_record(feature, data_source_id, state):
    """Convert an ArcGIS feature to a grid_transmission_lines record."""
    attrs = feature.get('attributes', {})
    geom = feature.get('geometry', {})

    hifld_id = attrs.get('OBJECTID') or attrs.get('ID')
    if isinstance(hifld_id, str):
        hifld_id = int(hifld_id) if hifld_id.isdigit() else hash(hifld_id) % 10**9

    voltage = safe_float(attrs.get('VOLTAGE'))
    volt_class = safe_str(attrs.get('VOLT_CLASS'))
    owner = safe_str(attrs.get('OWNER'))
    status = safe_str(attrs.get('STATUS'))
    line_type = safe_str(attrs.get('TYPE'))
    sub_1 = safe_str(attrs.get('SUB_1'))
    sub_2 = safe_str(attrs.get('SUB_2'))
    naession = safe_str(attrs.get('NAESSION'))

    paths = geom.get('paths', [])
    wkt = paths_to_wkt(paths)
    length = calculate_line_length_miles(paths)

    # Estimate capacity from voltage
    capacity_mw = None
    if voltage:
        voltage_capacity_map = {
            69: 72, 115: 140, 138: 200, 161: 270,
            230: 420, 345: 1230, 500: 2600, 765: 5500
        }
        closest = min(voltage_capacity_map.keys(), key=lambda v: abs(v - voltage))
        if abs(closest - voltage) <= 15:
            capacity_mw = voltage_capacity_map[closest]

    upgrade_candidate = capacity_mw is not None and 50 <= capacity_mw <= 100

    source_record_id = f"hifld_{hifld_id}"

    return {
        'hifld_id': hifld_id,
        'source_record_id': source_record_id,
        'voltage_kv': voltage,
        'volt_class': volt_class,
        'owner': owner,
        'status': status,
        'line_type': line_type,
        'sub_1': sub_1,
        'sub_2': sub_2,
        'naession': naession,
        'state': state,
        'length_miles': length,
        'capacity_mw': capacity_mw,
        'upgrade_candidate': upgrade_candidate,
        'geometry_wkt': wkt,
        'data_source_id': data_source_id,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }


def get_existing_ids():
    existing = set()
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_transmission_lines?select=source_record_id&limit={page_size}&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < page_size:
            break
        offset += page_size
    return existing


def get_ingested_states(existing_ids):
    """Return set of states that already have records in the DB."""
    states = set()
    result = supabase_request('GET', 'grid_transmission_lines?select=state&limit=1000')
    if result:
        for r in result:
            if r.get('state'):
                states.add(r['state'])
    return states


def main():
    print("=" * 60)
    print("GridScout HIFLD Transmission Line Ingestion")
    print("=" * 60)

    # Parse CLI args
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--states', nargs='+', help='Specific states to ingest (e.g., --states TX CA NY)')
    parser.add_argument('--new-only', action='store_true', help='Only ingest states not yet in DB')
    args = parser.parse_args()

    data_source_id = get_data_source_id()
    print(f"Data source ID: {data_source_id}")

    print("Loading existing records...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing records in DB")

    # Determine which states to process
    states_to_process = dict(STATE_BBOXES)
    if args.states:
        requested = [s.upper() for s in args.states]
        states_to_process = {s: b for s, b in STATE_BBOXES.items() if s in requested}
        invalid = [s for s in requested if s not in STATE_BBOXES]
        if invalid:
            print(f"WARNING: Unknown states ignored: {invalid}")
    if args.new_only:
        ingested = get_ingested_states(existing_ids)
        before = len(states_to_process)
        states_to_process = {s: b for s, b in states_to_process.items() if s not in ingested}
        print(f"  Skipping {before - len(states_to_process)} already-ingested states")

    print(f"  Processing {len(states_to_process)} states: {', '.join(states_to_process.keys())}")

    total_created = 0
    total_skipped = 0
    total_errors = 0
    seen_hifld_ids = set()  # Prevent cross-state duplicates

    for state, bbox in states_to_process.items():
        print(f"\n--- {state} (bbox: {bbox}) ---")
        offset = 0
        state_count = 0
        state_created = 0

        while True:
            features, has_more = fetch_hifld_features(bbox, offset)
            if not features:
                break

            records = []
            for f in features:
                attrs = f.get('attributes', {})
                hifld_id = attrs.get('OBJECTID') or attrs.get('ID')

                # Skip if already seen from another state's bbox
                if hifld_id in seen_hifld_ids:
                    continue
                seen_hifld_ids.add(hifld_id)

                state_count += 1
                record = feature_to_record(f, data_source_id, state)

                if record['source_record_id'] in existing_ids:
                    total_skipped += 1
                    continue
                records.append(record)
                existing_ids.add(record['source_record_id'])

            # Insert in batches
            for i in range(0, len(records), BATCH_SIZE):
                batch = records[i:i + BATCH_SIZE]
                try:
                    supabase_request(
                        'POST',
                        'grid_transmission_lines',
                        batch,
                        {'Prefer': 'return=minimal'}
                    )
                    state_created += len(batch)
                except Exception as e:
                    print(f"  Batch error: {e}")
                    for rec in batch:
                        try:
                            supabase_request(
                                'POST',
                                'grid_transmission_lines',
                                [rec],
                                {'Prefer': 'return=minimal'}
                            )
                            state_created += 1
                        except Exception as e2:
                            total_errors += 1
                            if total_errors <= 10:
                                print(f"  Record error ({rec['source_record_id']}): {e2}")

            if not has_more:
                break
            offset += len(features)
            time.sleep(0.5)

        total_created += state_created
        print(f"  {state}: {state_count} unique features, {state_created} created, "
              f"{state_count - state_created} skipped/errors")

    # Update data source
    total_in_db = len(existing_ids)
    supabase_request(
        'PATCH',
        'grid_data_sources?name=eq.hifld_transmission',
        {
            'record_count': total_in_db,
            'last_import': datetime.now(timezone.utc).isoformat()
        }
    )

    print(f"\n{'=' * 60}")
    print(f"HIFLD Ingestion Complete")
    print(f"  Created: {total_created}")
    print(f"  Skipped (existing): {total_skipped}")
    print(f"  Errors: {total_errors}")
    print(f"  Total in DB: {total_in_db}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

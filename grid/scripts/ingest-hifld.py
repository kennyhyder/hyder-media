#!/usr/bin/env python3
"""
Ingest HIFLD Electric Power Transmission Lines for target western states.
Source: ArcGIS REST API (free, no auth)
Target: grid_transmission_lines table

Downloads line segments with voltage, owner, substations, and geometry.
Uses spatial bounding box queries per state (HIFLD has no STATE field).
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

# State bounding boxes (xmin, ymin, xmax, ymax) in WGS84
STATE_BBOXES = {
    'TX': (-106.65, 25.84, -93.51, 36.50),
    'NM': (-109.05, 31.33, -103.00, 37.00),
    'AZ': (-114.82, 31.33, -109.04, 37.00),
    'NV': (-120.01, 35.00, -114.04, 42.00),
    'CO': (-109.06, 36.99, -102.04, 41.00),
    'UT': (-114.05, 37.00, -109.04, 42.00),
    'WY': (-111.06, 40.99, -104.05, 45.01),
    'CA': (-124.41, 32.53, -114.13, 42.01),
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


def main():
    print("=" * 60)
    print("GridScout HIFLD Transmission Line Ingestion")
    print("=" * 60)

    data_source_id = get_data_source_id()
    print(f"Data source ID: {data_source_id}")

    print("Loading existing records...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing records in DB")

    total_created = 0
    total_skipped = 0
    total_errors = 0
    seen_hifld_ids = set()  # Prevent cross-state duplicates

    for state, bbox in STATE_BBOXES.items():
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

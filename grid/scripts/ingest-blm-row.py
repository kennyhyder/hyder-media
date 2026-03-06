#!/usr/bin/env python3
"""
Ingest BLM Right-of-Way grants for transmission corridors.
Source: BLM NLSDB ArcGIS FeatureServer (free, no auth)
Target: grid_blm_row table

Downloads transmission-related ROW grants for target western states.
"""

import os
import sys
import json
import time
import math
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BLM_ROW_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0"

TARGET_STATES = ['NM', 'AZ', 'NV', 'CO', 'UT', 'WY', 'CA']
# Texas has virtually no BLM land — excluded

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
    body = json.dumps(data).encode() if data else None
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


def get_data_source_id():
    result = supabase_request('GET', 'grid_data_sources?name=eq.blm_row&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print("ERROR: blm_row data source not found.")
    sys.exit(1)


def fetch_blm_features(offset=0, batch_size=1000):
    """Fetch BLM ROW features — filter for power transmission ROWs.

    Key fields (from API investigation):
    - CMMDTY: Commodity ('TRANSMISSION LINE', 'DISTRIBUTION LINE', 'OTHER ENERGY FACILITIES')
    - BLM_PROD: Product detail (mixed case, contains 'POWER TRANSMISSION', 'Power Transmission', 'Power Line')
    - CSE_DISP: Disposition status ('Authorized', 'Pending', 'Closed')
    - CSE_NR: Case serial number (unique ID)
    - CUST_NM_SEC: Business account name (ROW holder / utility)
    - ADMIN_STATE: Administrative state code
    """
    # Strategy B: High-confidence power transmission + distribution ROWs
    where = (
        "(CMMDTY IN ('TRANSMISSION LINE', 'DISTRIBUTION LINE') "
        "AND BLM_PROD NOT LIKE '%TELEPHONE%' AND BLM_PROD NOT LIKE '%TELEGRAPH%') "
        f"AND ADMIN_STATE IN ({','.join(repr(s) for s in TARGET_STATES)})"
    )
    params = {
        'where': where,
        'outFields': '*',
        'outSR': '4326',
        'f': 'json',
        'resultOffset': offset,
        'resultRecordCount': batch_size,
    }
    url = f"{BLM_ROW_URL}/query?{urllib.parse.urlencode(params)}"

    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                return data.get('features', []), data.get('exceededTransferLimit', False)
        except Exception as e:
            if attempt < 2:
                print(f"  Fetch error: {e}, retrying...")
                time.sleep(2 ** attempt)
                continue
            raise


def geometry_to_wkt(geom):
    """Convert ArcGIS geometry to WKT."""
    if not geom:
        return None

    # Point geometry
    if 'x' in geom and 'y' in geom:
        return f"POINT({geom['x']} {geom['y']})"

    # Polygon geometry
    if 'rings' in geom:
        rings = []
        for ring in geom['rings']:
            coords = ', '.join(f"{p[0]} {p[1]}" for p in ring)
            rings.append(f"({coords})")
        if len(rings) == 1:
            return f"POLYGON({rings[0]})"
        return f"POLYGON({', '.join(rings)})"

    # Polyline geometry
    if 'paths' in geom:
        if len(geom['paths']) == 1:
            coords = ', '.join(f"{p[0]} {p[1]}" for p in geom['paths'][0])
            return f"LINESTRING({coords})"
        lines = []
        for path in geom['paths']:
            coords = ', '.join(f"{p[0]} {p[1]}" for p in path)
            lines.append(f"({coords})")
        return f"MULTILINESTRING({', '.join(lines)})"

    return None


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a'):
        return None
    return s[:max_len]


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def feature_to_record(feature, data_source_id):
    attrs = feature.get('attributes', {})
    geom = feature.get('geometry', {})

    case_id = safe_str(attrs.get('CSE_NR') or attrs.get('OBJECTID'))
    source_id = f"blm_row_{case_id}"

    return {
        'source_record_id': source_id,
        'blm_case_id': case_id,
        'holder_name': safe_str(attrs.get('CUST_NM_SEC')),
        'commodity': safe_str(attrs.get('CMMDTY')),
        'product': safe_str(attrs.get('BLM_PROD')),
        'disposition': safe_str(attrs.get('CSE_DISP')),
        'width_ft': safe_float(attrs.get('CSE_WIDTH')),
        'length_ft': safe_float(attrs.get('CSE_LGTH')),
        'acreage': safe_float(attrs.get('RCRD_ACRS')),
        'state': safe_str(attrs.get('ADMIN_STATE') or attrs.get('GEO_STATE')),
        'county': safe_str(attrs.get('COUNTY')),
        'plss_description': safe_str(attrs.get('CSE_NAME'), max_len=1000),
        'geometry_wkt': geometry_to_wkt(geom),
        'data_source_id': data_source_id,
        'created_at': datetime.now(timezone.utc).isoformat(),
    }


def get_existing_ids():
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_blm_row?select=source_record_id&limit=1000&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    return existing


def main():
    print("=" * 60)
    print("GridScout BLM Right-of-Way Ingestion")
    print("=" * 60)

    data_source_id = get_data_source_id()
    print(f"Data source ID: {data_source_id}")

    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing records")

    total_fetched = 0
    total_created = 0
    total_errors = 0
    offset = 0

    while True:
        features, has_more = fetch_blm_features(offset)
        if not features:
            break

        records = []
        for f in features:
            total_fetched += 1
            rec = feature_to_record(f, data_source_id)
            if rec['source_record_id'] in existing_ids:
                continue
            records.append(rec)
            existing_ids.add(rec['source_record_id'])

        # Insert in batches
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                supabase_request('POST', 'grid_blm_row', batch, {'Prefer': 'return=minimal'})
                total_created += len(batch)
            except Exception as e:
                print(f"  Batch error: {e}")
                for rec in batch:
                    try:
                        supabase_request('POST', 'grid_blm_row', [rec], {'Prefer': 'return=minimal'})
                        total_created += 1
                    except:
                        total_errors += 1

        print(f"  Fetched {total_fetched}, created {total_created}, errors {total_errors}")

        if not has_more:
            break
        offset += len(features)
        time.sleep(1)

    # Update data source
    supabase_request(
        'PATCH',
        'grid_data_sources?name=eq.blm_row',
        {
            'record_count': total_created + len(existing_ids) - total_created,
            'last_import': datetime.now(timezone.utc).isoformat()
        }
    )

    print(f"\n{'=' * 60}")
    print(f"BLM ROW Ingestion Complete")
    print(f"  Fetched: {total_fetched}")
    print(f"  Created: {total_created}")
    print(f"  Errors: {total_errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

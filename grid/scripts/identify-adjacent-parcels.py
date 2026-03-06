#!/usr/bin/env python3
"""
Identify land parcels adjacent to upgrade-candidate transmission lines.

For each upgrade candidate line (50-100 MW capacity) in grid_transmission_lines:
1. Get the line's geometry_wkt (LINESTRING)
2. Sample points along the line (every ~1 mile)
3. For each sampled point, query public ArcGIS parcel endpoints to find nearby parcels
4. Insert matched parcels into grid_parcels table

Uses the same ArcGIS parcel endpoint patterns as solar/scripts/enrich-parcel-owners.py.

Usage:
  python3 -u scripts/identify-adjacent-parcels.py                  # All states with endpoints
  python3 -u scripts/identify-adjacent-parcels.py --state TX       # Single state
  python3 -u scripts/identify-adjacent-parcels.py --limit 10       # Limit lines to process
  python3 -u scripts/identify-adjacent-parcels.py --dry-run        # Preview without inserting
  python3 -u scripts/identify-adjacent-parcels.py --list           # Show endpoints + candidate counts
"""

import os
import sys
import json
import math
import time
import re
import ssl
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

# Load env vars
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or '').strip()
SUPABASE_KEY = (os.environ.get('SUPABASE_SERVICE_KEY') or '').strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50
ARCGIS_TIMEOUT = 30
ARCGIS_WORKERS = 3          # Parallel ArcGIS queries (conservative)
SUPABASE_WORKERS = 10       # Parallel Supabase inserts
PAGE_SIZE = 1000
SAMPLE_INTERVAL_MILES = 1.0  # Sample a point every ~1 mile along the line
PARCEL_SEARCH_RADIUS_DEG = 0.005  # ~500 meters bounding box half-width

# Degrees per mile at mid-latitudes (~35-40N)
DEG_PER_MILE_LAT = 1.0 / 69.0  # ~0.0145 degrees
DEG_PER_MILE_LON = 1.0 / 54.6  # ~0.0183 degrees (varies by latitude)


# ---------------------------------------------------------------------------
# ArcGIS Parcel Endpoint Registry
# ---------------------------------------------------------------------------
# Each endpoint: url, owner_field, extra_fields (list of field names to extract),
# type (MapServer/FeatureServer), use_envelope (bool), ssl_skip (bool),
# acreage_field, parcel_id_field, address_field, city_field, zip_field

PARCEL_ENDPOINTS = {
    "TX": {
        "statewide": {
            "url": "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0",
            "owner_field": "owner_name",
            "parcel_id_field": "prop_id",
            "acreage_field": "legal_area",  # Text field like "15.9688 AC" — needs parsing
            "address_field": "situs_addr",
            "city_field": "situs_city",
            "zip_field": "situs_zip",
            "type": "MapServer",
            "use_envelope": True,
            "note": "TX statewide TNRIS parcels (stratmap most_recent). All 254 counties.",
        },
    },
    "NV": {
        # Clark County owner names redacted from ALL public ArcGIS services.
        # mapdata.lasvegasnevada.gov is dead (404), sandgate.clarkcountynv.gov DNS gone.
    },
    "AZ": {
        "maricopa": {
            "url": "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0",
            "owner_field": "OWNER_NAME",
            "parcel_id_field": "APN",
            "acreage_field": "LAND_SIZE",  # Square feet, not acres
            "address_field": "PHYSICAL_ADDRESS",
            "city_field": "PHYSICAL_CITY",
            "zip_field": "PHYSICAL_ZIP",
            "type": "MapServer",
            "use_envelope": True,
            "county": "MARICOPA",
            "note": "Maricopa County (Phoenix metro). ~60% of AZ installations.",
        },
    },
    "NM": {
        "bernalillo": {
            "url": "https://coagisweb.cabq.gov/arcgis/rest/services/public/BernCoParcels/MapServer/0",
            "owner_field": "OWNER",
            "parcel_id_field": "UPC",
            "acreage_field": "ACREAGE",
            "address_field": "SITUSADD",
            "city_field": "SITUSCITY",
            "zip_field": "SITUSZIP",
            "type": "MapServer",
            "use_envelope": True,
            "county": "BERNALILLO",
            "note": "Bernalillo County (Albuquerque).",
        },
        "las_cruces": {
            "url": "https://maps.las-cruces.org/gis/rest/services/AccelaAPO/MapServer/3",
            "owner_field": "NAME_1",
            "parcel_id_field": "Account_Num",
            "acreage_field": None,
            "address_field": "MailADDRESS1",  # Mailing address, not situs
            "city_field": "CITY",
            "zip_field": "ZIP",
            "type": "MapServer",
            "use_envelope": True,
            "county": "DONA ANA",
            "note": "Las Cruces city (Dona Ana County).",
        },
    },
    "CA": {
        "san_diego": {
            "url": "https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/FeatureServer/0",
            "owner_field": "OWN_NAME1",
            "parcel_id_field": "APN_8",
            "acreage_field": "ACREAGE",
            "address_field": "SITUS_ADDR",
            "city_field": "SITUS_CITY",
            "zip_field": "SITUS_ZIP",
            "type": "FeatureServer",
            "use_envelope": True,
            "county": "SAN DIEGO",
            "note": "San Diego County (~1.09M parcels). Envelope required.",
        },
    },
    "CO": {
        "arapahoe": {
            "url": "https://gis.arapahoegov.com/arcgis/rest/services/ACDA/ACDA/FeatureServer/0",
            "owner_field": "Owner",
            "parcel_id_field": "PARCEL_ID",
            "acreage_field": "GIS_AREA",  # Square feet, not acres
            "address_field": "Situs_Address",
            "city_field": None,  # Situs_City_State_Zip is combined
            "zip_field": None,
            "type": "FeatureServer",
            "use_envelope": True,
            "county": "ARAPAHOE",
            "note": "Arapahoe County (Littleton/Centennial). CO has 0 upgrade candidates.",
        },
    },
    "UT": {
        "utah_county": {
            "url": "https://maps.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcels/MapServer/2",
            "owner_field": "OWNER_NAME",
            "parcel_id_field": "PARCELID",
            "acreage_field": "ACREAGE",
            "address_field": "SITE_FULL_ADDRESS",
            "city_field": "SITE_CITY",
            "zip_field": "SITE_ZIP5",
            "type": "MapServer",
            "use_envelope": True,
            "county": "UTAH",
            "note": "Utah County (Provo/Orem). UGRC statewide lacks owner names.",
        },
    },
    "WY": {
        # No statewide parcel endpoint discovered yet
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers (with retry)
# ---------------------------------------------------------------------------

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


def fetch_all(table, select, filters=''):
    """Paginated fetch of all records from a table."""
    records = []
    offset = 0
    while True:
        path = f'{table}?select={select}&limit={PAGE_SIZE}&offset={offset}'
        if filters:
            path += '&' + filters
        result = supabase_request('GET', path)
        if not result:
            break
        records.extend(result)
        if len(result) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return records


def get_or_create_data_source():
    """Get or create the parcel data source entry."""
    result = supabase_request('GET', 'grid_data_sources?name=eq.arcgis_parcels&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    # Create it
    supabase_request(
        'POST',
        'grid_data_sources',
        [{
            'name': 'arcgis_parcels',
            'url': 'https://services1.arcgis.com/',
            'description': 'Adjacent parcel data from public ArcGIS parcel endpoints (county/state level)',
        }],
        {'Prefer': 'return=representation'}
    )
    result = supabase_request('GET', 'grid_data_sources?name=eq.arcgis_parcels&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print("ERROR: Could not create arcgis_parcels data source")
    sys.exit(1)


def get_existing_parcel_ids():
    """Load existing source_record_ids from grid_parcels to avoid duplicates."""
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_parcels?select=source_record_id&limit={PAGE_SIZE}&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return existing


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def parse_wkt_coords(wkt):
    """Extract all coordinate pairs from a WKT LINESTRING or MULTILINESTRING.
    Returns list of (lon, lat) tuples.
    """
    if not wkt:
        return []
    try:
        pairs = re.findall(r'(-?\d+\.?\d*)\s+(-?\d+\.?\d*)', wkt)
        return [(float(p[0]), float(p[1])) for p in pairs]
    except Exception:
        return []


def haversine_miles(lat1, lon1, lat2, lon2):
    """Haversine distance in miles between two WGS84 points."""
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(min(1.0, math.sqrt(a)))


def haversine_feet(lat1, lon1, lat2, lon2):
    """Haversine distance in feet between two WGS84 points."""
    return haversine_miles(lat1, lon1, lat2, lon2) * 5280


def sample_points_along_line(coords, interval_miles=SAMPLE_INTERVAL_MILES):
    """Sample points along a polyline at approximately `interval_miles` intervals.

    coords: list of (lon, lat) tuples from WKT
    Returns: list of (lat, lon) tuples (note: lat/lon order for ArcGIS queries)
    """
    if not coords or len(coords) < 2:
        return []

    points = []
    # Always include the first point
    points.append((coords[0][1], coords[0][0]))

    accumulated_miles = 0.0

    for i in range(1, len(coords)):
        lon1, lat1 = coords[i - 1]
        lon2, lat2 = coords[i]
        segment_miles = haversine_miles(lat1, lon1, lat2, lon2)

        if segment_miles == 0:
            continue

        accumulated_miles += segment_miles

        # Emit a sample point every interval_miles
        while accumulated_miles >= interval_miles:
            # Interpolate position along segment
            overshoot = accumulated_miles - interval_miles
            ratio = 1.0 - (overshoot / segment_miles) if segment_miles > 0 else 1.0
            ratio = max(0.0, min(1.0, ratio))

            sample_lat = lat1 + ratio * (lat2 - lat1)
            sample_lon = lon1 + ratio * (lon2 - lon1)
            points.append((sample_lat, sample_lon))

            accumulated_miles -= interval_miles

    # Always include the last point
    last_lat, last_lon = coords[-1][1], coords[-1][0]
    if not points or (abs(points[-1][0] - last_lat) > 0.0001 or abs(points[-1][1] - last_lon) > 0.0001):
        points.append((last_lat, last_lon))

    return points


def min_distance_to_line_ft(lat, lon, line_coords):
    """Minimum distance in feet from a point to any vertex of the line."""
    if not line_coords:
        return float('inf')
    min_d = float('inf')
    for llon, llat in line_coords:
        d = haversine_feet(lat, lon, llat, llon)
        if d < min_d:
            min_d = d
    return round(min_d, 2)


# ---------------------------------------------------------------------------
# ArcGIS query helpers
# ---------------------------------------------------------------------------

def arcgis_envelope_query(endpoint_url, lat, lng, out_fields, timeout=ARCGIS_TIMEOUT,
                          ssl_skip=False, max_records=10):
    """Query an ArcGIS parcel layer with an envelope bounding box.

    Returns list of feature attribute dicts, or empty list.
    Bounding box is ~500 meters around the point.
    """
    d = PARCEL_SEARCH_RADIUS_DEG  # ~500 meters
    params = {
        "geometry": f"{lng - d},{lat - d},{lng + d},{lat + d}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
        "returnGeometry": "true",
        "returnCentroid": "true",
        "resultRecordCount": str(max_records),
        "f": "json",
    }

    query_url = f"{endpoint_url}/query?" + urllib.parse.urlencode(params, safe=',')

    ctx = None
    if ssl_skip:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    for attempt in range(3):
        try:
            req = urllib.request.Request(query_url, headers={
                "User-Agent": "GridScout/1.0",
                "Referer": "https://hyder.me",
            })
            if ctx:
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    data = json.loads(resp.read().decode())
            else:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = json.loads(resp.read().decode())

            if 'error' in data:
                return []

            return data.get("features", [])

        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError,
                json.JSONDecodeError, ConnectionResetError, OSError) as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                return []

    return []


def get_feature_centroid(feature):
    """Extract approximate centroid from ArcGIS feature geometry.

    Returns (lat, lon) or (None, None).
    """
    geom = feature.get("geometry")
    if not geom:
        return None, None

    # Check for centroid field (some services support returnCentroid)
    centroid = feature.get("centroid")
    if centroid:
        return centroid.get("y"), centroid.get("x")

    # For polygon rings, average all vertices
    rings = geom.get("rings")
    if rings:
        all_x = []
        all_y = []
        for ring in rings:
            for point in ring:
                if len(point) >= 2:
                    all_x.append(point[0])
                    all_y.append(point[1])
        if all_x and all_y:
            return sum(all_y) / len(all_y), sum(all_x) / len(all_x)

    # For point geometry
    x = geom.get("x")
    y = geom.get("y")
    if x is not None and y is not None:
        return y, x

    return None, None


def clean_owner_name(name):
    """Clean and normalize an owner name string."""
    if not name:
        return None
    s = str(name).strip()
    if not s or s.upper() in ('', 'NONE', 'NULL', 'UNKNOWN', 'N/A', 'NA', 'OWNER OF RECORD',
                               'NOT AVAILABLE', '-', '--', 'TBD', 'PENDING'):
        return None
    # Title case if all caps
    if s == s.upper() and len(s) > 3:
        s = s.title()
    return s


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


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------

def query_parcels_for_point(lat, lon, endpoint_config):
    """Query ArcGIS endpoint for parcels near a point.

    Returns list of dicts with: owner_name, parcel_id, acreage, address,
    city, zip_code, latitude, longitude.
    """
    url = endpoint_config['url']
    owner_field = endpoint_config['owner_field']
    ssl_skip = endpoint_config.get('ssl_skip', False)

    # Build outFields list
    fields = [owner_field]
    for field_key in ('parcel_id_field', 'acreage_field', 'address_field', 'city_field', 'zip_field'):
        fval = endpoint_config.get(field_key)
        if fval:
            fields.append(fval)

    out_fields = ','.join(fields)

    features = arcgis_envelope_query(url, lat, lon, out_fields, ssl_skip=ssl_skip)
    if not features:
        return []

    results = []
    seen_parcel_ids = set()

    for feature in features:
        attrs = feature.get('attributes', {})

        owner_name = clean_owner_name(attrs.get(owner_field))
        if not owner_name:
            continue

        pid_field = endpoint_config.get('parcel_id_field')
        parcel_id = safe_str(attrs.get(pid_field)) if pid_field else None

        # Skip duplicates within same query (overlapping envelopes)
        dedup_key = parcel_id or f"{owner_name}_{lat:.5f}_{lon:.5f}"
        if dedup_key in seen_parcel_ids:
            continue
        seen_parcel_ids.add(dedup_key)

        acreage_field = endpoint_config.get('acreage_field')
        acreage = safe_float(attrs.get(acreage_field)) if acreage_field else None

        addr_field = endpoint_config.get('address_field')
        address = safe_str(attrs.get(addr_field)) if addr_field else None

        city_field = endpoint_config.get('city_field')
        city = safe_str(attrs.get(city_field)) if city_field else None

        zip_field = endpoint_config.get('zip_field')
        zip_code = safe_str(attrs.get(zip_field)) if zip_field else None

        # Get parcel centroid from geometry
        plat, plon = get_feature_centroid(feature)
        if plat is None:
            # Use query point as fallback
            plat, plon = lat, lon

        results.append({
            'owner_name': owner_name,
            'parcel_id': parcel_id,
            'acreage': acreage,
            'address': address,
            'city': city,
            'zip_code': zip_code,
            'latitude': round(plat, 7) if plat else None,
            'longitude': round(plon, 7) if plon else None,
        })

    return results


def process_line(line, endpoint_config, state, line_coords, existing_ids, data_source_id, dry_run=False):
    """Process one transmission line: sample points, query parcels, build records.

    Returns list of grid_parcels records ready for insertion.
    """
    line_id = line['id']
    line_voltage = line.get('voltage_kv')
    line_capacity = line.get('capacity_mw')
    line_owner = line.get('owner')

    # Sample points along the line
    sample_points = sample_points_along_line(line_coords, SAMPLE_INTERVAL_MILES)
    if not sample_points:
        return []

    all_parcels = []
    seen_source_ids = set()

    for sample_lat, sample_lon in sample_points:
        parcels = query_parcels_for_point(sample_lat, sample_lon, endpoint_config)

        for parcel in parcels:
            pid = parcel.get('parcel_id')
            plat = parcel.get('latitude')
            plon = parcel.get('longitude')

            # Build unique source_record_id
            if pid:
                source_record_id = f"parcel_{state.lower()}_{pid}"
            else:
                # Fallback: use lat/lon hash
                source_record_id = f"parcel_{state.lower()}_{plat:.5f}_{plon:.5f}"

            # Skip if already in DB or already seen in this run
            if source_record_id in existing_ids or source_record_id in seen_source_ids:
                continue
            seen_source_ids.add(source_record_id)

            # Calculate distance from parcel centroid to nearest point on line
            if plat is not None and plon is not None:
                distance_ft = min_distance_to_line_ft(plat, plon, line_coords)
            else:
                distance_ft = None

            # Determine county from endpoint config or parcel data
            county = endpoint_config.get('county') or parcel.get('county')

            record = {
                'source_record_id': source_record_id,
                'transmission_line_id': line_id,
                'owner_name': parcel['owner_name'],
                'parcel_id': parcel.get('parcel_id'),
                'acreage': parcel.get('acreage'),
                'address': parcel.get('address'),
                'city': parcel.get('city'),
                'state': state,
                'county': county,
                'zip_code': parcel.get('zip_code'),
                'land_type': 'private',  # ArcGIS parcel data is mostly private land
                'latitude': plat,
                'longitude': plon,
                'line_voltage_kv': line_voltage,
                'line_capacity_mw': line_capacity,
                'line_owner': line_owner,
                'distance_from_line_ft': distance_ft,
                'in_section_368': False,
                'in_nietc': False,
                'in_blm_solar_dla': False,
                'data_source_id': data_source_id,
            }
            all_parcels.append(record)

        # Rate limit ArcGIS queries
        time.sleep(0.3)

    return all_parcels


def insert_parcels(records, existing_ids):
    """Insert parcel records into grid_parcels. Returns (inserted, errors)."""
    inserted = 0
    errors = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            supabase_request(
                'POST',
                'grid_parcels',
                batch,
                {'Prefer': 'return=minimal'}
            )
            inserted += len(batch)
            for r in batch:
                existing_ids.add(r['source_record_id'])
        except Exception as e:
            # Fallback: insert one by one
            for rec in batch:
                try:
                    supabase_request(
                        'POST',
                        'grid_parcels',
                        [rec],
                        {'Prefer': 'return=minimal'}
                    )
                    inserted += 1
                    existing_ids.add(rec['source_record_id'])
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"    Record error ({rec['source_record_id']}): {e2}")

    return inserted, errors


# ---------------------------------------------------------------------------
# Corridor overlap check
# ---------------------------------------------------------------------------

def check_corridor_overlaps(records, corridors):
    """Check if parcels fall within energy corridors (Section 368, NIETC, BLM Solar DLA).

    Uses simple bounding box approach — checks if parcel lat/lon is within corridor bbox.
    For more precise checks, PostGIS ST_Within would be needed.

    corridors: list of dicts with corridor_type, geometry_wkt
    """
    if not corridors:
        return

    # Parse corridor bounding boxes
    corridor_bboxes = []
    for c in corridors:
        coords = parse_wkt_coords(c.get('geometry_wkt', ''))
        if not coords:
            continue
        lons = [p[0] for p in coords]
        lats = [p[1] for p in coords]
        corridor_bboxes.append({
            'type': c.get('corridor_type'),
            'min_lat': min(lats),
            'max_lat': max(lats),
            'min_lon': min(lons),
            'max_lon': max(lons),
        })

    if not corridor_bboxes:
        return

    flagged = 0
    for record in records:
        lat = record.get('latitude')
        lon = record.get('longitude')
        if lat is None or lon is None:
            continue

        for cb in corridor_bboxes:
            if cb['min_lat'] <= lat <= cb['max_lat'] and cb['min_lon'] <= lon <= cb['max_lon']:
                ctype = cb['type']
                if ctype == 'section_368':
                    record['in_section_368'] = True
                elif ctype == 'nietc':
                    record['in_nietc'] = True
                elif ctype == 'blm_solar_dla':
                    record['in_blm_solar_dla'] = True
                flagged += 1

    return flagged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Identify parcels adjacent to upgrade-candidate transmission lines')
    parser.add_argument('--state', type=str, help='Process single state (e.g., TX)')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of lines to process (0=all)')
    parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
    parser.add_argument('--list', action='store_true', help='Show available endpoints and candidate counts')
    args = parser.parse_args()

    print("=" * 60)
    print("GridScout Adjacent Parcel Identification")
    print("=" * 60)

    # --list mode: show endpoints and counts
    if args.list:
        print("\nConfigured ArcGIS parcel endpoints:")
        print(f"{'State':<6} {'Endpoint':<20} {'Note'}")
        print("-" * 70)
        for state, endpoints in sorted(PARCEL_ENDPOINTS.items()):
            for name, cfg in endpoints.items():
                note = cfg.get('note', '')[:50]
                print(f"  {state:<4} {name:<20} {note}")

        print("\nUpgrade candidate lines per state:")
        for state in sorted(PARCEL_ENDPOINTS.keys()):
            if not PARCEL_ENDPOINTS[state]:
                continue
            result = supabase_request(
                'GET',
                f'grid_transmission_lines?select=id&state=eq.{state}'
                f'&upgrade_candidate=eq.true&limit=1',
                headers_extra={'Prefer': 'count=exact', 'Range': '0-0'}
            )
            # We can't get exact count this way easily, so just count them
            lines = fetch_all(
                'grid_transmission_lines',
                'id',
                f'state=eq.{state}&upgrade_candidate=eq.true'
            )
            print(f"  {state}: {len(lines)} upgrade candidates (50-100 MW)")

        return

    # Determine which states to process
    if args.state:
        state_filter = args.state.upper()
        if state_filter not in PARCEL_ENDPOINTS:
            print(f"Error: No parcel endpoints configured for state {state_filter}")
            print(f"Available: {', '.join(sorted(k for k, v in PARCEL_ENDPOINTS.items() if v))}")
            sys.exit(1)
        if not PARCEL_ENDPOINTS[state_filter]:
            print(f"Error: No parcel endpoints configured for state {state_filter}")
            sys.exit(1)
        states_to_process = [state_filter]
    else:
        states_to_process = [s for s in sorted(PARCEL_ENDPOINTS.keys()) if PARCEL_ENDPOINTS[s]]

    # Get data source ID
    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    # Load existing parcel IDs to avoid duplicates
    print("Loading existing parcel records...")
    existing_ids = get_existing_parcel_ids()
    print(f"  {len(existing_ids)} existing parcels in DB")

    # Load corridors for overlap flagging
    print("Loading energy corridors...")
    corridors = fetch_all(
        'grid_corridors',
        'corridor_type,geometry_wkt',
    )
    print(f"  {len(corridors)} corridors loaded")

    total_lines_processed = 0
    total_parcels_found = 0
    total_inserted = 0
    total_errors = 0
    total_corridor_flags = 0

    for state in states_to_process:
        endpoints = PARCEL_ENDPOINTS[state]
        if not endpoints:
            continue

        print(f"\n{'='*60}")
        print(f"Processing {state}")
        print(f"{'='*60}")

        # Load upgrade candidate lines for this state
        print(f"  Loading upgrade candidate lines for {state}...")
        lines = fetch_all(
            'grid_transmission_lines',
            'id,hifld_id,voltage_kv,capacity_mw,owner,state,geometry_wkt',
            f'state=eq.{state}&upgrade_candidate=eq.true'
        )

        if not lines:
            print(f"  No upgrade candidate lines found for {state}, skipping")
            continue

        if args.limit > 0:
            lines = lines[:args.limit]

        print(f"  {len(lines)} upgrade candidate lines to process")

        # Filter lines that have geometry
        lines_with_geom = [l for l in lines if l.get('geometry_wkt')]
        if len(lines_with_geom) < len(lines):
            print(f"  Warning: {len(lines) - len(lines_with_geom)} lines have no geometry, skipping those")
        lines = lines_with_geom

        if not lines:
            continue

        # Use the first available endpoint for this state
        # (prefer county-specific if line is in that county, otherwise use statewide)
        endpoint_name = None
        endpoint_config = None

        # For simplicity, pick the best endpoint. If statewide exists, use it.
        # Otherwise use the first county endpoint.
        if 'statewide' in endpoints:
            endpoint_name = 'statewide'
            endpoint_config = endpoints['statewide']
        else:
            endpoint_name = list(endpoints.keys())[0]
            endpoint_config = endpoints[endpoint_name]

        print(f"  Using endpoint: {state}/{endpoint_name}")
        print(f"    URL: {endpoint_config['url'][:80]}...")

        state_parcels_found = 0
        state_inserted = 0
        state_errors = 0

        for li, line in enumerate(lines):
            line_coords = parse_wkt_coords(line.get('geometry_wkt', ''))
            if not line_coords:
                continue

            line_length_approx = 0
            for j in range(1, len(line_coords)):
                line_length_approx += haversine_miles(
                    line_coords[j-1][1], line_coords[j-1][0],
                    line_coords[j][1], line_coords[j][0]
                )

            sample_points = sample_points_along_line(line_coords, SAMPLE_INTERVAL_MILES)

            print(f"  Line {li+1}/{len(lines)}: id={line['id'][:8]}... "
                  f"voltage={line.get('voltage_kv')}kV capacity={line.get('capacity_mw')}MW "
                  f"owner={(line.get('owner') or 'unknown')[:30]} "
                  f"length~{line_length_approx:.1f}mi samples={len(sample_points)}")

            # Query parcels for all sample points along this line
            parcels = process_line(
                line, endpoint_config, state, line_coords,
                existing_ids, data_source_id, dry_run=args.dry_run
            )

            if parcels:
                # Check corridor overlaps
                flags = check_corridor_overlaps(parcels, corridors) or 0
                total_corridor_flags += flags

                state_parcels_found += len(parcels)

                if args.dry_run:
                    for p in parcels[:3]:
                        print(f"    [DRY RUN] parcel={p.get('parcel_id', 'N/A')}, "
                              f"owner={p.get('owner_name', 'N/A')[:40]}, "
                              f"acreage={p.get('acreage', 'N/A')}, "
                              f"dist={p.get('distance_from_line_ft', 'N/A')}ft")
                    if len(parcels) > 3:
                        print(f"    ... and {len(parcels) - 3} more parcels")
                else:
                    ins, err = insert_parcels(parcels, existing_ids)
                    state_inserted += ins
                    state_errors += err
            else:
                print(f"    No parcels found")

            total_lines_processed += 1

        total_parcels_found += state_parcels_found
        total_inserted += state_inserted
        total_errors += state_errors

        print(f"\n  {state} summary: {state_parcels_found} parcels found, "
              f"{state_inserted} inserted, {state_errors} errors")

    # Update data source record count
    if not args.dry_run and total_inserted > 0:
        total_in_db = len(existing_ids)
        supabase_request(
            'PATCH',
            'grid_data_sources?name=eq.arcgis_parcels',
            {
                'record_count': total_in_db,
                'last_import': datetime.now(timezone.utc).isoformat(),
            }
        )

    # Final summary
    print(f"\n{'='*60}")
    print("Adjacent Parcel Identification Complete")
    print(f"{'='*60}")
    print(f"  States processed:     {len(states_to_process)}")
    print(f"  Lines processed:      {total_lines_processed}")
    print(f"  Parcels found:        {total_parcels_found}")
    if args.dry_run:
        print(f"  [DRY RUN — no records inserted]")
    else:
        print(f"  Parcels inserted:     {total_inserted}")
        print(f"  Errors:               {total_errors}")
        print(f"  Total in DB:          {len(existing_ids)}")
    print(f"  Corridor flags:       {total_corridor_flags}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Ingest BLM Solar Designated Leasing Areas (DLAs), DRECP Development Focus Areas,
AZ Renewable Energy Development Areas, and WGA WREZ zones as greenfield DC
candidate sites into grid_dc_sites.

These are federally designated zones on public land specifically set aside for
solar/renewable energy development — ideal greenfield locations for DC siting
due to guaranteed permitting pathways, existing environmental review, and
proximity to transmission infrastructure.

Data Sources (all BLM ArcGIS MapServer):
  Layer 1: BLM Solar DLAs (~45 zones across AZ, CA, CO, NV, NM, UT)
  Layer 2: AZ Renewable Energy Dev Areas (~28 areas in AZ)
  Layer 3: DRECP Development Focus Areas (~171 areas in CA)
  Layer 4: WGA Western Renewable Energy Zones (~53 zones across western states)

Also queries the Energy Designations FeatureServer (Layer 10) for the original
BLM DLA zones with developable status and polygon-merge logic.

Usage:
    python3 -u scripts/ingest-blm-solar-dla.py                 # All sources
    python3 -u scripts/ingest-blm-solar-dla.py --source blm    # BLM DLAs only
    python3 -u scripts/ingest-blm-solar-dla.py --source drecp  # DRECP only
    python3 -u scripts/ingest-blm-solar-dla.py --source az     # AZ REDAs only
    python3 -u scripts/ingest-blm-solar-dla.py --source wrez   # WGA WREZ only
    python3 -u scripts/ingest-blm-solar-dla.py --dry-run       # Preview without inserting
"""

import os
import sys
import json
import math
import time
import argparse
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
SQ_M_PER_ACRE = 4046.8564224

BLM_MAPSERVER_BASE = "https://gis.blm.gov/arcgis/rest/services/energy/BLM_ES_SolarEnergy/MapServer"

# Also keep the original Energy Designations FeatureServer for BLM DLAs
BLM_FEATURESERVER_URL = (
    "https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/"
    "Energy_Designations/FeatureServer/10"
)

# State office name -> abbreviation (for FeatureServer zone data)
STATE_OFFICE_MAP = {
    'California': 'CA',
    'Colorado': 'CO',
    'Nevada': 'NV',
    'New Mexico': 'NM',
    'Arizona': 'AZ',
    'Utah': 'UT',
    'Oregon': 'OR',
    'Wyoming': 'WY',
    'Idaho': 'ID',
    'Montana': 'MT',
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

# Source configurations for the BLM MapServer layers
SOURCES = {
    'blm': {
        'label': 'BLM Solar Designated Leasing Areas',
        'layer': 1,
        'prefix': 'blm_dla_',
        'name_fields': ['DLA_NAME', 'NAME', 'AREA_NAME', 'ZONE_NAME', 'LABEL'],
        'state_fields': ['STATE_CODE', 'STATE', 'ST', 'STATE_ABBR'],
        'county_fields': ['COUNTY'],
        'acres_fields': ['ACRES', 'GIS_ACRES', 'TOTAL_ACRES'],
        'default_state': None,
        'site_name_prefix': 'BLM Solar DLA',
        'use_featureserver': True,  # Also try the FeatureServer for merged zone logic
    },
    'drecp': {
        'label': 'DRECP Development Focus Areas',
        'layer': 3,
        'prefix': 'drecp_',
        'name_fields': ['DFA_NAME', 'NAME', 'AREA_NAME', 'LABEL', 'DESIGNATION'],
        'state_fields': [],
        'county_fields': ['COUNTY'],
        'acres_fields': ['ACRES', 'GIS_ACRES', 'TOTAL_ACRES'],
        'default_state': 'CA',
        'site_name_prefix': 'DRECP DFA',
    },
    'az': {
        'label': 'AZ Renewable Energy Development Areas',
        'layer': 2,
        'prefix': 'az_reda_',
        'name_fields': ['REDA_NAME', 'NAME', 'AREA_NAME', 'ZONE_NAME', 'LABEL'],
        'state_fields': [],
        'county_fields': ['COUNTY'],
        'acres_fields': ['ACRES', 'GIS_ACRES', 'TOTAL_ACRES'],
        'default_state': 'AZ',
        'site_name_prefix': 'AZ REDA',
    },
    'wrez': {
        'label': 'WGA Western Renewable Energy Zones',
        'layer': 4,
        'prefix': 'wga_wrez_',
        'name_fields': ['WREZ_NAME', 'NAME', 'ZONE_NAME', 'AREA_NAME', 'LABEL'],
        'state_fields': ['STATE_CODE', 'STATE', 'ST', 'STATE_ABBR'],
        'county_fields': ['COUNTY'],
        'acres_fields': ['ACRES', 'GIS_ACRES', 'TOTAL_ACRES'],
        'default_state': None,
        'site_name_prefix': 'WGA WREZ',
    },
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


def fetch_arcgis_features(url, where='1=1', return_geometry=True):
    """Fetch all features from an ArcGIS MapServer/FeatureServer layer with pagination."""
    all_features = []
    offset = 0
    page_size = 1000

    while True:
        params = {
            'where': where,
            'outFields': '*',
            'returnGeometry': 'true' if return_geometry else 'false',
            'returnCentroid': 'true',
            'outSR': '4326',
            'f': 'json',
            'resultRecordCount': str(page_size),
            'resultOffset': str(offset),
        }
        req_url = f"{url}/query?{urllib.parse.urlencode(params)}"

        for attempt in range(3):
            try:
                req = urllib.request.Request(req_url, headers={'User-Agent': 'GridScout/1.0'})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read().decode())
                break
            except Exception as e:
                if attempt < 2:
                    print(f"  Retry {attempt + 1}: {e}")
                    time.sleep(2 ** attempt)
                    continue
                raise

        if 'error' in data:
            err = data['error']
            print(f"  ArcGIS error: code={err.get('code')}, message={err.get('message')}")
            return all_features

        features = data.get('features', [])
        if not features:
            break

        all_features.extend(features)
        print(f"  Fetched {len(all_features)} features (offset {offset})...")

        if not data.get('exceededTransferLimit', False) and len(features) < page_size:
            break

        offset += len(features)

    return all_features


def polygon_centroid(rings):
    """Calculate area-weighted centroid of a polygon (list of rings).
    First ring is exterior, subsequent rings are holes.
    Each ring is [[lng, lat], [lng, lat], ...].
    Returns (lat, lng, signed_area).
    """
    if not rings or not rings[0]:
        return None, None, 0

    ring = rings[0]
    n = len(ring)
    if n < 3:
        return None, None, 0

    sum_lat = 0.0
    sum_lng = 0.0
    sum_a = 0.0

    for i in range(n - 1):
        lng0, lat0 = ring[i]
        lng1, lat1 = ring[i + 1]
        cross = lng0 * lat1 - lng1 * lat0
        sum_a += cross
        sum_lng += (lng0 + lng1) * cross
        sum_lat += (lat0 + lat1) * cross

    if abs(sum_a) < 1e-12:
        avg_lat = sum(p[1] for p in ring) / n
        avg_lng = sum(p[0] for p in ring) / n
        return avg_lat, avg_lng, 0

    area = sum_a / 2.0
    cx_lng = sum_lng / (6.0 * area)
    cx_lat = sum_lat / (6.0 * area)
    return cx_lat, cx_lng, abs(area)


def get_centroid(feature):
    """Extract centroid lat/lng from feature.
    Try centroid field first, then calculate from geometry rings.
    """
    # Method 1: centroid field from returnCentroid=true
    centroid = feature.get('centroid')
    if centroid:
        x = centroid.get('x')
        y = centroid.get('y')
        if x is not None and y is not None and -180 <= x <= 180 and -90 <= y <= 90:
            return y, x  # lat, lng

    # Method 2: Calculate from geometry rings
    geometry = feature.get('geometry', {})
    rings = geometry.get('rings', [])
    if rings:
        lat, lng, _ = polygon_centroid(rings)
        if lat is not None and lng is not None:
            return lat, lng

    # Method 3: Simple average of all ring coordinates
    if rings:
        all_x = []
        all_y = []
        for ring in rings:
            for coord in ring:
                if len(coord) >= 2:
                    all_x.append(coord[0])
                    all_y.append(coord[1])
        if all_x and all_y:
            cx = sum(all_x) / len(all_x)
            cy = sum(all_y) / len(all_y)
            if -180 <= cx <= 180 and -90 <= cy <= 90:
                return cy, cx

    return None, None


def find_field(attrs, candidates):
    """Find the first matching field name from candidates (case-insensitive)."""
    if not attrs:
        return None
    attr_upper = {k.upper(): k for k in attrs.keys()}
    for c in candidates:
        if c and c.upper() in attr_upper:
            return attr_upper[c.upper()]
    return None


def safe_float(val):
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('null', 'none', 'n/a', 'na', '', ' '):
        return None
    return s


def find_county_for_point(lat, lng, county_index, cell_size=1.0):
    """Find the nearest county for a point using spatial grid index."""
    cell = (int(lat / cell_size), int(lng / cell_size))
    best = None
    best_dist = float('inf')
    for di in range(-2, 3):
        for dj in range(-2, 3):
            for county in county_index.get((cell[0] + di, cell[1] + dj), []):
                clat = county.get('latitude')
                clng = county.get('longitude')
                if clat and clng:
                    dist = haversine_km(lat, lng, float(clat), float(clng))
                    if dist < best_dist:
                        best_dist = dist
                        best = county
    return best


def process_featureserver_blm(existing_ids, county_index, data_source_id, dry_run):
    """Process BLM DLAs from the Energy Designations FeatureServer with polygon merge logic.
    Returns (sites_list, created, errors).
    """
    print("\n  Querying FeatureServer for developable BLM Solar DLA zones...")
    features = fetch_arcgis_features(BLM_FEATURESERVER_URL, where="status='Developable'")
    print(f"  {len(features)} developable polygons fetched from FeatureServer")

    if not features:
        return [], 0, 0

    # Merge multi-polygon zones (group by zone_name, area-weighted centroid)
    zones = {}
    for f in features:
        attrs = f.get('attributes', {})
        geom = f.get('geometry', {})
        rings = geom.get('rings', [])

        zone_name = attrs.get('zone_name', 'Unknown')
        state_office = attrs.get('stateoffice', '')
        state = STATE_OFFICE_MAP.get(state_office, '')
        area_m2 = attrs.get('Shape__Area', 0) or 0
        area_acres = area_m2 / SQ_M_PER_ACRE
        ogc_fid = attrs.get('ogc_fid')

        lat, lng, _ = polygon_centroid(rings)
        if lat is None or lng is None:
            lat, lng = get_centroid(f)
        if lat is None or lng is None:
            print(f"  WARNING: No centroid for {zone_name} (ogc_fid={ogc_fid})")
            continue

        if zone_name not in zones:
            zones[zone_name] = {
                'zone_name': zone_name,
                'state': state,
                'polygons': [],
                'total_acres': 0,
                'total_area_m2': 0,
            }

        zones[zone_name]['polygons'].append({
            'lat': lat, 'lng': lng,
            'area_m2': area_m2, 'area_acres': area_acres,
        })
        zones[zone_name]['total_acres'] += area_acres
        zones[zone_name]['total_area_m2'] += area_m2

    # Build site records with area-weighted centroids
    sites = []
    for name, z in zones.items():
        total_weight = sum(p['area_m2'] for p in z['polygons'])
        if total_weight < 1e-6:
            w_lat = sum(p['lat'] for p in z['polygons']) / len(z['polygons'])
            w_lng = sum(p['lng'] for p in z['polygons']) / len(z['polygons'])
        else:
            w_lat = sum(p['lat'] * p['area_m2'] for p in z['polygons']) / total_weight
            w_lng = sum(p['lng'] * p['area_m2'] for p in z['polygons']) / total_weight

        name_key = name.lower().replace(' ', '_').replace('-', '_')
        source_id = f"blm_dla_{name_key}"

        if source_id in existing_ids:
            continue

        county = find_county_for_point(w_lat, w_lng, county_index)
        solar_capacity_est_mw = round(z['total_acres'] / 6.0, 1)

        sites.append({
            'source_record_id': source_id,
            'name': f"BLM Solar DLA: {name}",
            'site_type': 'greenfield',
            'state': z['state'],
            'county': county['county_name'] if county else None,
            'fips_code': county['fips_code'] if county else None,
            'latitude': round(w_lat, 6),
            'longitude': round(w_lng, 6),
            'acreage': round(z['total_acres'], 1),
            'iso_region': STATE_ISO.get(z['state']),
            'former_use': 'blm_solar_dla',
            'available_capacity_mw': min(solar_capacity_est_mw, 5000),
        })

    print(f"  {len(sites)} merged zone records (from {len(features)} polygons)")
    return sites


def process_mapserver_source(source_key, config, existing_ids, county_index, dry_run):
    """Process a single MapServer layer source. Returns list of site records."""
    url = f"{BLM_MAPSERVER_BASE}/{config['layer']}"
    print(f"\n  Querying MapServer Layer {config['layer']}: {config['label']}...")
    print(f"  URL: {url}")

    try:
        features = fetch_arcgis_features(url)
    except Exception as e:
        print(f"  ERROR: Failed to fetch Layer {config['layer']}: {e}")
        return []

    if not features:
        print(f"  No features returned. Layer may be unavailable or empty.")
        return []

    print(f"  {len(features)} features fetched")

    # Discover fields from first feature
    sample_attrs = features[0].get('attributes', {})
    field_names = list(sample_attrs.keys())
    print(f"  Available fields: {field_names}")

    name_field = find_field(sample_attrs, config['name_fields'])
    state_field = find_field(sample_attrs, config['state_fields']) if config['state_fields'] else None
    county_field = find_field(sample_attrs, config['county_fields']) if config['county_fields'] else None
    acres_field = find_field(sample_attrs, config['acres_fields'])

    print(f"  Resolved: name={name_field}, state={state_field}, county={county_field}, acres={acres_field}")

    sites = []
    skipped_no_coords = 0
    skipped_existing = 0

    for feature in features:
        attrs = feature.get('attributes', {})
        oid = attrs.get('OBJECTID') or attrs.get('FID') or attrs.get('OID')

        lat, lng = get_centroid(feature)
        if lat is None or lng is None:
            skipped_no_coords += 1
            continue

        source_record_id = f"{config['prefix']}{oid}"
        if source_record_id in existing_ids:
            skipped_existing += 1
            continue

        # Extract name
        name = safe_str(attrs.get(name_field)) if name_field else None
        if not name:
            name = f"{config['label']} #{oid}"

        # Extract state
        state = None
        if state_field:
            state = safe_str(attrs.get(state_field))
        if not state:
            state = config.get('default_state')
        if state:
            state = state.upper()[:2]

        # Extract county
        county_name = safe_str(attrs.get(county_field)) if county_field else None
        if county_name:
            county_name = county_name.title()

        # Extract acreage
        acreage = safe_float(attrs.get(acres_field)) if acres_field else None
        # Try Shape__Area as fallback (m2 -> acres)
        if acreage is None:
            shape_area = safe_float(attrs.get('Shape__Area') or attrs.get('SHAPE.AREA') or attrs.get('Shape_Area'))
            if shape_area and shape_area > 0:
                acreage = shape_area / SQ_M_PER_ACRE

        # County lookup if not from attributes
        fips_code = None
        if not county_name:
            county_match = find_county_for_point(lat, lng, county_index)
            if county_match:
                county_name = county_match.get('county_name')
                fips_code = county_match.get('fips_code')
        else:
            # Look up FIPS for the county name
            county_match = find_county_for_point(lat, lng, county_index)
            if county_match:
                fips_code = county_match.get('fips_code')

        iso_region = STATE_ISO.get(state) if state else None

        # Estimate solar capacity (5-7 acres per MW)
        available_mw = None
        if acreage and acreage > 0:
            available_mw = min(round(acreage / 6.0, 1), 5000)

        site = {
            'source_record_id': source_record_id,
            'name': f"{config['site_name_prefix']}: {name}",
            'site_type': 'greenfield',
            'state': state,
            'county': county_name,
            'fips_code': fips_code,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'iso_region': iso_region,
            'acreage': round(acreage, 1) if acreage else None,
            'former_use': config['prefix'].rstrip('_'),
            'available_capacity_mw': available_mw,
        }
        sites.append(site)

    print(f"  Records to insert: {len(sites)}")
    print(f"  Skipped (no coords): {skipped_no_coords}")
    print(f"  Skipped (existing): {skipped_existing}")

    return sites


def insert_sites(sites, dry_run):
    """Insert site records into grid_dc_sites. Returns (created, errors)."""
    if not sites:
        return 0, 0

    if dry_run:
        for s in sites[:10]:
            print(f"    {s['source_record_id']}: {s['name']} ({s.get('state', '?')}) "
                  f"-- {s.get('acreage', 'N/A')} acres "
                  f"-- ({s['latitude']}, {s['longitude']})")
        if len(sites) > 10:
            print(f"    ... and {len(sites) - 10} more")
        return len(sites), 0

    # Normalize keys across entire batch (PostgREST requires all objects have same keys)
    all_keys = set()
    for rec in sites:
        all_keys.update(rec.keys())
    normalized = [{k: rec.get(k) for k in sorted(all_keys)} for rec in sites]

    created = 0
    errors = 0

    for i in range(0, len(normalized), BATCH_SIZE):
        batch = normalized[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {
                'Prefer': 'return=minimal',
            })
            created += len(batch)
            print(f"  Inserted {created}/{len(normalized)}...")
        except Exception as e:
            # Fall back to individual inserts
            print(f"  Batch error at offset {i}, falling back to individual inserts: {e}")
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_dc_sites', [rec], {
                        'Prefer': 'return=minimal',
                    })
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"    Insert error: {e2}")

    return created, errors


def main():
    parser = argparse.ArgumentParser(
        description='Ingest BLM solar energy zones (DLA, DRECP, AZ REDA, WGA WREZ) as greenfield DC sites'
    )
    parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
    parser.add_argument('--source', type=str, default='all',
                        choices=['all', 'blm', 'drecp', 'az', 'wrez'],
                        help='Which source to ingest (default: all)')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    print("=" * 60)
    print("GridScout DC: BLM Solar Energy Zone Ingestion")
    print("=" * 60)
    print(f"Started: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"Dry run: {args.dry_run}")
    print(f"Source: {args.source}")

    # Determine which sources to process
    if args.source == 'all':
        sources_to_run = list(SOURCES.keys())
    else:
        sources_to_run = [args.source]

    # Load existing source_record_ids to prevent duplicates
    print("\nLoading existing source_record_ids...")
    existing_ids = set()
    prefixes_to_check = [SOURCES[k]['prefix'] for k in sources_to_run]
    for prefix in prefixes_to_check:
        encoded_prefix = urllib.parse.quote(f"{prefix}*", safe='')
        path = f"grid_dc_sites?select=source_record_id&source_record_id=like.{encoded_prefix}&limit=10000"
        rows = supabase_request('GET', path) or []
        for row in rows:
            existing_ids.add(row['source_record_id'])
    print(f"  Found {len(existing_ids)} existing records with matching prefixes")

    # Load county data for FIPS assignment
    print("\nLoading county centroids for FIPS assignment...")
    counties = load_paginated('grid_county_data', 'fips_code,state,county_name,latitude,longitude')
    print(f"  {len(counties)} counties loaded")

    county_index = {}
    cell_size = 1.0
    for c in counties:
        lat = c.get('latitude')
        lng = c.get('longitude')
        if lat and lng:
            cell = (int(float(lat) / cell_size), int(float(lng) / cell_size))
            if cell not in county_index:
                county_index[cell] = []
            county_index[cell].append(c)

    # Process each source
    grand_total_created = 0
    grand_total_errors = 0
    source_results = {}

    for source_key in sources_to_run:
        config = SOURCES[source_key]
        print(f"\n{'='*60}")
        print(f"Source: {config['label']}")
        print(f"{'='*60}")

        all_sites = []

        # For BLM DLAs, try the FeatureServer first (has polygon merge logic)
        if source_key == 'blm' and config.get('use_featureserver'):
            fs_sites = process_featureserver_blm(existing_ids, county_index, None, args.dry_run)
            if fs_sites:
                all_sites.extend(fs_sites)
                print(f"  FeatureServer: {len(fs_sites)} merged zone records")
            else:
                print(f"  FeatureServer returned 0 records, trying MapServer...")

        # Query the MapServer layer
        ms_sites = process_mapserver_source(source_key, config, existing_ids, county_index, args.dry_run)

        # Deduplicate: if FeatureServer already provided blm_dla_ records, skip MapServer dupes
        if all_sites:
            existing_src_ids = {s['source_record_id'] for s in all_sites}
            ms_sites = [s for s in ms_sites if s['source_record_id'] not in existing_src_ids]
            if ms_sites:
                print(f"  MapServer: {len(ms_sites)} additional records (after dedup)")

        all_sites.extend(ms_sites)

        if not all_sites:
            print(f"  No records to insert for {config['label']}")
            source_results[source_key] = {'created': 0, 'errors': 0, 'total': 0}
            continue

        # State distribution
        state_counts = {}
        for s in all_sites:
            st = s.get('state', '??')
            state_counts[st] = state_counts.get(st, 0) + 1
        print(f"\n  State distribution: {dict(sorted(state_counts.items(), key=lambda x: -x[1]))}")

        # Total acreage
        total_acres = sum(s.get('acreage', 0) or 0 for s in all_sites)
        if total_acres > 0:
            print(f"  Total acreage: {total_acres:,.0f}")

        # Insert
        if args.dry_run:
            print(f"\n  [DRY RUN] Would insert {len(all_sites)} records:")
            insert_sites(all_sites, dry_run=True)
            source_results[source_key] = {'created': len(all_sites), 'errors': 0, 'total': len(all_sites)}
        else:
            print(f"\n  Inserting {len(all_sites)} records...")
            created, errors = insert_sites(all_sites, dry_run=False)
            grand_total_created += created
            grand_total_errors += errors
            source_results[source_key] = {'created': created, 'errors': errors, 'total': len(all_sites)}
            print(f"  Created: {created}, Errors: {errors}")

    # Grand summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    for key in sources_to_run:
        r = source_results.get(key, {})
        label = SOURCES[key]['label']
        if args.dry_run:
            print(f"  {label}: {r.get('total', 0)} would be created")
        else:
            print(f"  {label}: {r.get('created', 0)} created, {r.get('errors', 0)} errors")

    if args.dry_run:
        total = sum(r.get('total', 0) for r in source_results.values())
        print(f"\n  Total: {total} records would be created")
    else:
        print(f"\n  Total created: {grand_total_created}")
        print(f"  Total errors: {grand_total_errors}")

    print(f"  Completed: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")


if __name__ == '__main__':
    main()

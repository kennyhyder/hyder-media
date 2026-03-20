#!/usr/bin/env python3
"""
Ingest state-level economic development "shovel-ready" / "certified sites"
data from publicly available ArcGIS endpoints into grid_dc_sites.

Sources:
  - VEDP (Virginia): 1,754 Available Properties with DC-specific fields
  - WEDC (Wisconsin): 149 Certified Sites with parcel-level data
  - Kentucky DGI: 371 Industrial Sites (Build-ready / Shovel-ready)
  - STS Tennessee: 45 Certified Sites
  - DPC Co-ops (Wisconsin): 52 Economic Development sites with MW capacity

Usage:
  python3 -u scripts/ingest-shovel-ready.py                # Run all endpoints
  python3 -u scripts/ingest-shovel-ready.py --state VA      # Single state
  python3 -u scripts/ingest-shovel-ready.py --state VA,WI   # Multiple states
  python3 -u scripts/ingest-shovel-ready.py --dry-run       # Preview without inserting
  python3 -u scripts/ingest-shovel-ready.py --limit 50      # Limit records per endpoint
  python3 -u scripts/ingest-shovel-ready.py --list-endpoints # Show configured endpoints
"""

import os
import sys
import json
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

# macOS system Python SSL fix
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    SSL_CTX.load_verify_locations(certifi.where())
except ImportError:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
UA = 'GridScout/1.0 (shovel-ready-ingest)'

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

# ── Endpoint Configurations ──────────────────────────────────────

ENDPOINTS = [
    # ── VIRGINIA (VEDP) — Richest dataset: 1,754 properties ──
    # Has DC-specific fields: DominionCertifiedDataCenterSite, AEPQualifiedDataCenterSite
    # Also has: BusinessReadySiteCertified, ElectricSupplierPrimary, FiberBroadbandProvider,
    #           MaxElecCapacity, AcreageSuitableForConstruction, Brownfield flag
    {
        'name': 'Virginia VEDP Available Properties',
        'url': 'https://maps.vedp.org/arcgis/rest/services/OpenData/PropertiesSites/MapServer/0',
        'prefix': 'shovel_va_vedp',
        'state': 'VA',
        'server_type': 'MapServer',
        'out_sr': 4326,
        'transform': 'vedp',
    },

    # ── WISCONSIN (WEDC) — 149 Certified Sites with parcel data ──
    # Polygon geometry — use centroid. Has: Owner, Acres, County, Region,
    # Website, Contact, Email, Phone, Status, School District, Property taxes
    {
        'name': 'Wisconsin WEDC Certified Sites 2024',
        'url': 'https://services2.arcgis.com/xkpZtaTA2F05Vq7i/arcgis/rest/services/Certified_Sites_2024_WFL1/FeatureServer/0',
        'prefix': 'shovel_wi_wedc',
        'state': 'WI',
        'server_type': 'FeatureServer',
        'out_sr': 4326,
        'transform': 'wedc',
    },

    # ── KENTUCKY (DGI) — 371 Industrial Sites ──
    # Has: TYPEWEB (Build-ready/Shovel-ready), STATUSWEB, COUNTYNAME,
    #       MAXACNUM (max acreage), MAPNAME (site name), SITE_AVAIL
    {
        'name': 'Kentucky Industrial Sites',
        'url': 'https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_Industrial_Sites_Points_WM/FeatureServer/0',
        'prefix': 'shovel_ky_dgi',
        'state': 'KY',
        'server_type': 'FeatureServer',
        'out_sr': 4326,
        'transform': 'ky_dgi',
    },

    # ── TENNESSEE (STS Certified Sites) — 45 sites ──
    # Multi-state dataset but primarily TN. Point geometry.
    # Has: Name, County, Address, City, State, Zip
    {
        'name': 'STS Certified Sites (TN)',
        'url': 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Certified_Sites_view/FeatureServer/0',
        'prefix': 'shovel_sts',
        'state': None,  # Multi-state — use State field from data
        'server_type': 'FeatureServer',
        'out_sr': 4326,
        'transform': 'sts',
    },

    # ── WISCONSIN DPC Co-ops — 52 Economic Development sites ──
    # Has: TRANSMISSIONCAPACITY (MW!), SIZEACRES, SHOVELREADYCERT,
    #       ZONING, SEWERWATERCAP, MEMBERCOOP
    {
        'name': 'Wisconsin DPC Co-op Economic Development Sites',
        'url': 'https://services.arcgis.com/eYR81duzoKVjJjBW/arcgis/rest/services/EcoDev_External/FeatureServer/0',
        'prefix': 'shovel_wi_dpc',
        'state': 'WI',
        'server_type': 'FeatureServer',
        'out_sr': 4326,
        'transform': 'dpc',
    },
]


# ── HTTP + Supabase Helpers ──────────────────────────────────────

def http_get(url, timeout=30):
    """Make an HTTP GET request with retry logic."""
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            err_body = ''
            try:
                err_body = e.read().decode()[:300]
            except Exception:
                pass
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return {'error': f'HTTP {e.code}', 'detail': err_body}
        except Exception as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return {'error': str(e)}
    return {'error': 'max retries'}


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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = ''
            try:
                err_body = e.read().decode()[:500]
            except Exception:
                pass
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


# ── ArcGIS Fetcher ───────────────────────────────────────────────

def fetch_arcgis_features(endpoint, limit=None):
    """Fetch all features from an ArcGIS endpoint with pagination."""
    base_url = endpoint['url']
    name = endpoint['name']
    out_sr = endpoint.get('out_sr', 4326)

    print(f"\n  Fetching: {name}")
    print(f"    URL: {base_url}")

    # Check if endpoint exists
    info = http_get(f"{base_url}?f=json")
    if 'error' in info:
        print(f"    SKIP: Endpoint not found ({info.get('error')}: {info.get('detail', '')[:100]})")
        return []

    # Get record count
    count_url = f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json"
    count_data = http_get(count_url)
    total = count_data.get('count', 0)
    if total == 0 and 'error' not in count_data:
        print(f"    SKIP: 0 records")
        return []
    print(f"    Records: {total}")

    max_record_count = info.get('maxRecordCount', 1000)
    page_size = min(max_record_count, 2000)

    all_features = []
    offset = 0
    seen_oids = set()

    while True:
        if limit and len(all_features) >= limit:
            break

        params = {
            'where': '1=1',
            'outFields': '*',
            'outSR': out_sr,
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        }

        query_url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
        data = http_get(query_url, timeout=120)

        if 'error' in data:
            print(f"    Error at offset {offset}: {data.get('error')}")
            break

        features = data.get('features', [])
        if not features:
            break

        new_count = 0
        for feat in features:
            attrs = feat.get('attributes', {}) or {}
            oid = attrs.get('OBJECTID') or attrs.get('FID') or attrs.get('ObjectID') or attrs.get('OBJECTID_1')
            if oid and oid in seen_oids:
                continue
            if oid:
                seen_oids.add(oid)
            all_features.append(feat)
            new_count += 1

        if new_count == 0:
            break

        offset += len(features)

        if offset % 1000 == 0:
            print(f"    Fetched {offset}...")

        if len(features) < page_size:
            break

        time.sleep(0.3)

    if limit:
        all_features = all_features[:limit]

    print(f"    Fetched {len(all_features)} features total")
    return all_features


# ── Safe Value Helpers ───────────────────────────────────────────

def safe_float(val):
    """Safely convert to float, returning None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN check
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_str(val, max_len=500):
    """Safely convert to trimmed string, returning None for empty/null."""
    if val is None:
        return None
    s = str(val).strip()
    if s in ('', 'None', 'null', 'Null', '<Null>', 'N/A', 'n/a', 'NA'):
        return None
    return s[:max_len]


def get_centroid(geometry):
    """Extract centroid lat/lng from ArcGIS geometry (point or polygon)."""
    if not geometry:
        return None, None

    # Point geometry
    if 'x' in geometry and 'y' in geometry:
        lng = safe_float(geometry['x'])
        lat = safe_float(geometry['y'])
        if lat and lng and -90 <= lat <= 90 and -180 <= lng <= 180:
            return lat, lng
        return None, None

    # Polygon geometry — compute centroid from rings
    rings = geometry.get('rings', [])
    if not rings:
        return None, None

    # Use first ring (outer boundary) centroid
    ring = rings[0]
    if not ring:
        return None, None

    sum_x, sum_y, n = 0, 0, 0
    for pt in ring:
        if len(pt) >= 2:
            sum_x += pt[0]
            sum_y += pt[1]
            n += 1

    if n == 0:
        return None, None

    lng = sum_x / n
    lat = sum_y / n

    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return round(lat, 6), round(lng, 6)
    return None, None


# ── Transform Functions ──────────────────────────────────────────

def transform_vedp(feat, endpoint):
    """Transform VEDP Available Properties to grid_dc_sites record."""
    attrs = feat.get('attributes', {}) or {}
    geom = feat.get('geometry', {})
    lat, lng = get_centroid(geom)

    # Fall back to Latitude/Longitude fields if geometry centroid fails
    if not lat or not lng:
        lat = safe_float(attrs.get('Latitude'))
        lng = safe_float(attrs.get('Longitude'))

    if not lat or not lng:
        return None

    # Filter non-US
    if lat < 17.5 or lat > 72.0 or lng > -60.0 or lng < -180:
        return None

    oid = attrs.get('OBJECTID') or attrs.get('FID') or attrs.get('ObjectID')
    name = safe_str(attrs.get('Name')) or safe_str(attrs.get('PropertyName'))
    city = safe_str(attrs.get('City'))
    county = safe_str(attrs.get('LocalityName'))

    acreage = safe_float(attrs.get('AcreageSuitableForConstruction')) or safe_float(attrs.get('TotalAcreage'))

    # Capacity from MaxElecCapacity field (string like "100 MW")
    elec_cap = safe_str(attrs.get('MaxElecCapacity'))
    capacity_mw = None
    if elec_cap:
        import re
        match = re.search(r'([\d,.]+)\s*(?:MW|mw|Mw)', elec_cap)
        if match:
            capacity_mw = safe_float(match.group(1).replace(',', ''))

    # FIPS code
    fips = safe_str(attrs.get('FIPS'))

    # Brownfield flag
    is_brownfield = attrs.get('Brownfield') == 1

    # DC-specific certification flags
    dc_certified = attrs.get('DominionCertifiedDataCenterSite') == 1
    aep_dc = attrs.get('AEPQualifiedDataCenterSite') == 1
    brs_certified = attrs.get('BusinessReadySiteCertified') == 1

    # Build description from certifications
    certs = []
    if brs_certified:
        certs.append('VBRSP Certified')
    if dc_certified:
        certs.append('Dominion DC Certified')
    if aep_dc:
        certs.append('AEP DC Qualified')
    if is_brownfield:
        certs.append('Brownfield')

    former_use = '; '.join(certs) if certs else None

    return {
        'source_record_id': f"shovel_va_{oid}",
        'name': name or f"VEDP Site {oid}",
        'site_type': 'shovel_ready',
        'state': 'VA',
        'county': county,
        'fips_code': fips,
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'acreage': round(acreage, 2) if acreage else None,
        'available_capacity_mw': capacity_mw,
        'former_use': former_use,
        'iso_region': 'PJM',
    }


def transform_wedc(feat, endpoint):
    """Transform Wisconsin WEDC Certified Sites to grid_dc_sites record."""
    attrs = feat.get('attributes', {}) or {}
    geom = feat.get('geometry', {})

    # Use LATITUDE/LONGITUDE fields first, fall back to geometry centroid
    lat = safe_float(attrs.get('LATITUDE'))
    lng = safe_float(attrs.get('LONGITUDE'))
    if not lat or not lng:
        lat, lng = get_centroid(geom)
    if not lat or not lng:
        return None

    if lat < 17.5 or lat > 72.0 or lng > -60.0:
        return None

    oid = attrs.get('FID') or attrs.get('OBJECTID')
    name = safe_str(attrs.get('Name'))
    county = safe_str(attrs.get('County'))
    city = safe_str(attrs.get('City'))
    status = safe_str(attrs.get('Status'))

    acreage = safe_float(attrs.get('GISACRES')) or safe_float(attrs.get('SUM_GISACR')) or safe_float(attrs.get('Acres_Orig'))
    owner = safe_str(attrs.get('OWNERNME1'))

    # Use FID for unique ID (Siteno groups parcels within same site)
    return {
        'source_record_id': f"shovel_wi_{oid}",
        'name': name or f"WEDC Site {oid}",
        'site_type': 'shovel_ready',
        'state': 'WI',
        'county': county,
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'acreage': round(acreage, 2) if acreage else None,
        'former_use': f"Status: {status}" if status else None,
        'iso_region': 'MISO',
    }


def transform_ky_dgi(feat, endpoint):
    """Transform Kentucky Industrial Sites to grid_dc_sites record."""
    attrs = feat.get('attributes', {}) or {}
    geom = feat.get('geometry', {})
    lat, lng = get_centroid(geom)

    # Fall back to X/Y coord fields
    if not lat or not lng:
        lat = safe_float(attrs.get('Y_COORD'))
        lng = safe_float(attrs.get('X_COORD'))
    if not lat or not lng:
        return None
    if lat < 17.5 or lat > 72.0 or lng > -60.0:
        return None

    oid = attrs.get('OBJECTID_1') or attrs.get('OBJECTID')
    site_id = safe_str(attrs.get('SITE_ID'))
    name = safe_str(attrs.get('MAPNAME')) or safe_str(attrs.get('SITELBL'))
    county = safe_str(attrs.get('COUNTYNAME'))
    site_type_web = safe_str(attrs.get('TYPEWEB'))
    status = safe_str(attrs.get('STATUSWEB'))
    acreage = safe_float(attrs.get('MAXACNUM')) or safe_float(attrs.get('ACTOTNUM'))
    fips = safe_str(attrs.get('FIPSCNTY'))

    # Skip inactive sites
    if status and status.lower() not in ('active', 'available'):
        return None

    former_use = site_type_web  # "Build-ready", "Shovel-ready", "Prime", etc.

    return {
        'source_record_id': f"shovel_ky_{site_id or oid}",
        'name': name or f"KY Site {site_id or oid}",
        'site_type': 'shovel_ready',
        'state': 'KY',
        'county': county,
        'fips_code': f"21{fips}" if fips and len(fips) == 3 else None,
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'acreage': round(acreage, 2) if acreage else None,
        'former_use': former_use,
        'iso_region': 'PJM',
    }


def transform_sts(feat, endpoint):
    """Transform STS Certified Sites (TN multi-state) to grid_dc_sites record."""
    attrs = feat.get('attributes', {}) or {}
    geom = feat.get('geometry', {})
    lat, lng = get_centroid(geom)

    # Fall back to Latitude/ongitude fields (note: typo in source — "ongitude" not "Longitude")
    if not lat or not lng:
        lat = safe_float(attrs.get('Latitude'))
        lng = safe_float(attrs.get('ongitude'))
    if not lat or not lng:
        return None
    if lat < 17.5 or lat > 72.0 or lng > -60.0:
        return None

    oid = attrs.get('ObjectID') or attrs.get('OBJECTID')
    name = safe_str(attrs.get('Name'))
    county = safe_str(attrs.get('County'))
    state = safe_str(attrs.get('State'))
    city = safe_str(attrs.get('City_1')) or safe_str(attrs.get('City'))

    if not state:
        state = 'TN'  # Default — most records are TN

    return {
        'source_record_id': f"shovel_sts_{oid}",
        'name': name or f"STS Site {oid}",
        'site_type': 'shovel_ready',
        'state': state.upper()[:2],
        'county': county,
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'iso_region': STATE_ISO.get(state.upper()[:2], 'SERC'),
    }


def transform_dpc(feat, endpoint):
    """Transform Wisconsin DPC Co-op Economic Dev Sites to grid_dc_sites record."""
    attrs = feat.get('attributes', {}) or {}
    geom = feat.get('geometry', {})
    lat, lng = get_centroid(geom)

    # Fall back to LATY/LONX fields
    if not lat or not lng:
        lat = safe_float(attrs.get('LATY'))
        lng = safe_float(attrs.get('LONX'))
    if not lat or not lng:
        return None
    if lat < 17.5 or lat > 72.0 or lng > -60.0:
        return None

    oid = attrs.get('OBJECTID')
    site_id = safe_str(attrs.get('SITEID'))
    name = safe_str(attrs.get('SITENAME'))
    acreage = safe_float(attrs.get('SIZEACRES'))
    capacity_mw = safe_float(attrs.get('TRANSMISSIONCAPACITY'))
    shovel_ready = safe_str(attrs.get('SHOVELREADYCERT'))
    zoning = safe_str(attrs.get('ZONING'))
    coop = safe_str(attrs.get('MEMBERCOOP'))

    former_use_parts = []
    if shovel_ready and shovel_ready.lower() == 'yes':
        former_use_parts.append('Shovel Ready Certified')
    if zoning:
        former_use_parts.append(f"Zoning: {zoning}")
    if coop:
        former_use_parts.append(f"Co-op: {coop}")

    # Determine state from data (should be Wisconsin but field says full name)
    state_raw = safe_str(attrs.get('STATE'))
    state = 'WI'
    if state_raw:
        if state_raw.upper() == 'WISCONSIN' or state_raw.upper() == 'WI':
            state = 'WI'
        elif len(state_raw) == 2:
            state = state_raw.upper()

    return {
        'source_record_id': f"shovel_dpc_{site_id or oid}",
        'name': name or f"DPC Site {site_id or oid}",
        'site_type': 'shovel_ready',
        'state': state,
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'acreage': round(acreage, 2) if acreage else None,
        'available_capacity_mw': capacity_mw,
        'former_use': '; '.join(former_use_parts) if former_use_parts else None,
        'iso_region': STATE_ISO.get(state, 'MISO'),
    }


# Transform function registry
TRANSFORMS = {
    'vedp': transform_vedp,
    'wedc': transform_wedc,
    'ky_dgi': transform_ky_dgi,
    'sts': transform_sts,
    'dpc': transform_dpc,
}


# ── Data Source Management ───────────────────────────────────────

def ensure_data_source(endpoint):
    """Ensure a data source record exists for this endpoint."""
    ds_name = endpoint['prefix']
    path = f"grid_data_sources?name=eq.{urllib.parse.quote(ds_name)}"
    existing = supabase_request('GET', path)
    if existing:
        return existing[0]['id']

    # Create new
    record = {
        'name': ds_name,
        'description': endpoint['name'],
        'url': endpoint['url'],
    }
    result = supabase_request('POST', 'grid_data_sources', [record], {
        'Prefer': 'return=representation',
    })
    if result and len(result) > 0:
        return result[0]['id']
    return None


# ── Load Existing Records ───────────────────────────────────────

def load_all_shovel_ready_ids():
    """Load all existing shovel_ready source_record_ids to avoid duplicates."""
    all_ids = set()
    offset = 0
    page_size = 1000
    while True:
        path = f"grid_dc_sites?select=source_record_id&site_type=eq.shovel_ready&limit={page_size}&offset={offset}&order=source_record_id"
        try:
            rows = supabase_request('GET', path)
            if not rows:
                break
            for r in rows:
                all_ids.add(r['source_record_id'])
            if len(rows) < page_size:
                break
            offset += page_size
        except Exception as e:
            print(f"    Warning: Could not load existing IDs at offset {offset}: {e}")
            break
    return all_ids


# ── Insert Records ──────────────────────────────────────────────

def insert_sites(records, data_source_id, existing_ids, dry_run=False):
    """Insert site records into grid_dc_sites."""
    if not records:
        return 0

    if dry_run:
        print(f"    DRY RUN: Would insert {len(records)} sites")
        for r in records[:5]:
            print(f"      {r['source_record_id']}: {r.get('name', 'unnamed')} "
                  f"({r.get('state', '?')}) {r.get('acreage', '?')} acres")
        if len(records) > 5:
            print(f"      ... and {len(records) - 5} more")
        return len(records)

    # Deduplicate against existing
    new_records = [r for r in records if r['source_record_id'] not in existing_ids]

    if not new_records:
        print(f"    All {len(records)} records already exist")
        return 0

    print(f"    Inserting {len(new_records)} new sites ({len(records) - len(new_records)} duplicates skipped)...")

    # Add data_source_id to all records
    for r in new_records:
        r['data_source_id'] = data_source_id

    inserted = 0
    errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {
                'Prefer': 'resolution=ignore-duplicates,return=minimal',
            })
            inserted += len(batch)
        except Exception as e:
            print(f"    Error inserting batch at {i}: {e}")
            errors += len(batch)
            # Try one at a time
            for record in batch:
                try:
                    supabase_request('POST', 'grid_dc_sites', [record], {
                        'Prefer': 'resolution=ignore-duplicates,return=minimal',
                    })
                    inserted += 1
                    errors -= 1
                except Exception as e2:
                    print(f"      Single insert error: {e2}")

        if inserted > 0 and inserted % 200 == 0:
            print(f"    Inserted {inserted}...")

    # Add newly inserted IDs to the dedup set for subsequent endpoints
    for r in new_records:
        existing_ids.add(r['source_record_id'])

    print(f"    Inserted: {inserted}, Errors: {errors}")
    return inserted


# ── Main ─────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    list_endpoints = '--list-endpoints' in args

    # Parse --state flag
    target_states = None
    for i, arg in enumerate(args):
        if arg == '--state' and i + 1 < len(args):
            target_states = [s.strip().upper() for s in args[i + 1].split(',')]

    # Parse --limit flag
    record_limit = None
    for i, arg in enumerate(args):
        if arg == '--limit' and i + 1 < len(args):
            record_limit = int(args[i + 1])

    if list_endpoints:
        print("\nConfigured Shovel-Ready Site Endpoints:")
        print(f"{'#':>3}  {'State':5}  {'Records':>8}  {'Name'}")
        print("-" * 70)
        for idx, ep in enumerate(ENDPOINTS, 1):
            print(f"{idx:3d}  {ep.get('state') or 'Multi':5}  {'?':>8}  {ep['name']}")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    # Filter endpoints by target states
    endpoints = ENDPOINTS
    if target_states:
        endpoints = [ep for ep in endpoints if ep.get('state') in target_states or ep.get('state') is None]
        print(f"Targeting endpoints for states: {', '.join(target_states)}")
    else:
        print(f"Targeting all {len(endpoints)} shovel-ready site endpoints")

    if dry_run:
        print("DRY RUN MODE - no records will be inserted\n")

    # Load all existing shovel_ready IDs once for dedup
    if not dry_run:
        print("\nLoading existing shovel_ready IDs for dedup...")
        existing_ids = load_all_shovel_ready_ids()
        print(f"  Found {len(existing_ids)} existing records")
    else:
        existing_ids = set()

    total_inserted = 0
    total_skipped = 0
    total_errors = 0
    results = []

    for endpoint in endpoints:
        state = endpoint.get('state') or 'Multi'
        name = endpoint['name']
        prefix = endpoint['prefix']
        transform_name = endpoint['transform']

        print(f"\n{'='*60}")
        print(f"  {name} ({state})")
        print(f"{'='*60}")

        try:
            # Ensure data source exists
            if not dry_run:
                data_source_id = ensure_data_source(endpoint)
                if not data_source_id:
                    print(f"    ERROR: Could not create/find data source")
                    total_errors += 1
                    results.append({'state': state, 'name': name, 'status': 'error', 'count': 0})
                    continue
            else:
                data_source_id = None

            # Fetch features
            features = fetch_arcgis_features(endpoint, limit=record_limit)
            if not features:
                results.append({'state': state, 'name': name, 'status': 'no_data', 'count': 0})
                total_skipped += 1
                continue

            # Transform to grid_dc_sites records
            transform_fn = TRANSFORMS.get(transform_name)
            if not transform_fn:
                print(f"    ERROR: Unknown transform '{transform_name}'")
                total_errors += 1
                results.append({'state': state, 'name': name, 'status': 'error', 'count': 0})
                continue

            records = []
            transform_errors = 0
            for feat in features:
                try:
                    record = transform_fn(feat, endpoint)
                    if record:
                        records.append(record)
                except Exception as e:
                    transform_errors += 1
                    if transform_errors <= 3:
                        print(f"    Transform error: {e}")

            print(f"    Transformed {len(records)} valid records ({len(features) - len(records)} skipped, {transform_errors} errors)")

            if not records:
                results.append({'state': state, 'name': name, 'status': 'no_valid_records', 'count': 0})
                total_skipped += 1
                continue

            # Insert
            count = insert_sites(records, data_source_id, existing_ids, dry_run=dry_run)
            total_inserted += count
            results.append({'state': state, 'name': name, 'status': 'ok', 'count': count})

        except Exception as e:
            print(f"    FAILED: {e}")
            import traceback
            traceback.print_exc()
            results.append({'state': state, 'name': name, 'status': 'error', 'error': str(e)})
            total_errors += 1

    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Total endpoints attempted: {len(endpoints)}")
    print(f"Total sites inserted: {total_inserted}")
    print(f"Endpoints with no data: {total_skipped}")
    print(f"Endpoints with errors: {total_errors}")

    print(f"\nPer-endpoint results:")
    for r in results:
        ok = r['status'] == 'ok' and r['count'] > 0
        icon = '+' if ok else '-' if r['status'] in ('no_data', 'no_valid_records') else 'X'
        st = r.get('state') or '??'
        print(f"  {icon} {st:5s} | {r['name']:50s} | {r['status']:18s} | {r.get('count', 0):,} sites")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Ingest fiber optic route data from state DOT ArcGIS endpoints
for states currently missing from grid_fiber_routes.

Current coverage: UT, OK, VT, CA, NV, OR, FL, ME, NC, VA, WA, TX, CO, RI, AK, GA, IA, WI, IN, OH, IL, MD
Gap states targeted: NY, NJ, PA, IL, GA, OH, MD, MA, CT, MN, WI, IN, MI, TN, SC, AZ, MO

Usage:
  python3 -u scripts/ingest-dot-fiber.py                # Run all states
  python3 -u scripts/ingest-dot-fiber.py --state OH      # Single state
  python3 -u scripts/ingest-dot-fiber.py --state OH,NY   # Multiple states
  python3 -u scripts/ingest-dot-fiber.py --dry-run       # Preview without inserting
  python3 -u scripts/ingest-dot-fiber.py --discover      # Only discover endpoints, don't ingest
"""

import os
import sys
import json
import math
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
UA = 'GridScout/1.0 (fiber-ingest)'

# ── State DOT / broadband ArcGIS endpoints ──────────────────────

DOT_FIBER_SOURCES = [
    # ══════════════════════════════════════════════════════════════
    # VERIFIED WORKING ENDPOINTS (probed and confirmed Feb 2026)
    # ══════════════════════════════════════════════════════════════

    # ── IDAHO (gap state — no existing fiber data) ──
    {
        'name': 'Idaho ITD Fiber Network',
        'url': 'https://gis.itd.idaho.gov/arcgisprod/rest/services/Fiber/ITD_FIBER/MapServer/4',
        'prefix': 'id_itd_fiber',
        'state': 'ID',
        'name_field': 'fiber_DESCR',
        'operator_field': 'fiber_OWNER',
        'out_sr': 4326,
        'fiber_type_override': 'dot_fiber',
    },
    {
        'name': 'Idaho ITD Conduit',
        'url': 'https://gis.itd.idaho.gov/arcgisprod/rest/services/Fiber/ITD_FIBER/MapServer/5',
        'prefix': 'id_itd_conduit',
        'state': 'ID',
        'name_field': 'fiber_DESCR',
        'operator_field': 'fiber_OWNER',
        'fiber_type_override': 'conduit',
        'out_sr': 4326,
    },

    # ── ILLINOIS ──
    # Decatur IL Fiber Optic Cable — BROKEN: server returns "Version 'dbo.DEFAULT' is not accessible"
    # URL: https://maps.decaturil.gov/arcgis/rest/services/PublicWorks/FiberInfrastructure/FeatureServer/1

    # ── OHIO (gap state — only MVECA + Clinton in existing script) ──
    {
        'name': 'Centerville OH Fiber Network',
        'url': 'https://services.arcgis.com/M5UrDFRz2ZRTplQC/arcgis/rest/services/Fiber_Audit_2026_WFL1/FeatureServer/47',
        'prefix': 'oh_centerville_fiber',
        'state': 'OH',
        'name_field': 'CableName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Centerville OH Owned Fiber Projects',
        'url': 'https://services.arcgis.com/M5UrDFRz2ZRTplQC/arcgis/rest/services/Fiber_Audit_2026_WFL1/FeatureServer/40',
        'prefix': 'oh_centerville_proj',
        'state': 'OH',
        'name_field': 'CableName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Centerville OH MVECA Fiber Update',
        'url': 'https://services.arcgis.com/M5UrDFRz2ZRTplQC/arcgis/rest/services/Fiber_Audit_2026_WFL1/FeatureServer/6',
        'prefix': 'oh_centerville_mveca',
        'state': 'OH',
        'name_field': 'CableName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'OH Clinton County Proposed Fiber',
        'url': 'https://services5.arcgis.com/0Zxdzkr2RDoDbXEQ/arcgis/rest/services/Proposed_Fiber_Routes/FeatureServer/2',
        'prefix': 'oh_clinton_proposed',
        'state': 'OH',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
    },
    # OH Sycamore Telephone — layer 0 not found (service has no layer 0)
    # OH Bascom Communications — polygon geometry, not line

    # ── PENNSYLVANIA (gap state) ──
    {
        'name': 'Lansdale PA Borough Fiber Lines',
        'url': 'https://gis.lansdale.org/arcgis/rest/services/Fiber/FeatureServer/7',
        'prefix': 'pa_lansdale_fiber',
        'state': 'PA',
        'name_field': 'LocationName',
        'operator_field': None,
        'out_sr': 4326,
    },

    # ── MASSACHUSETTS ──
    # Concord MA Fiber Network — SKIPPED: Point geometry, not line routes
    # URL: https://gis.concordma.gov/arcgis/rest/services/Fiber/ConcordFiber/MapServer/0

    # ── MINNESOTA (gap state) ──
    {
        'name': 'Sherburne County MN Fiber Network',
        'url': 'https://gis.co.sherburne.mn.us/arcgis/rest/services/Broadband/Broadband/FeatureServer/4',
        'prefix': 'mn_sherburne_fiber',
        'state': 'MN',
        'name_field': 'FiberName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Sherburne County MN Fiber (MapServer)',
        'url': 'https://gis.co.sherburne.mn.us/arcgis/rest/services/Broadband/Broadband/MapServer/5',
        'prefix': 'mn_sherburne_fiber_ms',
        'state': 'MN',
        'name_field': 'FiberName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },

    # ── GEORGIA ──
    # GA Fiber Optic Cable — SKIPPED: Data is actually from Australia (coords ~153E, -28S), not Georgia USA
    # URL: https://services.arcgis.com/3vStCH7NDoBOZ5zn/arcgis/rest/services/Fiber_Optic_Cable/FeatureServer/0

    # ── NORTH CAROLINA ──
    # Harnett County NC Fiber — BROKEN: 404 Service not found (may come back)
    # URL: https://gis.harnett.org/arcgis/rest/services/Public_Utilities/Fiber/FeatureServer/1

    # ══════════════════════════════════════════════════════════════
    # BATCH 2: Research agent discoveries (Mar 2026)
    # ══════════════════════════════════════════════════════════════

    # ── VERMONT (fiber route polylines from PSD) ──
    {
        'name': 'Vermont PSD Fiber Routes 2022',
        'url': 'https://maps.vcgi.vermont.gov/arcgis/rest/services/PSD_services/OPENDATA_PSD_LAYERS_SP_NOCACHE_v1/MapServer/56',
        'prefix': 'vt_psd_fiber',
        'state': 'VT',
        'name_field': 'PRIMARYNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'state_fiber',
    },
    {
        'name': 'Vermont Cable Routes 2021',
        'url': 'https://maps.vcgi.vermont.gov/arcgis/rest/services/PSD_services/OPENDATA_PSD_LAYERS_SP_NOCACHE_v1/MapServer/49',
        'prefix': 'vt_cable_routes',
        'state': 'VT',
        'name_field': 'PRIMARYNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'cable_route',
    },

    # ── CALIFORNIA (CAMMBI middle-mile broadband) ──
    {
        'name': 'California CAMMBI All Routes',
        'url': 'https://services6.arcgis.com/sAv98EYUZbLCVPW0/arcgis/rest/services/MMBI_Statewide_Network_High_All/FeatureServer/1',
        'prefix': 'ca_cammbi',
        'state': 'CA',
        'name_field': 'County_Name',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },

    # ── ARIZONA (ADOT + Yavapai County fiber) ──
    {
        'name': 'ADOT State-Owned Fiber Optic Conduit',
        'url': 'https://services8.arcgis.com/bspqcASG7WIqqFvk/arcgis/rest/services/ADOT_State_Owned_Fiber_Optic_Conduit_Routes/FeatureServer/117',
        'prefix': 'az_adot_fiber',
        'state': 'AZ',
        'name_field': 'Name',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'dot_fiber',
    },
    {
        'name': 'Yavapai County AZ Sparklight Fiber',
        'url': 'https://services1.arcgis.com/BajuNXbtZNiBKFkx/arcgis/rest/services/Fiber_optic_infrastructure/FeatureServer/0',
        'prefix': 'az_yavapai_sparklight',
        'state': 'AZ',
        'name_field': 'FULLST_NAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'isp_fiber',
    },
    {
        'name': 'Yavapai County AZ ADOT Fiber',
        'url': 'https://services1.arcgis.com/BajuNXbtZNiBKFkx/arcgis/rest/services/Fiber_optic_infrastructure/FeatureServer/1',
        'prefix': 'az_yavapai_adot',
        'state': 'AZ',
        'name_field': 'FULLST_NAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'dot_fiber',
    },

    # ── UTAH (UETN fiber network) ──
    {
        'name': 'Utah UETN Fiber Network',
        'url': 'https://gis.horrocks.com/arcgis/rest/services/UETN_Fiber_SDE/MapServer/8',
        'prefix': 'ut_uetn_fiber',
        'state': 'UT',
        'name_field': 'DESCR',
        'operator_field': 'OWNER',
        'out_sr': 4326,
        'fiber_type_override': 'state_fiber',
    },
    {
        'name': 'Utah UETN Conduit',
        'url': 'https://gis.horrocks.com/arcgis/rest/services/UETN_Fiber_SDE/MapServer/7',
        'prefix': 'ut_uetn_conduit',
        'state': 'UT',
        'name_field': 'DESCR',
        'operator_field': 'OWNER',
        'out_sr': 4326,
        'fiber_type_override': 'conduit',
    },

    # ── NEVADA (HSNV middle-mile routes) ──
    {
        'name': 'Nevada HSNV I-80 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/I_80_Route/FeatureServer/89',
        'prefix': 'nv_hsnv_i80',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },
    {
        'name': 'Nevada HSNV I-15 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/I_15_Route/FeatureServer/0',
        'prefix': 'nv_hsnv_i15',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },
    {
        'name': 'Nevada HSNV US-93 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/US_93_Route/FeatureServer/0',
        'prefix': 'nv_hsnv_us93',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },
    {
        'name': 'Nevada HSNV US-50 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/US_50_Route/FeatureServer/0',
        'prefix': 'nv_hsnv_us50',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },
    {
        'name': 'Nevada HSNV US-95 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/US_95_Route/FeatureServer/0',
        'prefix': 'nv_hsnv_us95',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },
    {
        'name': 'Nevada HSNV I-580 Fiber Route',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/I_580_Route/FeatureServer/0',
        'prefix': 'nv_hsnv_i580',
        'state': 'NV',
        'name_field': 'FULLNAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'middle_mile',
    },

    # ── MASSACHUSETTS (Boston municipal fiber) ──
    {
        'name': 'Boston Lit Fiber',
        'url': 'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/fiber/MapServer/8',
        'prefix': 'ma_boston_lit',
        'state': 'MA',
        'name_field': 'Type',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'municipal_fiber',
    },
    {
        'name': 'Boston Core Fiber',
        'url': 'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/fiber/MapServer/9',
        'prefix': 'ma_boston_core',
        'state': 'MA',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'municipal_fiber',
    },

    # ── ILLINOIS (Decatur municipal fiber) ──
    {
        'name': 'Decatur IL Municipal Fiber',
        'url': 'https://maps.decaturil.gov/arcgis/rest/services/PublicWorks/FiberInfrastructure/FeatureServer/1',
        'prefix': 'il_decatur_fiber',
        'state': 'IL',
        'name_field': 'CABLETYPE',
        'operator_field': 'CABLEOWNER',
        'out_sr': 4326,
        'fiber_type_override': 'municipal_fiber',
    },

    # ── WESTERN US (existing long-haul fiber routes) ──
    {
        'name': 'Western US Long-Haul Fiber Routes',
        'url': 'https://services5.arcgis.com/aYs2RC3pluEvAuE3/ArcGIS/rest/services/Existing_Fiber_Routes/FeatureServer/0',
        'prefix': 'west_longhaul',
        'state': None,  # Multi-state — compute from centroid
        'name_field': 'NAME',
        'operator_field': None,
        'out_sr': 4326,
        'fiber_type_override': 'long_haul',
    },
]


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


def discover_endpoint(source):
    """Try to reach an ArcGIS endpoint and get its metadata."""
    url = source['url']
    name = source['name']
    prefix = source['prefix']

    # Try to get service info
    info_url = f"{url}?f=json"
    result = http_get(info_url)
    if 'error' in result:
        # Try alternate URL patterns
        # Some DOTs use MapServer instead of FeatureServer
        alt_url = url.replace('/FeatureServer/', '/MapServer/')
        if alt_url != url:
            result = http_get(f"{alt_url}?f=json")
            if 'error' not in result:
                source['url'] = alt_url
                return result
        return None

    return result


def discover_services(base_url, state_abbr):
    """Discover available ArcGIS services at a base URL."""
    result = http_get(f"{base_url}?f=json")
    if 'error' in result:
        return []

    services = result.get('services', [])
    folders = result.get('folders', [])

    # Check folders for fiber/ITS/telecom related services
    fiber_keywords = ['fiber', 'its', 'telecom', 'broadband', 'communication', 'cable',
                      'conduit', 'network', 'infrastructure']

    found = []
    for svc in services:
        svc_name = svc.get('name', '').lower()
        svc_type = svc.get('type', '')
        if any(kw in svc_name for kw in fiber_keywords):
            found.append({
                'name': svc.get('name'),
                'type': svc_type,
                'url': f"{base_url}/{svc.get('name')}/{svc_type}",
            })

    for folder in folders:
        folder_name = folder.lower()
        if any(kw in folder_name for kw in fiber_keywords + ['its', 'transportation']):
            folder_result = http_get(f"{base_url}/{folder}?f=json")
            if 'error' not in folder_result:
                for svc in folder_result.get('services', []):
                    svc_name = svc.get('name', '').lower()
                    svc_type = svc.get('type', '')
                    if any(kw in svc_name for kw in fiber_keywords):
                        found.append({
                            'name': svc.get('name'),
                            'type': svc_type,
                            'url': f"{base_url}/{svc.get('name')}/{svc_type}",
                            'folder': folder,
                        })

    return found


def fetch_arcgis_features(source):
    """Fetch all features from an ArcGIS endpoint with pagination."""
    base_url = source['url']
    name = source['name']
    prefix = source['prefix']
    out_sr = source.get('out_sr', 4326)

    print(f"\n  Fetching: {name}")
    print(f"    URL: {base_url}")

    # First check if endpoint exists
    info = http_get(f"{base_url}?f=json")
    if 'error' in info:
        print(f"    SKIP: Endpoint not found ({info.get('error')}: {info.get('detail', '')[:100]})")
        return []

    # Check geometry type
    geom_type = info.get('geometryType', '')
    if geom_type and 'Line' not in geom_type and 'Polyline' not in geom_type:
        print(f"    SKIP: Geometry type is {geom_type}, not line/polyline")
        return []

    # Get record count
    count_url = f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json"
    count_data = http_get(count_url)
    if 'error' in count_data:
        # Try with OBJECTID > 0
        count_url = f"{base_url}/query?where=OBJECTID%3E0&returnCountOnly=true&f=json"
        count_data = http_get(count_url)

    total = count_data.get('count', 0)
    if total == 0 and 'error' not in count_data:
        print(f"    SKIP: 0 records")
        return []
    elif 'error' in count_data:
        print(f"    WARNING: Could not get count, will try fetching anyway")
        total = '?'

    print(f"    Records: {total}")

    # Determine max record count
    max_record_count = info.get('maxRecordCount', 1000)
    page_size = min(max_record_count, 2000)

    # Fetch in pages
    all_features = []
    offset = 0
    seen_oids = set()

    # Detect if pagination is supported
    supports_pagination = info.get('advancedQueryCapabilities', {}).get('supportsPagination', True)

    while True:
        params = {
            'where': '1=1',
            'outFields': '*',
            'outSR': out_sr,
            'f': 'geojson',
        }

        if supports_pagination:
            params['resultOffset'] = offset
            params['resultRecordCount'] = page_size

        query_url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
        data = http_get(query_url, timeout=120)

        if 'error' in data:
            # Try JSON format instead of GeoJSON
            params['f'] = 'json'
            query_url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
            data = http_get(query_url, timeout=120)

            if 'error' in data:
                print(f"    Error at offset {offset}: {data.get('error')}")
                break

            # Convert esriJSON to GeoJSON-like format
            features = convert_esri_features(data.get('features', []))
        else:
            features = data.get('features', [])

        if not features:
            break

        # OID-based dedup for MapServer endpoints that don't support pagination
        new_count = 0
        for feat in features:
            props = feat.get('properties', {}) or {}
            oid = props.get('OBJECTID') or props.get('FID') or props.get('objectid')
            if oid and oid in seen_oids:
                continue
            if oid:
                seen_oids.add(oid)
            all_features.append(feat)
            new_count += 1

        if new_count == 0:
            break

        offset += len(features)

        if offset % 5000 == 0:
            print(f"    Fetched {offset}...")

        if len(features) < page_size:
            break

        time.sleep(0.3)

    print(f"    Fetched {len(all_features)} features total")
    return all_features


def convert_esri_features(features):
    """Convert Esri JSON features to GeoJSON-like format."""
    result = []
    for feat in features:
        geom = feat.get('geometry', {})
        attrs = feat.get('attributes', {})

        if not geom:
            continue

        paths = geom.get('paths', [])
        if not paths:
            continue

        if len(paths) == 1:
            geojson_geom = {
                'type': 'LineString',
                'coordinates': paths[0]
            }
        else:
            geojson_geom = {
                'type': 'MultiLineString',
                'coordinates': paths
            }

        result.append({
            'type': 'Feature',
            'properties': attrs,
            'geometry': geojson_geom,
        })

    return result


def state_from_coords(lat, lng):
    """Rough state lookup from coordinates using centroid bounding boxes."""
    # Approximate state centroids — good enough for fiber route assignment
    states = [
        ('CA', 36.8, -119.4, 3.5), ('NV', 38.8, -116.4, 3.0), ('OR', 43.8, -120.6, 2.5),
        ('WA', 47.4, -120.7, 2.0), ('AZ', 34.0, -111.1, 3.0), ('UT', 39.3, -111.1, 2.5),
        ('CO', 39.0, -105.5, 2.0), ('NM', 34.5, -106.0, 2.5), ('WY', 43.0, -107.6, 2.0),
        ('MT', 47.0, -109.6, 3.0), ('ID', 44.1, -114.7, 2.5), ('TX', 31.5, -99.0, 5.0),
        ('OK', 35.5, -97.5, 2.0), ('KS', 38.5, -98.3, 2.0), ('NE', 41.5, -99.8, 2.0),
        ('SD', 44.0, -100.2, 2.0), ('ND', 47.5, -100.5, 2.0),
    ]
    best = None
    best_dist = float('inf')
    for st, slat, slng, _ in states:
        d = ((lat - slat)**2 + (lng - slng)**2)**0.5
        if d < best_dist:
            best_dist = d
            best = st
    return best


def features_to_routes(features, source):
    """Convert GeoJSON features to route records for DB insertion."""
    prefix = source['prefix']
    state = source.get('state')
    name_field = source.get('name_field')
    operator_field = source.get('operator_field')

    routes = []
    for feat in features:
        geom = feat.get('geometry')
        props = feat.get('properties', {}) or {}
        if not geom:
            continue

        geom_type = geom.get('type', '')
        coords = geom.get('coordinates', [])

        if geom_type == 'LineString':
            if len(coords) < 2:
                continue
        elif geom_type == 'MultiLineString':
            if not coords or all(len(line) < 2 for line in coords):
                continue
        else:
            continue

        # Compute centroid
        if geom_type == 'LineString':
            mid_idx = len(coords) // 2
            try:
                centroid_lng, centroid_lat = float(coords[mid_idx][0]), float(coords[mid_idx][1])
            except (IndexError, ValueError, TypeError):
                continue
        else:
            longest = max(coords, key=len) if coords else coords[0]
            mid_idx = len(longest) // 2
            try:
                centroid_lng, centroid_lat = float(longest[mid_idx][0]), float(longest[mid_idx][1])
            except (IndexError, ValueError, TypeError):
                continue

        # Validate coordinates
        if not (-90 <= centroid_lat <= 90) or not (-180 <= centroid_lng <= 180):
            continue
        # Filter non-US
        if centroid_lat < 17.5 or centroid_lat > 72.0 or centroid_lng > -60.0:
            continue

        # Generate source_record_id
        oid = props.get('OBJECTID') or props.get('FID') or props.get('objectid') or props.get('OBJECTID_1')
        if oid:
            src_id = f"{prefix}_fiber_{oid}"
        else:
            coord_hash = hash(json.dumps(coords[:3] if geom_type == 'LineString' else coords[0][:3]))
            src_id = f"{prefix}_fiber_{abs(coord_hash)}"

        # Case-insensitive field lookup
        props_lower = {k.lower(): v for k, v in props.items()}

        route_name = None
        if name_field:
            route_name = props.get(name_field) or props_lower.get(name_field.lower()) or None
        operator = None
        if operator_field:
            operator = props.get(operator_field) or props_lower.get(operator_field.lower()) or None

        # Clean up
        if route_name and str(route_name).strip() in ('None', 'null', '', 'N/A', 'Null', '<Null>'):
            route_name = None
        if operator and str(operator).strip() in ('None', 'null', '', 'N/A', 'Null', '<Null>'):
            operator = None

        # Derive state from centroid if not specified
        route_state = state
        if not route_state:
            route_state = state_from_coords(centroid_lat, centroid_lng)

        routes.append({
            'source_record_id': src_id,
            'name': str(route_name).strip()[:500] if route_name else None,
            'operator': str(operator).strip()[:500] if operator else None,
            'fiber_type': source.get('fiber_type_override', 'dot_fiber'),
            'location_type': None,
            'source': prefix,
            'state': route_state,
            'centroid_lat': round(centroid_lat, 7),
            'centroid_lng': round(centroid_lng, 7),
            'geometry_json': geom,
        })

    return routes


def load_existing_ids(prefix):
    """Load existing source_record_ids for a given prefix to avoid duplicates."""
    path = f"grid_fiber_routes?select=source_record_id&source=eq.{urllib.parse.quote(prefix)}&limit=100000"
    try:
        rows = supabase_request('GET', path)
        if rows:
            return {r['source_record_id'] for r in rows}
    except Exception as e:
        print(f"    Warning: Could not load existing IDs: {e}")
    return set()


def insert_routes(routes, dry_run=False):
    """Insert routes into grid_fiber_routes."""
    if not routes:
        return 0

    if dry_run:
        print(f"    DRY RUN: Would insert {len(routes)} routes")
        for r in routes[:3]:
            print(f"      {r['source_record_id']}: {r.get('name', 'unnamed')} ({r.get('operator', '?')})")
        return len(routes)

    # Load existing to avoid duplicates
    prefix = routes[0]['source']
    existing = load_existing_ids(prefix)
    new_routes = [r for r in routes if r['source_record_id'] not in existing]

    if not new_routes:
        print(f"    All {len(routes)} routes already exist")
        return 0

    print(f"    Inserting {len(new_routes)} new routes ({len(routes) - len(new_routes)} duplicates skipped)...")

    inserted = 0
    errors = 0
    for i in range(0, len(new_routes), BATCH_SIZE):
        batch = new_routes[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_fiber_routes', batch, {
                'Prefer': 'resolution=ignore-duplicates,return=minimal',
            })
            inserted += len(batch)
        except Exception as e:
            print(f"    Error inserting batch at {i}: {e}")
            errors += len(batch)
            # Try one at a time
            for record in batch:
                try:
                    supabase_request('POST', 'grid_fiber_routes', [record], {
                        'Prefer': 'resolution=ignore-duplicates,return=minimal',
                    })
                    inserted += 1
                    errors -= 1
                except Exception:
                    pass

        if inserted % 500 == 0 and inserted > 0:
            print(f"    Inserted {inserted}...")

    print(f"    Inserted: {inserted}, Errors: {errors}")
    return inserted


# ── Discovery: Find working endpoints ──────────────────────────

# Known GIS portal base URLs per state
STATE_GIS_PORTALS = {
    'OH': [
        'https://gis.dot.state.oh.us/arcgis/rest/services',
    ],
    'NY': [
        'https://gisservices.its.ny.gov/arcgis/rest/services',
        'https://services6.arcgis.com/DZHaqZm9elBmSZaB/arcgis/rest/services',
    ],
    'NJ': [
        'https://services2.arcgis.com/XVOqAjTOJ5P1ngMD/arcgis/rest/services',
    ],
    'PA': [
        'https://gis.penndot.gov/arcgis/rest/services',
    ],
    'IL': [
        'https://gis.dot.illinois.gov/arcgis/rest/services',
    ],
    'GA': [
        'https://maps.gdot.opendata.arcgis.com/api/v3/datasets',
    ],
    'MD': [
        'https://services.arcgis.com/njFNhDsUCentVYJW/arcgis/rest/services',
    ],
    'MA': [
        'https://services.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services',
    ],
    'CT': [
        'https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services',
    ],
    'MN': [
        'https://webgis.dot.state.mn.us/arcgis/rest/services',
    ],
}


def run_discovery(states=None):
    """Discover available fiber-related ArcGIS endpoints for states."""
    print("\n[Discovery Mode] Searching for fiber/ITS ArcGIS endpoints...\n")

    targets = states if states else list(STATE_GIS_PORTALS.keys())

    for state in targets:
        portals = STATE_GIS_PORTALS.get(state, [])
        if not portals:
            print(f"  {state}: No known GIS portal URLs")
            continue

        print(f"\n  {state}:")
        for portal_url in portals:
            print(f"    Checking {portal_url}...")
            found = discover_services(portal_url, state)
            if found:
                for svc in found:
                    print(f"      FOUND: {svc['name']} ({svc['type']})")
                    print(f"        URL: {svc['url']}")
                    if 'folder' in svc:
                        print(f"        Folder: {svc['folder']}")
            else:
                print(f"      No fiber/ITS services found")


# ── FCC BDC Broadband (nationwide, free) ──────────────────────

FCC_BDC_URL = "https://broadbandmap.fcc.gov/api/public/map"


def try_fcc_broadband(state):
    """Try FCC Broadband Data Collection fixed broadband for a state.
    The FCC BDC API is public but complex — checking if there's a simple layer."""
    # FCC broadband map is tile-based, not easy to bulk download
    # Skip for now — requires NTIA/FCC bulk download
    pass


# ── Main ──────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    discover_only = '--discover' in args

    # Parse --state flag
    target_states = None
    for i, arg in enumerate(args):
        if arg == '--state' and i + 1 < len(args):
            target_states = [s.strip().upper() for s in args[i + 1].split(',')]

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    if discover_only:
        run_discovery(target_states)
        return

    # Filter sources by target states
    sources = DOT_FIBER_SOURCES
    if target_states:
        sources = [s for s in sources if s['state'] in target_states]
        print(f"Targeting {len(sources)} endpoints for states: {', '.join(target_states)}")
    else:
        print(f"Targeting all {len(sources)} DOT fiber endpoints")

    if dry_run:
        print("DRY RUN MODE — no records will be inserted\n")

    total_inserted = 0
    total_skipped = 0
    total_errors = 0
    results = []

    for source in sources:
        state = source['state']
        name = source['name']
        prefix = source['prefix']

        try:
            features = fetch_arcgis_features(source)
            if not features:
                results.append({'state': state, 'name': name, 'status': 'no_data', 'count': 0})
                total_skipped += 1
                continue

            routes = features_to_routes(features, source)
            if not routes:
                print(f"    No valid routes after conversion")
                results.append({'state': state, 'name': name, 'status': 'no_valid_routes', 'count': 0})
                total_skipped += 1
                continue

            print(f"    Converted {len(routes)} valid routes")
            count = insert_routes(routes, dry_run=dry_run)
            total_inserted += count
            results.append({'state': state, 'name': name, 'status': 'ok', 'count': count})

        except Exception as e:
            print(f"    FAILED: {e}")
            results.append({'state': state, 'name': name, 'status': 'error', 'error': str(e)})
            total_errors += 1

    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Total endpoints attempted: {len(sources)}")
    print(f"Total routes inserted: {total_inserted}")
    print(f"Endpoints with no data: {total_skipped}")
    print(f"Endpoints with errors: {total_errors}")

    print(f"\nPer-endpoint results:")
    for r in results:
        status_icon = '✓' if r['status'] == 'ok' and r['count'] > 0 else '—' if r['status'] in ('no_data', 'no_valid_routes') else '✗'
        st = r.get('state') or '??'
        print(f"  {status_icon} {st:2s} | {r['name']:40s} | {r['status']:16s} | {r.get('count', 0):,} routes")


if __name__ == '__main__':
    main()

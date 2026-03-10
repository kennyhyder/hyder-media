#!/usr/bin/env python3
"""
Ingest fiber optic routes from OpenStreetMap + state ArcGIS sources,
and compute nearest-fiber distance for all grid_dc_sites.

Phase 1a: Fetch fiber routes from OSM Overpass API (by US region)
Phase 1b: Fetch fiber routes from state ArcGIS FeatureServer endpoints
Phase 2: Store in grid_fiber_routes table (Supabase)
Phase 3: Compute nearest_fiber_km for each grid_dc_sites record (psql bulk)

Sources:
  - OpenStreetMap Overpass API (nationwide)
  - California CPUC BB4ALL fiber corridors (ArcGIS)
  - Vermont PSD fiber routes 2025 (ArcGIS)
  - Maine 3 Ring Binder fiber network (ArcGIS)
  - NTIA Middle Mile broadband awards (ArcGIS)

Usage:
  python3 -u scripts/ingest-fiber-routes.py
  python3 -u scripts/ingest-fiber-routes.py --dry-run
  python3 -u scripts/ingest-fiber-routes.py --skip-download
  python3 -u scripts/ingest-fiber-routes.py --skip-download --skip-insert
  python3 -u scripts/ingest-fiber-routes.py --arcgis-only   # Skip OSM, only fetch ArcGIS
"""

import os
import sys
import json
import math
import time
import ssl
import subprocess
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
EARTH_RADIUS_KM = 6371.0
MAX_SEARCH_KM = 200.0
GRID_CELL_DEG = 1.0  # ~111 km at equator

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'fiber_routes.json')
ARCGIS_CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'fiber_routes_arcgis.json')

# ArcGIS FeatureServer endpoints for state-level fiber data
ARCGIS_FIBER_SOURCES = [
    {
        'name': 'California CPUC BB4ALL',
        'url': 'https://services2.arcgis.com/VofPZYDe2pLxSP5G/arcgis/rest/services/BB4ALL_Intersect_v3_Public/FeatureServer/0',
        'prefix': 'ca_cpuc',
        'state': 'CA',
        'name_field': 'ROUTE',
        'operator_field': 'NAMELSAD20',  # County name as operator proxy
        'out_sr': 4326,  # Request WGS84
    },
    {
        'name': 'Vermont Fiber 2025',
        'url': 'https://services3.arcgis.com/5tLOjexclC0TuD0h/arcgis/rest/services/BBStatus2025_Routes_Fiber/FeatureServer/0',
        'prefix': 'vt_fiber',
        'state': 'VT',
        'name_field': 'Name',
        'operator_field': 'Provider',
        'out_sr': 4326,
    },
    {
        'name': 'Maine 3 Ring Binder',
        'url': 'https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_3_Ring_Binder/FeatureServer/0',
        'prefix': 'me_3rb',
        'state': 'ME',
        'name_field': 'Name',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'NTIA Middle Mile Awards',
        'url': 'https://utility.arcgis.com/usrsvcs/servers/53d104cecb964033a75c5cd05cab3657/rest/services/MM_Dashboard_Layers_ForPublic/FeatureServer/1',
        'prefix': 'ntia_mm',
        'state': None,  # National — derive state from centroid
        'name_field': 'project_name',
        'operator_field': 'subgrantee_name',
        'out_sr': 4326,
    },
    {
        'name': 'Nevada OSIT Middle Mile Fiber',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/fiber_routes/FeatureServer/123',
        'prefix': 'nv_osit',
        'state': 'NV',
        'name_field': None,
        'operator_field': 'provider',
        'out_sr': 4326,
    },
    {
        'name': 'Nevada Zayo Open Access Routes',
        'url': 'https://services8.arcgis.com/6zoy8FhqGf9FaeLx/arcgis/rest/services/Zayo_Region_10_May_2024/FeatureServer/605',
        'prefix': 'nv_zayo',
        'state': 'NV',
        'name_field': None,
        'operator_field': None,
        'fiber_type_override': 'middle_mile',
        'out_sr': 4326,
    },
    {
        'name': 'Charlotte NC DOT Fiber Network',
        'url': 'https://services3.arcgis.com/KeHpkB2z2Rm4PO4O/arcgis/rest/services/CDOT_ITS_Asset_ToolPublish_WFL1/FeatureServer/14',
        'prefix': 'nc_cdot',
        'state': 'NC',
        'name_field': 'CableID',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Seattle DOT Fiber Routes',
        'url': 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Fiber_Routes_CDL/FeatureServer/0',
        'prefix': 'wa_sdot',
        'state': 'WA',
        'name_field': 'CABLE__',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'California CAMMBI Middle Mile',
        'url': 'https://services6.arcgis.com/sAv98EYUZbLCVPW0/arcgis/rest/services/MMBI_Statewide_Network_High_All/FeatureServer/1',
        'prefix': 'ca_mmbi',
        'state': 'CA',
        'name_field': 'County_Name',
        'operator_field': None,
        'fiber_type_override': 'middle_mile',
        'out_sr': 4326,
    },
    {
        'name': 'Utah DOT Fiber',
        'url': 'https://services9.arcgis.com/xdpm0FCzFgMkMhqo/arcgis/rest/services/UDOT_Fiber/FeatureServer/0',
        'prefix': 'ut_udot',
        'state': 'UT',
        'name_field': None,
        'operator_field': None,
        'fiber_type_override': 'dot_fiber',
        'out_sr': 4326,
    },
    # --- Priority 1: High-value sources ---
    {
        'name': 'Oklahoma DOT Broadband Lines',
        'url': 'https://services6.arcgis.com/RBtoEUQ2lmN0K3GY/arcgis/rest/services/Broadband_Lines/FeatureServer/0',
        'prefix': 'ok_odot',
        'state': 'OK',
        'name_field': 'ISP',
        'operator_field': 'ISP',
        'out_sr': 4326,
    },
    {
        'name': 'FDOT District 4 Fiber',
        'url': 'https://services3.arcgis.com/N05eA1HiHmPyDFBQ/arcgis/rest/services/FDOT_FIBER_OPTIC_NETWORK/FeatureServer/3',
        'prefix': 'fl_fdot',
        'state': 'FL',
        'name_field': 'DESCR',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'FDOT D4 TSMO Fiber',
        'url': 'https://services3.arcgis.com/N05eA1HiHmPyDFBQ/arcgis/rest/services/FDOT_FIBER_OPTIC_NETWORK/FeatureServer/4',
        'prefix': 'fl_fdot_tsmo',
        'state': 'FL',
        'name_field': 'PRI_ARTERI',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'FL Broward County Fiber',
        'url': 'https://services3.arcgis.com/N05eA1HiHmPyDFBQ/arcgis/rest/services/COUNTY_FIBER_OPTIC_NETWORK/FeatureServer/7',
        'prefix': 'fl_broward',
        'state': 'FL',
        'name_field': 'TYPE',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    # --- Priority 2: Medium-value sources ---
    {
        'name': 'CA CPUC Anchor Build Fiber Highways',
        'url': 'https://services2.arcgis.com/VofPZYDe2pLxSP5G/arcgis/rest/services/Anchor_Build_Fiber_Highways/FeatureServer/0',
        'prefix': 'ca_anchor',
        'state': 'CA',
        'name_field': 'NAME20',
        'operator_field': None,
        'fiber_type_override': 'middle_mile',
        'out_sr': 4326,
    },
    {
        'name': 'Rhode Island OSHEAN Fiber',
        'url': 'https://services6.arcgis.com/70X0jB6UtsfE8L2y/arcgis/rest/services/Rhode_Island_Network_Overview/FeatureServer/3',
        'prefix': 'ri_oshean',
        'state': 'RI',
        'name_field': 'Name',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Alaska Broadband Network',
        'url': 'https://services.arcgis.com/r4A0V7UzH9fcLVvv/ArcGIS/rest/services/Communications_Layers/FeatureServer/3',
        'prefix': 'ak_broadband',
        'state': 'AK',
        'name_field': 'Segment_Name',
        'operator_field': 'Broadband_Service_Provider',
        'out_sr': 4326,
    },
    {
        'name': 'Alaska DNR Fiber Optic',
        'url': 'https://services.arcgis.com/r4A0V7UzH9fcLVvv/ArcGIS/rest/services/Communications_Layers/FeatureServer/4',
        'prefix': 'ak_dnr_fiber',
        'state': 'AK',
        'name_field': 'Name',
        'operator_field': 'Source_Organization',
        'out_sr': 4326,
    },
    {
        'name': 'NC I-95/US-70 Broadband Conduit',
        'url': 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/I95_US70_Conduit/FeatureServer/0',
        'prefix': 'nc_conduit',
        'state': 'NC',
        'name_field': 'Name',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Caltrans D11 Fiber Optic',
        'url': 'https://services8.arcgis.com/WunV6yKxvEXfsV4W/arcgis/rest/services/fiberoptic_lines/FeatureServer/0',
        'prefix': 'ca_d11',
        'state': 'CA',
        'name_field': 'LOCATION',
        'operator_field': 'OWNERSHIP',
        'out_sr': 4326,
    },
    {
        'name': 'ADOT Fiber Optic Conduit',
        'url': 'https://services8.arcgis.com/bspqcASG7WIqqFvk/arcgis/rest/services/ADOT_State_Owned_Fiber_Optic_Conduit_Routes/FeatureServer/117',
        'prefix': 'az_adot',
        'state': 'AZ',
        'name_field': 'Name',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'FL Boca Raton Fiber',
        'url': 'https://services3.arcgis.com/N05eA1HiHmPyDFBQ/arcgis/rest/services/COUNTY_FIBER_OPTIC_NETWORK/FeatureServer/5',
        'prefix': 'fl_boca',
        'state': 'FL',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'RI TMC Fiber Lines',
        'url': 'https://services6.arcgis.com/70X0jB6UtsfE8L2y/arcgis/rest/services/Rhode_Island_Network_Overview/FeatureServer/10',
        'prefix': 'ri_tmc',
        'state': 'RI',
        'name_field': 'LAYER',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'VA Bedford County MBC Fiber',
        'url': 'https://services3.arcgis.com/DXCmCcRcEQ793kMP/arcgis/rest/services/MBC_Existing_Fiber/FeatureServer/0',
        'prefix': 'va_mbc',
        'state': 'VA',
        'name_field': 'Name',
        'operator_field': None,
        'out_sr': 4326,
    },
    # --- Round 2: Research agent discoveries ---
    {
        'name': 'UDOT Fiber Network (MapServer)',
        'url': 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6',
        'prefix': 'ut_udot_ms',
        'state': 'UT',
        'name_field': 'DESCR',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'UDOT Conduit Network (MapServer)',
        'url': 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/7',
        'prefix': 'ut_udot_conduit',
        'state': 'UT',
        'name_field': 'DESCR',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'Hillsboro OR Fiber Conduit',
        'url': 'https://services1.arcgis.com/eQ2vvbCvmxlIgo3a/arcgis/rest/services/Conduit_Utilities/FeatureServer/980470',
        'prefix': 'or_hillsboro',
        'state': 'OR',
        'name_field': 'LocationName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Maryland Broadband Cooperative',
        'url': 'https://services1.arcgis.com/X3lKekbdaBmNjCHu/arcgis/rest/services/mdbc_net/FeatureServer/0',
        'prefix': 'md_mdbc',
        'state': 'MD',
        'name_field': 'FiberRoute',
        'operator_field': 'FIBEROWNER',
        'out_sr': 4326,
    },
    {
        'name': 'San Jacinto River Authority Fiber (TX)',
        'url': 'https://services2.arcgis.com/w2TRse9XgbPXdXc6/arcgis/rest/services/Transmission_Fiber/FeatureServer/4',
        'prefix': 'tx_sjra',
        'state': 'TX',
        'name_field': 'St_Name',
        'operator_field': 'Contractor',
        'out_sr': 4326,
    },
    {
        'name': 'Santa Barbara CA Fiber Cables',
        'url': 'https://services3.arcgis.com/hMpg7vsYb74pEKjX/arcgis/rest/services/Fiber_Review_WFL1/FeatureServer/2',
        'prefix': 'ca_santabarbara',
        'state': 'CA',
        'name_field': 'CABLE_ID',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Kane County IL DOT Fiber',
        'url': 'https://services1.arcgis.com/oRKmdBXD6EbdmVgJ/arcgis/rest/services/KaneFiber_Fiber_10012018_VWRO_20230104/FeatureServer/0',
        'prefix': 'il_kane',
        'state': 'IL',
        'name_field': 'DESCR',
        'operator_field': 'FIBER_OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'OH MVECA Fiber Network',
        'url': 'https://services.arcgis.com/M5UrDFRz2ZRTplQC/arcgis/rest/services/Fiber_MVECA_Update_2_view/FeatureServer/0',
        'prefix': 'oh_mveca',
        'state': 'OH',
        'name_field': 'CableName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Clinton County OH Fiber Routes',
        'url': 'https://services5.arcgis.com/0Zxdzkr2RDoDbXEQ/arcgis/rest/services/Proposed_Fiber_Routes/FeatureServer/2',
        'prefix': 'oh_clinton',
        'state': 'OH',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Johns Creek GA ITS Conduit',
        'url': 'https://services1.arcgis.com/bqfNVPUK3HOnCFmA/arcgis/rest/services/ITS_Network/FeatureServer/1',
        'prefix': 'ga_johnscreek',
        'state': 'GA',
        'name_field': 'StreetName',
        'operator_field': 'Ownership',
        'out_sr': 4326,
    },
    {
        'name': 'Macon-Bibb County GA Fiber',
        'url': 'https://services2.arcgis.com/zPFLSOZ5HzUzzTQb/arcgis/rest/services/FiberOpticSystem/FeatureServer/4',
        'prefix': 'ga_maconbibb',
        'state': 'GA',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Oakland CA Fiber Routes',
        'url': 'https://services.arcgis.com/9tC74aDHuml0x5Yz/arcgis/rest/services/OaklandFiberRoutes/FeatureServer/0',
        'prefix': 'ca_oakland',
        'state': 'CA',
        'name_field': 'path',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Scott County IA Fiber',
        'url': 'https://services.arcgis.com/ovln19YRWV44nBqV/arcgis/rest/services/Fiber_Optic/FeatureServer/1',
        'prefix': 'ia_scott',
        'state': 'IA',
        'name_field': 'CableName',
        'operator_field': 'Owner',
        'out_sr': 4326,
    },
    {
        'name': 'Longmont CO Fiber Lines',
        'url': 'https://services1.arcgis.com/Sb0rgSd67ecLKIvl/arcgis/rest/services/FiberLines/FeatureServer/0',
        'prefix': 'co_longmont',
        'state': 'CO',
        'name_field': 'Layer',
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Fishers IN Fiber Lines',
        'url': 'https://maps.fishers.in.us/arcgis/rest/services/Fiber/MapServer/1',
        'prefix': 'in_fishers',
        'state': 'IN',
        'name_field': 'TYPE',
        'operator_field': 'OWNER',
        'out_sr': 4326,
    },
    {
        'name': 'Wood County WI Fiber',
        'url': 'https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/FiberOptic_proposed/FeatureServer/0',
        'prefix': 'wi_wood',
        'state': 'WI',
        'name_field': None,
        'operator_field': None,
        'out_sr': 4326,
    },
    {
        'name': 'Charlotte NC ITS Fiber Projects',
        'url': 'https://services.arcgis.com/9Nl857LBlQVyzq54/arcgis/rest/services/CDOT_ITS_Projects/FeatureServer/0',
        'prefix': 'nc_charlotte',
        'state': 'NC',
        'name_field': 'ProjectName',
        'operator_field': None,
        'out_sr': 4326,
    },
]

# US regions (bounding boxes) to query separately to avoid Overpass timeout
# Format: (name, south, west, north, east)
US_REGIONS = [
    ("NE_coast",     40.0, -77.0,  45.0, -66.5),
    ("NE_inland",    37.0, -80.0,  42.0, -74.0),
    ("Mid_Atlantic", 35.0, -80.0,  40.0, -74.0),
    ("SE_east",      24.0, -84.0,  35.0, -75.0),
    ("SE_west",      29.0, -91.5,  35.0, -84.0),
    ("Great_Lakes",  41.0, -92.0,  48.5, -80.0),
    ("Upper_MW",     43.0, -104.5, 49.0, -92.0),
    ("Central",      35.0, -104.5, 43.0, -92.0),
    ("South_Central",25.5, -107.0, 37.0, -91.5),
    ("Mountain_N",   40.0, -117.0, 49.0, -104.5),
    ("Mountain_S",   31.0, -117.0, 40.0, -104.5),
    ("Pacific_N",    42.0, -125.5, 49.0, -117.0),
    ("Pacific_S",    32.0, -125.5, 42.0, -117.0),
    ("Alaska",       50.0, -180.0, 72.0, -129.0),
    ("Hawaii",       18.5, -161.0, 22.5, -154.5),
]


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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:200]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def load_paginated(table, select='*', filters='', page_size=1000):
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path, headers_extra={
            'Prefer': 'count=exact',
            'Range-Unit': 'items',
        })
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


# ── Haversine math ──────────────────────────────────────────────

def haversine(lat1, lng1, lat2, lng2):
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_to_segment_distance(plat, plng, slat1, slng1, slat2, slng2):
    mid_lat = (slat1 + slat2) / 2.0
    cos_lat = math.cos(math.radians(mid_lat))
    km_per_deg_lat = 111.32
    km_per_deg_lng = 111.32 * cos_lat
    bx = (slng2 - slng1) * km_per_deg_lng
    by = (slat2 - slat1) * km_per_deg_lat
    px = (plng - slng1) * km_per_deg_lng
    py = (plat - slat1) * km_per_deg_lat
    seg_len_sq = bx * bx + by * by
    if seg_len_sq < 1e-12:
        return haversine(plat, plng, slat1, slng1)
    t = max(0.0, min(1.0, (px * bx + py * by) / seg_len_sq))
    closest_lng = slng1 + t * (slng2 - slng1)
    closest_lat = slat1 + t * (slat2 - slat1)
    return haversine(plat, plng, closest_lat, closest_lng)


# ── Phase 1: Download from Overpass ────────────────────────────

def query_overpass_region(name, south, west, north, east):
    """Query Overpass for fiber routes in a bounding box."""
    bbox = f"{south},{west},{north},{east}"
    query = f"""
[out:json][timeout:300];
(
  way["telecom:medium"="fibre"]({bbox});
  way["communication"="line"]["substance"="fibre_optic"]({bbox});
  way["utility"="telecom"]["cables"]({bbox});
  way["telecom"="cable"]({bbox});
  way["man_made"="submarine_cable"]["telecom:medium"="fibre"]({bbox});
  way["route"="pipeline"]["utility"="telecom"]({bbox});
);
out geom;
"""
    data = urllib.parse.urlencode({'data': query}).encode()
    req = urllib.request.Request(
        OVERPASS_URL, data=data,
        headers={'User-Agent': 'GridScout/1.0', 'Content-Type': 'application/x-www-form-urlencoded'}
    )

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=360, context=SSL_CTX) as resp:
                result = json.loads(resp.read().decode())
            elements = result.get('elements', [])
            return elements
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code == 429:
                wait = 30 * (attempt + 1)
                print(f"    Rate limited. Waiting {wait}s...")
                time.sleep(wait)
                continue
            if e.code in (504, 500) and attempt < 2:
                wait = 20 * (attempt + 1)
                print(f"    Timeout/error ({e.code}). Retrying in {wait}s...")
                time.sleep(wait)
                continue
            print(f"    HTTP {e.code}: {err_body[:300]}")
            raise
        except Exception as e:
            if attempt < 2:
                wait = 15 * (attempt + 1)
                print(f"    Error: {e}. Retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise

    return []


def download_fiber_routes():
    """Fetch fiber routes from Overpass API for all US regions."""
    print("\n[Phase 1] Downloading fiber routes from OSM Overpass API...")

    all_routes = {}  # osm_id -> route dict (dedup across regions)

    for region_name, south, west, north, east in US_REGIONS:
        print(f"\n  Querying {region_name} ({south},{west} to {north},{east})...")
        try:
            elements = query_overpass_region(region_name, south, west, north, east)
        except Exception as e:
            print(f"    FAILED: {e}")
            continue

        added = 0
        for elem in elements:
            if elem.get('type') != 'way':
                continue
            osm_id = elem.get('id')
            if not osm_id or osm_id in all_routes:
                continue

            geom = elem.get('geometry', [])
            if len(geom) < 2:
                continue

            tags = elem.get('tags', {})
            coords = [[pt['lon'], pt['lat']] for pt in geom]

            # Filter out routes clearly outside US (e.g., Canadian border spillover)
            mid_pt = geom[len(geom) // 2]
            mid_lat, mid_lng = mid_pt['lat'], mid_pt['lon']
            if mid_lat > 72.0 or mid_lat < 17.5 or mid_lng > -60.0 or mid_lng < -180.0:
                continue

            route = {
                'osm_id': osm_id,
                'name': tags.get('name') or tags.get('ref') or None,
                'operator': tags.get('operator') or tags.get('owner') or None,
                'fiber_type': None,
                'location_type': None,
                'coords': coords,
            }

            # Derive fiber_type
            ft = tags.get('telecom:medium', '') or tags.get('substance', '')
            if 'single' in ft.lower():
                route['fiber_type'] = 'single-mode'
            elif 'multi' in ft.lower():
                route['fiber_type'] = 'multi-mode'
            elif ft:
                route['fiber_type'] = 'fibre'

            # Derive location_type
            loc = tags.get('location', '') or tags.get('telecom:location', '')
            if loc.lower() in ('underground', 'buried'):
                route['location_type'] = 'underground'
            elif loc.lower() in ('overhead', 'aerial', 'overground'):
                route['location_type'] = 'overhead'
            elif loc.lower() in ('submarine', 'underwater'):
                route['location_type'] = 'submarine'

            all_routes[osm_id] = route
            added += 1

        print(f"    Found {len(elements)} elements, {added} new routes")
        # Be kind to the Overpass server
        time.sleep(5)

    routes_list = list(all_routes.values())
    print(f"\n  Total unique fiber routes: {len(routes_list)}")

    # Derive approximate state from centroid
    from collections import defaultdict
    # Simple bounding boxes for US states (approximate centroids for route assignment)
    for route in routes_list:
        coords = route['coords']
        mid_idx = len(coords) // 2
        mid_lat = coords[mid_idx][1]
        mid_lng = coords[mid_idx][0]
        route['centroid_lat'] = mid_lat
        route['centroid_lng'] = mid_lng

    # Cache to file
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(routes_list, f)
    file_mb = os.path.getsize(CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {CACHE_FILE} ({file_mb:.1f} MB)")

    return routes_list


def load_cached_routes():
    print(f"\n[Phase 1] Loading cached fiber routes from {CACHE_FILE}...")
    with open(CACHE_FILE, 'r') as f:
        routes = json.load(f)
    print(f"  Loaded {len(routes)} routes from cache")
    return routes


# ── Phase 1b: Download from ArcGIS FeatureServer ─────────────

def fetch_arcgis_fiber(source):
    """Fetch all fiber routes from an ArcGIS FeatureServer endpoint."""
    base_url = source['url']
    name = source['name']
    prefix = source['prefix']
    out_sr = source.get('out_sr', 4326)
    name_field = source.get('name_field', 'Name')
    operator_field = source.get('operator_field', 'Provider')

    print(f"\n  Fetching {name}...")

    # First get record count
    count_url = f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json"
    req = urllib.request.Request(count_url, headers={'User-Agent': 'GridScout/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
            count_data = json.loads(resp.read().decode())
        total = count_data.get('count', 0)
        print(f"    Total records: {total}")
    except Exception as e:
        print(f"    Failed to get count: {e}")
        total = 0

    # Fetch in pages of 1000 (ArcGIS default max)
    all_features = []
    offset = 0
    page_size = 1000

    while True:
        params = urllib.parse.urlencode({
            'where': '1=1',
            'outFields': '*',
            'outSR': out_sr,
            'f': 'geojson',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        })
        query_url = f"{base_url}/query?{params}"
        req = urllib.request.Request(query_url, headers={'User-Agent': 'GridScout/1.0'})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
                    data = json.loads(resp.read().decode())
                break
            except Exception as e:
                if attempt < 2:
                    wait = 10 * (attempt + 1)
                    print(f"    Error at offset {offset}: {e}. Retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"    FAILED at offset {offset}: {e}")
                    data = {'features': []}

        features = data.get('features', [])
        if not features:
            break

        all_features.extend(features)
        offset += len(features)

        if offset % 5000 == 0 or len(features) < page_size:
            print(f"    Fetched {offset} features...")

        if len(features) < page_size:
            break

        time.sleep(0.5)  # Be kind to the server

    print(f"    Total features fetched: {len(all_features)}")

    # Convert to route format
    routes = []
    for feat in all_features:
        geom = feat.get('geometry')
        props = feat.get('properties', {})
        if not geom:
            continue

        geom_type = geom.get('type', '')
        coords = geom.get('coordinates', [])

        if geom_type == 'LineString':
            if len(coords) < 2:
                continue
        elif geom_type == 'MultiLineString':
            # Flatten to longest segment for centroid, keep full geom
            if not coords or all(len(line) < 2 for line in coords):
                continue
        else:
            continue  # Skip points/polygons

        # Get centroid from geometry
        if geom_type == 'LineString':
            mid_idx = len(coords) // 2
            centroid_lng, centroid_lat = coords[mid_idx][0], coords[mid_idx][1]
        else:
            # MultiLineString — use midpoint of longest segment
            longest = max(coords, key=len) if coords else coords[0]
            mid_idx = len(longest) // 2
            centroid_lng, centroid_lat = longest[mid_idx][0], longest[mid_idx][1]

        # Generate unique source record ID
        # Use feature OID if available, otherwise hash of coords
        oid = props.get('OBJECTID') or props.get('FID') or props.get('objectid')
        if oid:
            src_id = f"{prefix}_fiber_{oid}"
        else:
            coord_hash = hash(json.dumps(coords[:3]))
            src_id = f"{prefix}_fiber_{abs(coord_hash)}"

        # Case-insensitive field lookup
        props_lower = {k.lower(): v for k, v in props.items()}
        route_name = None
        if name_field:
            route_name = props.get(name_field) or props.get(name_field.lower()) or props_lower.get(name_field.lower()) or None
        operator = None
        if operator_field:
            operator = props.get(operator_field) or props.get(operator_field.lower()) or props_lower.get(operator_field.lower()) or None

        # Clean up name/operator
        if route_name and str(route_name).strip() in ('None', 'null', '', 'N/A'):
            route_name = None
        if operator and str(operator).strip() in ('None', 'null', '', 'N/A'):
            operator = None

        route = {
            'source_record_id': src_id,
            'name': str(route_name).strip() if route_name else None,
            'operator': str(operator).strip() if operator else None,
            'fiber_type': source.get('fiber_type_override', 'fibre'),
            'location_type': None,
            'source': prefix,
            'state': source.get('state'),
            'centroid_lat': centroid_lat,
            'centroid_lng': centroid_lng,
            'geometry': geom,  # Full GeoJSON geometry
        }

        routes.append(route)

    print(f"    Converted {len(routes)} valid routes")
    return routes


def download_arcgis_fiber():
    """Fetch fiber routes from all ArcGIS FeatureServer endpoints."""
    print("\n[Phase 1b] Downloading fiber routes from ArcGIS FeatureServer endpoints...")

    all_routes = []
    for source in ARCGIS_FIBER_SOURCES:
        try:
            routes = fetch_arcgis_fiber(source)
            all_routes.extend(routes)
        except Exception as e:
            print(f"  FAILED {source['name']}: {e}")
            continue

    print(f"\n  Total ArcGIS routes: {len(all_routes)}")

    # Cache to file
    os.makedirs(os.path.dirname(ARCGIS_CACHE_FILE), exist_ok=True)
    with open(ARCGIS_CACHE_FILE, 'w') as f:
        json.dump(all_routes, f)
    file_mb = os.path.getsize(ARCGIS_CACHE_FILE) / (1024 * 1024)
    print(f"  Cached to {ARCGIS_CACHE_FILE} ({file_mb:.1f} MB)")

    return all_routes


def load_cached_arcgis_routes():
    print(f"\n[Phase 1b] Loading cached ArcGIS fiber routes from {ARCGIS_CACHE_FILE}...")
    with open(ARCGIS_CACHE_FILE, 'r') as f:
        routes = json.load(f)
    print(f"  Loaded {len(routes)} routes from cache")
    return routes


# ── Phase 2: Insert into Supabase ──────────────────────────────

def create_table_if_needed():
    """Create grid_fiber_routes table via psql if it doesn't exist."""
    sql = """
CREATE TABLE IF NOT EXISTS grid_fiber_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT,
    operator TEXT,
    fiber_type TEXT,
    location_type TEXT,
    source TEXT DEFAULT 'osm',
    source_record_id TEXT UNIQUE,
    geometry_json JSONB,
    centroid_lat NUMERIC(10,7),
    centroid_lng NUMERIC(10,7),
    state TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grid_fiber_routes_state ON grid_fiber_routes(state);
CREATE INDEX IF NOT EXISTS idx_grid_fiber_routes_centroid ON grid_fiber_routes(centroid_lat, centroid_lng);

-- Add nearest_fiber_km column to dc_sites if not exists
DO $$ BEGIN
    ALTER TABLE grid_dc_sites ADD COLUMN nearest_fiber_km NUMERIC(8,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
"""
    env = os.environ.copy()
    env['PGPASSWORD'] = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-c', sql],
        capture_output=True, text=True, env=env, timeout=120
    )
    if result.returncode != 0:
        print(f"  psql table creation error: {result.stderr[:500]}")
        return False
    print("  Table grid_fiber_routes ready, nearest_fiber_km column ready")
    return True


def assign_states_from_db(routes):
    """
    Assign state to each route by reverse lookup from grid_dc_sites.
    Uses nearest DC site's state as proxy.
    """
    print("  Loading DC site locations for state assignment...")
    # Load a sample of sites (one per grid cell is enough)
    sites = load_paginated(
        'grid_dc_sites',
        'state,latitude,longitude',
        '&latitude=not.is.null&longitude=not.is.null&limit=50000'
    )
    if not sites:
        print("  WARNING: No DC site data for state assignment")
        return

    # Build grid index for site state lookups (keep one site per cell)
    state_grid = {}
    for s in sites:
        cell = (int(math.floor(s['latitude'])), int(math.floor(s['longitude'])))
        if cell not in state_grid:
            state_grid[cell] = s

    assigned = 0
    for route in routes:
        lat = route.get('centroid_lat')
        lng = route.get('centroid_lng')
        if not lat or not lng:
            continue
        cell_lat = int(math.floor(lat))
        cell_lng = int(math.floor(lng))
        best_state = None
        best_dist = float('inf')
        for dlat in range(-2, 3):
            for dlng in range(-2, 3):
                cell = (cell_lat + dlat, cell_lng + dlng)
                s = state_grid.get(cell)
                if s:
                    d = haversine(lat, lng, s['latitude'], s['longitude'])
                    if d < best_dist:
                        best_dist = d
                        best_state = s['state']
        if best_state and best_dist < 200:  # Only assign if within 200 km
            route['state'] = best_state
            assigned += 1

    print(f"  Assigned state to {assigned}/{len(routes)} routes")


def insert_routes(routes, dry_run=False):
    """Insert routes into grid_fiber_routes via psql COPY for speed."""
    print(f"\n[Phase 2] Inserting {len(routes)} fiber routes into grid_fiber_routes...")

    if dry_run:
        print(f"  DRY RUN: Would insert {len(routes)} routes")
        for r in routes[:5]:
            label = r.get('source_record_id') or f"osm_{r.get('osm_id', '?')}"
            print(f"    {label}: {r.get('name', 'unnamed')} ({r.get('operator', 'unknown')}), "
                  f"source={r.get('source', 'osm')}, state={r.get('state')}")
        return

    # Use psql COPY via temp CSV approach
    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_fiber_insert.sql')

    chunk_size = 5000  # Commit every 5000 rows to avoid long transactions
    with open(sql_file, 'w') as f:
        f.write("-- Fiber routes bulk insert\n")
        f.write("BEGIN;\n")

        for i, route in enumerate(routes):
            # Determine source_record_id and geometry based on route source
            if 'osm_id' in route:
                # OSM route
                src_id = f"osm_fiber_{route['osm_id']}"
                source = 'osm'
                geojson = json.dumps({
                    "type": "LineString",
                    "coordinates": route['coords']
                })
            else:
                # ArcGIS route
                src_id = route['source_record_id']
                source = route.get('source', 'arcgis')
                geojson = json.dumps(route['geometry'])

            name = (route.get('name') or '').replace("'", "''").replace("\\", "\\\\")
            operator = (route.get('operator') or '').replace("'", "''").replace("\\", "\\\\")
            fiber_type = (route.get('fiber_type') or '').replace("'", "''")
            location_type = (route.get('location_type') or '').replace("'", "''")
            state = route.get('state') or ''
            centroid_lat = route.get('centroid_lat') or 'NULL'
            centroid_lng = route.get('centroid_lng') or 'NULL'
            # Escape the geojson for SQL (single quotes)
            geojson_escaped = geojson.replace("'", "''")

            f.write(
                f"INSERT INTO grid_fiber_routes "
                f"(name, operator, fiber_type, location_type, source, source_record_id, "
                f"geometry_json, centroid_lat, centroid_lng, state) "
                f"VALUES ("
                f"NULLIF('{name}',''), "
                f"NULLIF('{operator}',''), "
                f"NULLIF('{fiber_type}',''), "
                f"NULLIF('{location_type}',''), "
                f"'{source}', "
                f"'{src_id}', "
                f"'{geojson_escaped}'::jsonb, "
                f"{centroid_lat}, "
                f"{centroid_lng}, "
                f"NULLIF('{state}','')) "
                f"ON CONFLICT (source_record_id) DO NOTHING;\n"
            )

            # Commit in chunks to avoid long transactions
            if (i + 1) % chunk_size == 0:
                f.write("COMMIT;\nBEGIN;\n")
                print(f"  Generated SQL for {i + 1}/{len(routes)} routes...")

        f.write("COMMIT;\n")
        f.write("SELECT COUNT(*) AS total_routes FROM grid_fiber_routes;\n")

    # Split into chunk files and run sequentially for reliability
    chunk_files = []
    file_idx = 0
    current_file = None
    current_count = 0
    chunk_limit = 5000  # rows per file

    with open(sql_file, 'r') as f:
        for line in f:
            if current_file is None:
                chunk_name = sql_file.replace('.sql', f'_{file_idx}.sql')
                current_file = open(chunk_name, 'w')
                current_file.write("BEGIN;\n")
                chunk_files.append(chunk_name)
                current_count = 0

            if line.startswith('INSERT INTO'):
                current_count += 1

            if line.startswith('COMMIT;') and current_count >= chunk_limit:
                current_file.write("COMMIT;\n")
                current_file.close()
                current_file = None
                file_idx += 1
                continue

            if not line.startswith('BEGIN;') and not line.startswith('--'):
                current_file.write(line)

    if current_file:
        current_file.write("COMMIT;\n")
        current_file.close()

    # Remove original large file
    try:
        os.remove(sql_file)
    except OSError:
        pass

    # Add count query to last chunk
    if chunk_files:
        with open(chunk_files[-1], 'a') as f:
            f.write("SELECT COUNT(*) AS total_routes FROM grid_fiber_routes;\n")

    env = os.environ.copy()
    env['PGPASSWORD'] = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')

    total_inserted = 0
    for ci, chunk_file in enumerate(chunk_files):
        chunk_mb = os.path.getsize(chunk_file) / (1024 * 1024)
        print(f"  Running chunk {ci + 1}/{len(chunk_files)} ({chunk_mb:.1f} MB)...")

        result = subprocess.run(
            ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
             '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
             '-f', chunk_file],
            capture_output=True, text=True, env=env, timeout=600
        )

        if result.returncode != 0:
            print(f"    psql error: {result.stderr[:500]}")
        else:
            lines = result.stdout.strip().split('\n')
            for line in lines[-3:]:
                if line.strip():
                    print(f"    {line.strip()}")

        try:
            os.remove(chunk_file)
        except OSError:
            pass


# ── Phase 3: Compute nearest fiber distance ───────────────────

def build_spatial_index(routes):
    """Build grid index mapping 1-degree cells to route indices."""
    print("\n  Building spatial grid index...")
    grid = {}
    for idx, route in enumerate(routes):
        cells_seen = set()
        for coord in route['coords']:
            lng, lat = coord[0], coord[1]
            cell = (int(math.floor(lat)), int(math.floor(lng)))
            if cell not in cells_seen:
                cells_seen.add(cell)
                if cell not in grid:
                    grid[cell] = []
                grid[cell].append(idx)
    print(f"  Index covers {len(grid)} grid cells")
    return grid


def get_nearby_indices(grid, lat, lng):
    search_cells = int(math.ceil(MAX_SEARCH_KM / 111.0)) + 1
    center_lat = int(math.floor(lat))
    center_lng = int(math.floor(lng))
    indices = set()
    for dlat in range(-search_cells, search_cells + 1):
        for dlng in range(-search_cells, search_cells + 1):
            cell = (center_lat + dlat, center_lng + dlng)
            if cell in grid:
                for idx in grid[cell]:
                    indices.add(idx)
    return indices


def find_nearest_fiber(lat, lng, routes, grid_index):
    nearby = get_nearby_indices(grid_index, lat, lng)
    if not nearby:
        return None
    min_dist = float('inf')
    for idx in nearby:
        coords = routes[idx]['coords']
        for i in range(len(coords) - 1):
            lng1, lat1 = coords[i][0], coords[i][1]
            lng2, lat2 = coords[i + 1][0], coords[i + 1][1]
            d = point_to_segment_distance(lat, lng, lat1, lng1, lat2, lng2)
            if d < min_dist:
                min_dist = d
                if min_dist < 0.01:
                    return round(min_dist, 2)
    return round(min_dist, 2) if min_dist < float('inf') else None


def compute_fiber_proximity(routes, dry_run=False):
    """Compute nearest fiber route distance for all DC sites."""
    grid_index = build_spatial_index(routes)

    print(f"\n[Phase 3] Loading grid_dc_sites...")
    # Try loading with nearest_fiber_km; if column doesn't exist yet, load without it
    try:
        sites = load_paginated(
            'grid_dc_sites',
            'id,latitude,longitude,nearest_fiber_km',
            '&latitude=not.is.null&longitude=not.is.null'
        )
    except Exception:
        print("  Column nearest_fiber_km not found — loading without it (all sites will be processed)")
        sites = load_paginated(
            'grid_dc_sites',
            'id,latitude,longitude',
            '&latitude=not.is.null&longitude=not.is.null'
        )
    print(f"  Loaded {len(sites)} sites with coordinates")

    sites_to_process = [s for s in sites if s.get('nearest_fiber_km') is None]
    print(f"  {len(sites_to_process)} sites need fiber distance")

    if not sites_to_process:
        print("  Nothing to do. All sites already have nearest_fiber_km.")
        return

    print(f"\n  Calculating nearest fiber distance for {len(sites_to_process)} sites...")
    results = {}
    no_fiber = 0
    t0 = time.time()

    for i, site in enumerate(sites_to_process):
        dist = find_nearest_fiber(site['latitude'], site['longitude'], routes, grid_index)
        if dist is not None:
            results[site['id']] = dist
        else:
            no_fiber += 1

        if (i + 1) % 1000 == 0 or (i + 1) == len(sites_to_process):
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  Progress: {i + 1}/{len(sites_to_process)} "
                  f"({len(results)} found, {no_fiber} no fiber nearby, "
                  f"{rate:.0f} sites/sec)")

    print(f"\n  Final: {len(results)} with fiber distance, {no_fiber} no fiber within {MAX_SEARCH_KM} km")

    if not results:
        print("  No results to patch.")
        return

    # Stats
    distances = sorted(results.values())
    n = len(distances)
    print(f"\n  Distance statistics:")
    print(f"    Min:    {distances[0]:.2f} km")
    print(f"    Max:    {distances[-1]:.2f} km")
    print(f"    Mean:   {sum(distances) / n:.2f} km")
    print(f"    Median: {distances[n // 2]:.2f} km")
    print(f"    p10:    {distances[int(n * 0.1)]:.2f} km")
    print(f"    p90:    {distances[int(n * 0.9)]:.2f} km")

    if dry_run:
        for site_id, dist in list(results.items())[:10]:
            print(f"  Would patch {site_id}: nearest_fiber_km={dist}")
        print(f"\n  Would patch {len(results)} sites total")
        return

    # Patch via psql bulk UPDATE
    print(f"\n  Patching {len(results)} sites via psql...")
    sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', '_fiber_proximity_update.sql')
    with open(sql_file, 'w') as f:
        f.write("CREATE TEMP TABLE _fiber_dist (id UUID, dist NUMERIC(8,2));\n")
        f.write("COPY _fiber_dist (id, dist) FROM STDIN;\n")
        for site_id, dist in results.items():
            f.write(f"{site_id}\t{dist}\n")
        f.write("\\.\n")
        f.write("UPDATE grid_dc_sites SET nearest_fiber_km = _fiber_dist.dist "
                "FROM _fiber_dist WHERE grid_dc_sites.id = _fiber_dist.id;\n")
        f.write("SELECT COUNT(*) AS updated FROM grid_dc_sites "
                "WHERE nearest_fiber_km IS NOT NULL;\n")

    env = os.environ.copy()
    env['PGPASSWORD'] = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-f', sql_file],
        capture_output=True, text=True, env=env, timeout=120
    )

    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    else:
        print(f"  psql output: {result.stdout.strip()}")

    try:
        os.remove(sql_file)
    except OSError:
        pass

    print(f"\nDone! {len(results)} sites patched with nearest_fiber_km.")


# ── Main ──────────────────────────────────────────────────────

def print_coverage_stats(routes, label=""):
    from collections import Counter
    states = Counter(r.get('state') for r in routes if r.get('state'))
    operators = Counter(r.get('operator') for r in routes if r.get('operator'))
    sources = Counter(r.get('source', 'osm') for r in routes)
    named = sum(1 for r in routes if r.get('name'))
    with_operator = sum(1 for r in routes if r.get('operator'))

    print(f"\n  Coverage summary{' (' + label + ')' if label else ''}:")
    print(f"    Total routes:    {len(routes)}")
    print(f"    Named routes:    {named}")
    print(f"    With operator:   {with_operator}")
    print(f"    States covered:  {len(states)}")
    if sources:
        print(f"    By source:")
        for src, cnt in sources.most_common():
            print(f"      {src}: {cnt}")
    if states:
        print(f"    Top 10 states:")
        for st, cnt in states.most_common(10):
            print(f"      {st}: {cnt}")
    if operators:
        print(f"    Top 10 operators:")
        for op, cnt in operators.most_common(10):
            print(f"      {op}: {cnt}")


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv
    skip_insert = '--skip-insert' in sys.argv
    arcgis_only = '--arcgis-only' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Ingest Fiber Optic Routes")
    print("=" * 55)

    all_routes = []

    # Phase 1a: OSM routes (unless --arcgis-only)
    if not arcgis_only:
        if skip_download and os.path.exists(CACHE_FILE):
            osm_routes = load_cached_routes()
        else:
            osm_routes = download_fiber_routes()
        all_routes.extend(osm_routes)
        print_coverage_stats(osm_routes, "OSM")

    # Phase 1b: ArcGIS FeatureServer routes
    if skip_download and os.path.exists(ARCGIS_CACHE_FILE):
        arcgis_routes = load_cached_arcgis_routes()
    else:
        arcgis_routes = download_arcgis_fiber()
    all_routes.extend(arcgis_routes)
    print_coverage_stats(arcgis_routes, "ArcGIS")

    if not all_routes:
        print("ERROR: No fiber routes found.")
        return

    # Combined stats
    print_coverage_stats(all_routes, "Combined")

    # Phase 2: Store in DB
    if not skip_insert:
        if not dry_run:
            print("\n  Creating table if needed...")
            try:
                create_table_if_needed()
            except Exception as e:
                print(f"  Table creation skipped (likely already exists): {e}")
            # Assign states to OSM routes that don't have them
            osm_no_state = [r for r in all_routes if r.get('source', 'osm') == 'osm' and not r.get('state')]
            if osm_no_state:
                assign_states_from_db(osm_no_state)
            # Assign states to NTIA/national routes that don't have them
            national_no_state = [r for r in all_routes if not r.get('state') and r.get('source') != 'osm']
            if national_no_state:
                assign_states_from_db(national_no_state)
        insert_routes(all_routes, dry_run=dry_run)

    # Phase 3: Compute proximity (need all routes for spatial index)
    # For ArcGIS routes, convert geometry to coords format for spatial index
    for route in all_routes:
        if 'coords' not in route and 'geometry' in route:
            geom = route['geometry']
            if geom.get('type') == 'LineString':
                route['coords'] = geom['coordinates']
            elif geom.get('type') == 'MultiLineString':
                # Flatten all segments into one coordinate list for proximity
                route['coords'] = [c for line in geom['coordinates'] for c in line]
            else:
                route['coords'] = []

    compute_fiber_proximity(all_routes, dry_run=dry_run)


if __name__ == '__main__':
    main()

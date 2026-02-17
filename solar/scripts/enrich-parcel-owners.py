#!/usr/bin/env python3
"""
Property Owner Enrichment via Public Parcel Data

Queries free public ArcGIS parcel layers to fill owner_name on solar installations
that have coordinates but no owner. Uses point-in-polygon spatial queries against
state and county parcel services.

Usage:
  python3 -u scripts/enrich-parcel-owners.py                    # All states with endpoints
  python3 -u scripts/enrich-parcel-owners.py --state MT          # Single state
  python3 -u scripts/enrich-parcel-owners.py --state CA --county san_diego  # CA county
  python3 -u scripts/enrich-parcel-owners.py --dry-run           # Preview without patching
  python3 -u scripts/enrich-parcel-owners.py --discover TX       # Auto-discover endpoints for a state
  python3 -u scripts/enrich-parcel-owners.py --list              # List all configured endpoints
"""

import os
import sys
import json
import time
import re
import ssl
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

WORKERS = 20          # Parallel Supabase patches
ARCGIS_WORKERS = 5    # Parallel ArcGIS queries (conservative to avoid rate limits)
ARCGIS_TIMEOUT = 30   # Seconds per ArcGIS query
PAGE_SIZE = 1000      # Supabase pagination

# ---------------------------------------------------------------------------
# ArcGIS Parcel Endpoint Registry
# ---------------------------------------------------------------------------
# Each endpoint: url, owner_field, layer (0 if not specified)
# All endpoints verified to return owner names via point-in-polygon queries

STATEWIDE_ENDPOINTS = {
    "MT": {
        "url": "https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0",
        "owner_field": "OwnerName",
        "type": "MapServer",
    },
    "WI": {
        "url": "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0",
        "owner_field": "OWNERNME1",
        "type": "FeatureServer",
    },
    "NC": {
        "url": "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1",
        "owner_field": "ownname",
        "type": "MapServer",
    },
    "CT": {
        "url": "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0",
        "owner_field": "Owner",
        "type": "FeatureServer",
    },
    "VT": {
        "url": "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0",
        "owner_field": "OWNER1",
        "type": "FeatureServer",
    },
    "FL": {
        "url": "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
        "owner_field": "OWN_NAME",
        "type": "FeatureServer",
        "note": "FDOR Statewide Cadastral (10.8M parcels). Discovered Feb 2026 at services9.",
    },
    "NC": {
        "url": "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
        "owner_field": "ownname",
        "type": "FeatureServer",
        "note": "NC OneMap Parcels. Must use FeatureServer/1 (not MapServer/0). 5.9M parcels.",
    },
    "MT": {
        "url": "https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0",
        "owner_field": "OwnerName",
        "type": "MapServer",
        "note": "Montana statewide (915K parcels). Also has OwnerAddress1-3.",
    },
    "AR": {
        "url": "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6",
        "owner_field": "ownername",
        "type": "FeatureServer",
    },
    "MN": {
        "url": "https://services.arcgis.com/9OIuDHbyhmH91RfZ/arcgis/rest/services/plan_parcels_open_gdb/FeatureServer/0",
        "owner_field": "owner_name",
        "type": "FeatureServer",
        "timeout": 60,
        "note": "Opt-in counties only (~60 of 87). Slow.",
    },
    "MD": {
        "url": "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0",
        "owner_field": "OWNNAME1",
        "type": "MapServer",
    },
    "TX": {
        "url": "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap25_land_parcels_48/MapServer/0",
        "owner_field": "owner_name",
        "type": "MapServer",
        "use_envelope": True,  # Envelope queries required (point queries unreliable)
    },
    "MA": {
        "url": "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer/0",
        "owner_field": "OWNER1",
        "type": "FeatureServer",
        "use_envelope": True,  # Point queries return 0 — must use envelope
        "note": "2.56M parcels. Envelope query required (State Plane CRS).",
    },
    "OH": {
        "url": "https://gis.ohiodnr.gov/arcgis_site2/rest/services/OIT_Services/odnr_landbase_v2/MapServer/4",
        "owner_field": "OWNER1",
        "type": "MapServer",
        "ssl_skip": True,  # Self-signed certificate
        "note": "Self-signed SSL cert. Statewide, has OWNER1 + OWNER2.",
    },
    "NY": {
        "url": "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1",
        "owner_field": "PRIMARY_OWNER",
        "type": "FeatureServer",
        "timeout": 120,
        "workers": 5,
        "note": "Statewide tax parcels. ~35s/query avg. Layer 1 (not 0).",
    },
    "CO": {
        "url": "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0",
        "owner_field": "owner",
        "type": "FeatureServer",
        "use_envelope": True,  # Point queries fail — envelope required
        "note": "Statewide composite (32 counties). Envelope query required.",
    },
}

# California county endpoints (no statewide owner data available — Gov Code 7928.205)
CA_COUNTY_ENDPOINTS = {
    "san_diego": {
        "url": "https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/FeatureServer/0",
        "owner_field": "OWN_NAME1",
        "type": "FeatureServer",
        "use_envelope": True,  # Envelope required — point queries miss due to CRS mismatch
        "note": "San Diego County (~1.09M parcels, 74K gap records). Biggest CA county opportunity.",
    },
    "riverside": {
        "url": "https://content.rcflood.org/arcgis/rest/services/PermitTracker/Parcel_Basemap/MapServer/0",
        "owner_field": "OWNER1_FIRST_NAME",
        "owner_field_2": "OWNER1_LAST_NAME",
        "type": "MapServer",
        "use_envelope": True,
        "timeout": 60,
        "where_clause": "APN <> 'RW'",  # Filter out right-of-way parcels (null owner slivers)
        "note": "Riverside County (840K parcels, 97.5% have owner). Filter RW parcels. ~11K gap records.",
    },
    "san_joaquin": {
        "url": "https://sjmap.org/arcgis/rest/services/PublicWorks/PW_Parcels/MapServer/0",
        "owner_field": "OWNENAME",
        "type": "MapServer",
        "use_envelope": True,
        "note": "San Joaquin County (Stockton). 227K parcels. Envelope queries only.",
    },
}

# Other state county endpoints (for states without statewide layers)
COUNTY_ENDPOINTS = {
    "AZ": {
        "maricopa": {
            "url": "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0",
            "owner_field": "OWNER_NAME",
            "type": "MapServer",
            "note": "Maricopa County Assessor (Phoenix metro). Largest AZ county.",
        },
        "pima": {
            "url": "https://azwatermaps.azwater.gov/arcgis/rest/services/General/Parcels_for_TEST/FeatureServer/6",
            "owner_field": "OWNER_NAME",
            "type": "FeatureServer",
            "note": "Pima County (Tucson) via AZ Water. Layer 6 of 9-county service.",
        },
    },
    "LA": {
        "east_baton_rouge": {
            "url": "https://maps.brla.gov/gis/rest/services/Cadastral/Tax_Parcel/MapServer/0",
            "owner_field": "OWNER",
            "type": "MapServer",
            "use_envelope": True,
            "note": "East Baton Rouge Parish (~225K parcels). Largest LA parish with public API.",
        },
        "orleans": {
            "url": "https://gis.nola.gov/arcgis/rest/services/ParcelSearch/MapServer/0",
            "owner_field": "OWNERNME1",
            "type": "MapServer",
            "ssl_skip": True,
            "skip_record_count": True,  # Old ArcGIS rejects resultRecordCount param
            "note": "Orleans Parish (New Orleans, 162K parcels). ALL 14K LA gap records are here. Self-signed SSL cert.",
        },
    },
    "IN": {
        "marion": {
            "url": "https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10",
            "owner_field": "FULLOWNERNAME",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Marion County (Indianapolis). Max 1K records.",
        },
    },
    "OR": {
        "portland_metro": {
            "url": "https://services.arcgis.com/uUvqNMGPm7axC2dD/ArcGIS/rest/services/TaxlotsMetro/FeatureServer/0",
            "owner_field": "OWNER1",
            "type": "FeatureServer",
            "note": "Portland Metro (Multnomah, Clackamas, Washington counties).",
        },
        "jackson": {
            "url": "https://services.arcgis.com/uUvqNMGPm7axC2dD/ArcGIS/rest/services/taxlots_jackson/FeatureServer/0",
            "owner_field": "OWNERLINE1",
            "type": "FeatureServer",
            "note": "Jackson County (Medford area).",
        },
    },
    "TN": {
        "davidson": {
            "url": "https://maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0",
            "owner_field": "Owner",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Davidson County (Nashville). Max 10K records.",
        },
        "shelby": {
            "url": "https://gis.shelbycountytn.gov/arcgis/rest/services/Parcel/CERT_Parcel/MapServer/0",
            "owner_field": "OWNER",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Shelby County (Memphis).",
        },
    },
    "SC": {
        "charleston": {
            "url": "https://gisccapps.charlestoncounty.org/arcgis/rest/services/GIS_VIEWER/Public_Search/MapServer/4",
            "owner_field": "OWNER1",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Charleston County. Largest SC coastal county.",
        },
        "greenville": {
            "url": "https://www.gcgis.org/arcgis/rest/services/GCGIA/Greenville_Base/MapServer/37",
            "owner_field": "OWNAM1",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Greenville County.",
        },
        "spartanburg": {
            "url": "https://maps.spartanburgcounty.org/server/rest/services/GIS/CAMA_Parcels/FeatureServer/0",
            "owner_field": "OwnerName",
            "type": "FeatureServer",
            "use_envelope": True,
            "note": "Spartanburg County. 113 fields, very rich data.",
        },
    },
    "GA": {
        "dekalb": {
            "url": "https://dcgis.dekalbcountyga.gov/hosted/rest/services/Parcels/MapServer/0",
            "owner_field": "OWNERNME1",
            "type": "MapServer",
            "use_envelope": True,
            "note": "DeKalb County (east Atlanta metro).",
        },
        "fulton": {
            "url": "https://gismaps.fultoncountyga.gov/arcgispub2/rest/services/PropertyMapViewer/PropertyMapViewer/MapServer/11",
            "owner_field": "Owner",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Fulton County (Atlanta proper).",
        },
    },
    "TX": {
        "travis": {
            "url": "https://taxmaps.traviscountytx.gov/arcgis/rest/services/Parcels/MapServer/0",
            "owner_field": "py_owner_name",
            "type": "MapServer",
            "use_envelope": True,  # CRS mismatch (WKID 2277 NAD83 TX Central in feet)
            "note": "Travis County (Austin) Tax Maps. 373K parcels. All 7.4K TX gap records are here.",
        },
    },
    "MI": {
        "wayne": {
            "url": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
            "owner_field": "taxpayer_1",
            "type": "FeatureServer",
            "use_envelope": True,
            "note": "Wayne County/Detroit city parcels (378K). Detroit only, not all Wayne Co.",
        },
    },
    "NV": {
        "clark": {
            "url": "https://maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AssessorMapv2/MapServer/1",
            "owner_field": "APN",  # Not used directly — html_scrape handler does two-step lookup
            "type": "MapServer",
            "html_scrape": "clark_nv",  # ArcGIS→APN, then ASPX page→Owner
            "timeout": 15,
            "note": "Clark County NV (Las Vegas). Two-step: ArcGIS spatial→APN, ASPX page→owner name. ~3.2K gap records.",
        },
        "washoe": {
            "url": "https://wcgisweb.washoecounty.us/arcgis/rest/services/OpenData/OpenData/MapServer/0",
            "owner_field": "LASTNAME",
            "owner_field_2": "FIRSTNAME",  # Concatenated: FIRSTNAME + LASTNAME
            "type": "MapServer",
            "note": "Washoe County (Reno). Split name fields.",
        },
    },
    "PA": {
        "philadelphia": {
            "url": "https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/OPA_Properties_Public/FeatureServer/0",
            "owner_field": "owner_1",
            "type": "FeatureServer",
            "use_distance": True,  # Point geometry — needs distance=100m radius
            "note": "Philadelphia OPA. Point geometry, uses radius search.",
        },
        "allegheny": {
            "url": "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/AlCoParcels/FeatureServer/0",
            "owner_field": "PROPERTYOWNER",
            "type": "FeatureServer",
            "use_envelope": True,
            "note": "Allegheny County (Pittsburgh). 430K parcels. 1,187 PA gap records here.",
        },
    },
    "VA": {
        "norfolk": {
            "url": "https://gisshare.norfolk.gov/server/rest/services/NORFOLKAIR/AIR_Basemap/MapServer/32",
            "owner_field": "Owner1",
            "type": "MapServer",
            "use_envelope": True,
            "join_table": {
                "url": "https://gisshare.norfolk.gov/server/rest/services/NORFOLKAIR/AIR_Basemap/MapServer/47",
                "join_field": "LRSN",
            },
            "note": "Norfolk City (67K parcels + 74K owner table). Two-step: spatial→LRSN→Owner1.",
        },
        "arlington": {
            "url": "https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/MapServer/5",
            "owner_field": "OWNER1",
            "type": "MapServer",
            "note": "Arlington County (70.9K parcels). Point geometry with lat/lng. 66 fields.",
        },
        "chesterfield": {
            "url": "https://services3.arcgis.com/TsynfzBSE6sXfoLq/arcgis/rest/services/Cadastral_ProdA/FeatureServer/3",
            "owner_field": "OwnerName",
            "type": "FeatureServer",
            "use_envelope": True,
            "note": "Chesterfield County (149K parcels, 99.9% have owner).",
        },
        "spotsylvania": {
            "url": "https://gis.spotsylvania.va.us/arcgis/rest/services/Subdivisions/Subdivisions/MapServer/6",
            "owner_field": "OwnerSearch",
            "type": "MapServer",
            "use_envelope": True,
            "note": "Spotsylvania County (29K parcels, 100% have owner).",
        },
        "prince_william": {
            "url": "https://gisweb.pwcva.gov/arcgis/rest/services/GTS/Cadastral/MapServer/5",
            "owner_field": "CAMA_OWNER_CUR",
            "type": "MapServer",
            "note": "Prince William County. CAMA layer.",
        },
        "richmond_city": {
            "url": "https://services1.arcgis.com/k3vhq11XkBNeeOfM/arcgis/rest/services/Parcels/FeatureServer/0",
            "owner_field": "OwnerName",
            "type": "FeatureServer",
            "use_envelope": True,
            "note": "Richmond City (76.8K parcels). Needs envelope queries.",
        },
    },
    "NM": {
        "bernalillo": {
            "url": "https://coagisweb.cabq.gov/arcgis/rest/services/public/BernCoParcels/MapServer/0",
            "owner_field": "OWNER",
            "type": "MapServer",
            "use_envelope": True,  # Some coordinates miss parcel polygons
            "note": "Bernalillo County (Albuquerque).",
        },
    },
    "DC": {
        "district": {
            "url": "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/MapServer/40",
            "owner_field": "OWNERNAME",
            "type": "MapServer",
            "note": "DC Owner Polygons (OTR). 182 gap records. Max 2K per request.",
        },
    },
    "FL": {
        "miami_dade": {
            "url": "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaParcelView_gdb/FeatureServer/0",
            "owner_field": "TRUE_OWNER1",
            "type": "FeatureServer",
            "note": "Miami-Dade County Property Appraiser (~2,960 gap records).",
        },
        "broward": {
            # URL rotates monthly: BCPA_EXTERNAL_{MON}{YY} — resolved at runtime
            "url": "BROWARD_DYNAMIC",  # Resolved in process_state()
            "owner_field": "SQLGIS02.dbo.BCPA_INFO.NAME_LINE_1",
            "type": "MapServer",
            "skip_record_count": True,  # Broward errors with resultRecordCount
            "note": "Broward County Property Appraiser (~156 gap records). Monthly rotating URL.",
        },
        "leon": {
            "url": "https://intervector.leoncountyfl.gov/intervector/rest/services/MapServices/TLC_OverlayParnal_D_WM/MapServer/0",
            "owner_field": "OWNER1",
            "type": "MapServer",
            "note": "Leon County/Tallahassee (~706 gap records).",
        },
    },
    "KY": {
        "boone": {
            "url": "https://secure.boonecountygis.com/server/rest/services/ServicesBoone/ParcelsGroup_Boone/MapServer/0",
            "owner_field": "PRCLOWNR1",
            "type": "MapServer",
            "use_envelope": True,
            "ssl_skip": True,
            "note": "Boone County KY (55K parcels). Northern KY near Cincinnati.",
        },
    },
    "WA": {
        "snohomish": {
            "url": "https://gis.snoco.org/sas/rest/services/SAS_Services/SAS_Parcels/MapServer/0",
            "owner_field": "Owner_Name",
            "type": "MapServer",
            "use_envelope": True,
            "ssl_skip": True,
            "note": "Snohomish County WA (318K parcels). Owner_Name + Tax_Payer_Name fields.",
        },
    },
    "IL": {
        "dupage": {
            "url": "https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/ParcelsWithRealEstateCC/MapServer/0",
            "owner_field": "BILLNAME",
            "type": "MapServer",
            "use_envelope": True,
            "note": "DuPage County IL (337K parcels). West of Chicago. BILLNAME is taxpayer name.",
        },
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers (with retry)
# ---------------------------------------------------------------------------

def supabase_get(table, params, retries=5):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def supabase_patch(table, data, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
        return False


def _do_patch(args):
    inst_id, patch = args
    return supabase_patch(
        "solar_installations",
        patch,
        {"id": f"eq.{inst_id}"},
    )


# ---------------------------------------------------------------------------
# ArcGIS query helpers
# ---------------------------------------------------------------------------

def arcgis_point_query(endpoint_url, lat, lng, owner_field, out_fields=None,
                       retries=2, timeout=None, use_envelope=False, ssl_skip=False,
                       skip_record_count=False, use_distance=False,
                       owner_field_2=None, where_clause=None):
    """Query an ArcGIS parcel layer with a point to find the containing parcel.

    Returns the owner name string, or None if no parcel found.
    use_envelope: Use a tight bounding box instead of a point (for services with CRS issues).
    ssl_skip: Skip SSL verification (for self-signed certificates).
    use_distance: For point-geometry layers — use distance=100m radius instead of intersect.
    owner_field_2: Second owner field to concatenate (e.g., FIRSTNAME + LASTNAME).
    """
    if out_fields is None:
        if owner_field_2:
            out_fields = f"{owner_field},{owner_field_2}"
        else:
            out_fields = owner_field
    if timeout is None:
        timeout = ARCGIS_TIMEOUT

    if use_envelope:
        # Bounding box (~200m) — geocoded coords often offset 100-200m from parcel centroid
        d = 0.002  # ~200m at mid-latitudes
        params = {
            "geometry": f"{lng-d},{lat-d},{lng+d},{lat+d}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
        }
    else:
        params = {
            "geometry": f"{lng},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
        }

    if where_clause:
        params["where"] = where_clause

    if use_distance:
        params["distance"] = "100"
        params["units"] = "esriSRUnit_Meter"

    if not skip_record_count:
        params["resultRecordCount"] = "1"

    # Use safe=',' to prevent encoding commas in geometry values.
    # Some ArcGIS servers (e.g., gis.nola.gov) reject %2C-encoded commas.
    query_url = f"{endpoint_url}/query?" + urllib.parse.urlencode(params, safe=',')

    # SSL context for self-signed certificates
    ctx = None
    if ssl_skip:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    for attempt in range(retries):
        try:
            req = urllib.request.Request(query_url, headers={
                "User-Agent": "SolarTrack/1.0",
                "Referer": "https://hyder.me",
            })
            if ctx:
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    data = json.loads(resp.read().decode())
            else:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = json.loads(resp.read().decode())

            features = data.get("features", [])
            if not features:
                return None

            attrs = features[0].get("attributes", {})
            raw_owner = attrs.get(owner_field)

            # Handle split owner fields (e.g., FIRSTNAME + LASTNAME)
            if owner_field_2:
                part2 = attrs.get(owner_field_2)
                if part2 and str(part2).strip():
                    part1 = str(raw_owner).strip() if raw_owner else ""
                    raw_owner = f"{part1} {str(part2).strip()}".strip()

            if not raw_owner or str(raw_owner).strip() in ("", "None", "NULL", "UNKNOWN", "N/A", "NA"):
                return None

            return clean_owner_name(str(raw_owner).strip())

        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(1)
            else:
                return None

    return None


def arcgis_join_query(parcel_url, table_url, lat, lng, join_field, owner_field,
                      use_envelope=False, timeout=None):
    """Two-step ArcGIS query: spatial query on parcels → join to owner table.

    For endpoints where owner data is on a separate table (e.g., Norfolk VA).
    1. Query parcel_url with point → get join_field value (e.g., LRSN)
    2. Query table_url with join_field value → get owner_field (e.g., Owner1)
    """
    if timeout is None:
        timeout = ARCGIS_TIMEOUT

    # Step 1: Spatial query to get join key
    if use_envelope:
        d = 0.002
        params = {
            "geometry": f"{lng-d},{lat-d},{lng+d},{lat+d}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": join_field,
            "returnGeometry": "false",
            "resultRecordCount": "1",
            "f": "json",
        }
    else:
        params = {
            "geometry": f"{lng},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": join_field,
            "returnGeometry": "false",
            "resultRecordCount": "1",
            "f": "json",
        }

    query_url = f"{parcel_url}/query?" + urllib.parse.urlencode(params, safe=',')

    try:
        req = urllib.request.Request(query_url, headers={
            "User-Agent": "SolarTrack/1.0",
            "Referer": "https://hyder.me",
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())

        features = data.get("features", [])
        if not features:
            return None

        join_value = features[0].get("attributes", {}).get(join_field)
        if not join_value:
            return None

        # Step 2: Attribute query on table for owner name
        table_params = {
            "where": f"{join_field}={join_value}",
            "outFields": owner_field,
            "returnGeometry": "false",
            "resultRecordCount": "1",
            "f": "json",
        }
        table_query_url = f"{table_url}/query?" + urllib.parse.urlencode(table_params)

        req2 = urllib.request.Request(table_query_url, headers={
            "User-Agent": "SolarTrack/1.0",
            "Referer": "https://hyder.me",
        })
        with urllib.request.urlopen(req2, timeout=timeout) as resp:
            data2 = json.loads(resp.read().decode())

        features2 = data2.get("features", [])
        if not features2:
            return None

        raw_owner = features2[0].get("attributes", {}).get(owner_field)
        if not raw_owner or str(raw_owner).strip() in ("", "None", "NULL", "UNKNOWN", "N/A", "NA"):
            return None

        return clean_owner_name(str(raw_owner).strip())

    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def resolve_broward_url():
    """Resolve Broward County BCPA service URL (rotates monthly)."""
    base = "https://gisweb-adapters.bcpa.net/arcgis/rest/services"
    now = datetime.now()
    # Try current month first, then previous month
    candidates = []
    candidates.append(f"BCPA_EXTERNAL_{now.strftime('%b').upper()}{now.strftime('%y')}")
    # Previous month
    if now.month == 1:
        prev = datetime(now.year - 1, 12, 1)
    else:
        prev = datetime(now.year, now.month - 1, 1)
    candidates.append(f"BCPA_EXTERNAL_{prev.strftime('%b').upper()}{prev.strftime('%y')}")

    for svc_name in candidates:
        url = f"{base}/{svc_name}/MapServer/15"
        try:
            req = urllib.request.Request(f"{url}?f=json", headers={"User-Agent": "SolarTrack/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                if "error" not in data:
                    print(f"  Broward BCPA resolved to: {svc_name}")
                    return url
        except Exception:
            pass
    print(f"  WARNING: Could not resolve Broward BCPA URL (tried: {candidates})")
    return None


def clark_nv_two_step_query(lat, lng, retries=2, timeout=15):
    """Clark County NV two-step owner lookup: ArcGIS→APN, ASPX→Owner.

    Clark County NV doesn't expose owner names in any ArcGIS layer.
    Step 1: Spatial query on assessor parcel layer to get APN.
    Step 2: GET the ASPX ParcelDetail page and parse lblOwner1 from HTML.
    """
    import re as _re

    # Step 1: Get APN from coordinates
    apn_url = (
        "https://maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AssessorMapv2/MapServer/1/query?"
        f"geometry={lng},{lat}&geometryType=esriGeometryPoint&inSR=4326"
        "&spatialRel=esriSpatialRelIntersects&outFields=APN&returnGeometry=false&f=json"
    )

    for attempt in range(retries):
        try:
            req = urllib.request.Request(apn_url, headers={"User-Agent": "SolarTrack/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())

            features = data.get("features", [])
            if not features:
                return None

            apn = features[0].get("attributes", {}).get("APN")
            if not apn:
                return None

            # Step 2: Get owner from ASPX page
            owner_url = (
                f"https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/"
                f"ParcelDetail.aspx?hdnParcel={apn}&hdnInstance=pcl7"
            )
            req2 = urllib.request.Request(owner_url, headers={"User-Agent": "SolarTrack/1.0"})
            with urllib.request.urlopen(req2, timeout=timeout) as resp2:
                html = resp2.read().decode("utf-8", errors="replace")

            if "No record found" in html:
                return None

            # Owner span may contain <br> tags for multi-line owner names
            m = _re.search(r'<span id="lblOwner1">(.*?)</span>', html, _re.DOTALL)
            if not m:
                return None

            raw_owner = _re.sub(r'<br\s*/?>', ' ', m.group(1)).strip()
            if not raw_owner or raw_owner in ("", "UNKNOWN", "N/A"):
                return None

            return clean_owner_name(raw_owner)

        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(1)
            else:
                return None

    return None


def arcgis_service_info(endpoint_url):
    """Fetch ArcGIS service metadata to discover fields."""
    url = f"{endpoint_url}?f=json"
    req = urllib.request.Request(url, headers={"User-Agent": "SolarTrack/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  Error fetching service info: {e}")
        return None


def discover_owner_field(endpoint_url):
    """Auto-detect the owner name field from service metadata."""
    info = arcgis_service_info(endpoint_url)
    if not info:
        return None

    fields = info.get("fields", [])

    # Priority order of field name patterns
    patterns = [
        r'^owner.?name',      # OwnerName, OWNER_NAME, owner_name
        r'^own.?name',         # OWN_NAME, OWNNAME
        r'^ownernme',          # OWNERNME1 (Wisconsin)
        r'^owner$',            # Owner (Connecticut)
        r'^owner1$',           # OWNER1 (Vermont)
        r'^taxpayer',          # TaxpayerName
        r'^own_name',          # OWN_NAME (Florida)
        r'^assessee',          # Assessee
        r'^grantee',           # Grantee
    ]

    for pattern in patterns:
        for f in fields:
            if re.match(pattern, f["name"], re.IGNORECASE):
                return f["name"]

    # Fallback: any field with "owner" in name
    for f in fields:
        if "owner" in f["name"].lower() and "addr" not in f["name"].lower():
            return f["name"]

    return None


# ---------------------------------------------------------------------------
# Owner name cleaning
# ---------------------------------------------------------------------------

def clean_owner_name(raw):
    """Normalize property owner name for consistency."""
    if not raw:
        return None

    name = raw.strip()

    # Skip clearly useless values
    skip_patterns = [
        r'^(\d+|UNKNOWN|N/A|NA|NONE|NOT\s+AVAILABLE|CONFIDENTIAL|PRIVATE|TBD)$',
        r'^OWNER\s*(OF\s+RECORD)?$',
        r'^\*+$',
        r'^-+$',
    ]
    for pat in skip_patterns:
        if re.match(pat, name, re.IGNORECASE):
            return None

    # Normalize whitespace
    name = re.sub(r'\s+', ' ', name)

    # Title case if ALL CAPS (preserve mixed case)
    if name == name.upper() and len(name) > 3:
        # Smart title case: keep common abbreviations uppercase
        words = name.split()
        result = []
        keep_upper = {'LLC', 'LP', 'LLP', 'INC', 'CORP', 'CO', 'LTD', 'NA', 'USA',
                       'II', 'III', 'IV', 'JR', 'SR', 'PV', 'DBA', 'AKA', 'NV',
                       'DC', 'NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'VA', 'NC'}
        for w in words:
            if w in keep_upper or (len(w) <= 2 and w.isalpha()):
                result.append(w)
            else:
                result.append(w.capitalize())
        name = ' '.join(result)

    # Remove trailing punctuation
    name = name.rstrip(',;.')

    return name if name else None


# ---------------------------------------------------------------------------
# Load gap installations from Supabase
# ---------------------------------------------------------------------------

def load_gap_installations(state=None, limit=None, from_file=None):
    """Load installations with coordinates but no owner_name."""
    if from_file:
        print(f"Loading gap installations from {from_file}...")
        with open(from_file) as f:
            all_records = json.load(f)
        if limit:
            all_records = all_records[:limit]
        print(f"  Found {len(all_records):,} installations from file")
        return all_records

    print(f"Loading gap installations{f' for {state}' if state else ''}...")

    all_records = []
    offset = 0

    while True:
        params = {
            "select": "id,state,latitude,longitude",
            "owner_name": "is.null",
            "latitude": "not.is.null",
            "longitude": "not.is.null",
            "order": "id",
            "limit": PAGE_SIZE,
            "offset": offset,
        }
        if state:
            params["state"] = f"eq.{state}"

        batch = supabase_get("solar_installations", params)

        if not batch:
            break

        # Filter out records with invalid coordinates
        valid = [r for r in batch if r.get("latitude") and r.get("longitude")
                 and -90 <= float(r["latitude"]) <= 90
                 and -180 <= float(r["longitude"]) <= 180]
        all_records.extend(valid)

        if limit and len(all_records) >= limit:
            all_records = all_records[:limit]
            break

        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

        if offset % 10000 == 0:
            print(f"  Loaded {len(all_records):,} records so far...")

    print(f"  Found {len(all_records):,} installations with coords + no owner")
    return all_records


def count_gap_by_state():
    """Count gap installations per state for prioritization."""
    print("Counting gap installations by state...")

    # Use a simple approach: load a sample and group
    all_states = {}
    offset = 0

    while True:
        params = {
            "select": "state",
            "owner_name": "is.null",
            "latitude": "not.is.null",
            "longitude": "not.is.null",
            "order": "id",
            "limit": PAGE_SIZE,
            "offset": offset,
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        for r in batch:
            st = r.get("state", "")
            if st:
                all_states[st] = all_states.get(st, 0) + 1
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        if offset % 50000 == 0:
            print(f"  Counted {sum(all_states.values()):,} records across {len(all_states)} states...")

    return dict(sorted(all_states.items(), key=lambda x: -x[1]))


# ---------------------------------------------------------------------------
# Process a single state
# ---------------------------------------------------------------------------

def process_state(state, endpoint_config, dry_run=False, limit=None, from_file=None):
    """Process all gap installations for a state using its ArcGIS endpoint."""
    url = endpoint_config["url"]
    # Resolve dynamic URLs
    if url == "BROWARD_DYNAMIC":
        url = resolve_broward_url()
        if not url:
            print(f"  Skipping Broward — could not resolve dynamic URL")
            return 0, 0
    owner_field = endpoint_config["owner_field"]
    note = endpoint_config.get("note", "")
    ep_timeout = endpoint_config.get("timeout", ARCGIS_TIMEOUT)
    ep_workers = endpoint_config.get("workers", ARCGIS_WORKERS)
    use_envelope = endpoint_config.get("use_envelope", True)  # Default True — geocoded coords miss with point queries
    ssl_skip_flag = endpoint_config.get("ssl_skip", False)
    skip_rc = endpoint_config.get("skip_record_count", False)
    use_dist = endpoint_config.get("use_distance", False)
    owner_field_2 = endpoint_config.get("owner_field_2")
    where_clause = endpoint_config.get("where_clause")

    print(f"\n{'='*60}")
    print(f"Processing {state} — {url}")
    if note:
        print(f"  Note: {note}")
    flags = []
    if use_envelope:
        flags.append("envelope")
    if ssl_skip_flag:
        flags.append("ssl-skip")
    if skip_rc:
        flags.append("skip-record-count")
    if use_dist:
        flags.append("distance-100m")
    flag_str = f", flags: {'+'.join(flags)}" if flags else ""
    print(f"  Owner field: {owner_field}, timeout: {ep_timeout}s, workers: {ep_workers}{flag_str}")

    # Load gap installations
    installations = load_gap_installations(state, limit=limit, from_file=from_file)
    if not installations:
        print(f"  No gap installations found for {state}")
        return 0, 0

    print(f"  Querying ArcGIS for {len(installations):,} installations...")

    # Run point-in-polygon queries in parallel
    # Patches are flushed incrementally every FLUSH_SIZE to avoid losing results on crash
    FLUSH_SIZE = 1000
    pending_patches = []
    queried = 0
    found = 0
    errors = 0
    total_patched = 0
    total_patch_errors = 0

    # Check for join_table pattern (e.g., Norfolk: spatial→LRSN→owner table)
    join_table = endpoint_config.get("join_table")
    # Check for HTML scrape pattern (e.g., Clark County NV: ArcGIS→APN→ASPX page)
    html_scrape = endpoint_config.get("html_scrape")

    def query_one(inst):
        lat = float(inst["latitude"])
        lng = float(inst["longitude"])
        if html_scrape == "clark_nv":
            owner = clark_nv_two_step_query(lat, lng, timeout=ep_timeout)
        elif join_table:
            owner = arcgis_join_query(
                url, join_table["url"], lat, lng,
                join_field=join_table["join_field"],
                owner_field=owner_field,
                use_envelope=use_envelope, timeout=ep_timeout)
        else:
            owner = arcgis_point_query(url, lat, lng, owner_field, timeout=ep_timeout,
                                        use_envelope=use_envelope, ssl_skip=ssl_skip_flag,
                                        skip_record_count=skip_rc, use_distance=use_dist,
                                        owner_field_2=owner_field_2,
                                        where_clause=where_clause)
        return inst["id"], owner

    def flush_patches(batch, label=""):
        """Flush a batch of patches to Supabase immediately."""
        if not batch or dry_run:
            return 0, 0
        patched = 0
        errs = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as patch_executor:
            patch_futures = [patch_executor.submit(_do_patch, p) for p in batch]
            for pf in as_completed(patch_futures):
                try:
                    if pf.result():
                        patched += 1
                    else:
                        errs += 1
                except Exception:
                    errs += 1
        if label:
            print(f"    Flushed {patched:,} patches{label}, {errs} errors")
        return patched, errs

    with ThreadPoolExecutor(max_workers=ep_workers) as executor:
        futures = {executor.submit(query_one, inst): inst for inst in installations}

        for future in as_completed(futures):
            queried += 1
            try:
                inst_id, owner = future.result()
                if owner:
                    found += 1
                    pending_patches.append((inst_id, {"owner_name": owner}))
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"    Query error: {e}")

            # Incremental flush every FLUSH_SIZE found records
            if len(pending_patches) >= FLUSH_SIZE:
                print(f"    FLUSH: {len(pending_patches)} pending patches >= {FLUSH_SIZE}, flushing...")
                p, e = flush_patches(pending_patches, f" (batch at {queried:,}/{len(installations):,})")
                total_patched += p
                total_patch_errors += e
                pending_patches = []

            if queried % 100 == 0:
                rate = found / queried * 100 if queried else 0
                pend = len(pending_patches)
                print(f"  Progress: {queried:,}/{len(installations):,} queried, "
                      f"{found:,} found ({rate:.1f}%), {errors} errors, pending={pend}")

    # Flush any remaining patches
    if pending_patches:
        p, e = flush_patches(pending_patches, " (final batch)")
        total_patched += p
        total_patch_errors += e

    rate = found / queried * 100 if queried else 0
    print(f"\n  Results for {state}:")
    print(f"    Queried: {queried:,}")
    print(f"    Found:   {found:,} ({rate:.1f}%)")
    print(f"    Errors:  {errors}")

    if dry_run:
        print(f"    DRY RUN — would have patched {found:,} records")
        return found, 0

    print(f"    Total patched: {total_patched:,}, Errors: {total_patch_errors}")
    return found, total_patched


# ---------------------------------------------------------------------------
# Process a CA county
# ---------------------------------------------------------------------------

def process_ca_county(county_key, endpoint_config, dry_run=False, limit=None, from_file=None):
    """Process gap installations for a specific CA county.

    Uses process_state() with state='CA' to pass through all endpoint config flags.
    The ArcGIS layer will only return results for parcels within that county's coverage.
    """
    print(f"\n{'='*60}")
    print(f"Processing CA/{county_key}")
    return process_state("CA", endpoint_config, dry_run=dry_run, limit=limit, from_file=from_file)


def _run_queries(installations, url, owner_field, label, dry_run):
    """Shared query + patch logic."""
    print(f"  Querying ArcGIS for {len(installations):,} installations...")

    patches = []
    queried = 0
    found = 0
    errors = 0

    def query_one(inst):
        lat = float(inst["latitude"])
        lng = float(inst["longitude"])
        owner = arcgis_point_query(url, lat, lng, owner_field)
        return inst["id"], owner

    with ThreadPoolExecutor(max_workers=ARCGIS_WORKERS) as executor:
        futures = {executor.submit(query_one, inst): inst for inst in installations}

        for future in as_completed(futures):
            queried += 1
            try:
                inst_id, owner = future.result()
                if owner:
                    found += 1
                    patches.append((inst_id, {"owner_name": owner}))
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"    Query error: {e}")

            if queried % 100 == 0:
                rate = found / queried * 100 if queried else 0
                print(f"  Progress: {queried:,}/{len(installations):,} queried, "
                      f"{found:,} found ({rate:.1f}%), {errors} errors")

    rate = found / queried * 100 if queried else 0
    print(f"\n  Results for {label}:")
    print(f"    Queried: {queried:,}")
    print(f"    Found:   {found:,} ({rate:.1f}%)")
    print(f"    Errors:  {errors}")

    if dry_run:
        print(f"    DRY RUN — would patch {len(patches):,} records")
        for inst_id, patch in patches[:5]:
            print(f"      {inst_id}: {patch['owner_name']}")
        if len(patches) > 5:
            print(f"      ... and {len(patches)-5} more")
        return found, 0

    if not patches:
        return 0, 0

    print(f"  Patching {len(patches):,} records...")
    patched = 0
    patch_errors = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = [executor.submit(_do_patch, p) for p in patches]
        for future in as_completed(futures):
            try:
                if future.result():
                    patched += 1
                else:
                    patch_errors += 1
            except Exception:
                patch_errors += 1

            if (patched + patch_errors) % 200 == 0:
                print(f"    Patched {patched:,}/{len(patches):,}...")

    print(f"    Patched: {patched:,}, Errors: {patch_errors}")
    return found, patched


# ---------------------------------------------------------------------------
# Endpoint discovery
# ---------------------------------------------------------------------------

def discover_endpoints(state):
    """Search ArcGIS Hub for parcel services in a state."""
    state_names = {
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
        "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
        "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
        "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
        "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
        "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
        "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
        "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
        "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
        "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
        "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
        "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
        "WI": "Wisconsin", "WY": "Wyoming",
    }

    state_name = state_names.get(state, state)
    print(f"\nDiscovering parcel endpoints for {state} ({state_name})...")

    query = f'type:"Feature Service" AND parcels AND {state_name}'
    search_url = (
        "https://www.arcgis.com/sharing/rest/search?"
        + urllib.parse.urlencode({"q": query, "num": 10, "f": "json"})
    )

    req = urllib.request.Request(search_url, headers={"User-Agent": "SolarTrack/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"  Search failed: {e}")
        return

    results = data.get("results", [])
    print(f"  Found {len(results)} results\n")

    for r in results:
        title = r.get("title", "")
        url = r.get("url", "")
        if not url:
            continue

        # Check if it has parcels
        if "parcel" not in title.lower():
            continue

        print(f"  {title}")
        print(f"    URL: {url}")

        # Try to discover owner field
        test_url = url.rstrip("/")
        if not test_url.endswith("/0"):
            test_url += "/0"

        owner = discover_owner_field(test_url)
        if owner:
            print(f"    Owner field: {owner} ✓")
        else:
            print(f"    No owner field found")
        print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich solar installations with property owner names")
    parser.add_argument("--state", type=str, help="Process single state (2-letter code)")
    parser.add_argument("--county", type=str, help="Process single county (with --state CA)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--discover", type=str, metavar="STATE", help="Auto-discover endpoints for a state")
    parser.add_argument("--list", action="store_true", help="List all configured endpoints")
    parser.add_argument("--limit", type=int, help="Max installations to process per state")
    parser.add_argument("--from-file", type=str, help="Load installations from JSON file instead of Supabase")
    parser.add_argument("--counts", action="store_true", help="Show gap counts by state")
    args = parser.parse_args()

    if args.list:
        print("\nConfigured statewide endpoints:")
        print(f"{'State':<6} {'Owner Field':<15} {'URL'}")
        print("-" * 80)
        for state, cfg in sorted(STATEWIDE_ENDPOINTS.items()):
            note = f" ({cfg['note']})" if cfg.get("note") else ""
            print(f"{state:<6} {cfg['owner_field']:<15} {cfg['url'][:70]}{note}")

        if COUNTY_ENDPOINTS:
            print(f"\nCounty endpoints ({sum(len(v) for v in COUNTY_ENDPOINTS.values())} total):")
            for state in sorted(COUNTY_ENDPOINTS.keys()):
                for county, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
                    note = f" ({cfg['note']})" if cfg.get("note") else ""
                    print(f"  {state}/{county:<20} {cfg['owner_field']:<15} {cfg['url'][:55]}{note}")

        if CA_COUNTY_ENDPOINTS:
            print(f"\nCA county endpoints: {len(CA_COUNTY_ENDPOINTS)}")
            for county, cfg in sorted(CA_COUNTY_ENDPOINTS.items()):
                print(f"  CA/{county:<20} {cfg['owner_field']:<15} {cfg['url'][:60]}")

        return

    if args.discover:
        discover_endpoints(args.discover.upper())
        return

    if args.counts:
        gaps = count_gap_by_state()
        print(f"\nGap installations by state (coords + no owner):")
        print(f"{'State':<6} {'Count':>8} {'Endpoint?'}")
        print("-" * 40)
        total = 0
        covered = 0
        for state, count in gaps.items():
            has_ep = "✓" if state in STATEWIDE_ENDPOINTS else ("◇" if state in COUNTY_ENDPOINTS else "")
            print(f"{state:<6} {count:>8,} {has_ep}")
            total += count
            if state in STATEWIDE_ENDPOINTS or state in COUNTY_ENDPOINTS:
                covered += count
        print(f"\nTotal: {total:,} gap records")
        print(f"Covered by endpoints: {covered:,} ({covered/total*100:.1f}%)")
        print(f"  ✓ = statewide, ◇ = county-level")
        return

    # Process specific state + county
    if args.state and args.county:
        state = args.state.upper()
        county = args.county.lower().replace(" ", "_")
        from_file = getattr(args, 'from_file', None)

        if state == "CA" and county in CA_COUNTY_ENDPOINTS:
            found, patched = process_ca_county(county, CA_COUNTY_ENDPOINTS[county],
                                                dry_run=args.dry_run, limit=args.limit,
                                                from_file=from_file)
        elif state in COUNTY_ENDPOINTS and county in COUNTY_ENDPOINTS[state]:
            found, patched = process_state(state, COUNTY_ENDPOINTS[state][county],
                                           dry_run=args.dry_run, limit=args.limit,
                                           from_file=from_file)
        else:
            print(f"No endpoint configured for {state}/{county}")
            print(f"Use --discover {state} to find endpoints")
            sys.exit(1)
        return

    # Process specific state
    if args.state:
        state = args.state.upper()
        from_file = getattr(args, 'from_file', None)
        if state in STATEWIDE_ENDPOINTS:
            found, patched = process_state(state, STATEWIDE_ENDPOINTS[state],
                                           dry_run=args.dry_run, limit=args.limit,
                                           from_file=from_file)
        elif state in COUNTY_ENDPOINTS:
            # Run all county endpoints for this state
            for county_key, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
                found, patched = process_state(state, cfg,
                                               dry_run=args.dry_run, limit=args.limit,
                                               from_file=from_file)
        else:
            all_states = set(STATEWIDE_ENDPOINTS.keys()) | set(COUNTY_ENDPOINTS.keys())
            print(f"No endpoint for {state}")
            print(f"Available: {', '.join(sorted(all_states))}")
            print(f"Use --discover {state} to find endpoints")
            sys.exit(1)
        return

    # Process all configured states
    print("=" * 60)
    print("Parcel Owner Enrichment — All Configured States")
    print("=" * 60)

    total_found = 0
    total_patched = 0
    state_results = {}

    # Statewide endpoints
    for state in sorted(STATEWIDE_ENDPOINTS.keys()):
        try:
            found, patched = process_state(
                state, STATEWIDE_ENDPOINTS[state],
                dry_run=args.dry_run, limit=args.limit
            )
            state_results[state] = (found, patched)
            total_found += found
            total_patched += patched
        except Exception as e:
            print(f"\n  ERROR processing {state}: {e}")
            state_results[state] = (0, 0)

    # County endpoints (states without statewide layers)
    for state in sorted(COUNTY_ENDPOINTS.keys()):
        state_found = 0
        state_patched = 0
        for county_key, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
            try:
                found, patched = process_state(
                    state, cfg,
                    dry_run=args.dry_run, limit=args.limit
                )
                state_found += found
                state_patched += patched
            except Exception as e:
                print(f"\n  ERROR processing {state}/{county_key}: {e}")
        state_results[state] = (state_found, state_patched)
        total_found += state_found
        total_patched += state_patched

    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"{'State':<6} {'Found':>8} {'Patched':>8}")
    print(f"{'-'*30}")
    for state, (found, patched) in sorted(state_results.items()):
        print(f"{state:<6} {found:>8,} {patched:>8,}")
    print(f"{'-'*30}")
    print(f"{'Total':<6} {total_found:>8,} {total_patched:>8,}")

    if args.dry_run:
        print(f"\nDRY RUN — no records were patched")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Municipal Solar Permit Ingestion Script

Downloads solar building permit data from 30+ US municipal open data portals
and ingests into solar_installations and solar_equipment tables.

Supported platforms: Socrata SODA, OpenDataSoft, ArcGIS REST, CARTO SQL, BLDS Partner

Usage:
  python3 -u scripts/ingest-permits.py                    # All cities
  python3 -u scripts/ingest-permits.py --city cary         # Single city
  python3 -u scripts/ingest-permits.py --city sf,la,chi    # Multiple cities
  python3 -u scripts/ingest-permits.py --tier 1            # All Tier 1 cities
  python3 -u scripts/ingest-permits.py --tier 1,2          # Tier 1 and 2
  python3 -u scripts/ingest-permits.py --dry-run           # Count without ingesting
  python3 -u scripts/ingest-permits.py --list-cities       # Show available cities
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import ssl
import time
from pathlib import Path

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50
RATE_LIMIT = 1.0  # seconds between API requests


# ---------------------------------------------------------------------------
# City configurations — organized by tier
# ---------------------------------------------------------------------------

# Solar keyword filters for Socrata SoQL
SOLAR_WHERE = (
    "UPPER(description) LIKE '%25SOLAR%25' "
    "OR UPPER(description) LIKE '%25PHOTOVOLTAIC%25' "
    "OR UPPER(description) LIKE '%25PV SYSTEM%25' "
    "OR UPPER(description) LIKE '%25PV MODULE%25'"
)

# False positive exclusions (applied in transform, not API filter)
SOLAR_FALSE_POSITIVES = re.compile(
    r'solar\s+screen|solar\s+shade|solar\s+tube|solar\s+film|solar\s+water\s+heat',
    re.IGNORECASE
)

CITIES = {
    # =========================================================================
    # TIER 0: Rich datasets with new platform handlers (ArcGIS, Carto, CKAN)
    # =========================================================================
    "sacramento": {
        "tier": 0,
        "name": "Sacramento, CA",
        "state": "CA",
        "county": "SACRAMENTO",
        "platform": "arcgis",
        "base_url": "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/BldgPermitIssued_Archive/FeatureServer/0",
        "page_size": 1000,
        "filter": "upper(Work_Desc) LIKE '%SOLAR%' OR Category='Solar System'",
        "prefix": "permit_sacramento",
        "transform": "sacramento",
    },
    "philadelphia": {
        "tier": 0,
        "name": "Philadelphia, PA",
        "state": "PA",
        "county": "PHILADELPHIA",
        "platform": "carto",
        "base_url": "https://phl.carto.com/api/v2/sql",
        "table_name": "permits",
        "page_size": 1000,
        "filter": "approvedscopeofwork ILIKE '%solar%' OR typeofwork ILIKE '%solar%'",
        "prefix": "permit_philly",
        "transform": "philadelphia",
    },
    "san_jose": {
        "tier": 0,
        "name": "San Jose, CA",
        "state": "CA",
        "county": "SANTA CLARA",
        "platform": "ckan",
        "base_url": "https://data.sanjoseca.gov/api/3/action/datastore_search",
        "resource_id": "761b7ae8-3be1-4ad6-923d-c7af6404a904",
        "page_size": 100,
        "prefix": "permit_sanjose",
        "transform": "san_jose",
    },
    "salt_lake_city": {
        "tier": 0,
        "name": "Salt Lake City, UT",
        "state": "UT",
        "county": "SALT LAKE",
        "platform": "socrata",
        "base_url": "https://opendata.utah.gov/resource/nbv6-7v56.json",
        "page_size": 1000,
        "filter": "$where=upper(workdescription) LIKE '%25SOLAR%25'",
        "prefix": "permit_slc",
        "transform": "salt_lake_city",
    },
    "denver": {
        "tier": 0,
        "name": "Denver/Boulder, CO",
        "state": "CO",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/ePKBjXrBZ2vEEgWd/arcgis/rest/services/Construction_Permits/FeatureServer/0",
        "page_size": 1000,
        "filter": "EstPhotovoltaicCost IS NOT NULL",
        "prefix": "permit_denver",
        "transform": "denver",
    },
    "minneapolis": {
        "tier": 0,
        "name": "Minneapolis, MN",
        "state": "MN",
        "county": "HENNEPIN",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0",
        "page_size": 1000,
        "filter": "upper(comments) LIKE '%SOLAR%'",
        "prefix": "permit_minneapolis",
        "transform": "minneapolis",
    },
    "detroit": {
        "tier": 0,
        "name": "Detroit, MI",
        "state": "MI",
        "county": "WAYNE",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0",
        "page_size": 1000,
        "filter": "upper(work_description) LIKE '%SOLAR%'",
        "prefix": "permit_detroit",
        "transform": "detroit",
    },
    "albuquerque": {
        "tier": 0,
        "name": "Albuquerque, NM",
        "state": "NM",
        "county": "BERNALILLO",
        "platform": "arcgis",
        "base_url": "https://coagisweb.cabq.gov/arcgis/rest/services/public/BuildingPermits_KIVAPOSSE/MapServer/0",
        "page_size": 1000,
        "oid_paging": True,  # MapServer ignores resultOffset; use OBJECTID pagination
        "filter": "upper(WorkDescription) LIKE '%SOLAR%'",
        "prefix": "permit_abq",
        "transform": "albuquerque",
    },
    "riverside_county": {
        "tier": 0,
        "name": "Riverside County, CA",
        "state": "CA",
        "county": "RIVERSIDE",
        "platform": "arcgis",
        "base_url": "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/General/MapServer/280",
        "page_size": 2000,
        "oid_paging": True,  # MapServer requires OBJECTID pagination
        "out_sr": "4326",  # Request WGS84 coordinates (native is State Plane)
        "filter": "CASE_WORK_CLASS LIKE 'SLRC%' OR CASE_WORK_CLASS LIKE 'DA03%' OR CASE_WORK_CLASS LIKE 'FCN59%' OR CASE_WORK_CLASS LIKE 'GSLRR%'",
        "prefix": "permit_riverside",
        "transform": "riverside_county",
    },
    "phoenix": {
        "tier": 0,
        "name": "Phoenix, AZ",
        "state": "AZ",
        "county": "MARICOPA",
        "platform": "arcgis",
        "base_url": "https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(PERMIT_NAME) LIKE '%SOLAR%'",
        "prefix": "permit_phoenix",
        "transform": "phoenix",
    },
    "maricopa_county": {
        "tier": 0,
        "name": "Maricopa County, AZ",
        "state": "AZ",
        "county": "MARICOPA",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0",
        "page_size": 1000,
        "out_sr": "4326",
        "filter": "UPPER(PermitDescription) LIKE '%SOLAR%'",
        "prefix": "permit_maricopa",
        "transform": "maricopa_county",
    },
    "san_antonio": {
        "tier": 0,
        "name": "San Antonio, TX",
        "state": "TX",
        "county": "BEXAR",
        "platform": "ckan",
        "base_url": "https://data.sanantonio.gov/api/3/action/datastore_search",
        "resource_id": "c22b1ef2-dcf8-4d77-be1a-ee3638092aab",
        "ckan_filters": {"PERMIT TYPE": "Solar - Photovoltaic Permit"},
        "page_size": 1000,
        "prefix": "permit_sanantonio",
        "transform": "san_antonio",
    },
    "sacramento_county": {
        "tier": 0,
        "name": "Sacramento County, CA",
        "state": "CA",
        "county": "SACRAMENTO",
        "platform": "arcgis",
        "base_url": "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Permits/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",  # Native is State Plane CA Zone 2 (WKID 2226)
        "filter": "upper(WorkDescription) LIKE '%SOLAR%' OR Application_Subtype LIKE '%Solar%'",
        "prefix": "permit_saccounty",
        "transform": "sacramento_county",
        "has_equipment": True,
    },
    "tucson": {
        "tier": 0,
        "name": "Tucson, AZ",
        "state": "AZ",
        "county": "PIMA",
        "platform": "arcgis_multilayer",
        "base_url": "https://mapdata.tucsonaz.gov/arcgis/rest/services/PublicMaps/PermitsCode/MapServer",
        "layers": [85, 81],  # 85=residential, 81=commercial
        "page_size": 1000,
        "oid_paging": True,  # MapServer requires OBJECTID pagination
        "out_sr": "4326",
        "filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR WORKCLASS LIKE '%Solar%'",
        "prefix": "permit_tucson",
        "transform": "tucson",
        "has_equipment": True,
    },
    "pittsburgh": {
        "tier": 0,
        "name": "Pittsburgh, PA",
        "state": "PA",
        "county": "ALLEGHENY",
        "platform": "ckan",
        "base_url": "https://data.wprdc.org/api/3/action/datastore_search",
        "resource_id": "f4d1177a-f597-4c32-8cbf-7885f56253f6",
        "page_size": 100,
        "prefix": "permit_pittsburgh",
        "transform": "pittsburgh",
        "has_equipment": True,
    },
    "dc": {
        "tier": 0,
        "name": "Washington, DC",
        "state": "DC",
        "county": "DISTRICT OF COLUMBIA",
        "platform": "arcgis_multilayer",
        "base_url": "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer",
        "layers": [25, 24, 37, 9, 8, 2, 3, 14, 15, 16, 17, 18],  # Years 2015-2026
        "page_size": 2000,
        "filter": "UPPER(DESC_OF_WORK) LIKE '%SOLAR%'",
        "prefix": "permit_dc",
        "transform": "dc",
    },
    "miami_dade": {
        "tier": 0,
        "name": "Miami-Dade County, FL",
        "state": "FL",
        "county": "MIAMI-DADE",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/BuildingPermit_gdb/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(DESC1) LIKE '%SOLAR%'",
        "prefix": "permit_miami",
        "transform": "miami_dade",
    },

    # =========================================================================
    # TIER 1: Solar-specific datasets (best data)
    # =========================================================================
    "cambridge": {
        "tier": 1,
        "name": "Cambridge, MA",
        "state": "MA",
        "county": "MIDDLESEX",
        "platform": "socrata",
        "base_url": "https://data.cambridgema.gov/resource/whpw-w55x.json",
        "page_size": 1000,
        "prefix": "permit_cambridge",
        "transform": "cambridge_rich",
        "has_equipment": True,  # inverter make/model, panel count
    },
    "cary": {
        "tier": 1,
        "name": "Cary, NC",
        "state": "NC",
        "county": "WAKE",
        "platform": "opendatasoft",
        "base_url": "https://data.townofcary.org/api/v2/catalog/datasets/solar-permit-applications/records",
        "page_size": 100,
        "prefix": "permit_cary",
        "transform": "cary",
    },
    "richmond_ca": {
        "tier": 1,
        "name": "Richmond, CA",
        "state": "CA",
        "county": "CONTRA COSTA",
        "platform": "socrata",
        "base_url": "https://www.transparentrichmond.org/resource/pj9s-n7wb.json",
        "page_size": 1000,
        "prefix": "permit_richmond",
        "transform": "richmond",
    },
    "honolulu": {
        "tier": 1,
        "name": "Honolulu, HI",
        "state": "HI",
        "county": "HONOLULU",
        "platform": "socrata",
        "base_url": "https://data.honolulu.gov/resource/4vab-c87q.json",
        "page_size": 1000,
        "filter": "$where=solarvpinstallation='Y' AND commercialresidential='Commercial'",
        "prefix": "permit_honolulu",
        "transform": "honolulu",
    },
    "nyc": {
        "tier": 1,
        "name": "New York City, NY",
        "state": "NY",
        "platform": "socrata",
        "base_url": "https://data.cityofnewyork.us/resource/ipu4-2q9a.json",
        "page_size": 1000,
        "filter": "$where=UPPER(permittee_s_business_name) LIKE '%25SOLAR%25'",
        "prefix": "permit_nyc",
        "transform": "nyc",
    },

    # =========================================================================
    # TIER 2: Building permits with confirmed solar (filterable)
    # =========================================================================
    "sf": {
        "tier": 2,
        "name": "San Francisco, CA",
        "state": "CA",
        "county": "SAN FRANCISCO",
        "platform": "socrata",
        "base_url": "https://data.sfgov.org/resource/i98e-djp9.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_sf",
        "transform": "sf",
    },
    "la": {
        "tier": 2,
        "name": "Los Angeles, CA",
        "state": "CA",
        "county": "LOS ANGELES",
        "platform": "socrata",
        "base_url": "https://data.lacity.org/resource/pi9x-tg5x.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'work_desc')}",
        "prefix": "permit_la",
        "transform": "la",
    },
    "chicago": {
        "tier": 2,
        "name": "Chicago, IL",
        "state": "IL",
        "county": "COOK",
        "platform": "socrata",
        "base_url": "https://data.cityofchicago.org/resource/ydr8-5enu.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'work_description')}",
        "prefix": "permit_chicago",
        "transform": "chicago",
    },
    "austin": {
        "tier": 2,
        "name": "Austin, TX",
        "state": "TX",
        "county": "TRAVIS",
        "platform": "socrata",
        "base_url": "https://data.austintexas.gov/resource/3syk-w9eu.json",
        "page_size": 1000,
        "filter": "$where=lower(description) LIKE '%25solar%25' AND permittype='EP'",
        "prefix": "permit_austin",
        "transform": "austin",
    },
    "seattle": {
        "tier": 2,
        "name": "Seattle, WA",
        "state": "WA",
        "county": "KING",
        "platform": "socrata",
        "base_url": "https://data.seattle.gov/resource/76t5-zqzr.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_seattle",
        "transform": "seattle",
    },
    "norfolk": {
        "tier": 2,
        "name": "Norfolk, VA",
        "state": "VA",
        "county": "NORFOLK",
        "platform": "socrata",
        "base_url": "https://data.norfolk.gov/resource/fahm-yuh4.json",
        "page_size": 1000,
        "filter": "$where=UPPER(work_type) LIKE '%25SOLAR%25'",
        "prefix": "permit_norfolk",
        "transform": "generic_socrata",
    },
    "kansas_city": {
        "tier": 2,
        "name": "Kansas City, MO",
        "state": "MO",
        "county": "JACKSON",
        "platform": "socrata",
        "base_url": "https://data.kcmo.org/resource/ntw8-aacc.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_kc",
        "transform": "kansas_city",
    },
    "orlando": {
        "tier": 2,
        "name": "Orlando, FL",
        "state": "FL",
        "county": "ORANGE",
        "platform": "socrata",
        "base_url": "https://data.cityoforlando.net/resource/ryhf-m453.json",
        "page_size": 1000,
        "filter": "$where=UPPER(project_name) LIKE '%25SOLAR%25'",
        "prefix": "permit_orlando",
        "transform": "orlando",
    },
    "baton_rouge": {
        "tier": 2,
        "name": "Baton Rouge, LA",
        "state": "LA",
        "county": "EAST BATON ROUGE",
        "platform": "socrata",
        "base_url": "https://data.brla.gov/resource/7fq7-8j7r.json",
        "page_size": 1000,
        "filter": "$where=UPPER(projectdescription) LIKE '%25SOLAR%25'",
        "prefix": "permit_batonrouge",
        "transform": "baton_rouge",
    },
    "durham": {
        "tier": 2,
        "name": "Durham, NC",
        "state": "NC",
        "county": "DURHAM",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/G5vR3cOjh6g2Ed8E/arcgis/rest/services/Permits/FeatureServer/13",
        "page_size": 1000,
        "out_sr": "4326",
        "filter": "UPPER(P_Descript) LIKE '%SOLAR%'",
        "prefix": "permit_durham",
        "transform": "durham",
    },

    # =========================================================================
    # TIER 3: Building permits (solar likely present, generic transform)
    # =========================================================================
    "dallas": {
        "tier": 3,
        "name": "Dallas, TX",
        "state": "TX",
        "county": "DALLAS",
        "platform": "socrata",
        "base_url": "https://www.dallasopendata.com/resource/e7gq-4sah.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'work_description')}",
        "prefix": "permit_dallas",
        "transform": "generic_socrata",
    },
    "new_orleans": {
        "tier": 3,
        "name": "New Orleans, LA",
        "state": "LA",
        "county": "ORLEANS",
        "platform": "socrata",
        "base_url": "https://data.nola.gov/resource/72f9-bi28.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_nola",
        "transform": "blds",
    },
    "san_diego_county": {
        "tier": 3,
        "name": "San Diego County, CA",
        "state": "CA",
        "county": "SAN DIEGO",
        "platform": "socrata",
        "base_url": "https://data.sandiegocounty.gov/resource/dyzh-7eat.json",
        "page_size": 1000,
        "filter": "$where=primary_scope_code LIKE '8004%25'",
        "prefix": "permit_sdcounty",
        "transform": "generic_socrata",
    },
    "montgomery_county": {
        "tier": 3,
        "name": "Montgomery County, MD",
        "state": "MD",
        "county": "MONTGOMERY",
        "platform": "socrata",
        "base_url": "https://data.montgomerycountymd.gov/resource/i26v-w6bd.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_montco",
        "transform": "generic_socrata",
    },
    # Cincinnati: 0 solar permits in description field, removed
    # Roseville: Only 5 columns (no address/description), removed
    # Chattanooga: SSL certificate error, removed
    # Baltimore: Empty API response, removed
    "mesa": {
        "tier": 3,
        "name": "Mesa, AZ",
        "state": "AZ",
        "county": "MARICOPA",
        "platform": "socrata",
        "base_url": "https://data.mesaaz.gov/resource/dzpk-hxfb.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'description_of_work')}",
        "prefix": "permit_mesa",
        "transform": "generic_socrata",
    },

    # =========================================================================
    # TIER 4: BLDS Partner Portal (standardized schema)
    # =========================================================================
    "boston_blds": {
        "tier": 4,
        "name": "Boston, MA (BLDS)",
        "state": "MA",
        "county": "SUFFOLK",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/ga54-wzas.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_boston",
        "transform": "blds",
    },
    "fort_worth_blds": {
        "tier": 4,
        "name": "Fort Worth, TX (BLDS)",
        "state": "TX",
        "county": "TARRANT",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/qy5k-jz7m.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_ftw",
        "transform": "blds",
    },
    "raleigh": {
        "tier": 2,
        "name": "Raleigh, NC",
        "state": "NC",
        "county": "WAKE",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(proposedworkdescription) LIKE '%SOLAR%'",
        "prefix": "permit_raleigh",
        "transform": "raleigh",
    },
    "fort_lauderdale": {
        "tier": 2,
        "name": "Fort Lauderdale, FL",
        "state": "FL",
        "county": "BROWARD",
        "platform": "arcgis",
        "base_url": "https://gis.fortlauderdale.gov/server/rest/services/BuildingPermits/MapServer/0",
        "page_size": 1000,
        "out_sr": "4326",
        "filter": "UPPER(PERMITDESC) LIKE '%SOLAR%'",
        "prefix": "permit_ftl",
        "transform": "fort_lauderdale",
    },
    "seattle_blds": {
        "tier": 4,
        "name": "Seattle, WA (BLDS)",
        "state": "WA",
        "county": "KING",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/m393-mbxq.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_seattle_blds",
        "transform": "blds",
    },
    "nashville_blds": {
        "tier": 4,
        "name": "Nashville, TN (BLDS)",
        "state": "TN",
        "county": "DAVIDSON",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/7ky7-xbzp.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_nashville",
        "transform": "blds",
    },
    "nola_blds": {
        "tier": 4,
        "name": "New Orleans, LA (BLDS)",
        "state": "LA",
        "county": "ORLEANS",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/gk94-9m35.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_nola_blds",
        "transform": "blds",
    },
    "redmond_blds": {
        "tier": 4,
        "name": "Redmond, WA (BLDS)",
        "state": "WA",
        "county": "KING",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/r9sj-7n4p.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_redmond",
        "transform": "blds",
    },
    "santa_rosa_blds": {
        "tier": 4,
        "name": "Santa Rosa, CA (BLDS)",
        "state": "CA",
        "county": "SONOMA",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/43a8-pijb.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_santarosa",
        "transform": "blds",
    },

    # =========================================================================
    # WAVE 2: New cities discovered Feb 12, 2026
    # =========================================================================

    # --- ArcGIS: Rich solar-specific datasets ---
    "la_county": {
        "tier": 0,
        "name": "Los Angeles County, CA",
        "state": "CA",
        "county": "LOS ANGELES",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "CASENAME = 'Unincorporated Solar'",
        "prefix": "permit_lacounty",
        "transform": "la_county",
        "has_equipment": True,
    },
    "las_vegas": {
        "tier": 0,
        "name": "Las Vegas, NV",
        "state": "NV",
        "county": "CLARK",
        "platform": "arcgis",
        "base_url": "https://mapdata.lasvegasnevada.gov/clvgis/rest/services/DevelopmentServices/BuildingPermits/MapServer/0",
        "page_size": 1000,
        "oid_paging": True,
        "out_sr": "4326",
        "filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR UPPER(WORKDESC) LIKE '%SOLAR%' OR UPPER(FULL_DESC) LIKE '%SOLAR%'",
        "prefix": "permit_lasvegas",
        "transform": "las_vegas",
    },
    "baltimore": {
        "tier": 0,
        "name": "Baltimore, MD",
        "state": "MD",
        "county": "BALTIMORE CITY",
        "platform": "arcgis",
        "base_url": "https://egisdata.baltimorecity.gov/egis/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(Description) LIKE '%SOLAR%'",
        "prefix": "permit_baltimore",
        "transform": "baltimore",
    },
    "louisville": {
        "tier": 0,
        "name": "Louisville/Jefferson County, KY",
        "state": "KY",
        "county": "JEFFERSON",
        "platform": "arcgis",
        "base_url": "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/Louisville_Metro_KY_All_Permits_%28Historical%29/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(WORKTYPE) LIKE '%SOLAR%' OR UPPER(CATEGORYNAME) LIKE '%SOLAR%' OR UPPER(CONTRACTOR) LIKE '%SOLAR%'",
        "prefix": "permit_louisville",
        "transform": "louisville",
    },
    "columbus": {
        "tier": 0,
        "name": "Columbus, OH",
        "state": "OH",
        "county": "FRANKLIN",
        "platform": "arcgis",
        "base_url": "https://maps2.columbus.gov/arcgis/rest/services/Schemas/BuildingZoning/MapServer/5",
        "page_size": 1000,
        "oid_paging": True,
        "out_sr": "4326",
        "ssl_no_verify": True,
        "filter": "UPPER(APPLICANT_BUS_NAME) LIKE '%SOLAR%'",
        "prefix": "permit_columbus",
        "transform": "columbus",
    },
    "charlotte": {
        "tier": 0,
        "name": "Charlotte/Mecklenburg County, NC",
        "state": "NC",
        "county": "MECKLENBURG",
        "platform": "arcgis",
        "base_url": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0",
        "page_size": 2000,
        "out_sr": "4326",
        "filter": "UPPER(workdesc) LIKE '%SOLAR%' OR UPPER(permitdesc) LIKE '%SOLAR%' OR UPPER(workdesc) LIKE '%PHOTOVOLTAIC%' OR UPPER(permitdesc) LIKE '%PHOTOVOLTAIC%'",
        "prefix": "permit_charlotte",
        "transform": "charlotte",
    },
    "portland": {
        "tier": 0,
        "name": "Portland, OR",
        "state": "OR",
        "county": "MULTNOMAH",
        "platform": "arcgis",
        "base_url": "https://www.portlandmaps.com/arcgis/rest/services/Public/BDS_Permit/MapServer/4",
        "page_size": 1000,
        "oid_paging": True,
        "out_sr": "4326",
        "filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR UPPER(DESCRIPTION) LIKE '%PHOTOVOLTAIC%'",
        "prefix": "permit_portland",
        "transform": "portland",
        "has_equipment": True,
    },
    "nashville": {
        "tier": 0,
        "name": "Nashville, TN",
        "state": "TN",
        "county": "DAVIDSON",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Trade_Permits_View/FeatureServer/0",
        "page_size": 1000,
        "out_sr": "4326",
        "filter": "UPPER(Permit_Subtype_Description) LIKE '%PHOTOVOLTAIC%'",
        "prefix": "permit_nashville",
        "transform": "nashville",
        "has_equipment": True,
    },

    # --- CKAN: Rich equipment data ---
    "virginia_beach": {
        "tier": 0,
        "name": "Virginia Beach, VA",
        "state": "VA",
        "county": "VIRGINIA BEACH",
        "platform": "ckan",
        "base_url": "https://data.virginia.gov/api/3/action/datastore_search",
        "resource_id": "d66e8fbe-ce6f-431b-873b-b017a8c42861",
        "page_size": 100,
        "prefix": "permit_vabeach",
        "transform": "virginia_beach",
        "has_equipment": True,
    },
    "boston_ckan": {
        "tier": 2,
        "name": "Boston, MA (CKAN)",
        "state": "MA",
        "county": "SUFFOLK",
        "platform": "ckan",
        "base_url": "https://data.boston.gov/api/3/action/datastore_search",
        "resource_id": "6ddcd912-32a0-43df-9908-63574f8c7e77",
        "page_size": 100,
        "prefix": "permit_boston_ckan",
        "transform": "boston_ckan",
    },
    "tampa": {
        "tier": 0,
        "name": "Tampa, FL",
        "state": "FL",
        "county": "HILLSBOROUGH",
        "platform": "ckan",
        "base_url": "https://www.civicdata.com/api/3/action/datastore_search",
        "resource_id": "474844a7-3bd1-4722-bc8b-9ec5a5f82508",
        "page_size": 100,
        "prefix": "permit_tampa",
        "transform": "tampa",
        "has_equipment": True,
    },

    # --- Socrata: Generic transform cities ---
    "henderson": {
        "tier": 2,
        "name": "Henderson, NV",
        "state": "NV",
        "county": "CLARK",
        "platform": "socrata",
        "base_url": "https://performance.cityofhenderson.com/resource/fpc9-568j.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'permitdescription')} OR UPPER(permittype) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(permittype) LIKE '%25PV%25'",
        "prefix": "permit_henderson",
        "transform": "generic_socrata",
    },
    "corona": {
        "tier": 2,
        "name": "Corona, CA",
        "state": "CA",
        "county": "RIVERSIDE",
        "platform": "socrata",
        "base_url": "https://corstat.coronaca.gov/resource/2agx-camz.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE} OR UPPER(permitsubtype) LIKE '%25SOLAR%25'",
        "prefix": "permit_corona",
        "transform": "generic_socrata",
    },
    "marin_county": {
        "tier": 2,
        "name": "Marin County, CA",
        "state": "CA",
        "county": "MARIN",
        "platform": "socrata",
        "base_url": "https://data.marincounty.gov/resource/mkbn-caye.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_marin",
        "transform": "generic_socrata",
    },
    "sonoma_county": {
        "tier": 2,
        "name": "Sonoma County, CA",
        "state": "CA",
        "county": "SONOMA",
        "platform": "socrata",
        "base_url": "https://data.sonomacounty.ca.gov/resource/88ms-k5e7.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_sonoma",
        "transform": "generic_socrata",
    },
    # Cincinnati OH: REMOVED — 0 solar records found, description field only echoes permit type name
    "pierce_county": {
        "tier": 3,
        "name": "Pierce County, WA",
        "state": "WA",
        "county": "PIERCE",
        "platform": "socrata",
        "base_url": "https://open.piercecountywa.gov/resource/rcj9-mkn4.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'workdescription')}",
        "prefix": "permit_pierce",
        "transform": "generic_socrata",
    },
    "little_rock": {
        "tier": 3,
        "name": "Little Rock, AR",
        "state": "AR",
        "county": "PULASKI",
        "platform": "socrata",
        "base_url": "https://data.littlerock.gov/resource/mkfu-qap3.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'projectdesc')}",
        "prefix": "permit_littlerock",
        "transform": "generic_socrata",
    },
    "prince_georges_county": {
        "tier": 3,
        "name": "Prince George's County, MD",
        "state": "MD",
        "county": "PRINCE GEORGE'S",
        "platform": "socrata",
        "base_url": "https://data.princegeorgescountymd.gov/resource/weik-ttee.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'case_name')}",
        "prefix": "permit_pgcounty",
        "transform": "generic_socrata",
    },
    "framingham": {
        "tier": 3,
        "name": "Framingham, MA",
        "state": "MA",
        "county": "MIDDLESEX",
        "platform": "socrata",
        "base_url": "https://data.framinghamma.gov/resource/2vzw-yean.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE} OR UPPER(sub_type) LIKE '%25SOLAR%25'",
        "prefix": "permit_framingham",
        "transform": "generic_socrata",
    },
    "somerville": {
        "tier": 3,
        "name": "Somerville, MA",
        "state": "MA",
        "county": "MIDDLESEX",
        "platform": "socrata",
        "base_url": "https://data.somervillema.gov/resource/vxgw-vmky.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE.replace('description', 'work')}",
        "prefix": "permit_somerville",
        "transform": "generic_socrata",
    },

    # =========================================================================
    # TIER 5: State-level program datasets (not building permits)
    # =========================================================================
    "ny_statewide": {
        "tier": 1,
        "name": "New York Statewide Distributed Solar",
        "state": "NY",
        "platform": "socrata",
        "base_url": "https://data.ny.gov/resource/wgsj-jt5f.json",
        "page_size": 1000,
        "filter": "$where=estimated_pv_system_size >= 25",
        "prefix": "nydist",
        "transform": "ny_statewide",
    },
    "ct_rsip": {
        "tier": 1,
        "name": "Connecticut RSIP Solar",
        "state": "CT",
        "platform": "socrata",
        "base_url": "https://data.ct.gov/resource/fvw8-89kt.json",
        "page_size": 1000,
        "filter": "$where=kw_stc >= 25",
        "prefix": "ctrsip",
        "transform": "ct_rsip",
    },
    "collin_county": {
        "tier": 2,
        "name": "Collin County, TX",
        "state": "TX",
        "county": "COLLIN",
        "platform": "socrata",
        "base_url": "https://data.texas.gov/resource/82ee-gbj5.json",
        "page_size": 1000,
        "filter": "$where=UPPER(permittypedescr) LIKE '%25SOLAR%25'",
        "prefix": "permit_collintx",
        "transform": "collin_county",
    },
    # --- Session 11 additions ---
    "fort_collins": {
        "tier": 0,
        "name": "Fort Collins, CO (Solar Interconnections)",
        "state": "CO",
        "county": "LARIMER",
        "platform": "socrata",
        "base_url": "https://opendata.fcgov.com/resource/3ku5-x4k9.json",
        "page_size": 1000,
        "filter": "",
        "prefix": "fcgov_solar",
        "transform": "fort_collins",
    },
    "cambridge_installations": {
        "tier": 0,
        "name": "Cambridge, MA (Solar Installations)",
        "state": "MA",
        "county": "MIDDLESEX",
        "platform": "socrata",
        "base_url": "https://data.cambridgema.gov/resource/5a85-fb2s.json",
        "page_size": 1000,
        "filter": "$where=systemtype='PV'",
        "prefix": "cambridge_solar",
        "transform": "cambridge_installations",
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_get(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def supabase_post(table, records):
    """POST batch of records with ignore-duplicates."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    try:
        body = json.dumps(records, allow_nan=False).encode()
    except ValueError:
        # NaN/Infinity in records — clean them
        import math
        for r in records:
            for k, v in list(r.items()):
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    r[k] = None
        body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True, None
    except Exception as e:
        err_body = ""
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                pass
        return False, f"{e} | {err_body}" if err_body else str(e)


def get_existing_source_ids(prefix):
    """Get existing source_record_ids with given prefix."""
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}_*",
            "offset": offset,
            "limit": 1000,
        })
        if not batch:
            break
        for r in batch:
            existing.add(r["source_record_id"])
        offset += len(batch)
        if len(batch) < 1000:
            break
    return existing


def get_data_source_id(name):
    """Get or create data source ID."""
    rows = supabase_get("solar_data_sources", {"name": f"eq.{name}", "select": "id"})
    if rows:
        return rows[0]["id"]
    url = f"{SUPABASE_URL}/rest/v1/solar_data_sources"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    body = json.dumps({"name": name, "url": "Municipal permit open data portal"}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


# ---------------------------------------------------------------------------
# API fetchers
# ---------------------------------------------------------------------------

def fetch_opendatasoft(config):
    """Fetch all records from OpenDataSoft API."""
    records = []
    offset = 0
    while True:
        url = f"{config['base_url']}?limit={config['page_size']}&offset={offset}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
        batch = data.get("records", [])
        if not batch:
            break
        for rec in batch:
            fields = rec.get("record", {}).get("fields", {})
            if not fields:
                fields = rec.get("fields", {})
            records.append(fields)
        offset += len(batch)
        total = data.get("total_count", 0)
        if offset % 500 == 0 or offset >= total:
            print(f"    Fetched {offset}/{total}...")
        if offset >= total:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_socrata(config):
    """Fetch all records from Socrata SODA API."""
    records = []
    offset = 0
    while True:
        params = f"$limit={config['page_size']}&$offset={offset}"
        if config.get("filter"):
            params += "&" + config["filter"]
        safe_chars = "$=&%'()"
        url = f"{config['base_url']}?{urllib.parse.quote(params, safe=safe_chars)}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        if not data:
            break
        records.extend(data)
        offset += len(data)
        if offset % 1000 == 0:
            print(f"    Fetched {offset}...")
        if len(data) < config["page_size"]:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_arcgis(config):
    """Fetch all records from ArcGIS FeatureServer/MapServer REST API.

    Uses offset-based pagination for FeatureServer, and OBJECTID-based
    pagination for older MapServer endpoints that ignore resultOffset.
    """
    records = []
    offset = 0
    use_oid_paging = config.get("oid_paging", False)
    last_oid = 0
    seen_oids = set()

    while True:
        where = config.get("filter", "1=1")
        if use_oid_paging and last_oid > 0:
            where = f"({where}) AND OBJECTID > {last_oid}"

        params = {
            "where": where,
            "outFields": "*",
            "resultRecordCount": config["page_size"],
            "f": "json",
            "returnGeometry": "true",
            "orderByFields": "OBJECTID ASC" if use_oid_paging else "",
        }
        if not use_oid_paging:
            params["resultOffset"] = offset
        if config.get("out_sr"):
            params["outSR"] = config["out_sr"]

        url = f"{config['base_url']}/query?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        try:
            ctx = None
            if config.get("ssl_no_verify"):
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, context=ctx) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        features = data.get("features", [])
        if not features:
            break

        new_count = 0
        for feat in features:
            rec = feat.get("attributes", {})
            oid = rec.get("OBJECTID") or rec.get("ObjectId") or rec.get("objectid")
            # Dedup: skip records we've already seen (MapServer pagination bug)
            if oid and oid in seen_oids:
                continue
            if oid:
                seen_oids.add(oid)
                last_oid = max(last_oid, oid)

            geo = feat.get("geometry", {})
            if geo:
                if "y" in geo and "x" in geo:
                    rec["_lat"] = geo.get("y")
                    rec["_lng"] = geo.get("x")
                elif "rings" in geo:
                    # Polygon geometry — compute centroid from first ring
                    ring = geo["rings"][0] if geo["rings"] else []
                    if ring:
                        xs = [p[0] for p in ring]
                        ys = [p[1] for p in ring]
                        rec["_lng"] = sum(xs) / len(xs)
                        rec["_lat"] = sum(ys) / len(ys)
            records.append(rec)
            new_count += 1

        offset += len(features)
        if offset % 1000 == 0 or new_count == 0:
            print(f"    Fetched {len(records)}...")

        # Stop if no new records (dedup caught all — server is looping)
        if new_count == 0:
            break
        if not data.get("exceededTransferLimit", False) and len(features) < config["page_size"]:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_arcgis_multilayer(config):
    """Fetch from multiple ArcGIS FeatureServer layers and combine."""
    all_records = []
    base = config["base_url"]  # e.g., .../FeatureServer (no layer suffix)
    layers = config.get("layers", [0])
    for layer_id in layers:
        layer_config = dict(config)
        layer_config["base_url"] = f"{base}/{layer_id}"
        print(f"    Layer {layer_id}...")
        records = fetch_arcgis(layer_config)
        print(f"      {len(records)} records from layer {layer_id}")
        all_records.extend(records)
    return all_records


def fetch_carto(config):
    """Fetch all records from CARTO SQL API."""
    records = []
    offset = 0
    while True:
        where = config.get("filter", "1=1")
        table = config.get("table_name", "permits")
        sql = f"SELECT * FROM {table} WHERE {where} LIMIT {config['page_size']} OFFSET {offset}"
        params = urllib.parse.urlencode({"q": sql, "format": "json"})
        url = f"{config['base_url']}?{params}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        rows = data.get("rows", [])
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        if offset % 1000 == 0:
            print(f"    Fetched {offset}...")
        if len(rows) < config["page_size"]:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_ckan(config):
    """Fetch all records from CKAN Datastore API.

    Supports two modes:
    - Text search: q="solar" (default, used by San Jose)
    - Filter search: filters={"PERMIT TYPE":"Solar..."} (used by San Antonio)
    """
    records = []
    offset = 0
    while True:
        params = {
            "resource_id": config["resource_id"],
            "limit": config["page_size"],
            "offset": offset,
        }
        # Use exact filters if provided, otherwise text search
        if "ckan_filters" in config:
            params["filters"] = json.dumps(config["ckan_filters"])
        else:
            params["q"] = "solar"
        url = f"{config['base_url']}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        result = data.get("result", {})
        rows = result.get("records", [])
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        total = result.get("total", 0)
        if offset % 500 == 0 or offset >= total:
            print(f"    Fetched {offset}/{total}...")
        if offset >= total:
            break
        time.sleep(RATE_LIMIT)
    return records


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_capacity_from_description(desc):
    """Extract kW capacity from free-text description."""
    if not desc:
        return None
    # Match "9.6 kW", "250 KW", "9.6kW", "9.600 kw"
    m = re.search(r'([\d]+\.?\d*)\s*kw', desc, re.IGNORECASE)
    if m:
        try:
            val = float(m.group(1))
            if 0.1 <= val <= 100000:  # sanity check
                return val
        except ValueError:
            pass
    return None


def parse_panels_from_description(desc):
    """Extract panel count and wattage from description."""
    if not desc:
        return None, None
    # "installing 20 solar panels" or "24 modules"
    panels = None
    m = re.search(r'(\d+)\s*(?:solar\s+)?(?:panel|module|pv\s+module)', desc, re.IGNORECASE)
    if m:
        panels = int(m.group(1))
    # "300 watt" or "400W per panel"
    watts = None
    m = re.search(r'(\d+)\s*(?:watt|w)\b', desc, re.IGNORECASE)
    if m:
        watts = int(m.group(1))
        if watts < 50 or watts > 1000:  # not a panel wattage
            watts = None
    return panels, watts


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_date(val):
    """Extract YYYY-MM-DD from various date formats including Unix ms timestamps."""
    if not val:
        return None
    # Handle Unix millisecond timestamps (ArcGIS returns these)
    if isinstance(val, (int, float)) and val > 946684800000:  # After year 2000 in ms
        try:
            import datetime
            dt = datetime.datetime.utcfromtimestamp(val / 1000)
            return dt.strftime("%Y-%m-%d")
        except (ValueError, OSError):
            pass
    s = str(val).strip()
    # Check for pure numeric (Unix ms as string)
    if s.isdigit() and len(s) >= 12:
        try:
            import datetime
            dt = datetime.datetime.utcfromtimestamp(int(s) / 1000)
            return dt.strftime("%Y-%m-%d")
        except (ValueError, OSError):
            pass
    if "T" in s:
        s = s.split("T")[0]
    # Validate it looks like a date
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return None


def is_solar_false_positive(desc):
    """Check if a description is a solar screen/shade/tube, not PV."""
    if not desc:
        return False
    return bool(SOLAR_FALSE_POSITIVES.search(desc))


def make_installation(source_id, config, **fields):
    """Build installation record with required keys."""
    capacity_kw = fields.get("capacity_kw")
    return {
        "source_record_id": source_id,
        "site_name": fields.get("site_name"),
        "site_type": fields.get("site_type", "commercial"),
        "address": fields.get("address"),
        "city": fields.get("city"),
        "state": config["state"],
        "zip_code": fields.get("zip_code"),
        "county": fields.get("county", config.get("county")),
        "latitude": fields.get("latitude"),
        "longitude": fields.get("longitude"),
        "capacity_dc_kw": capacity_kw,
        "capacity_mw": round(capacity_kw / 1000, 3) if capacity_kw else None,
        "install_date": fields.get("install_date"),
        "site_status": fields.get("site_status", "active"),
        "installer_name": fields.get("installer_name"),
        "owner_name": fields.get("owner_name"),
        "developer_name": fields.get("developer_name"),
        "operator_name": fields.get("operator_name"),
        "total_cost": fields.get("total_cost"),
        "data_source_id": fields.get("data_source_id"),
        "has_battery_storage": fields.get("has_battery_storage", False),
    }


# ---------------------------------------------------------------------------
# City-specific transformers
# ---------------------------------------------------------------------------

def transform_cambridge_rich(record, data_source_id, config):
    """Cambridge MA — best dataset. Has inverter make/model, mount type, panel count."""
    permit_id = record.get("id", "") or record.get("viewpoint_id", "") or record.get("permit_number", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_cambridge_{permit_id}"

    # Capacity
    kw = safe_float(record.get("solar_system_size") or record.get("watt_capacity"))
    if kw and kw > 10000:
        # watt_capacity is in watts, convert to kW
        kw = kw / 1000

    building_use = str(record.get("building_use", "")).lower()
    site_type = "commercial" if "commercial" in building_use or "industrial" in building_use else "commercial"

    mount = str(record.get("mount_type", "")).lower()
    mount_type = None
    if "ground" in mount:
        mount_type = "ground_fixed"
    elif "roof" in mount:
        mount_type = "rooftop"

    battery = record.get("battery_storage_capacity")
    has_battery = bool(battery and safe_float(battery))

    cost = safe_float(record.get("total_cost"))

    inst = make_installation(
        source_id, config,
        address=record.get("full_address", ""),
        city="Cambridge",
        latitude=safe_float(record.get("latitude")),
        longitude=safe_float(record.get("longitude")),
        capacity_kw=kw,
        install_date=safe_date(record.get("issue_date")),
        installer_name=record.get("firm_name", ""),
        total_cost=cost,
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    # Equipment records for inverter
    equipment = []
    inv_model = record.get("inverter_make_and_model", "")
    if inv_model and inv_model.strip():
        # Split "SolarEdge SE7600H-US" into manufacturer + model
        parts = inv_model.strip().split(" ", 1)
        equipment.append({
            "equipment_type": "inverter",
            "manufacturer": parts[0] if parts else inv_model.strip(),
            "model": parts[1] if len(parts) > 1 else None,
            "quantity": safe_float(record.get("inverter_count")) or 1,
        })

    panel_count = safe_float(record.get("photovoltaic_panel_count"))
    if panel_count:
        equipment.append({
            "equipment_type": "module",
            "quantity": int(panel_count),
        })

    return source_id, inst, equipment if equipment else None


def transform_cary(record, data_source_id, config):
    """Cary NC — OpenDataSoft solar-specific dataset."""
    permit_num = record.get("permitnum", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_cary_{permit_num}"
    desc = record.get("description", "")
    capacity_kw = parse_capacity_from_description(desc)

    inst = make_installation(
        source_id, config,
        address=record.get("originaladdress1", ""),
        city=record.get("originalcity", "Cary"),
        zip_code=str(record.get("originalzip", "")) if record.get("originalzip") else None,
        latitude=safe_float(record.get("latitude")),
        longitude=safe_float(record.get("longitude")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issuedate")),
        installer_name=record.get("contractorcompanyname", ""),
        owner_name=record.get("ownername", ""),
        total_cost=safe_float(record.get("projectcost")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_richmond(record, data_source_id, config):
    """Richmond CA — solar-specific dataset (all records have subtype=SOLAR)."""
    permit_id = record.get("permit_no", "") or record.get("permit_number", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_richmond_{permit_id}"

    # Location from geocoded_column
    lat, lng = None, None
    geo = record.get("geocoded_column")
    if isinstance(geo, dict):
        coords = geo.get("coordinates", [])
        if coords and len(coords) >= 2:
            lng, lat = coords[0], coords[1]

    desc = record.get("description", "")
    capacity_kw = parse_capacity_from_description(desc)

    inst = make_installation(
        source_id, config,
        address=record.get("site_address", ""),
        city=record.get("site_city", "Richmond"),
        zip_code=record.get("site_zip"),
        latitude=safe_float(lat),
        longitude=safe_float(lng),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issued")),
        total_cost=safe_float(record.get("jobvalue")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_honolulu(record, data_source_id, config):
    """Honolulu HI — building permits with solar='Y' boolean."""
    permit_id = record.get("buildingpermitno", "") or record.get("buildingpermitnumber", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_honolulu_{permit_id}"

    addr = record.get("address", "") or record.get("jobaddress", "")
    comm_res = str(record.get("commercialresidential", "")).lower()
    site_type = "commercial" if "commercial" in comm_res else "commercial"

    # Contractor — prefer electrical contractor (cleaner), fall back to general
    installer = record.get("contractorelectrical", "")
    if not installer or installer.strip().upper() == "NONE":
        raw = record.get("contractor", "")
        # Clean contractor field (has embedded newlines + license info)
        if raw:
            installer = raw.split("\n")[0].strip()
            if installer.upper() == "NONE":
                installer = ""

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Honolulu",
        capacity_kw=None,
        install_date=safe_date(record.get("issuedate")),
        installer_name=installer,
        total_cost=safe_float(record.get("estimatedvalueofwork")),
        site_type=site_type,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_nyc(record, data_source_id, config):
    """NYC — DOB permit issuance filtered to solar."""
    job_num = record.get("job__", "")
    permit_seq = record.get("permit_sequence__", "01")
    if not job_num:
        return None, None, None

    source_id = f"permit_nyc_{job_num}_{permit_seq}"

    borough_map = {"1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island"}
    house = record.get("house__", "")
    street = record.get("street_name", "")
    borough = borough_map.get(str(record.get("borough", "")), "")
    addr = f"{house} {street}".strip() if house or street else None

    owner_biz = record.get("owner_s_business_name", "")
    owner_first = record.get("owner_s_first_name", "")
    owner_last = record.get("owner_s_last_name", "")
    owner = owner_biz.strip() if owner_biz and owner_biz.strip() else None
    if not owner and owner_last:
        owner = f"{owner_first} {owner_last}".strip() if owner_first else owner_last

    installer = record.get("permittee_s_business_name", "")

    lat = safe_float(record.get("gis_latitude"))
    lng = safe_float(record.get("gis_longitude"))

    inst = make_installation(
        source_id, config,
        address=addr,
        city=borough if borough else "New York",
        zip_code=record.get("zip_code"),
        latitude=lat,
        longitude=lng,
        install_date=safe_date(record.get("issuance_date")),
        installer_name=installer,
        owner_name=owner,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_sf(record, data_source_id, config):
    """San Francisco CA — rich descriptions with panel specs."""
    permit_num = record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_sf_{permit_num}"
    desc = record.get("description", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat, lng = None, None
    loc = record.get("location")
    if isinstance(loc, dict):
        lat = safe_float(loc.get("latitude"))
        lng = safe_float(loc.get("longitude"))

    inst = make_installation(
        source_id, config,
        address=f"{record.get('street_number', '')} {record.get('street_name', '')}".strip() or None,
        city="San Francisco",
        zip_code=record.get("zipcode"),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issued_date")),
        total_cost=safe_float(record.get("estimated_cost")),
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_la(record, data_source_id, config):
    """Los Angeles CA — explicit solar='Y' boolean column."""
    permit_num = record.get("permit_nbr", "") or record.get("permit__", "") or record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_la_{permit_num}"
    desc = record.get("work_desc", "") or record.get("description", "")
    capacity_kw = parse_capacity_from_description(desc)

    inst = make_installation(
        source_id, config,
        address=record.get("primary_address", "") or record.get("address", ""),
        city="Los Angeles",
        zip_code=record.get("zip_code"),
        latitude=safe_float(record.get("lat")),
        longitude=safe_float(record.get("lon")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date")),
        total_cost=safe_float(record.get("valuation")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_chicago(record, data_source_id, config):
    """Chicago IL — work descriptions with inverter/array output specs."""
    permit_num = record.get("id", "") or record.get("permit_", "")
    if not permit_num:
        permit_num = record.get(":id", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_chicago_{permit_num}"
    desc = record.get("work_description", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Extract inverter kW from description
    inv_kw = None
    m = re.search(r'inverter\s+output\s+([\d.]+)\s*kw', desc, re.IGNORECASE)
    if m:
        inv_kw = safe_float(m.group(1))

    lat, lng = None, None
    loc = record.get("location")
    if isinstance(loc, dict):
        lat = safe_float(loc.get("latitude"))
        lng = safe_float(loc.get("longitude"))

    addr_parts = [
        record.get("street_number", ""),
        record.get("street_direction", ""),
        record.get("street_name", ""),
        record.get("suffix", ""),
    ]
    addr = " ".join(p for p in addr_parts if p).strip() or None

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Chicago",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date")),
        installer_name=record.get("contact_1_name", ""),
        total_cost=safe_float(record.get("reported_cost")),
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    if inv_kw:
        equipment.append({
            "equipment_type": "inverter",
            "specs": {"capacity_kw": inv_kw},
        })

    return source_id, inst, equipment if equipment else None


def transform_austin(record, data_source_id, config):
    """Austin TX — BLDS-compliant with contractor."""
    permit_num = record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_austin_{permit_num}"
    desc = record.get("description", "")
    capacity_kw = parse_capacity_from_description(desc)

    inst = make_installation(
        source_id, config,
        address=record.get("original_address1", "") or record.get("permit_location", ""),
        city=record.get("original_city", "Austin"),
        zip_code=record.get("original_zip"),
        latitude=safe_float(record.get("latitude")),
        longitude=safe_float(record.get("longitude")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date")),
        installer_name=record.get("contractor_company_desc", ""),
        total_cost=safe_float(record.get("project_valuation")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_seattle(record, data_source_id, config):
    """Seattle WA — building permits with contractor."""
    permit_num = record.get("permitnum", "") or record.get("application_permit_number", "") or record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_seattle_{permit_num}"
    desc = record.get("description", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    inst = make_installation(
        source_id, config,
        address=record.get("originaladdress1", "") or record.get("address", ""),
        city=record.get("originalcity", "Seattle"),
        zip_code=record.get("originalzip"),
        latitude=safe_float(record.get("latitude")),
        longitude=safe_float(record.get("longitude")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date")),
        installer_name=record.get("contractor_name", ""),
        total_cost=safe_float(record.get("value")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_blds(record, data_source_id, config):
    """Generic BLDS (Building and Land Development Specification) transform."""
    permit_num = record.get("permitnum", "") or record.get("permit_num", "") or record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"{config['prefix']}_{permit_num}"
    desc = record.get("description", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    addr = record.get("originaladdress1", "") or record.get("address", "") or record.get("original_address1", "")
    city_name = record.get("originalcity", "") or record.get("original_city", "")
    if not city_name:
        city_name = config["name"].split(",")[0].strip()

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city_name,
        zip_code=record.get("originalzip", "") or record.get("original_zip", ""),
        latitude=safe_float(record.get("latitude")),
        longitude=safe_float(record.get("longitude")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issuedate") or record.get("issued_date") or record.get("issue_date")),
        installer_name=record.get("contractor_name", "") or record.get("contractor_company_desc", ""),
        total_cost=safe_float(record.get("estprojectcost") or record.get("project_valuation") or record.get("fee", "")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_generic_socrata(record, data_source_id, config):
    """Generic Socrata building permit transform — tries common field names."""
    # Try many common permit ID field names
    permit_num = None
    for field in ["permit_number", "permit_num", "permitnum", "permitnumber", "permitno", "permit_no",
                   "permit_", "permit", "id", "permit_id", "application_number", "applicationnumber",
                   "record_number", "case_number", "file_number", "permit_case_id",
                   "permit_tracking_id", "objectid"]:
        val = record.get(field)
        if val and str(val).strip():
            permit_num = str(val).strip()
            break
    if not permit_num:
        permit_num = record.get(":id", "")
    if not permit_num:
        return None, None, None

    source_id = f"{config['prefix']}_{permit_num}"

    # Description from multiple possible fields
    desc = ""
    for field in ["description", "work_description", "work_desc", "permit_description",
                   "permitdescription", "scope_of_work", "project_description", "projectdesc",
                   "workdescription", "work", "case_name"]:
        val = record.get(field)
        if val and str(val).strip():
            desc = str(val).strip()
            break

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    # Address from multiple possible fields
    addr = None
    for field in ["address", "street_address", "site_address", "location_address",
                   "original_address1", "originaladdress1", "primary_address", "project_address",
                   "property_address", "propertyaddress", "full_address", "siteaddress"]:
        val = record.get(field)
        if val and str(val).strip():
            addr = str(val).strip()
            break
    # Fallback: build from stno + stname (Montgomery County style)
    if not addr:
        stno = record.get("stno", "")
        stname = record.get("stname", "")
        suffix = record.get("suffix", "")
        if stno and stname:
            addr = f"{stno} {stname} {suffix}".strip()

    # City
    city = None
    for field in ["city", "original_city", "originalcity", "site_city", "mailing_city",
                   "parceladdresscity", "propertycity", "city_town"]:
        val = record.get(field)
        if val and str(val).strip():
            city = str(val).strip()
            break
    if not city:
        city = config["name"].split(",")[0].strip()

    # Zip
    zip_code = None
    for field in ["zip_code", "zipcode", "zip", "original_zip", "originalzip", "site_zip",
                   "postal_code", "parceladdresszip", "propertyzip"]:
        val = record.get(field)
        if val and str(val).strip():
            zip_code = str(val).strip()
            break

    # Coordinates
    lat, lng = None, None
    lat = safe_float(record.get("latitude") or record.get("lat") or record.get("gisy"))
    lng = safe_float(record.get("longitude") or record.get("lon") or record.get("lng") or record.get("gisx"))
    if not lat:
        # Try xcoord/ycoord (Pierce County)
        lat = safe_float(record.get("ycoord"))
        lng = safe_float(record.get("xcoord"))
    if not lat:
        for loc_field in ["location", "location_1", "gis_point", "geolocation", "the_geom"]:
            loc = record.get(loc_field)
            if isinstance(loc, dict):
                lat = safe_float(loc.get("latitude"))
                lng = safe_float(loc.get("longitude"))
                if not lat:
                    coords = loc.get("coordinates", [])
                    if coords and len(coords) >= 2:
                        lng, lat = safe_float(coords[0]), safe_float(coords[1])
                if lat:
                    break

    # Validate coordinate range (State Plane / projected coords would be way out of range)
    if lat and (lat < -90 or lat > 90 or lng < -180 or lng > 180):
        lat, lng = None, None

    # Date
    install_date = None
    for field in ["issue_date", "issued_date", "issueddate", "permit_issued_date", "date_issued",
                   "issuedate", "issuance_date", "permit_issuance_date", "issueddate",
                   "permitissuedate", "applied_date", "applied", "issuedate"]:
        val = record.get(field)
        if val:
            install_date = safe_date(val)
            if install_date:
                break

    # Installer
    installer = None
    for field in ["contractor_name", "contractor", "contractor_company_desc", "contact_1_name",
                   "applicant_name", "firm_name", "company_name", "companyname",
                   "professionalname"]:
        val = record.get(field)
        if val and str(val).strip():
            installer = str(val).strip()
            break

    # Cost
    cost = None
    for field in ["project_valuation", "estimated_cost", "valuation", "valuationtotal",
                   "value", "total_cost", "reported_cost", "job_value", "jobvalue",
                   "estimated_job_cost", "estprojectcostdec", "construction_value",
                   "buildingvaluation", "declvltn", "amount", "fee"]:
        val = record.get(field)
        if val:
            cost = safe_float(val)
            if cost:
                break

    # Owner
    owner = None
    for field in ["owner_name", "property_owner_name", "owner", "ownername", "property_owner",
                   "owner_company_name"]:
        val = record.get(field)
        if val and str(val).strip():
            owner = str(val).strip()
            break

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city,
        zip_code=zip_code,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=install_date,
        installer_name=installer,
        owner_name=owner,
        total_cost=cost,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_salt_lake_city(record, data_source_id, config):
    """Salt Lake City UT — Socrata with location field containing embedded coords."""
    permit_num = record.get("permitnum", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_slc_{permit_num}"
    desc = record.get("workdescription", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    # Build address from components
    house = record.get("projecthousenbr", "")
    street_dir = record.get("projectstreetdir", "")
    street_name = record.get("projectstreetname", "")
    suffix = record.get("projectstreetsufx", "")
    addr = " ".join(p for p in [house, street_dir, street_name, suffix] if p).strip() or None

    # Parse lat/lng from location field: "516 E 12TH Ave\nSalt Lake City, UT 84103\n(40.783, -111.874)"
    lat, lng = None, None
    loc = record.get("location", "")
    if isinstance(loc, str):
        m = re.search(r'\(([-\d.]+),\s*([-\d.]+)\)', loc)
        if m:
            lat = safe_float(m.group(1))
            lng = safe_float(m.group(2))

    zip_code = record.get("zipcode", "")
    if zip_code and "-" in zip_code:
        zip_code = zip_code.split("-")[0]  # Strip +4

    installer = record.get("applicantbusinessname", "")

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Salt Lake City",
        zip_code=zip_code if zip_code else None,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("completedate") or record.get("applicationdate")),
        installer_name=installer,
        total_cost=safe_float(record.get("total_fee")),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_sacramento(record, data_source_id, config):
    """Sacramento CA — ArcGIS with Category='Solar System' and Work_Desc."""
    permit_num = record.get("Application", "") or record.get("PERMIT_NUM", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_sacramento_{permit_num}"
    desc = record.get("Work_Desc", "") or record.get("work_desc", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Check for battery storage in description
    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("Address", ""),
        city="Sacramento",
        zip_code=str(record.get("ZIP", "")) if record.get("ZIP") else None,
        latitude=safe_float(record.get("_lat")),
        longitude=safe_float(record.get("_lng")),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("Status_Date")),
        installer_name=record.get("Contractor", ""),
        total_cost=safe_float(record.get("Valuation")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_philadelphia(record, data_source_id, config):
    """Philadelphia PA — Carto SQL with rich approvedscopeofwork field."""
    permit_num = record.get("permitnumber", "") or record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_philly_{permit_num}"
    desc = record.get("approvedscopeofwork", "") or record.get("permitdescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Parse manufacturer from description (e.g., "JA SOLAR panels", "SolarEdge inverter")
    equip_manufacturer = None
    equip_model = None
    for mfr in ["JA Solar", "Canadian Solar", "Hanwha", "Qcells", "Q CELLS", "REC", "LG",
                 "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar", "Panasonic",
                 "Solaria", "Axitec", "Aptos", "Meyer Burger", "Maxeon"]:
        if mfr.lower() in desc.lower():
            equip_manufacturer = mfr
            break

    inv_manufacturer = None
    for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla"]:
        if mfr.lower() in desc.lower():
            inv_manufacturer = mfr
            break

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    # Owner from Carto field
    owner = record.get("opa_owner", "")

    # Parse lat/lng from WKB hex geometry (geocode_x/y are State Plane, not lat/lng)
    lat, lng = None, None
    the_geom = record.get("the_geom")
    if the_geom and len(the_geom) >= 50:
        try:
            import struct, binascii, math
            wkb = binascii.unhexlify(the_geom)
            _lng = struct.unpack_from('<d', wkb, 9)[0]
            _lat = struct.unpack_from('<d', wkb, 17)[0]
            if (not math.isnan(_lat) and not math.isnan(_lng) and
                not math.isinf(_lat) and not math.isinf(_lng) and
                -90 <= _lat <= 90 and -180 <= _lng <= 180):
                lat, lng = _lat, _lng
        except Exception:
            pass

    # Commercial check
    comm_res = str(record.get("commercialorresidential", "")).lower()
    site_type = "commercial" if "commercial" in comm_res else "commercial"

    # Truncate zip to 5 digits
    zip_code = str(record.get("zip", "")) if record.get("zip") else None
    if zip_code and len(zip_code) > 5:
        zip_code = zip_code[:5]

    inst = make_installation(
        source_id, config,
        address=record.get("address", ""),
        city="Philadelphia",
        zip_code=zip_code,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("permitissuedate")),
        installer_name=record.get("contractorname", ""),
        owner_name=owner,
        total_cost=safe_float(record.get("totalprojectvalue")),
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if equip_manufacturer:
            eq["manufacturer"] = equip_manufacturer
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    if inv_manufacturer:
        equipment.append({
            "equipment_type": "inverter",
            "manufacturer": inv_manufacturer,
        })

    return source_id, inst, equipment if equipment else None


def transform_san_jose(record, data_source_id, config):
    """San Jose CA — CKAN with owner name, contractor, and work description."""
    permit_num = record.get("FOLDERNUMBER", "") or record.get("foldernumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_sanjose_{permit_num}"
    desc = record.get("WORKDESCRIPTION", "") or record.get("workdescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Coordinates from gx_location
    lat, lng = None, None
    loc = record.get("gx_location")
    if isinstance(loc, dict):
        lat = safe_float(loc.get("latitude"))
        lng = safe_float(loc.get("longitude"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("ADDRESS", "") or record.get("address", ""),
        city="San Jose",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUEDATE") or record.get("issuedate")),
        installer_name=record.get("CONTRACTOR", "") or record.get("contractor", ""),
        owner_name=record.get("OWNERNAME", "") or record.get("ownername", ""),
        total_cost=safe_float(record.get("PERMITVALUATION") or record.get("permitvaluation")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_denver(record, data_source_id, config):
    """Denver/Boulder CO — ArcGIS with dedicated solar fields (PV kW, PV cost)."""
    permit_num = record.get("PermitNum", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_denver_{permit_num}"
    desc = record.get("SolarSystemDescription", "") or record.get("Description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    # Dedicated PV kW field
    capacity_kw = safe_float(record.get("PhotovoltaicKilowatt"))
    if not capacity_kw:
        capacity_kw = parse_capacity_from_description(desc)

    panels, watts = parse_panels_from_description(desc)

    # No geometry from this endpoint — addresses only
    addr = record.get("OriginalAddress", "")
    city = record.get("OriginalCity", "")
    state = record.get("OriginalState", "CO")
    zip_code = record.get("OriginalZip", "")

    # Determine county from city
    county = None
    if city:
        city_upper = city.upper()
        if "BOULDER" in city_upper:
            county = "BOULDER"
        elif "DENVER" in city_upper:
            county = "DENVER"
        elif "AURORA" in city_upper:
            county = "ARAPAHOE"
        elif "LAKEWOOD" in city_upper or "GOLDEN" in city_upper:
            county = "JEFFERSON"
        elif "BROOMFIELD" in city_upper:
            county = "BROOMFIELD"
        elif "LONGMONT" in city_upper or "ERIE" in city_upper or "LOUISVILLE" in city_upper:
            county = "BOULDER"

    pv_cost = safe_float(record.get("EstPhotovoltaicCost"))
    project_cost = safe_float(record.get("EstProjectCost"))

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city if city else None,
        zip_code=zip_code if zip_code else None,
        county=county,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("IssuedDate") or record.get("AppliedDate")),
        installer_name=record.get("ContractorCompanyName", ""),
        total_cost=pv_cost or project_cost,
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_minneapolis(record, data_source_id, config):
    """Minneapolis MN — ArcGIS with lat/lng, installer, owner, cost, permit type."""
    permit_num = record.get("permitNumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_minneapolis_{permit_num}"
    desc = record.get("comments", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("Latitude") or record.get("_lat"))
    lng = safe_float(record.get("Longitude") or record.get("_lng"))

    # Owner from fullName
    owner = record.get("fullName", "")
    if owner and owner.strip().upper() in ("", "NONE", "N/A"):
        owner = ""

    installer = record.get("applicantName", "")

    inst = make_installation(
        source_id, config,
        address=record.get("Display", ""),
        city="Minneapolis",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issueDate")),
        installer_name=installer,
        owner_name=owner,
        total_cost=safe_float(record.get("value")),
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_detroit(record, data_source_id, config):
    """Detroit MI — ArcGIS with lat/lng, cost, detailed descriptions."""
    permit_num = record.get("record_id", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_detroit_{permit_num}"
    desc = record.get("work_description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("latitude") or record.get("_lat"))
    lng = safe_float(record.get("longitude") or record.get("_lng"))

    # Cost is a string field in Detroit's API
    cost = safe_float(record.get("amt_estimated_contractor_cost"))

    # Determine site type from current_use_type
    use_type = str(record.get("current_use_type", "")).lower()
    site_type = "commercial"
    if "single family" in use_type or "two family" in use_type or "residential" in use_type:
        site_type = "commercial"  # We keep as commercial per project spec (>= 25kW filter)

    inst = make_installation(
        source_id, config,
        address=record.get("address", ""),
        city="Detroit",
        zip_code=record.get("zip_code"),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issued_date") or record.get("submitted_date")),
        total_cost=cost,
        site_type=site_type,
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_albuquerque(record, data_source_id, config):
    """Albuquerque NM — ArcGIS with owner, contractor, applicant, and valuation."""
    permit_num = record.get("PermitNumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_abq_{permit_num}"
    desc = record.get("WorkDescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # ArcGIS geometry is Web Mercator — need to convert to WGS84
    lat, lng = None, None
    raw_lat = record.get("_lat")
    raw_lng = record.get("_lng")
    if raw_lat and raw_lng:
        # Web Mercator (EPSG:3857) to WGS84 conversion
        import math
        x = float(raw_lng)
        y = float(raw_lat)
        lng = x / 20037508.34 * 180.0
        lat = (math.atan(math.exp(y / 20037508.34 * math.pi)) * 360.0 / math.pi) - 90.0
        # Validate
        if lat < 30 or lat > 40 or lng < -110 or lng > -103:
            lat, lng = None, None

    addr = record.get("CalculatedAddress", "") or record.get("FreeFormAddress", "")
    owner = record.get("Owner", "")
    contractor = record.get("Contractor", "")
    applicant = record.get("Applicant", "")

    # Use contractor as installer, applicant as developer if different
    installer = contractor if contractor else applicant

    # Determine site type
    category = str(record.get("GeneralCategory", "")).lower()
    site_type = "commercial" if "commercial" in category else "commercial"

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Albuquerque",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("DateIssued")),
        installer_name=installer,
        owner_name=owner if owner else None,
        total_cost=safe_float(record.get("Valuation")),
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_riverside_county(record, data_source_id, config):
    """Riverside County CA — ArcGIS MapServer with rich CASE_DESCR (kW, modules, manufacturer)."""
    case_id = record.get("CASE_ID", "")
    if not case_id:
        return None, None, None

    source_id = f"permit_riverside_{case_id}"
    desc = record.get("CASE_DESCR", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    # Parse capacity from description: "5.33KW DC" or "206.93 MW DC"
    capacity_kw = None
    m = re.search(r'([\d]+\.?\d*)\s*MW\s*(?:DC|AC)?', desc, re.IGNORECASE)
    if m:
        mw = float(m.group(1))
        if 0.025 <= mw <= 5000:
            capacity_kw = mw * 1000
    if not capacity_kw:
        capacity_kw = parse_capacity_from_description(desc)

    panels, watts = parse_panels_from_description(desc)

    # Extract manufacturer from description
    equip_manufacturer = None
    for mfr in ["Qcells", "Q CELLS", "Canadian Solar", "JA Solar", "Hanwha", "REC", "LG",
                 "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar", "Panasonic",
                 "Solaria", "Axitec", "Aptos", "Maxeon"]:
        if mfr.lower() in desc.lower():
            equip_manufacturer = mfr
            break

    inv_manufacturer = None
    for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla"]:
        if mfr.lower() in desc.lower():
            inv_manufacturer = mfr
            break

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    # Mount type from CASE_WORK_CLASS
    work_class = str(record.get("CASE_WORK_CLASS", "")).upper()
    mount_type = None
    if "GROUND" in work_class or "GSLRR" in work_class:
        mount_type = "ground_fixed"
    elif "ROOF" in work_class or "RSLRR" in work_class:
        mount_type = "rooftop"

    # Site type — SLRC = commercial, DA03 = utility-scale development
    site_type = "commercial"
    if "DA03" in work_class or (capacity_kw and capacity_kw >= 1000):
        site_type = "utility"

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    # Date: prefer completed, then approved, then applied
    install_date = (safe_date(record.get("COMPLETED_DATE"))
                    or safe_date(record.get("APPROVED_DATE"))
                    or safe_date(record.get("APPLIED_DATE")))

    # Status mapping
    status = str(record.get("CASE_STATUS", "")).upper()
    site_status = "active"
    if "WITHDRAWN" in status or "EXPIRED" in status:
        site_status = "canceled"
    elif "APPLIED" in status:
        site_status = "proposed"

    inst = make_installation(
        source_id, config,
        city=record.get("SUBDIVISION_NAME"),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=install_date,
        site_type=site_type,
        site_status=site_status,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if equip_manufacturer:
            eq["manufacturer"] = equip_manufacturer
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    elif equip_manufacturer:
        equipment.append({"equipment_type": "module", "manufacturer": equip_manufacturer})
    if inv_manufacturer:
        equipment.append({"equipment_type": "inverter", "manufacturer": inv_manufacturer})

    return source_id, inst, equipment if equipment else None


def transform_dc(record, data_source_id, config):
    """Washington DC — ArcGIS multi-layer with owner + applicant."""
    permit_id = record.get("PERMIT_ID", "") or record.get("PERMITID", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_dc_{permit_id}"
    desc = record.get("DESC_OF_WORK", "") or record.get("DESCRIPTION", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("LATITUDE") or record.get("_lat"))
    lng = safe_float(record.get("LONGITUDE") or record.get("_lng"))

    owner = record.get("OWNER_NAME", "") or record.get("OWNERNAME", "")
    applicant = record.get("PERMIT_APPLICANT", "") or record.get("APPLICANT", "")

    addr = record.get("FULL_ADDRESS", "") or record.get("ADDRESS", "")

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Washington",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUE_DATE") or record.get("ISSUEDATE")),
        installer_name=applicant if applicant else None,
        owner_name=owner if owner else None,
        total_cost=safe_float(record.get("ESTIMATED_COST") or record.get("EST_NUM")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_miami_dade(record, data_source_id, config):
    """Miami-Dade County FL — ArcGIS with contractor and descriptions."""
    proc_num = record.get("PROCNUM", "") or record.get("PROCESS", "")
    if not proc_num:
        return None, None, None

    source_id = f"permit_miami_{proc_num}"
    desc = record.get("DESC1", "") or record.get("DESC2", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("ADDRESS", ""),
        city=record.get("CITY", ""),
        zip_code=str(record.get("ZIP", "")) if record.get("ZIP") else None,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUDATE") or record.get("ISSDATE")),
        installer_name=record.get("CONTRNAME", ""),
        total_cost=safe_float(record.get("JOBVALUE")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_kansas_city(record, data_source_id, config):
    """Kansas City MO — Socrata with contractor, no coordinates."""
    permit_num = record.get("permitnum", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_kc_{permit_num}"
    desc = record.get("description", "")

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("originaladdress1", ""),
        city=record.get("originalcity", "Kansas City"),
        zip_code=record.get("originalzip"),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issuedate")),
        installer_name=record.get("contractorcompanyname", ""),
        total_cost=safe_float(record.get("estprojectcost")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_orlando(record, data_source_id, config):
    """Orlando FL — Socrata with owner + contractor, minimal coordinates."""
    permit_num = record.get("permit_number", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_orlando_{permit_num}"
    desc = record.get("project_name", "") or record.get("description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("latitude"))
    lng = safe_float(record.get("longitude"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("permit_address", ""),
        city="Orlando",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date") or record.get("applied_date")),
        installer_name=record.get("contractor_name", ""),
        owner_name=record.get("property_owner_name", ""),
        total_cost=safe_float(record.get("construction_value")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_baton_rouge(record, data_source_id, config):
    """Baton Rouge LA — Socrata with rich equipment details in descriptions."""
    permit_num = record.get("permitnumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_batonrouge_{permit_num}"
    desc = record.get("projectdescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    # Filter out billboard/sign permits
    if re.search(r'\bbillboard\b|\bsign\b|\badvertis', desc, re.IGNORECASE):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Extract manufacturer from description
    equip_manufacturer = None
    for mfr in ["Qcells", "Q CELLS", "Canadian Solar", "JA Solar", "Hanwha", "REC", "LG",
                 "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar", "Panasonic",
                 "Solaria", "Axitec", "Aptos", "Maxeon", "Tesla"]:
        if mfr.lower() in desc.lower():
            equip_manufacturer = mfr
            break

    inv_manufacturer = None
    for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla"]:
        if mfr.lower() in desc.lower():
            inv_manufacturer = mfr
            break

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("streetaddress", ""),
        city="Baton Rouge",
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issueddate") or record.get("applieddate")),
        installer_name=record.get("contractorname", ""),
        total_cost=safe_float(record.get("totalfees")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if equip_manufacturer:
            eq["manufacturer"] = equip_manufacturer
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    elif equip_manufacturer:
        equipment.append({"equipment_type": "module", "manufacturer": equip_manufacturer})
    if inv_manufacturer:
        equipment.append({"equipment_type": "inverter", "manufacturer": inv_manufacturer})

    return source_id, inst, equipment if equipment else None


def transform_durham(record, data_source_id, config):
    """Durham NC — ArcGIS with coordinates (requested as WGS84 via out_sr)."""
    permit_id = record.get("Permit_ID", "") or record.get("PERMIT_ID", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_durham_{permit_id}"
    desc = record.get("P_Descript", "") or record.get("P_DESCRIPT", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    addr = record.get("SiteAdd", "") or record.get("SITEADD", "")

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Durham",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("P_Date") or record.get("P_DATE")),
        data_source_id=data_source_id,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_raleigh(record, data_source_id, config):
    """Raleigh NC — ArcGIS with contractor, owner, cost, rich descriptions."""
    permit_id = record.get("permitnum", "") or record.get("PERMITNUM", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_raleigh_{permit_id}"
    desc = record.get("proposedworkdescription", "") or record.get("description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Raleigh has lat/lng directly in attributes AND in geometry
    lat = safe_float(record.get("latitude_perm") or record.get("_lat"))
    lng = safe_float(record.get("longitude_perm") or record.get("_lng"))

    addr = record.get("originaladdress1", "") or ""
    city = record.get("originalcity", "") or "Raleigh"
    zipcode = str(record.get("originalzip", "") or "")

    contractor = record.get("contractorcompanyname", "") or ""
    owner = record.get("parcelownername", "") or ""
    cost = safe_float(record.get("estprojectcost"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city,
        zip_code=zipcode if zipcode else None,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issueddate") or record.get("ISSUEDDATE")),
        installer_name=contractor if contractor else None,
        owner_name=owner if owner else None,
        total_cost=cost,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_fort_lauderdale(record, data_source_id, config):
    """Fort Lauderdale FL — ArcGIS MapServer with dedicated solar permit type."""
    permit_id = record.get("PERMITID", "") or record.get("PermitId", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_ftl_{permit_id}"
    desc = record.get("PERMITDESC", "") or record.get("PermitDesc", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    contractor = record.get("CONTRACTOR", "") or record.get("Contractor", "")
    owner = record.get("OWNERNAME", "") or record.get("OwnerName", "")
    addr = record.get("FULLADDR", "") or record.get("FullAddr", "")
    cost = safe_float(record.get("ESTCOST") or record.get("EstCost"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Fort Lauderdale",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("APPROVEDT") or record.get("SUBMITDT")),
        installer_name=contractor if contractor else None,
        owner_name=owner if owner else None,
        total_cost=cost,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_phoenix(record, data_source_id, config):
    """Phoenix AZ — ArcGIS MapServer with kW in description, installer, coords."""
    permit_num = record.get("PER_NUM", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_phoenix_{permit_num}"
    desc = record.get("PERMIT_NAME", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    installer = record.get("PROFESS_NAME", "") or ""
    addr = record.get("STREET_FULL_NAME", "") or ""

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr,
        city="Phoenix",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("PER_ISSUE_DATE")),
        installer_name=installer if installer else None,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_maricopa_county(record, data_source_id, config):
    """Maricopa County AZ — ArcGIS FeatureServer, includes utility-scale projects."""
    permit_num = record.get("PermitNumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_maricopa_{permit_num}"
    desc = record.get("PermitDescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    # Also check for MW in description (utility-scale projects)
    if not capacity_kw:
        m = re.search(r'([\d]+\.?\d*)\s*mw', desc, re.IGNORECASE)
        if m:
            try:
                mw = float(m.group(1))
                if 0.1 <= mw <= 10000:
                    capacity_kw = mw * 1000
            except ValueError:
                pass

    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    addr = record.get("FullStreetAddress", "") or ""
    zipcode = str(record.get("ZipCode", "") or "")

    # Determine site type from permit type
    permit_type = record.get("PermitType", "") or ""
    site_type = "utility" if capacity_kw and capacity_kw >= 1000 else "commercial"
    if "Residential" in permit_type:
        site_type = "commercial"  # keep as commercial per our filter (>=25kW)

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        site_name=desc if len(desc) < 100 and "/" in desc else None,
        site_type=site_type,
        address=addr,
        city=None,  # Unincorporated county — city varies
        zip_code=zipcode if zipcode else None,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("IssuedDate") or record.get("ApplicationDate")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_sacramento_county(record, data_source_id, config):
    """Sacramento County CA — ArcGIS FeatureServer with rich WorkDescription (kW, modules, inverter model)."""
    permit_num = record.get("Application", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_saccounty_{permit_num}"
    desc = record.get("WorkDescription", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Check for MW in description (utility-scale)
    if not capacity_kw:
        m = re.search(r'([\d]+\.?\d*)\s*mw', desc, re.IGNORECASE)
        if m:
            try:
                mw = float(m.group(1))
                if 0.1 <= mw <= 10000:
                    capacity_kw = mw * 1000
            except ValueError:
                pass

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    # Parse address — Sacramento County includes city+zip in Address field
    # e.g., "2828 WALNUT AVE, CARMICHAEL, CA 956084217"
    raw_addr = record.get("Address", "") or ""
    addr, city, zipcode = raw_addr, None, None
    if raw_addr:
        parts = [p.strip() for p in raw_addr.split(",")]
        if len(parts) >= 2:
            addr = parts[0]
            city = parts[1] if len(parts) >= 2 else None
            # Extract zip from last part
            for part in reversed(parts):
                m = re.search(r'(\d{5})', part)
                if m:
                    zipcode = m.group(1)
                    break

    # Extract manufacturer from description
    equip_manufacturer = None
    for mfr in ["Qcells", "Q CELLS", "Canadian Solar", "JA Solar", "Hanwha", "REC", "LG",
                 "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar", "Panasonic",
                 "Solaria", "Axitec", "Aptos", "Maxeon", "Tesla"]:
        if mfr.lower() in desc.lower():
            equip_manufacturer = mfr
            break

    inv_manufacturer = None
    inv_model = None
    for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla", "Delta"]:
        if mfr.lower() in desc.lower():
            inv_manufacturer = mfr
            # Try to extract model (e.g., "Delta M6-TL-US", "SolarEdge SE7600H")
            pattern = re.compile(re.escape(mfr) + r'\s+(\S+)', re.IGNORECASE)
            mm = pattern.search(desc)
            if mm:
                inv_model = mm.group(1)
            break

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    # Determine site type from Application_Subtype
    subtype = str(record.get("Application_Subtype", "")).lower()
    site_type = "commercial"
    if "commercial" in subtype:
        site_type = "commercial"
    if capacity_kw and capacity_kw >= 1000:
        site_type = "utility"

    contractor = record.get("Contractor", "")

    inst = make_installation(
        source_id, config,
        address=addr if addr else None,
        city=city,
        zip_code=zipcode,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUED_DATE")),
        installer_name=contractor if contractor and contractor != "OWNER BUILDER" else None,
        total_cost=safe_float(record.get("Valuation")),
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if equip_manufacturer:
            eq["manufacturer"] = equip_manufacturer
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    elif equip_manufacturer:
        equipment.append({"equipment_type": "module", "manufacturer": equip_manufacturer})
    if inv_manufacturer:
        eq = {"equipment_type": "inverter", "manufacturer": inv_manufacturer}
        if inv_model:
            eq["model"] = inv_model
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_tucson(record, data_source_id, config):
    """Tucson AZ — ArcGIS MapServer with BEST equipment data.

    DESCRIPTION field has structured equipment:
    • SYSTEM SIZE: 8140W DC, 6380W AC
    • MODULES: (22) MISSION SOLAR ENERGY LLC: TXI6-370120BB
    • INVERTERS: (22) ENPHASE ENERGY: IQ7PLUS-72-2-US
    • RACKING: ADJUSTABLE TILE HOOK
    """
    permit_num = record.get("NUMBER", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_tucson_{permit_num}"
    desc = record.get("DESCRIPTION", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    # Tucson has LAT/LON directly in attributes
    lat = safe_float(record.get("LAT") or record.get("_lat"))
    lng = safe_float(record.get("LON") or record.get("_lng"))

    # Parse structured equipment from description
    # System size: "SYSTEM SIZE: 8140W DC" or "8.14 kW" or "11.9KW DC"
    capacity_kw = None
    m = re.search(r'SYSTEM\s+SIZE:\s*([\d.]+)\s*W\s*DC', desc, re.IGNORECASE)
    if m:
        capacity_kw = float(m.group(1)) / 1000  # Convert watts to kW
    if not capacity_kw:
        m = re.search(r'([\d.]+)\s*KW\s*DC', desc, re.IGNORECASE)
        if m:
            capacity_kw = float(m.group(1))
    if not capacity_kw:
        capacity_kw = parse_capacity_from_description(desc)

    # Parse modules: "MODULES: (22) MISSION SOLAR ENERGY LLC: TXI6-370120BB"
    # or "(22) MISSION SOLAR ENERGY LLC:\nTXI6-370120BB"
    module_manufacturer = None
    module_model = None
    module_count = None
    m = re.search(r'MODULES?:\s*\((\d+)\)\s*([^:\n]+?):\s*(\S+)', desc, re.IGNORECASE)
    if m:
        module_count = int(m.group(1))
        module_manufacturer = m.group(2).strip()
        module_model = m.group(3).strip()
    else:
        # Simpler pattern: just count from description
        panels, watts = parse_panels_from_description(desc)
        module_count = panels

    # Parse inverters: "INVERTERS: (22) ENPHASE ENERGY: IQ7PLUS-72-2-US"
    inv_manufacturer = None
    inv_model = None
    inv_count = None
    m = re.search(r'INVERTERS?:\s*\((\d+)\)\s*([^:\n]+?):\s*(\S+)', desc, re.IGNORECASE)
    if m:
        inv_count = int(m.group(1))
        inv_manufacturer = m.group(2).strip()
        inv_model = m.group(3).strip()

    # Parse racking type: "RACKING: ADJUSTABLE TILE HOOK" or "RACKING: IRONRIDGE"
    racking_type = None
    m = re.search(r'RACKING:\s*([^\n•]+)', desc, re.IGNORECASE)
    if m:
        racking_type = m.group(1).strip()
        # Clean up trailing reference numbers
        racking_type = re.sub(r',?\s*SEE\s+DRAWING.*', '', racking_type, flags=re.IGNORECASE).strip()
        if len(racking_type) > 100:
            racking_type = racking_type[:100]

    # Mount type from WORKCLASS or description
    workclass = str(record.get("WORKCLASS", "")).lower()
    mount_type = None
    if "ground" in desc.lower() or "ground" in workclass:
        mount_type = "ground_fixed"
    elif "roof" in desc.lower() or "roof" in workclass:
        mount_type = "rooftop"
    elif "carport" in desc.lower():
        mount_type = "carport"

    # Site type from TYPE field
    bldg_type = str(record.get("TYPE", "")).lower()
    site_type = "commercial" if "commercial" in bldg_type else "commercial"

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("ADDRESS", ""),
        city="Tucson",
        zip_code=str(record.get("POSTALCODE", "")) if record.get("POSTALCODE") else None,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUEDATE")),
        total_cost=safe_float(record.get("VALUE")),
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if module_count or module_manufacturer:
        eq = {"equipment_type": "module"}
        if module_count:
            eq["quantity"] = module_count
        if module_manufacturer:
            eq["manufacturer"] = module_manufacturer
        if module_model:
            eq["model"] = module_model
        equipment.append(eq)
    if inv_count or inv_manufacturer:
        eq = {"equipment_type": "inverter"}
        if inv_count:
            eq["quantity"] = inv_count
        if inv_manufacturer:
            eq["manufacturer"] = inv_manufacturer
        if inv_model:
            eq["model"] = inv_model
        equipment.append(eq)
    if racking_type:
        equipment.append({
            "equipment_type": "racking",
            "manufacturer": racking_type,
        })

    return source_id, inst, equipment if equipment else None


def transform_pittsburgh(record, data_source_id, config):
    """Pittsburgh PA — CKAN with rich descriptions including manufacturer+model.

    work_description has: "install 3.52 kW DC grid-tied roof mounted solar array
    consisting of (8) JA SOLAR (440W) solar modules and (8) ENPHASE IQ7A microinverters."
    Also has: owner_name, contractor_name, commercial_or_residential, lat/lng.
    """
    permit_id = record.get("permit_id", "")
    if not permit_id:
        return None, None, None

    source_id = f"permit_pittsburgh_{permit_id}"
    desc = record.get("work_description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    # Parse manufacturer + model from description
    # Pattern: "(8) JA SOLAR (440W) solar modules" or "(22) MISSION SOLAR MSE400..."
    module_manufacturer = None
    module_model = None
    module_count = None
    module_watts = None

    # Try structured pattern: "(count) MANUFACTURER (watts) modules"
    m = re.search(r'\((\d+)\)\s+([A-Z][A-Za-z\s]+?)\s*(?:\((\d+)[Ww]\))?\s*(?:solar\s+)?module', desc, re.IGNORECASE)
    if m:
        module_count = int(m.group(1))
        module_manufacturer = m.group(2).strip()
        if m.group(3):
            module_watts = int(m.group(3))
    else:
        # Try known manufacturer names
        for mfr in ["JA Solar", "JA SOLAR", "Canadian Solar", "Hanwha", "Qcells", "Q CELLS", "REC",
                     "LG", "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar",
                     "Panasonic", "Solaria", "Axitec", "Aptos", "Maxeon"]:
            if mfr.lower() in desc.lower():
                module_manufacturer = mfr
                # Try to get model
                pattern = re.compile(re.escape(mfr) + r'[\s:]+(\S+)', re.IGNORECASE)
                mm = pattern.search(desc)
                if mm:
                    model_candidate = mm.group(1)
                    # Only use if it looks like a model number (has digits)
                    if re.search(r'\d', model_candidate):
                        module_model = model_candidate
                break

    # Parse inverter: "(8) ENPHASE IQ7A microinverters" or "SolarEdge SE7600H"
    inv_manufacturer = None
    inv_model = None
    inv_count = None
    m = re.search(r'\((\d+)\)\s+([A-Z][A-Za-z\s]+?)\s+(\S+)\s*(?:micro)?inverter', desc, re.IGNORECASE)
    if m:
        inv_count = int(m.group(1))
        inv_manufacturer = m.group(2).strip()
        inv_model = m.group(3).strip()
    else:
        for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla"]:
            if mfr.lower() in desc.lower():
                inv_manufacturer = mfr
                pattern = re.compile(re.escape(mfr) + r'[\s:]+(\S+)', re.IGNORECASE)
                mm = pattern.search(desc)
                if mm:
                    inv_model = mm.group(1)
                break

    if not module_count:
        panels, watts = parse_panels_from_description(desc)
        module_count = panels
        if not module_watts and watts:
            module_watts = watts

    lat = safe_float(record.get("latitude"))
    lng = safe_float(record.get("longitude"))

    # Mount type from description
    mount_type = None
    if re.search(r'ground\s*mount', desc, re.IGNORECASE):
        mount_type = "ground_fixed"
    elif re.search(r'roof\s*mount', desc, re.IGNORECASE):
        mount_type = "rooftop"
    elif re.search(r'carport', desc, re.IGNORECASE):
        mount_type = "carport"

    # Site type
    comm_res = str(record.get("commercial_or_residential", "")).lower()
    site_type = "commercial" if "commercial" in comm_res else "commercial"

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    # Status mapping
    status = str(record.get("status", "")).lower()
    site_status = "active"
    if "expired" in status or "withdrawn" in status:
        site_status = "canceled"
    elif "active" in status or "review" in status:
        site_status = "proposed"

    # Parse address — Pittsburgh includes city+zip: "6451 MONITOR ST, Pittsburgh, 15217-"
    raw_addr = record.get("address", "") or ""
    addr, zipcode = raw_addr, None
    if raw_addr:
        parts = [p.strip() for p in raw_addr.split(",")]
        if parts:
            addr = parts[0]
        for part in reversed(parts):
            m = re.search(r'(\d{5})', part)
            if m:
                zipcode = m.group(1)
                break

    owner = record.get("owner_name", "")
    contractor = record.get("contractor_name", "")

    inst = make_installation(
        source_id, config,
        address=addr if addr else None,
        city="Pittsburgh",
        zip_code=zipcode or record.get("zip_code"),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("issue_date")),
        installer_name=contractor if contractor else None,
        owner_name=owner if owner else None,
        total_cost=safe_float(record.get("total_project_value")),
        site_type=site_type,
        site_status=site_status,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if module_count or module_manufacturer:
        eq = {"equipment_type": "module"}
        if module_count:
            eq["quantity"] = module_count
        if module_manufacturer:
            eq["manufacturer"] = module_manufacturer
        if module_model:
            eq["model"] = module_model
        if module_watts:
            eq["specs"] = json.dumps({"watts": module_watts})
        equipment.append(eq)
    if inv_count or inv_manufacturer:
        eq = {"equipment_type": "inverter"}
        if inv_count:
            eq["quantity"] = inv_count
        if inv_manufacturer:
            eq["manufacturer"] = inv_manufacturer
        if inv_model:
            eq["model"] = inv_model
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_san_antonio(record, data_source_id, config):
    """San Antonio TX — CKAN with dedicated solar permit type, installer names."""
    permit_num = record.get("PERMIT #", "") or record.get("PERMIT#", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_sanantonio_{permit_num}"

    # Address parsing: "5603 BROOKHILL, City of San Antonio, TX 78228"
    raw_addr = record.get("ADDRESS", "") or ""
    addr, city, zipcode = "", "San Antonio", ""
    if raw_addr:
        parts = [p.strip() for p in raw_addr.split(",")]
        if parts:
            addr = parts[0]
        # Extract zip from last part
        for part in reversed(parts):
            m = re.search(r'(\d{5})', part)
            if m:
                zipcode = m.group(1)
                break

    installer = record.get("PRIMARY CONTACT", "") or ""
    project = record.get("PROJECT NAME", "") or ""
    cost = safe_float(record.get("DECLARED VALUATION"))

    # Parse capacity from project name if present
    capacity_kw = parse_capacity_from_description(project)
    panels, watts = parse_panels_from_description(project)

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', project, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=addr if addr else None,
        city=city,
        zip_code=zipcode if zipcode else None,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("DATE ISSUED") or record.get("DATE SUBMITTED")),
        installer_name=installer if installer else None,
        total_cost=cost,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


# ---------------------------------------------------------------------------
# Wave 2 transformers (Feb 12, 2026)
# ---------------------------------------------------------------------------

def transform_la_county(record, data_source_id, config):
    """LA County — ArcGIS FeatureServer with solar-specific CASENAME.
    ~30K solar records covering unincorporated LA County (Palmdale, Lancaster, etc.)."""
    case_num = record.get("CASENUMBER", "")
    if not case_num:
        return None, None, None

    source_id = f"permit_lacounty_{case_num}"
    desc = record.get("DESCRIPTION", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    # Extract mount type from WORKCLASS_NAME
    mount_type = None
    wclass = record.get("WORKCLASS_NAME", "") or ""
    if "ground mount" in wclass.lower():
        if "utility" in wclass.lower():
            mount_type = "ground_single_axis"
        else:
            mount_type = "ground_fixed"
    elif "roof mount" in wclass.lower():
        mount_type = "rooftop"
    elif "carport" in wclass.lower():
        mount_type = "carport"

    site_type = "commercial"
    if "utility" in wclass.lower():
        site_type = "utility"

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("MAIN_ADDRESS", ""),
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUANCE_DATE") or record.get("APPLY_DATE")),
        total_cost=safe_float(record.get("PERMIT_VALUATION")),
        site_type=site_type,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )
    inst["mount_type"] = mount_type  # Always include for batch key consistency

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_las_vegas(record, data_source_id, config):
    """Las Vegas NV — ArcGIS MapServer with 3 description fields."""
    permit_num = record.get("PERMIT_NUM", "") or record.get("PERMNUM", "")
    if not permit_num:
        permit_num = str(record.get("OBJECTID", ""))
    if not permit_num:
        return None, None, None

    source_id = f"permit_lasvegas_{permit_num}"

    desc = record.get("DESCRIPTION", "") or ""
    workdesc = record.get("WORKDESC", "") or ""
    full_desc = record.get("FULL_DESC", "") or ""
    combined_desc = f"{desc} {workdesc} {full_desc}".strip()

    if is_solar_false_positive(combined_desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(combined_desc)
    panels, watts = parse_panels_from_description(combined_desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', combined_desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("ADDR", "") or record.get("ADDRESS", ""),
        city="Las Vegas",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUE_DT") or record.get("ISSUEDDATE")),
        installer_name=record.get("APPLICANT", "") or record.get("CONTRACTOR", ""),
        total_cost=safe_float(record.get("VALUATION")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_baltimore(record, data_source_id, config):
    """Baltimore MD — ArcGIS FeatureServer with long Description field."""
    case_num = record.get("CaseNumber", "")
    if not case_num:
        return None, None, None

    source_id = f"permit_baltimore_{case_num}"
    desc = record.get("Description", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("Address", ""),
        city="Baltimore",
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("IssuedDate")),
        total_cost=safe_float(record.get("Cost")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_louisville(record, data_source_id, config):
    """Louisville/Jefferson County KY — ArcGIS FeatureServer (Table) with lat/lng in fields."""
    permit_num = record.get("PERMITNUMBER", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_louisville_{permit_num}"

    worktype = record.get("WORKTYPE", "") or ""
    category = record.get("CATEGORYNAME", "") or ""
    desc = f"{worktype} {category}".strip()

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    # Lat/lng in data fields (not geometry — this is a Table type FeatureServer)
    lat = safe_float(record.get("Latitude") or record.get("GPSY") or record.get("_lat"))
    lng = safe_float(record.get("Longitude") or record.get("GPSX") or record.get("_lng"))

    contractor = record.get("CONTRACTOR", "")

    inst = make_installation(
        source_id, config,
        address=record.get("ADDRESS", ""),
        city=record.get("CITY", "Louisville"),
        zip_code=record.get("ZIPCODE", ""),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUEDATE")),
        installer_name=contractor if contractor else None,
        total_cost=safe_float(record.get("PROJECTCOSTS") or record.get("PERMITFEE")),
        data_source_id=data_source_id,
    )

    return source_id, inst, None


def transform_columbus(record, data_source_id, config):
    """Columbus OH — ArcGIS MapServer, solar filtered by APPLICANT_BUS_NAME."""
    permit_id = record.get("B1_ALT_ID", "") or str(record.get("OBJECTID", ""))
    if not permit_id:
        return None, None, None

    source_id = f"permit_columbus_{permit_id}"

    applicant = record.get("APPLICANT_BUS_NAME", "") or ""

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    inst = make_installation(
        source_id, config,
        address=record.get("SITE_ADDRESS", ""),
        city="Columbus",
        zip_code=record.get("B1_SITUS_ZIP", ""),
        latitude=lat,
        longitude=lng,
        install_date=safe_date(record.get("ISSUED_DT")),
        installer_name=applicant if applicant else None,
        total_cost=safe_float(record.get("G3_VALUE_TTL")),
        data_source_id=data_source_id,
    )

    return source_id, inst, None


def transform_charlotte(record, data_source_id, config):
    """Charlotte/Mecklenburg County NC — ArcGIS FeatureServer with owner, cost, kW in descriptions."""
    permit_id = record.get("permitnum", "") or str(record.get("OBJECTID", "") or record.get("objectid", ""))
    if not permit_id:
        return None, None, None

    source_id = f"permit_charlotte_{permit_id}"

    # Get descriptions for solar keyword check and NLP
    workdesc = (record.get("workdesc") or record.get("WORKDESC") or "").strip()
    permitdesc = (record.get("permitdesc") or record.get("PERMITDESC") or "").strip()
    desc = workdesc or permitdesc or ""

    # Filter: must mention solar/photovoltaic somewhere
    combined = f"{workdesc} {permitdesc}".upper()
    if not any(kw in combined for kw in ["SOLAR", "PHOTOVOLTAIC", "PV SYSTEM", "PV ARRAY"]):
        return None, None, None

    # False positive filter
    if is_solar_false_positive(f"{workdesc} {permitdesc}"):
        return None, None, None

    # Owner name from ownname field
    owner = (record.get("ownname") or record.get("OWNNAME") or "").strip()

    # Installer often in permitdesc or workdesc (e.g. "Titan Solar Power NC Inc")
    installer = None
    # If permitdesc looks like a company name (not a description), it might be installer
    if permitdesc and not any(kw in permitdesc.upper() for kw in ["INSTALL", "MOUNT", "ROOF", "SYSTEM", "PANEL", "KW"]):
        # It's likely just a company name
        installer = permitdesc

    # Address
    address = (record.get("projadd") or record.get("PROJADD") or "").strip()
    zipcode = (record.get("zipcode") or record.get("ZIPCODE") or "").strip()

    # Coordinates from geometry (outSR=4326)
    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    # Cost
    cost = safe_float(record.get("bldgcost") or record.get("BLDGCOST"))

    # Permit type → site_type
    permit_type = (record.get("permittype") or record.get("PERMITTYPE") or "").upper()
    site_type = "commercial"
    if "ONE" in permit_type or "TWO" in permit_type or "FAMILY" in permit_type:
        site_type = "residential"

    # Extract capacity from descriptions
    capacity_kw = parse_capacity_from_description(desc)
    if not capacity_kw:
        capacity_kw = parse_capacity_from_description(permitdesc)

    # Mount type detection
    mount_type = None
    upper_desc = desc.upper()
    if "GROUND" in upper_desc or "GROUND-MOUNT" in upper_desc:
        mount_type = "ground"
    elif "ROOF" in upper_desc or "ROOFTOP" in upper_desc:
        mount_type = "rooftop"
    elif "CARPORT" in upper_desc or "CANOPY" in upper_desc:
        mount_type = "carport"

    # City from taxjuris or default
    city = (record.get("taxjuris") or record.get("TAXJURIS") or "Charlotte").strip().title()

    # Issue date
    install_date = safe_date(record.get("issuedate") or record.get("ISSUEDATE"))

    inst = make_installation(
        source_id, config,
        site_name=record.get("projname") or record.get("PROJNAME"),
        address=address,
        city=city,
        zip_code=zipcode,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=install_date,
        site_type=site_type,
        installer_name=installer,
        owner_name=owner if owner else None,
        total_cost=cost,
        data_source_id=data_source_id,
    )
    inst["mount_type"] = mount_type

    return source_id, inst, None


def transform_nashville(record, data_source_id, config):
    """Nashville TN — ArcGIS FeatureServer Trade Permits with dedicated PV subtypes.

    Fields: PermitNumber, Permit_Subtype_Description, Address, City, State, Zip,
    Contact (installer), Purpose (equipment details), Contract_Value, Date_Issued,
    Case_Status. Geometry is TN State Plane but outSR=4326 gives WGS84.
    """
    permit_num = record.get("PermitNumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_nashville_{permit_num}"

    purpose = (record.get("Purpose") or "").strip()
    subtype = (record.get("Permit_Subtype_Description") or "").strip()

    if is_solar_false_positive(purpose):
        return None, None, None

    # Determine site type from subtype
    site_type = "commercial"
    if "RESIDENTIAL" in subtype.upper():
        site_type = "residential"

    # Installer from Contact field
    installer = (record.get("Contact") or "").strip() or None

    # Coordinates from geometry (outSR=4326)
    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    # Extract capacity from Purpose field
    capacity_kw = parse_capacity_from_description(purpose)

    # Mount type detection from Purpose
    mount_type = None
    upper_purpose = purpose.upper()
    if "GROUND" in upper_purpose:
        mount_type = "ground"
    elif "ROOF" in upper_purpose or "ROOFTOP" in upper_purpose:
        mount_type = "rooftop"
    elif "CARPORT" in upper_purpose or "CANOPY" in upper_purpose:
        mount_type = "carport"

    # Battery detection from Purpose
    has_battery = bool(re.search(r'powerwall|battery|energy\s+storage|ess|kwh', purpose, re.IGNORECASE))

    # Cost
    cost = safe_float(record.get("Contract_Value"))

    inst = make_installation(
        source_id, config,
        address=record.get("Address", ""),
        city=record.get("City", "Nashville"),
        zip_code=record.get("Zip", ""),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("Date_Issued")),
        site_type=site_type,
        installer_name=installer,
        total_cost=cost,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )
    inst["mount_type"] = mount_type

    # Extract equipment from Purpose field
    equip = []
    # Panel pattern: "7 SILFAB SOLAR SIL-430 QD" or "20 LG LG400N2W panels"
    m = re.search(r'(\d+)\s*(?:x\s*)?([A-Z][A-Za-z\s]+?)\s+(\S+)\s+(?:\d+[Ww]|panel|module)', purpose, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "module",
            "manufacturer": m.group(2).strip(),
            "model": m.group(3).strip(),
        })
    # Inverter pattern: "Enphase IQ8PLUS-72-2-US" or "SolarEdge SE7600H"
    m = re.search(r'(Enphase|SolarEdge|SMA|Fronius|Tesla|Generac|Huawei|GoodWe|Delta|Sungrow)\s+([A-Z0-9][\w\-\.]+)', purpose, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "inverter",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })
    # Racking pattern: "Unirac NXT" or "IronRidge XR100"
    m = re.search(r'(Unirac|IronRidge|SnapNrack|Quick\s*Mount|Pegasus|Everest)\s+([A-Z0-9][\w\-\.]+)', purpose, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "racking",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })

    return source_id, inst, equip if equip else None


def transform_portland(record, data_source_id, config):
    """Portland OR — ArcGIS MapServer Layer 4 with rich descriptions and equipment data.
    Note: PERMIT field is permit TYPE (e.g. 'Residential 1 & 2 Family Permit'), not number.
    Use OBJECTID as unique identifier."""
    permit_id = str(record.get("OBJECTID", ""))
    if not permit_id:
        return None, None, None

    source_id = f"permit_portland_{permit_id}"

    desc = (record.get("DESCRIPTION") or "").strip()
    work_desc = (record.get("WORK_DESCRIPTION") or "").strip()
    combined_desc = f"{desc} {work_desc}".strip()

    # Must mention solar
    if not re.search(r'solar|photovoltaic|pv\s+(system|module|panel|array)', combined_desc, re.IGNORECASE):
        return None, None, None
    if is_solar_false_positive(combined_desc):
        return None, None, None
    # Exclude "solarium" false positives
    if re.search(r'\bsolarium\b', combined_desc, re.IGNORECASE):
        return None, None, None

    # Address from HOUSE + PROPSTREET
    house = (record.get("HOUSE") or "").strip()
    street = (record.get("PROPSTREET") or "").strip()
    address = f"{house} {street}".strip() if house or street else None

    city = (record.get("CITY") or "Portland").strip()

    lat = safe_float(record.get("_lat"))
    lng = safe_float(record.get("_lng"))

    capacity_kw = parse_capacity_from_description(combined_desc)
    cost = safe_float(record.get("SUBMITTEDVALUATION"))

    # Mount type
    mount_type = None
    upper_desc = combined_desc.upper()
    if "GROUND" in upper_desc or "GROUND-MOUNT" in upper_desc:
        mount_type = "ground"
    elif "ROOF" in upper_desc or "ROOFTOP" in upper_desc:
        mount_type = "rooftop"
    elif "CARPORT" in upper_desc or "CANOPY" in upper_desc:
        mount_type = "carport"

    # Site type
    status = (record.get("STATUS") or "").upper()
    site_status = "active" if "FINAL" in status or "ISSUED" in status else "proposed"

    inst = make_installation(
        source_id, config,
        address=address,
        city=city,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("ISSUED")),
        site_type="commercial",
        total_cost=cost,
        data_source_id=data_source_id,
        site_status=site_status,
    )
    inst["mount_type"] = mount_type

    # Equipment extraction from descriptions
    equip = []
    # Parse module manufacturer + model
    m = re.search(r'(\d+)\s*(?:x\s*)?([A-Z][A-Za-z\s]+?)\s+(\S+)\s+(\d+)[Ww]\s*(?:solar\s+)?(?:module|panel)', combined_desc, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "module",
            "manufacturer": m.group(2).strip(),
            "model": m.group(3).strip(),
        })
    # Parse inverter
    m = re.search(r'([A-Z][A-Za-z]+)\s+(\S+)\s+(?:inverter|micro-?inverter)', combined_desc, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "inverter",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })

    return source_id, inst, equip if equip else None


def transform_tampa(record, data_source_id, config):
    """Tampa FL — CivicData CKAN BLDS standard with rich equipment descriptions."""
    permit_num = record.get("PermitNum", "") or record.get("permitnum", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_tampa_{permit_num}"

    desc = record.get("Description", "") or record.get("description", "") or ""

    # Filter: must mention solar/PV
    if not re.search(r'solar|photovoltaic|pv\s+(system|module|panel|array)', desc, re.IGNORECASE):
        return None, None, None
    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Address
    address = (record.get("OriginalAddress1") or record.get("originaladdress1") or "").strip()
    city = (record.get("OriginalCity") or record.get("originalcity") or "Tampa").strip()
    zipcode = (record.get("OriginalZip") or record.get("originalzip") or "").strip()

    lat = safe_float(record.get("LAT") or record.get("lat") or record.get("Lat"))
    lng = safe_float(record.get("LON") or record.get("lon") or record.get("Lon"))

    cost = safe_float(record.get("EstProjectCost") or record.get("estprojectcost"))

    # Site type from PermitClass
    permit_class = (record.get("PermitClass") or record.get("permitclass") or "").upper()
    site_type = "commercial" if "COMMERCIAL" in permit_class else "residential" if "RESIDENTIAL" in permit_class else "commercial"

    inst = make_installation(
        source_id, config,
        site_name=record.get("ProjectName") or record.get("projectname"),
        address=address,
        city=city,
        zip_code=zipcode,
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("IssuedDate") or record.get("issueddate")),
        site_type=site_type,
        total_cost=cost,
        data_source_id=data_source_id,
    )

    # Mount type from description
    mount_type = None
    upper_desc = desc.upper()
    if "GROUND" in upper_desc:
        mount_type = "ground"
    elif "ROOF" in upper_desc:
        mount_type = "rooftop"
    elif "CARPORT" in upper_desc or "CANOPY" in upper_desc:
        mount_type = "carport"
    inst["mount_type"] = mount_type

    # Equipment extraction from rich descriptions
    equip = []
    # Parse module: "(26) Canadian Solar CS3W-445 445W"
    m = re.search(r'\((\d+)\)\s+([A-Z][A-Za-z\s]+?)\s+(\S+)\s+(\d+)[Ww]\s*(?:solar\s+)?(?:module|panel)?', desc, re.IGNORECASE)
    if not m:
        m = re.search(r'(\d+)\s+([A-Z][A-Za-z\s]+?)\s+(\S+)\s+(\d+)[Ww]', desc, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "module",
            "manufacturer": m.group(2).strip(),
            "model": m.group(3).strip(),
        })
    # Parse inverter: "Enphase IQ7A" or "SolarEdge SE6000H-US inverter"
    m = re.search(r'([A-Z][A-Za-z]+)\s+(\S+)\s+(?:inverter|micro-?inverter)', desc, re.IGNORECASE)
    if not m:
        m = re.search(r'([A-Z][A-Za-z]+)\s+(\S+)\s+\d+\.?\d*\s*kw\s*\(?AC', desc, re.IGNORECASE)
    if m:
        equip.append({
            "equipment_type": "inverter",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })

    return source_id, inst, equip if equip else None


def transform_virginia_beach(record, data_source_id, config):
    """Virginia Beach VA — CKAN with BEST equipment data in WorkDesc field.

    WorkDesc contains structured equipment specs like:
    'Install 8.32 kW DC, 6.00 kW AC roof-mounted solar PV system.
    (26) REC TwinPeak 4 Series 320W modules, SolarEdge SE6000H-US inverter,
    IronRidge XR100 racking.'
    """
    permit_num = record.get("PermitNumber", "") or record.get("permitnumber", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_vabeach_{permit_num}"
    desc = record.get("WorkDesc", "") or record.get("workdesc", "") or ""

    if not re.search(r'solar|photovoltaic|pv\s+(system|module|panel|array)', desc, re.IGNORECASE):
        return None, None, None
    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)
    panels, watts = parse_panels_from_description(desc)

    # Parse manufacturer + model from description
    module_manufacturer = None
    module_model = None
    module_count = panels

    m = re.search(r'\((\d+)\)\s+([A-Z][A-Za-z\s]+?)\s+(\S+)\s+(\d+)[Ww]\s*(?:solar\s+)?module', desc, re.IGNORECASE)
    if m:
        module_count = int(m.group(1))
        module_manufacturer = m.group(2).strip()
        module_model = m.group(3).strip()
        watts = int(m.group(4))
    else:
        for mfr in ["REC", "JA Solar", "JA SOLAR", "Canadian Solar", "Hanwha", "Qcells", "Q CELLS",
                     "LG", "SunPower", "Trina", "LONGi", "Jinko", "Silfab", "Mission Solar",
                     "Panasonic", "Solaria", "Axitec", "Aptos", "Maxeon"]:
            if mfr.lower() in desc.lower():
                module_manufacturer = mfr
                pattern = re.compile(re.escape(mfr) + r'[\s:]+(\S+)', re.IGNORECASE)
                mm = pattern.search(desc)
                if mm:
                    model_candidate = mm.group(1)
                    if re.search(r'\d', model_candidate):
                        module_model = model_candidate
                break

    # Parse inverter
    inv_manufacturer = None
    inv_model = None
    inv_count = None
    m = re.search(r'(?:\((\d+)\)\s+)?([A-Z][A-Za-z]+(?:Edge)?)\s+(\S+)\s*(?:micro)?inverter', desc, re.IGNORECASE)
    if m:
        if m.group(1):
            inv_count = int(m.group(1))
        inv_manufacturer = m.group(2).strip()
        inv_model = m.group(3).strip()
    else:
        for mfr in ["SolarEdge", "Enphase", "SMA", "Fronius", "ABB", "Generac", "Tesla"]:
            if mfr.lower() in desc.lower():
                inv_manufacturer = mfr
                pattern = re.compile(re.escape(mfr) + r'[\s:]+(\S+)', re.IGNORECASE)
                mm = pattern.search(desc)
                if mm:
                    inv_model = mm.group(1)
                break

    # Mount type
    mount_type = None
    if re.search(r'ground\s*mount', desc, re.IGNORECASE):
        mount_type = "ground_fixed"
    elif re.search(r'roof\s*mount', desc, re.IGNORECASE):
        mount_type = "rooftop"
    elif re.search(r'carport', desc, re.IGNORECASE):
        mount_type = "carport"

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', desc, re.IGNORECASE))

    addr = record.get("StreetAddress", "") or record.get("streetaddress", "")
    city_val = record.get("City", "") or record.get("city", "") or "Virginia Beach"
    zip_val = record.get("Zip", "") or record.get("zip", "")

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city_val,
        zip_code=zip_val,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("IssueDate") or record.get("issuedate") or record.get("ApplicationDate")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )
    inst["mount_type"] = mount_type  # Always include for batch key consistency

    equipment = []
    if module_count or module_manufacturer:
        eq = {"equipment_type": "module", "manufacturer": module_manufacturer, "model": module_model, "quantity": module_count or 1}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)
    if inv_manufacturer:
        eq = {"equipment_type": "inverter", "manufacturer": inv_manufacturer, "model": inv_model, "quantity": inv_count or 1}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_boston_ckan(record, data_source_id, config):
    """Boston MA — CKAN with equipment details in comments field."""
    permit_num = record.get("PermitNumber", "") or record.get("permitnumber", "") or record.get("PERMITNUMBER", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_boston_ckan_{permit_num}"
    desc = record.get("Comments", "") or record.get("comments", "") or record.get("COMMENTS", "") or ""
    work_type = record.get("WorkType", "") or record.get("worktype", "") or ""
    combined_desc = f"{work_type} {desc}".strip()

    if not re.search(r'solar|photovoltaic|pv\s+(system|module|panel)', combined_desc, re.IGNORECASE):
        return None, None, None
    if is_solar_false_positive(combined_desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(combined_desc)
    panels, watts = parse_panels_from_description(combined_desc)

    lat = safe_float(record.get("Latitude") or record.get("latitude") or record.get("Y"))
    lng = safe_float(record.get("Longitude") or record.get("longitude") or record.get("X"))

    has_battery = bool(re.search(r'storage|battery|powerwall|bess', combined_desc, re.IGNORECASE))

    inst = make_installation(
        source_id, config,
        address=record.get("Address", "") or record.get("address", ""),
        city="Boston",
        zip_code=record.get("Zip", "") or record.get("zip", ""),
        latitude=lat,
        longitude=lng,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("Issued_Date") or record.get("issued_date") or record.get("ISSUED_DATE")),
        installer_name=record.get("Applicant") or record.get("applicant", ""),
        total_cost=safe_float(record.get("TotalFees") or record.get("totalfees")),
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )

    equipment = []
    if panels:
        eq = {"equipment_type": "module", "quantity": panels}
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    return source_id, inst, equipment if equipment else None


def transform_ny_statewide(record, data_source_id, config):
    """NY Statewide Distributed Solar — interconnection data with developer names."""
    project_id = record.get("project_id", "")
    if not project_id:
        return None, None, None

    source_id = f"nydist_{project_id}"

    capacity_kw = safe_float(record.get("estimated_pv_system_size"))
    if not capacity_kw or capacity_kw < 25:
        return None, None, None

    city = record.get("city_town", "")
    county = record.get("county", "")
    zip_code = record.get("zip", "")
    developer = record.get("developer", "")
    utility = record.get("utility", "")
    install_date = safe_date(record.get("interconnection_date"))

    has_battery = bool(record.get("energy_storage_system_size_kwac"))

    inst = make_installation(
        source_id, config,
        city=city,
        county=county.upper() if county else None,
        zip_code=zip_code,
        capacity_kw=capacity_kw,
        install_date=install_date,
        developer_name=developer if developer else None,
        operator_name=utility if utility else None,
        data_source_id=data_source_id,
        has_battery_storage=has_battery,
    )
    return source_id, inst, None


def transform_ct_rsip(record, data_source_id, config):
    """Connecticut RSIP — solar rebate program with contractor and owner names."""
    # Use entity + municipality + approved_date as unique key
    entity = record.get("entity", "")
    municipality = record.get("municipality", "")
    approved = record.get("approved_date", "")
    kw = safe_float(record.get("kw_stc"))
    if not kw or kw < 25:
        return None, None, None

    # Build a unique ID from available fields
    date_part = approved[:10].replace("-", "") if approved else "nodate"
    key = f"{entity}_{municipality}_{date_part}_{kw}"
    source_id = f"ctrsip_{key}"

    contractor = record.get("contractor", "")
    owner = record.get("system_owner", "")
    if owner and owner.lower() in ("does not apply", "n/a", "na", "none"):
        owner = None

    city = record.get("host_customer_city", "") or municipality
    zip_code = record.get("host_customer_zip_code", "")
    county = record.get("county", "")
    cost = safe_float(record.get("total_system_cost"))
    install_date = safe_date(record.get("completed_date") or record.get("approved_date"))
    utility = record.get("utility_company", "")

    inst = make_installation(
        source_id, config,
        city=city,
        county=county.upper().replace(" COUNTY", "") if county else None,
        zip_code=zip_code,
        capacity_kw=kw,
        install_date=install_date,
        installer_name=contractor if contractor else None,
        owner_name=owner,
        operator_name=utility if utility else None,
        total_cost=cost,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_collin_county(record, data_source_id, config):
    """Collin County TX — Socrata building permits with owner + builder names."""
    permit_num = record.get("permitnum", "") or record.get("permitid", "")
    if not permit_num:
        return None, None, None

    source_id = f"permit_collintx_{permit_num}"
    desc = record.get("permitcomments", "") or ""

    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_from_description(desc)

    # Build address from parts
    bldgnum = record.get("situsbldgnum", "")
    street = record.get("situsstreetname", "")
    suffix = record.get("situsstreetsuffix", "")
    addr = record.get("situsconcat", "") or f"{bldgnum} {street} {suffix}".strip()

    city = record.get("situscity", "")
    zip_code = record.get("situszip", "")
    owner = record.get("propownername", "")
    installer = record.get("permitbuildername", "")
    cost = safe_float(record.get("permitvalue"))
    install_date = safe_date(record.get("permitissueddate"))

    inst = make_installation(
        source_id, config,
        address=addr,
        city=city,
        zip_code=zip_code,
        capacity_kw=capacity_kw,
        install_date=install_date,
        installer_name=installer if installer else None,
        owner_name=owner if owner else None,
        total_cost=cost,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_fort_collins(record, data_source_id, config):
    """Fort Collins CO — dedicated solar interconnection data with kW and address."""
    address = record.get("system_address", "")
    kw = safe_float(record.get("system_capacity_kw_dc"))
    date_of_service = record.get("date_of_service", "")

    if not address:
        return None, None, None

    # Build unique ID from address + date
    date_part = safe_date(date_of_service) or "nodate"
    source_id = f"fcgov_solar_{address.replace(' ', '_')}_{date_part}"

    inst = make_installation(
        source_id, config,
        address=address,
        city="Fort Collins",
        capacity_kw=kw,
        install_date=safe_date(date_of_service),
        data_source_id=data_source_id,
    )
    return source_id, inst, None


def transform_cambridge_installations(record, data_source_id, config):
    """Cambridge MA — active solar installation locations with kW, lat/lng, building type."""
    address = record.get("streetaddress", "") or record.get("street_address", "")
    if not address:
        return None, None, None

    kw = safe_float(record.get("kw") or record.get("pv_capacity_kw"))
    system_type = record.get("systemtype", "") or record.get("system_type", "")
    if system_type and system_type != "PV":
        return None, None, None

    system_id = record.get("systemid", "")
    source_id = f"cambridge_solar_{system_id}" if system_id else f"cambridge_solar_{address.replace(' ', '_')}_{kw or 0}"

    building_type = str(record.get("buildingtype", "")).lower()
    site_type = "commercial" if any(x in building_type for x in ("commercial", "industrial", "municipal", "institutional")) else "commercial"

    lat = safe_float(record.get("latitude"))
    lng = safe_float(record.get("longitude"))

    inst = make_installation(
        source_id, config,
        address=address,
        city="Cambridge",
        capacity_kw=kw,
        latitude=lat,
        longitude=lng,
        install_date=safe_date(record.get("permitissuedate")),
        site_type=site_type,
        data_source_id=data_source_id,
    )
    return source_id, inst, None


# Transformer registry
TRANSFORMERS = {
    "cambridge_rich": transform_cambridge_rich,
    "cary": transform_cary,
    "richmond": transform_richmond,
    "honolulu": transform_honolulu,
    "nyc": transform_nyc,
    "sf": transform_sf,
    "la": transform_la,
    "chicago": transform_chicago,
    "austin": transform_austin,
    "seattle": transform_seattle,
    "blds": transform_blds,
    "generic_socrata": transform_generic_socrata,
    "salt_lake_city": transform_salt_lake_city,
    "sacramento": transform_sacramento,
    "philadelphia": transform_philadelphia,
    "san_jose": transform_san_jose,
    "denver": transform_denver,
    "minneapolis": transform_minneapolis,
    "detroit": transform_detroit,
    "albuquerque": transform_albuquerque,
    "riverside_county": transform_riverside_county,
    "dc": transform_dc,
    "miami_dade": transform_miami_dade,
    "kansas_city": transform_kansas_city,
    "orlando": transform_orlando,
    "baton_rouge": transform_baton_rouge,
    "durham": transform_durham,
    "raleigh": transform_raleigh,
    "fort_lauderdale": transform_fort_lauderdale,
    "phoenix": transform_phoenix,
    "maricopa_county": transform_maricopa_county,
    "san_antonio": transform_san_antonio,
    "sacramento_county": transform_sacramento_county,
    "tucson": transform_tucson,
    "pittsburgh": transform_pittsburgh,
    "la_county": transform_la_county,
    "las_vegas": transform_las_vegas,
    "baltimore": transform_baltimore,
    "louisville": transform_louisville,
    "columbus": transform_columbus,
    "charlotte": transform_charlotte,
    "nashville": transform_nashville,
    "portland": transform_portland,
    "virginia_beach": transform_virginia_beach,
    "boston_ckan": transform_boston_ckan,
    "tampa": transform_tampa,
    "ny_statewide": transform_ny_statewide,
    "ct_rsip": transform_ct_rsip,
    "collin_county": transform_collin_county,
    "fort_collins": transform_fort_collins,
    "cambridge_installations": transform_cambridge_installations,
}


# ---------------------------------------------------------------------------
# Main ingestion loop
# ---------------------------------------------------------------------------

def ingest_city(city_key, config, dry_run=False):
    """Ingest permits for a single city."""
    print(f"\n{'=' * 60}")
    print(f"Processing {config['name']}")
    print(f"{'=' * 60}")
    print(f"  Source: {config['base_url']}")
    print(f"  Prefix: {config['prefix']}")
    print(f"  Transform: {config['transform']}")

    # Fetch records from API
    print(f"\n  Downloading records...")
    try:
        platform = config["platform"]
        if platform == "opendatasoft":
            raw_records = fetch_opendatasoft(config)
        elif platform == "arcgis_multilayer":
            raw_records = fetch_arcgis_multilayer(config)
        elif platform == "arcgis":
            raw_records = fetch_arcgis(config)
        elif platform == "carto":
            raw_records = fetch_carto(config)
        elif platform == "ckan":
            raw_records = fetch_ckan(config)
        else:
            raw_records = fetch_socrata(config)
    except Exception as e:
        print(f"  ERROR fetching data: {e}")
        return 0, 0
    print(f"  Downloaded: {len(raw_records)} records")

    if not raw_records:
        print("  No records found!")
        return 0, 0

    # Get data source ID
    ds_name = f"municipal_permits_{city_key}"
    if not dry_run:
        data_source_id = get_data_source_id(ds_name)
    else:
        data_source_id = "dry-run"

    # Get existing source IDs to skip duplicates
    if not dry_run:
        existing_ids = get_existing_source_ids(config["prefix"])
        print(f"  Existing records: {len(existing_ids)}")
    else:
        existing_ids = set()

    # Transform records
    transform_fn = TRANSFORMERS[config["transform"]]
    installations = []
    equipment_batches = []  # [(installation_source_id, [equipment_records])]
    skipped_dup = 0
    skipped_invalid = 0

    seen_ids = set()
    for raw in raw_records:
        result = transform_fn(raw, data_source_id, config)
        if len(result) == 3:
            source_id, inst, equip = result
        else:
            source_id, inst = result
            equip = None

        if not source_id or not inst:
            skipped_invalid += 1
            continue
        if source_id in existing_ids or source_id in seen_ids:
            skipped_dup += 1
            continue
        seen_ids.add(source_id)
        installations.append(inst)
        if equip:
            equipment_batches.append((source_id, equip))

    print(f"  Transformed: {len(installations)}")
    print(f"  Skipped (duplicate): {skipped_dup}")
    print(f"  Skipped (invalid/filtered): {skipped_invalid}")
    if equipment_batches:
        print(f"  With equipment data: {len(equipment_batches)}")

    if dry_run:
        print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
        for inst in installations[:5]:
            print(f"    {inst['source_record_id']} | {inst.get('address', 'N/A')} | {inst.get('capacity_mw', 'N/A')} MW | {inst.get('installer_name', 'N/A')}")
        return len(installations), 0

    if not installations:
        print("  No new records to ingest.")
        return 0, 0

    # Batch insert installations
    print(f"\n  Inserting {len(installations)} records...")
    created = 0
    errors = 0
    for i in range(0, len(installations), BATCH_SIZE):
        batch = installations[i:i + BATCH_SIZE]
        ok, err = supabase_post("solar_installations", batch)
        if ok:
            created += len(batch)
        else:
            errors += len(batch)
            if errors <= 500:  # Don't spam logs
                print(f"    Batch error at {i}: {err}")
        if (i + BATCH_SIZE) % 200 == 0:
            print(f"    Progress: {created} created, {errors} errors ({i + len(batch)}/{len(installations)})")

    print(f"  Created: {created}")
    print(f"  Errors: {errors}")

    # Insert equipment if any
    if equipment_batches and created > 0:
        print(f"\n  Inserting equipment for {len(equipment_batches)} installations...")
        eq_created = 0
        eq_errors = 0
        for source_id, equip_list in equipment_batches:
            # Look up installation ID
            rows = supabase_get("solar_installations", {
                "select": "id",
                "source_record_id": f"eq.{source_id}",
                "limit": 1,
            })
            if not rows:
                continue
            inst_id = rows[0]["id"]
            for eq in equip_list:
                eq_record = {
                    "installation_id": inst_id,
                    "equipment_type": eq.get("equipment_type"),
                    "manufacturer": eq.get("manufacturer"),
                    "model": eq.get("model"),
                    "quantity": eq.get("quantity", 1),
                    "data_source_id": data_source_id,
                }
                if eq.get("specs"):
                    eq_record["specs"] = json.dumps(eq["specs"])
                ok, err = supabase_post("solar_equipment", [eq_record])
                if ok:
                    eq_created += 1
                else:
                    eq_errors += 1
        print(f"  Equipment created: {eq_created}, errors: {eq_errors}")

    return created, errors


def main():
    parser = argparse.ArgumentParser(description="Municipal solar permit ingestion")
    parser.add_argument("--dry-run", action="store_true", help="Count without ingesting")
    parser.add_argument("--city", type=str, help="City key(s), comma-separated")
    parser.add_argument("--tier", type=str, help="Tier(s) to process, comma-separated (1,2,3,4)")
    parser.add_argument("--list-cities", action="store_true", help="List available cities")
    args = parser.parse_args()

    if args.list_cities:
        print("Available cities:")
        for tier in [0, 1, 2, 3, 4]:
            tier_cities = {k: v for k, v in CITIES.items() if v.get("tier") == tier}
            if tier_cities:
                print(f"\n  Tier {tier}:")
                for key, cfg in sorted(tier_cities.items()):
                    print(f"    {key:25s} {cfg['name']:30s} ({cfg['platform']})")
        return

    print("Municipal Solar Permit Ingestion")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    if args.city:
        keys = [k.strip() for k in args.city.split(",")]
        cities_to_process = {}
        for k in keys:
            if k not in CITIES:
                print(f"  Error: Unknown city '{k}'. Use --list-cities.")
                sys.exit(1)
            cities_to_process[k] = CITIES[k]
        print(f"  Cities: {', '.join(c['name'] for c in cities_to_process.values())}")
    elif args.tier:
        tiers = [int(t.strip()) for t in args.tier.split(",")]
        cities_to_process = {k: v for k, v in CITIES.items() if v.get("tier") in tiers}
        print(f"  Tiers: {tiers}")
        print(f"  Cities ({len(cities_to_process)}): {', '.join(c['name'] for c in cities_to_process.values())}")
    else:
        cities_to_process = CITIES
        print(f"  All {len(CITIES)} cities")

    total_created = 0
    total_errors = 0

    for key, config in cities_to_process.items():
        created, errors = ingest_city(key, config, args.dry_run)
        total_created += created
        total_errors += errors

    print(f"\n{'=' * 60}")
    print(f"Summary")
    print(f"{'=' * 60}")
    print(f"  Total created: {total_created}")
    print(f"  Total errors: {total_errors}")
    print(f"\nDone!")


if __name__ == "__main__":
    main()

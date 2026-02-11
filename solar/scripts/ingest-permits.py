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
        "filter": "$where=solar='Y' AND commercialresidential='Commercial'",
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
    "raleigh_blds": {
        "tier": 4,
        "name": "Raleigh, NC (BLDS)",
        "state": "NC",
        "county": "WAKE",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/pjib-v4rg.json",
        "page_size": 1000,
        "filter": f"$where={SOLAR_WHERE}",
        "prefix": "permit_raleigh",
        "transform": "blds",
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

        url = f"{config['base_url']}/query?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req) as resp:
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
                rec["_lat"] = geo.get("y")
                rec["_lng"] = geo.get("x")
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
    """Fetch all records from CKAN Datastore API."""
    records = []
    offset = 0
    while True:
        params = {
            "resource_id": config["resource_id"],
            "q": "solar",
            "limit": config["page_size"],
            "offset": offset,
        }
        url = f"{config['base_url']}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req) as resp:
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
                   "permit_", "id", "permit_id", "application_number", "record_number", "case_number"]:
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
                   "scope_of_work", "project_description"]:
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
                   "property_address", "full_address"]:
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
    for field in ["city", "original_city", "originalcity", "site_city", "mailing_city"]:
        val = record.get(field)
        if val and str(val).strip():
            city = str(val).strip()
            break
    if not city:
        city = config["name"].split(",")[0].strip()

    # Zip
    zip_code = None
    for field in ["zip_code", "zipcode", "zip", "original_zip", "originalzip", "site_zip", "postal_code"]:
        val = record.get(field)
        if val and str(val).strip():
            zip_code = str(val).strip()
            break

    # Coordinates
    lat, lng = None, None
    lat = safe_float(record.get("latitude") or record.get("lat"))
    lng = safe_float(record.get("longitude") or record.get("lon") or record.get("lng"))
    if not lat:
        loc = record.get("location")
        if isinstance(loc, dict):
            lat = safe_float(loc.get("latitude"))
            lng = safe_float(loc.get("longitude"))
            if not lat:
                coords = loc.get("coordinates", [])
                if coords and len(coords) >= 2:
                    lng, lat = safe_float(coords[0]), safe_float(coords[1])

    # Date
    install_date = None
    for field in ["issue_date", "issued_date", "issueddate", "permit_issued_date", "date_issued",
                   "issuedate", "issuance_date", "applied_date"]:
        val = record.get(field)
        if val:
            install_date = safe_date(val)
            if install_date:
                break

    # Installer
    installer = None
    for field in ["contractor_name", "contractor", "contractor_company_desc", "contact_1_name",
                   "applicant_name", "firm_name", "company_name"]:
        val = record.get(field)
        if val and str(val).strip():
            installer = str(val).strip()
            break

    # Cost
    cost = None
    for field in ["project_valuation", "estimated_cost", "valuation", "value", "total_cost",
                   "reported_cost", "job_value", "jobvalue", "fee"]:
        val = record.get(field)
        if val:
            cost = safe_float(val)
            if cost:
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

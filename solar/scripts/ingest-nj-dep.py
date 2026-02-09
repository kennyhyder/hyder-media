#!/usr/bin/env python3
"""
New Jersey DEP Solar Installation Ingestion Script

Downloads solar installation data from the NJ Department of Environmental
Protection (NJDEP) ArcGIS REST API. Covers two data layers:

1. Behind-the-Meter (BTM) Solar PV - 7,428+ commercial installations
   - Has: company name, address, city, zip, lat/lng, system size, year, third-party flag
   - No installer field

2. Solar PV at Public Facilities - 1,459 records with INSTALLER names
   - Has: company name, address, city, zip, lat/lng, system size, installer, customer type

3. Community Solar Projects - 125 records with applicant/developer
   - Has: applicant, address, county, lat/lng, capacity, EDC, program year

Only ingests commercial installations >= 25 kW.

Usage:
  python3 -u scripts/ingest-nj-dep.py              # Full ingestion
  python3 -u scripts/ingest-nj-dep.py --dry-run     # Report without ingesting

Data source: https://dep.nj.gov/cleanenergy/technologies/solar/
API: https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer
"""

import os
import sys
import json
import uuid
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

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
MIN_CAPACITY_KW = 25  # Commercial threshold

# ArcGIS REST API layers
BASE_URL = "https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer"
LAYERS = {
    "btm": {
        "id": 22,
        "label": "Behind-the-Meter Solar PV",
        "where": f"SYSTEMSIZE >= {MIN_CAPACITY_KW}",
        "fields": {
            "project_num": "PROJECTNUM",
            "account_num": "ACCT_NUM",
            "company_name": "COMPNAME",
            "address": "INSTALLADD",
            "city": "INSTALLCIT",
            "zip": "INSTALLZIP",
            "year": "YEAR",
            "system_size_kw": "SYSTEMSIZE",
            "customer_type": "CUST_TYPE",
            "third_party": "THIRDPARTY",
            "edc": "EDC",
            "latitude": "LATITUDE",
            "longitude": "LONGITUDE",
        },
    },
    "public": {
        "id": 17,
        "label": "Solar PV at Public Facilities",
        "where": f"SYSTEMSIZE >= {MIN_CAPACITY_KW}",
        "fields": {
            "account_num": "ACCOUNT_NUMBER",
            "company_name": "COMPNAME",
            "address": "INSTALLADD",
            "city": "INSTALLCITY",
            "zip": "INSTALLZIP",
            "system_size_kw": "SYSTEMSIZE",
            "customer_type": "CUSTOMERTYPE",
            "installer": "INSTALLER",
            "latitude": "LATITUDE",
            "longitude": "LONGITUDE",
            "status_date": "STATUSDATE",
        },
    },
    "community": {
        "id": 26,
        "label": "Community Solar Projects",
        "where": "1=1",
        "fields": {
            "account_num": "ACCOUNT_NO",
            "docket_num": "DOCKET_NO",
            "applicant": "APPLICANT",
            "address": "ADDRESS",
            "city": "CITY",
            "county": "COUNTY",
            "zip": "ZIP",
            "state": "STATE",
            "capacity_mw": "CAPACITY",
            "edc": "EDC",
            "latitude": "LATITUDE",
            "longitude": "LONGITUDE",
            "program_year": "PROGRAMYEAR",
            "completion_year": "COMPLETIONYEAR",
        },
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_request(method, table, data=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        print(f"  Supabase error ({e.code}): {error_body}")
        return None


def get_or_create_data_source():
    params = {"name": "eq.nj_dep", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "nj_dep",
        "description": "NJ DEP Solar Installations - Behind-the-meter, public facilities, and community solar from NJ Department of Environmental Protection ArcGIS API",
        "url": "https://dep.nj.gov/cleanenergy/technologies/solar/",
        "record_count": 0,
    })
    return ds_id


# ---------------------------------------------------------------------------
# ArcGIS API helpers
# ---------------------------------------------------------------------------

def fetch_arcgis_layer(layer_id, where_clause, offset=0, count=1000):
    """Fetch records from ArcGIS REST API with pagination."""
    params = {
        "where": where_clause,
        "outFields": "*",
        "f": "json",
        "resultOffset": str(offset),
        "resultRecordCount": str(count),
    }
    url = f"{BASE_URL}/{layer_id}/query?" + "&".join(
        f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items()
    )

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 SolarTrack/1.0",
    })

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())

    features = data.get("features", [])
    exceeded = data.get("exceededTransferLimit", False)
    return features, exceeded


def fetch_all_records(layer_id, where_clause):
    """Fetch all records with pagination."""
    all_records = []
    offset = 0
    page_size = 1000

    while True:
        features, exceeded = fetch_arcgis_layer(layer_id, where_clause, offset, page_size)
        if not features:
            break
        all_records.extend(features)
        print(f"    Fetched {len(all_records)} records (offset {offset})...")
        if not exceeded:
            break
        offset += page_size

    return all_records


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("n/a", "nan", "none", "na", "null", "0"):
        return None
    return s


def safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def epoch_to_date(epoch_ms):
    """Convert ArcGIS epoch milliseconds to date string."""
    if not epoch_ms:
        return None
    try:
        return datetime.fromtimestamp(epoch_ms / 1000).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None


def classify_site_type(capacity_kw, customer_type=None):
    """Classify as utility, commercial, or community."""
    if customer_type:
        ct = customer_type.lower()
        if "community" in ct:
            return "community"
    if capacity_kw and capacity_kw >= 1000:
        return "utility"
    return "commercial"


# ---------------------------------------------------------------------------
# Process layers
# ---------------------------------------------------------------------------

def process_btm_layer(data_source_id, dry_run=False):
    """Process Behind-the-Meter layer."""
    config = LAYERS["btm"]
    print(f"\n{'=' * 60}")
    print(f"Processing: {config['label']}")
    print(f"{'=' * 60}")

    features = fetch_all_records(config["id"], config["where"])
    print(f"  Total records: {len(features)}")

    fields = config["fields"]
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0

    for feat in features:
        attrs = feat.get("attributes", {})

        project_num = safe_str(attrs.get(fields["project_num"]))
        account_num = safe_str(attrs.get(fields["account_num"]))
        record_key = project_num or account_num
        if not record_key:
            skipped += 1
            continue

        source_record_id = f"njdep_{record_key}"

        company = safe_str(attrs.get(fields["company_name"]))
        address = safe_str(attrs.get(fields["address"]))
        city = safe_str(attrs.get(fields["city"]))
        zipcode = safe_str(attrs.get(fields["zip"]))
        year = attrs.get(fields["year"])
        size_kw = safe_float(attrs.get(fields["system_size_kw"]))
        cust_type = safe_str(attrs.get(fields["customer_type"]))
        third_party = safe_str(attrs.get(fields["third_party"]))
        lat = safe_float(attrs.get(fields["latitude"]))
        lon = safe_float(attrs.get(fields["longitude"]))

        if not size_kw or size_kw < MIN_CAPACITY_KW:
            skipped += 1
            continue

        capacity_mw = round(size_kw / 1000, 3)
        site_type = classify_site_type(size_kw, cust_type)

        full_address = address
        if address and city:
            full_address = f"{address}, {city}, NJ"
            if zipcode:
                full_address += f" {zipcode}"

        install_date = None
        if year:
            try:
                install_date = f"{int(year)}-01-01"
            except (ValueError, TypeError):
                pass

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": company[:255] if company else None,
            "state": "NJ",
            "city": city,
            "county": None,
            "zip_code": str(zipcode) if zipcode else None,
            "address": full_address[:255] if full_address else None,
            "latitude": lat,
            "longitude": lon,
            "capacity_mw": capacity_mw,
            "capacity_dc_kw": round(size_kw, 3),
            "site_type": site_type,
            "site_status": "active",
            "owner_name": company[:255] if company and third_party != "Yes" else None,
            "install_date": install_date,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            if dry_run:
                created += len(inst_batch)
            else:
                res = supabase_request("POST", "solar_installations", inst_batch)
                if res is not None:
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
            inst_batch = []

    if inst_batch:
        if dry_run:
            created += len(inst_batch)
        else:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)

    print(f"  Created: {created}, Skipped: {skipped}, Errors: {errors}")
    return {"created": created, "skipped": skipped, "errors": errors}


def process_public_layer(data_source_id, dry_run=False):
    """Process Public Facilities layer (has INSTALLER field)."""
    config = LAYERS["public"]
    print(f"\n{'=' * 60}")
    print(f"Processing: {config['label']}")
    print(f"{'=' * 60}")

    features = fetch_all_records(config["id"], config["where"])
    print(f"  Total records: {len(features)}")

    fields = config["fields"]
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0

    for feat in features:
        attrs = feat.get("attributes", {})

        account_num = safe_str(attrs.get(fields["account_num"]))
        if not account_num:
            skipped += 1
            continue

        source_record_id = f"njdep_pub_{account_num}"

        company = safe_str(attrs.get(fields["company_name"]))
        address = safe_str(attrs.get(fields["address"]))
        city = safe_str(attrs.get(fields["city"]))
        zipcode = safe_str(attrs.get(fields["zip"]))
        size_kw = safe_float(attrs.get(fields["system_size_kw"]))
        cust_type = safe_str(attrs.get(fields["customer_type"]))
        installer = safe_str(attrs.get(fields["installer"]))
        lat = safe_float(attrs.get(fields["latitude"]))
        lon = safe_float(attrs.get(fields["longitude"]))
        status_date = attrs.get(fields["status_date"])

        if not size_kw or size_kw < MIN_CAPACITY_KW:
            skipped += 1
            continue

        capacity_mw = round(size_kw / 1000, 3)
        site_type = classify_site_type(size_kw, cust_type)

        full_address = address
        if address and city:
            full_address = f"{address}, {city}, NJ"
            if zipcode:
                full_address += f" {zipcode}"

        install_date = epoch_to_date(status_date)

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": company[:255] if company else None,
            "state": "NJ",
            "city": city,
            "county": None,
            "zip_code": str(zipcode) if zipcode else None,
            "address": full_address[:255] if full_address else None,
            "latitude": lat,
            "longitude": lon,
            "capacity_mw": capacity_mw,
            "capacity_dc_kw": round(size_kw, 3),
            "site_type": site_type,
            "site_status": "active",
            "owner_name": company[:255] if company else None,
            "installer_name": installer[:255] if installer else None,
            "install_date": install_date,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            if dry_run:
                created += len(inst_batch)
            else:
                res = supabase_request("POST", "solar_installations", inst_batch)
                if res is not None:
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
            inst_batch = []

    if inst_batch:
        if dry_run:
            created += len(inst_batch)
        else:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)

    print(f"  Created: {created}, Skipped: {skipped}, Errors: {errors}")
    if installer:
        print(f"  (Last installer seen: {installer})")
    return {"created": created, "skipped": skipped, "errors": errors}


def process_community_layer(data_source_id, dry_run=False):
    """Process Community Solar Projects layer."""
    config = LAYERS["community"]
    print(f"\n{'=' * 60}")
    print(f"Processing: {config['label']}")
    print(f"{'=' * 60}")

    features = fetch_all_records(config["id"], config["where"])
    print(f"  Total records: {len(features)}")

    fields = config["fields"]
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0

    for feat in features:
        attrs = feat.get("attributes", {})

        account_num = safe_str(attrs.get(fields["account_num"]))
        docket_num = safe_str(attrs.get(fields["docket_num"]))
        record_key = account_num or docket_num
        if not record_key:
            skipped += 1
            continue

        source_record_id = f"njdep_cs_{record_key}"

        applicant = safe_str(attrs.get(fields["applicant"]))
        address = safe_str(attrs.get(fields["address"]))
        city = safe_str(attrs.get(fields["city"]))
        county = safe_str(attrs.get(fields["county"]))
        zipcode = safe_str(attrs.get(fields["zip"]))
        capacity_mw = safe_float(attrs.get(fields["capacity_mw"]))
        lat = safe_float(attrs.get(fields["latitude"]))
        lon = safe_float(attrs.get(fields["longitude"]))
        completion_year = attrs.get(fields["completion_year"])

        if not capacity_mw:
            skipped += 1
            continue

        full_address = address
        if address and city:
            full_address = f"{address}, {city}, NJ"

        install_date = None
        if completion_year:
            try:
                install_date = f"{int(completion_year)}-01-01"
            except (ValueError, TypeError):
                pass

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": applicant[:255] if applicant else None,
            "state": "NJ",
            "city": city,
            "county": county,
            "zip_code": str(zipcode) if zipcode else None,
            "address": full_address[:255] if full_address else None,
            "latitude": lat,
            "longitude": lon,
            "capacity_mw": round(capacity_mw, 3),
            "capacity_dc_kw": round(capacity_mw * 1000, 3),
            "site_type": "community",
            "site_status": "active",
            "developer_name": applicant[:255] if applicant else None,
            "install_date": install_date,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            if dry_run:
                created += len(inst_batch)
            else:
                res = supabase_request("POST", "solar_installations", inst_batch)
                if res is not None:
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
            inst_batch = []

    if inst_batch:
        if dry_run:
            created += len(inst_batch)
        else:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)

    print(f"  Created: {created}, Skipped: {skipped}, Errors: {errors}")
    return {"created": created, "skipped": skipped, "errors": errors}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ingest NJ DEP solar installations")
    parser.add_argument("--dry-run", action="store_true", help="Report without ingesting")
    args = parser.parse_args()

    print("NJ DEP Solar Installation Ingestion")
    print("=" * 60)
    print(f"API: {BASE_URL}")
    print(f"Min capacity: {MIN_CAPACITY_KW} kW")
    print(f"Dry run: {args.dry_run}")

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    results = {}
    results["btm"] = process_btm_layer(data_source_id, args.dry_run)
    results["public"] = process_public_layer(data_source_id, args.dry_run)
    results["community"] = process_community_layer(data_source_id, args.dry_run)

    # Summary
    total_created = sum(r["created"] for r in results.values())
    total_skipped = sum(r["skipped"] for r in results.values())
    total_errors = sum(r["errors"] for r in results.values())

    print(f"\n{'=' * 60}")
    print("NJ DEP Ingestion Summary")
    print(f"{'=' * 60}")
    for layer, stats in results.items():
        print(f"  {layer}: {stats['created']} created, {stats['skipped']} skipped, {stats['errors']} errors")
    print(f"  TOTAL: {total_created} created, {total_skipped} skipped, {total_errors} errors")

    if not args.dry_run and total_created > 0:
        supabase_request("PATCH", "solar_data_sources",
                         {"record_count": total_created,
                          "last_import": datetime.now().isoformat()},
                         params={"name": "eq.nj_dep"})

    print("\nDone!")


if __name__ == "__main__":
    main()

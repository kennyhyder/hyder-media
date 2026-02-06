#!/usr/bin/env python3
"""
Massachusetts PTS (Production Tracking System) Data Ingestion Script

Reads MassCEC PTS Excel data and imports commercial solar installations (>= 25 kW).
Includes module manufacturer, inverter manufacturer, installer, cost, location.

Source: https://www.masscec.com/public-records-requests
"""

import os
import sys
import json
import uuid
import urllib.request
import urllib.parse
from pathlib import Path

import openpyxl
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "ma_pts"
MIN_SIZE_KW = 25
BATCH_SIZE = 50

# Exclude single-family residential
EXCLUDE_TYPES = {"residential (3 or fewer dwelling units per building)"}


def supabase_request(method, table, data=None, params=None, headers_extra=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    if headers_extra:
        headers.update(headers_extra)

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
    """Get or create the MA PTS data source record."""
    params = {"name": "eq.ma_pts", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "ma_pts",
        "description": "MassCEC Production Tracking System - Solar PV Systems in Massachusetts",
        "url": "https://www.masscec.com/public-records-requests",
        "record_count": 0,
    })
    return ds_id


def safe_str(val):
    if val is None or val == "":
        return None
    s = str(val).strip()
    return s if s else None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None


# Installer cache
installer_cache = {}


def get_or_create_installer(name):
    if not name:
        return None
    normalized = name.upper().strip().replace(",", "").replace(".", "").replace("  ", " ")
    if not normalized:
        return None

    if normalized in installer_cache:
        return installer_cache[normalized]

    params = {
        "normalized_name": f"eq.{normalized}",
        "state": "eq.MA",
        "select": "id",
        "limit": "1",
    }
    existing = supabase_request("GET", "solar_installers", params=params)
    if existing:
        installer_cache[normalized] = existing[0]["id"]
        return existing[0]["id"]

    inst_id = str(uuid.uuid4())
    res = supabase_request("POST", "solar_installers", {
        "id": inst_id,
        "name": name.strip()[:255],
        "normalized_name": normalized[:255],
        "state": "MA",
    })
    if res is not None:
        installer_cache[normalized] = inst_id
        return inst_id
    return None


def process_excel(filepath, data_source_id):
    """Process the MA PTS Excel file."""
    print(f"  Loading {filepath.name}...")

    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb['PvinPTSwebsite']

    # Data starts at row 12 (row 11 is header)
    # Columns: A=Capacity DC kW, B=Date, C=Cost, D=Grant, E=City, F=Zip,
    #          G=County, H=Program, I=Facility Type, J=Installer,
    #          K=Module Mfr, L=Inverter Mfr, M=Meter Mfr, N=Utility,
    #          O=3rd Party, P=SREC, Q=Est Annual kWh

    total = 0
    commercial = 0
    created = 0
    errors = 0
    equipment_count = 0

    inst_batch = []
    eq_batch = []

    for row in ws.iter_rows(min_row=12, values_only=True):
        total += 1

        capacity_kw = safe_float(row[0])
        if not capacity_kw or capacity_kw < MIN_SIZE_KW:
            continue

        # Exclude single-family residential
        facility_type = safe_str(row[8])
        if facility_type and facility_type.lower() in EXCLUDE_TYPES:
            continue

        commercial += 1
        inst_id = str(uuid.uuid4())
        source_record_id = f"mapts_{total}"

        # Date
        install_date = None
        if row[1]:
            try:
                from datetime import datetime
                if isinstance(row[1], datetime):
                    install_date = row[1].strftime("%Y-%m-%d")
                else:
                    install_date = str(row[1])[:10]
            except:
                pass

        # Location
        city = safe_str(row[4])
        zip_code = safe_str(row[5])
        if zip_code:
            zip_code = str(zip_code).zfill(5)[:10]
        county = safe_str(row[6])

        # Cost
        total_cost = safe_float(row[2])
        cost_per_watt = round(total_cost / (capacity_kw * 1000), 2) if total_cost and capacity_kw else None

        # Installer
        installer_name = safe_str(row[9])
        installer_id = get_or_create_installer(installer_name)

        # Facility type mapping
        site_type = "commercial" if capacity_kw < 1000 else "utility"

        installation = {
            "id": inst_id,
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": f"MA-{total}",
            "state": "MA",
            "county": county,
            "city": city,
            "zip_code": zip_code,
            "capacity_mw": round(capacity_kw / 1000, 6),
            "capacity_dc_kw": round(capacity_kw, 3),
            "install_date": install_date,
            "site_type": site_type,
            "installer_id": installer_id,
            "installer_name": installer_name,
            "total_cost": total_cost,
            "cost_per_watt": cost_per_watt,
        }

        inst_batch.append(installation)

        # Equipment - Module
        module_mfr = safe_str(row[10])
        if module_mfr:
            eq_batch.append({
                "id": str(uuid.uuid4()),
                "installation_id": inst_id,
                "equipment_type": "module",
                "manufacturer": module_mfr,
                "equipment_status": "active",
                "data_source_id": data_source_id,
            })

        # Equipment - Inverter
        inverter_mfr = safe_str(row[11])
        if inverter_mfr:
            eq_batch.append({
                "id": str(uuid.uuid4()),
                "installation_id": inst_id,
                "equipment_type": "inverter",
                "manufacturer": inverter_mfr,
                "equipment_status": "active",
                "data_source_id": data_source_id,
            })

        # Flush batches
        if len(inst_batch) >= BATCH_SIZE:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)
            inst_batch = []

            if eq_batch:
                for i in range(0, len(eq_batch), BATCH_SIZE):
                    chunk = eq_batch[i:i + BATCH_SIZE]
                    res = supabase_request("POST", "solar_equipment", chunk)
                    if res is not None:
                        equipment_count += len(chunk)
                eq_batch = []

            if created % 500 == 0 and created > 0:
                print(f"    {created}/{commercial} created, {errors} errors, {equipment_count} equipment")

    # Flush remaining
    if inst_batch:
        res = supabase_request("POST", "solar_installations", inst_batch)
        if res is not None:
            created += len(inst_batch)
        else:
            errors += len(inst_batch)

    if eq_batch:
        for i in range(0, len(eq_batch), BATCH_SIZE):
            chunk = eq_batch[i:i + BATCH_SIZE]
            res = supabase_request("POST", "solar_equipment", chunk)
            if res is not None:
                equipment_count += len(chunk)

    wb.close()

    print(f"\n  Results: {total} total rows, {commercial} commercial >= {MIN_SIZE_KW}kW")
    print(f"    Created: {created}, Errors: {errors}")
    print(f"    Equipment: {equipment_count}")

    return created, equipment_count, errors


def main():
    print("MA PTS Data Ingestion Script")
    print("=" * 60)

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    xlsx_path = DATA_DIR / "solar-pv-systems.xlsx"
    if not xlsx_path.exists():
        print(f"Error: {xlsx_path} not found. Download from MassCEC first.")
        sys.exit(1)

    created, equipment, errors = process_excel(xlsx_path, data_source_id)

    supabase_request(
        "PATCH",
        "solar_data_sources",
        {"record_count": created},
        params={"name": "eq.ma_pts"},
    )

    print("\n" + "=" * 60)
    print("MA PTS ingestion complete!")
    print(f"  Installations created: {created}")
    print(f"  Equipment records: {equipment}")
    print(f"  Errors: {errors}")
    print(f"  Installers cached: {len(installer_cache)}")


if __name__ == "__main__":
    main()

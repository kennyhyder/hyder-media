#!/usr/bin/env python3
"""
EIA-860 Solar Data Ingestion Script

Downloads EIA Form 860 (2024) and imports solar generator data including:
- Owner/operator information
- Plant location (address, lat/lon)
- Solar technology details (tracking, panel type, bifacial)
- Capacity (AC/DC) and operating dates
- Retirement and repower status

Links to existing USPVDB data via eia_id = Plant Code.
"""

import os
import sys
import json
import zipfile
import urllib.request
import tempfile
from pathlib import Path

# openpyxl for reading Excel files
try:
    import openpyxl
except ImportError:
    print("Installing openpyxl...")
    os.system(f"{sys.executable} -m pip install openpyxl")
    import openpyxl

# supabase - we'll use the REST API directly via urllib since
# the Python supabase client may not be installed
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data"
EIA_URL = "https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip"
EIA_ZIP = DATA_DIR / "eia860_2024.zip"
EIA_DIR = DATA_DIR / "eia860_2024"


def supabase_request(method, table, data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    if method == "GET":
        headers["Prefer"] = "count=exact"

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            content_range = resp.headers.get("Content-Range", "")
            if method == "GET":
                result = json.loads(resp.read())
                return result, content_range
            return resp.status
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  Supabase error ({e.code}): {error_body[:200]}")
        return None


def download_eia860():
    """Download and extract EIA-860 data."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if EIA_DIR.exists() and any(EIA_DIR.glob("*.xlsx")):
        print(f"Using cached EIA-860 data from {EIA_DIR}")
        return

    print(f"Downloading EIA-860 from {EIA_URL}...")
    urllib.request.urlretrieve(EIA_URL, EIA_ZIP)
    print(f"  Downloaded {EIA_ZIP.stat().st_size / 1024 / 1024:.1f} MB")

    print("Extracting...")
    EIA_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(EIA_ZIP, "r") as zf:
        zf.extractall(EIA_DIR)
    print(f"  Extracted to {EIA_DIR}")


def read_excel_sheet(filepath, sheet_name, header_row=2):
    """Read an Excel sheet, returning list of dicts keyed by header names."""
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if len(rows) < header_row:
        return []

    headers = [str(h).strip() if h else f"col_{i}" for i, h in enumerate(rows[header_row - 1])]
    data = []
    for row in rows[header_row:]:
        record = {}
        for i, val in enumerate(row):
            if i < len(headers):
                record[headers[i]] = val
        data.append(record)
    return data


def load_plant_data():
    """Load plant-level data (location, address)."""
    filepath = list(EIA_DIR.glob("2___Plant*.xlsx"))[0]
    print(f"Reading {filepath.name}...")
    plants = read_excel_sheet(filepath, "Plant")
    # Index by Plant Code
    plant_map = {}
    for p in plants:
        code = p.get("Plant Code")
        if code:
            plant_map[int(code)] = p
    print(f"  {len(plant_map)} plants loaded")
    return plant_map


def load_owner_data():
    """Load ownership data."""
    filepath = list(EIA_DIR.glob("4___Owner*.xlsx"))[0]
    print(f"Reading {filepath.name}...")
    owners = read_excel_sheet(filepath, "Ownership")
    # Index by (Plant Code, Generator ID) - may have multiple owners
    owner_map = {}
    for o in owners:
        key = (int(o.get("Plant Code", 0)), str(o.get("Generator ID", "")))
        if key not in owner_map:
            owner_map[key] = []
        owner_map[key].append(o)
    print(f"  {len(owners)} ownership records loaded")
    return owner_map


def load_solar_data():
    """Load solar-specific generator data."""
    filepath = list(EIA_DIR.glob("3_3_Solar*.xlsx"))[0]
    print(f"Reading {filepath.name}...")

    operable = read_excel_sheet(filepath, "Operable")
    retired = read_excel_sheet(filepath, "Retired and Canceled")

    # Filter to PV only (exclude concentrated solar thermal)
    pv_operable = [g for g in operable if g.get("Prime Mover") == "PV"]
    pv_retired = [g for g in retired if g.get("Prime Mover") == "PV"]

    print(f"  {len(pv_operable)} operable PV generators")
    print(f"  {len(pv_retired)} retired PV generators")
    return pv_operable, pv_retired


def get_existing_installations():
    """Get existing installations indexed by eia_id for matching."""
    print("Fetching existing installations from Supabase...")
    all_installations = []
    offset = 0
    limit = 1000
    while True:
        result, content_range = supabase_request(
            "GET", "solar_installations",
            params={
                "select": "id,source_record_id,owner_name,operator_name",
                "limit": str(limit),
                "offset": str(offset),
            }
        )
        if not result:
            break
        all_installations.extend(result)
        if len(result) < limit:
            break
        offset += limit

    # Build map: source_record_id -> installation
    by_source = {}
    for inst in all_installations:
        src_id = inst.get("source_record_id")
        if src_id:
            by_source[src_id] = inst

    print(f"  {len(all_installations)} existing installations, {len(by_source)} with source_record_id")
    return by_source


def get_or_create_data_source():
    """Get or create the EIA-860 data source record."""
    result, _ = supabase_request(
        "GET", "solar_data_sources",
        params={"name": "eq.eia860", "select": "id"}
    )
    if result and len(result) > 0:
        return result[0]["id"]

    # Create it
    import uuid
    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "eia860",
        "description": "EIA Form 860 Annual Electric Generator Report - Solar Technology Data (2024)",
        "url": "https://www.eia.gov/electricity/data/eia860/",
        "record_count": 0,
    })
    return ds_id


def determine_tracking_type(gen):
    """Determine tracking type from EIA-860 flags."""
    if gen.get("Single-Axis Tracking?") == "Y":
        return "single-axis"
    if gen.get("Dual-Axis Tracking?") == "Y":
        return "dual-axis"
    if gen.get("Fixed Tilt?") == "Y":
        return "fixed-tilt"
    if gen.get("East West Fixed Tilt?") == "Y":
        return "fixed-tilt"
    return None


def determine_panel_tech(gen):
    """Determine panel technology from EIA-860 flags."""
    techs = []
    if gen.get("Crystalline Silicon?") == "Y":
        techs.append("crystalline-silicon")
    if gen.get("Thin-Film (CdTe)?") == "Y":
        techs.append("CdTe")
    if gen.get("Thin-Film (A-Si)?") == "Y":
        techs.append("a-Si")
    if gen.get("Thin-Film (CIGS)?") == "Y":
        techs.append("CIGS")
    if gen.get("Thin-Film (Other)?") == "Y":
        techs.append("thin-film-other")
    if gen.get("Bifacial?") == "Y":
        techs.append("bifacial")
    return ", ".join(techs) if techs else "PV"


def safe_float(val):
    """Safely convert to float."""
    if val is None or val == "" or val == " ":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_int(val):
    """Safely convert to int."""
    if val is None or val == "" or val == " ":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def build_install_date(month, year):
    """Build install date string from month/year."""
    y = safe_int(year)
    m = safe_int(month)
    if y and m:
        return f"{y}-{m:02d}-01"
    elif y:
        return f"{y}-01-01"
    return None


def main():
    download_eia860()

    plant_map = load_plant_data()
    owner_map = load_owner_data()
    solar_operable, solar_retired = load_solar_data()

    existing = get_existing_installations()
    data_source_id = get_or_create_data_source()

    print(f"\nProcessing {len(solar_operable)} operable + {len(solar_retired)} retired PV generators...")

    updated = 0
    created = 0
    skipped = 0
    errors = 0

    all_generators = [
        *[(g, "active") for g in solar_operable],
        *[(g, "decommissioned") for g in solar_retired],
    ]

    for i, (gen, status) in enumerate(all_generators):
        plant_code = safe_int(gen.get("Plant Code"))
        if not plant_code:
            skipped += 1
            continue

        plant = plant_map.get(plant_code, {})
        gen_id = str(gen.get("Generator ID", ""))

        # Check if this matches an existing USPVDB installation
        uspvdb_key = f"uspvdb_{plant_code}"
        existing_inst = existing.get(uspvdb_key)

        # Build update/create data
        owner_records = owner_map.get((plant_code, gen_id), [])
        primary_owner = owner_records[0] if owner_records else None

        # Owner name: from Owner file, or fall back to Utility Name (operator)
        owner_name = None
        if primary_owner:
            owner_name = primary_owner.get("Owner Name")
        operator_name = gen.get("Utility Name") or plant.get("Utility Name")

        capacity_ac = safe_float(gen.get("Nameplate Capacity (MW)"))
        capacity_dc = safe_float(gen.get("DC Net Capacity (MW)"))

        install_date = build_install_date(
            gen.get("Operating Month"),
            gen.get("Operating Year")
        )

        tracking = determine_tracking_type(gen)
        panel_tech = determine_panel_tech(gen)

        if existing_inst:
            # Update existing USPVDB installation with EIA-860 data
            update_data = {}

            # Only update fields that are currently empty
            if not existing_inst.get("owner_name") and owner_name:
                update_data["owner_name"] = owner_name
            if not existing_inst.get("operator_name") and operator_name:
                update_data["operator_name"] = operator_name

            # Always update these from EIA-860 (more authoritative)
            if operator_name:
                update_data["operator_name"] = operator_name
            if owner_name:
                update_data["owner_name"] = owner_name

            # Add plant address if not already set
            addr = plant.get("Street Address")
            city = plant.get("City")
            state = plant.get("State")
            zipcode = plant.get("Zip")
            if addr and str(addr).strip():
                update_data["address"] = str(addr).strip()
            if city and str(city).strip():
                update_data["city"] = str(city).strip()

            if update_data:
                result = supabase_request(
                    "PATCH", "solar_installations",
                    data=update_data,
                    params={"id": f"eq.{existing_inst['id']}"}
                )
                if result:
                    updated += 1
                else:
                    errors += 1
            else:
                skipped += 1
        else:
            # Create new installation from EIA-860 data
            import uuid
            inst_id = str(uuid.uuid4())

            lat = safe_float(plant.get("Latitude"))
            lon = safe_float(plant.get("Longitude"))

            new_inst = {
                "id": inst_id,
                "site_name": gen.get("Plant Name") or plant.get("Plant Name"),
                "site_type": "utility",
                "latitude": lat,
                "longitude": lon,
                "address": str(plant.get("Street Address", "")).strip() or None,
                "city": str(plant.get("City", "")).strip() or None,
                "state": str(plant.get("State", gen.get("State", ""))).strip() or None,
                "zip_code": str(plant.get("Zip", "")).strip() or None,
                "county": str(gen.get("County", plant.get("County", ""))).strip() or None,
                "capacity_ac_kw": round(capacity_ac * 1000, 2) if capacity_ac else None,
                "capacity_dc_kw": round(capacity_dc * 1000, 2) if capacity_dc else None,
                "tracking_type": tracking,
                "owner_name": owner_name,
                "operator_name": operator_name,
                "install_date": install_date,
                "site_status": status,
                "source_record_id": f"eia860_{plant_code}_{gen_id}",
                "data_source_id": data_source_id,
            }

            # Remove None values
            new_inst = {k: v for k, v in new_inst.items() if v is not None}

            result = supabase_request("POST", "solar_installations", new_inst)
            if result:
                created += 1

                # Create equipment record with panel technology info
                eq_data = {
                    "id": str(uuid.uuid4()),
                    "installation_id": inst_id,
                    "equipment_type": "module",
                    "module_technology": panel_tech,
                    "equipment_status": "active" if status == "active" else "removed",
                    "data_source_id": data_source_id,
                }
                supabase_request("POST", "solar_equipment", eq_data)
            else:
                errors += 1

        if (i + 1) % 500 == 0 or i == len(all_generators) - 1:
            print(f"  {i+1}/{len(all_generators)}: {updated} updated, {created} created, {skipped} skipped, {errors} errors")

    # Update data source record count
    supabase_request(
        "PATCH", "solar_data_sources",
        data={"record_count": updated + created},
        params={"id": f"eq.{data_source_id}"}
    )

    print(f"\nEIA-860 ingestion complete!")
    print(f"  Updated (existing USPVDB): {updated}")
    print(f"  Created (new): {created}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors: {errors}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
California DGStats Data Ingestion Script

Downloads interconnected project data from californiadgstats.ca.gov
and imports commercial solar installations (>= 25 kW) including:
- Panel manufacturer/model (up to 8 arrays)
- Inverter manufacturer/model (up to 64)
- Installer name
- Installation date, cost, location

Source: https://www.californiadgstats.ca.gov/downloads/
Data: ~2M total records, filtering to commercial >= 25 kW
"""

import os
import sys
import csv
import json
import uuid
import zipfile
import urllib.request
import urllib.parse
import tempfile
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

DATA_DIR = Path(__file__).parent.parent / "data" / "ca_dgstats"
DOWNLOAD_URL = "https://www.californiadgstats.ca.gov/download/interconnection_rule21_projects/"

# Commercial customer sectors to include
COMMERCIAL_SECTORS = {
    "commercial", "industrial", "government", "other government",
    "agricultural", "non-profit", "military",
}

MIN_SIZE_KW = 25
BATCH_SIZE = 50


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
    """Get or create the CA DGStats data source record."""
    params = {"name": "eq.ca_dgstats", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "ca_dgstats",
        "description": "California Distributed Generation Statistics - Rule 21 Interconnection Data",
        "url": "https://www.californiadgstats.ca.gov/downloads/",
        "record_count": 0,
    })
    return ds_id


def download_data():
    """Download and extract the CA DGStats ZIP file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DATA_DIR / "interconnection_projects.zip"

    # Check if already downloaded
    csv_files = list(DATA_DIR.glob("*.csv"))
    if csv_files:
        print(f"  Found {len(csv_files)} existing CSV files, skipping download")
        return csv_files

    print(f"  Downloading from {DOWNLOAD_URL}...")
    urllib.request.urlretrieve(DOWNLOAD_URL, zip_path)
    size_mb = zip_path.stat().st_size / 1024 / 1024
    print(f"  Downloaded {size_mb:.1f} MB")

    print("  Extracting ZIP...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(DATA_DIR)

    csv_files = list(DATA_DIR.glob("*.csv"))
    print(f"  Extracted {len(csv_files)} CSV files")
    return csv_files


def safe_str(val):
    """Convert value to string, handling None and empty."""
    if val is None or val == "" or val == "-1" or val == "N/A":
        return None
    s = str(val).strip()
    return s if s else None


def safe_float(val):
    """Convert value to float, handling None and empty."""
    if val is None or val == "" or val == "-1":
        return None
    try:
        return float(str(val).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None


def parse_date(val):
    """Parse date string to ISO format."""
    if not val or val == "-1":
        return None
    val = str(val).strip()
    # Try common formats
    for fmt in ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S"]:
        try:
            from datetime import datetime
            dt = datetime.strptime(val.split(" ")[0], fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# Installer cache
installer_cache = {}


def normalize_installer(name):
    """Normalize installer name for dedup."""
    if not name:
        return None
    return name.upper().strip().replace(",", "").replace(".", "").replace("  ", " ")


def get_or_create_installer(name, data_source_id):
    """Get or create an installer record, using cache."""
    if not name:
        return None, None
    normalized = normalize_installer(name)
    if not normalized:
        return None, None

    if normalized in installer_cache:
        return installer_cache[normalized], name.strip()

    # Check DB
    params = {
        "normalized_name": f"eq.{normalized}",
        "state": "eq.CA",
        "select": "id",
        "limit": "1",
    }
    existing = supabase_request("GET", "solar_installers", params=params)
    if existing:
        installer_cache[normalized] = existing[0]["id"]
        return existing[0]["id"], name.strip()

    # Create new
    inst_id = str(uuid.uuid4())
    res = supabase_request("POST", "solar_installers", {
        "id": inst_id,
        "name": name.strip()[:255],
        "normalized_name": normalized[:255],
        "state": "CA",
    })
    if res is not None:
        installer_cache[normalized] = inst_id
        return inst_id, name.strip()

    return None, name.strip()


def build_equipment_records(row, inst_id, data_source_id):
    """Extract equipment records from a CA DGStats row."""
    equipment = []

    def make_eq(eq_type, mfr, model, qty, tech=None, wattage=None, inv_kw=None, specs=None):
        return {
            "id": str(uuid.uuid4()),
            "installation_id": inst_id,
            "equipment_type": eq_type,
            "manufacturer": mfr,
            "model": model,
            "quantity": qty or 0,
            "module_technology": tech,
            "module_wattage_w": wattage,
            "inverter_capacity_kw": inv_kw,
            "equipment_status": "active",
            "data_source_id": data_source_id,
            "specs": specs,
        }

    # Generators (modules) - up to 8
    for i in range(1, 9):
        mfr = safe_str(row.get(f"Generator Manufacturer {i}"))
        model = safe_str(row.get(f"Generator Model {i}"))
        qty = safe_float(row.get(f"Generator Quantity {i}"))
        if mfr or model:
            equipment.append(make_eq(
                "module", mfr, model,
                int(qty) if qty else 0,
            ))

    # Inverters - up to 64
    for i in range(1, 65):
        mfr = safe_str(row.get(f"Inverter Manufacturer {i}"))
        model = safe_str(row.get(f"Inverter Model {i}"))
        qty = safe_float(row.get(f"Inverter Quantity {i}"))
        if mfr or model:
            inv_kw = None
            equipment.append(make_eq(
                "inverter", mfr, model,
                int(qty) if qty else 0,
                inv_kw=inv_kw,
            ))

    return equipment


def process_csv_file(filepath, data_source_id):
    """Process a single CA DGStats CSV file."""
    filename = filepath.name
    print(f"\n  Processing {filename}...")

    total = 0
    commercial = 0
    created = 0
    skipped = 0
    errors = 0
    equipment_count = 0

    inst_batch = []
    eq_batch = []

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1

            # Filter: commercial sectors only
            sector = safe_str(row.get("Customer Sector"))
            if not sector or sector.lower() not in COMMERCIAL_SECTORS:
                continue

            # Filter: >= 25 kW
            size_dc = safe_float(row.get("System Size DC"))
            size_ac = safe_float(row.get("System Size AC"))
            size = size_dc or size_ac
            if not size or size < MIN_SIZE_KW:
                continue

            commercial += 1

            # Build installation record
            app_id = safe_str(row.get("Application Id"))
            if not app_id:
                errors += 1
                continue

            source_record_id = f"cadg_{app_id}"
            inst_id = str(uuid.uuid4())

            # Parse date
            install_date = parse_date(row.get("App Approved Date"))

            # Installer
            installer_name = safe_str(row.get("Installer Name"))
            installer_id, _ = get_or_create_installer(installer_name, data_source_id)

            # Location
            city = safe_str(row.get("Service City"))
            zip_code = safe_str(row.get("Service Zip"))
            if zip_code and len(zip_code) > 10:
                zip_code = zip_code[:10]
            county = safe_str(row.get("Service County"))

            # Cost
            total_cost = safe_float(row.get("Total System Cost"))

            # Technology
            tech_type = safe_str(row.get("Technology Type"))

            # Mounting / tracking
            mounting = safe_str(row.get("Mounting Method"))
            tracking = safe_str(row.get("Tracking"))

            # Storage
            storage_kwh = safe_float(row.get("Storage Capacity (kWh)"))
            storage_kw = safe_float(row.get("Storage Size (kW AC)"))

            installation = {
                "id": inst_id,
                "source_record_id": source_record_id,
                "data_source_id": data_source_id,
                "site_name": app_id,
                "state": "CA",
                "county": county,
                "city": city,
                "zip_code": zip_code,
                "capacity_mw": round(size / 1000, 6) if size else None,
                "capacity_dc_kw": round(size_dc, 3) if size_dc else None,
                "capacity_ac_kw": round(size_ac, 3) if size_ac else None,
                "install_date": install_date,
                "site_type": "commercial" if (size and size < 1000) else "utility",
                "installer_id": installer_id,
                "installer_name": installer_name,
                "total_cost": total_cost,
                "mount_type": mounting,
                "tracking_type": tracking,
            }

            inst_batch.append(installation)

            # Equipment
            eq_records = build_equipment_records(row, inst_id, data_source_id)
            eq_batch.extend(eq_records)

            # Flush batches
            if len(inst_batch) >= BATCH_SIZE:
                res = supabase_request("POST", "solar_installations", inst_batch)
                if res is not None:
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
                inst_batch = []

                # Flush equipment
                if eq_batch:
                    for eq_chunk_start in range(0, len(eq_batch), BATCH_SIZE):
                        eq_chunk = eq_batch[eq_chunk_start:eq_chunk_start + BATCH_SIZE]
                        res = supabase_request("POST", "solar_equipment", eq_chunk)
                        if res is not None:
                            equipment_count += len(eq_chunk)
                    eq_batch = []

                if created % 500 == 0 and created > 0:
                    print(f"    {created}/{commercial}: {created} created, {skipped} skipped, {errors} errors")

    # Flush remaining
    if inst_batch:
        res = supabase_request("POST", "solar_installations", inst_batch)
        if res is not None:
            created += len(inst_batch)
        else:
            errors += len(inst_batch)

    if eq_batch:
        for eq_chunk_start in range(0, len(eq_batch), BATCH_SIZE):
            eq_chunk = eq_batch[eq_chunk_start:eq_chunk_start + BATCH_SIZE]
            res = supabase_request("POST", "solar_equipment", eq_chunk)
            if res is not None:
                equipment_count += len(eq_chunk)

    print(f"  {filename}: {total} total rows, {commercial} commercial >= {MIN_SIZE_KW}kW")
    print(f"    Created: {created}, Skipped: {skipped}, Errors: {errors}")
    print(f"    Equipment: {equipment_count}")

    return created, equipment_count, errors


def main():
    print("CA DGStats Ingestion Script")
    print("=" * 60)

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    # Download data
    print("\nDownloading CA DGStats data...")
    csv_files = download_data()

    if not csv_files:
        print("No CSV files found!")
        sys.exit(1)

    # Process each file
    total_created = 0
    total_equipment = 0
    total_errors = 0

    for filepath in sorted(csv_files):
        created, equipment, errors = process_csv_file(filepath, data_source_id)
        total_created += created
        total_equipment += equipment
        total_errors += errors

    # Update data source record count
    supabase_request(
        "PATCH",
        "solar_data_sources",
        {"record_count": total_created},
        params={"name": "eq.ca_dgstats"},
    )

    print("\n" + "=" * 60)
    print("CA DGStats ingestion complete!")
    print(f"  Installations created: {total_created}")
    print(f"  Equipment records: {total_equipment}")
    print(f"  Errors: {total_errors}")
    print(f"  Installers cached: {len(installer_cache)}")


if __name__ == "__main__":
    main()

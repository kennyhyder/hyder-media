#!/usr/bin/env python3
"""
NY-Sun Data Ingestion Script

Downloads solar project data from data.ny.gov (NY-Sun Initiative)
and imports commercial solar installations (>= 25 kW) including:
- Panel manufacturer/model
- Inverter manufacturer/model
- Installer name
- Installation date, cost, location

Source: https://data.ny.gov/Energy-Environment/Solar-Electric-Programs-Reported-by-NYSERDA-Beginn/3x8r-34rs
"""

import os
import sys
import csv
import json
import uuid
import io
import urllib.request
import urllib.parse
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

DOWNLOAD_URL = "https://data.ny.gov/api/views/3x8r-34rs/rows.csv?accessType=DOWNLOAD"
DATA_DIR = Path(__file__).parent.parent / "data" / "ny_sun"

# Sectors to include (non-residential = commercial)
COMMERCIAL_SECTORS = {
    "non-residential", "commercial", "industrial", "government",
    "municipal", "agricultural", "non-profit", "nonprofit", "institutional",
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
    """Get or create the NY-Sun data source record."""
    params = {"name": "eq.ny_sun", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "ny_sun",
        "description": "NY-Sun Initiative - Solar Electric Programs Reported by NYSERDA",
        "url": "https://data.ny.gov/Energy-Environment/Solar-Electric-Programs-Reported-by-NYSERDA-Beginn/3x8r-34rs",
        "record_count": 0,
    })
    return ds_id


def download_data():
    """Download the NY-Sun CSV file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = DATA_DIR / "ny_sun_projects.csv"

    if csv_path.exists():
        size_mb = csv_path.stat().st_size / 1024 / 1024
        print(f"  Found existing CSV ({size_mb:.1f} MB), skipping download")
        return csv_path

    print(f"  Downloading from {DOWNLOAD_URL}...")
    urllib.request.urlretrieve(DOWNLOAD_URL, csv_path)
    size_mb = csv_path.stat().st_size / 1024 / 1024
    print(f"  Downloaded {size_mb:.1f} MB")
    return csv_path


def safe_str(val):
    """Convert value to string, handling None and empty."""
    if val is None or val == "" or val == "N/A" or val == "n/a":
        return None
    s = str(val).strip()
    return s if s else None


def safe_float(val):
    """Convert value to float, handling None and empty."""
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None


def parse_date(val):
    """Parse date string to ISO format."""
    if not val:
        return None
    val = str(val).strip()
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


def get_or_create_installer(name):
    """Get or create an installer record, using cache."""
    if not name:
        return None
    normalized = normalize_installer(name)
    if not normalized:
        return None

    if normalized in installer_cache:
        return installer_cache[normalized]

    # Check DB
    params = {
        "normalized_name": f"eq.{normalized}",
        "state": "eq.NY",
        "select": "id",
        "limit": "1",
    }
    existing = supabase_request("GET", "solar_installers", params=params)
    if existing:
        installer_cache[normalized] = existing[0]["id"]
        return existing[0]["id"]

    # Create new
    inst_id = str(uuid.uuid4())
    res = supabase_request("POST", "solar_installers", {
        "id": inst_id,
        "name": name.strip()[:255],
        "normalized_name": normalized[:255],
        "state": "NY",
    })
    if res is not None:
        installer_cache[normalized] = inst_id
        return inst_id

    return None


def process_csv(csv_path, data_source_id):
    """Process the NY-Sun CSV file."""
    print(f"\n  Processing {csv_path.name}...")

    total = 0
    commercial = 0
    created = 0
    errors = 0
    equipment_count = 0

    inst_batch = []
    eq_batch = []

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        # Print column names for debugging
        if reader.fieldnames:
            print(f"  Found {len(reader.fieldnames)} columns")
            # Print first few to verify
            print(f"  Sample columns: {reader.fieldnames[:10]}")

        for row in reader:
            total += 1

            # Filter: non-residential only
            sector = safe_str(row.get("Sector"))
            if not sector or sector.lower() not in COMMERCIAL_SECTORS:
                continue

            # Filter: >= 25 kW
            size_kw = safe_float(row.get("Total Nameplate kW DC"))
            if not size_kw or size_kw < MIN_SIZE_KW:
                continue

            commercial += 1

            # Unique ID from project number
            project_id = safe_str(row.get("Project Number"))
            if not project_id:
                # Use row number as fallback
                project_id = f"row_{total}"

            source_record_id = f"nysun_{project_id}"
            inst_id = str(uuid.uuid4())

            # Date
            install_date = parse_date(row.get("Date Completed"))

            # Installer
            installer_name = safe_str(row.get("Contractor"))
            installer_id = get_or_create_installer(installer_name)

            # Location
            city = safe_str(row.get("City"))
            zip_code = safe_str(row.get("ZIP Code"))
            if zip_code and len(zip_code) > 10:
                zip_code = zip_code[:10]
            county = safe_str(row.get("County"))

            # Cost
            total_cost = safe_float(row.get("Project Cost"))
            cost_per_watt = round(total_cost / (size_kw * 1000), 2) if total_cost and size_kw else None

            # Latitude / Longitude
            lat = safe_float(row.get("Latitude"))
            lon = safe_float(row.get("Longitude"))

            installation = {
                "id": inst_id,
                "source_record_id": source_record_id,
                "data_source_id": data_source_id,
                "site_name": project_id,
                "state": "NY",
                "county": county,
                "city": city,
                "zip_code": zip_code,
                "latitude": lat,
                "longitude": lon,
                "capacity_mw": round(size_kw / 1000, 6),
                "capacity_dc_kw": round(size_kw, 3),
                "install_date": install_date,
                "site_type": "commercial" if size_kw < 1000 else "utility",
                "installer_id": installer_id,
                "installer_name": installer_name,
                "total_cost": total_cost,
                "cost_per_watt": cost_per_watt,
            }

            inst_batch.append(installation)

            # Equipment records
            # Panel
            panel_mfr = safe_str(row.get("Primary PV Module Manufacturer"))
            panel_model = safe_str(row.get("PV Module Model Number"))
            panel_qty = safe_float(row.get("Total PV Module Quantity"))
            if panel_mfr or panel_model:
                eq_batch.append({
                    "id": str(uuid.uuid4()),
                    "installation_id": inst_id,
                    "equipment_type": "module",
                    "manufacturer": panel_mfr,
                    "model": panel_model,
                    "quantity": int(panel_qty) if panel_qty else 0,
                    "equipment_status": "active",
                    "data_source_id": data_source_id,
                })

            # Inverter
            inv_mfr = safe_str(row.get("Primary Inverter Manufacturer"))
            inv_model = safe_str(row.get("Primary Inverter Model Number"))
            inv_qty = safe_float(row.get("Total Inverter Quantity"))
            if inv_mfr or inv_model:
                eq_batch.append({
                    "id": str(uuid.uuid4()),
                    "installation_id": inst_id,
                    "equipment_type": "inverter",
                    "manufacturer": inv_mfr,
                    "model": inv_model,
                    "quantity": int(inv_qty) if inv_qty else 0,
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

    print(f"\n  Results: {total} total rows, {commercial} commercial >= {MIN_SIZE_KW}kW")
    print(f"    Created: {created}, Errors: {errors}")
    print(f"    Equipment: {equipment_count}")

    return created, equipment_count, errors


def main():
    print("NY-Sun Data Ingestion Script")
    print("=" * 60)

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    # Download data
    print("\nDownloading NY-Sun data...")
    csv_path = download_data()

    # Process
    created, equipment, errors = process_csv(csv_path, data_source_id)

    # Update data source record count
    supabase_request(
        "PATCH",
        "solar_data_sources",
        {"record_count": created},
        params={"name": "eq.ny_sun"},
    )

    print("\n" + "=" * 60)
    print("NY-Sun ingestion complete!")
    print(f"  Installations created: {created}")
    print(f"  Equipment records: {equipment}")
    print(f"  Errors: {errors}")
    print(f"  Installers cached: {len(installer_cache)}")


if __name__ == "__main__":
    main()

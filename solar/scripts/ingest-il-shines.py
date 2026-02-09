#!/usr/bin/env python3
"""
Illinois Shines Data Ingestion Script

Reads IL Shines Excel data and imports commercial solar installations (>= 25 kW).
Note: This dataset has no equipment manufacturer/model data.
Only basic project info: size, zip, dates, utility.

Source: https://cleanenergy.illinois.gov/download-data.html
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

DATA_DIR = Path(__file__).parent.parent / "data" / "il_shines"
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
    """Get or create the IL Shines data source record."""
    params = {"name": "eq.il_shines", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "il_shines",
        "description": "Illinois Shines - Adjustable Block Program Solar Installation Data",
        "url": "https://cleanenergy.illinois.gov/download-data.html",
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
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def process_excel(filepath, data_source_id):
    """Process the IL Shines Excel file."""
    print(f"  Loading {filepath.name}...")

    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb['Illinois Shines Data']

    # Columns (0-indexed from row tuple):
    # 0=App ID, 1=Category, 2=DG Category, 3=CS Category, 4=Group,
    # 5=zip, 6=Batch Status, 7=Interconnected Utility,
    # 8=Part I Status, 9=Part I Verification Date, 10=Contracting Utility,
    # 11=Scheduled Energized Date, 12=Part II Size AC, 13=Part II Status,
    # 14=Part II Online Date

    total = 0
    commercial = 0
    created = 0
    errors = 0

    inst_batch = []

    for row in ws.iter_rows(min_row=2, values_only=True):
        total += 1

        size_ac = safe_float(row[12])
        if not size_ac or size_ac < MIN_SIZE_KW:
            continue

        commercial += 1
        app_id = safe_str(row[0])
        if not app_id:
            errors += 1
            continue

        source_record_id = f"ilshines_{app_id}"
        inst_id = str(uuid.uuid4())

        # Date - use Scheduled Energized Date or Part II Online Date
        install_date = None
        for date_col in [11, 14, 9]:  # Energized, Online, Verification
            if row[date_col]:
                try:
                    from datetime import datetime
                    if isinstance(row[date_col], datetime):
                        install_date = row[date_col].strftime("%Y-%m-%d")
                    else:
                        install_date = str(row[date_col])[:10]
                    break
                except:
                    pass

        # Location
        zip_code = safe_str(row[5])
        if zip_code:
            zip_code = str(zip_code).zfill(5)[:10]

        # Category
        dg_cat = safe_str(row[2])
        cs_cat = safe_str(row[3])
        category = dg_cat or cs_cat or safe_str(row[1])

        site_type = "commercial" if size_ac < 1000 else "utility"

        installation = {
            "id": inst_id,
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": f"IL-{app_id}",
            "state": "IL",
            "zip_code": zip_code,
            "capacity_mw": round(size_ac / 1000, 6),
            "capacity_ac_kw": round(size_ac, 3),
            "install_date": install_date,
            "site_type": site_type,
            "site_status": "active",
        }

        inst_batch.append(installation)

        # Flush batch
        if len(inst_batch) >= BATCH_SIZE:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)
            inst_batch = []

            if created % 500 == 0 and created > 0:
                print(f"    {created}/{commercial} created, {errors} errors")

    # Flush remaining
    if inst_batch:
        res = supabase_request("POST", "solar_installations", inst_batch)
        if res is not None:
            created += len(inst_batch)
        else:
            errors += len(inst_batch)

    wb.close()

    print(f"\n  Results: {total} total rows, {commercial} commercial >= {MIN_SIZE_KW}kW")
    print(f"    Created: {created}, Errors: {errors}")

    return created, errors


def main():
    print("IL Shines Data Ingestion Script")
    print("=" * 60)

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    xlsx_path = DATA_DIR / "illinois-shines.xlsx"
    if not xlsx_path.exists():
        print(f"Error: {xlsx_path} not found.")
        sys.exit(1)

    created, errors = process_excel(xlsx_path, data_source_id)

    supabase_request(
        "PATCH",
        "solar_data_sources",
        {"record_count": created},
        params={"name": "eq.il_shines"},
    )

    print("\n" + "=" * 60)
    print("IL Shines ingestion complete!")
    print(f"  Installations created: {created}")
    print(f"  Errors: {errors}")


if __name__ == "__main__":
    main()

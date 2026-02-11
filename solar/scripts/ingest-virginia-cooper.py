#!/usr/bin/env python3
"""
Virginia Cooper Center Solar Database Ingestion

Downloads the Virginia solar and storage project database from the Weldon Cooper
Center for Public Service at UVA and ingests solar projects.

Source: https://solardatabase.coopercenter.org/
Data: ~490+ utility-scale solar projects in Virginia with developer/owner names,
      coordinates, capacity, permit status, and battery storage details.

Usage:
  python3 -u scripts/ingest-virginia-cooper.py
  python3 -u scripts/ingest-virginia-cooper.py --dry-run
"""

import os
import sys
import json
import re
import csv
import urllib.request
import urllib.parse
from pathlib import Path
from io import StringIO

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

CSV_URL = "https://solardatabase.coopercenter.org/export-csv/"
EXCEL_URL = "https://solardatabase.coopercenter.org/export_xlsx/"
PAGE_URL = "https://solardatabase.coopercenter.org/solar/"


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
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True, None
    except Exception as e:
        return False, str(e)


def get_existing_source_ids(prefix):
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}*",
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
    body = json.dumps({
        "name": name,
        "url": "https://solardatabase.coopercenter.org/"
    }).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_csv():
    """Download Virginia solar database as CSV."""
    print("Downloading Virginia Cooper Center solar database...")

    # Try CSV export first
    for url in [CSV_URL, EXCEL_URL]:
        print(f"  Trying: {url}")
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                content_type = resp.headers.get("Content-Type", "")
                content = resp.read()
                print(f"  Downloaded {len(content):,} bytes (Content-Type: {content_type})")

                # Save locally
                data_dir = Path(__file__).parent.parent / "data" / "virginia_cooper"
                data_dir.mkdir(parents=True, exist_ok=True)

                if "csv" in content_type.lower() or url.endswith("csv/"):
                    path = data_dir / "virginia_solar.csv"
                    with open(path, "wb") as f:
                        f.write(content)
                    print(f"  Saved to {path}")
                    return path, "csv"
                else:
                    path = data_dir / "virginia_solar.xlsx"
                    with open(path, "wb") as f:
                        f.write(content)
                    print(f"  Saved to {path}")
                    return path, "xlsx"
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    print("  ERROR: Could not download from any URL")
    print("  Try manual download from https://solardatabase.coopercenter.org/solar/")
    return None, None


def parse_csv(path):
    """Parse CSV file."""
    records = []
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(dict(row))
    return records


def parse_xlsx(path):
    """Parse Excel file."""
    try:
        import openpyxl
    except ImportError:
        print("Error: openpyxl required. Install: pip3 install openpyxl")
        sys.exit(1)

    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    rows = ws.iter_rows()
    header_row = next(rows)
    headers = [str(cell.value or "").strip() for cell in header_row]

    records = []
    for row in rows:
        record = {}
        for i, cell in enumerate(row):
            if i < len(headers):
                record[headers[i]] = cell.value
        records.append(record)

    wb.close()
    return records


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def safe_date(val):
    if not val:
        return None
    s = str(val).strip()
    if "T" in s:
        s = s.split("T")[0]
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


def get_field(record, *candidates):
    """Get first non-empty value from candidate field names."""
    for c in candidates:
        val = record.get(c)
        if val is not None and str(val).strip() and str(val).strip().lower() not in ("nan", "none", "n/a", ""):
            return str(val).strip()
    return None


def transform_record(record, data_source_id):
    """Convert Virginia Cooper Center record to installation dict."""
    # Data ID is the unique identifier
    data_id = get_field(record, "data_id", "Data ID", "ID")
    if not data_id:
        return None

    source_id = f"vacooper_{data_id}"

    # Project name
    name = get_field(record, "project_name", "Project Name", "Name")

    # Developer/owner
    developer = get_field(record, "local_action_project_owner", "owner_developer",
                          "Owner/Developer at Local Action", "Owner/Developer", "Developer")

    # Capacity
    cap_mw = safe_float(get_field(record, "project_mw", "Project MW", "MW", "Capacity (MW)",
                                   "project_capacity_mw", "Nameplate Capacity (MWac)"))

    # Location — Virginia Cooper has no lat/lng, only text location descriptions
    lat = safe_float(get_field(record, "latitude", "Latitude", "lat"))
    lng = safe_float(get_field(record, "longitude", "Longitude", "lng", "long"))
    locality = get_field(record, "locality", "Locality", "County", "Jurisdiction")
    region = get_field(record, "region", "Region")
    location_desc = get_field(record, "location_description", "Location Description", "Address")

    # EIA cross-reference IDs (useful for matching to existing records)
    eia_plant_id = get_field(record, "eia_plant_id", "EIA Plant ID")
    eia_generator_id = get_field(record, "eia_generator_id", "EIA Generator ID")

    # Permit status
    permit_status = get_field(record, "local_permit_status", "Local Permit Status", "Status")
    if permit_status:
        ps = permit_status.lower()
        if "approved" in ps or "by-right" in ps:
            site_status = "proposed"  # Approved but may not be built yet
        elif "operating" in ps or "operational" in ps or "in service" in ps:
            site_status = "active"
        elif "denied" in ps or "withdrawn" in ps:
            site_status = "canceled"
        elif "pending" in ps or "under review" in ps:
            site_status = "proposed"
        else:
            site_status = "proposed"
    else:
        site_status = "proposed"

    # Date
    action_date = safe_date(get_field(record, "final_action_date", "date_final_action",
                                       "Date of Final Action", "Final Action Date"))

    # Battery storage
    bess_mw = safe_float(get_field(record, "bess_mw", "BESS MW", "Energy Storage MW",
                                    "energy_storage_mw", "bess_power_mw"))
    has_battery = bool(bess_mw and bess_mw > 0)
    if not has_battery:
        es = get_field(record, "energy_storage_onsite", "Energy Storage On-Site")
        if es and es.lower() in ("yes", "true", "y"):
            has_battery = True

    # Acreage (store in description or total_cost field? Store in site_name for now)
    acreage = safe_float(get_field(record, "project_acreage", "Acreage", "Project Acreage"))

    site_type = "utility" if cap_mw and cap_mw >= 1.0 else "commercial"

    return {
        "source_record_id": source_id,
        "site_name": name if name else None,
        "site_type": site_type,
        "address": location_desc if location_desc else None,
        "city": None,
        "state": "VA",
        "county": locality.upper() if locality else None,
        "latitude": lat,
        "longitude": lng,
        "capacity_dc_kw": round(cap_mw * 1000, 1) if cap_mw else None,
        "capacity_mw": round(cap_mw, 3) if cap_mw else None,
        "install_date": action_date,
        "site_status": site_status,
        "developer_name": developer if developer else None,
        "owner_name": developer if developer else None,  # Developer is often also the owner/applicant
        "operator_name": None,
        "installer_name": None,
        "data_source_id": data_source_id,
        "zip_code": None,
        "total_cost": None,
        "has_battery_storage": has_battery,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Virginia Cooper Center Solar Database Ingestion")
    parser.add_argument("--dry-run", action="store_true", help="Preview without ingesting")
    parser.add_argument("--file", type=str, help="Use existing local file instead of downloading")
    args = parser.parse_args()

    print("Virginia Cooper Center Solar Database Ingestion")
    print("=" * 60)

    # Download or use existing file
    if args.file:
        path = Path(args.file)
        fmt = "xlsx" if path.suffix == ".xlsx" else "csv"
        print(f"  Using local file: {path}")
    else:
        path, fmt = download_csv()
        if not path:
            sys.exit(1)

    # Parse
    print(f"\nParsing {fmt.upper()} file...")
    if fmt == "csv":
        records = parse_csv(path)
    else:
        records = parse_xlsx(path)
    print(f"  Total records: {len(records)}")

    if not records:
        print("No records found!")
        return

    # Show column names
    cols = list(records[0].keys())
    print(f"  Columns ({len(cols)}): {cols[:15]}...")

    # Get data source
    if not args.dry_run:
        data_source_id = get_data_source_id("virginia_cooper_center")
    else:
        data_source_id = "dry-run"

    # Get existing
    if not args.dry_run:
        existing_ids = get_existing_source_ids("vacooper_")
        print(f"  Existing records: {len(existing_ids)}")
    else:
        existing_ids = set()

    # Transform
    installations = []
    skipped_dup = 0
    skipped_invalid = 0
    seen_ids = set()
    developers = set()

    for record in records:
        inst = transform_record(record, data_source_id)
        if not inst:
            skipped_invalid += 1
            continue
        sid = inst["source_record_id"]
        if sid in existing_ids or sid in seen_ids:
            skipped_dup += 1
            continue
        seen_ids.add(sid)
        installations.append(inst)
        if inst.get("developer_name"):
            developers.add(inst["developer_name"])

    print(f"\n  Transformed: {len(installations)}")
    print(f"  Skipped (duplicate): {skipped_dup}")
    print(f"  Skipped (invalid): {skipped_invalid}")
    print(f"  With developer names: {sum(1 for i in installations if i.get('developer_name'))}")
    print(f"  With coordinates: {sum(1 for i in installations if i.get('latitude'))}")
    print(f"  With capacity: {sum(1 for i in installations if i.get('capacity_mw'))}")
    print(f"  Unique developers: {len(developers)}")
    if developers:
        top_devs = sorted(developers)[:10]
        print(f"  Sample developers: {', '.join(top_devs)}")

    # Status breakdown
    from collections import Counter
    statuses = Counter(i.get("site_status", "?") for i in installations)
    print(f"  Status: {dict(statuses)}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
        for inst in installations[:10]:
            print(f"    {inst['source_record_id']} | {inst.get('site_name', 'N/A')[:40]} | {inst.get('capacity_mw', '?')} MW | {inst.get('developer_name', 'N/A')}")
        return

    if not installations:
        print("  No new records to ingest.")
        return

    # Batch insert
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
            print(f"    Batch error at {i}: {err}")

    print(f"\n  Created: {created}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

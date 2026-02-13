#!/usr/bin/env python3
"""
San Diego City CSV Permit Ingestion Script

Downloads bulk CSV files from seshat.datasd.org (City of San Diego open data),
filters for solar permits, parses equipment from descriptions, and ingests
into solar_installations and solar_equipment tables.

San Diego City publishes two "sets" of permit data:
  - Set 2 (current system, 2018+): ~255K active + ~133K closed permits
  - Set 1 (legacy system, pre-2018): ~160K active + ~610K closed permits

Solar filtering: APPROVAL_TYPE contains "PV", "Photovoltaic", or "SB 379"

Data quality: 99.9% geocoded, 50%+ have kW capacity, ~11% have manufacturer+model

Usage:
  python3 -u scripts/ingest-san-diego-csv.py                    # Set 2 (current)
  python3 -u scripts/ingest-san-diego-csv.py --set 1            # Set 1 (legacy)
  python3 -u scripts/ingest-san-diego-csv.py --set all          # Both sets
  python3 -u scripts/ingest-san-diego-csv.py --dry-run          # Preview
  python3 -u scripts/ingest-san-diego-csv.py --limit 100        # First N records
"""

import os
import sys
import csv
import json
import re
import io
import argparse
import urllib.request
import urllib.parse
import ssl
import gzip
import time
from pathlib import Path

from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50

# CSV file URLs on seshat.datasd.org (S3/CloudFront)
CSV_URLS = {
    "set2_active": "https://seshat.datasd.org/development_permits_set2/permits_set2_active_datasd.csv",
    "set2_closed": "https://seshat.datasd.org/development_permits_set2/permits_set2_closed_datasd.csv",
    "set1_active": "https://seshat.datasd.org/development_permits_set1/permits_set1_active_datasd.csv",
    "set1_closed": "https://seshat.datasd.org/development_permits_set1/permits_set1_closed_datasd.csv",
}

DATA_DIR = Path(__file__).parent.parent / "data" / "san_diego_csv"

# Solar APPROVAL_TYPE patterns (from research agent)
SOLAR_TYPES = re.compile(
    r'photovoltaic|PV|SB\s*379|solar\s+electric|solar\s+energy\s+system',
    re.IGNORECASE
)

# False positive exclusions
SOLAR_FALSE_POSITIVES = re.compile(
    r'solar\s+screen|solar\s+shade|solar\s+tube|solar\s+film|solar\s+water\s+heat',
    re.IGNORECASE
)

# Equipment extraction patterns
PANEL_PATTERN = re.compile(r'\(?\s*(\d+)\s*\)?\s*(?:(?:PCS|UNITS|EA)?\s+)?([A-Z][A-Za-z0-9\s\.\-\/\+]+?)\s+(?:MODULES?|PANELS?|SOLAR\s+MODULES?)', re.IGNORECASE)
INVERTER_PATTERN = re.compile(r'\(?\s*(\d+)\s*\)?\s*(?:(?:PCS|UNITS|EA)?\s+)?([A-Z][A-Za-z0-9\s\.\-\/\+]+?)\s+(?:INVERTERS?|MICRO\s*INVERTERS?)', re.IGNORECASE)
KW_PATTERN = re.compile(r'([\d]+\.?\d*)\s*kw\s*(?:dc)?', re.IGNORECASE)
MW_PATTERN = re.compile(r'([\d]+\.?\d*)\s*MW', re.IGNORECASE)
MODULE_COUNT_PATTERN = re.compile(r'NO\.?\s*OF\s*MODULES?\s*:?\s*(\d+)', re.IGNORECASE)
INVERTER_COUNT_PATTERN = re.compile(r'NO\.?\s*OF\s*INVERTERS?\s*:?\s*(\d+)', re.IGNORECASE)
WATT_PATTERN = re.compile(r'(\d{2,3})\s*(?:W|WATT)\b', re.IGNORECASE)
BATTERY_PATTERN = re.compile(r'batter[yi]|powerwall|storage|encharge|bess|ess\b', re.IGNORECASE)


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
    body = json.dumps({"name": name, "url": "https://data.sandiego.gov/datasets/development-permits-set2/"}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


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


# ---------------------------------------------------------------------------
# CSV download
# ---------------------------------------------------------------------------

def download_csv(url, dest_path):
    """Download a CSV file if not already cached."""
    if dest_path.exists():
        size_mb = dest_path.stat().st_size / (1024 * 1024)
        print(f"  Using cached file: {dest_path.name} ({size_mb:.1f} MB)")
        return

    print(f"  Downloading {url}...")
    print(f"    This may take a few minutes for large files...")

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "text/csv,*/*",
    })
    with urllib.request.urlopen(req, timeout=600) as resp:
        total_size = int(resp.headers.get('Content-Length', 0))
        downloaded = 0
        with open(dest_path, 'wb') as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0 and downloaded % (10 * 1024 * 1024) < 65536:
                    pct = downloaded / total_size * 100
                    print(f"    {downloaded / (1024*1024):.1f} / {total_size / (1024*1024):.1f} MB ({pct:.0f}%)")

    size_mb = dest_path.stat().st_size / (1024 * 1024)
    print(f"    Downloaded: {size_mb:.1f} MB")


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_date(val):
    """Extract YYYY-MM-DD from date strings."""
    if not val:
        return None
    s = str(val).strip()
    if "T" in s:
        s = s.split("T")[0]
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    # Try MM/DD/YYYY
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


def is_solar_record(row):
    """Check if a permit record is solar-related."""
    approval_type = row.get("APPROVAL_TYPE", "") or row.get("approval_type", "")
    project_scope = row.get("PROJECT_SCOPE", "") or row.get("project_scope", "")
    project_title = row.get("PROJECT_TITLE", "") or row.get("project_title", "")

    # Primary filter: APPROVAL_TYPE
    if SOLAR_TYPES.search(approval_type):
        # Exclude false positives
        if SOLAR_FALSE_POSITIVES.search(project_scope or project_title):
            return False
        return True

    # Secondary: check scope/title for solar keywords
    for text in [project_scope, project_title]:
        if text and re.search(r'solar\s+(?:panel|module|photovoltaic|pv|energy\s+system)', text, re.IGNORECASE):
            if not SOLAR_FALSE_POSITIVES.search(text):
                return True

    return False


def parse_equipment(desc):
    """Parse equipment details from PROJECT_SCOPE description.

    San Diego descriptions are structured like:
    "(10) HANWHA Q.PEAK DUO BLK ML-G9+ 380 MODULES, (10) SOLAREDGE P401 OPTIMIZERS,
     (1) SOLAREDGE SE3800H-USS3 EH INVERTERS, 3.80 kW DC"
    """
    if not desc:
        return [], None, None

    equipment = []

    # Extract modules with manufacturer+model
    for m in PANEL_PATTERN.finditer(desc):
        qty = int(m.group(1))
        name = m.group(2).strip()
        # Split manufacturer from model (first word is usually manufacturer)
        parts = name.split(None, 1)
        if len(parts) >= 2:
            manufacturer = parts[0]
            model = parts[1]
        else:
            manufacturer = name
            model = None
        equipment.append({
            "equipment_type": "module",
            "manufacturer": manufacturer,
            "model": model,
            "quantity": qty,
        })

    # Extract inverters
    for m in INVERTER_PATTERN.finditer(desc):
        qty = int(m.group(1))
        name = m.group(2).strip()
        parts = name.split(None, 1)
        if len(parts) >= 2:
            manufacturer = parts[0]
            model = parts[1]
        else:
            manufacturer = name
            model = None
        equipment.append({
            "equipment_type": "inverter",
            "manufacturer": manufacturer,
            "model": model,
            "quantity": qty,
        })

    # Extract module count if not from equipment
    module_count = None
    m = MODULE_COUNT_PATTERN.search(desc)
    if m:
        module_count = int(m.group(1))
        if not any(e["equipment_type"] == "module" for e in equipment) and module_count:
            equipment.append({
                "equipment_type": "module",
                "quantity": module_count,
            })

    # Extract inverter count
    m = INVERTER_COUNT_PATTERN.search(desc)
    if m:
        inv_count = int(m.group(1))
        if not any(e["equipment_type"] == "inverter" for e in equipment) and inv_count:
            equipment.append({
                "equipment_type": "inverter",
                "quantity": inv_count,
            })

    # Extract capacity
    capacity_kw = None
    m_mw = MW_PATTERN.search(desc)
    m_kw = KW_PATTERN.search(desc)
    if m_mw:
        capacity_kw = float(m_mw.group(1)) * 1000
    elif m_kw:
        capacity_kw = float(m_kw.group(1))

    has_battery = bool(BATTERY_PATTERN.search(desc))

    return equipment, capacity_kw, has_battery


def transform_row(row, data_source_id, prefix):
    """Transform a CSV row into installation + equipment records."""
    # Get permit ID — try multiple column names (different across sets)
    approval_id = (row.get("APPROVAL_ID") or row.get("approval_id") or
                   row.get("JOB_ID") or row.get("job_id") or
                   row.get("PROJECT_ID") or row.get("project_id") or "")
    if not approval_id:
        return None, None, None

    source_id = f"{prefix}_{approval_id}"

    # Description / scope
    scope = (row.get("PROJECT_SCOPE") or row.get("project_scope") or
             row.get("APPROVAL_SCOPE") or row.get("approval_scope") or "")
    title = (row.get("PROJECT_TITLE") or row.get("project_title") or "")

    desc = scope or title

    # Parse equipment from description
    equipment, capacity_kw, has_battery = parse_equipment(desc)

    # Address
    address = (row.get("ADDRESS_JOB") or row.get("address_job") or "")

    # Coordinates (99.9% populated)
    lat = safe_float(row.get("LAT_JOB") or row.get("lat_job"))
    lng = safe_float(row.get("LNG_JOB") or row.get("lng_job"))

    # Validate coordinates
    if lat and (lat < 25 or lat > 50):
        lat = None
    if lng and (lng > -60 or lng < -130):
        lng = None

    # Installer/permit holder
    installer = (row.get("APPROVAL_PERMIT_HOLDER") or row.get("approval_permit_holder") or "")

    # Date (prefer issue date)
    install_date = safe_date(
        row.get("DATE_APPROVAL_ISSUE") or row.get("date_approval_issue") or
        row.get("DATE_APPROVAL_CREATE") or row.get("date_approval_create")
    )

    # Cost
    cost = safe_float(row.get("APPROVAL_VALUATION") or row.get("approval_valuation"))

    # City extraction from address ("5443 Barclay Av, San Diego, CA 92120")
    city = "San Diego"
    zip_code = None
    if address:
        m = re.search(r',\s*([A-Za-z ]+?),\s*CA\s+(\d{5})', address)
        if m:
            city = m.group(1).strip()
            zip_code = m.group(2)

    # Status
    status_raw = (row.get("APPROVAL_STATUS") or row.get("approval_status") or "").lower()
    if "expired" in status_raw or "cancel" in status_raw:
        site_status = "canceled"
    elif "closed" in status_raw or "issued" in status_raw:
        site_status = "active"
    else:
        site_status = "proposed"

    inst = {
        "source_record_id": source_id,
        "site_name": title[:255] if title else None,
        "site_type": "commercial",
        "address": address[:255] if address else None,
        "city": city,
        "state": "CA",
        "zip_code": zip_code,
        "county": "SAN DIEGO",
        "latitude": lat,
        "longitude": lng,
        "capacity_dc_kw": capacity_kw,
        "capacity_mw": round(capacity_kw / 1000, 3) if capacity_kw else None,
        "install_date": install_date,
        "site_status": site_status,
        "installer_name": installer[:255] if installer else None,
        "owner_name": None,
        "developer_name": None,
        "operator_name": None,
        "total_cost": cost,
        "data_source_id": data_source_id,
        "has_battery_storage": has_battery,
        "mount_type": None,
    }

    return source_id, inst, equipment if equipment else None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def ingest_csv_files(csv_keys, dry_run=False, limit=None):
    """Download and ingest CSV files."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Download
    local_files = []
    for key in csv_keys:
        url = CSV_URLS[key]
        dest = DATA_DIR / f"{key}.csv"
        download_csv(url, dest)
        local_files.append((key, dest))

    # Set up data source
    ds_name = "municipal_permits_san_diego_city"
    prefix = "sdcity"
    if not dry_run:
        data_source_id = get_data_source_id(ds_name)
        existing_ids = get_existing_source_ids(prefix)
        print(f"\n  Existing records: {len(existing_ids)}")
    else:
        data_source_id = "dry-run"
        existing_ids = set()

    # Process each file
    total_solar = 0
    total_created = 0
    total_errors = 0
    total_equipment = 0
    seen_ids = set()

    for key, filepath in local_files:
        print(f"\n{'=' * 60}")
        print(f"Processing: {key} ({filepath.name})")
        print(f"{'=' * 60}")

        installations = []
        equipment_batches = []
        skipped_dup = 0
        skipped_nonsolar = 0
        row_count = 0

        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                row_count += 1

                if limit and total_solar >= limit:
                    break

                if not is_solar_record(row):
                    skipped_nonsolar += 1
                    continue

                total_solar += 1
                source_id, inst, equip = transform_row(row, data_source_id, prefix)

                if not source_id or not inst:
                    continue

                if source_id in existing_ids or source_id in seen_ids:
                    skipped_dup += 1
                    continue

                seen_ids.add(source_id)
                installations.append(inst)
                if equip:
                    equipment_batches.append((source_id, equip))

                if total_solar % 10000 == 0:
                    print(f"  Processed {row_count} rows, {total_solar} solar, {len(installations)} new...")

        print(f"  Total rows: {row_count}")
        print(f"  Solar records: {total_solar}")
        print(f"  New records: {len(installations)}")
        print(f"  Skipped (duplicate): {skipped_dup}")
        print(f"  Skipped (non-solar): {skipped_nonsolar}")
        print(f"  With equipment: {len(equipment_batches)}")

        if dry_run:
            print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
            for inst in installations[:5]:
                print(f"    {inst['source_record_id']} | {inst.get('address', 'N/A')[:50]} | "
                      f"{inst.get('capacity_mw', 'N/A')} MW | {inst.get('installer_name', 'N/A')[:30]}")
            continue

        if not installations:
            print("  No new records to ingest.")
            continue

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
                if errors <= 500:
                    print(f"    Batch error at {i}: {err}")
            if (i + BATCH_SIZE) % 500 == 0:
                print(f"    Progress: {created} created, {errors} errors ({i + len(batch)}/{len(installations)})")

        print(f"  Created: {created}")
        print(f"  Errors: {errors}")
        total_created += created
        total_errors += errors

        # Insert equipment
        if equipment_batches and created > 0:
            print(f"\n  Inserting equipment for {len(equipment_batches)} installations...")
            eq_created = 0
            eq_errors = 0
            for source_id, equip_list in equipment_batches:
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
                    ok, err = supabase_post("solar_equipment", [eq_record])
                    if ok:
                        eq_created += 1
                    else:
                        eq_errors += 1
            print(f"  Equipment created: {eq_created}, errors: {eq_errors}")
            total_equipment += eq_created

    print(f"\n{'=' * 60}")
    print(f"Summary")
    print(f"{'=' * 60}")
    print(f"  Total solar records found: {total_solar}")
    print(f"  Total created: {total_created}")
    print(f"  Total equipment: {total_equipment}")
    print(f"  Total errors: {total_errors}")
    print(f"\nDone!")


def main():
    parser = argparse.ArgumentParser(description="San Diego City CSV permit ingestion")
    parser.add_argument("--set", type=str, default="2",
                        help="Which set to ingest: '1', '2', or 'all' (default: 2)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without ingesting")
    parser.add_argument("--limit", type=int, help="Max solar records to process")
    args = parser.parse_args()

    print("San Diego City CSV Permit Ingestion")
    print("=" * 60)

    if args.set == "all":
        csv_keys = ["set2_active", "set2_closed", "set1_active", "set1_closed"]
    elif args.set == "1":
        csv_keys = ["set1_active", "set1_closed"]
    else:
        csv_keys = ["set2_active", "set2_closed"]

    print(f"  Files: {', '.join(csv_keys)}")
    print(f"  Dry run: {args.dry_run}")
    if args.limit:
        print(f"  Limit: {args.limit}")

    ingest_csv_files(csv_keys, dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()

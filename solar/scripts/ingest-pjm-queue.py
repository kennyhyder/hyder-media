#!/usr/bin/env python3
"""
PJM Interconnection Queue Ingestion

Downloads the PJM interconnection queue via the public Planning API
(no registration needed) and ingests solar projects >= 1 MW.

Extracts Commercial Name as developer_name (26.9% coverage).
Also backfills developer_name onto existing PJM records.

Usage:
  python3 -u scripts/ingest-pjm-queue.py
  python3 -u scripts/ingest-pjm-queue.py --dry-run
"""

import os
import sys
import json
import re
import urllib.request
import urllib.parse
import time
from pathlib import Path
from io import BytesIO

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

# PJM Planning API - public key embedded in PJM's JavaScript
PJM_API_URL = "https://services.pjm.com/PJMPlanningApi/api/Queue/ExportToXls"
PJM_API_KEY = "E29477D0-70E0-4825-89B0-43F460BF9AB4"


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


def supabase_patch(table, filters, data):
    """PATCH records matching filters with data."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if filters:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in filters.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
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
    body = json.dumps({"name": name, "url": "https://www.pjm.com/planning/services-requests/interconnection-queues"}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


# ---------------------------------------------------------------------------
# PJM Queue Download
# ---------------------------------------------------------------------------

def download_pjm_queue():
    """Download PJM interconnection queue as Excel via Planning API."""
    print("Downloading PJM interconnection queue...")
    print(f"  URL: {PJM_API_URL}")

    # POST with empty body
    headers = {
        "Host": "services.pjm.com",
        "Origin": "https://www.pjm.com",
        "Referer": "https://www.pjm.com/",
        "api-subscription-key": PJM_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    }
    body = json.dumps({}).encode()
    req = urllib.request.Request(PJM_API_URL, data=body, headers=headers, method="POST")

    with urllib.request.urlopen(req, timeout=120) as resp:
        content = resp.read()
        print(f"  Downloaded {len(content):,} bytes")

    # Save locally for reference
    data_dir = Path(__file__).parent.parent / "data" / "pjm_queue"
    data_dir.mkdir(parents=True, exist_ok=True)
    xlsx_path = data_dir / "pjm_queue.xlsx"
    with open(xlsx_path, "wb") as f:
        f.write(content)
    print(f"  Saved to {xlsx_path}")

    return xlsx_path


def parse_pjm_queue(xlsx_path):
    """Parse PJM queue Excel and filter to solar >= 1 MW."""
    try:
        import openpyxl
    except ImportError:
        print("Error: openpyxl required. Install: pip3 install openpyxl")
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    ws = wb.active

    # Read headers from first row
    rows = ws.iter_rows()
    header_row = next(rows)
    headers = [str(cell.value or "").strip() for cell in header_row]
    print(f"  Columns: {headers}")

    # Parse all rows
    all_records = []
    for row in rows:
        record = {}
        for i, cell in enumerate(row):
            if i < len(headers):
                record[headers[i]] = cell.value
        all_records.append(record)

    wb.close()
    print(f"  Total rows: {len(all_records):,}")

    # Find the fuel/type column
    fuel_col = None
    for candidate in ["Fuel", "Generation Type", "Fuel Type", "Type"]:
        if candidate in headers:
            fuel_col = candidate
            break
    if not fuel_col:
        print(f"  WARNING: Could not find fuel column. Headers: {headers}")
        # Try to find any column with 'solar' in its values
        for col in headers:
            sample_vals = [str(r.get(col, "")).lower() for r in all_records[:100]]
            if any("solar" in v for v in sample_vals):
                fuel_col = col
                print(f"  Found fuel data in column: {col}")
                break
    if not fuel_col:
        print("  ERROR: Cannot identify fuel type column")
        return []

    # Find capacity column
    cap_col = None
    for candidate in ["MW Capacity", "MFO", "MW Energy", "Capacity (MW)", "Summer Capacity (MW)",
                       "MW In Service", "Nameplate (MW)", "Max Facility Output (MFO) (MW)"]:
        if candidate in headers:
            cap_col = candidate
            break
    if not cap_col:
        # Try numeric columns
        for col in headers:
            if "mw" in col.lower() or "capacity" in col.lower():
                cap_col = col
                break
    print(f"  Fuel column: {fuel_col}")
    print(f"  Capacity column: {cap_col}")

    # Status column
    status_col = None
    for candidate in ["Status", "Queue Status", "Project Status"]:
        if candidate in headers:
            status_col = candidate
            break

    # Filter to solar >= 1 MW, non-withdrawn
    solar_records = []
    for record in all_records:
        fuel = str(record.get(fuel_col, "")).strip()
        if "solar" not in fuel.lower():
            continue

        # Skip withdrawn
        if status_col:
            status = str(record.get(status_col, "")).strip().lower()
            if "withdraw" in status:
                continue

        # Capacity check
        cap = None
        if cap_col:
            try:
                cap = float(record.get(cap_col) or 0)
            except (ValueError, TypeError):
                cap = None
        if cap and cap < 1.0:
            continue

        solar_records.append(record)

    print(f"  Solar >= 1 MW (non-withdrawn): {len(solar_records):,}")

    # State breakdown
    state_col = None
    for candidate in ["State", "Location State"]:
        if candidate in headers:
            state_col = candidate
            break
    if state_col:
        from collections import Counter
        states = Counter(str(r.get(state_col, "?")).strip() for r in solar_records)
        print(f"  States: {dict(states.most_common(20))}")

    return solar_records


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
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
    # Try MM/DD/YYYY format
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


def make_installation(record, headers, data_source_id):
    """Convert PJM queue record to installation dict."""

    # Find columns dynamically
    def get(candidates, default=""):
        for c in candidates:
            if c in headers:
                val = record.get(c)
                if val is not None and str(val).strip():
                    return str(val).strip()
        return default

    project_id = get(["Project ID", "Queue Number", "Queue ID", "Queue #"])
    if not project_id:
        return None

    source_id = f"iso_pjm_{project_id}"
    name = get(["Name", "Project Name"])
    commercial_name = get(["Commercial Name"])
    state = get(["State", "Location State"])
    county = get(["County", "Location County"])
    trans_owner = get(["Transmission Owner", "TO"])

    cap = safe_float(get(["MW Capacity", "MFO", "MW Energy", "Max Facility Output (MFO) (MW)",
                           "Nameplate (MW)", "Summer Capacity (MW)"]))

    # Status mapping
    raw_status = get(["Status", "Queue Status", "Project Status"]).lower()
    if "in service" in raw_status or "operational" in raw_status:
        status = "active"
    elif "active" in raw_status or "engineering" in raw_status or "under construction" in raw_status:
        status = "proposed"
    elif "deactivated" in raw_status or "suspended" in raw_status:
        status = "canceled"
    else:
        status = "proposed"

    # Dates
    submitted = safe_date(get(["Submitted Date", "Queue Date"]))
    in_service = safe_date(get(["Actual In Service Date", "Commercial Operation Date"]))
    projected = safe_date(get(["Projected In Service Date", "Target In Service Date"]))
    install_date = in_service or projected or submitted

    site_type = "utility" if cap and cap >= 1.0 else "commercial"

    return {
        "source_record_id": source_id,
        "site_name": name if name else None,
        "site_type": site_type,
        "city": None,
        "state": state if state else None,
        "county": county.upper() if county else None,
        "capacity_dc_kw": round(cap * 1000, 1) if cap else None,
        "capacity_mw": round(cap, 3) if cap else None,
        "install_date": install_date,
        "site_status": status,
        "operator_name": trans_owner if trans_owner else None,
        "developer_name": commercial_name if commercial_name else None,
        "data_source_id": data_source_id,
        "latitude": None,
        "longitude": None,
        "address": None,
        "zip_code": None,
        "installer_name": None,
        "owner_name": None,
        "total_cost": None,
        "has_battery_storage": False,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="PJM Interconnection Queue Ingestion")
    parser.add_argument("--dry-run", action="store_true", help="Preview without ingesting")
    args = parser.parse_args()

    print("PJM Interconnection Queue Ingestion")
    print("=" * 60)

    # Download queue
    xlsx_path = download_pjm_queue()

    # Parse and filter
    records = parse_pjm_queue(xlsx_path)
    if not records:
        print("No solar records found!")
        return

    # Get headers from first record
    headers = list(records[0].keys()) if records else []

    # Get data source ID
    if not args.dry_run:
        data_source_id = get_data_source_id("pjm_queue")
    else:
        data_source_id = "dry-run"

    # Get existing source IDs
    if not args.dry_run:
        existing_ids = get_existing_source_ids("iso_pjm_")
        print(f"\n  Existing PJM records: {len(existing_ids)}")
    else:
        existing_ids = set()

    # Transform records
    installations = []
    skipped_dup = 0
    skipped_invalid = 0
    seen_ids = set()

    for record in records:
        inst = make_installation(record, headers, data_source_id)
        if not inst:
            skipped_invalid += 1
            continue
        sid = inst["source_record_id"]
        if sid in existing_ids or sid in seen_ids:
            skipped_dup += 1
            continue
        seen_ids.add(sid)
        installations.append(inst)

    print(f"\n  Transformed: {len(installations)}")
    print(f"  Skipped (duplicate): {skipped_dup}")
    print(f"  Skipped (invalid): {skipped_invalid}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
        with_dev = sum(1 for i in installations if i.get("developer_name"))
        print(f"  With developer_name: {with_dev}")
        for inst in installations[:10]:
            dev = inst.get('developer_name') or ''
            print(f"    {inst['source_record_id']} | {inst.get('state', '?')} | {inst.get('capacity_mw', '?')} MW | {inst.get('site_name', 'N/A')} | dev={dev}")
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
        if (i + BATCH_SIZE) % 200 == 0:
            print(f"    Progress: {created} created, {errors} errors")

    print(f"\n  Created: {created}")
    print(f"  Errors: {errors}")

    # Phase 2: Backfill developer_name onto existing PJM records
    print(f"\n{'=' * 60}")
    print("Phase 2: Backfill developer_name onto existing records")
    print("=" * 60)

    # Build mapping: source_record_id -> commercial_name from Excel
    dev_map = {}
    for record in records:
        def get_val(candidates):
            for c in candidates:
                if c in headers:
                    val = record.get(c)
                    if val is not None and str(val).strip():
                        return str(val).strip()
            return ""
        pid = get_val(["Project ID", "Queue Number", "Queue ID", "Queue #"])
        cname = get_val(["Commercial Name"])
        if pid and cname:
            dev_map[f"iso_pjm_{pid}"] = cname
    print(f"  Records with Commercial Name in Excel: {len(dev_map)}")

    # Find existing PJM records missing developer_name
    missing_dev = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": "like.iso_pjm_*",
            "developer_name": "is.null",
            "offset": offset,
            "limit": 1000,
        })
        if not batch:
            break
        missing_dev.extend(r["source_record_id"] for r in batch)
        offset += len(batch)
        if len(batch) < 1000:
            break
    print(f"  Existing records missing developer_name: {len(missing_dev)}")

    # Patch those that have a Commercial Name in the Excel
    patched = 0
    patch_errors = 0
    for sid in missing_dev:
        if sid in dev_map:
            ok, err = supabase_patch("solar_installations",
                {"source_record_id": f"eq.{sid}"},
                {"developer_name": dev_map[sid]})
            if ok:
                patched += 1
            else:
                patch_errors += 1
                if patch_errors <= 3:
                    print(f"    Patch error for {sid}: {err}")
            if patched % 100 == 0 and patched > 0:
                print(f"    Progress: {patched} patched")

    print(f"  Developer names backfilled: {patched}")
    print(f"  Patch errors: {patch_errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

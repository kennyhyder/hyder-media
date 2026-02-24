#!/usr/bin/env python3
"""
Ingest ISO Withdrawn/Cancelled Projects — Capture projects currently filtered out.

Re-processes ISO queue data to capture withdrawn/cancelled/suspended projects
that existing ingest scripts skip. These represent failed development attempts
and are valuable for identifying equipment that was ordered but never installed.

Covers: CAISO, NYISO, ERCOT, ISO-NE, SPP, MISO, PJM

Usage:
  python3 -u scripts/ingest-iso-withdrawn.py                    # All ISOs
  python3 -u scripts/ingest-iso-withdrawn.py --iso miso         # Single ISO
  python3 -u scripts/ingest-iso-withdrawn.py --dry-run          # Preview
"""

import os
import sys
import json
import time
import uuid
import argparse
import urllib.request
import urllib.parse
import urllib.error
import tempfile
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50
DATA_DIR = Path(__file__).parent.parent / "data" / "iso_queues"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_get(table, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def supabase_post(table, records):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        if "duplicate" not in err.lower() and "conflict" not in err.lower():
            print(f"    POST error ({e.code}): {err}")
        return False


def get_or_create_data_source(name, description="", url=""):
    params = {"name": f"eq.{name}", "select": "id"}
    existing = supabase_get("solar_data_sources", params)
    if existing:
        return existing[0]["id"]
    ds_id = str(uuid.uuid4())
    supabase_post("solar_data_sources", [{
        "id": ds_id, "name": name,
        "description": description, "url": url, "record_count": 0,
    }])
    return ds_id


def load_existing_source_ids(prefix):
    """Load all existing source_record_ids with given prefix."""
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}*",
            "limit": "1000",
            "offset": str(offset),
            "order": "source_record_id",
        })
        if not batch:
            break
        for r in batch:
            existing.add(r["source_record_id"])
        if len(batch) < 1000:
            break
        offset += len(batch)
    return existing


def safe_str(val):
    if val is None or val == "" or str(val).lower() in ("n/a", "na", "none", "nan"):
        return None
    return str(val).strip() or None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def parse_date(val):
    if not val:
        return None
    val = str(val).strip()
    if not val or val.lower() in ("n/a", "tbd", "none", ""):
        return None
    for fmt in ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S"]:
        try:
            return datetime.strptime(val.split(" ")[0].split("T")[0], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# MISO — JSON API (withdrawn projects)
# ---------------------------------------------------------------------------

def fetch_miso_withdrawn():
    """Fetch withdrawn solar projects from MISO queue API."""
    print("\n  Fetching MISO queue data...")
    url = "https://www.misoenergy.org/api/giqueue/getprojects"
    headers = {"User-Agent": "SolarTrack/1.0"}
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"  Error fetching MISO: {e}")
        return []

    records = []
    seen = set()
    for rec in data:
        fuel = str(rec.get("fuelType", "")).lower()
        if "solar" not in fuel:
            continue

        status = str(rec.get("applicationStatus", "")).lower()
        if status != "withdrawn":
            continue

        proj_num = rec.get("projectNumber")
        if not proj_num or proj_num in seen:
            continue
        seen.add(proj_num)

        cap = safe_float(rec.get("summerNetMW") or rec.get("winterNetMW") or rec.get("mpMax") or rec.get("requestedMW"))
        if cap is not None and cap < 1.0:
            continue

        state = safe_str(rec.get("state"))
        county = safe_str(rec.get("county"))

        records.append({
            "source_record_id": f"iso_miso_wd_{proj_num}",
            "site_name": safe_str(rec.get("poiName")),
            "site_type": "utility" if (cap and cap >= 1.0) else "commercial",
            "site_status": "canceled",
            "state": state,
            "county": county,
            "capacity_mw": cap,
            "operator_name": safe_str(rec.get("transmissionOwner")),
            "install_date": parse_date(rec.get("inServiceDate")),
        })

    print(f"  MISO withdrawn solar: {len(records)}")
    return records


# ---------------------------------------------------------------------------
# SPP — CSV (no withdrawn status in export, skip)
# ---------------------------------------------------------------------------

def fetch_spp_withdrawn():
    """SPP CSV has no withdrawn projects — all are active."""
    print("\n  SPP: No withdrawn projects in public export (all active)")
    return []


# ---------------------------------------------------------------------------
# PJM — Excel via Planning API
# ---------------------------------------------------------------------------

def fetch_pjm_withdrawn():
    """Fetch withdrawn solar from PJM Planning API."""
    import io
    print("\n  Fetching PJM queue data...")

    url = "https://services.pjm.com/PJMPlanningApi/api/Queue/ExportToXls"
    headers = {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": "E29477D0-70E0-4825-89B0-43F460BF9AB4",
        "User-Agent": "SolarTrack/1.0",
    }
    body = json.dumps({
        "queueId": None, "projectName": None, "state": None,
        "fuelType": "Solar", "status": "Withdrawn",
        "county": None, "transmissionOwner": None,
    }).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            excel_data = resp.read()
    except Exception as e:
        print(f"  Error fetching PJM: {e}")
        return []

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(excel_data), read_only=True)
        ws = wb.active
    except Exception as e:
        print(f"  Error reading PJM Excel: {e}")
        return []

    header = None
    records = []
    for row in ws.iter_rows(values_only=True):
        if header is None:
            header = [str(c or "").strip() for c in row]
            continue
        rec = dict(zip(header, row))

        # Must be solar + withdrawn
        fuel = str(rec.get("Fuel", "")).lower()
        if "solar" not in fuel:
            continue

        status = str(rec.get("Status", "")).lower()
        if "withdraw" not in status:
            continue

        queue_id = safe_str(rec.get("Queue Number") or rec.get("Queue ID") or rec.get("QueueId"))
        if not queue_id:
            continue

        cap = safe_float(rec.get("MFO") or rec.get("MW In Service") or rec.get("Max Facility Output (MFO)"))
        if not cap:
            cap = safe_float(rec.get("MW Energy") or rec.get("MW"))
        if cap and cap < 1.0:
            continue

        state = safe_str(rec.get("State"))
        county = safe_str(rec.get("County"))
        developer = safe_str(rec.get("Commercial Name") or rec.get("Projected In Service Date"))

        records.append({
            "source_record_id": f"iso_pjm_wd_{queue_id}",
            "site_name": safe_str(rec.get("Name") or rec.get("Project Name")),
            "site_type": "utility" if (cap and cap >= 1.0) else "commercial",
            "site_status": "canceled",
            "state": state,
            "county": county,
            "capacity_mw": cap,
            "developer_name": developer,
            "operator_name": safe_str(rec.get("Transmission Owner")),
        })

    wb.close()
    print(f"  PJM withdrawn solar: {len(records)}")
    return records


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

ISO_FETCHERS = {
    "miso": ("MISO Withdrawn Queue", fetch_miso_withdrawn),
    "spp": ("SPP Withdrawn Queue", fetch_spp_withdrawn),
    "pjm": ("PJM Withdrawn Queue", fetch_pjm_withdrawn),
}


def main():
    parser = argparse.ArgumentParser(description="Ingest withdrawn/cancelled ISO queue projects")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting")
    parser.add_argument("--iso", type=str, help="Single ISO to process (miso, spp, pjm)")
    args = parser.parse_args()

    print("ISO Withdrawn Project Ingestion")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    if args.iso:
        isos = {args.iso.lower(): ISO_FETCHERS[args.iso.lower()]}
    else:
        isos = ISO_FETCHERS

    total_created = 0
    total_skipped = 0
    total_errors = 0

    for iso_key, (description, fetcher) in isos.items():
        print(f"\n{'='*60}")
        print(f"Processing {description}")
        print(f"{'='*60}")

        # Get data source
        ds_name = f"iso_{iso_key}_withdrawn"
        ds_id = get_or_create_data_source(
            ds_name, f"Withdrawn/cancelled solar projects from {iso_key.upper()} interconnection queue"
        )

        # Load existing source IDs to avoid duplicates
        prefix = f"iso_{iso_key}_wd_"
        existing = load_existing_source_ids(prefix)
        print(f"  Existing withdrawn records: {len(existing)}")

        # Fetch new data
        records = fetcher()
        if not records:
            continue

        # Filter out existing
        new_records = [r for r in records if r["source_record_id"] not in existing]
        skipped = len(records) - len(new_records)
        total_skipped += skipped
        print(f"  New records: {len(new_records)}, Skipped duplicates: {skipped}")

        if args.dry_run:
            for r in new_records[:10]:
                cap = r.get("capacity_mw") or 0
                print(f"    {r['source_record_id']:30s} {r.get('state','??'):2s} {cap:8.1f} MW  {r.get('site_name','')[:40]}")
            total_created += len(new_records)
            continue

        if not new_records:
            continue

        # Build installation records with all required keys
        inst_batch = []
        created = 0
        errors = 0

        for r in new_records:
            inst = {
                "id": str(uuid.uuid4()),
                "source_record_id": r["source_record_id"],
                "data_source_id": ds_id,
                "site_name": r.get("site_name"),
                "site_type": r.get("site_type", "utility"),
                "site_status": "canceled",
                "state": r.get("state"),
                "county": r.get("county"),
                "city": None,
                "latitude": None,
                "longitude": None,
                "address": None,
                "zip_code": None,
                "capacity_mw": r.get("capacity_mw"),
                "mount_type": "ground_fixed",
                "owner_name": None,
                "developer_name": r.get("developer_name"),
                "operator_name": r.get("operator_name"),
                "installer_name": None,
                "install_date": r.get("install_date"),
                "total_cost": None,
                "location_precision": "state" if r.get("state") else None,
            }
            inst_batch.append(inst)

            if len(inst_batch) >= BATCH_SIZE:
                if supabase_post("solar_installations", inst_batch):
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
                inst_batch = []

        # Flush remaining
        if inst_batch:
            if supabase_post("solar_installations", inst_batch):
                created += len(inst_batch)
            else:
                errors += len(inst_batch)

        print(f"  Created: {created}, Errors: {errors}")
        total_created += created
        total_errors += errors

    print(f"\n{'='*60}")
    print("Summary")
    print(f"{'='*60}")
    print(f"  Total created: {total_created}")
    print(f"  Total skipped (duplicates): {total_skipped}")
    print(f"  Total errors: {total_errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

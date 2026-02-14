#!/usr/bin/env python3
"""
Pennsylvania AEPS Qualified Facilities Ingestion

Downloads and ingests PA Alternative Energy Portfolio Standards qualified
solar facilities into solar_installations table.

Source: https://portal.pennaeps.com/app/publiccontroller/download_QFs/

Usage:
  python3 -u scripts/ingest-pa-aeps.py              # Full ingestion
  python3 -u scripts/ingest-pa-aeps.py --dry-run     # Count without ingesting
"""

import os
import sys
import json
import csv
import uuid
import argparse
import urllib.request
import urllib.parse
import time
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

BATCH_SIZE = 50
DATA_FILE = Path(__file__).parent.parent / "data" / "pa_aeps" / "pa_aeps_qualified_facilities.csv"
DATA_SOURCE_NAME = "pa_aeps"


def supabase_get(table, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


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
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        print(f"  POST error ({e.code}): {err}")
        return False


def get_data_source_id(name):
    rows = supabase_get("solar_data_sources", {
        "select": "id",
        "name": f"eq.{name}",
    })
    if rows:
        return rows[0]["id"]
    supabase_post("solar_data_sources", [{
        "id": str(uuid.uuid4()),
        "name": name,
        "url": "https://portal.pennaeps.com/",
        "description": "Pennsylvania AEPS qualified alternative energy facilities",
    }])
    rows = supabase_get("solar_data_sources", {
        "select": "id",
        "name": f"eq.{name}",
    })
    return rows[0]["id"] if rows else None


def get_existing_source_ids(prefix):
    existing = set()
    offset = 0
    while True:
        rows = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}*",
            "limit": "1000",
            "offset": str(offset),
            "order": "source_record_id",
        })
        if not rows:
            break
        for r in rows:
            existing.add(r["source_record_id"])
        if len(rows) < 1000:
            break
        offset += 1000
    return existing


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        if f != f:
            return None
        return f
    except (ValueError, TypeError):
        return None


def main():
    parser = argparse.ArgumentParser(description="Ingest PA AEPS qualified facilities")
    parser.add_argument("--dry-run", action="store_true", help="Count without ingesting")
    args = parser.parse_args()

    print("Pennsylvania AEPS Qualified Facilities Ingestion")
    print("=" * 60)

    if not DATA_FILE.exists():
        print(f"Error: Data file not found: {DATA_FILE}")
        print("Download from: https://portal.pennaeps.com/app/publiccontroller/download_QFs/")
        sys.exit(1)

    print(f"  Loading: {DATA_FILE}")

    # CSV has 2 header note lines, then actual headers on line 3
    records = []
    skipped_fuel = 0
    skipped_small = 0

    with open(DATA_FILE, "r", encoding="utf-8-sig") as f:
        # Skip first 2 note lines
        next(f)
        next(f)
        reader = csv.DictReader(f)
        print(f"  Columns: {reader.fieldnames}")

        for row in reader:
            fuel = row.get("Fuel Types at Facility", "").strip()
            if fuel != "SUN":
                skipped_fuel += 1
                continue

            capacity_dc = safe_float(row.get("Total NPC MW DC"))
            capacity_ac = safe_float(row.get("Total NPC MW AC"))
            capacity_mw = capacity_dc or capacity_ac
            if not capacity_mw:
                continue
            capacity_kw = capacity_mw * 1000

            if capacity_kw < 25:
                skipped_small += 1
                continue

            cert_num = row.get("PA Certification #", "").strip()
            if not cert_num:
                continue

            facility_name = row.get("Facility Name", "").strip()
            county = row.get("County", "").strip()
            state = row.get("State", "").strip()
            zip_code = row.get("Zip", "").strip()
            cert_date = row.get("Certification Start Date", "").strip()
            utility = row.get("Interconnecting Utility", "").strip()

            # Clean zip
            if zip_code:
                zip_code = zip_code.split("-")[0].strip()

            # Determine site type
            site_type = "commercial"
            if capacity_mw >= 1:
                site_type = "utility"

            # Use cert number for source_record_id (globally unique)
            source_id = f"paaeps_{cert_num.replace(' ', '_')}"

            record = {
                "source_record_id": source_id,
                "site_name": facility_name if facility_name else None,
                "site_type": site_type,
                "address": None,
                "city": None,
                "state": state if state else "PA",
                "zip_code": zip_code if zip_code and len(zip_code) >= 5 else None,
                "county": county.upper() if county else None,
                "latitude": None,
                "longitude": None,
                "capacity_dc_kw": capacity_kw,
                "capacity_mw": round(capacity_mw, 3),
                "install_date": cert_date if cert_date else None,
                "site_status": "active",
                "installer_name": None,
                "owner_name": None,
                "developer_name": None,
                "operator_name": utility if utility and "other" not in utility.lower() else None,
                "total_cost": None,
                "data_source_id": None,
                "has_battery_storage": False,
            }
            records.append(record)

    print(f"\n  Solar records >= 25 kW: {len(records)}")
    print(f"  Skipped (non-solar): {skipped_fuel}")
    print(f"  Skipped (< 25 kW): {skipped_small}")

    # State breakdown
    states = {}
    for r in records:
        s = r.get("state") or "?"
        states[s] = states.get(s, 0) + 1
    print(f"\n  State breakdown:")
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
        print(f"    {s}: {c}")

    # Utility breakdown
    utilities = {}
    for r in records:
        u = r.get("operator_name") or "Unknown"
        utilities[u] = utilities.get(u, 0) + 1
    print(f"\n  Top utilities:")
    for u, c in sorted(utilities.items(), key=lambda x: -x[1])[:10]:
        print(f"    {u}: {c}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No records created.")
        return

    # Get data source ID
    data_source_id = get_data_source_id(DATA_SOURCE_NAME)
    for r in records:
        r["data_source_id"] = data_source_id

    # Check existing
    existing = get_existing_source_ids("paaeps_")
    print(f"\n  Existing records: {len(existing)}")
    new_records = [r for r in records if r["source_record_id"] not in existing]
    print(f"  New records to create: {len(new_records)}")

    if not new_records:
        print("  All records already exist!")
        return

    # Insert
    created = 0
    errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        ok = supabase_post("solar_installations", batch)
        if ok:
            created += len(batch)
        else:
            errors += len(batch)
        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  Progress: {created + errors}/{len(new_records)}")

    print(f"\n  Created: {created}")
    print(f"  Errors: {errors}")
    print("Done!")


if __name__ == "__main__":
    main()

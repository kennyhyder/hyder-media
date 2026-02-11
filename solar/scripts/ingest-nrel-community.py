#!/usr/bin/env python3
"""
NREL Community Solar Project Database Ingestion

Ingests community solar projects from NREL's "Sharing the Sun" dataset.
4,003 projects with developer names, utility, capacity, and location.

Data source: https://data.nrel.gov/submissions/244
File: data/nrel_community_solar/community_solar_2025.xlsx

Usage:
  python3 -u scripts/ingest-nrel-community.py              # Full ingestion
  python3 -u scripts/ingest-nrel-community.py --dry-run     # Report without ingesting
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

try:
    import openpyxl
except ImportError:
    print("Error: openpyxl required. Install with: pip3 install openpyxl")
    sys.exit(1)

# Load env
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

BATCH_SIZE = 50
DATA_FILE = Path(__file__).parent.parent / "data" / "nrel_community_solar" / "community_solar_2025.xlsx"


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


def supabase_post_batch(table, records):
    """POST batch, handle duplicates by inserting one by one."""
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
        urllib.request.urlopen(req)
        return len(records), 0
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        if "duplicate" in err.lower() or "unique" in err.lower():
            created = 0
            errors = 0
            for rec in records:
                try:
                    body = json.dumps([rec]).encode()
                    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                    urllib.request.urlopen(req)
                    created += 1
                except urllib.error.HTTPError:
                    errors += 1
            return created, errors
        print(f"  POST error ({e.code}): {err}")
        return 0, len(records)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_float(val):
    if val is None or val == "" or val == "-" or str(val).strip().lower() in ("unknown", "n/a"):
        return None
    try:
        v = float(val)
        if v <= 0:
            return None
        return v
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None or str(val).strip() in ("", "-", "N/A", "Unknown", "unknown"):
        return None
    return str(val).strip()


def parse_year(val):
    if not val:
        return None
    s = str(val).strip()
    m = re.match(r'(\d{4})', s)
    if m:
        year = int(m.group(1))
        if 2000 <= year <= 2030:
            return f"{year}-01-01"
    return None


def main():
    parser = argparse.ArgumentParser(description="Ingest NREL Community Solar projects")
    parser.add_argument("--dry-run", action="store_true", help="Report without ingesting")
    args = parser.parse_args()

    print("NREL Community Solar Project Ingestion")
    print("=" * 60)

    if not DATA_FILE.exists():
        print(f"Error: Data file not found at {DATA_FILE}")
        print("Download from: https://data.nrel.gov/submissions/244")
        sys.exit(1)

    # Read Excel — use data_only=True to get computed values from formulas
    print(f"Reading {DATA_FILE.name}...")
    wb = openpyxl.load_workbook(DATA_FILE, read_only=True, data_only=True)
    ws = wb["Project List"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    headers = rows[0]
    data_rows = rows[1:]
    print(f"  Total projects: {len(data_rows)}")

    # Header index mapping
    # Col 0: Utility ID, 1: Project Name, 2: City, 3: State, 4: Utility
    # Col 8: Developer/Contractor, 9: MW-AC, 10: kW-AC, 11: MW-DC, 12: kW-DC
    # Col 13: Year of Interconnection, 22: Aggregated

    # Get or create data source
    print("\nChecking data source...")
    ds = supabase_get("solar_data_sources", {"name": "eq.nrel_community_solar"})
    if ds:
        data_source_id = ds[0]["id"]
        print(f"  Found existing: {data_source_id}")
    elif not args.dry_run:
        url = f"{SUPABASE_URL}/rest/v1/solar_data_sources"
        h = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        body = json.dumps({
            "name": "nrel_community_solar",
            "description": "NREL Sharing the Sun Community Solar Project Database (June 2025)",
            "url": "https://data.nrel.gov/submissions/244",
        }).encode()
        req = urllib.request.Request(url, data=body, headers=h, method="POST")
        try:
            resp = urllib.request.urlopen(req)
            result = json.loads(resp.read().decode())
            data_source_id = result[0]["id"] if isinstance(result, list) else result["id"]
            print(f"  Created: {data_source_id}")
        except urllib.error.HTTPError as e:
            print(f"  Error creating data source: {e.read().decode()[:200]}")
            data_source_id = None
    else:
        data_source_id = "DRY_RUN"

    # Check existing records
    if not args.dry_run:
        existing = set()
        offset = 0
        while True:
            batch = supabase_get("solar_installations", {
                "select": "source_record_id",
                "source_record_id": "like.nrel_cs_*",
                "limit": 1000,
                "offset": offset,
            })
            if not batch:
                break
            for r in batch:
                existing.add(r["source_record_id"])
            if len(batch) < 1000:
                break
            offset += 1000
        print(f"  Existing records: {len(existing)}")
    else:
        existing = set()

    # Build installation records
    installations = []
    skipped_aggregated = 0
    skipped_no_state = 0
    skipped_existing = 0

    for i, row in enumerate(data_rows):
        state = safe_str(row[3])
        if not state:
            skipped_no_state += 1
            continue

        # Skip aggregated entries (roll-ups, not individual projects)
        aggregated = safe_str(row[22])
        if aggregated and aggregated.lower() == "yes":
            skipped_aggregated += 1
            continue

        project_name = safe_str(row[1])
        utility_id = safe_str(row[0])

        # Build source_record_id
        name_slug = re.sub(r'[^a-z0-9]', '_', (project_name or f"row_{i}").lower())[:40]
        source_id = f"nrel_cs_{state}_{name_slug}"

        if source_id in existing:
            skipped_existing += 1
            continue

        # Capacity — prefer DC, fallback to AC
        cap_dc_kw = safe_float(row[12])  # kW-DC
        cap_ac_kw = safe_float(row[10])  # kW-AC
        cap_mw = safe_float(row[11]) or safe_float(row[9])  # MW-DC or MW-AC
        capacity_kw = cap_dc_kw or cap_ac_kw
        if not cap_mw and capacity_kw:
            cap_mw = round(capacity_kw / 1000, 3)

        developer = safe_str(row[8])
        utility = safe_str(row[4])
        city = safe_str(row[2])
        year = parse_year(row[13])

        record = {
            "source_record_id": source_id,
            "site_name": project_name,
            "site_type": "community",
            "city": city,
            "state": state,
            "capacity_mw": cap_mw,
            "capacity_dc_kw": capacity_kw,
            "install_date": year,
            "site_status": "active",
            "developer_name": developer,
            "operator_name": utility,
            "data_source_id": data_source_id,
        }

        installations.append(record)

    print(f"\n  New records to ingest: {len(installations)}")
    print(f"  Skipped aggregated: {skipped_aggregated}")
    print(f"  Skipped no state: {skipped_no_state}")
    print(f"  Skipped existing: {skipped_existing}")

    # Stats
    if installations:
        from collections import Counter
        states = Counter(r["state"] for r in installations)
        with_dev = sum(1 for r in installations if r["developer_name"])
        with_cap = sum(1 for r in installations if r["capacity_mw"])
        with_utility = sum(1 for r in installations if r["operator_name"])

        print(f"\n  With developer: {with_dev} ({with_dev/len(installations)*100:.0f}%)")
        print(f"  With capacity: {with_cap} ({with_cap/len(installations)*100:.0f}%)")
        print(f"  With utility: {with_utility} ({with_utility/len(installations)*100:.0f}%)")
        print(f"  Top states: {states.most_common(10)}")

        print(f"\n  Sample records:")
        for r in installations[:5]:
            print(f"    {r['source_record_id']}: {r['site_name']} ({r['state']}) "
                  f"- {r['capacity_mw']} MW, dev={r['developer_name']}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would create {len(installations)} records")
        return

    # Insert
    total_created = 0
    total_errors = 0

    for i in range(0, len(installations), BATCH_SIZE):
        batch = installations[i:i + BATCH_SIZE]
        created, errors = supabase_post_batch("solar_installations", batch)
        total_created += created
        total_errors += errors
        if (i + BATCH_SIZE) % 200 == 0 or i + BATCH_SIZE >= len(installations):
            print(f"  Progress: {min(i + BATCH_SIZE, len(installations))}/{len(installations)} "
                  f"(created: {total_created}, errors: {total_errors})")

    print(f"\n{'=' * 60}")
    print("NREL Community Solar Ingestion Summary")
    print(f"{'=' * 60}")
    print(f"  Total projects: {len(data_rows)}")
    print(f"  Created: {total_created}")
    print(f"  Errors: {total_errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

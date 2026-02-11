#!/usr/bin/env python3
"""
EPA RE-Powering America's Land Tracking Matrix Ingestion

Ingests solar projects from the EPA RE-Powering initiative, which tracks
renewable energy installations on contaminated lands, landfills, mine sites,
and brownfields. All 549 solar records have owner, developer, and capacity.

Data source: https://www.epa.gov/re-powering/re-powering-tracking-matrix
File: data/epa_repowering/repowering_tracking_matrix.xlsx

Usage:
  python3 -u scripts/ingest-epa-repowering.py              # Full ingestion
  python3 -u scripts/ingest-epa-repowering.py --dry-run     # Report without ingesting
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
DATA_FILE = Path(__file__).parent.parent / "data" / "epa_repowering" / "repowering_tracking_matrix.xlsx"
HEADER_ROW = 8  # 0-indexed row where headers are


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
    """POST batch, ignoring duplicates via pre-check."""
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
            # Insert one by one to skip duplicates
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
# Data parsing
# ---------------------------------------------------------------------------

def safe_float(val):
    if val is None or val == "" or val == "-":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None or str(val).strip() in ("", "-", "N/A"):
        return None
    return str(val).strip()


def parse_year(val):
    """Parse completion year to install_date."""
    if not val:
        return None
    s = str(val).strip()
    # Handle "2017", "2017/2018", "2020 (Phase 1)"
    m = re.match(r'(\d{4})', s)
    if m:
        return f"{m.group(1)}-01-01"
    return None


def classify_site_type(capacity_mw):
    """Classify as utility or commercial based on capacity."""
    if capacity_mw and capacity_mw >= 1.0:
        return "utility"
    return "commercial"


def main():
    parser = argparse.ArgumentParser(description="Ingest EPA RE-Powering solar projects")
    parser.add_argument("--dry-run", action="store_true", help="Report without ingesting")
    args = parser.parse_args()

    print("EPA RE-Powering Solar Project Ingestion")
    print("=" * 60)

    if not DATA_FILE.exists():
        print(f"Error: Data file not found at {DATA_FILE}")
        print("Download from: https://www.epa.gov/re-powering/re-powering-tracking-matrix")
        sys.exit(1)

    # Read Excel
    print(f"Reading {DATA_FILE.name}...")
    wb = openpyxl.load_workbook(DATA_FILE, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    headers = rows[HEADER_ROW]
    print(f"  Headers: {[str(h)[:30] for h in headers]}")
    data_rows = rows[HEADER_ROW + 1:]
    print(f"  Total rows: {len(data_rows)}")

    # Filter solar PV
    solar_rows = []
    for row in data_rows:
        re_type = safe_str(row[9])
        if re_type and "Solar" in re_type:
            solar_rows.append(row)
    print(f"  Solar PV projects: {len(solar_rows)}")

    # Get or create data source
    print("\nChecking data source...")
    ds = supabase_get("solar_data_sources", {"name": "eq.epa_repowering"})
    if ds:
        data_source_id = ds[0]["id"]
        print(f"  Found existing: {data_source_id}")
    elif not args.dry_run:
        result = supabase_get("solar_data_sources", {"select": "id", "order": "id", "limit": 1})
        # Create data source
        url = f"{SUPABASE_URL}/rest/v1/solar_data_sources"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        body = json.dumps({
            "name": "epa_repowering",
            "description": "EPA RE-Powering America's Land Initiative - Solar projects on contaminated lands, landfills, brownfields",
            "url": "https://www.epa.gov/re-powering/re-powering-tracking-matrix",
        }).encode()
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
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
                "source_record_id": "like.epa_repower_*",
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
    skipped_existing = 0
    for row in solar_rows:
        site_name = safe_str(row[0])
        state = safe_str(row[2])
        city = safe_str(row[3])
        site_owner = safe_str(row[5])
        capacity_mw = safe_float(row[10])
        developer = safe_str(row[12])
        completion = safe_str(row[13])

        # Build source_record_id from name + state (no unique ID in source)
        name_slug = re.sub(r'[^a-z0-9]', '_', (site_name or "unknown").lower())[:50]
        source_id = f"epa_repower_{state}_{name_slug}"

        if source_id in existing:
            skipped_existing += 1
            continue

        site_type_str = safe_str(row[4])  # Superfund, Landfill, Brownfield, etc.

        record = {
            "source_record_id": source_id,
            "site_name": site_name,
            "site_type": classify_site_type(capacity_mw),
            "city": city,
            "state": state,
            "capacity_mw": capacity_mw,
            "capacity_dc_kw": round(capacity_mw * 1000, 1) if capacity_mw else None,
            "install_date": parse_year(completion),
            "site_status": "active",
            "owner_name": site_owner,
            "developer_name": developer,
            "data_source_id": data_source_id,
        }

        installations.append(record)

    print(f"\n  New records to ingest: {len(installations)}")
    print(f"  Skipped (already exist): {skipped_existing}")

    # Show sample
    if installations:
        print(f"\n  Sample records:")
        for r in installations[:5]:
            print(f"    {r['source_record_id']}: {r['site_name']} ({r['state']}) "
                  f"- {r['capacity_mw']} MW, owner={r['owner_name']}, dev={r['developer_name']}")

    if args.dry_run:
        # Show stats
        from collections import Counter
        states = Counter(r["state"] for r in installations)
        with_owner = sum(1 for r in installations if r["owner_name"])
        with_dev = sum(1 for r in installations if r["developer_name"])
        print(f"\n  With owner: {with_owner} ({with_owner/len(installations)*100:.0f}%)")
        print(f"  With developer: {with_dev} ({with_dev/len(installations)*100:.0f}%)")
        print(f"  Top states: {states.most_common(10)}")
        print(f"\n  [DRY RUN] Would create {len(installations)} records")
        return

    # Insert in batches
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
    print("EPA RE-Powering Ingestion Summary")
    print(f"{'=' * 60}")
    print(f"  Solar projects found: {len(solar_rows)}")
    print(f"  Already existed: {skipped_existing}")
    print(f"  Created: {total_created}")
    print(f"  Errors: {total_errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

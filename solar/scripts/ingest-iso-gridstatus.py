#!/usr/bin/env python3
"""
ISO Interconnection Queue Ingestion via gridstatus Library

Uses the gridstatus Python library to fetch interconnection queue data from
ISOs that don't have direct Excel download URLs. Complements ingest-iso-queues.py
which handles CAISO and NYISO via direct Excel download.

New ISOs covered:
  - ERCOT (Texas) - 634 solar projects, ALL have developer names
  - ISO-NE (New England) - 91 solar projects >= 1 MW

Also refreshes CAISO + NYISO data for any new entries.

IMPORTANT: Requires Python 3.10+ and the gridstatus library.
Run with: .venv/bin/python3.13 scripts/ingest-iso-gridstatus.py

Usage:
  .venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py               # All available ISOs
  .venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py --iso ercot    # ERCOT only
  .venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py --dry-run      # Report without ingesting
"""

import os
import sys
import json
import uuid
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

import gridstatus
import pandas as pd
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
MIN_CAPACITY_MW = 1  # Utility-scale threshold

# ISO configurations for gridstatus
ISO_CONFIGS = {
    "ercot": {
        "label": "ERCOT (Texas)",
        "class": gridstatus.Ercot,
        "default_state": "TX",
        "solar_patterns": ["Solar", "SUN", "PV", "Photovoltaic", "PVGRN"],
    },
    "isone": {
        "label": "ISO-NE (New England)",
        "class": gridstatus.ISONE,
        "default_state": None,  # Has State column
        "solar_patterns": ["Solar", "SUN", "PV", "Photovoltaic"],
    },
    "caiso": {
        "label": "CAISO (California)",
        "class": gridstatus.CAISO,
        "default_state": None,  # Has State column
        "solar_patterns": ["Solar", "PV", "Photovoltaic"],
    },
    "nyiso": {
        "label": "NYISO (New York)",
        "class": gridstatus.NYISO,
        "default_state": "NY",
        "solar_patterns": ["Solar", "S", "ES", "PS", "PV", "Photovoltaic"],
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_request(method, table, data=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }

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
    params = {"name": "eq.iso_queues", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "iso_queues",
        "description": "ISO Interconnection Queues - Developer/owner data for proposed and active solar projects",
        "url": "https://opensource.gridstatus.io/en/stable/interconnection_queues.html",
        "record_count": 0,
    })
    return ds_id


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def safe_str(val):
    if val is None or pd.isna(val):
        return None
    s = str(val).strip()
    if not s or s.lower() in ("n/a", "nan", "none", "na", ""):
        return None
    return s


def safe_float(val):
    if val is None or pd.isna(val):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def parse_date(val):
    if val is None or pd.isna(val):
        return None
    if isinstance(val, pd.Timestamp):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s or s.lower() in ("n/a", "tbd", "none", "nat"):
        return None
    for fmt in ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S"]:
        try:
            return datetime.strptime(s.split(" ")[0], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def is_solar(gen_type, patterns):
    if not gen_type or pd.isna(gen_type):
        return False
    gt = str(gen_type).lower()
    for p in patterns:
        if p.lower() in gt:
            return True
    return False


def map_status(status_str):
    if not status_str:
        return "proposed"
    s = str(status_str).lower()
    if any(kw in s for kw in ["in service", "operational", "commercial", "completed", "active"]):
        return "active"
    if any(kw in s for kw in ["construction", "building", "engineering"]):
        return "under_construction"
    return "proposed"


# ---------------------------------------------------------------------------
# Process a single ISO
# ---------------------------------------------------------------------------

def process_iso(iso_name, config, data_source_id, dry_run=False):
    label = config["label"]
    print(f"\n{'=' * 60}")
    print(f"Processing {label} via gridstatus")
    print(f"{'=' * 60}")

    # Fetch queue data
    print(f"  Fetching interconnection queue...")
    try:
        iso = config["class"]()
        df = iso.get_interconnection_queue()
    except Exception as e:
        print(f"  ERROR fetching {label}: {e}")
        return {"created": 0, "skipped": 0, "errors": 1, "solar_total": 0}

    print(f"  Total records: {len(df)}")
    print(f"  Columns: {list(df.columns)[:10]}...")

    # Filter to solar
    solar_mask = df["Generation Type"].apply(lambda x: is_solar(x, config["solar_patterns"]))
    solar_df = df[solar_mask].copy()
    print(f"  Solar projects: {len(solar_df)}")

    # Filter: skip withdrawn/cancelled
    if "Status" in solar_df.columns:
        status_mask = ~solar_df["Status"].fillna("").str.lower().str.contains("withdraw|cancel")
        solar_df = solar_df[status_mask]
        print(f"  After removing withdrawn/cancelled: {len(solar_df)}")

    # Filter: >= MIN_CAPACITY_MW
    if "Capacity (MW)" in solar_df.columns:
        cap_mask = solar_df["Capacity (MW)"].fillna(0) >= MIN_CAPACITY_MW
        solar_df = solar_df[cap_mask]
        print(f"  After capacity filter (>= {MIN_CAPACITY_MW} MW): {len(solar_df)}")

    solar_total = len(solar_df)
    if solar_total == 0:
        print(f"  No matching solar projects found.")
        return {"created": 0, "skipped": 0, "errors": 0, "solar_total": 0}

    # Check developer name coverage
    if "Interconnecting Entity" in solar_df.columns:
        has_dev = solar_df["Interconnecting Entity"].notna().sum()
        print(f"  With developer name: {has_dev} ({100*has_dev/solar_total:.0f}%)")

    # Build installation records
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0

    for _, row in solar_df.iterrows():
        queue_id = safe_str(row.get("Queue ID"))
        if not queue_id:
            skipped += 1
            continue

        queue_id_clean = str(queue_id).strip().replace(" ", "_").replace("/", "-")
        source_record_id = f"iso_{iso_name}_{queue_id_clean}"

        project_name = safe_str(row.get("Project Name"))
        if not project_name:
            project_name = f"{iso_name.upper()} Queue {queue_id}"

        developer_name = safe_str(row.get("Interconnecting Entity"))

        state = safe_str(row.get("State"))
        if not state and config["default_state"]:
            state = config["default_state"]
        if state:
            # Normalize state - some ISOs return full name
            state_map = {"Texas": "TX", "New York": "NY", "California": "CA"}
            state = state_map.get(state, state)
            if len(state) > 2:
                state = state[:2].upper()
            else:
                state = state.upper()

        county = safe_str(row.get("County"))
        capacity_mw = safe_float(row.get("Capacity (MW)"))
        if not capacity_mw:
            skipped += 1
            continue

        queue_date = parse_date(row.get("Queue Date"))
        proposed_cod = parse_date(row.get("Proposed Completion Date"))
        actual_cod = parse_date(row.get("Actual Completion Date"))

        status_str = safe_str(row.get("Status"))
        site_status = map_status(status_str)

        poi = safe_str(row.get("Interconnection Location"))

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": project_name[:255] if project_name else None,
            "state": state,
            "county": county,
            "capacity_mw": round(capacity_mw, 3),
            "capacity_dc_kw": round(capacity_mw * 1000, 3),
            "site_type": "utility",
            "site_status": site_status,
            "developer_name": developer_name[:255] if developer_name else None,
            "install_date": actual_cod or proposed_cod,
            "interconnection_date": actual_cod,
            "address": poi[:255] if poi else None,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            if dry_run:
                created += len(inst_batch)
            else:
                res = supabase_request("POST", "solar_installations", inst_batch)
                if res is not None:
                    created += len(inst_batch)
                else:
                    errors += len(inst_batch)
            inst_batch = []

            if (created + errors) % 200 == 0:
                print(f"    Progress: {created} created, {errors} errors, {skipped} skipped")

    # Flush remaining
    if inst_batch:
        if dry_run:
            created += len(inst_batch)
        else:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)

    print(f"\n  Results:")
    print(f"    Solar found: {solar_total}")
    print(f"    Created: {created}")
    print(f"    Skipped: {skipped}")
    print(f"    Errors: {errors}")

    if dry_run and solar_total > 0:
        print(f"\n  [DRY RUN] Sample records:")
        for _, row in solar_df.head(5).iterrows():
            dev = safe_str(row.get("Interconnecting Entity")) or "N/A"
            print(f"    {row.get('Queue ID')}: {row.get('Project Name', 'N/A')} | "
                  f"{row.get('Capacity (MW)', 0):.1f} MW | "
                  f"{row.get('County', 'N/A')}, {row.get('State', 'N/A')} | "
                  f"Dev: {dev}")

    return {"created": created, "skipped": skipped, "errors": errors, "solar_total": solar_total}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ingest ISO queues via gridstatus library")
    parser.add_argument("--iso", nargs="+", choices=list(ISO_CONFIGS.keys()),
                        default=list(ISO_CONFIGS.keys()),
                        help="ISOs to process")
    parser.add_argument("--dry-run", action="store_true", help="Report without ingesting")
    args = parser.parse_args()

    print("ISO Interconnection Queue Ingestion (gridstatus)")
    print("=" * 60)
    print(f"ISOs to process: {', '.join(args.iso)}")
    print(f"Minimum capacity: {MIN_CAPACITY_MW} MW")
    print(f"Dry run: {args.dry_run}")

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    results = {}
    for iso_name in args.iso:
        config = ISO_CONFIGS[iso_name]
        try:
            stats = process_iso(iso_name, config, data_source_id, args.dry_run)
        except Exception as e:
            print(f"\n  FATAL ERROR processing {iso_name}: {e}")
            stats = {"created": 0, "skipped": 0, "errors": 1, "solar_total": 0}
        results[iso_name] = stats

    # Summary
    print(f"\n{'=' * 60}")
    print("gridstatus ISO Queue Summary")
    print(f"{'=' * 60}")
    print(f"{'ISO':<10} {'Solar':>8} {'Created':>10} {'Skipped':>10} {'Errors':>8}")
    print("-" * 46)
    for iso_name, stats in results.items():
        print(f"{iso_name:<10} {stats['solar_total']:>8} {stats['created']:>10} "
              f"{stats['skipped']:>10} {stats['errors']:>8}")
    print("-" * 46)
    total_created = sum(r["created"] for r in results.values())
    total_solar = sum(r["solar_total"] for r in results.values())
    total_skipped = sum(r["skipped"] for r in results.values())
    total_errors = sum(r["errors"] for r in results.values())
    print(f"{'TOTAL':<10} {total_solar:>8} {total_created:>10} "
          f"{total_skipped:>10} {total_errors:>8}")

    if not args.dry_run and total_created > 0:
        # Update record count (additive to existing)
        existing = supabase_request("GET", "solar_data_sources",
                                    params={"name": "eq.iso_queues", "select": "record_count"})
        old_count = existing[0]["record_count"] if existing else 0
        supabase_request("PATCH", "solar_data_sources",
                         {"record_count": old_count + total_created,
                          "last_import": datetime.now().isoformat()},
                         params={"name": "eq.iso_queues"})

    print(f"\nDone!")


if __name__ == "__main__":
    main()

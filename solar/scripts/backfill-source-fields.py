#!/usr/bin/env python3
"""
Backfill Missing Fields from Source Data

Re-reads original source CSV/Parquet files to extract fields that were not
ingested during the initial import, then PATCHes existing database records.

Currently handles:
- CA DGStats: Third Party Name -> owner_name (~2.5K commercial records)
- NY-Sun: Street Address -> address (~200 records)
- TTS: utility_service_territory -> operator_name (~45K records)

Usage:
  python3 -u scripts/backfill-source-fields.py              # Full run
  python3 -u scripts/backfill-source-fields.py --dry-run     # Report without patching
  python3 -u scripts/backfill-source-fields.py --source cadg  # CA DGStats only
  python3 -u scripts/backfill-source-fields.py --source nysun # NY-Sun only
  python3 -u scripts/backfill-source-fields.py --source tts   # TTS only
"""

import os
import sys
import json
import csv
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BASE_DIR = Path(__file__).parent.parent
WORKERS = 20


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


def supabase_patch(table, data, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
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
            return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
        return False


def _do_patch(args):
    inst_id, patch = args
    return supabase_patch(
        "solar_installations",
        patch,
        {"id": f"eq.{inst_id}"},
    )


def load_installations(prefix, fields):
    """Load installations with a given source_record_id prefix."""
    print(f"  Loading {prefix}* installations...")
    all_records = []
    offset = 0
    limit = 1000

    select = f"id,source_record_id,{','.join(fields)}"
    while True:
        params = {
            "select": select,
            "source_record_id": f"like.{prefix}*",
            "limit": str(limit),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < limit:
            break
        offset += limit

    print(f"  Loaded {len(all_records)} {prefix}* records")
    return all_records


# ---------------------------------------------------------------------------
# CA DGStats: Third Party Name -> owner_name
# ---------------------------------------------------------------------------

def backfill_cadg(dry_run=False):
    print(f"\n{'='*60}")
    print("CA DGStats: Third Party Name -> owner_name")
    print(f"{'='*60}")

    data_dir = BASE_DIR / "data" / "ca_dgstats"
    csv_files = sorted(data_dir.glob("*.csv"))
    if not csv_files:
        print("  No CSV files found in data/ca_dgstats/")
        return 0

    # Read all Third Party Name values from source CSVs
    tp_map = {}  # source_record_id -> {owner_name, tp_type}
    total_rows = 0
    tp_found = 0

    for csv_file in csv_files:
        print(f"  Reading {csv_file.name}...")
        with open(csv_file, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                total_rows += 1
                app_id = (row.get("Application Id") or "").strip()
                if not app_id:
                    continue

                tp_name = (row.get("Third Party Name") or "").strip()
                if not tp_name:
                    continue

                source_record_id = f"cadg_{app_id}"
                tp_type = (row.get("Third Party Owned Type") or "").strip()

                tp_map[source_record_id] = {
                    "owner_name": tp_name[:255],
                    "tp_type": tp_type,
                }
                tp_found += 1

    print(f"  CSV rows read: {total_rows}")
    print(f"  With Third Party Name: {tp_found}")
    print(f"  Unique source_record_ids: {len(tp_map)}")

    # Load existing CADG installations that are missing owner_name
    installations = load_installations("cadg_", ["owner_name"])

    # Build patches
    patches = []
    already_has = 0
    no_match = 0

    by_src = {inst["source_record_id"]: inst for inst in installations}

    for src_id, tp_data in tp_map.items():
        inst = by_src.get(src_id)
        if not inst:
            no_match += 1
            continue
        if inst.get("owner_name"):
            already_has += 1
            continue

        patches.append((inst["id"], {"owner_name": tp_data["owner_name"]}))

    print(f"\n  Matched to DB: {len(patches) + already_has}")
    print(f"  Already has owner_name: {already_has}")
    print(f"  Not in DB (residential/small): {no_match}")
    print(f"  Patches to apply: {len(patches)}")

    # Top companies
    from collections import Counter
    companies = Counter(p["owner_name"] for _, p in patches)
    print(f"\n  Top Third Party companies:")
    for name, count in companies.most_common(10):
        print(f"    {name}: {count}")

    if dry_run:
        print("\n  [DRY RUN] No patches applied.")
        return len(patches)

    if not patches:
        print("  No patches to apply.")
        return 0

    # Apply patches
    print(f"\n  Applying {len(patches)} patches ({WORKERS} workers)...")
    applied = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 500 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}")
    print(f"  Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# NY-Sun: Street Address -> address, Purchase Type
# ---------------------------------------------------------------------------

def backfill_nysun(dry_run=False):
    print(f"\n{'='*60}")
    print("NY-Sun: Street Address -> address")
    print(f"{'='*60}")

    csv_file = BASE_DIR / "data" / "ny_sun" / "ny_sun_projects.csv"
    if not csv_file.exists():
        print(f"  File not found: {csv_file}")
        return 0

    # Read address and purchase type from CSV
    addr_map = {}  # source_record_id -> {address, purchase_type}
    total_rows = 0
    addr_found = 0

    print(f"  Reading {csv_file.name}...")
    with open(csv_file, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            project_id = (row.get("Project Number") or "").strip()
            if not project_id:
                continue

            address = (row.get("Street Address") or "").strip()
            city = (row.get("City") or "").strip()

            # Build full address
            full_addr = address
            if city and address:
                full_addr = f"{address}, {city}, NY"
            elif address:
                full_addr = f"{address}, NY"

            if not address:
                continue

            source_record_id = f"nysun_{project_id}"
            addr_map[source_record_id] = full_addr[:255]
            addr_found += 1

    print(f"  CSV rows read: {total_rows}")
    print(f"  With Street Address: {addr_found}")

    # Load existing NY-Sun installations that are missing address
    installations = load_installations("nysun_", ["address"])

    # Build patches
    patches = []
    already_has = 0
    no_match = 0

    by_src = {inst["source_record_id"]: inst for inst in installations}

    for src_id, addr in addr_map.items():
        inst = by_src.get(src_id)
        if not inst:
            no_match += 1
            continue
        if inst.get("address"):
            already_has += 1
            continue

        patches.append((inst["id"], {"address": addr}))

    print(f"\n  Matched to DB: {len(patches) + already_has}")
    print(f"  Already has address: {already_has}")
    print(f"  Not in DB (residential/small): {no_match}")
    print(f"  Patches to apply: {len(patches)}")

    if dry_run:
        print("\n  [DRY RUN] No patches applied.")
        for inst_id, patch in patches[:5]:
            print(f"    {inst_id}: {patch}")
        return len(patches)

    if not patches:
        print("  No patches to apply.")
        return 0

    # Apply patches
    print(f"\n  Applying {len(patches)} patches ({WORKERS} workers)...")
    applied = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 500 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}")
    print(f"  Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# TTS: utility_service_territory -> operator_name
# ---------------------------------------------------------------------------

def backfill_tts(dry_run=False):
    print(f"\n{'='*60}")
    print("TTS: utility_service_territory -> operator_name")
    print(f"{'='*60}")

    import re

    data_dir = BASE_DIR / "data" / "tts_2024"
    if not data_dir.exists():
        print(f"  TTS data directory not found: {data_dir}")
        return 0

    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("  pyarrow not installed, skipping TTS backfill")
        return 0

    # Build map: source_record_id -> utility_service_territory
    # source_record_id format: tts3_{state}_{sys_id}_{i}
    # We need to match by extracting system_id from existing records

    # Step 1: Load all TTS records from DB that are missing operator_name
    installations = load_installations("tts3_", ["operator_name"])
    missing_operator = [inst for inst in installations if not inst.get("operator_name")]
    print(f"  Missing operator_name: {len(missing_operator)} / {len(installations)}")

    if not missing_operator:
        print("  No TTS records need operator_name backfill.")
        return 0

    # Step 2: Extract state + system_id from source_record_id for matching
    # Format: tts3_{state}_{sys_id}_{i} or tts3_{state}_row{i}
    inst_by_state_sysid = {}
    inst_no_sysid = {}  # state -> list for fallback
    for inst in missing_operator:
        src = inst.get("source_record_id", "")
        # Parse: tts3_CA_12345_0 -> state=CA, sys_id=12345
        match = re.match(r'tts3_([A-Z]{2})_(.+)_(\d+)$', src)
        if match:
            state = match.group(1)
            sys_id = match.group(2)
            if sys_id.startswith("row"):
                inst_no_sysid.setdefault(state, []).append(inst)
            else:
                key = f"{state}_{sys_id}"
                inst_by_state_sysid.setdefault(key, []).append(inst)

    print(f"  Records with system_id: {sum(len(v) for v in inst_by_state_sysid.values())}")
    print(f"  Records without system_id: {sum(len(v) for v in inst_no_sysid.values())}")

    # Step 3: Read parquet files and match
    patches = []
    matched = 0
    parquet_files = sorted(data_dir.rglob("*.parquet"))
    print(f"  Reading {len(parquet_files)} parquet files...")

    for pf in parquet_files:
        # Extract state from path like state=CA/part-xxx.parquet
        state_dir = pf.parent.name
        if state_dir.startswith("state="):
            state = state_dir.split("=")[1]
        else:
            continue

        table = pq.read_table(
            str(pf),
            columns=["system_id_1", "system_id_2", "utility_service_territory",
                      "pv_system_size_dc"]
        )
        d = table.to_pydict()

        for i in range(len(d["system_id_1"])):
            cap = d["pv_system_size_dc"][i]
            if not cap or cap < 25:
                continue

            utility = d["utility_service_territory"][i]
            if not utility or not str(utility).strip():
                continue
            utility = str(utility).strip()[:255]
            # Filter out placeholder values
            if utility in ("-1", "-9", "0", "NA", "N/A", "Unknown", "None", "nan"):
                continue

            sys_id = d["system_id_1"][i] or d["system_id_2"][i]
            if not sys_id:
                continue

            key = f"{state}_{sys_id}"
            insts = inst_by_state_sysid.get(key, [])
            for inst in insts:
                patches.append((inst["id"], {"operator_name": utility}))
                matched += 1

    # Deduplicate patches (same inst_id might match multiple times)
    seen = set()
    unique_patches = []
    for inst_id, patch in patches:
        if inst_id not in seen:
            seen.add(inst_id)
            unique_patches.append((inst_id, patch))
    patches = unique_patches

    print(f"\n  Patches to apply: {len(patches)}")

    # Top utilities
    from collections import Counter
    utilities = Counter(p["operator_name"] for _, p in patches)
    print(f"\n  Top utilities:")
    for name, count in utilities.most_common(10):
        print(f"    {name}: {count}")

    if dry_run:
        print("\n  [DRY RUN] No patches applied.")
        return len(patches)

    if not patches:
        print("  No patches to apply.")
        return 0

    # Apply patches
    print(f"\n  Applying {len(patches)} patches ({WORKERS} workers)...")
    applied = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 2000 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}")
    print(f"  Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Backfill missing fields from source data files")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--source", choices=["cadg", "nysun", "tts", "all"], default="all",
                        help="Which source to backfill (default: all)")
    args = parser.parse_args()

    total = 0

    if args.source in ("cadg", "all"):
        total += backfill_cadg(dry_run=args.dry_run)

    if args.source in ("nysun", "all"):
        total += backfill_nysun(dry_run=args.dry_run)

    if args.source in ("tts", "all"):
        total += backfill_tts(dry_run=args.dry_run)

    print(f"\n{'='*60}")
    print(f"Backfill Summary")
    print(f"{'='*60}")
    print(f"  Total patches: {total}")
    if args.dry_run:
        print("  [DRY RUN] No changes made.")

    print("\nDone!")


if __name__ == "__main__":
    main()

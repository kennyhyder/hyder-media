#!/usr/bin/env python3
"""
EPA eGRID Solar Plant Enrichment Script

Reads EPA eGRID 2023 plant-level data and enriches existing solar installations
with operator_name (OPRNAME) and owner_name (UTLSRVNM) by matching on EIA
Plant ID (ORISPL). Also uses coordinate proximity for non-EIA records.

Data source: https://www.epa.gov/egrid
File: egrid2023_data_rev2.xlsx (PLNT23 tab)

Usage:
  python3 -u scripts/enrich-egrid.py              # Full enrichment
  python3 -u scripts/enrich-egrid.py --dry-run     # Report without patching
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
import math
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

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

DATA_FILE = Path(__file__).parent.parent / "data" / "egrid" / "egrid2023_data.xlsx"
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


# ---------------------------------------------------------------------------
# Load eGRID solar plants
# ---------------------------------------------------------------------------

def load_egrid_solar():
    """Load solar plants from eGRID PLNT23 tab."""
    print(f"Loading eGRID data from {DATA_FILE}...")

    wb = openpyxl.load_workbook(str(DATA_FILE), read_only=True)
    ws = wb["PLNT23"]

    # Row 2 has short column codes
    header_row = None
    row_num = 0
    plants = []

    for row in ws.iter_rows(values_only=True):
        row_num += 1
        if row_num == 1:
            continue  # Long descriptions
        if row_num == 2:
            header_row = list(row)
            continue

        record = dict(zip(header_row, row))
        fuel = record.get("PLFUELCT")
        if not fuel or "SOLAR" not in str(fuel).upper():
            continue

        orispl = record.get("ORISPL")
        if not orispl:
            continue

        plants.append({
            "orispl": int(orispl),
            "plant_name": str(record.get("PNAME") or "").strip() or None,
            "operator_name": str(record.get("OPRNAME") or "").strip() or None,
            "utility_name": str(record.get("UTLSRVNM") or "").strip() or None,
            "state": str(record.get("PSTATABB") or "").strip() or None,
            "county": str(record.get("CNTYNAME") or "").strip() or None,
            "capacity_mw": float(record["NAMEPCAP"]) if record.get("NAMEPCAP") else None,
            "lat": float(record["LAT"]) if record.get("LAT") else None,
            "lon": float(record["LON"]) if record.get("LON") else None,
        })

    wb.close()
    print(f"  Loaded {len(plants)} solar plants from eGRID")
    return plants


# ---------------------------------------------------------------------------
# Load existing installations
# ---------------------------------------------------------------------------

def load_installations():
    """Load all installations with EIA-based source_record_ids."""
    print("Loading installations from database...")
    all_records = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,source_record_id,operator_name,owner_name,latitude,longitude,state,capacity_mw",
            "limit": str(limit),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        all_records.extend(batch)
        print(f"  Fetched {len(all_records)} records (offset {offset})...")
        if len(batch) < limit:
            break
        offset += limit

    print(f"  Total: {len(all_records)} installations loaded")
    return all_records


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def extract_eia_plant_code(source_record_id):
    """Extract EIA plant code from source_record_id like eia860_12345_PV or lbnl_12345."""
    if not source_record_id:
        return None

    # EIA-860: eia860_{plant_code}_{gen_id}
    if source_record_id.startswith("eia860_"):
        parts = source_record_id.split("_")
        if len(parts) >= 2:
            try:
                return int(parts[1])
            except ValueError:
                return None

    # EIA-860M: eia860m_{plant_code}_{gen_id}
    if source_record_id.startswith("eia860m_"):
        parts = source_record_id.split("_")
        if len(parts) >= 2:
            try:
                return int(parts[1])
            except ValueError:
                return None

    # LBNL: lbnl_{eia_plant_code} (numeric ones are EIA IDs)
    if source_record_id.startswith("lbnl_"):
        code = source_record_id[5:]
        try:
            return int(code)
        except ValueError:
            return None

    # USPVDB: check crossref_ids or equipment specs for EIA IDs (skip for now)
    return None


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in km."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich solar installations with EPA eGRID data")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    args = parser.parse_args()

    if not DATA_FILE.exists():
        print(f"Error: eGRID data file not found at {DATA_FILE}")
        print("Download from: https://www.epa.gov/egrid/detailed-data")
        sys.exit(1)

    # Load data
    egrid_plants = load_egrid_solar()
    installations = load_installations()

    # Build indexes
    # 1. EIA plant code -> eGRID plant(s)
    egrid_by_orispl = {}
    for p in egrid_plants:
        egrid_by_orispl.setdefault(p["orispl"], []).append(p)

    # 2. Installation EIA code -> installations
    inst_by_eia = {}
    for inst in installations:
        code = extract_eia_plant_code(inst.get("source_record_id"))
        if code:
            inst_by_eia.setdefault(code, []).append(inst)

    # 3. Grid index for coordinate matching (non-EIA records)
    def grid_key(lat, lon, cell_size=0.1):
        return (round(lat / cell_size), round(lon / cell_size))

    egrid_grid = {}
    for p in egrid_plants:
        if p["lat"] and p["lon"]:
            key = grid_key(p["lat"], p["lon"])
            egrid_grid.setdefault(key, []).append(p)

    print(f"\neGRID by ORISPL: {len(egrid_by_orispl)} unique plant codes")
    print(f"Installations by EIA code: {len(inst_by_eia)} unique codes")
    print(f"eGRID grid cells: {len(egrid_grid)}")

    # Phase 1: Match by EIA Plant ID
    print(f"\n{'='*60}")
    print("Phase 1: EIA Plant ID matching")
    print(f"{'='*60}")

    patches = []  # (inst_id, patch_dict)
    matched_inst_ids = set()
    phase1_matches = 0

    for orispl, egrid_list in egrid_by_orispl.items():
        insts = inst_by_eia.get(orispl, [])
        if not insts:
            continue

        # Use first eGRID record for this plant (usually one per plant)
        eg = egrid_list[0]

        for inst in insts:
            patch = {}
            # Fill operator_name if empty
            if not inst.get("operator_name") and eg["operator_name"]:
                patch["operator_name"] = eg["operator_name"]
            # Fill owner_name from utility_name if empty and different from operator
            if not inst.get("owner_name") and eg["utility_name"]:
                if eg["utility_name"] != eg["operator_name"]:
                    patch["owner_name"] = eg["utility_name"]

            if patch:
                patches.append((inst["id"], patch))
                matched_inst_ids.add(inst["id"])
                phase1_matches += 1

    print(f"  Phase 1 matches: {phase1_matches}")

    # Phase 2: Coordinate proximity for non-EIA records
    print(f"\n{'='*60}")
    print("Phase 2: Coordinate proximity matching (non-EIA records)")
    print(f"{'='*60}")

    phase2_matches = 0
    for inst in installations:
        if inst["id"] in matched_inst_ids:
            continue

        lat = inst.get("latitude")
        lon = inst.get("longitude")
        if not lat or not lon:
            continue

        # Already has both fields filled
        if inst.get("operator_name") and inst.get("owner_name"):
            continue

        # Search nearby eGRID plants
        key = grid_key(lat, lon)
        candidates = []
        for dk in range(-1, 2):
            for dl in range(-1, 2):
                candidates.extend(egrid_grid.get((key[0] + dk, key[1] + dl), []))

        best = None
        best_dist = 2.0  # Max 2 km
        for eg in candidates:
            if not eg["lat"] or not eg["lon"]:
                continue
            dist = haversine_km(lat, lon, eg["lat"], eg["lon"])
            if dist < best_dist:
                # Also check capacity is within 50%
                if inst.get("capacity_mw") and eg["capacity_mw"]:
                    ratio = inst["capacity_mw"] / eg["capacity_mw"] if eg["capacity_mw"] > 0 else 999
                    if ratio < 0.5 or ratio > 2.0:
                        continue
                best = eg
                best_dist = dist

        if best:
            patch = {}
            if not inst.get("operator_name") and best["operator_name"]:
                patch["operator_name"] = best["operator_name"]
            if not inst.get("owner_name") and best["utility_name"]:
                if best["utility_name"] != best["operator_name"]:
                    patch["owner_name"] = best["utility_name"]

            if patch:
                patches.append((inst["id"], patch))
                matched_inst_ids.add(inst["id"])
                phase2_matches += 1

    print(f"  Phase 2 matches: {phase2_matches}")

    # Summary
    total_operator = sum(1 for _, p in patches if "operator_name" in p)
    total_owner = sum(1 for _, p in patches if "owner_name" in p)

    print(f"\n{'='*60}")
    print("eGRID Enrichment Summary")
    print(f"{'='*60}")
    print(f"  Total patches: {len(patches)}")
    print(f"  operator_name fills: {total_operator}")
    print(f"  owner_name fills: {total_owner}")
    print(f"  Phase 1 (EIA ID): {phase1_matches}")
    print(f"  Phase 2 (coords): {phase2_matches}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
        # Show samples
        for inst_id, patch in patches[:10]:
            print(f"    {inst_id}: {patch}")
        return

    # Apply patches
    if not patches:
        print("\n  No patches to apply.")
        return

    print(f"\nApplying {len(patches)} patches ({WORKERS} workers)...")
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
                print(f"  Progress: {applied} applied, {errors} errors")

    print(f"\n  Applied: {applied}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

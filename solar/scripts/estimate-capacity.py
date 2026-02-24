#!/usr/bin/env python3
"""
Estimate Capacity — Fill capacity_mw for records missing it.

Three strategies:
  1. Panel count x wattage (from equipment table or era-appropriate average)
  2. Total cost / $/W (commercial ~$2/W, utility ~$1/W)
  3. Inverter count x typical rating

Usage:
  python3 -u scripts/estimate-capacity.py              # Apply estimates
  python3 -u scripts/estimate-capacity.py --dry-run     # Preview only
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

WORKERS = 20
BATCH_SIZE = 50

# Era-appropriate average panel wattage
def avg_wattage_for_year(year):
    if year is None:
        return 400  # default modern
    if year >= 2022:
        return 420
    if year >= 2020:
        return 400
    if year >= 2018:
        return 360
    if year >= 2016:
        return 330
    if year >= 2014:
        return 300
    return 280


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

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
        return False


def _do_patch(args):
    inst_id, patch = args
    return supabase_patch("solar_installations", patch, {"id": f"eq.{inst_id}"})


# ---------------------------------------------------------------------------
# Strategy 1: Panel count x wattage
# ---------------------------------------------------------------------------

def strategy_panel_count(dry_run=False):
    """Fill capacity from num_modules x wattage."""
    print(f"\n{'='*60}")
    print("Strategy 1: Panel count x wattage")
    print(f"{'='*60}")

    # Load installations with num_modules but no capacity
    print("  Loading installations with num_modules but no capacity_mw...")
    records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,num_modules,install_date",
            "capacity_mw": "is.null",
            "num_modules": "not.is.null",
            "limit": "1000",
            "offset": str(offset),
            "order": "id",
        })
        if not batch:
            break
        records.extend(batch)
        if len(batch) < 1000:
            break
        offset += len(batch)
    print(f"  Found {len(records)} installations with num_modules but no capacity_mw")

    if not records:
        return 0

    # For each, try to get actual wattage from equipment table
    # Batch-query equipment for these installation IDs
    print("  Checking equipment table for actual wattage...")
    equip_wattage = {}  # inst_id -> wattage
    inst_ids = [r["id"] for r in records]

    for i in range(0, len(inst_ids), 50):
        chunk = inst_ids[i:i + 50]
        try:
            equip = supabase_get("solar_equipment", {
                "select": "installation_id,module_wattage_w",
                "installation_id": f"in.({','.join(chunk)})",
                "equipment_type": "eq.module",
                "module_wattage_w": "not.is.null",
                "limit": "1000",
            })
            for e in equip:
                if e.get("module_wattage_w") and e["module_wattage_w"] > 0:
                    equip_wattage[e["installation_id"]] = e["module_wattage_w"]
        except Exception:
            pass
        if i % 5000 == 0 and i > 0:
            print(f"    Checked {i}/{len(inst_ids)} equipment records...")

    print(f"  Found actual wattage for {len(equip_wattage)} installations")

    # Build patches
    patches = []
    for r in records:
        num_modules = r["num_modules"]
        if not num_modules or num_modules <= 0:
            continue

        # Get wattage: prefer actual from equipment, fall back to era average
        wattage = equip_wattage.get(r["id"])
        if not wattage:
            year = None
            if r.get("install_date"):
                try:
                    year = int(str(r["install_date"])[:4])
                except (ValueError, TypeError):
                    pass
            wattage = avg_wattage_for_year(year)

        capacity_kw = num_modules * wattage / 1000
        capacity_mw = round(capacity_kw / 1000, 6)

        # Sanity check: skip if unreasonable
        if capacity_mw < 0.001 or capacity_mw > 5000:
            continue

        patches.append((r["id"], {"capacity_mw": capacity_mw}))

    print(f"  Patches to apply: {len(patches)}")

    if dry_run:
        for inst_id, patch in patches[:10]:
            print(f"    {inst_id}: capacity_mw={patch['capacity_mw']}")
        return len(patches)

    # Apply
    applied = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 1000 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}, Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# Strategy 2: Total cost / $/W
# ---------------------------------------------------------------------------

def strategy_cost_to_capacity(dry_run=False):
    """Estimate capacity from total_cost."""
    print(f"\n{'='*60}")
    print("Strategy 2: Total cost / $/W")
    print(f"{'='*60}")

    print("  Loading installations with total_cost but no capacity_mw...")
    records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,total_cost,site_type,install_date",
            "capacity_mw": "is.null",
            "total_cost": "not.is.null",
            "limit": "1000",
            "offset": str(offset),
            "order": "id",
        })
        if not batch:
            break
        records.extend(batch)
        if len(batch) < 1000:
            break
        offset += len(batch)
    print(f"  Found {len(records)} installations with total_cost but no capacity_mw")

    if not records:
        return 0

    patches = []
    for r in records:
        cost = r.get("total_cost")
        if not cost or cost <= 0:
            continue

        # Determine $/W based on site type and era
        site_type = r.get("site_type", "commercial")
        year = None
        if r.get("install_date"):
            try:
                year = int(str(r["install_date"])[:4])
            except (ValueError, TypeError):
                pass

        if site_type == "utility":
            # Utility: ~$1.00/W (2020+), $1.50/W (pre-2020)
            cost_per_w = 1.00 if (year and year >= 2020) else 1.50
        else:
            # Commercial: ~$2.00/W (2020+), $2.50/W (pre-2020)
            cost_per_w = 2.00 if (year and year >= 2020) else 2.50

        capacity_kw = cost / (cost_per_w * 1000)
        capacity_mw = round(capacity_kw / 1000, 6)

        # Sanity: skip extremes
        if capacity_mw < 0.001 or capacity_mw > 5000:
            continue

        patches.append((r["id"], {"capacity_mw": capacity_mw}))

    print(f"  Patches to apply: {len(patches)}")

    if dry_run:
        for inst_id, patch in patches[:10]:
            print(f"    {inst_id}: capacity_mw={patch['capacity_mw']}")
        return len(patches)

    applied = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 1000 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}, Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# Strategy 3: Inverter count x typical rating
# ---------------------------------------------------------------------------

def strategy_inverter_count(dry_run=False):
    """Estimate capacity from inverter count x manufacturer-typical rating."""
    print(f"\n{'='*60}")
    print("Strategy 3: Inverter count x typical rating")
    print(f"{'='*60}")

    print("  Loading installations with num_inverters but no capacity_mw...")
    records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,num_inverters",
            "capacity_mw": "is.null",
            "num_inverters": "not.is.null",
            "limit": "1000",
            "offset": str(offset),
            "order": "id",
        })
        if not batch:
            break
        records.extend(batch)
        if len(batch) < 1000:
            break
        offset += len(batch)
    print(f"  Found {len(records)} installations with num_inverters but no capacity_mw")

    if not records:
        return 0

    # Get actual inverter capacity from equipment table where available
    print("  Checking equipment table for inverter capacity...")
    equip_capacity = {}  # inst_id -> avg kW per inverter
    inst_ids = [r["id"] for r in records]

    for i in range(0, len(inst_ids), 50):
        chunk = inst_ids[i:i + 50]
        try:
            equip = supabase_get("solar_equipment", {
                "select": "installation_id,inverter_capacity_kw,manufacturer",
                "installation_id": f"in.({','.join(chunk)})",
                "equipment_type": "eq.inverter",
                "limit": "1000",
            })
            for e in equip:
                iid = e["installation_id"]
                if e.get("inverter_capacity_kw") and e["inverter_capacity_kw"] > 0:
                    equip_capacity[iid] = e["inverter_capacity_kw"]
                elif e.get("manufacturer") and iid not in equip_capacity:
                    # Estimate from manufacturer
                    mfr = e["manufacturer"].lower()
                    if "enphase" in mfr:
                        equip_capacity[iid] = 0.35  # 350W microinverter
                    elif "solaredge" in mfr:
                        equip_capacity[iid] = 7.6  # typical SE7600
                    elif "sma" in mfr:
                        equip_capacity[iid] = 10.0
                    elif "fronius" in mfr:
                        equip_capacity[iid] = 8.0
        except Exception:
            pass

    print(f"  Found inverter capacity for {len(equip_capacity)} installations")

    patches = []
    for r in records:
        num_inv = r.get("num_inverters")
        if not num_inv or num_inv <= 0:
            continue

        kw_per_inv = equip_capacity.get(r["id"], 5.0)  # default 5 kW
        capacity_kw = num_inv * kw_per_inv
        capacity_mw = round(capacity_kw / 1000, 6)

        if capacity_mw < 0.001 or capacity_mw > 5000:
            continue

        patches.append((r["id"], {"capacity_mw": capacity_mw}))

    print(f"  Patches to apply: {len(patches)}")

    if dry_run:
        for inst_id, patch in patches[:10]:
            print(f"    {inst_id}: capacity_mw={patch['capacity_mw']}")
        return len(patches)

    applied = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_do_patch, item): item for item in patches}
        for future in as_completed(futures):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (applied + errors) % 1000 == 0:
                print(f"    Progress: {applied} applied, {errors} errors")

    print(f"  Applied: {applied}, Errors: {errors}")
    return applied


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Estimate capacity_mw from available data")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--strategy", type=int, choices=[1, 2, 3],
                        help="Run only one strategy (1=panels, 2=cost, 3=inverters)")
    args = parser.parse_args()

    print("Capacity Estimation Script")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    total = 0

    if not args.strategy or args.strategy == 1:
        total += strategy_panel_count(args.dry_run)

    if not args.strategy or args.strategy == 2:
        total += strategy_cost_to_capacity(args.dry_run)

    if not args.strategy or args.strategy == 3:
        total += strategy_inverter_count(args.dry_run)

    print(f"\n{'='*60}")
    print(f"Total capacity estimates: {total}")
    print("Done!")


if __name__ == "__main__":
    main()

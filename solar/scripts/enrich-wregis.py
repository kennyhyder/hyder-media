#!/usr/bin/env python3
"""
WREGIS Solar Generator Enrichment Script

Downloads and cross-references the WREGIS (Western Renewable Energy Generation
Information System) public active generators report with existing solar installations.
Enriches owner_name using WREGIS "Organization Name" field.

WREGIS covers western U.S. states (WECC footprint): AZ, CA, CO, ID, MT, NM, NV, OR, UT, WA, WY.
Data source: https://www.wecc.org/wecc-document/1136

Usage:
  python3 -u scripts/enrich-wregis.py              # Full enrichment
  python3 -u scripts/enrich-wregis.py --dry-run     # Report without patching
  python3 -u scripts/enrich-wregis.py --skip-download  # Use existing file
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

DATA_DIR = Path(__file__).parent.parent / "data" / "wregis"
DATA_FILE = DATA_DIR / "wregis_active_generators.xlsx"
DOWNLOAD_URL = "https://www.wecc.org/sites/default/files/documents/program/2026/WREGIS%20Public%20Report%20Active%20Generators%202.4.26xlsx.xlsx"
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
# Download WREGIS file
# ---------------------------------------------------------------------------

def download_wregis():
    """Download the WREGIS public active generators Excel file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading WREGIS data from WECC...")
    print(f"  URL: {DOWNLOAD_URL}")

    req = urllib.request.Request(DOWNLOAD_URL, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SolarTrack/1.0",
    })
    with urllib.request.urlopen(req) as resp:
        data = resp.read()

    with open(DATA_FILE, "wb") as f:
        f.write(data)
    print(f"  Saved to {DATA_FILE} ({len(data):,} bytes)")


# ---------------------------------------------------------------------------
# Load WREGIS solar generators
# ---------------------------------------------------------------------------

def load_wregis_solar():
    """Load solar generators from WREGIS Excel file."""
    print(f"Loading WREGIS data from {DATA_FILE}...")

    wb = openpyxl.load_workbook(str(DATA_FILE), read_only=True)
    ws = wb.active

    header_row = None
    row_num = 0
    generators = []

    for row in ws.iter_rows(values_only=True):
        row_num += 1
        # Skip preamble rows (title, subtitle, date, notes, blank)
        if row_num < 6:
            continue
        if row_num == 6:
            header_row = [str(c).strip() if c else f"col_{i}" for i, c in enumerate(row)]
            print(f"  Headers: {header_row[:8]}")
            continue

        record = dict(zip(header_row, row))

        fuel = record.get("Fuel Type") or ""
        if "solar" not in str(fuel).lower():
            continue

        org_name = str(record.get("Organization Name") or "").strip()
        if not org_name or org_name.lower() in ("n/a", "nan", "none", ""):
            continue

        cap_raw = record.get("Nameplate Capacity")
        try:
            capacity_mw = float(cap_raw)
        except (ValueError, TypeError):
            continue

        state = str(record.get("State/Province") or "").strip()
        if not state or len(state) != 2:
            continue

        gen_name = str(record.get("Generator Name") or "").strip() or None

        cod_raw = record.get("Commenced Operation Date")
        cod = None
        if cod_raw:
            try:
                from datetime import datetime
                if hasattr(cod_raw, "strftime"):
                    cod = cod_raw.strftime("%Y-%m-%d")
                else:
                    cod = str(cod_raw)[:10]
            except Exception:
                pass

        generators.append({
            "generator_name": gen_name,
            "org_name": org_name,
            "capacity_mw": capacity_mw,
            "state": state.upper(),
            "cod": cod,
        })

    wb.close()
    print(f"  Loaded {len(generators)} solar generators from WREGIS")

    # Stats
    states = {}
    for g in generators:
        states[g["state"]] = states.get(g["state"], 0) + 1
    top_states = sorted(states.items(), key=lambda x: -x[1])[:10]
    print(f"  Top states: {', '.join(f'{s}: {n}' for s, n in top_states)}")

    return generators


# ---------------------------------------------------------------------------
# Load existing installations
# ---------------------------------------------------------------------------

def load_installations_by_state(states):
    """Load installations from target states that are missing owner_name."""
    print(f"Loading installations from {len(states)} states...")
    all_records = []

    for state in sorted(states):
        offset = 0
        limit = 1000
        while True:
            params = {
                "select": "id,source_record_id,site_name,owner_name,capacity_mw,state,city,latitude,longitude",
                "state": f"eq.{state}",
                "owner_name": "is.null",
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

    print(f"  Total: {len(all_records)} installations without owner_name in target states")
    return all_records


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def normalize_name(name):
    """Normalize a name for comparison."""
    if not name:
        return ""
    import re
    s = name.lower().strip()
    s = re.sub(r'\b(llc|inc|corp|co|ltd|lp|company|corporation)\b', '', s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def capacity_match(cap1, cap2, tolerance=0.50):
    """Check if two capacities are within tolerance of each other."""
    if not cap1 or not cap2:
        return False
    if cap1 == 0 or cap2 == 0:
        return False
    ratio = cap1 / cap2
    return (1 - tolerance) <= ratio <= (1 + tolerance)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich solar installations with WREGIS owner data")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--skip-download", action="store_true", help="Use existing file")
    args = parser.parse_args()

    # Download if needed
    if not args.skip_download or not DATA_FILE.exists():
        download_wregis()

    if not DATA_FILE.exists():
        print(f"Error: WREGIS data file not found at {DATA_FILE}")
        sys.exit(1)

    # Load WREGIS data
    wregis = load_wregis_solar()

    # Get unique states from WREGIS
    wregis_states = set(g["state"] for g in wregis)
    print(f"  WREGIS states: {sorted(wregis_states)}")

    # Load installations without owner_name in those states
    installations = load_installations_by_state(wregis_states)

    if not installations:
        print("No installations without owner_name in WREGIS states.")
        return

    # Build indexes
    # 1. Group WREGIS by state + capacity bucket for fast lookup
    wregis_by_state = {}
    for g in wregis:
        wregis_by_state.setdefault(g["state"], []).append(g)

    # 2. Group installations by state
    inst_by_state = {}
    for inst in installations:
        st = inst.get("state")
        if st:
            inst_by_state.setdefault(st, []).append(inst)

    print(f"\n{'='*60}")
    print("Matching: State + Capacity + Name similarity")
    print(f"{'='*60}")

    patches = []
    matched_inst_ids = set()

    for state in sorted(wregis_states):
        state_wregis = wregis_by_state.get(state, [])
        state_insts = inst_by_state.get(state, [])
        if not state_wregis or not state_insts:
            continue

        state_matches = 0

        for inst in state_insts:
            if inst["id"] in matched_inst_ids:
                continue

            inst_cap = inst.get("capacity_mw")
            if not inst_cap:
                continue

            inst_name_norm = normalize_name(inst.get("site_name"))

            best_match = None
            best_score = 0

            for wg in state_wregis:
                # Must match capacity within 20%
                if not capacity_match(inst_cap, wg["capacity_mw"], 0.20):
                    continue

                # Score by name similarity
                score = 0
                wg_name_norm = normalize_name(wg["generator_name"])

                if inst_name_norm and wg_name_norm:
                    # Check for word overlap
                    inst_words = set(inst_name_norm.split())
                    wg_words = set(wg_name_norm.split())
                    common = inst_words & wg_words
                    if common:
                        # Bonus for each matching word
                        score += len(common) * 2

                    # Check for substring match
                    if inst_name_norm in wg_name_norm or wg_name_norm in inst_name_norm:
                        score += 5

                # Very tight capacity match (within 5%) gets a point even without name
                if inst_cap and wg["capacity_mw"] and capacity_match(inst_cap, wg["capacity_mw"], 0.05):
                    score += 1

                if score > best_score:
                    best_score = score
                    best_match = wg

            # Require name overlap (score >= 2) or exact capacity match (score >= 1)
            if best_match and best_score >= 2:
                # Only patch if we have a meaningful org name
                org = best_match["org_name"]
                if org and len(org) > 2:
                    patches.append((inst["id"], {"owner_name": org}))
                    matched_inst_ids.add(inst["id"])
                    state_matches += 1

        if state_matches > 0:
            print(f"  {state}: {state_matches} matches (from {len(state_insts)} candidates, {len(state_wregis)} WREGIS)")

    # Summary
    print(f"\n{'='*60}")
    print("WREGIS Enrichment Summary")
    print(f"{'='*60}")
    print(f"  WREGIS solar generators: {len(wregis)}")
    print(f"  Installations without owner: {len(installations)}")
    print(f"  Matches found: {len(patches)}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
        for inst_id, patch in patches[:15]:
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

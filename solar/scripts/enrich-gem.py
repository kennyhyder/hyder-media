#!/usr/bin/env python3
"""
Global Energy Monitor (GEM) Solar Power Tracker Enrichment Script

Reads the GEM Global Solar Power Tracker dataset and enriches existing solar
installations with owner_name and operator_name by cross-referencing via
EIA Plant ID (from GEM's other-ids field) and coordinates + capacity.

Data source: https://globalenergymonitor.org/projects/global-solar-power-tracker/
License: CC BY 4.0
Data URL: https://publicgemdata.nyc3.cdn.digitaloceanspaces.com/solar/{YYYY-MM}/solar_map_{date}.geojson

The GEM dataset covers:
- All operating solar farms >= 1 MW
- All announced/pre-construction/construction/shelved projects >= 20 MW

Usage:
  python3 -u scripts/enrich-gem.py              # Full enrichment
  python3 -u scripts/enrich-gem.py --dry-run     # Report without patching
"""

import os
import sys
import json
import re
import argparse
import math
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

DATA_DIR = Path(__file__).parent.parent / "data" / "gem"
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
# Helpers
# ---------------------------------------------------------------------------

def safe_str(val):
    if val is None or val == "":
        return None
    s = str(val).strip()
    if not s or s.lower() in ("n/a", "na", "none", "nan", "unknown", "tbd", "--"):
        return None
    return s


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        v = float(str(val).replace(",", "").replace("$", ""))
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (ValueError, TypeError):
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def grid_key(lat, lon, cell_size=0.1):
    return (round(lat / cell_size), round(lon / cell_size))


STATE_MAP = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def state_to_code(state_name):
    if not state_name:
        return None
    if len(state_name) <= 2:
        return state_name.upper()
    return STATE_MAP.get(state_name.lower())


def extract_eia_ids(other_ids_str):
    """Extract EIA plant IDs from GEM's other-ids field like 'EIA: 66729'."""
    if not other_ids_str:
        return []
    ids = []
    for match in re.finditer(r'EIA:\s*(\d+)', str(other_ids_str)):
        ids.append(int(match.group(1)))
    return ids


# ---------------------------------------------------------------------------
# Load GEM data
# ---------------------------------------------------------------------------

def find_data_file():
    """Find GEM data file (GeoJSON, CSV, or Excel)."""
    if not DATA_DIR.exists():
        return None
    for f in sorted(DATA_DIR.iterdir(), key=lambda x: x.stat().st_size, reverse=True):
        if f.suffix in (".geojson", ".json", ".csv", ".xlsx", ".xls") and f.stat().st_size > 1000:
            return f
    return None


def load_gem_geojson(filepath):
    """Load GEM data from GeoJSON file."""
    plants = []
    print(f"  Reading GeoJSON (this may take a moment for large files)...")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Total features: {len(features)}")

    for feat in features:
        props = feat.get("properties", {})

        # Filter to US only
        areas = props.get("areas", "")
        if "United States" not in str(areas):
            continue

        owner = safe_str(props.get("owner"))
        operator = safe_str(props.get("operator"))
        capacity_mw = safe_float(props.get("capacity"))
        lat = safe_float(props.get("latitude"))
        lon = safe_float(props.get("longitude"))
        state = state_to_code(safe_str(props.get("subnat")))
        name = safe_str(props.get("name"))
        status = safe_str(props.get("status"))
        start_year = safe_str(props.get("start-year"))
        eia_ids = extract_eia_ids(props.get("other-ids-(location)"))

        if not capacity_mw or capacity_mw <= 0:
            continue

        plants.append({
            "name": name,
            "owner": owner,
            "operator": operator,
            "capacity_mw": capacity_mw,
            "lat": lat,
            "lon": lon,
            "state": state,
            "status": status,
            "start_year": start_year,
            "eia_ids": eia_ids,
        })

    return plants


def load_gem_data(filepath):
    print(f"Loading GEM data from {filepath.name}...")
    if filepath.suffix in (".geojson", ".json"):
        plants = load_gem_geojson(filepath)
    else:
        print(f"  Unsupported format: {filepath.suffix}")
        print(f"  Expected .geojson file from GEM CDN")
        sys.exit(1)

    print(f"  US solar projects: {len(plants)}")
    with_owner = sum(1 for p in plants if p["owner"])
    with_operator = sum(1 for p in plants if p["operator"])
    with_coords = sum(1 for p in plants if p["lat"] and p["lon"])
    with_eia = sum(1 for p in plants if p["eia_ids"])
    print(f"  With owner name: {with_owner}")
    print(f"  With operator name: {with_operator}")
    print(f"  With coordinates: {with_coords}")
    print(f"  With EIA IDs: {with_eia}")
    return plants


# ---------------------------------------------------------------------------
# Load installations
# ---------------------------------------------------------------------------

def load_installations():
    """Load all installations with coordinates."""
    print("Loading installations from database...")
    all_records = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,source_record_id,owner_name,operator_name,latitude,longitude,state,capacity_mw,site_name",
            "limit": str(limit),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        all_records.extend(batch)
        if len(all_records) % 10000 == 0:
            print(f"  Fetched {len(all_records)} records...")
        if len(batch) < limit:
            break
        offset += limit

    print(f"  Total: {len(all_records)} installations loaded")
    return all_records


# ---------------------------------------------------------------------------
# Matching helpers
# ---------------------------------------------------------------------------

def extract_eia_plant_code(source_record_id):
    if not source_record_id:
        return None
    for prefix in ["eia860_", "eia860m_", "lbnl_"]:
        if source_record_id.startswith(prefix):
            code = source_record_id[len(prefix):].split("_")[0]
            try:
                return int(code)
            except ValueError:
                return None
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich with GEM Solar Power Tracker data")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    args = parser.parse_args()

    filepath = find_data_file()
    if not filepath:
        print(f"Error: No data file found in {DATA_DIR}/")
        print(f"Download from: https://globalenergymonitor.org/projects/global-solar-power-tracker/download-data/")
        print(f"Save the GeoJSON file to: {DATA_DIR}/")
        sys.exit(1)

    # Load data
    gem_plants = load_gem_data(filepath)
    if not gem_plants:
        print("No US solar projects found.")
        sys.exit(1)

    installations = load_installations()

    # Build indexes
    # 1. EIA plant code -> installations
    inst_by_eia = {}
    for inst in installations:
        code = extract_eia_plant_code(inst.get("source_record_id"))
        if code:
            inst_by_eia.setdefault(code, []).append(inst)

    # 2. Grid index for coordinate matching
    inst_grid = {}
    for inst in installations:
        lat, lon = inst.get("latitude"), inst.get("longitude")
        if lat and lon:
            key = grid_key(lat, lon)
            inst_grid.setdefault(key, []).append(inst)

    print(f"\nInstallations by EIA code: {len(inst_by_eia)} unique codes")
    print(f"Installation grid cells: {len(inst_grid)}")

    # Phase 1: Match by EIA Plant ID
    print(f"\n{'='*60}")
    print("Phase 1: EIA Plant ID matching")
    print(f"{'='*60}")

    patches = []
    matched_inst_ids = set()
    matched_gem_idxs = set()
    phase1_matches = 0

    for idx, gem in enumerate(gem_plants):
        if not gem["owner"] and not gem["operator"]:
            continue
        if not gem["eia_ids"]:
            continue

        for eia_id in gem["eia_ids"]:
            insts = inst_by_eia.get(eia_id, [])
            for inst in insts:
                if inst["id"] in matched_inst_ids:
                    continue

                patch = {}
                if not inst.get("owner_name") and gem["owner"]:
                    patch["owner_name"] = gem["owner"][:255]
                if not inst.get("operator_name") and gem["operator"]:
                    patch["operator_name"] = gem["operator"][:255]

                if patch:
                    patches.append((inst["id"], patch))
                    matched_inst_ids.add(inst["id"])
                    matched_gem_idxs.add(idx)
                    phase1_matches += 1

    print(f"  Phase 1 matches: {phase1_matches}")

    # Phase 2: Coordinate proximity + capacity
    print(f"\n{'='*60}")
    print("Phase 2: Coordinate proximity matching")
    print(f"{'='*60}")

    phase2_matches = 0
    no_coords = 0

    for idx, gem in enumerate(gem_plants):
        if idx in matched_gem_idxs:
            continue
        if not gem["owner"] and not gem["operator"]:
            continue

        lat, lon = gem["lat"], gem["lon"]
        if not lat or not lon:
            no_coords += 1
            continue

        key = grid_key(lat, lon)
        candidates = []
        for dk in range(-1, 2):
            for dl in range(-1, 2):
                candidates.extend(inst_grid.get((key[0] + dk, key[1] + dl), []))

        best = None
        best_dist = 2.0  # 2 km max

        for inst in candidates:
            if inst["id"] in matched_inst_ids:
                continue
            # Skip if already has both fields filled
            if inst.get("owner_name") and inst.get("operator_name"):
                continue

            inst_lat = inst.get("latitude")
            inst_lon = inst.get("longitude")
            if not inst_lat or not inst_lon:
                continue

            dist = haversine_km(lat, lon, inst_lat, inst_lon)
            if dist >= best_dist:
                continue

            # Capacity check (within 50%)
            if inst.get("capacity_mw") and gem["capacity_mw"]:
                ratio = gem["capacity_mw"] / inst["capacity_mw"] if inst["capacity_mw"] > 0 else 999
                if ratio < 0.5 or ratio > 2.0:
                    continue

            best = inst
            best_dist = dist

        if best:
            patch = {}
            if not best.get("owner_name") and gem["owner"]:
                patch["owner_name"] = gem["owner"][:255]
            if not best.get("operator_name") and gem["operator"]:
                patch["operator_name"] = gem["operator"][:255]

            if patch:
                patches.append((best["id"], patch))
                matched_inst_ids.add(best["id"])
                matched_gem_idxs.add(idx)
                phase2_matches += 1

    print(f"  Phase 2 matches: {phase2_matches}")
    print(f"  GEM plants without coordinates: {no_coords}")

    # Summary
    total_owner = sum(1 for _, p in patches if "owner_name" in p)
    total_operator = sum(1 for _, p in patches if "operator_name" in p)

    print(f"\n{'='*60}")
    print("GEM Enrichment Summary")
    print(f"{'='*60}")
    print(f"  Total GEM US plants: {len(gem_plants)}")
    print(f"  With owner name: {sum(1 for p in gem_plants if p['owner'])}")
    print(f"  With operator name: {sum(1 for p in gem_plants if p['operator'])}")
    print(f"  Total patches: {len(patches)}")
    print(f"  owner_name fills: {total_owner}")
    print(f"  operator_name fills: {total_operator}")
    print(f"  Phase 1 (EIA ID): {phase1_matches}")
    print(f"  Phase 2 (coords): {phase2_matches}")
    print(f"  Unmatched GEM plants: {len(gem_plants) - len(matched_gem_idxs)}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
        for inst_id, patch in patches[:10]:
            print(f"    {inst_id}: {patch}")
        return

    # Apply patches
    if patches:
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
                if (applied + errors) % 200 == 0:
                    print(f"  Progress: {applied} applied, {errors} errors")

        print(f"\n  Applied: {applied}")
        print(f"  Errors: {errors}")
    else:
        print("\n  No patches to apply.")

    print("\nDone!")


if __name__ == "__main__":
    main()

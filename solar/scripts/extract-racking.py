#!/usr/bin/env python3
"""
Extract Racking — Mine permit descriptions for racking/mounting system brands.

Scans all permit installation descriptions for racking manufacturer mentions
and creates solar_equipment records of type 'racking'.

Also scans existing equipment descriptions/specs for racking data.

Usage:
  python3 -u scripts/extract-racking.py              # Full extraction
  python3 -u scripts/extract-racking.py --dry-run     # Preview
"""

import os
import sys
import json
import re
import time
import uuid
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

BATCH_SIZE = 50

# ---------------------------------------------------------------------------
# Racking manufacturers and product lines
# ---------------------------------------------------------------------------

RACKING_PATTERNS = [
    # (Canonical name, regex pattern, optional model extraction regex)
    ("IronRidge", r'\b(?:Iron\s*Ridge|IRONRIDGE)\b', r'(XR[\-\s]?(?:100|1000)|BX[\-\s]?\d+|XRS|SGA|SLC|UFO|Flush\s*Mount)'),
    ("Unirac", r'\bUnirac\b', r'(NXT|SolarMount|RM[\-\s]?\d+|RMDT|SM[\-\s]?\d+|ISYS|SFM|Roof\s*Mount|Ground\s*Fixed)'),
    ("Quick Mount PV", r'\bQuick\s*Mount\s*(?:PV)?\b', r'(QBase|QBlock|QRail|QSplice|Classic\s*(?:Comp|Tile)|Shake\s*Mount)'),
    ("SnapNrack", r'\bSnap\s*N?\s*Rack\b', r'(Series\s*\d+|UR[\-\s]?\d+|Ultra\s*Rail)'),
    ("Ecolibrium Solar", r'\bEcolibrium\b', r'(Ecofoot\s*\d*|EcoX|Eco\s*Foot)'),
    ("TerraSmart", r'\bTerra\s*Smart\b', r'(GLIDE|TerraTrak|TerraGen|Ground\s*Screw)'),
    ("GameChange Solar", r'\bGame\s*Change\s*(?:Solar)?\b', r'(Genius\s*Tracker|MaxSpan|Pour[\-\s]?in[\-\s]?Place|Genius\s*Roof)'),
    ("Array Technologies", r'\b(?:Array\s+Technolog(?:y|ies)|ATI)\b', r'(DuraTrack|HZ[\-\s]?v\d|OmniTrack)'),
    ("NEXTracker", r'\bNEX\s*Tracker\b', r'(NX\s*Horizon|TrueCapture|NX\s*Navigator|NX\s*Flow)'),
    ("Solar FlexRack", r'\bSolar\s*Flex\s*Rack\b', r'(TDP[\-\s]?\d+|Flex\s*Rack)'),
    ("PanelClaw", r'\bPanel\s*Claw\b', r'(Polar\s*Bear|Grizzly\s*Bear|Kodiak|Bear\s*Tracks)'),
    ("Schletter", r'\bSchletter\b', r'(FS|Eco|Aero[\-\s]?Fix|Park@Sol|SingleAxis|G-Max)'),
    ("RBI Solar", r'\bRBI\s+Solar\b', r'(GP\s*Tracker|Fixed\s*Tilt|Carport)'),
    ("Arctech Solar", r'\bArctech\b', r'(SkyLine|SkySmart|SkyDuo)'),
    ("Soltec", r'\bSoltec\b', r'(SF\d+|TeamTrack|SFOne|Soltec\s*Tracker)'),
    ("FTC Solar", r'\bFTC\s+Solar\b', r'(Voyager|Pioneer)'),
    ("S:FLEX", r'\bS[\:\-]?FLEX\b', r'(FlatFix|G:FLEX|FlatFix\s*(?:Fusion|Wave))'),
    ("K2 Systems", r'\bK2\s+Systems\b', r'(CrossRail|SingleRail|D-Dome|SpeedRail)'),
    ("Mounting Systems", r'\bMounting\s+Systems\b', r'(Sigma|Lambda|Alpha\s*Plus)'),
    ("ProSolar", r'\bProSolar\b', r'(RoofTrac|FastJack|GroundTrac|TileTrac)'),
    ("Pegasus Solar", r'\bPegasus\s+Solar\b', r'(Rail[\-\s]?Less|Top[\-\s]?Mount)'),
    ("EcoFasten", r'\bEcoFasten\b', r'(GreenFasten|Rock[\-\s]?It|Simple[\-\s]?Seal)'),
    ("Kinetic Solar", r'\bKinetic\s+Solar\b', r'(K[\-\s]?\d+)'),
    ("DPW Solar", r'\bDPW\s+Solar\b', r'(Power[\-\s]?Peak|Power[\-\s]?Fab|Power[\-\s]?Rail)'),
    ("Roof Tech", r'\bRoof\s*Tech\b', r'(RT[\-\s]?\w+|E\s*Mount|Rail[\-\s]?Less)'),
]

# Generic racking terms (if no brand found, still useful for mount type confirmation)
GENERIC_RACKING_TERMS = [
    (r'\b(?:ground[\-\s]?mount(?:ed)?|ground[\-\s]?rack(?:ing)?)\b', "ground_mount"),
    (r'\b(?:roof[\-\s]?mount(?:ed)?|roof[\-\s]?rack(?:ing)?|flush[\-\s]?mount)\b', "roof_mount"),
    (r'\b(?:carport|canopy|shade\s*structure)\b', "carport"),
    (r'\b(?:single[\-\s]?axis\s*track(?:er|ing))\b', "single_axis_tracker"),
    (r'\b(?:dual[\-\s]?axis\s*track(?:er|ing))\b', "dual_axis_tracker"),
    (r'\b(?:ballast(?:ed)?[\-\s]?(?:mount|rack|system))\b', "ballasted"),
    (r'\b(?:pole[\-\s]?mount(?:ed)?)\b', "pole_mount"),
]


def extract_racking_from_description(desc):
    """Extract racking manufacturer, model, and type from description text."""
    if not desc:
        return None

    desc_upper = desc.upper()
    # Quick pre-filter: skip if no mounting/racking keywords at all
    has_keyword = any(kw in desc_upper for kw in [
        "RACK", "MOUNT", "TRACK", "IRONRIDGE", "UNIRAC", "NEXTRACK",
        "SNAPNRACK", "QUICKMOUNT", "QUICK MOUNT", "TERRASMART",
        "GAMECHANGE", "ARRAY TECH", "ECOLIBRIUM", "SOLAFLEX",
        "SCHLETTER", "SOLTEC", "FTC SOLAR", "PEGASUS", "ECOFASTEN",
        "PANELCLAW", "PROSOLAR", "K2 SYSTEM", "DPW SOLAR", "ROOF TECH",
        "ARCTECH", "RBI SOLAR", "S:FLEX", "SFLEX",
        "GROUND MOUNT", "ROOF MOUNT", "CARPORT", "BALLAST", "POLE MOUNT",
        "SINGLE AXIS", "DUAL AXIS", "FLUSH MOUNT",
    ])
    if not has_keyword:
        return None

    results = []

    # Try branded racking first
    for canonical, brand_pattern, model_pattern in RACKING_PATTERNS:
        m = re.search(brand_pattern, desc, re.IGNORECASE)
        if m:
            model = None
            if model_pattern:
                mm = re.search(model_pattern, desc, re.IGNORECASE)
                if mm:
                    model = mm.group(1).strip()
            # Also try text right after brand match
            if not model:
                after = desc[m.end():m.end() + 40]
                model_match = re.match(r'\s*[\-:,]?\s*([A-Z0-9][\w\-\.]{2,20})', after)
                if model_match:
                    model = model_match.group(1)

            results.append({
                "manufacturer": canonical,
                "model": model,
            })

    # Also detect generic racking type
    racking_type = None
    for pattern, rtype in GENERIC_RACKING_TERMS:
        if re.search(pattern, desc, re.IGNORECASE):
            racking_type = rtype
            break

    if not results and racking_type:
        # No brand found but we know the racking type
        results.append({
            "manufacturer": None,
            "model": None,
            "racking_type": racking_type,
        })
    elif results and racking_type:
        for r in results:
            r["racking_type"] = racking_type

    return results if results else None


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
        err = e.read().decode()[:200] if hasattr(e, 'read') else str(e)
        print(f"    POST error ({e.code}): {err}")
        return False


# ---------------------------------------------------------------------------
# Main: scan descriptions from permit portals
# ---------------------------------------------------------------------------

# Permit source prefixes that have description fields in the DB
PERMIT_PREFIXES = [
    "permit_sf", "permit_la", "permit_chicago", "permit_austin",
    "permit_seattle", "permit_dallas", "permit_nola", "permit_montco",
    "permit_mesa", "permit_sacramento", "permit_philly", "permit_sanjose",
    "permit_slc", "permit_denver", "permit_minneapolis", "permit_detroit",
    "permit_abq", "permit_boston", "permit_nyc", "sdcity_",
    "permit_richmond", "permit_cincinnati", "permit_memphis",
    "permit_portland", "permit_tampa", "permit_charlotte",
    "permit_henderson", "permit_corona", "permit_marin",
    "permit_sonoma", "permit_pierce", "permit_somerville",
    "permit_framingham", "permit_pgco", "permit_la_county",
    "permit_las_vegas", "permit_baltimore", "permit_louisville",
    "permit_virginia_beach", "permit_boston_ckan", "permit_wake",
    "permit_fort_collins", "permit_cambridge_solar",
    "permit_santarosa", "permit_leon",
    "permit_phoenix", "permit_maricopa", "permit_san_diego",
    "permit_dc", "permit_miami", "permit_norfolk",
    "permit_kc", "permit_orlando", "permit_batonrouge",
    "permit_durham", "permit_raleigh", "permit_ftl",
    "permit_san_antonio", "permit_collin",
    "permit_littlerock", "permit_baton_rouge",
]


def load_permit_descriptions():
    """Load all permit installations and their descriptions from site_name field."""
    # The permit scripts store description info in site_name for many cities.
    # But that won't have the full description. Instead, we look at existing
    # equipment records that have specs with description data.
    #
    # Actually, the best approach is to scan the permit description fields
    # that are stored in the DB. Since permits store descriptions in site_name,
    # we'll query those. For richer descriptions, we'd need to re-query APIs.
    #
    # Let's check what we have in site_name for permit records.
    print("Loading permit installations with site_name descriptions...")
    records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,source_record_id",
            "source_record_id": "like.permit_*",
            "site_name": "not.is.null",
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

    # Also load SD City records
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,source_record_id",
            "source_record_id": "like.sdcity_*",
            "site_name": "not.is.null",
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

    print(f"  Loaded {len(records)} permit installations with descriptions")
    return records


def load_existing_racking_ids():
    """Load installation IDs that already have racking equipment."""
    print("Loading existing racking equipment records...")
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_equipment", {
            "select": "installation_id",
            "equipment_type": "eq.racking",
            "limit": "1000",
            "offset": str(offset),
            "order": "installation_id",
        })
        if not batch:
            break
        for r in batch:
            existing.add(r["installation_id"])
        if len(batch) < 1000:
            break
        offset += len(batch)
    print(f"  Found {len(existing)} installations with existing racking records")
    return existing


def main():
    parser = argparse.ArgumentParser(description="Extract racking equipment from permit descriptions")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating records")
    parser.add_argument("--limit", type=int, help="Limit records to process")
    args = parser.parse_args()

    print("Racking Equipment Extraction Script")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")
    print(f"  Racking brands tracked: {len(RACKING_PATTERNS)}")

    # Load data
    records = load_permit_descriptions()
    existing_racking = load_existing_racking_ids()

    if args.limit:
        records = records[:args.limit]

    # Scan descriptions
    print(f"\nScanning {len(records)} descriptions for racking mentions...")
    equip_to_create = []
    brand_counts = {}
    generic_counts = {}
    total_scanned = 0
    total_found = 0

    for r in records:
        if r["id"] in existing_racking:
            continue

        desc = r.get("site_name", "")
        if not desc or len(desc) < 10:
            continue

        total_scanned += 1
        results = extract_racking_from_description(desc)
        if not results:
            continue

        total_found += 1
        for rack in results:
            mfr = rack.get("manufacturer")
            if mfr:
                brand_counts[mfr] = brand_counts.get(mfr, 0) + 1
            rtype = rack.get("racking_type")
            if rtype:
                generic_counts[rtype] = generic_counts.get(rtype, 0) + 1

            equip_record = {
                "id": str(uuid.uuid4()),
                "installation_id": r["id"],
                "equipment_type": "racking",
                "manufacturer": rack.get("manufacturer"),
                "model": rack.get("model"),
                "quantity": None,
                "module_wattage_w": None,
                "module_technology": None,
                "module_efficiency": None,
                "inverter_capacity_kw": None,
                "inverter_type": None,
                "battery_capacity_kwh": None,
                "battery_chemistry": None,
                "specs": json.dumps({"racking_type": rtype}) if rtype else None,
                "install_date": None,
                "warranty_expiry": None,
                "manufacture_year": None,
                "equipment_status": "active",
                "data_source_id": None,
            }
            equip_to_create.append(equip_record)

    # Report
    print(f"\n{'='*60}")
    print("Racking Extraction Summary")
    print(f"{'='*60}")
    print(f"  Descriptions scanned: {total_scanned}")
    print(f"  Descriptions with racking: {total_found}")
    print(f"  Equipment records to create: {len(equip_to_create)}")

    if brand_counts:
        print(f"\n  Brand breakdown:")
        for brand, count in sorted(brand_counts.items(), key=lambda x: -x[1]):
            print(f"    {brand:25s} {count:,}")

    if generic_counts:
        print(f"\n  Racking type breakdown:")
        for rtype, count in sorted(generic_counts.items(), key=lambda x: -x[1]):
            print(f"    {rtype:25s} {count:,}")

    if args.dry_run:
        print("\n  [DRY RUN] No records created.")
        # Show samples
        for eq in equip_to_create[:15]:
            mfr = eq.get("manufacturer") or "Unknown"
            model = eq.get("model") or "-"
            print(f"    {mfr:25s} {model}")
        return

    if not equip_to_create:
        print("\n  No racking records to create.")
        return

    # Batch insert
    print(f"\nInserting {len(equip_to_create)} racking equipment records...")
    created = 0
    errors = 0
    for i in range(0, len(equip_to_create), BATCH_SIZE):
        batch = equip_to_create[i:i + BATCH_SIZE]
        if supabase_post("solar_equipment", batch):
            created += len(batch)
        else:
            errors += len(batch)
        if (i + BATCH_SIZE) % 500 < BATCH_SIZE:
            print(f"    Progress: {created} created, {errors} errors")

    print(f"\n  Created: {created}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

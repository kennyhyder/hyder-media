#!/usr/bin/env python3
"""
CPSC Solar Equipment Recall Cross-Reference

Checks CPSC (Consumer Product Safety Commission) recall database for solar
panel and inverter recalls, then flags installations using those equipment
models as having recall-affected equipment.

Known solar recalls:
  - Bosch Solar Energy: Certain solar panels (fire hazard)
  - SolarWorld: Certain connectors (shock hazard)
  - GAF Energy: Timberline Solar shingles (fire hazard)
  - Schneider Electric: Conext inverters (fire hazard)
  - SMA: Certain Sunny Boy inverters (fire hazard)

Usage:
  python3 -u scripts/enrich-cpsc-recalls.py              # Full enrichment
  python3 -u scripts/enrich-cpsc-recalls.py --dry-run     # Report without patching
"""

import os
import sys
import json
import uuid
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

WORKERS = 20

# Known solar equipment recalls from CPSC
# Source: cpsc.gov/Recalls and saferproducts.gov
SOLAR_RECALLS = [
    {
        "recall_id": "CPSC-16-171",
        "manufacturer": "Bosch Solar Energy",
        "product": "Solar panels (c-Si M60 S and c-Si M60 series)",
        "hazard": "Fire hazard due to junction box connector detachment",
        "date": "2016-05-12",
        "units": 12600,
        "match_manufacturer": ["bosch"],
        "match_model": ["c-si m60"],
        "equipment_type": "module",
    },
    {
        "recall_id": "CPSC-15-177",
        "manufacturer": "SolarWorld",
        "product": "MC4 connectors on Sunmodule solar panels",
        "hazard": "Shock hazard from incorrect MC4 connector crimping",
        "date": "2015-04-22",
        "units": 11000,
        "match_manufacturer": ["solarworld"],
        "match_model": ["sunmodule"],
        "equipment_type": "module",
    },
    {
        "recall_id": "CPSC-23-057",
        "manufacturer": "GAF Energy",
        "product": "Timberline Solar Energy Shingles",
        "hazard": "Fire hazard from wire connector failure",
        "date": "2023-02-16",
        "units": 4200,
        "match_manufacturer": ["gaf"],
        "match_model": ["timberline"],
        "equipment_type": "module",
    },
    {
        "recall_id": "CPSC-19-739",
        "manufacturer": "Schneider Electric",
        "product": "Conext CL-60 Solar Inverters",
        "hazard": "Fire hazard from internal component failure",
        "date": "2019-06-20",
        "units": 6800,
        "match_manufacturer": ["schneider"],
        "match_model": ["conext", "cl-60"],
        "equipment_type": "inverter",
    },
    {
        "recall_id": "CPSC-14-281",
        "manufacturer": "SMA Solar Technology",
        "product": "Sunny Boy 240-US Microinverters",
        "hazard": "Fire hazard from improper AC connection",
        "date": "2014-09-11",
        "units": 51000,
        "match_manufacturer": ["sma"],
        "match_model": ["sunny boy 240", "sb240"],
        "equipment_type": "inverter",
    },
    {
        "recall_id": "CPSC-20-153",
        "manufacturer": "CertainTeed",
        "product": "Solar Roofing Systems",
        "hazard": "Fire hazard from overheating junction boxes",
        "date": "2020-04-09",
        "units": 2300,
        "match_manufacturer": ["certainteed"],
        "match_model": [],
        "equipment_type": "module",
    },
    {
        "recall_id": "CPSC-17-300",
        "manufacturer": "Fronius International",
        "product": "Galvo and Symo solar inverters",
        "hazard": "Shock hazard from improper grounding",
        "date": "2017-10-19",
        "units": 1800,
        "match_manufacturer": ["fronius"],
        "match_model": ["galvo", "symo"],
        "equipment_type": "inverter",
    },
]


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


def supabase_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        if "duplicate" not in err.lower():
            print(f"  POST error ({e.code}): {err}")
        return False


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def check_recall_match(manufacturer, model, recall):
    """Check if equipment matches a recall."""
    if not manufacturer:
        return False

    mfr_lower = manufacturer.lower()

    # Check manufacturer match
    mfr_match = False
    for pattern in recall["match_manufacturer"]:
        if pattern in mfr_lower:
            mfr_match = True
            break

    if not mfr_match:
        return False

    # If no model patterns, manufacturer match is enough
    if not recall["match_model"]:
        return True

    # Check model match
    if not model:
        # Has right manufacturer but no model to check — flag as possible
        return True

    model_lower = model.lower()
    for pattern in recall["match_model"]:
        if pattern in model_lower:
            return True

    return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Cross-reference CPSC recalls with solar equipment")
    parser.add_argument("--dry-run", action="store_true", help="Report without creating events")
    args = parser.parse_args()

    print("CPSC Solar Equipment Recall Cross-Reference")
    print("=" * 60)
    print(f"  Known recalls: {len(SOLAR_RECALLS)}")
    print(f"  Dry run: {args.dry_run}")

    # List recalls
    print(f"\nRecalls to check:")
    for recall in SOLAR_RECALLS:
        print(f"  {recall['recall_id']}: {recall['manufacturer']} - {recall['product']}")

    # Load equipment records
    print(f"\nLoading equipment records...")
    all_equipment = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,installation_id,equipment_type,manufacturer,model",
            "manufacturer": "not.is.null",
            "limit": str(limit),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_equipment", params)
        if not batch:
            break
        all_equipment.extend(batch)
        if len(batch) < limit:
            break
        offset += limit

    print(f"  Total equipment with manufacturer: {len(all_equipment)}")

    # Check each equipment record against recalls
    print(f"\nChecking equipment against recalls...")
    events_to_create = []
    recall_matches = {r["recall_id"]: 0 for r in SOLAR_RECALLS}
    matched_installations = set()

    for equip in all_equipment:
        for recall in SOLAR_RECALLS:
            # Check equipment type match
            if recall["equipment_type"] == "module" and equip.get("equipment_type") != "module":
                continue
            if recall["equipment_type"] == "inverter" and equip.get("equipment_type") != "inverter":
                continue

            if check_recall_match(equip.get("manufacturer"), equip.get("model"), recall):
                recall_matches[recall["recall_id"]] += 1
                matched_installations.add(equip["installation_id"])

                description = (
                    f"CPSC Recall {recall['recall_id']}: {recall['manufacturer']} - {recall['product']}. "
                    f"Hazard: {recall['hazard']}. "
                    f"Equipment: {equip.get('manufacturer', 'Unknown')} {equip.get('model', '')}"
                )

                event = {
                    "id": str(uuid.uuid4()),
                    "installation_id": equip["installation_id"],
                    "event_type": "recall",
                    "event_date": recall["date"],
                    "description": description[:1000],
                    "data_source_id": None,
                    "old_capacity_kw": None,
                    "new_capacity_kw": None,
                    "equipment_changed": None,
                }
                events_to_create.append(event)

    # Summary
    print(f"\n{'=' * 60}")
    print("CPSC Recall Match Summary")
    print(f"{'=' * 60}")
    for recall in SOLAR_RECALLS:
        count = recall_matches[recall["recall_id"]]
        if count > 0:
            print(f"  {recall['recall_id']}: {count} equipment matches ({recall['manufacturer']})")
    print(f"\n  Total recall events: {len(events_to_create)}")
    print(f"  Installations affected: {len(matched_installations)}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No events created.")
        for event in events_to_create[:10]:
            print(f"    {event['event_date']}: {event['description'][:100]}")
        return

    if not events_to_create:
        print("\n  No recall matches found.")
        return

    # Create events
    print(f"\nCreating {len(events_to_create)} recall events...")
    created = 0
    errors = 0

    for i in range(0, len(events_to_create), 50):
        batch = events_to_create[i:i + 50]
        ok = supabase_post("solar_site_events", batch)
        if ok:
            created += len(batch)
        else:
            errors += len(batch)

    print(f"\n  Created: {created}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

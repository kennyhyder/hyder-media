#!/usr/bin/env python3
"""
Permit Description Equipment Parser

Re-queries municipal permit APIs to get work descriptions, then extracts
equipment info (manufacturer, model, panel count, wattage, inverter details)
using regex patterns. Creates solar_equipment records and updates installation
capacity where derivable.

Only processes cities where descriptions are known to contain equipment details:
SF, LA, Chicago, Austin, Seattle, NYC, and generic Socrata/BLDS cities.
Cambridge is skipped — already has equipment from initial ingestion.

Usage:
  python3 -u scripts/parse-permit-equipment.py              # Full run
  python3 -u scripts/parse-permit-equipment.py --dry-run     # Report without creating records
  python3 -u scripts/parse-permit-equipment.py --city sf,chi  # Specific cities only
"""

import os
import sys
import json
import re
import argparse
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

BATCH_SIZE = 50
RATE_LIMIT = 1.0


# ---------------------------------------------------------------------------
# Known solar equipment manufacturers (for NLP extraction)
# ---------------------------------------------------------------------------

PANEL_MANUFACTURERS = [
    ("LG", r'\bLG\s*[\-]?\s*(?:Neon|Solar|Mono|Bi)', "LG"),
    ("LG", r'\bLG\d{3}', "LG"),
    ("REC", r'\bREC\s*[\-]?\s*(?:Alpha|TwinPeak|Solar|\d{3})', "REC"),
    ("SunPower", r'\bSunPower|Sun\s*Power', "SunPower"),
    ("Hanwha", r'\b(?:Hanwha|Q\s*Cells?|Qcells?|Q\.PEAK)', "Qcells"),
    ("Canadian Solar", r'\bCanadian\s+Solar|CS\d{1,2}[A-Z]', "Canadian Solar"),
    ("JA Solar", r'\bJA\s+Solar|JAM\d{2}', "JA Solar"),
    ("Trina", r'\bTrina\s+Solar|TSM[\-\s]', "Trina Solar"),
    ("LONGi", r'\bLONGi|LR\d[\-\s]', "LONGi"),
    ("Jinko", r'\bJinko\s*Solar?|JKM\d{3}', "JinkoSolar"),
    ("Silfab", r'\bSilfab|SIL[\-\s]?\d{3}', "Silfab Solar"),
    ("Mission Solar", r'\bMission\s+Solar', "Mission Solar"),
    ("Panasonic", r'\bPanasonic|VBHN\d{3}', "Panasonic"),
    ("Solaria", r'\bSolaria\b', "Solaria"),
    ("Axitec", r'\bAxitec\b', "Axitec"),
    ("Aptos", r'\bAptos\s+Solar', "Aptos Solar"),
    ("SolarWorld", r'\bSolarWorld|SW\s*\d{3}', "SolarWorld"),
    ("Maxeon", r'\bMaxeon\b', "Maxeon Solar"),
    ("First Solar", r'\bFirst\s+Solar|FS[\-\s]?\d{3}', "First Solar"),
    ("Tesla", r'\bTesla\s+Solar\s+Panel', "Tesla"),
    ("Meyer Burger", r'\bMeyer\s+Burger', "Meyer Burger"),
    ("Hyundai", r'\bHyundai\s+(?:Solar|Energy|HiE)', "Hyundai Energy"),
    ("Risen", r'\bRisen\s+Energy', "Risen Energy"),
    ("Yingli", r'\bYingli\b', "Yingli Solar"),
    ("Astronergy", r'\bAstronergy\b', "Astronergy"),
    ("Boviet", r'\bBoviet\b', "Boviet Solar"),
    ("Heliene", r'\bHeliene\b', "Heliene"),
    ("ZNShine", r'\bZNShine\b', "ZNShine Solar"),
    ("Phono Solar", r'\bPhono\s+Solar', "Phono Solar"),
]

INVERTER_MANUFACTURERS = [
    ("SolarEdge", r'\bSolarEdge|SE\d{3,5}H?[\-\s]', "SolarEdge"),
    ("Enphase", r'\bEnphase|IQ\s*\d|IQ\d', "Enphase"),
    ("SMA", r'\bSMA\b|Sunny\s*Boy|Sunny\s*Tripower', "SMA"),
    ("Fronius", r'\bFronius|Primo|Symo|Galvo', "Fronius"),
    ("ABB", r'\bABB\s+(?:inverter|UNO|TRIO)', "ABB"),
    ("Generac", r'\bGenerac\b', "Generac"),
    ("Tesla", r'\bTesla\s+(?:Powerwall|Gateway|Inverter)', "Tesla"),
    ("Schneider", r'\bSchneider|Conext\s+CL', "Schneider Electric"),
    ("Huawei", r'\bHuawei\b', "Huawei"),
    ("GoodWe", r'\bGoodWe\b', "GoodWe"),
    ("Chint", r'\bChint\s+Power|CPS\s+SC', "Chint Power"),
    ("Delta", r'\bDelta\s+(?:M\d|H\d|E\d)', "Delta Electronics"),
    ("Micro Inverter", r'\bmicro[\-\s]?inverter', None),  # Generic micro-inverter mention
]


def extract_manufacturer_model(desc, mfg_list):
    """Extract manufacturer and model from description using known patterns."""
    if not desc:
        return None, None

    for name, pattern, canonical in mfg_list:
        m = re.search(pattern, desc, re.IGNORECASE)
        if m:
            # Try to find model number near the manufacturer name
            start_pos = m.start()
            # Look at text after manufacturer match for model
            after = desc[m.end():m.end() + 50]
            model_match = re.match(r'\s*[\-:,]?\s*([A-Z0-9][\w\-\.]{2,20})', after)
            model = model_match.group(1) if model_match else None
            return canonical, model

    return None, None


def parse_capacity_kw(desc):
    """Extract kW capacity from description."""
    if not desc:
        return None
    # Match "9.6 kW", "250 KW", "9.6kW"
    m = re.search(r'([\d]+\.?\d*)\s*kw', desc, re.IGNORECASE)
    if m:
        try:
            val = float(m.group(1))
            if 0.1 <= val <= 100000:
                return val
        except ValueError:
            pass
    # Match MW
    m = re.search(r'([\d]+\.?\d*)\s*mw', desc, re.IGNORECASE)
    if m:
        try:
            val = float(m.group(1)) * 1000
            if 1 <= val <= 10000000:
                return val
        except ValueError:
            pass
    return None


def parse_panels(desc):
    """Extract panel count and wattage."""
    if not desc:
        return None, None
    panels = None
    m = re.search(r'(\d+)\s*(?:solar\s+)?(?:panel|module|pv\s+module)s?', desc, re.IGNORECASE)
    if m:
        panels = int(m.group(1))
        if panels > 50000:  # likely not a panel count
            panels = None
    watts = None
    m = re.search(r'(\d+)\s*(?:watt|w)\b', desc, re.IGNORECASE)
    if m:
        watts = int(m.group(1))
        if watts < 50 or watts > 1000:
            watts = None
    return panels, watts


def parse_inverter_count(desc):
    """Extract inverter count from description."""
    if not desc:
        return None
    m = re.search(r'(\d+)\s*(?:inverter|micro[\-\s]?inverter)s?', desc, re.IGNORECASE)
    if m:
        count = int(m.group(1))
        if 1 <= count <= 10000:
            return count
    return None


# ---------------------------------------------------------------------------
# City API configurations for re-querying descriptions
# ---------------------------------------------------------------------------

# Only cities whose descriptions commonly contain equipment details
DESCRIPTION_CITIES = {
    "sf": {
        "name": "San Francisco",
        "prefix": "permit_sf",
        "base_url": "https://data.sfgov.org/resource/i98e-djp9.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "solar_where": "UPPER(description) LIKE '%25SOLAR%25' OR UPPER(description) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(description) LIKE '%25PV SYSTEM%25' OR UPPER(description) LIKE '%25PV MODULE%25'",
    },
    "la": {
        "name": "Los Angeles",
        "prefix": "permit_la",
        "base_url": "https://data.lacity.org/resource/pi9x-tg5x.json",
        "desc_field": "work_desc",
        "id_field": "permit_nbr",
        "solar_where": "UPPER(work_desc) LIKE '%25SOLAR%25' OR UPPER(work_desc) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(work_desc) LIKE '%25PV SYSTEM%25' OR UPPER(work_desc) LIKE '%25PV MODULE%25'",
    },
    "chi": {
        "name": "Chicago",
        "prefix": "permit_chicago",
        "base_url": "https://data.cityofchicago.org/resource/ydr8-5enu.json",
        "desc_field": "work_description",
        "id_field": "id",
        "solar_where": "UPPER(work_description) LIKE '%25SOLAR%25' OR UPPER(work_description) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(work_description) LIKE '%25PV SYSTEM%25' OR UPPER(work_description) LIKE '%25PV MODULE%25'",
    },
    "austin": {
        "name": "Austin",
        "prefix": "permit_austin",
        "base_url": "https://data.austintexas.gov/resource/3syk-w9eu.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "solar_where": "UPPER(description) LIKE '%25SOLAR%25' OR UPPER(description) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(description) LIKE '%25PV SYSTEM%25' OR UPPER(description) LIKE '%25PV MODULE%25'",
    },
    "seattle": {
        "name": "Seattle",
        "prefix": "permit_seattle",
        "base_url": "https://data.seattle.gov/resource/76t5-zuj6.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "solar_where": "UPPER(description) LIKE '%25SOLAR%25' OR UPPER(description) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(description) LIKE '%25PV SYSTEM%25' OR UPPER(description) LIKE '%25PV MODULE%25'",
    },
}


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


def supabase_post(table, records):
    """POST batch of records to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
    body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        print(f"  POST error ({e.code}): {err}")
        return False


def supabase_patch(table, record_id, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{record_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
        return False


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def fetch_api_descriptions(city_config):
    """Fetch all solar permit descriptions from a city API."""
    records = []
    offset = 0
    page_size = 1000

    while True:
        # Build URL with Socrata SoQL — %25 is literal % for LIKE wildcards
        where_clause = city_config["solar_where"]
        url = f"{city_config['base_url']}?$where={where_clause}&$limit={page_size}&$offset={offset}"
        # URL-encode the full URL properly
        parsed = urllib.parse.urlparse(url)
        # Only encode the query part
        query_encoded = parsed.query.replace(" ", "%20")
        url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{query_encoded}"

        headers = {"Accept": "application/json"}
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                batch = json.loads(resp.read().decode())
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
            print(f"    API error at offset {offset}: {e}")
            break

        if not batch:
            break

        records.extend(batch)
        print(f"    Fetched page at offset {offset}: {len(batch)} records (total: {len(records)})")
        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(RATE_LIMIT)

    return records


def process_city(city_key, city_config, dry_run=False):
    """Process a single city: fetch descriptions, extract equipment, create records."""
    print(f"\n  Processing {city_config['name']}...")

    # 1. Fetch descriptions from API
    api_records = fetch_api_descriptions(city_config)
    print(f"    Fetched {len(api_records)} solar permits from API")

    if not api_records:
        return 0, 0, 0

    # 2. Build source_id → description map
    desc_map = {}
    id_field = city_config["id_field"]
    desc_field = city_config["desc_field"]
    prefix = city_config["prefix"]
    for rec in api_records:
        permit_id = rec.get(id_field, "")
        if not permit_id:
            continue
        desc = rec.get(desc_field, "")
        if desc:
            source_id = f"{prefix}_{permit_id}"
            desc_map[source_id] = desc

    print(f"    Descriptions mapped: {len(desc_map)}")

    # 3. Load existing installations for this prefix
    existing = {}
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,source_record_id,capacity_dc_kw,capacity_mw,num_modules,num_inverters",
            "source_record_id": f"like.{prefix}_*",
            "limit": 1000,
            "offset": offset,
        })
        if not batch:
            break
        for r in batch:
            existing[r["source_record_id"]] = r
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"    Existing installations: {len(existing)}")

    # 4. Check which installations already have equipment
    installations_with_equip = set()
    inst_ids = [r["id"] for r in existing.values()]
    for i in range(0, len(inst_ids), 50):
        batch_ids = inst_ids[i:i + 50]
        id_filter = ",".join(batch_ids)
        equip = supabase_get("solar_equipment", {
            "select": "installation_id",
            "installation_id": f"in.({id_filter})",
        })
        for e in equip:
            installations_with_equip.add(e["installation_id"])

    print(f"    Already have equipment: {len(installations_with_equip)}")

    # 5. Extract equipment from descriptions
    equipment_created = 0
    capacity_updated = 0
    descriptions_with_equipment = 0

    for source_id, desc in desc_map.items():
        if source_id not in existing:
            continue

        inst = existing[source_id]
        inst_id = inst["id"]

        # Skip if already has equipment
        if inst_id in installations_with_equip:
            continue

        # Extract equipment info
        panel_mfg, panel_model = extract_manufacturer_model(desc, PANEL_MANUFACTURERS)
        inv_mfg, inv_model = extract_manufacturer_model(desc, INVERTER_MANUFACTURERS)
        panels, watts = parse_panels(desc)
        inv_count = parse_inverter_count(desc)
        capacity_kw = parse_capacity_kw(desc)

        # Derive capacity from panel count × wattage if not already known
        if not inst.get("capacity_dc_kw") and panels and watts:
            derived_kw = panels * watts / 1000
            if 0.1 <= derived_kw <= 100000:
                capacity_kw = derived_kw

        has_something = panel_mfg or inv_mfg or panels or inv_count

        if not has_something:
            continue

        descriptions_with_equipment += 1

        if dry_run:
            if descriptions_with_equipment <= 10:
                parts = []
                if panel_mfg:
                    parts.append(f"panel={panel_mfg} {panel_model or ''}")
                if inv_mfg:
                    parts.append(f"inv={inv_mfg} {inv_model or ''}")
                if panels:
                    parts.append(f"qty={panels}")
                if watts:
                    parts.append(f"watts={watts}")
                print(f"      {source_id}: {', '.join(parts)}")
            continue

        # Create equipment records
        equip_records = []

        if panel_mfg or panels:
            eq = {
                "installation_id": inst_id,
                "equipment_type": "module",
                "manufacturer": panel_mfg,
                "model": panel_model,
                "quantity": panels or 1,
            }
            if watts:
                eq["specs"] = json.dumps({"watts": watts})
            equip_records.append(eq)

        if inv_mfg or inv_count:
            eq = {
                "installation_id": inst_id,
                "equipment_type": "inverter",
                "manufacturer": inv_mfg,
                "model": inv_model,
                "quantity": inv_count or 1,
            }
            equip_records.append(eq)

        # Insert equipment
        for eq in equip_records:
            ok = supabase_post("solar_equipment", [eq])
            if ok:
                equipment_created += 1

        # Update capacity if derivable
        if capacity_kw and not inst.get("capacity_dc_kw"):
            patch = {
                "capacity_dc_kw": capacity_kw,
                "capacity_mw": round(capacity_kw / 1000, 3),
            }
            if supabase_patch("solar_installations", inst_id, patch):
                capacity_updated += 1

        # Update module/inverter counts
        count_patch = {}
        if panels and not inst.get("num_modules"):
            count_patch["num_modules"] = panels
        if inv_count and not inst.get("num_inverters"):
            count_patch["num_inverters"] = inv_count
        if count_patch:
            supabase_patch("solar_installations", inst_id, count_patch)

    print(f"    Descriptions with equipment: {descriptions_with_equipment}")
    if not dry_run:
        print(f"    Equipment records created: {equipment_created}")
        print(f"    Capacity updated: {capacity_updated}")

    return descriptions_with_equipment, equipment_created, capacity_updated


def main():
    parser = argparse.ArgumentParser(description="Parse equipment from permit descriptions")
    parser.add_argument("--dry-run", action="store_true", help="Report without creating records")
    parser.add_argument("--city", type=str, help="Comma-separated city keys (sf,la,chi,austin,seattle)")
    args = parser.parse_args()

    print("Permit Description Equipment Parser")
    print("=" * 60)

    # Determine which cities to process
    if args.city:
        city_keys = [c.strip() for c in args.city.split(",")]
    else:
        city_keys = list(DESCRIPTION_CITIES.keys())

    total_found = 0
    total_equip = 0
    total_capacity = 0

    for key in city_keys:
        if key not in DESCRIPTION_CITIES:
            print(f"  Unknown city: {key}")
            continue

        found, equip, cap = process_city(key, DESCRIPTION_CITIES[key], dry_run=args.dry_run)
        total_found += found
        total_equip += equip
        total_capacity += cap

    print(f"\n{'=' * 60}")
    print("Equipment Parser Summary")
    print(f"{'=' * 60}")
    print(f"  Cities processed: {len(city_keys)}")
    print(f"  Descriptions with equipment info: {total_found}")
    if not args.dry_run:
        print(f"  Equipment records created: {total_equip}")
        print(f"  Capacity values updated: {total_capacity}")
    print("\nDone!")


if __name__ == "__main__":
    main()

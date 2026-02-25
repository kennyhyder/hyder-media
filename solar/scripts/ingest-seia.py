#!/usr/bin/env python3
"""
SEIA Major Projects List Ingestion — 8,439 utility-scale solar projects with rich metadata.

Ingests the SEIA Major Projects List Excel file (purchased data, $1K/yr membership).
Contains developer, owner, module technology, tracker type, bifacial flag, storage,
addresses, coordinates, utility/balancing authority — the richest single data source
in the project.

Data: /data/2025-SEIA-MPL-01.26.2026.xlsx (Sheet: "Major Projects List")
Records: 8,439 Solar PV + 1,413 Batteries (we ingest solar PV only)

Strategy:
  Phase 1: Cross-reference by lat/lng + capacity to enrich existing records
  Phase 2: Insert remaining as new installations

Fields mapped:
  plant name → site_name
  developer → developer_name
  owner name → owner_name
  utility name → operator_name
  status simple → site_status (Operating/Under Construction/Under Development)
  ac nameplate capacity MW → capacity_mw
  dc nameplate capacity MW → (stored in equipment record)
  street address/city/state/zip/county → address fields
  latitude/longitude → coordinates
  tracker type → mount_type (fixed_tilt→ground_fixed, single-axis→ground_single_axis, dual-axis→ground_dual_axis)
  module technology → (creates equipment record)
  has direct storage → has_battery_storage
  operating year/month → install_date
  sector name / entity type → (informational)
  balancing authority code → (informational)
  bifacial → (stored in equipment notes)

Usage:
  python3 -u scripts/ingest-seia.py              # Full run (cross-ref + insert)
  python3 -u scripts/ingest-seia.py --dry-run     # Preview without patching
  python3 -u scripts/ingest-seia.py --enrich-only  # Only enrich existing records
  python3 -u scripts/ingest-seia.py --insert-only  # Only insert new records
"""

import os
import sys
import json
import time
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

try:
    import openpyxl
except ImportError:
    print("Error: openpyxl required. Install with: pip3 install openpyxl")
    sys.exit(1)

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

PSQL_CMD = "PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres"

DATA_DIR = Path(__file__).parent.parent / "data"
WORKERS = 10
BATCH_SIZE = 50

# Header row columns (0-indexed from actual data start, after 4 leading None cols)
COL_MAP = {
    "plant_name": 0,
    "developer": 1,
    "status_simple": 2,
    "status_detail": 3,
    "operating_month": 4,
    "operating_year": 5,
    "expected_month_current": 6,
    "expected_year_current": 7,
    "expected_month_original": 8,
    "expected_year_original": 9,
    "capacity_ac_mw": 10,
    "capacity_dc_mw": 11,
    "storage_mwh": 12,
    "address": 13,
    "city": 14,
    "state": 15,
    "zip": 16,
    "county": 17,
    "congressional_district": 18,
    "latitude": 23,
    "longitude": 24,
    "technology": 27,
    "module_technology": 28,
    "tracker_type": 30,
    "bifacial": 31,
    "azimuth": 32,
    "tilt": 33,
    "net_metering": 34,
    "ferc_qf": 36,
    "has_storage": 37,
    "storage_technology": 38,
    "sector_name": 40,
    "ba_code": 41,
    "utility_name": 42,
    "entity_type": 43,
    "owner_name": 44,
    "td_owner": 45,
    "grid_voltage": 46,
    "first_reported_month": 49,
    "first_reported_year": 50,
}


def safe_float(val):
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN check
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_int(val):
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def map_tracker_to_mount(tracker):
    """Map SEIA tracker type to our mount_type enum."""
    if not tracker:
        return None
    t = tracker.lower()
    if "single-axis" in t or "single_axis" in t:
        return "ground_single_axis"
    if "dual-axis" in t or "dual_axis" in t:
        return "ground_dual_axis"
    if "fixed" in t:
        return "ground_fixed"
    return None


def map_status(status):
    """Map SEIA status to our site_status."""
    if not status:
        return "active"
    s = status.lower()
    if "operating" in s:
        return "active"
    if "construction" in s:
        return "proposed"
    if "development" in s:
        return "proposed"
    return "active"


def map_module_tech(mod_tech):
    """Map SEIA module technology to equipment manufacturer hint."""
    if not mod_tech:
        return None, None
    t = mod_tech.lower()
    if "cdte" in t:
        return "First Solar", "Thin Film CdTe"
    if "cigs" in t:
        return None, "Thin Film CIGS"
    if "a-si" in t or "a_si" in t:
        return None, "Thin Film a-Si"
    if "crystalline" in t:
        return None, "Crystalline Silicon"
    if "thin-film" in t or "thin_film" in t:
        return None, "Thin Film"
    return None, None


def parse_seia(xlsx_path):
    """Parse SEIA Major Projects List for solar PV records."""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Major Projects List"]

    records = []
    for i, row in enumerate(ws.iter_rows(min_row=1, values_only=True)):
        if i < 5:  # Skip 4 empty + 1 header row
            continue

        vals = list(row)
        # Data starts at column 4 (0-indexed)
        data = vals[4:] if len(vals) > 4 else vals

        def get(key):
            idx = COL_MAP.get(key)
            if idx is None or idx >= len(data):
                return None
            return data[idx]

        tech = safe_str(get("technology"))
        if tech != "Solar Photovoltaic":
            continue

        plant_name = safe_str(get("plant_name"))
        state = safe_str(get("state"))
        if not state:
            continue

        capacity_ac = safe_float(get("capacity_ac_mw"))
        capacity_dc = safe_float(get("capacity_dc_mw"))
        lat = safe_float(get("latitude"))
        lng = safe_float(get("longitude"))

        # Build install date from operating year/month
        op_year = safe_int(get("operating_year"))
        op_month = safe_int(get("operating_month"))
        install_date = None
        if op_year and op_year > 1990:
            if op_month and 1 <= op_month <= 12:
                install_date = f"{op_year}-{op_month:02d}-01"
            else:
                install_date = f"{op_year}-01-01"

        # Build source_record_id from plant name + state + capacity
        name_key = re.sub(r'[^a-z0-9]', '_', (plant_name or "").lower())[:40]
        src_id = f"seia_{name_key}_{state}_{capacity_ac or 0}"

        record = {
            "source_record_id": src_id,
            "site_name": plant_name,
            "developer_name": safe_str(get("developer")),
            "owner_name": safe_str(get("owner_name")),
            "operator_name": safe_str(get("utility_name")),
            "state": state,
            "county": safe_str(get("county")),
            "city": safe_str(get("city")),
            "zip_code": safe_str(get("zip")),
            "address": safe_str(get("address")),
            "latitude": lat,
            "longitude": lng,
            "capacity_mw": capacity_ac,
            "capacity_dc_mw": capacity_dc,
            "install_date": install_date,
            "site_status": map_status(safe_str(get("status_simple"))),
            "site_type": "utility",
            "mount_type": map_tracker_to_mount(safe_str(get("tracker_type"))),
            "module_technology": safe_str(get("module_technology")),
            "bifacial": safe_str(get("bifacial")),
            "has_battery_storage": safe_str(get("has_storage")) == "Y",
            "storage_mwh": safe_float(get("storage_mwh")),
            "storage_technology": safe_str(get("storage_technology")),
            "sector_name": safe_str(get("sector_name")),
            "entity_type": safe_str(get("entity_type")),
            "ba_code": safe_str(get("ba_code")),
            "td_owner": safe_str(get("td_owner")),
        }
        records.append(record)

    wb.close()
    return records


def supabase_request(method, path, data=None, params=None, retries=3):
    """Generic Supabase REST request."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if method == "POST":
        headers["Prefer"] = "return=minimal,resolution=ignore-duplicates"
    elif method == "PATCH":
        headers["Prefer"] = "return=minimal"

    body = json.dumps(data, allow_nan=False).encode() if data else None

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201, 204):
                    return True
                return resp.read().decode()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                err_msg = ""
                if hasattr(e, "read"):
                    try:
                        err_msg = e.read().decode()
                    except:
                        pass
                return err_msg or str(e) or False


def load_existing_installations():
    """Load existing installations via psql for cross-referencing."""
    print("  Loading existing installations via psql...")
    sql = """
    SELECT json_agg(t) FROM (
      SELECT id, site_name, state, capacity_mw, latitude, longitude,
             owner_name, developer_name, operator_name, mount_type,
             source_record_id
      FROM solar_installations
      WHERE site_type = 'utility' AND state IS NOT NULL
      ORDER BY id
    ) t;
    """
    result = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "{sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr.strip()}")
        return []

    raw = result.stdout.strip()
    if not raw or raw == "null":
        return []

    return json.loads(raw)


def haversine_km(lat1, lon1, lat2, lon2):
    """Approximate distance in km between two lat/lng points."""
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def cross_reference(seia_records, existing):
    """Match SEIA records to existing installations by location + capacity."""
    # Build spatial index by state
    by_state = {}
    for inst in existing:
        st = inst.get("state")
        if st:
            by_state.setdefault(st, []).append(inst)

    matches = []  # (seia_record, existing_id, patch_data)
    unmatched = []

    for rec in seia_records:
        state = rec["state"]
        lat = rec["latitude"]
        lng = rec["longitude"]
        cap = rec["capacity_mw"]

        if not lat or not lng or not cap:
            unmatched.append(rec)
            continue

        candidates = by_state.get(state, [])
        best_match = None
        best_dist = 999

        for inst in candidates:
            inst_lat = safe_float(inst.get("latitude"))
            inst_lng = safe_float(inst.get("longitude"))
            inst_cap = safe_float(inst.get("capacity_mw"))

            if not inst_lat or not inst_lng:
                continue

            dist = haversine_km(lat, lng, inst_lat, inst_lng)

            # Must be within 2km AND capacity within 25%
            if dist > 2.0:
                continue

            if inst_cap and cap:
                cap_ratio = min(cap, inst_cap) / max(cap, inst_cap)
                if cap_ratio < 0.75:
                    continue

            if dist < best_dist:
                best_dist = dist
                best_match = inst

        if best_match:
            # Build enrichment patch
            patch = {}
            if rec["developer_name"] and not best_match.get("developer_name"):
                patch["developer_name"] = rec["developer_name"]
            if rec["owner_name"] and not best_match.get("owner_name"):
                patch["owner_name"] = rec["owner_name"]
            if rec["operator_name"] and not best_match.get("operator_name"):
                patch["operator_name"] = rec["operator_name"]
            if rec["mount_type"] and not best_match.get("mount_type"):
                patch["mount_type"] = rec["mount_type"]
            if rec["site_name"] and not best_match.get("site_name"):
                patch["site_name"] = rec["site_name"]

            matches.append((rec, best_match["id"], patch))
        else:
            unmatched.append(rec)

    return matches, unmatched


def create_equipment_record(inst_id, rec, data_source_id):
    """Create module equipment record from SEIA module technology."""
    mod_tech = rec.get("module_technology")
    if not mod_tech:
        return None

    manufacturer, technology = map_module_tech(mod_tech)
    capacity_dc = rec.get("capacity_dc_mw")

    equip = {
        "installation_id": inst_id,
        "equipment_type": "module",
        "data_source_id": data_source_id,
    }
    if manufacturer:
        equip["manufacturer"] = manufacturer
    if technology:
        equip["model"] = technology
    if capacity_dc:
        equip["capacity_kw"] = round(capacity_dc * 1000, 2)

    # Add bifacial note
    bifacial = rec.get("bifacial")
    if bifacial and bifacial.upper() == "Y":
        equip["notes"] = "Bifacial"

    return equip


def main():
    parser = argparse.ArgumentParser(description="Ingest SEIA Major Projects List")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--enrich-only", action="store_true", help="Only enrich existing records")
    parser.add_argument("--insert-only", action="store_true", help="Only insert new records")
    parser.add_argument("--file", type=str, help="Path to SEIA Excel file")
    args = parser.parse_args()

    print("SEIA Major Projects List Ingestion")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    # Find SEIA file
    if args.file:
        xlsx_path = Path(args.file)
    else:
        # Find most recent SEIA file
        seia_files = sorted(DATA_DIR.glob("*SEIA*MPL*.xlsx"))
        if not seia_files:
            seia_files = sorted(DATA_DIR.glob("*SEIA*.xlsx"))
        if not seia_files:
            print("  Error: No SEIA file found in data/. Use --file to specify.")
            sys.exit(1)
        xlsx_path = seia_files[-1]

    print(f"  File: {xlsx_path.name} ({xlsx_path.stat().st_size / 1024:.0f} KB)")

    # Parse
    print("\nParsing SEIA Major Projects List...")
    records = parse_seia(xlsx_path)
    print(f"  Solar PV records: {len(records)}")

    # Summary
    states = {}
    for r in records:
        states[r["state"]] = states.get(r["state"], 0) + 1
    top_states = sorted(states.items(), key=lambda x: -x[1])[:10]
    print(f"  Top states: {', '.join(f'{s}:{c}' for s, c in top_states)}")

    with_developer = sum(1 for r in records if r["developer_name"])
    with_owner = sum(1 for r in records if r["owner_name"])
    with_mount = sum(1 for r in records if r["mount_type"])
    with_module = sum(1 for r in records if r["module_technology"])
    print(f"  With developer: {with_developer} ({with_developer/len(records)*100:.1f}%)")
    print(f"  With owner: {with_owner} ({with_owner/len(records)*100:.1f}%)")
    print(f"  With mount_type: {with_mount} ({with_mount/len(records)*100:.1f}%)")
    print(f"  With module_tech: {with_module} ({with_module/len(records)*100:.1f}%)")

    # Get or create data source
    print("\nEnsuring data source exists...")
    ds_check = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "SELECT id FROM solar_data_sources WHERE name = 'seia_mpl' LIMIT 1;" """,
        shell=True, capture_output=True, text=True, timeout=30,
    )
    data_source_id = ds_check.stdout.strip()

    if not data_source_id:
        print("  Creating data source 'seia_mpl'...")
        if not args.dry_run:
            ds_insert = subprocess.run(
                f"""{PSQL_CMD} -t -A -c "INSERT INTO solar_data_sources (name, description, url, record_count) VALUES ('seia_mpl', 'SEIA Major Projects List (purchased, \\$1K/yr)', 'https://www.seia.org/research-resources/major-solar-projects-list', {len(records)}) RETURNING id;" """,
                shell=True, capture_output=True, text=True, timeout=30,
            )
            data_source_id = ds_insert.stdout.strip()
            print(f"  Created: {data_source_id}")
        else:
            data_source_id = "dry-run-id"

    # Phase 1: Cross-reference with existing installations
    if not args.insert_only:
        print("\n" + "=" * 60)
        print("Phase 1: Cross-Reference (enrich existing records)")
        print("=" * 60)

        existing = load_existing_installations()
        print(f"  Loaded {len(existing)} utility-scale installations")

        matches, unmatched = cross_reference(records, existing)
        print(f"  Matched: {len(matches)} SEIA records to existing installations")
        print(f"  Unmatched: {len(unmatched)} (candidates for new insertion)")

        # Count enrichment opportunities
        enrichments = {"developer_name": 0, "owner_name": 0, "operator_name": 0, "mount_type": 0, "site_name": 0}
        for rec, inst_id, patch in matches:
            for field in enrichments:
                if field in patch:
                    enrichments[field] += 1

        print(f"\n  Enrichment opportunities:")
        for field, count in enrichments.items():
            print(f"    {field}: {count}")

        if args.dry_run:
            print(f"\n  [DRY RUN] Sample enrichment patches:")
            for rec, inst_id, patch in matches[:10]:
                if patch:
                    print(f"    {inst_id}: {patch}")
        elif matches:
            print(f"\n  Applying {len(matches)} enrichment patches...")
            applied = 0
            errors = 0

            def _do_enrich(item):
                _, inst_id, patch = item
                if not patch:
                    return True
                url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{inst_id}"
                headers = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                }
                body = json.dumps(patch, allow_nan=False).encode()
                for attempt in range(3):
                    try:
                        req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
                        with urllib.request.urlopen(req, timeout=30) as resp:
                            return True
                    except Exception:
                        if attempt < 2:
                            time.sleep(2 ** (attempt + 1))
                return False

            with ThreadPoolExecutor(max_workers=WORKERS) as executor:
                futures = {executor.submit(_do_enrich, item): item for item in matches}
                for future in as_completed(futures):
                    if future.result():
                        applied += 1
                    else:
                        errors += 1
                    if (applied + errors) % 200 == 0:
                        print(f"    Progress: {applied} applied, {errors} errors")

            print(f"  Applied: {applied}, Errors: {errors}")
    else:
        unmatched = records

    # Phase 2: Insert unmatched as new installations
    if not args.enrich_only:
        print("\n" + "=" * 60)
        print("Phase 2: Insert New Installations")
        print("=" * 60)
        print(f"  Candidates: {len(unmatched)}")

        # Check which source_record_ids already exist
        existing_ids = set()
        src_ids = [r["source_record_id"] for r in unmatched]
        # Check in batches via psql
        for i in range(0, len(src_ids), 500):
            batch = src_ids[i:i+500]
            ids_str = "','".join(batch)
            result = subprocess.run(
                f"""{PSQL_CMD} -t -A -c "SELECT source_record_id FROM solar_installations WHERE source_record_id IN ('{ids_str}');" """,
                shell=True, capture_output=True, text=True, timeout=60,
            )
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    existing_ids.add(line.strip())

        new_records = [r for r in unmatched if r["source_record_id"] not in existing_ids]
        print(f"  Already exist: {len(unmatched) - len(new_records)}")
        print(f"  Net new: {len(new_records)}")

        if args.dry_run:
            print(f"\n  [DRY RUN] Sample new records:")
            for rec in new_records[:10]:
                print(f"    {rec['source_record_id']}: {rec['site_name']} ({rec['state']}, {rec['capacity_mw']} MW)")
                if rec["developer_name"]:
                    print(f"      developer: {rec['developer_name']}")
                if rec["owner_name"]:
                    print(f"      owner: {rec['owner_name']}")
        elif new_records:
            print(f"\n  Inserting {len(new_records)} new installations...")
            created = 0
            errors = 0
            equipment_created = 0

            for i in range(0, len(new_records), BATCH_SIZE):
                batch = new_records[i:i+BATCH_SIZE]

                # Build installation records
                inst_batch = []
                for rec in batch:
                    inst = {
                        "source_record_id": rec["source_record_id"],
                        "data_source_id": data_source_id,
                        "site_name": rec["site_name"],
                        "site_type": "utility",
                        "site_status": rec["site_status"],
                        "state": rec["state"],
                        "county": rec["county"],
                        "city": rec["city"],
                        "zip_code": rec["zip_code"],
                        "address": rec["address"],
                        "capacity_mw": rec["capacity_mw"],
                        "install_date": rec["install_date"],
                        "mount_type": rec["mount_type"],
                        "developer_name": rec["developer_name"],
                        "owner_name": rec["owner_name"],
                        "operator_name": rec["operator_name"],
                        "has_battery_storage": rec["has_battery_storage"],
                        "location_precision": "exact" if rec["latitude"] else "address",
                    }
                    if rec["latitude"] and rec["longitude"]:
                        inst["latitude"] = rec["latitude"]
                        inst["longitude"] = rec["longitude"]
                    inst_batch.append(inst)

                # Ensure all records have same keys
                all_keys = set()
                for inst in inst_batch:
                    all_keys.update(inst.keys())
                for inst in inst_batch:
                    for key in all_keys:
                        if key not in inst:
                            inst[key] = None

                result = supabase_request("POST", "solar_installations", inst_batch)
                if result is True:
                    created += len(batch)
                else:
                    errors += len(batch)
                    if errors <= len(batch) * 2:
                        print(f"    Batch error at {i}: {result}")

                if (i + BATCH_SIZE) % 500 == 0 or i + BATCH_SIZE >= len(new_records):
                    print(f"    Progress: {created} created, {errors} errors")

            print(f"\n  Created: {created}")
            print(f"  Errors: {errors}")

            # Create equipment records for new installations
            if created > 0:
                print(f"\n  Creating equipment records for new installations...")
                # Load newly created installation IDs
                new_src_ids = [r["source_record_id"] for r in new_records[:created]]
                id_map = {}
                for i in range(0, len(new_src_ids), 500):
                    batch_ids = new_src_ids[i:i+500]
                    ids_str = "','".join(batch_ids)
                    result = subprocess.run(
                        f"""{PSQL_CMD} -t -A -c "SELECT id, source_record_id FROM solar_installations WHERE source_record_id IN ('{ids_str}');" """,
                        shell=True, capture_output=True, text=True, timeout=60,
                    )
                    for line in result.stdout.strip().split("\n"):
                        if "|" in line:
                            parts = line.split("|")
                            id_map[parts[1]] = parts[0]

                equip_batch = []
                for rec in new_records[:created]:
                    inst_id = id_map.get(rec["source_record_id"])
                    if not inst_id:
                        continue
                    equip = create_equipment_record(inst_id, rec, data_source_id)
                    if equip:
                        equip_batch.append(equip)

                if equip_batch:
                    for i in range(0, len(equip_batch), BATCH_SIZE):
                        batch = equip_batch[i:i+BATCH_SIZE]
                        # Ensure key consistency
                        all_keys = set()
                        for e in batch:
                            all_keys.update(e.keys())
                        for e in batch:
                            for key in all_keys:
                                if key not in e:
                                    e[key] = None

                        result = supabase_request("POST", "solar_equipment", batch)
                        if result is True:
                            equipment_created += len(batch)

                    print(f"  Equipment created: {equipment_created}")

    # Summary
    print(f"\n{'='*60}")
    print("SEIA Ingestion Summary")
    print(f"{'='*60}")
    print(f"  Solar PV records parsed: {len(records)}")
    if not args.insert_only:
        print(f"  Matched to existing: {len(matches) if not args.insert_only else 'N/A'}")
        if not args.dry_run and not args.insert_only:
            print(f"  Enrichment patches: {applied}")
    if not args.enrich_only:
        print(f"  New installations: {len(new_records) if not args.enrich_only else 'N/A'}")

    print("\nDone!")


if __name__ == "__main__":
    main()

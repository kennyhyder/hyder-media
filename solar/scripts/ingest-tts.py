#!/usr/bin/env python3
"""
Tracking the Sun (TTS) Data Ingestion Script

Downloads LBNL Tracking the Sun 2024 data from OEDI S3 bucket
and imports commercial solar installations (>= 25 kW) including:
- Panel manufacturer/model/wattage
- Inverter manufacturer/model
- Battery manufacturer/model
- Installer name
- Installation date, price, location

Source: https://data.openei.org/submissions/3
Data: s3://oedi-data-lake/tracking-the-sun/2024/
"""

import os
import sys
import json
import urllib.request
import tempfile
from pathlib import Path

# Dependencies
try:
    import pyarrow.parquet as pq
    import pyarrow.compute as pc
except ImportError:
    print("Installing pyarrow...")
    os.system(f"{sys.executable} -m pip install pyarrow")
    import pyarrow.parquet as pq
    import pyarrow.compute as pc

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "tts_2024"

# S3 bucket base URL for Tracking the Sun 2024
S3_BASE = "https://oedi-data-lake.s3.amazonaws.com/tracking-the-sun/2024"

# All 27 states in the 2024 dataset
TTS_STATES = [
    "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "IL", "MA",
    "MD", "ME", "MN", "NH", "NJ", "NM", "NY", "OH", "OR", "PA",
    "RI", "TX", "UT", "VA", "VT", "WA", "WI",
]

# Minimum system size in kW for commercial
MIN_SIZE_KW = 25


def supabase_request(method, table, data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }

    if method == "GET":
        headers["Prefer"] = "count=exact"

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            if method == "GET":
                result = json.loads(resp.read())
                return result
            return resp.status
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  Supabase error ({e.code}): {error_body[:200]}")
        return None


def list_s3_parquet_files(state):
    """List parquet files for a state using S3 listing."""
    prefix = f"tracking-the-sun/2024/state={state}/"
    list_url = f"https://oedi-data-lake.s3.amazonaws.com/?prefix={prefix}&list-type=2"
    try:
        req = urllib.request.Request(list_url)
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode()
            # Parse XML to find Key elements
            import xml.etree.ElementTree as ET
            root = ET.fromstring(content)
            ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
            keys = []
            for contents in root.findall("s3:Contents", ns):
                key = contents.find("s3:Key", ns)
                if key is not None and key.text.endswith(".parquet"):
                    keys.append(key.text)
            return keys
    except Exception as e:
        print(f"  Error listing S3 for {state}: {e}")
        return []


def download_state_data(state):
    """Download parquet file for a state, returning local path."""
    state_dir = DATA_DIR / f"state={state}"
    state_dir.mkdir(parents=True, exist_ok=True)

    # Check for cached files
    cached = list(state_dir.glob("*.parquet"))
    if cached:
        return cached[0]

    # List files from S3
    keys = list_s3_parquet_files(state)
    if not keys:
        print(f"  No parquet files found for {state}")
        return None

    key = keys[0]
    filename = key.split("/")[-1]
    local_path = state_dir / filename

    url = f"https://oedi-data-lake.s3.amazonaws.com/{key}"
    print(f"  Downloading {state}...")
    try:
        urllib.request.urlretrieve(url, local_path)
        size_mb = local_path.stat().st_size / 1024 / 1024
        print(f"    {size_mb:.1f} MB")
        return local_path
    except Exception as e:
        print(f"  Error downloading {state}: {e}")
        return None


def read_commercial_systems(filepath, state):
    """Read parquet file and filter to commercial systems >= 25 kW."""
    table = pq.read_table(filepath)
    df = table.to_pydict()
    num_rows = len(df.get("system_id_1", []))

    commercial = []
    for i in range(num_rows):
        segment = df.get("customer_segment", [""])[i]
        size_dc = df.get("pv_system_size_dc", [None])[i]

        # Include COM, GOV, SCHOOL, NON-PROFIT, and NON-RES segments
        # Also include unknown segment if size >= 25 kW (likely commercial)
        is_commercial = segment in ("COM", "GOV", "SCHOOL", "NON-PROFIT", "NON-RES")
        is_large_enough = size_dc is not None and size_dc != -1 and size_dc >= MIN_SIZE_KW

        if is_large_enough and (is_commercial or segment == "-1"):
            record = {}
            for key in df:
                record[key] = df[key][i]
            record["_state"] = state
            commercial.append(record)

    return commercial


def safe_str(val):
    """Safely convert to string, handling -1 as missing."""
    if val is None or val == -1 or val == "-1" or val == "":
        return None
    s = str(val).strip()
    return s if s else None


def safe_float(val):
    """Safely convert to float, handling -1 as missing."""
    if val is None or val == -1 or val == "-1" or val == "":
        return None
    try:
        f = float(val)
        return f if f >= 0 else None
    except (ValueError, TypeError):
        return None


def safe_int(val):
    """Safely convert to int, handling -1 as missing."""
    if val is None or val == -1 or val == "-1" or val == "":
        return None
    try:
        i = int(val)
        return i if i >= 0 else None
    except (ValueError, TypeError):
        return None


def format_date(val):
    """Format a date value to ISO string."""
    if val is None or val == -1 or val == "-1":
        return None
    try:
        # pyarrow dates come as datetime.date objects
        import datetime
        if isinstance(val, (datetime.date, datetime.datetime)):
            return val.isoformat()
        return str(val)
    except Exception:
        return None


def determine_site_type(segment, size_dc):
    """Determine site type from TTS customer segment."""
    if size_dc and size_dc >= 1000:
        return "utility"
    return "commercial"


def get_or_create_data_source():
    """Get or create the TTS data source record."""
    result = supabase_request(
        "GET", "solar_data_sources",
        params={"name": "eq.tts", "select": "id"}
    )
    if result and len(result) > 0:
        return result[0]["id"]

    import uuid
    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "tts",
        "description": "LBNL Tracking the Sun 2024 - Distributed Solar Installation Data",
        "url": "https://emp.lbl.gov/tracking-the-sun/",
        "record_count": 0,
    })
    return ds_id


def get_existing_source_ids():
    """Get all existing source_record_ids to avoid duplicates."""
    print("Fetching existing TTS installations...")
    all_ids = set()
    offset = 0
    limit = 1000
    while True:
        result = supabase_request(
            "GET", "solar_installations",
            params={
                "select": "source_record_id",
                "source_record_id": "like.tts3_%",
                "limit": str(limit),
                "offset": str(offset),
            }
        )
        if not result:
            break
        for r in result:
            if r.get("source_record_id"):
                all_ids.add(r["source_record_id"])
        if len(result) < limit:
            break
        offset += limit
    print(f"  {len(all_ids)} existing TTS installations found")
    return all_ids


def get_or_create_installer(name, data_source_id, installer_cache):
    """Get or create an installer record, with in-memory cache."""
    if not name:
        return None, None

    name_clean = name.strip()
    if not name_clean:
        return None, None

    # Check cache
    if name_clean in installer_cache:
        return installer_cache[name_clean], name_clean

    # Check DB
    import urllib.parse
    encoded = urllib.parse.quote(name_clean, safe='')
    result = supabase_request(
        "GET", "solar_installers",
        params={"name": f"eq.{encoded}", "select": "id"}
    )
    if result and len(result) > 0:
        installer_cache[name_clean] = result[0]["id"]
        return result[0]["id"], name_clean

    # Create
    import uuid
    inst_id = str(uuid.uuid4())
    normalized = name_clean.lower().strip()
    res = supabase_request("POST", "solar_installers", {
        "id": inst_id,
        "name": name_clean,
        "normalized_name": normalized,
    })
    if res:
        installer_cache[name_clean] = inst_id
        return inst_id, name_clean
    return None, name_clean


def build_equipment_records(record, inst_id, data_source_id):
    """Build equipment records with uniform keys for batch insert."""
    equipment = []
    import uuid

    def make_eq(eq_type, mfr, model, qty, tech=None, wattage=None, inv_kw=None, specs=None):
        return {
            "id": str(uuid.uuid4()),
            "installation_id": inst_id,
            "equipment_type": eq_type,
            "manufacturer": mfr,
            "model": model,
            "quantity": qty or 0,
            "module_technology": tech,
            "module_wattage_w": wattage,
            "inverter_capacity_kw": inv_kw,
            "equipment_status": "active",
            "data_source_id": data_source_id,
            "specs": specs,
        }

    for n in range(1, 4):
        mfr = safe_str(record.get(f"module_manufacturer_{n}"))
        model = safe_str(record.get(f"module_model_{n}"))
        if mfr or model:
            bifacial = record.get(f"bifacial_module_{n}")
            specs = {"bifacial": True} if bifacial == 1 else None
            equipment.append(make_eq(
                "module", mfr, model,
                safe_int(record.get(f"module_quantity_{n}")),
                tech=safe_str(record.get(f"technology_module_{n}")) or "PV",
                wattage=safe_int(record.get(f"nameplate_capacity_module_{n}")),
                specs=specs,
            ))

    for n in range(1, 4):
        mfr = safe_str(record.get(f"inverter_manufacturer_{n}"))
        model = safe_str(record.get(f"inverter_model_{n}"))
        if mfr or model:
            micro = record.get(f"micro_inverter_{n}")
            specs = {"micro_inverter": True} if micro == 1 else None
            equipment.append(make_eq(
                "inverter", mfr, model,
                safe_int(record.get(f"inverter_quantity_{n}")),
                inv_kw=safe_float(record.get(f"output_capacity_inverter_{n}")),
                specs=specs,
            ))

    batt_mfr = safe_str(record.get("battery_manufacturer"))
    batt_model = safe_str(record.get("battery_model"))
    if batt_mfr or batt_model:
        batt_kw = safe_float(record.get("battery_rated_capacity_kw"))
        batt_kwh = safe_float(record.get("battery_rated_capacity_kwh"))
        specs = {}
        if batt_kw: specs["rated_capacity_kw"] = batt_kw
        if batt_kwh: specs["rated_capacity_kwh"] = batt_kwh
        equipment.append(make_eq(
            "battery", batt_mfr, batt_model, 1,
            specs=specs if specs else None,
        ))

    return equipment


def main(states=None):
    """Run TTS ingestion. If states list is provided, only process those states."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    data_source_id = get_or_create_data_source()
    existing_ids = get_existing_source_ids()
    installer_cache = {}

    total_created = 0
    total_equipment = 0
    total_skipped = 0
    total_errors = 0

    process_states = states if states else TTS_STATES
    for state in process_states:
        print(f"\n--- {state} ---")
        filepath = download_state_data(state)
        if not filepath:
            continue

        systems = read_commercial_systems(filepath, state)
        print(f"  {len(systems)} commercial systems >= {MIN_SIZE_KW} kW")

        if not systems:
            continue

        state_created = 0
        state_skipped = 0
        state_errors = 0

        import uuid
        BATCH_SIZE = 50  # Supabase handles arrays well at this size

        inst_batch = []
        equip_batch = []

        for i, rec in enumerate(systems):
            sys_id = safe_str(rec.get("system_id_1")) or safe_str(rec.get("system_id_2"))
            source_record_id = f"tts3_{state}_{sys_id}_{i}" if sys_id else f"tts3_{state}_row{i}"

            if source_record_id in existing_ids:
                state_skipped += 1
                continue

            inst_id = str(uuid.uuid4())
            size_dc = safe_float(rec.get("pv_system_size_dc"))
            install_date = format_date(rec.get("installation_date"))
            price = safe_float(rec.get("total_installed_price"))
            city = safe_str(rec.get("city"))
            zip_code = safe_str(rec.get("zip_code"))
            if zip_code and len(zip_code) > 10:
                zip_code = zip_code[:10]

            # Installer (still individual lookups, but cached)
            installer_name = safe_str(rec.get("installer_name"))
            installer_id, installer_name_clean = get_or_create_installer(
                installer_name, data_source_id, installer_cache
            )

            tracking = rec.get("tracking")
            ground = rec.get("ground_mounted")
            mount_type = "ground" if ground == 1 else "rooftop" if ground == 0 else None
            tracking_type = "single-axis" if tracking == 1 else "fixed" if tracking == 0 else None

            has_battery = rec.get("technology_type") == "pv+storage"
            batt_kwh = safe_float(rec.get("battery_rated_capacity_kwh"))

            cost_per_watt = None
            if price and size_dc and size_dc > 0:
                cost_per_watt = round(price / (size_dc * 1000), 3)

            new_inst = {
                "id": inst_id,
                "site_name": city,
                "site_type": determine_site_type(rec.get("customer_segment"), size_dc),
                "city": city,
                "state": state,
                "zip_code": zip_code,
                "capacity_dc_kw": round(size_dc, 3) if size_dc else None,
                "capacity_mw": round(size_dc / 1000, 3) if size_dc and size_dc >= 1000 else None,
                "mount_type": mount_type,
                "tracking_type": tracking_type,
                "num_modules": safe_int(rec.get("module_quantity_1")),
                "has_battery_storage": has_battery,
                "battery_capacity_kwh": batt_kwh,
                "installer_id": installer_id,
                "installer_name": installer_name_clean,
                "install_date": install_date,
                "site_status": "active",
                "total_cost": round(price, 2) if price else None,
                "cost_per_watt": cost_per_watt,
                "source_record_id": source_record_id,
                "data_source_id": data_source_id,
            }
            # Don't strip None - batch insert requires all keys to match
            inst_batch.append(new_inst)

            # Build equipment for this installation
            eq_records = build_equipment_records(rec, inst_id, data_source_id)
            equip_batch.extend(eq_records)

            # Flush batches
            if len(inst_batch) >= BATCH_SIZE:
                result = supabase_request("POST", "solar_installations", inst_batch)
                if result:
                    state_created += len(inst_batch)
                else:
                    state_errors += len(inst_batch)
                inst_batch = []

                if equip_batch:
                    eq_result = supabase_request("POST", "solar_equipment", equip_batch)
                    if eq_result:
                        total_equipment += len(equip_batch)
                    equip_batch = []

            if (i + 1) % 500 == 0:
                print(f"    {i+1}/{len(systems)}: {state_created} created, {state_skipped} skipped, {state_errors} errors")

        # Flush remaining
        if inst_batch:
            result = supabase_request("POST", "solar_installations", inst_batch)
            if result:
                state_created += len(inst_batch)
            else:
                state_errors += len(inst_batch)
        if equip_batch:
            eq_result = supabase_request("POST", "solar_equipment", equip_batch)
            if eq_result:
                total_equipment += len(equip_batch)

        total_created += state_created
        total_skipped += state_skipped
        total_errors += state_errors
        print(f"  {state}: {state_created} created, {state_skipped} skipped, {state_errors} errors")

    # Update data source record count
    supabase_request(
        "PATCH", "solar_data_sources",
        data={"record_count": total_created},
        params={"id": f"eq.{data_source_id}"}
    )

    print(f"\n{'='*50}")
    print(f"Tracking the Sun ingestion complete!")
    print(f"  Installations created: {total_created}")
    print(f"  Equipment records: {total_equipment}")
    print(f"  Skipped (existing): {total_skipped}")
    print(f"  Errors: {total_errors}")
    print(f"  Installers cached: {len(installer_cache)}")


if __name__ == "__main__":
    # Accept optional state arguments: python ingest-tts.py NY NJ MA TX
    if len(sys.argv) > 1:
        states = [s.upper() for s in sys.argv[1:]]
        invalid = [s for s in states if s not in TTS_STATES]
        if invalid:
            print(f"Error: Unknown states: {invalid}")
            print(f"Valid states: {TTS_STATES}")
            sys.exit(1)
        print(f"Processing specific states: {states}")
        main(states)
    else:
        main()

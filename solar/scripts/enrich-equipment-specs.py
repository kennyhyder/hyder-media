#!/usr/bin/env python3
"""
Equipment Specs Enrichment Script

Cross-references our solar_equipment records against the NREL SAM CEC database
to fill in module_wattage_w, inverter_capacity_kw, and detailed specs (JSONB).

CEC Modules: ~20,700 panel models with STC wattage, efficiency, technology, dimensions
CEC Inverters: ~2,000 inverter models with AC power, voltage, MPPT range
"""

import os
import sys
import json
import csv
import re
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "cec_specs"
MODULES_FILE = DATA_DIR / "CEC_Modules.csv"
INVERTERS_FILE = DATA_DIR / "CEC_Inverters.csv"


def supabase_request(method, table, data=None, params=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if headers_extra:
        headers.update(headers_extra)

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        print(f"  Supabase error ({e.code}): {error_body}")
        return None


# Manufacturer aliases: map variant names to a canonical form for matching.
# Both DB and CEC names are checked against these after normalization.
MANUFACTURER_ALIASES = {
    # Hanwha / Q CELLS variants
    "hanwha q cells": "qcells",
    "hanwha q cells co": "qcells",
    "hanwha qcells": "qcells",
    "hanwha qcells qidong": "qcells",
    "hanwhaqcells": "qcells",
    "qcells north": "qcells",
    "q cells": "qcells",
    "hanwha solarone": "hanwha",
    # Canadian Solar variants
    "canadian": "canadian solar",
    "csi": "canadian solar",
    # SolarEdge variants
    "solaredge": "solaredge",
    # Solectria variants
    "solectria renewables": "solectria",
    "yaskawa solectria": "solectria",
    # Advanced Energy variants
    "advanced": "advanced energy",
    # PV Powered (acquired by Advanced Energy)
    "pv powered": "advanced energy",
    # Fronius variants
    "fronius": "fronius",
    "fronius international": "fronius",
    # Power-One (acquired by ABB)
    "one": "abb",
}


def normalize(s):
    """Normalize a string for fuzzy matching."""
    if not s:
        return ""
    s = s.lower().strip()
    # Remove common suffixes that vary between sources
    s = re.sub(r'\s*(inc\.?|llc\.?|ltd\.?|co\.?,?\s*ltd\.?|corp\.?|gmbh|pte\.?|s\.?a\.?)\s*$', '', s)
    s = re.sub(r'\b(technologies|technology|solar|energy|power|america|americas|usa|us)\b', ' ', s)
    s = re.sub(r'[,.\-_/\\()]+', ' ', s)
    # Collapse "q cells" / "q-cells" to "qcells" before final cleanup
    s = re.sub(r'\bq\s+cells\b', 'qcells', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def resolve_alias(norm_name):
    """Resolve a normalized manufacturer name through the alias table."""
    if norm_name in MANUFACTURER_ALIASES:
        return MANUFACTURER_ALIASES[norm_name]
    # Try substring match against alias keys
    for alias_key, canonical in MANUFACTURER_ALIASES.items():
        if alias_key in norm_name or norm_name in alias_key:
            return canonical
    return norm_name


def normalize_model(s):
    """Normalize a model string - less aggressive than manufacturer normalization."""
    if not s:
        return ""
    s = s.strip()
    # Remove voltage tags like [208V], [480V], [SI1-JUN20]
    s = re.sub(r'\[.*?\]', '', s)
    s = re.sub(r'\(.*?\)', '', s)
    # Remove /BFG suffix (Hanwha bifacial glass variant, not always in CEC)
    s = re.sub(r'/BFG\b', '', s, flags=re.IGNORECASE)
    s = s.strip()
    s = re.sub(r'\s+', ' ', s)
    return s.lower().strip()


def load_cec_modules():
    """Load CEC modules into a lookup structure."""
    # Key: normalized_manufacturer -> {normalized_model -> specs}
    modules = defaultdict(dict)
    raw_count = 0

    with open(MODULES_FILE, 'r') as f:
        reader = csv.DictReader(f)
        next(reader)  # skip units row
        next(reader)  # skip internal names row

        for row in reader:
            raw_count += 1
            mfr = row.get('Manufacturer', '').strip()
            name = row.get('Name', '').strip()

            if not mfr or not name:
                continue

            # Extract model from Name (Name = "Manufacturer Model")
            model = name
            if model.startswith(mfr):
                model = model[len(mfr):].strip()

            norm_mfr = normalize(mfr)
            norm_model = normalize_model(model)

            try:
                stc = float(row['STC']) if row.get('STC') else None
                ptc = float(row['PTC']) if row.get('PTC') else None
                area = float(row['A_c']) if row.get('A_c') else None
            except (ValueError, TypeError):
                stc = ptc = area = None

            specs = {
                "stc_watts": round(stc, 1) if stc else None,
                "ptc_watts": round(ptc, 1) if ptc else None,
                "technology": row.get('Technology', ''),
                "bifacial": row.get('Bifacial', '') == '1',
                "area_m2": round(area, 3) if area else None,
                "cells_in_series": int(float(row['N_s'])) if row.get('N_s') and row['N_s'].strip() else None,
                "temp_coeff_pmax": row.get('gamma_pmp', ''),
                "noct": row.get('T_NOCT', ''),
            }

            # Calculate efficiency
            if stc and area and area > 0:
                specs["efficiency_pct"] = round(stc / (area * 1000) * 100, 2)

            modules[norm_mfr][norm_model] = {
                "stc": stc,
                "specs": specs,
                "raw_mfr": mfr,
                "raw_model": model,
            }

    return modules, raw_count


def load_cec_inverters():
    """Load CEC inverters into a lookup structure."""
    inverters = defaultdict(dict)
    raw_count = 0

    with open(INVERTERS_FILE, 'r') as f:
        reader = csv.DictReader(f)
        next(reader)  # skip units row
        next(reader)  # skip internal names row

        for row in reader:
            raw_count += 1
            name = row.get('Name', '').strip()
            if not name:
                continue

            # Parse "Manufacturer: Model [Voltage]" format
            if ':' in name:
                parts = name.split(':', 1)
                mfr = parts[0].strip()
                model = parts[1].strip()
            else:
                # Fallback: first word(s) as manufacturer
                parts = name.split(' ', 1)
                mfr = parts[0]
                model = parts[1] if len(parts) > 1 else name

            norm_mfr = normalize(mfr)
            norm_model = normalize_model(model)

            try:
                paco = float(row['Paco']) if row.get('Paco') else None
                vac = float(row['Vac']) if row.get('Vac') else None
                vdcmax = float(row['Vdcmax']) if row.get('Vdcmax') else None
            except (ValueError, TypeError):
                paco = vac = vdcmax = None

            specs = {
                "ac_power_w": round(paco, 1) if paco else None,
                "ac_voltage": round(vac, 1) if vac else None,
                "dc_voltage_max": round(vdcmax, 1) if vdcmax else None,
                "mppt_low": row.get('Mppt_low', ''),
                "mppt_high": row.get('Mppt_high', ''),
            }

            inverters[norm_mfr][norm_model] = {
                "paco": paco,
                "specs": specs,
                "raw_mfr": mfr,
                "raw_model": model,
            }

    return inverters, raw_count


def _search_models(mfr_models, norm_model):
    """Search a manufacturer's models dict for a match."""
    if norm_model in mfr_models:
        return mfr_models[norm_model]
    for cec_model, cec_data in mfr_models.items():
        if norm_model.startswith(cec_model) or cec_model.startswith(norm_model):
            return cec_data
    return None


def _find_match(lookup, mfr, model):
    """Generic matching logic for both modules and inverters."""
    norm_mfr = normalize(mfr)
    norm_model = normalize_model(model)
    alias_mfr = resolve_alias(norm_mfr)

    # 1. Exact normalized manufacturer match
    if norm_mfr in lookup:
        result = _search_models(lookup[norm_mfr], norm_model)
        if result:
            return result

    # 2. Alias-based match (e.g., "hanwha q cells" -> "qcells" matches CEC's "qcells north")
    if alias_mfr != norm_mfr:
        for cec_mfr, cec_models in lookup.items():
            cec_alias = resolve_alias(cec_mfr)
            if alias_mfr == cec_alias:
                result = _search_models(cec_models, norm_model)
                if result:
                    return result

    # 3. Substring match on manufacturer
    for cec_mfr, cec_models in lookup.items():
        if norm_mfr in cec_mfr or cec_mfr in norm_mfr:
            result = _search_models(cec_models, norm_model)
            if result:
                return result

    return None


def find_module_match(modules, mfr, model):
    """Try to find a CEC module match for given manufacturer + model."""
    return _find_match(modules, mfr, model)


def find_inverter_match(inverters, mfr, model):
    """Try to find a CEC inverter match."""
    return _find_match(inverters, mfr, model)


PARALLEL_WORKERS = 20


def _do_patch(table, rec_id, update):
    """Single PATCH call for use in thread pool."""
    return supabase_request("PATCH", table, update, params={"id": f"eq.{rec_id}"})


def main():
    print("Equipment Specs Enrichment (CEC Cross-Reference)")
    print(f"  Using {PARALLEL_WORKERS} parallel workers for updates")
    print("=" * 60)

    # Load CEC data
    print("Loading CEC module database...")
    modules, mod_count = load_cec_modules()
    mfr_count = len(modules)
    model_count = sum(len(v) for v in modules.values())
    print(f"  Loaded {mod_count} raw records → {model_count} unique models from {mfr_count} manufacturers")

    print("Loading CEC inverter database...")
    inverters, inv_count = load_cec_inverters()
    inv_mfr_count = len(inverters)
    inv_model_count = sum(len(v) for v in inverters.values())
    print(f"  Loaded {inv_count} raw records → {inv_model_count} unique models from {inv_mfr_count} manufacturers")

    # Process modules
    print("\n" + "=" * 60)
    print("Matching Modules...")
    print("=" * 60)

    offset = 0
    total_checked = 0
    total_matched = 0
    total_updated = 0
    total_skipped_redacted = 0

    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
        while True:
            params = {
                "equipment_type": "eq.module",
                "module_wattage_w": "is.null",
                "manufacturer": "not.is.null",
                "model": "not.is.null",
                "select": "id,manufacturer,model",
                "limit": "1000",
                "offset": str(offset),
                "order": "id",
            }
            records = supabase_request("GET", "solar_equipment", params=params)
            if not records:
                break

            # Match all records in this batch (CPU-bound, fast)
            pending_updates = []
            for rec in records:
                mfr = rec.get("manufacturer", "")
                model = rec.get("model", "")

                if not mfr or not model or mfr.lower() == "redacted" or model.lower() == "redacted":
                    total_skipped_redacted += 1
                    continue

                total_checked += 1
                match = find_module_match(modules, mfr, model)

                if match:
                    total_matched += 1
                    update = {"module_wattage_w": round(match["stc"], 1) if match["stc"] else None}
                    if match["specs"]:
                        update["specs"] = match["specs"]
                    pending_updates.append((rec["id"], update))

            # Fire all PATCH calls in parallel (IO-bound, slow individually)
            if pending_updates:
                futures = {
                    executor.submit(_do_patch, "solar_equipment", rid, data): rid
                    for rid, data in pending_updates
                }
                for future in as_completed(futures):
                    if future.result() is not None:
                        total_updated += 1

            print(f"  Offset {offset}: checked={total_checked}, matched={total_matched}, updated={total_updated}, redacted={total_skipped_redacted}")

            if len(records) < 1000:
                break
            offset += 1000

    print(f"\nModule matching complete:")
    print(f"  Total checked: {total_checked}")
    print(f"  Matched to CEC: {total_matched}")
    print(f"  Updated: {total_updated}")
    print(f"  Skipped (redacted): {total_skipped_redacted}")
    print(f"  Match rate: {total_matched/total_checked*100:.1f}%" if total_checked else "  N/A")

    # Process inverters
    print("\n" + "=" * 60)
    print("Matching Inverters...")
    print("=" * 60)

    offset = 0
    inv_checked = 0
    inv_matched = 0
    inv_updated = 0
    inv_skipped = 0

    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
        while True:
            params = {
                "equipment_type": "eq.inverter",
                "inverter_capacity_kw": "is.null",
                "manufacturer": "not.is.null",
                "model": "not.is.null",
                "select": "id,manufacturer,model",
                "limit": "1000",
                "offset": str(offset),
                "order": "id",
            }
            records = supabase_request("GET", "solar_equipment", params=params)
            if not records:
                break

            # Match all records in this batch
            pending_updates = []
            for rec in records:
                mfr = rec.get("manufacturer", "")
                model = rec.get("model", "")

                if not mfr or not model or mfr.lower() == "redacted" or model.lower() == "redacted":
                    inv_skipped += 1
                    continue

                inv_checked += 1
                match = find_inverter_match(inverters, mfr, model)

                if match:
                    inv_matched += 1
                    update = {}
                    if match["paco"]:
                        update["inverter_capacity_kw"] = round(match["paco"] / 1000, 2)
                    if match["specs"]:
                        update["specs"] = match["specs"]

                    if update:
                        pending_updates.append((rec["id"], update))

            # Fire all PATCH calls in parallel
            if pending_updates:
                futures = {
                    executor.submit(_do_patch, "solar_equipment", rid, data): rid
                    for rid, data in pending_updates
                }
                for future in as_completed(futures):
                    if future.result() is not None:
                        inv_updated += 1

            print(f"  Offset {offset}: checked={inv_checked}, matched={inv_matched}, updated={inv_updated}, redacted={inv_skipped}")

            if len(records) < 1000:
                break
            offset += 1000

    print(f"\nInverter matching complete:")
    print(f"  Total checked: {inv_checked}")
    print(f"  Matched to CEC: {inv_matched}")
    print(f"  Updated: {inv_updated}")
    print(f"  Skipped (redacted): {inv_skipped}")
    print(f"  Match rate: {inv_matched/inv_checked*100:.1f}%" if inv_checked else "  N/A")

    print("\n" + "=" * 60)
    print("Equipment specs enrichment complete!")
    print(f"  Total equipment enriched: {total_updated + inv_updated}")


if __name__ == "__main__":
    main()

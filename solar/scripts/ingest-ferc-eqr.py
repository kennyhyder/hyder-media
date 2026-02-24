#!/usr/bin/env python3
"""
FERC EQR (Electric Quarterly Report) PPA Parser — Extract solar PPA contracts.

Downloads FERC EQR contract data from PUDL (Catalyst Cooperative) S3 Parquet
mirror and matches solar power purchase agreements to existing installations.

Data source: PUDL S3 bucket (Parquet)
  - Contracts: s3://pudl.catalyst.coop/ferceqr/core_ferceqr__contracts/{year}q{quarter}.parquet
  - Transactions: s3://pudl.catalyst.coop/ferceqr/core_ferceqr__transactions/{year}q{quarter}.parquet
  (We use contracts table — has seller/buyer/rate/term without 2.5GB per-quarter size)

Usage:
  python3 -u scripts/ingest-ferc-eqr.py              # Full extraction (2023-2024)
  python3 -u scripts/ingest-ferc-eqr.py --dry-run     # Preview matches
  python3 -u scripts/ingest-ferc-eqr.py --year 2024   # Specific year
  python3 -u scripts/ingest-ferc-eqr.py --quarter 3   # Specific quarter
  python3 -u scripts/ingest-ferc-eqr.py --skip-download  # Use cached Parquet
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
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import pyarrow.parquet as pq
except ImportError:
    print("Error: pyarrow required. Install with: pip3 install pyarrow")
    sys.exit(1)

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "ferc_eqr"
WORKERS = 10
PSQL_CMD = "PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres"

# PUDL S3 base URL (public, no auth needed)
PUDL_S3_BASE = "https://s3.us-west-2.amazonaws.com/pudl.catalyst.coop/ferceqr"


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
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True
    except urllib.error.HTTPError as e:
        return False


def _do_patch(args):
    inst_id, patch = args
    return supabase_patch("solar_installations", patch, {"id": f"eq.{inst_id}"})


# ---------------------------------------------------------------------------
# Solar contract filtering
# ---------------------------------------------------------------------------

SOLAR_KEYWORDS = re.compile(
    r'\b(solar|photovoltaic|pv\b|sun\b|sunlight)',
    re.IGNORECASE
)

SOLAR_SELLERS = {
    "nextera", "first solar", "sunpower", "canadian solar", "clearway",
    "aes", "invenergy", "enel", "recurrent energy", "cypress creek",
    "lightsource", "longroad", "orsted", "edf renewables", "avangrid",
    "terra-gen", "8minute", "intersect power", "savion", "swift current",
    "sol systems", "pine gate", "silicon ranch", "origis", "ranger power",
    "leeward", "key capture", "broad reach", "hecate", "national grid",
    "brookfield", "duke energy", "dominion", "southern power", "sempra",
    "vistra", "pattern energy", "engie", "summit ridge", "community energy",
}

# Known non-solar sellers to exclude (prevent false matches on generic names)
NON_SOLAR_EXCLUDE = {
    "natural gas", "coal", "wind", "hydro", "nuclear", "petroleum",
    "oil", "diesel", "biomass", "geothermal", "waste",
}


def is_solar_contract(row):
    """Determine if a FERC EQR contract row is solar-related."""
    # Check all text fields for solar keywords
    text_fields = []
    for field in ["seller_company_name", "customer_company_name", "contract_service_agreement_name",
                  "product_name", "product_type_name", "term_name"]:
        val = row.get(field)
        if val and str(val) != "None" and str(val) != "nan":
            text_fields.append(str(val))

    combined = " ".join(text_fields).lower()

    # Exclude if clearly non-solar
    for excl in NON_SOLAR_EXCLUDE:
        if excl in combined and "solar" not in combined:
            return False

    # Check for solar keywords
    if SOLAR_KEYWORDS.search(combined):
        return True

    # Check seller against known solar companies
    seller = str(row.get("seller_company_name", "") or "").lower()
    for s in SOLAR_SELLERS:
        if s in seller:
            return True

    return False


# ---------------------------------------------------------------------------
# PUDL Parquet download and parsing
# ---------------------------------------------------------------------------

def download_parquet(year, quarter):
    """Download a single PUDL FERC EQR contracts Parquet file from S3."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    local_path = DATA_DIR / f"contracts_{year}q{quarter}.parquet"

    if local_path.exists():
        size_mb = local_path.stat().st_size / 1024 / 1024
        print(f"  Using cached {local_path.name} ({size_mb:.1f} MB)")
        return local_path

    url = f"{PUDL_S3_BASE}/core_ferceqr__contracts/{year}q{quarter}.parquet"
    print(f"  Downloading {url}...")
    try:
        headers = {"User-Agent": "SolarTrack/1.0"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
        local_path.write_bytes(data)
        size_mb = len(data) / 1024 / 1024
        print(f"  Saved {local_path.name} ({size_mb:.1f} MB)")
        return local_path
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"  Failed to download {year}Q{quarter}: {e}")
        return None


def parse_contracts_parquet(parquet_path):
    """Parse PUDL FERC EQR contracts Parquet for solar PPAs."""
    table = pq.read_table(parquet_path)
    df_cols = table.column_names
    print(f"  Columns: {', '.join(df_cols[:15])}{'...' if len(df_cols) > 15 else ''}")
    print(f"  Total rows: {len(table):,}")

    contracts = []
    for i in range(len(table)):
        row = {col: table.column(col)[i].as_py() for col in df_cols}

        if not is_solar_contract(row):
            continue

        # Extract seller (project owner/developer)
        seller = row.get("seller_company_name")
        if seller and str(seller) not in ("None", "nan", ""):
            seller = str(seller).strip()
        else:
            seller = None

        # Extract buyer (offtaker/utility)
        buyer = row.get("customer_company_name")
        if buyer and str(buyer) not in ("None", "nan", ""):
            buyer = str(buyer).strip()
        else:
            buyer = None

        # Extract contract/facility name
        facility = row.get("contract_service_agreement_name")
        if facility and str(facility) not in ("None", "nan", ""):
            facility = str(facility).strip()
        else:
            facility = None

        # Extract price (rate field)
        price = None
        rate = row.get("rate")
        if rate is not None and str(rate) not in ("None", "nan", ""):
            try:
                price = float(rate)
                # Sanity check: PPA prices typically $20-$150/MWh
                if price <= 0 or price > 500:
                    price = None
            except (ValueError, TypeError):
                pass

        # Rate units help determine if price is per MWh
        rate_units = str(row.get("rate_units") or "").lower()
        if price and rate_units and "mwh" not in rate_units and "megawatt" not in rate_units:
            # If rate is per kWh, convert to MWh
            if "kwh" in rate_units or "kilowatt" in rate_units:
                price = price * 1000
            elif rate_units and rate_units not in ("", "none", "nan"):
                # Unknown units — skip price to avoid bad data
                price = None

        # Extract state from seller
        seller_state = row.get("seller_state")
        if seller_state and str(seller_state) not in ("None", "nan", "") and len(str(seller_state).strip()) == 2:
            seller_state = str(seller_state).strip().upper()
        else:
            seller_state = None

        # Extract dates
        begin_date = row.get("contract_begin_date") or row.get("begin_date")
        end_date = row.get("contract_end_date") or row.get("end_date")
        if begin_date:
            begin_date = str(begin_date)[:10]
        if end_date:
            end_date = str(end_date)[:10]

        contracts.append({
            "seller": seller,
            "buyer": buyer,
            "facility": facility,
            "price_mwh": price,
            "state": seller_state,
            "begin_date": begin_date,
            "end_date": end_date,
            "term": str(row.get("term_name") or "").strip() or None,
        })

    print(f"  Solar contracts found: {len(contracts)}")
    return contracts


def download_and_parse(year, quarter=None):
    """Download and parse all quarters for a given year."""
    quarters = [quarter] if quarter else [1, 2, 3, 4]
    all_contracts = []

    for q in quarters:
        path = download_parquet(year, q)
        if path:
            contracts = parse_contracts_parquet(path)
            all_contracts.extend(contracts)

    return all_contracts


# ---------------------------------------------------------------------------
# Match contracts to installations
# ---------------------------------------------------------------------------

def normalize_name(name):
    """Normalize company name for matching."""
    if not name:
        return ""
    name = name.lower().strip()
    for suffix in [" llc", " inc", " corp", " co", " ltd", " lp", " lc",
                   " holdings", " energy", " power", " generation", " renewables",
                   ", llc", ", inc", ", corp", ", ltd", " l.l.c.", " l.p."]:
        name = name.replace(suffix, "")
    name = re.sub(r'[^\w\s]', '', name)
    return name.strip()


def name_similarity(a, b):
    """Simple word-overlap similarity between two normalized names."""
    if not a or not b:
        return 0.0
    words_a = set(a.split())
    words_b = set(b.split())
    if not words_a or not words_b:
        return 0.0
    overlap = len(words_a & words_b)
    return overlap / min(len(words_a), len(words_b))


def match_contracts_to_installations(contracts, installations):
    """Match FERC EQR solar contracts to existing installations."""
    print(f"\nMatching {len(contracts)} contracts to {len(installations)} installations...")

    # Build indexes
    inst_by_name = {}
    for inst in installations:
        name = inst.get("site_name")
        if name:
            key = normalize_name(name)
            if key:
                inst_by_name.setdefault(key, []).append(inst)

    # Index by normalized entity name (no state required)
    inst_by_entity = {}
    for inst in installations:
        for field in ["owner_name", "operator_name", "developer_name"]:
            entity = inst.get(field)
            if entity:
                key = normalize_name(entity)
                if key:
                    inst_by_entity.setdefault(key, []).append(inst)

    # Also index by state+entity for state-aware matching
    inst_by_state_entity = {}
    for inst in installations:
        state = inst.get("state")
        if not state:
            continue
        for field in ["owner_name", "operator_name", "developer_name"]:
            entity = inst.get(field)
            if entity:
                key = (state, normalize_name(entity))
                inst_by_state_entity.setdefault(key, []).append(inst)

    # Index by normalized operator (for buyer→operator matching)
    inst_by_operator = {}
    for inst in installations:
        op = inst.get("operator_name")
        if op:
            key = normalize_name(op)
            if key:
                inst_by_operator.setdefault(key, []).append(inst)

    # Deduplicate contracts by seller+buyer+facility, keep one with best price
    unique_contracts = {}
    for c in contracts:
        key = (c.get("seller"), c.get("buyer"), c.get("facility"))
        if key not in unique_contracts:
            unique_contracts[key] = c
        elif c.get("price_mwh") and not unique_contracts[key].get("price_mwh"):
            unique_contracts[key] = c
    contracts = list(unique_contracts.values())
    print(f"  Unique contracts: {len(contracts)}")

    # Show sample contracts
    solar_with_price = [c for c in contracts if c.get("price_mwh")]
    print(f"  Contracts with price: {len(solar_with_price)}")
    for c in contracts[:5]:
        print(f"    Seller: {c.get('seller', '?')[:50]} | Buyer: {c.get('buyer', '?')[:50]} | "
              f"Price: ${c.get('price_mwh', '?')}/MWh | State: {c.get('state', '?')}")

    patches = []
    matched_inst_ids = set()
    match_methods = {"site_name": 0, "seller_exact": 0, "seller_fuzzy": 0,
                     "buyer_exact": 0, "buyer_fuzzy": 0}

    for contract in contracts:
        # Strategy 1: Match by facility/contract name to site_name
        facility = contract.get("facility")
        if facility:
            key = normalize_name(facility)
            matches = inst_by_name.get(key, [])
            for inst in matches:
                if inst["id"] not in matched_inst_ids:
                    patch = build_patch(inst, contract)
                    if patch:
                        patches.append((inst["id"], patch))
                        matched_inst_ids.add(inst["id"])
                        match_methods["site_name"] += 1

        # Strategy 2: Match seller to owner/operator/developer by exact normalized name
        seller = contract.get("seller")
        if seller:
            seller_norm = normalize_name(seller)

            # Try state-aware first if we have state
            state = contract.get("state")
            matches = []
            if state:
                matches = inst_by_state_entity.get((state, seller_norm), [])
            if not matches:
                # Fall back to name-only matching
                matches = inst_by_entity.get(seller_norm, [])

            for inst in matches[:10]:
                if inst["id"] not in matched_inst_ids:
                    patch = build_patch(inst, contract)
                    if patch:
                        patches.append((inst["id"], patch))
                        matched_inst_ids.add(inst["id"])
                        match_methods["seller_exact"] += 1

        # Strategy 3: Fuzzy seller match — check if seller name has high word overlap with any entity
        if seller and not any(inst_by_entity.get(normalize_name(seller), [])):
            seller_norm = normalize_name(seller)
            seller_words = set(seller_norm.split())
            if len(seller_words) >= 2:
                # Check against all entity keys for word overlap
                for entity_key, insts in inst_by_entity.items():
                    if name_similarity(seller_norm, entity_key) >= 0.75:
                        for inst in insts[:5]:
                            if inst["id"] not in matched_inst_ids:
                                patch = build_patch(inst, contract)
                                if patch:
                                    patches.append((inst["id"], patch))
                                    matched_inst_ids.add(inst["id"])
                                    match_methods["seller_fuzzy"] += 1

        # Strategy 4: Match buyer (utility/offtaker) to operator — exact name
        buyer = contract.get("buyer")
        if buyer:
            buyer_norm = normalize_name(buyer)
            matches = inst_by_operator.get(buyer_norm, [])
            for inst in matches[:20]:
                if inst["id"] not in matched_inst_ids:
                    patch = {}
                    if contract.get("buyer") and not inst.get("offtaker_name"):
                        patch["offtaker_name"] = contract["buyer"]
                    if contract.get("price_mwh"):
                        patch["ppa_price_mwh"] = contract["price_mwh"]
                    if patch:
                        patches.append((inst["id"], patch))
                        matched_inst_ids.add(inst["id"])
                        match_methods["buyer_exact"] += 1

        # Strategy 5: Fuzzy buyer→operator match
        if buyer and not inst_by_operator.get(normalize_name(buyer), []):
            buyer_norm = normalize_name(buyer)
            for op_key, insts in inst_by_operator.items():
                if name_similarity(buyer_norm, op_key) >= 0.75:
                    for inst in insts[:10]:
                        if inst["id"] not in matched_inst_ids:
                            patch = {}
                            if not inst.get("offtaker_name"):
                                patch["offtaker_name"] = contract["buyer"]
                            if contract.get("price_mwh"):
                                patch["ppa_price_mwh"] = contract["price_mwh"]
                            if patch:
                                patches.append((inst["id"], patch))
                                matched_inst_ids.add(inst["id"])
                                match_methods["buyer_fuzzy"] += 1

    print(f"\n  Match results:")
    for method, count in match_methods.items():
        print(f"    {method}: {count}")
    print(f"    Total patches: {len(patches)}")

    return patches


def build_patch(inst, contract):
    """Build a patch dict from contract data to fill installation gaps."""
    patch = {}

    if contract.get("buyer") and not inst.get("offtaker_name"):
        patch["offtaker_name"] = contract["buyer"]

    if contract.get("seller"):
        if not inst.get("owner_name"):
            patch["owner_name"] = contract["seller"]
        elif not inst.get("developer_name"):
            patch["developer_name"] = contract["seller"]

    if contract.get("price_mwh"):
        patch["ppa_price_mwh"] = contract["price_mwh"]

    return patch if patch else None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Parse FERC EQR for solar PPA contracts")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--year", type=int, default=None, help="EQR year (default: 2023+2024)")
    parser.add_argument("--quarter", type=int, choices=[1, 2, 3, 4], help="Specific quarter")
    parser.add_argument("--skip-download", action="store_true", help="Use cached Parquet only")
    args = parser.parse_args()

    years = [args.year] if args.year else [2021, 2022, 2023, 2024]

    print("FERC EQR Solar PPA Parser (PUDL Parquet)")
    print("=" * 60)
    print(f"  Years: {years}")
    print(f"  Quarter: {args.quarter or 'all'}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Data dir: {DATA_DIR}")

    # Step 1: Download and parse contracts
    all_contracts = []
    for year in years:
        if args.skip_download:
            print(f"\nLoading cached Parquet for {year}...")
            quarters = [args.quarter] if args.quarter else [1, 2, 3, 4]
            for q in quarters:
                path = DATA_DIR / f"contracts_{year}q{q}.parquet"
                if path.exists():
                    all_contracts.extend(parse_contracts_parquet(path))
                else:
                    print(f"  {path.name} not found — skipping")
        else:
            print(f"\nDownloading PUDL Parquet for {year}...")
            all_contracts.extend(download_and_parse(year, args.quarter))

    if not all_contracts:
        print("\nNo solar contracts found in FERC EQR data.")
        return

    print(f"\nTotal solar contracts across all quarters: {len(all_contracts)}")

    # Step 2: Load installations via psql (avoids REST API HTTP 500 on large result sets)
    print("\nLoading utility-scale + large commercial installations via psql...")
    import subprocess, tempfile
    tmp_json = DATA_DIR / "_installations_for_matching.json"
    sql = """
    SELECT json_agg(t) FROM (
      SELECT id, source_record_id, site_name, owner_name, developer_name,
             operator_name, offtaker_name, state, capacity_mw, ppa_price_mwh
      FROM solar_installations
      WHERE site_type = 'utility'
         OR (site_type = 'commercial' AND capacity_mw >= 1)
      ORDER BY id
    ) t;
    """
    result = subprocess.run(
        f"{PSQL_CMD} -t -A -c \"{sql.strip()}\"",
        shell=True, capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr.strip()}")
        sys.exit(1)
    raw = result.stdout.strip()
    if not raw or raw == "null":
        print("  No installations found!")
        sys.exit(1)
    installations = json.loads(raw)
    print(f"  Loaded {len(installations)} installations via psql")

    # Step 3: Match
    patches = match_contracts_to_installations(all_contracts, installations)

    # Summary
    total_offtaker = sum(1 for _, p in patches if "offtaker_name" in p)
    total_owner = sum(1 for _, p in patches if "owner_name" in p)
    total_developer = sum(1 for _, p in patches if "developer_name" in p)
    total_ppa = sum(1 for _, p in patches if "ppa_price_mwh" in p)

    print(f"\n{'='*60}")
    print("FERC EQR Summary")
    print(f"{'='*60}")
    print(f"  Solar contracts found: {len(all_contracts)}")
    print(f"  Patches to apply: {len(patches)}")
    print(f"  offtaker_name fills: {total_offtaker}")
    print(f"  owner_name fills: {total_owner}")
    print(f"  developer_name fills: {total_developer}")
    print(f"  ppa_price_mwh fills: {total_ppa}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
        for inst_id, patch in patches[:30]:
            print(f"    {inst_id}: {patch}")
        return

    if not patches:
        print("\n  No patches to apply.")
        return

    # Apply patches
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
            if (applied + errors) % 100 == 0:
                print(f"  Progress: {applied} applied, {errors} errors")

    print(f"\n  Applied: {applied}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

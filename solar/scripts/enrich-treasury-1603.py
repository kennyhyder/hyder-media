#!/usr/bin/env python3
"""
Treasury Section 1603 Grant Enrichment — Cross-reference 1603 recipients with installations.

Downloads Treasury Section 1603 grant awards spreadsheet (8,534 solar records) and
cross-references Business Name + State against existing installation owner/developer names.
Fills owner_name where business name matches.

Data: https://home.treasury.gov/system/files/216/Website-Awarded-as-of-3.1.18.xlsx
Fields: Business Name, State, Technology, Funded ($), Award Date
Limitations: No capacity, no city/address, no coordinates

Usage:
  python3 -u scripts/enrich-treasury-1603.py              # Full run
  python3 -u scripts/enrich-treasury-1603.py --dry-run     # Preview matches
  python3 -u scripts/enrich-treasury-1603.py --skip-download  # Use cached file
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
DATA_DIR = Path(__file__).parent.parent / "data" / "treasury_1603"
XLSX_URL = "https://home.treasury.gov/system/files/216/Website-Awarded-as-of-3.1.18.xlsx"
WORKERS = 10


def normalize_name(name):
    """Normalize company name for matching."""
    if not name:
        return ""
    name = name.lower().strip()
    for suffix in [" llc", " inc", " corp", " co", " ltd", " lp", " lc",
                   " holdings", " energy", " power", " generation", " renewables",
                   ", llc", ", inc", ", corp", ", ltd", " l.l.c.", " l.p.",
                   " solar", " pv", " project", " projects"]:
        name = name.replace(suffix, "")
    name = re.sub(r'[^\w\s]', '', name)
    return name.strip()


def name_similarity(a, b):
    """Word-overlap similarity between two normalized names."""
    if not a or not b:
        return 0.0
    words_a = set(a.split())
    words_b = set(b.split())
    if not words_a or not words_b:
        return 0.0
    overlap = len(words_a & words_b)
    return overlap / min(len(words_a), len(words_b))


def download_xlsx():
    """Download Treasury 1603 awards spreadsheet."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    local_path = DATA_DIR / "1603_awards.xlsx"

    if local_path.exists():
        size_kb = local_path.stat().st_size / 1024
        print(f"  Using cached {local_path.name} ({size_kb:.0f} KB)")
        return local_path

    print(f"  Downloading {XLSX_URL}...")
    headers = {"User-Agent": "SolarTrack/1.0"}
    req = urllib.request.Request(XLSX_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    local_path.write_bytes(data)
    print(f"  Saved {local_path.name} ({len(data)/1024:.0f} KB)")
    return local_path


def parse_1603(xlsx_path):
    """Parse Treasury 1603 awards for solar records."""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active

    records = []
    for i, row in enumerate(ws.iter_rows(min_row=1, values_only=True)):
        if i < 2:  # Skip title row and header
            continue
        if not row or not row[0]:
            continue

        business_name = str(row[0]).strip() if row[0] else None
        state = str(row[1]).strip().upper() if row[1] and len(str(row[1]).strip()) == 2 else None
        technology = str(row[2]).strip() if row[2] else None
        funded = None
        if row[3]:
            try:
                funded = float(row[3])
            except (ValueError, TypeError):
                pass
        award_date = None
        if row[4]:
            try:
                award_date = str(row[4])[:10]
            except:
                pass

        # Filter to solar only
        if not technology:
            continue
        tech_lower = technology.lower()
        if "solar" not in tech_lower and "photovoltaic" not in tech_lower:
            continue

        if business_name and state:
            records.append({
                "business_name": business_name,
                "state": state,
                "technology": technology,
                "funded": funded,
                "award_date": award_date,
            })

    wb.close()
    return records


def supabase_patch(table, data, match_filter, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_filter}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data, allow_nan=False).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
    return False


def main():
    parser = argparse.ArgumentParser(description="Enrich installations with Treasury 1603 grant data")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--skip-download", action="store_true", help="Use cached file")
    args = parser.parse_args()

    print("Treasury Section 1603 Grant Enrichment")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    # Step 1: Download and parse
    if args.skip_download:
        xlsx_path = DATA_DIR / "1603_awards.xlsx"
        if not xlsx_path.exists():
            print(f"  Error: {xlsx_path} not found. Run without --skip-download first.")
            sys.exit(1)
    else:
        xlsx_path = download_xlsx()

    print("\nParsing 1603 awards...")
    records = parse_1603(xlsx_path)
    print(f"  Solar records: {len(records)}")

    # Summarize
    states = {}
    for r in records:
        states[r["state"]] = states.get(r["state"], 0) + 1
    top_states = sorted(states.items(), key=lambda x: -x[1])[:10]
    print(f"  Top states: {', '.join(f'{s}:{c}' for s, c in top_states)}")

    total_funded = sum(r["funded"] for r in records if r["funded"])
    print(f"  Total funded: ${total_funded:,.0f}")

    # Large awards (>$1M) are most likely utility-scale and matchable
    large = [r for r in records if r["funded"] and r["funded"] >= 1_000_000]
    print(f"  Large awards (>=$1M): {len(large)}")

    # Step 2: Load installations via psql
    print("\nLoading utility + large commercial installations via psql...")
    sql = """
    SELECT json_agg(t) FROM (
      SELECT id, site_name, owner_name, developer_name, state, capacity_mw
      FROM solar_installations
      WHERE (site_type = 'utility' OR (site_type = 'commercial' AND capacity_mw >= 0.5))
        AND state IS NOT NULL
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
    print(f"  Loaded {len(installations)} installations")

    # Build indexes
    # Index by state → list of installations
    inst_by_state = {}
    for inst in installations:
        state = inst.get("state")
        if state:
            inst_by_state.setdefault(state, []).append(inst)

    # Index by normalized name → installations
    inst_by_name = {}
    for inst in installations:
        for field in ["owner_name", "developer_name", "site_name"]:
            name = inst.get(field)
            if name:
                key = normalize_name(name)
                if key and len(key) > 3:
                    inst_by_name.setdefault(key, []).append(inst)

    # Step 3: Match 1603 records to installations
    print(f"\nMatching {len(records)} grants to {len(installations)} installations...")

    patches = []
    matched_inst_ids = set()
    match_methods = {"exact_name": 0, "fuzzy_name": 0}

    for grant in records:
        biz_norm = normalize_name(grant["business_name"])
        state = grant["state"]

        if not biz_norm or len(biz_norm) < 4:
            continue

        # Strategy 1: Exact name match in same state
        matches = inst_by_name.get(biz_norm, [])
        for inst in matches:
            if inst.get("state") == state and inst["id"] not in matched_inst_ids:
                patch = {}
                if not inst.get("owner_name"):
                    patch["owner_name"] = grant["business_name"]
                elif not inst.get("developer_name"):
                    patch["developer_name"] = grant["business_name"]
                if grant.get("funded") and grant["funded"] >= 1_000_000 and not inst.get("total_cost"):
                    # 1603 grant was ~30% of project cost, so estimate total
                    patch["total_cost"] = round(grant["funded"] / 0.3)
                if patch:
                    patches.append((inst["id"], patch))
                    matched_inst_ids.add(inst["id"])
                    match_methods["exact_name"] += 1

        # Strategy 2: Fuzzy match in same state (for large awards only)
        if grant.get("funded") and grant["funded"] >= 1_000_000:
            state_insts = inst_by_state.get(state, [])
            for inst in state_insts:
                if inst["id"] in matched_inst_ids:
                    continue
                # Check name similarity against all entity fields
                for field in ["owner_name", "developer_name", "site_name"]:
                    inst_name = inst.get(field)
                    if inst_name:
                        sim = name_similarity(biz_norm, normalize_name(inst_name))
                        if sim >= 0.75:
                            patch = {}
                            if not inst.get("owner_name"):
                                patch["owner_name"] = grant["business_name"]
                            if patch:
                                patches.append((inst["id"], patch))
                                matched_inst_ids.add(inst["id"])
                                match_methods["fuzzy_name"] += 1
                            break

    # Summary
    total_owner = sum(1 for _, p in patches if "owner_name" in p)
    total_developer = sum(1 for _, p in patches if "developer_name" in p)
    total_cost = sum(1 for _, p in patches if "total_cost" in p)

    print(f"\n{'='*60}")
    print("Treasury 1603 Summary")
    print(f"{'='*60}")
    print(f"  Solar grants: {len(records)}")
    print(f"  Matched installations: {len(patches)}")
    print(f"    exact_name: {match_methods['exact_name']}")
    print(f"    fuzzy_name: {match_methods['fuzzy_name']}")
    print(f"  owner_name fills: {total_owner}")
    print(f"  developer_name fills: {total_developer}")
    print(f"  total_cost estimates: {total_cost}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Sample patches:")
        for inst_id, patch in patches[:20]:
            print(f"    {inst_id}: {patch}")
        return

    if not patches:
        print("\n  No patches to apply.")
        return

    # Apply patches
    print(f"\nApplying {len(patches)} patches ({WORKERS} workers)...")
    applied = 0
    errors = 0

    def _do_patch(item):
        inst_id, patch = item
        return supabase_patch("solar_installations", patch, f"id=eq.{inst_id}")

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

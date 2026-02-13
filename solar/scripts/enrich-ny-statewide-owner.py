#!/usr/bin/env python3
"""
NY Statewide Distributed Solar → owner_name Enrichment

Downloads the full NY Statewide Distributed Solar dataset (268K+ records) and
cross-references with existing NY installations to fill owner_name from the
Developer column.

For community solar and commercial-scale projects, the "Developer" listed in the
NY dataset is typically the project owner/developer entity (e.g., Nexamp, DG New
York CS LLC, Borrego Solar, NextEra Energy). For smaller distributed installs,
the developer is more often the installer (Sunrun, SolarCity, Tesla), which we
skip to avoid incorrect owner attribution.

Strategy:
  - Phase 1: Direct match — nydist_* records already in DB. Copy developer_name
    to owner_name where developer_name exists and is NOT a known installer.
  - Phase 2: Cross-reference — nysun_*, tts3_NY_*, permit_* records matched by
    zip + capacity proximity to the NY statewide CSV. Assign developer as owner.

Data source: https://data.ny.gov/api/views/wgsj-jt5f/rows.csv?accessType=DOWNLOAD

Usage:
  python3 -u scripts/enrich-ny-statewide-owner.py              # Full enrichment
  python3 -u scripts/enrich-ny-statewide-owner.py --dry-run     # Report without patching
  python3 -u scripts/enrich-ny-statewide-owner.py --skip-download  # Use cached CSV
"""

import os
import sys
import json
import re
import csv
import argparse
import urllib.request
import urllib.parse
import ssl
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

DATA_DIR = Path(__file__).parent.parent / "data" / "ny_statewide"
CSV_FILE = DATA_DIR / "ny_statewide_distributed_solar.csv"
CSV_URL = "https://data.ny.gov/api/views/wgsj-jt5f/rows.csv?accessType=DOWNLOAD"
WORKERS = 20

# SSL context
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# Known residential solar installers — these should NOT be assigned as owner_name.
# They install systems for homeowners, they don't own the systems.
KNOWN_INSTALLERS = {
    "sunrun", "solar city", "solarcity", "tesla", "vivint", "vivintsolar",
    "vivint solar", "trinity solar", "momentum solar", "sunnova", "freedom forever",
    "sunpower", "blue raven", "blue raven solar", "palmetto", "empower solar",
    "posigen", "ion solar", "project solar", "certasun", "complete solar",
    "elevation solar", "solar me", "solar optimum", "purelight power",
    "green home systems", "enphase", "generac", "enlight energy",
    # Placeholder/garbage values
    "other",
    # NY-specific residential installers
    "plugpv", "plug pv", "empire solar solutions", "empire solar",
    "hudson solar", "halco energy", "amergy solar", "best energy power",
    "new york power solutions", "solar liberty", "apex solar", "apex solar power",
    "renovus solar", "suncommon", "kassleman solar", "buffalo solar solutions",
    "paradise energy solutions", "sologistics", "3rdrocsolar",
    "energy by choice", "new york coastal electric", "centurion solar",
    "solarblocks energy", "solar edge", "solaredge", "us energy concierge",
    "brightcore energy",
}


def is_known_installer(name):
    """Check if a developer name is a known residential installer."""
    if not name:
        return True  # No name = skip
    norm = name.lower().strip()
    # Remove common suffixes
    norm = re.sub(r'\b(llc|inc|corp|co|ltd|lp|l\.l\.c\.?)\b', '', norm)
    norm = re.sub(r'[^a-z0-9\s]', '', norm)
    norm = re.sub(r'\s+', ' ', norm).strip()

    # Check against known installers
    for installer in KNOWN_INSTALLERS:
        if installer in norm or norm in installer:
            return True

    # Also check for person names pattern "FirstName LastName (Company)"
    if re.match(r'^[a-z]+ [a-z]+ \(', name.lower()):
        return True

    return False


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
# Download NY statewide CSV
# ---------------------------------------------------------------------------

def download_csv():
    """Download the full NY statewide distributed solar CSV."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading NY statewide distributed solar CSV...")
    print(f"  URL: {CSV_URL}")

    req = urllib.request.Request(CSV_URL, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SolarTrack/1.0",
    })
    with urllib.request.urlopen(req, context=SSL_CTX) as resp:
        data = resp.read()

    with open(CSV_FILE, "wb") as f:
        f.write(data)
    print(f"  Saved to {CSV_FILE} ({len(data):,} bytes)")


# ---------------------------------------------------------------------------
# Load NY statewide data
# ---------------------------------------------------------------------------

def load_ny_statewide():
    """Load all records from the NY statewide CSV that have developers."""
    print(f"Loading NY statewide data from {CSV_FILE}...")

    records = []
    with open(CSV_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            developer = (row.get("Developer") or "").strip()
            if not developer:
                continue

            # Skip known residential installers
            if is_known_installer(developer):
                continue

            try:
                kw = float(row.get("Estimated PV System Size (kWdc)") or 0)
            except (ValueError, TypeError):
                kw = 0
            if kw < 25:
                continue  # Only commercial-scale

            project_id = (row.get("Project ID") or "").strip()
            zip_code = (row.get("Zip") or "").strip()[:5]
            city = (row.get("City/Town") or "").strip()
            county = (row.get("County") or "").strip()

            records.append({
                "project_id": project_id,
                "developer": developer,
                "capacity_kw": kw,
                "zip": zip_code,
                "city": city.upper() if city else "",
                "county": county.upper() if county else "",
            })

    print(f"  Loaded {len(records)} commercial records with non-installer developers")

    # Stats
    devs = {}
    for r in records:
        devs[r["developer"]] = devs.get(r["developer"], 0) + 1
    top = sorted(devs.items(), key=lambda x: -x[1])[:15]
    print(f"  Top developers (treated as owners):")
    for d, c in top:
        print(f"    {d:50s}: {c}")

    return records


# ---------------------------------------------------------------------------
# Load existing NY installations
# ---------------------------------------------------------------------------

def load_ny_installations_without_owner():
    """Load all NY installations missing owner_name."""
    print("Loading NY installations without owner_name from database...")
    all_records = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,source_record_id,site_name,owner_name,developer_name,capacity_mw,state,city,zip_code,county",
            "state": "eq.NY",
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

    print(f"  Total: {len(all_records)} NY installations without owner_name")

    # Breakdown by source
    by_source = {}
    for inst in all_records:
        src = (inst.get("source_record_id") or "").split("_")[0]
        by_source[src] = by_source.get(src, 0) + 1
    for src, count in sorted(by_source.items(), key=lambda x: -x[1])[:10]:
        print(f"    {src}: {count}")

    return all_records


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def capacity_match(cap_kw, cap_mw, tolerance=0.20):
    """Check if capacity in kW matches capacity in MW within tolerance."""
    if not cap_kw or not cap_mw:
        return False
    cap_mw_from_kw = cap_kw / 1000.0
    if cap_mw == 0 or cap_mw_from_kw == 0:
        return False
    ratio = cap_mw_from_kw / cap_mw
    return (1 - tolerance) <= ratio <= (1 + tolerance)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich NY installations with statewide developer→owner data")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--skip-download", action="store_true", help="Use existing CSV")
    args = parser.parse_args()

    # Download if needed
    if not args.skip_download or not CSV_FILE.exists():
        download_csv()

    if not CSV_FILE.exists():
        print(f"Error: CSV file not found at {CSV_FILE}")
        sys.exit(1)

    # Load data
    ny_records = load_ny_statewide()
    installations = load_ny_installations_without_owner()

    if not installations:
        print("No NY installations without owner_name.")
        return

    # =========================================================================
    # Phase 1: nydist_* records — use their existing developer_name as owner
    # These records came FROM the NY statewide dataset, so developer_name is
    # already populated. We just need to promote it to owner_name for
    # non-installer developers.
    # =========================================================================
    print(f"\n{'='*60}")
    print("Phase 1: Promote developer_name → owner_name for nydist_* records")
    print(f"{'='*60}")

    patches = []
    matched_inst_ids = set()
    phase1_count = 0

    # Build a set of valid developer names from our CSV (already filtered)
    valid_developers = {r["developer"].lower().strip() for r in ny_records}

    for inst in installations:
        src = inst.get("source_record_id") or ""
        if not src.startswith("nydist_"):
            continue

        dev = inst.get("developer_name")
        if not dev:
            continue

        # Check it's not a known installer
        if is_known_installer(dev):
            continue

        patches.append((inst["id"], {"owner_name": dev}))
        matched_inst_ids.add(inst["id"])
        phase1_count += 1

    print(f"  Phase 1 patches (nydist developer→owner): {phase1_count}")

    # =========================================================================
    # Phase 2: Cross-reference other NY sources by zip + capacity
    # Match nysun_*, tts3_NY_*, permit_* records to the NY statewide CSV
    # =========================================================================
    print(f"\n{'='*60}")
    print("Phase 2: Cross-reference other NY sources by zip + capacity")
    print(f"{'='*60}")

    # Build index of NY statewide records by zip
    ny_by_zip = {}
    for r in ny_records:
        if r["zip"]:
            ny_by_zip.setdefault(r["zip"], []).append(r)

    # Also build by city for fallback
    ny_by_city = {}
    for r in ny_records:
        if r["city"]:
            ny_by_city.setdefault(r["city"], []).append(r)

    phase2_count = 0

    for inst in installations:
        if inst["id"] in matched_inst_ids:
            continue

        src = inst.get("source_record_id") or ""
        # Skip nydist (handled in Phase 1)
        if src.startswith("nydist_"):
            continue

        inst_zip = (inst.get("zip_code") or "")[:5]
        inst_city = (inst.get("city") or "").upper()
        inst_cap_mw = inst.get("capacity_mw")

        # Try zip-based matching first
        candidates = []
        if inst_zip:
            candidates = ny_by_zip.get(inst_zip, [])
        if not candidates and inst_city:
            candidates = ny_by_city.get(inst_city, [])

        if not candidates:
            continue

        # Find best match by capacity
        best = None
        best_diff = float("inf")

        for cand in candidates:
            if not inst_cap_mw:
                # No capacity to match — just use first candidate from same zip
                best = cand
                break

            if capacity_match(cand["capacity_kw"], inst_cap_mw, 0.20):
                diff = abs(cand["capacity_kw"] / 1000.0 - inst_cap_mw)
                if diff < best_diff:
                    best_diff = diff
                    best = cand

        if best and best["developer"]:
            patches.append((inst["id"], {"owner_name": best["developer"]}))
            matched_inst_ids.add(inst["id"])
            phase2_count += 1

    print(f"  Phase 2 patches (zip+capacity cross-ref): {phase2_count}")

    # =========================================================================
    # Summary
    # =========================================================================
    print(f"\n{'='*60}")
    print("NY Statewide Owner Enrichment Summary")
    print(f"{'='*60}")
    print(f"  NY statewide records (non-installer developers >=25kW): {len(ny_records)}")
    print(f"  NY installations without owner: {len(installations)}")
    print(f"  Phase 1 (nydist developer→owner): {phase1_count}")
    print(f"  Phase 2 (zip+capacity cross-ref): {phase2_count}")
    print(f"  Total owner_name patches: {len(patches)}")

    # Show top owner names being assigned
    owner_counts = {}
    for _, patch in patches:
        o = patch["owner_name"]
        owner_counts[o] = owner_counts.get(o, 0) + 1
    top_owners = sorted(owner_counts.items(), key=lambda x: -x[1])[:20]
    print(f"\n  Top owners being assigned:")
    for o, c in top_owners:
        print(f"    {o:50s}: {c}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
        print(f"\n  Sample patches:")
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

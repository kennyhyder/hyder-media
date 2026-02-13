#!/usr/bin/env python3
"""
USASpending REAP Solar Grant Enrichment Script

Downloads USDA REAP (Rural Energy for America Program, CFDA 10.868) solar grant
awards from USASpending.gov and enriches existing solar installations with owner_name.
The grant recipient IS the solar site owner.

Data source: https://api.usaspending.gov/api/v2/search/spending_by_award/
Filter: CFDA 10.868 + "solar" keyword

Usage:
  python3 -u scripts/enrich-usaspending-reap.py              # Full enrichment
  python3 -u scripts/enrich-usaspending-reap.py --dry-run     # Report without patching
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import ssl
import time
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
API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
API_COUNT_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award_count/"

# SSL context for USASpending API (system Python 3.9 has cert issues)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


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
# USASpending API helpers
# ---------------------------------------------------------------------------

def fetch_reap_solar_grants():
    """Fetch all REAP solar grants from USASpending API."""
    print("Fetching REAP solar grants from USASpending.gov...")

    filters = {
        "award_type_codes": ["02", "03", "04", "05"],
        "program_numbers": ["10.868"],
        "keywords": ["solar"],
    }

    # First get count
    count_body = json.dumps({"filters": filters, "subawards": False}).encode()
    count_req = urllib.request.Request(
        API_COUNT_URL, data=count_body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(count_req, context=SSL_CTX) as resp:
        count_result = json.loads(resp.read().decode())
    total = count_result["results"]["grants"]
    print(f"  Total REAP solar grants: {total}")

    # Fetch all pages (limit * page must be <= 9999)
    all_grants = []
    page = 1
    page_size = 100

    while True:
        body = json.dumps({
            "filters": filters,
            "fields": [
                "Award ID",
                "Recipient Name",
                "Description",
                "Award Amount",
                "Start Date",
                "End Date",
                "Place of Performance State Code",
                "Place of Performance City Name",
                "Place of Performance Zip5",
            ],
            "limit": page_size,
            "page": page,
            "sort": "Award Amount",
            "order": "desc",
            "subawards": False,
        }).encode()

        req = urllib.request.Request(
            API_URL, data=body,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(req, context=SSL_CTX) as resp:
                result = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            print(f"  API error on page {page}: {e.code}")
            break

        batch = result.get("results", [])
        all_grants.extend(batch)
        print(f"  Fetched page {page}: {len(batch)} results (total: {len(all_grants)})")

        if not result.get("page_metadata", {}).get("hasNext", False):
            break
        if len(all_grants) >= total:
            break

        page += 1
        time.sleep(0.5)  # Be polite to the API

    print(f"  Total fetched: {len(all_grants)} grants")

    # Parse into usable records
    grants = []
    for g in all_grants:
        recipient = (g.get("Recipient Name") or "").strip()
        if not recipient:
            continue

        state = (g.get("Place of Performance State Code") or "").strip()
        if not state or len(state) != 2:
            continue

        grants.append({
            "award_id": g.get("Award ID", ""),
            "recipient_name": recipient,
            "description": (g.get("Description") or "").strip(),
            "amount": g.get("Award Amount", 0),
            "start_date": g.get("Start Date"),
            "state": state.upper(),
            "city": (g.get("Place of Performance City Name") or "").strip() or None,
            "zip5": (g.get("Place of Performance Zip5") or "").strip() or None,
        })

    print(f"  Valid grants with state: {len(grants)}")

    # Stats
    states = {}
    for g in grants:
        states[g["state"]] = states.get(g["state"], 0) + 1
    top_states = sorted(states.items(), key=lambda x: -x[1])[:15]
    print(f"  Top states: {', '.join(f'{s}: {n}' for s, n in top_states)}")

    return grants


# ---------------------------------------------------------------------------
# Load existing installations
# ---------------------------------------------------------------------------

def load_installations_by_state(states):
    """Load installations from target states that are missing owner_name."""
    print(f"Loading installations without owner_name from {len(states)} states...")
    all_records = []

    for state in sorted(states):
        offset = 0
        limit = 1000
        while True:
            params = {
                "select": "id,source_record_id,site_name,owner_name,capacity_mw,state,city,zip_code",
                "state": f"eq.{state}",
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

    print(f"  Total: {len(all_records)} installations without owner_name in target states")
    return all_records


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------

def normalize_name(name):
    """Normalize a name for comparison."""
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r'\b(llc|inc|corp|co|ltd|lp|company|corporation|l\.l\.c\.?|l\.p\.)\b', '', s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def name_words(name):
    """Extract significant words from a name (skip tiny words)."""
    if not name:
        return set()
    norm = normalize_name(name)
    return {w for w in norm.split() if len(w) > 2}


def name_similarity_score(name1, name2):
    """Score name similarity based on word overlap."""
    w1 = name_words(name1)
    w2 = name_words(name2)
    if not w1 or not w2:
        return 0

    common = w1 & w2
    if not common:
        return 0

    # Score based on proportion of matching words
    score = len(common) * 2

    # Bonus for substring match
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if n1 and n2 and (n1 in n2 or n2 in n1):
        score += 3

    return score


def extract_solar_name_from_recipient(recipient):
    """Try to extract a meaningful name from REAP recipient for matching.

    REAP recipients are often like:
    - "HOMESTEAD SOLAR ENERGY, LLC" -> solar company name
    - "JOHN SMITH FARMS" -> farm name
    - "SMITH DAIRY, INC." -> business name
    """
    return recipient.strip()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich solar installations with USASpending REAP data")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    args = parser.parse_args()

    # Fetch REAP grants
    grants = fetch_reap_solar_grants()
    if not grants:
        print("No REAP solar grants found.")
        return

    # Get unique states
    grant_states = set(g["state"] for g in grants)

    # Load installations without owner_name in those states
    installations = load_installations_by_state(grant_states)
    if not installations:
        print("No installations without owner_name in REAP states.")
        return

    # Build indexes
    # Group grants by state
    grants_by_state = {}
    for g in grants:
        grants_by_state.setdefault(g["state"], []).append(g)

    # Group installations by state
    inst_by_state = {}
    for inst in installations:
        st = inst.get("state")
        if st:
            inst_by_state.setdefault(st, []).append(inst)

    # Also build zip index for faster matching
    inst_by_state_zip = {}
    for inst in installations:
        st = inst.get("state")
        zc = (inst.get("zip_code") or "")[:5]
        if st and zc:
            key = f"{st}_{zc}"
            inst_by_state_zip.setdefault(key, []).append(inst)

    print(f"\n{'='*60}")
    print("Phase 1: State + Name matching (REAP recipient -> site owner)")
    print(f"{'='*60}")

    patches = []
    matched_inst_ids = set()

    for state in sorted(grant_states):
        state_grants = grants_by_state.get(state, [])
        state_insts = inst_by_state.get(state, [])
        if not state_grants or not state_insts:
            continue

        state_matches = 0

        for grant in state_grants:
            recipient = grant["recipient_name"]
            grant_zip = grant.get("zip5") or ""
            grant_city = (grant.get("city") or "").lower()

            best_match = None
            best_score = 0

            # First try zip-based matching (most specific)
            if grant_zip:
                zip_key = f"{state}_{grant_zip}"
                candidates = inst_by_state_zip.get(zip_key, [])
            else:
                candidates = state_insts

            for inst in candidates:
                if inst["id"] in matched_inst_ids:
                    continue

                score = 0

                # Name similarity
                inst_name = inst.get("site_name") or ""
                name_score = name_similarity_score(recipient, inst_name)
                score += name_score

                # City match bonus
                inst_city = (inst.get("city") or "").lower()
                if grant_city and inst_city and (grant_city == inst_city):
                    score += 2

                # Zip match bonus (already filtered if grant has zip)
                inst_zip = (inst.get("zip_code") or "")[:5]
                if grant_zip and inst_zip == grant_zip:
                    score += 2

                if score > best_score:
                    best_score = score
                    best_match = inst

            # If no match from zip candidates, try all state installations
            if not best_match and grant_zip:
                for inst in state_insts:
                    if inst["id"] in matched_inst_ids:
                        continue

                    score = 0
                    inst_name = inst.get("site_name") or ""
                    name_score = name_similarity_score(recipient, inst_name)
                    score += name_score

                    inst_city = (inst.get("city") or "").lower()
                    if grant_city and inst_city and grant_city == inst_city:
                        score += 2

                    if score > best_score:
                        best_score = score
                        best_match = inst

            # Require minimum score of 3 (at least name word overlap + something)
            if best_match and best_score >= 3:
                patches.append((best_match["id"], {"owner_name": recipient}))
                matched_inst_ids.add(best_match["id"])
                state_matches += 1

        if state_matches > 0:
            print(f"  {state}: {state_matches} matches (from {len(state_insts)} candidates, {len(state_grants)} grants)")

    # Phase 2: Try matching remaining grants by city/zip only (lower confidence)
    # These are cases where REAP recipient name doesn't match site_name
    # but they're in the same city/zip, suggesting the recipient IS the owner
    print(f"\n{'='*60}")
    print("Phase 2: State + City matching (unmatched grants)")
    print(f"{'='*60}")

    unmatched_grants = [g for g in grants if not any(
        p[1]["owner_name"] == g["recipient_name"] for p in patches
    )]
    phase2_matches = 0

    for grant in unmatched_grants:
        state = grant["state"]
        grant_city = (grant.get("city") or "").lower()
        grant_zip = grant.get("zip5") or ""

        if not grant_city and not grant_zip:
            continue

        state_insts = inst_by_state.get(state, [])

        # Find installations in same city/zip without owner
        for inst in state_insts:
            if inst["id"] in matched_inst_ids:
                continue

            inst_city = (inst.get("city") or "").lower()
            inst_zip = (inst.get("zip_code") or "")[:5]

            # Require at least city OR zip match
            city_match = grant_city and inst_city and grant_city == inst_city
            zip_match = grant_zip and inst_zip and grant_zip == inst_zip

            if not city_match and not zip_match:
                continue

            # Check if recipient name contains "solar" or "energy" to increase confidence
            recip_lower = grant["recipient_name"].lower()
            is_solar_company = any(kw in recip_lower for kw in ["solar", "energy", "power", "pv", "sun"])

            # For city+zip match, require solar-related name
            if city_match and zip_match and is_solar_company:
                patches.append((inst["id"], {"owner_name": grant["recipient_name"]}))
                matched_inst_ids.add(inst["id"])
                phase2_matches += 1
                break  # One match per grant

    print(f"  Phase 2 matches: {phase2_matches}")

    # Summary
    print(f"\n{'='*60}")
    print("USASpending REAP Enrichment Summary")
    print(f"{'='*60}")
    print(f"  REAP solar grants: {len(grants)}")
    print(f"  Installations without owner: {len(installations)}")
    print(f"  Phase 1 (name matching): {len(patches) - phase2_matches}")
    print(f"  Phase 2 (city/zip matching): {phase2_matches}")
    print(f"  Total owner_name patches: {len(patches)}")

    # Show top recipients
    if patches:
        print(f"\n  Sample patches:")
        for inst_id, patch in patches[:15]:
            print(f"    {inst_id}: {patch['owner_name']}")

    if args.dry_run:
        print("\n  [DRY RUN] No patches applied.")
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
            if (applied + errors) % 100 == 0:
                print(f"  Progress: {applied} applied, {errors} errors")

    print(f"\n  Applied: {applied}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Enhanced address cleanup + re-geocoding for previously failed addresses.

The Census batch geocoder has already been run 3+ times. This script targets
the ~32K records that have addresses but failed to geocode, by:

1. Enhanced address parsing: handles embedded city/state/zip without commas,
   strips unit/apt numbers, normalizes abbreviations, fixes malformed zips
2. Re-submits cleaned addresses to Census batch geocoder (free)
3. Falls back to Google Geocoding API ($5/1000) for remaining failures

Usage:
    python3 -u scripts/geocode-address-cleanup.py                    # Full run
    python3 -u scripts/geocode-address-cleanup.py --dry-run           # Report patterns only
    python3 -u scripts/geocode-address-cleanup.py --census-only       # Skip Google fallback
    python3 -u scripts/geocode-address-cleanup.py --google-only       # Skip Census, Google only
    python3 -u scripts/geocode-address-cleanup.py --limit 500         # Process first N
    python3 -u scripts/geocode-address-cleanup.py --analyze           # Analyze patterns only

Cost: Census = free. Google = $5/1000 requests (covered by $200/mo free credit).
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

CENSUS_API_URL = "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch"
CENSUS_BATCH_SIZE = 1000
GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PATCH_WORKERS = 20
MAX_RETRIES = 3

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

US_STATES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
    'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
    'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
    'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
    'WI', 'WY', 'DC', 'PR',
}

# State name → abbreviation for parsing
STATE_NAMES = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
    'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE',
    'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR',
    'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
    'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
    'district of columbia': 'DC', 'puerto rico': 'PR',
}

# Infrastructure patterns that aren't real addresses
INFRASTRUCTURE_PATTERNS = [
    "substation", "switchyard", "switching station", "bus#", "bus #",
    " kv ", " kv\n", "kv line", "kv bus", " kv,", "kv\t",
    "tapping the", "interconnect", "transmission line",
    "138kv", "345kv", "230kv", "500kv", "115kv", "69kv", "161kv",
    "point of interconnection", "poi:", "poi -",
    "transformer", "circuit breaker", "breaker position",
    "power plant", "generating station",
]

GARBAGE_ADDRESSES = {
    "tbd", "n/a", "na", "none", "unknown", "not available", "see comments",
    "various", "multiple", "confidential", "redacted", "undisclosed",
    "no address", "address not available", "no street address",
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
    headers = {**HEADERS, "Prefer": "count=exact"}
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            if attempt < 4:
                wait = 2 ** attempt
                print(f"    Retry {attempt+1}/5 after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def supabase_patch(record_id, data):
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{record_id}"
    headers = {
        **HEADERS,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data, allow_nan=False).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            urllib.request.urlopen(req, timeout=30)
            return True
        except urllib.error.HTTPError as e:
            print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
            return False
        except (urllib.error.URLError, OSError) as e:
            if attempt < 4:
                wait = 2 ** attempt
                time.sleep(wait)
            else:
                return False


# ---------------------------------------------------------------------------
# Address cleaning
# ---------------------------------------------------------------------------

def is_infrastructure(address):
    """Check if address is actually an infrastructure name (substation, kV line)."""
    addr_lower = address.lower()
    for pattern in INFRASTRUCTURE_PATTERNS:
        if pattern in addr_lower:
            return True
    if addr_lower.rstrip().endswith("kv"):
        return True
    return False


def is_garbage(address):
    """Check if address is a garbage placeholder."""
    return address.strip().lower() in GARBAGE_ADDRESSES


def clean_address(address, city, state, zip_code):
    """
    Enhanced address cleaning. Returns (street, city, state, zip, was_modified).

    Handles:
    1. Embedded city/state/zip (with or without commas)
    2. Malformed zips (9+ digits, zip+4 without dash)
    3. Unit/apt/suite stripping
    4. Abbreviation normalization
    5. Multiple comma-separated parts
    """
    if not address:
        return (address, city, state, zip_code, False)

    addr = address.strip()
    orig_addr = addr
    modified = False

    # --- Fix malformed zips embedded in address ---
    # Pattern: "...CA 935363128" (9-digit zip without dash)
    m = re.search(r'\b(\d{9,})\s*$', addr)
    if m and not zip_code:
        zip_code = m.group(1)[:5]
        addr = addr[:m.start()].strip()
        modified = True

    # --- Parse embedded city/state/zip ---
    # Pattern 1: "Street, City ST ZIP" or "Street, City, ST ZIP"
    m = re.match(
        r'^(.+?),\s*([A-Za-z ]+?)[,\s]+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$',
        addr
    )
    if m and m.group(3) in US_STATES:
        street = m.group(1).strip()
        parsed_city = m.group(2).strip().rstrip(',')
        parsed_state = m.group(3)
        parsed_zip = m.group(4)[:5]
        if not city:
            city = parsed_city
        if not state:
            state = parsed_state
        if not zip_code:
            zip_code = parsed_zip
        addr = street
        modified = True

    # Pattern 2: "Street City ST ZIP" (no comma, e.g., "24 BUTTONWOOD LN LEWISTON ME 04240")
    elif not city or not zip_code:
        m = re.match(
            r'^(.+?)\s+([A-Za-z][A-Za-z ]*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$',
            addr
        )
        if m and m.group(3) in US_STATES:
            street = m.group(1).strip()
            parsed_city = m.group(2).strip()
            parsed_state = m.group(3)
            parsed_zip = m.group(4)[:5]
            # Validate: street should start with a number or be a real street
            if re.match(r'^\d+\s', street) or re.match(r'^(PO BOX|P\.?O\.?\s)', street, re.I):
                if not city:
                    city = parsed_city
                if not state:
                    state = parsed_state
                if not zip_code:
                    zip_code = parsed_zip
                addr = street
                modified = True

    # Pattern 3: "Street City ST" (no zip, no comma)
    elif not city:
        m = re.match(
            r'^(.+?)\s+([A-Za-z][A-Za-z ]*?)\s+([A-Z]{2})\s*$',
            addr
        )
        if m and m.group(3) in US_STATES and re.match(r'^\d+\s', m.group(1)):
            if not city:
                city = m.group(2).strip()
            if not state:
                state = m.group(3)
            addr = m.group(1).strip()
            modified = True

    # Pattern 4: "Street, City, State ZIP" with full state name
    if not city:
        for state_name, state_abbr in STATE_NAMES.items():
            pattern = re.compile(
                r'^(.+?),\s*([A-Za-z ]+?),\s*' + re.escape(state_name) + r'\s+(\d{5})',
                re.IGNORECASE
            )
            m = pattern.match(addr)
            if m:
                addr = m.group(1).strip()
                if not city:
                    city = m.group(2).strip()
                if not state:
                    state = state_abbr
                if not zip_code:
                    zip_code = m.group(3)[:5]
                modified = True
                break

    # --- Strip unit/apt/suite from end of street address ---
    # Census geocoder fails on "123 Main St Apt 4" but works on "123 Main St"
    addr = re.sub(
        r'\s*[,#]\s*(APT|UNIT|SUITE|STE|#|BLDG|BUILDING|FL|FLOOR|RM|ROOM|SP|SPACE)\s*[#.]?\s*\S*\s*$',
        '', addr, flags=re.IGNORECASE
    )
    # Also strip standalone # patterns: "123 Main St #4B"
    addr = re.sub(r'\s+#\s*\S+\s*$', '', addr)
    if addr != orig_addr:
        modified = True

    # --- Normalize common abbreviations ---
    # Census handles most, but some variants confuse it
    replacements = [
        (r'\bSTREET\b', 'ST'),
        (r'\bAVENUE\b', 'AVE'),
        (r'\bBOULEVARD\b', 'BLVD'),
        (r'\bDRIVE\b', 'DR'),
        (r'\bLANE\b', 'LN'),
        (r'\bCOURT\b', 'CT'),
        (r'\bPLACE\b', 'PL'),
        (r'\bROAD\b', 'RD'),
        (r'\bHIGHWAY\b', 'HWY'),
        (r'\bPARKWAY\b', 'PKWY'),
        (r'\bCIRCLE\b', 'CIR'),
    ]
    addr_upper = addr.upper()
    for pattern, replacement in replacements:
        new = re.sub(pattern, replacement, addr_upper)
        if new != addr_upper:
            addr_upper = new
            modified = True
    if modified:
        addr = addr_upper

    # --- Fix zip+4 without dash: "935363128" → "93536" ---
    if zip_code and len(zip_code) > 5 and '-' not in zip_code:
        zip_code = zip_code[:5]
        modified = True

    # --- Strip trailing commas/spaces ---
    addr = addr.strip().rstrip(',').strip()

    return (addr, city, state, zip_code, modified)


def classify_address(address, city, state, zip_code):
    """Classify address pattern for analysis."""
    if not address:
        return "empty"
    if is_garbage(address):
        return "garbage"
    if is_infrastructure(address):
        return "infrastructure"

    addr = address.strip()

    # Check for embedded city/state/zip
    if re.search(r'[A-Z]{2}\s+\d{5}', addr):
        return "embedded_state_zip"
    if re.search(r',\s*[A-Za-z]+\s+[A-Z]{2}\s*$', addr):
        return "embedded_city_state"

    # Check if it starts with a number (normal street address)
    if re.match(r'^\d+\s', addr):
        if city and state:
            return "normal_with_city"
        elif city:
            return "normal_city_no_state"
        elif state:
            return "normal_state_no_city"
        else:
            return "normal_no_context"

    # PO Box
    if re.match(r'^P\.?O\.?\s', addr, re.I):
        return "po_box"

    # Rural route
    if re.match(r'^(RR|RURAL|CR|COUNTY)\s', addr, re.I):
        return "rural_route"

    # Just a name (no street number)
    return "name_only"


# ---------------------------------------------------------------------------
# Census batch geocoding (reused from forward-geocode-census.py)
# ---------------------------------------------------------------------------

def build_census_csv(records):
    """Build CSV for Census batch geocoder."""
    output = io.StringIO()
    writer = csv.writer(output)
    for rec in records:
        writer.writerow([
            rec["id"],
            rec["_clean_address"],
            rec["_clean_city"],
            rec["_clean_state"],
            rec["_clean_zip"],
        ])
    return output.getvalue()


def geocode_census_batch(csv_data):
    """Submit batch to Census and parse results."""
    boundary = "----CensusBatchBoundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
        f"{csv_data}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="benchmark"\r\n\r\n'
        f"Public_AR_Current\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="vintage"\r\n\r\n'
        f"Current_Current\r\n"
        f"--{boundary}--\r\n"
    )
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}

    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                CENSUS_API_URL, data=body.encode("utf-8"),
                headers=headers, method="POST",
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                response_text = resp.read().decode("utf-8")
            break
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                wait = 10 * (attempt + 1)
                print(f"  Census API error (attempt {attempt+1}): {e}. Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  Census API failed after {MAX_RETRIES} attempts: {e}")
                return {}

    results = {}
    reader = csv.reader(io.StringIO(response_text))
    for row in reader:
        if len(row) < 6:
            continue
        rec_id = row[0].strip().strip('"')
        match_status = row[2].strip().strip('"')
        if match_status not in ("Match", "Exact"):
            continue
        coords_str = row[5].strip().strip('"')
        if not coords_str or "," not in coords_str:
            continue
        try:
            lon_str, lat_str = coords_str.split(",")
            lat = float(lat_str.strip())
            lon = float(lon_str.strip())
        except (ValueError, IndexError):
            continue
        if lat < 17 or lat > 72 or lon < -180 or lon > -60:
            continue
        results[rec_id] = {"lat": lat, "lon": lon}

    return results


# ---------------------------------------------------------------------------
# Google Geocoding API fallback
# ---------------------------------------------------------------------------

def geocode_google(address, city, state, zip_code, api_key):
    """Geocode a single address using Google Geocoding API."""
    # Build address string
    parts = [address]
    if city:
        parts.append(city)
    if state:
        parts.append(state)
    if zip_code:
        parts.append(zip_code)
    full_address = ", ".join(p for p in parts if p)

    params = urllib.parse.urlencode({
        "address": full_address + ", USA",
        "key": api_key,
    })
    url = f"{GOOGLE_GEOCODE_URL}?{params}"

    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
            else:
                return None

    if data.get("status") != "OK" or not data.get("results"):
        return None

    result = data["results"][0]
    location = result.get("geometry", {}).get("location", {})
    lat = location.get("lat")
    lng = location.get("lng")

    if not lat or not lng:
        return None

    # Validate US coordinates
    if lat < 17 or lat > 72 or lng < -180 or lng > -60:
        return None

    # Check location_type quality — ROOFTOP or RANGE_INTERPOLATION are good
    loc_type = result.get("geometry", {}).get("location_type", "")
    if loc_type in ("APPROXIMATE",):
        # City-level match, not useful
        return None

    return {"lat": lat, "lon": lng, "location_type": loc_type}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enhanced address cleanup + re-geocoding")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--analyze", action="store_true", help="Analyze address patterns only")
    parser.add_argument("--census-only", action="store_true", help="Skip Google fallback")
    parser.add_argument("--google-only", action="store_true", help="Skip Census, Google only")
    parser.add_argument("--limit", type=int, default=0, help="Process first N records")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N records")
    parser.add_argument("--from-file", type=str, help="Load records from CSV file instead of Supabase")
    args = parser.parse_args()

    print("Enhanced Address Cleanup + Re-Geocoding")
    print("=" * 60)

    # Load records with address but no coordinates
    all_records = []

    if args.from_file:
        print(f"\nLoading records from {args.from_file}...")
        with open(args.from_file, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                all_records.append(row)
        print(f"  Loaded {len(all_records)} records from file")
    else:
        print("\nLoading records with address but no lat/lng...")
        offset = 0
        page_size = 1000

        while True:
            params = {
                "select": "id,address,city,state,zip_code,source_record_id,capacity_mw",
                "latitude": "is.null",
                "address": "neq.",
                "limit": str(page_size),
                "offset": str(offset),
                "order": "id",
            }
            try:
                batch = supabase_get("solar_installations", params)
            except Exception as e:
                print(f"  Error at offset {offset}: {e}")
                offset += page_size
                continue
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
            if offset % 5000 == 0:
                print(f"  Loaded {offset}...")

    print(f"  Total records with address but no coordinates: {len(all_records)}")

    # Filter out infrastructure and garbage
    valid_records = []
    skipped_infra = 0
    skipped_garbage = 0
    skipped_short = 0

    for rec in all_records:
        addr = (rec.get("address") or "").strip()
        if not addr or len(addr) < 5:
            skipped_short += 1
            continue
        if is_garbage(addr):
            skipped_garbage += 1
            continue
        if is_infrastructure(addr):
            skipped_infra += 1
            continue
        valid_records.append(rec)

    print(f"  Valid addresses: {len(valid_records)}")
    print(f"  Skipped: {skipped_infra} infrastructure, {skipped_garbage} garbage, {skipped_short} too short")

    if args.skip > 0:
        valid_records = valid_records[args.skip:]
        print(f"  After skip: {len(valid_records)}")

    if args.limit:
        valid_records = valid_records[:args.limit]
        print(f"  Limited to: {len(valid_records)}")

    # --- Analyze address patterns ---
    pattern_counts = {}
    for rec in valid_records:
        addr = (rec.get("address") or "").strip()
        city = (rec.get("city") or "").strip()
        state = (rec.get("state") or "").strip()
        zip_code = str(rec.get("zip_code") or "").strip()
        pattern = classify_address(addr, city, state, zip_code)
        pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1

    print(f"\n  Address pattern breakdown:")
    for pattern, count in sorted(pattern_counts.items(), key=lambda x: -x[1]):
        print(f"    {pattern}: {count}")

    # --- Clean addresses ---
    print(f"\nCleaning {len(valid_records)} addresses...")
    cleaned = 0
    for rec in valid_records:
        addr = (rec.get("address") or "").strip()
        city = (rec.get("city") or "").strip()
        state = (rec.get("state") or "").strip()
        zip_code = str(rec.get("zip_code") or "").strip()[:5]

        clean_addr, clean_city, clean_state, clean_zip, was_modified = clean_address(
            addr, city, state, zip_code
        )
        rec["_clean_address"] = clean_addr
        rec["_clean_city"] = clean_city
        rec["_clean_state"] = clean_state
        rec["_clean_zip"] = clean_zip
        rec["_was_modified"] = was_modified
        if was_modified:
            cleaned += 1

    print(f"  Addresses modified by cleanup: {cleaned} ({cleaned/len(valid_records)*100:.1f}%)")

    # Show samples of cleaned addresses
    print(f"\n  Sample cleaned addresses:")
    shown = 0
    for rec in valid_records:
        if rec["_was_modified"] and shown < 10:
            orig = rec.get("address", "")
            clean = rec["_clean_address"]
            city = rec["_clean_city"]
            state = rec["_clean_state"]
            zip_code = rec["_clean_zip"]
            print(f"    BEFORE: '{orig}'")
            print(f"    AFTER:  '{clean}', {city}, {state} {zip_code}")
            print()
            shown += 1

    if args.analyze:
        print("\n  [ANALYZE MODE] No geocoding performed.")
        return

    if args.dry_run:
        print(f"\n  [DRY RUN] Would geocode {len(valid_records)} records.")
        est_census = len(valid_records)
        est_google = int(len(valid_records) * 0.2)  # ~20% fallback
        print(f"  Estimated Census batches: {est_census // CENSUS_BATCH_SIZE + 1}")
        print(f"  Estimated Google fallback: ~{est_google} requests (~${est_google * 0.005:.2f})")
        return

    # -----------------------------------------------------------------------
    # Phase 1: Census batch geocoding
    # -----------------------------------------------------------------------
    if not args.google_only:
        print(f"\n{'=' * 60}")
        print(f"Phase 1: Census Batch Geocoding ({len(valid_records)} addresses)")
        print(f"{'=' * 60}")

        census_matched = []
        census_failed = []
        census_errors = 0
        batch_num = 0
        start_time = time.time()

        for batch_start in range(0, len(valid_records), CENSUS_BATCH_SIZE):
            batch_end = min(batch_start + CENSUS_BATCH_SIZE, len(valid_records))
            batch = valid_records[batch_start:batch_end]
            batch_num += 1

            csv_data = build_census_csv(batch)
            t0 = time.time()
            results = geocode_census_batch(csv_data)
            elapsed = time.time() - t0

            matched_this = 0
            for rec in batch:
                if rec["id"] in results:
                    r = results[rec["id"]]
                    rec["_lat"] = r["lat"]
                    rec["_lon"] = r["lon"]
                    census_matched.append(rec)
                    matched_this += 1
                else:
                    census_failed.append(rec)

            pct = matched_this / len(batch) * 100 if batch else 0
            total_done = batch_end
            overall_pct = len(census_matched) / total_done * 100 if total_done else 0
            print(f"  Batch {batch_num}: {matched_this}/{len(batch)} matched ({pct:.0f}%), "
                  f"cumulative {len(census_matched)}/{total_done} ({overall_pct:.1f}%), "
                  f"{elapsed:.1f}s")

            time.sleep(1)  # Polite delay

        elapsed = time.time() - start_time
        print(f"\n  Census results: {len(census_matched)} matched, "
              f"{len(census_failed)} failed, {elapsed:.0f}s")

        # Patch Census matches
        if census_matched:
            print(f"\n  Patching {len(census_matched)} Census matches...")
            patched = 0
            errors = 0

            def _patch_one(rec):
                data = {
                    "latitude": rec["_lat"],
                    "longitude": rec["_lon"],
                    "location_precision": "exact",
                }
                # Also fill city/zip if we parsed them
                if rec["_was_modified"]:
                    orig_city = (rec.get("city") or "").strip()
                    orig_zip = str(rec.get("zip_code") or "").strip()
                    if not orig_city and rec["_clean_city"]:
                        data["city"] = rec["_clean_city"]
                    if not orig_zip and rec["_clean_zip"]:
                        data["zip_code"] = rec["_clean_zip"]
                return supabase_patch(rec["id"], data)

            with ThreadPoolExecutor(max_workers=PATCH_WORKERS) as executor:
                futures = {executor.submit(_patch_one, rec): rec for rec in census_matched}
                for i, future in enumerate(as_completed(futures)):
                    if future.result():
                        patched += 1
                    else:
                        errors += 1
                    if (i + 1) % 500 == 0:
                        print(f"    Patched {patched}, errors {errors} ({i+1}/{len(census_matched)})")

            print(f"  Census patches: {patched} applied, {errors} errors")
    else:
        census_matched = []
        census_failed = valid_records

    # -----------------------------------------------------------------------
    # Phase 2: Google Geocoding API fallback
    # -----------------------------------------------------------------------
    if not args.census_only and census_failed and GOOGLE_MAPS_API_KEY:
        print(f"\n{'=' * 60}")
        print(f"Phase 2: Google Geocoding API ({len(census_failed)} addresses)")
        print(f"{'=' * 60}")

        est_cost = len(census_failed) * 0.005
        print(f"  Estimated cost: ${est_cost:.2f} ({len(census_failed)} x $0.005)")

        google_matched = 0
        google_failed = 0
        google_errors = 0
        start_time = time.time()

        for i, rec in enumerate(census_failed):
            addr = rec["_clean_address"]
            city = rec["_clean_city"]
            state = rec["_clean_state"]
            zip_code = rec["_clean_zip"]

            result = geocode_google(addr, city, state, zip_code, GOOGLE_MAPS_API_KEY)

            if result:
                patch_data = {
                    "latitude": result["lat"],
                    "longitude": result["lon"],
                    "location_precision": "exact",
                }
                if supabase_patch(rec["id"], patch_data):
                    google_matched += 1
                else:
                    google_errors += 1
            else:
                google_failed += 1

            if (i + 1) % 100 == 0:
                elapsed = time.time() - start_time
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (len(census_failed) - i - 1) / rate / 60 if rate > 0 else 0
                print(f"  Progress: {i+1}/{len(census_failed)} "
                      f"({google_matched} matched, {google_failed} failed, "
                      f"{rate:.1f}/sec, ETA: {eta:.0f}min)")

            # Rate limit: 50 requests/sec max for Google
            time.sleep(0.025)

        elapsed = time.time() - start_time
        actual_cost = google_matched * 0.005
        print(f"\n  Google results: {google_matched} matched, "
              f"{google_failed} failed, {google_errors} errors, "
              f"${actual_cost:.2f} cost, {elapsed:.0f}s")

    elif not args.census_only and census_failed and not GOOGLE_MAPS_API_KEY:
        print(f"\n  Skipping Google fallback: GOOGLE_MAPS_API_KEY not set")
        print(f"  {len(census_failed)} records remain ungeocoded")

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    print(f"  Total candidates: {len(all_records)}")
    print(f"  Valid addresses: {len(valid_records)}")
    print(f"  Addresses cleaned: {cleaned}")
    total_geocoded = len(census_matched)
    if not args.census_only:
        total_geocoded += google_matched if 'google_matched' in dir() else 0
    print(f"  Total geocoded: {total_geocoded}")
    print(f"  Remaining: {len(valid_records) - total_geocoded}")
    print("\nDone!")


if __name__ == "__main__":
    main()

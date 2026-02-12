#!/usr/bin/env python3
"""
Census Bureau Batch Forward Geocoder

Uses the US Census Bureau's free batch geocoding API to convert addresses
to lat/lng coordinates. Much faster than Nominatim (10,000 per request vs 1/sec).

Also captures county FIPS codes from Census response to fill county field.

API: https://geocoding.geo.census.gov/geocoder/geographies/addressbatch
  - POST multipart form with CSV (id, address, city, state, zip)
  - Returns CSV with match status, coordinates, FIPS codes
  - Max 10,000 records per batch
  - Free, no API key required

Usage:
  python3 -u scripts/forward-geocode-census.py              # Full geocoding
  python3 -u scripts/forward-geocode-census.py --dry-run     # Report without patching
  python3 -u scripts/forward-geocode-census.py --limit 1000  # Process first N records
"""

import os
import sys
import json
import csv
import io
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load environment
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

CENSUS_API_URL = "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch"
CENSUS_BATCH_SIZE = 1000  # Census allows 10K but times out; 1K works reliably
SUPABASE_BATCH_SIZE = 50
MAX_RETRIES = 3

# FIPS county codes → county names (loaded from Census response)
# Census returns county FIPS which we can use directly


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


def supabase_patch_batch(table, ids, data):
    """PATCH a batch of records with the same data."""
    for i in range(0, len(ids), SUPABASE_BATCH_SIZE):
        batch = ids[i:i + SUPABASE_BATCH_SIZE]
        id_filter = ",".join(batch)
        url = f"{SUPABASE_URL}/rest/v1/{table}?id=in.({id_filter})"
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
        except urllib.error.HTTPError as e:
            print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")


def supabase_patch_single(table, record_id, data):
    """PATCH a single record."""
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
# Address filtering (reuse logic from forward-geocode.py)
# ---------------------------------------------------------------------------

GARBAGE_ADDRESSES = {
    "tbd", "n/a", "na", "none", "unknown", "not available", "see comments",
    "various", "multiple", "confidential", "redacted", "undisclosed",
}


def is_valid_address(address):
    """Check if an address is a real street address worth geocoding."""
    if not address:
        return False
    addr_lower = address.strip().lower()
    if addr_lower in GARBAGE_ADDRESSES:
        return False
    if addr_lower.replace(" ", "").isdigit():
        return False
    grid_patterns = [
        "substation", "switchyard", "switching station", "bus#", "bus #",
        " kv ", " kv\n", "kv line", "kv bus", " kv,",
        "tapping the", "interconnect", "transmission line",
        "138kv", "345kv", "230kv", "500kv", "115kv", "69kv", "161kv",
    ]
    for pattern in grid_patterns:
        if pattern in addr_lower:
            return False
    if addr_lower.rstrip().endswith("kv"):
        return False
    if len(addr_lower) < 5:
        return False
    return True


# ---------------------------------------------------------------------------
# Census batch geocoding
# ---------------------------------------------------------------------------

def build_census_csv(records):
    """Build CSV string for Census batch geocoder.

    Format: Unique ID, Street address, City, State, ZIP
    """
    output = io.StringIO()
    writer = csv.writer(output)
    for rec in records:
        rec_id = rec["id"]
        address = (rec.get("address") or "").strip()
        city = (rec.get("city") or "").strip()
        state = (rec.get("state") or "").strip()
        zip_code = str(rec.get("zip_code") or "").strip()[:5]
        writer.writerow([rec_id, address, city, state, zip_code])
    return output.getvalue()


def geocode_census_batch(csv_data):
    """Submit a batch to Census geocoder and parse results.

    Returns dict of {id: {lat, lon, county_fips, county_name, matched_address}}
    """
    # Build multipart form data
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

    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }

    req = urllib.request.Request(
        CENSUS_API_URL,
        data=body.encode("utf-8"),
        headers=headers,
        method="POST",
    )

    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                response_text = resp.read().decode("utf-8")
            break
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                wait = 10 * (attempt + 1)
                print(f"  Census API error (attempt {attempt+1}): {e}. Retrying in {wait}s...")
                time.sleep(wait)
                # Rebuild request (consumed by previous attempt)
                req = urllib.request.Request(
                    CENSUS_API_URL,
                    data=body.encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
            else:
                print(f"  Census API failed after {MAX_RETRIES} attempts: {e}")
                return {}

    # Parse CSV response
    # Format: "ID","Input Address","Match","Match Type","Matched Address","Coordinates","TIGER Line ID","Side","State FIPS","County FIPS","Tract","Block"
    results = {}
    reader = csv.reader(io.StringIO(response_text))
    for row in reader:
        if len(row) < 6:
            continue

        rec_id = row[0].strip().strip('"')
        match_status = row[2].strip().strip('"')

        if match_status not in ("Match", "Exact"):
            continue

        # Parse coordinates (lon, lat format from Census)
        coords_str = row[5].strip().strip('"')
        if not coords_str or "," not in coords_str:
            continue

        try:
            lon_str, lat_str = coords_str.split(",")
            lat = float(lat_str.strip())
            lon = float(lon_str.strip())
        except (ValueError, IndexError):
            continue

        # Validate coordinates are in US
        if lat < 17 or lat > 72 or lon < -180 or lon > -60:
            continue

        matched_address = row[4].strip().strip('"') if len(row) > 4 else ""
        state_fips = row[8].strip().strip('"') if len(row) > 8 else ""
        county_fips = row[9].strip().strip('"') if len(row) > 9 else ""

        results[rec_id] = {
            "lat": lat,
            "lon": lon,
            "matched_address": matched_address,
            "state_fips": state_fips,
            "county_fips": county_fips,
        }

    return results


# ---------------------------------------------------------------------------
# FIPS county lookup
# ---------------------------------------------------------------------------

# We'll build a county name lookup from existing DB records
COUNTY_LOOKUP = {}  # (state_fips, county_fips) → county_name


def load_county_names_from_db():
    """Load known county names from existing installations to map FIPS → name."""
    global COUNTY_LOOKUP
    # We'll use a simpler approach: just store the full FIPS and look up later
    # For now, we won't try to resolve county names from FIPS — the county field
    # can be filled by Phase 2A's city+state lookup which already works well
    pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Census Bureau batch forward geocoder")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N records")
    args = parser.parse_args()

    print("Census Bureau Batch Forward Geocoder")
    print("=" * 60)

    # Load records with address but no coordinates
    print("Loading records with address but no coordinates...")
    all_records = []
    offset = 0
    page_size = 1000

    while True:
        params = {
            "select": "id,address,city,state,zip_code,source_record_id",
            "latitude": "is.null",
            "address": "not.is.null",
            "limit": str(page_size),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
        if args.limit and len(all_records) >= args.limit:
            all_records = all_records[:args.limit]
            break

    print(f"  Found {len(all_records)} records with address but no coordinates")

    # Filter valid addresses
    valid_records = [r for r in all_records if is_valid_address(r.get("address"))]
    skipped = len(all_records) - len(valid_records)
    print(f"  Valid addresses: {len(valid_records)} (skipped {skipped} non-geocodable)")

    if not valid_records:
        print("No valid records to geocode.")
        return

    # Show source breakdown
    source_counts = {}
    for r in valid_records:
        prefix = r.get("source_record_id", "").split("_")[0]
        source_counts[prefix] = source_counts.get(prefix, 0) + 1
    print(f"\n  Source breakdown:")
    for src, cnt in sorted(source_counts.items(), key=lambda x: -x[1]):
        print(f"    {src}: {cnt}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would geocode {len(valid_records)} records via Census batch API.")
        # Show sample
        print(f"\n  Sample addresses:")
        for r in valid_records[:10]:
            addr = r.get("address", "")
            city = r.get("city", "")
            state = r.get("state", "")
            print(f"    {r['source_record_id']}: '{addr}', {city}, {state}")
        return

    # Process in Census batches of 10,000
    total_geocoded = 0
    total_county_filled = 0
    total_failed = 0
    total_errors = 0
    batch_num = 0

    for batch_start in range(0, len(valid_records), CENSUS_BATCH_SIZE):
        batch_end = min(batch_start + CENSUS_BATCH_SIZE, len(valid_records))
        batch = valid_records[batch_start:batch_end]
        batch_num += 1

        print(f"\nBatch {batch_num}: records {batch_start+1}-{batch_end} of {len(valid_records)}")

        # Build CSV
        csv_data = build_census_csv(batch)
        print(f"  Submitting {len(batch)} addresses to Census API...")

        # Submit to Census
        start_time = time.time()
        results = geocode_census_batch(csv_data)
        elapsed = time.time() - start_time
        print(f"  Census responded in {elapsed:.1f}s with {len(results)} matches ({len(results)/len(batch)*100:.1f}%)")

        if not results:
            total_failed += len(batch)
            continue

        # Patch Supabase with results (parallel for speed)
        patches = []
        for rec in batch:
            rec_id = rec["id"]
            if rec_id not in results:
                total_failed += 1
                continue

            r = results[rec_id]
            patch_data = {
                "latitude": r["lat"],
                "longitude": r["lon"],
                "location_precision": "exact",
            }
            patches.append((rec_id, patch_data))

        patched = 0
        county_filled = 0
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = {
                executor.submit(supabase_patch_single, "solar_installations", rid, data): rid
                for rid, data in patches
            }
            for future in as_completed(futures):
                if future.result():
                    patched += 1
                else:
                    total_errors += 1

        total_geocoded += patched
        total_county_filled += county_filled
        print(f"  Patched: {patched} coordinates")

        # Brief pause between batches to be polite
        if batch_end < len(valid_records):
            time.sleep(2)

    print(f"\n{'=' * 60}")
    print("Census Batch Geocoding Summary")
    print(f"{'=' * 60}")
    print(f"  Total candidates: {len(all_records)}")
    print(f"  Valid addresses: {len(valid_records)}")
    print(f"  Successfully geocoded: {total_geocoded}")
    print(f"  No match from Census: {total_failed}")
    print(f"  Patch errors: {total_errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Forward Geocode: Address → Coordinates

Finds installations that have an address but no lat/lng coordinates and
geocodes them using Nominatim (OpenStreetMap). This fixes the issue where
records have location text but no map marker.

Rate: ~1 req/sec = ~18 min for 1,065 records.

Usage:
  python3 -u scripts/forward-geocode.py              # Full geocoding
  python3 -u scripts/forward-geocode.py --dry-run     # Report without patching
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# Load environment
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SolarTrack/1.0 (solar installation database enrichment)"
RATE_LIMIT = 1.1  # seconds between requests


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


# ---------------------------------------------------------------------------
# Nominatim forward geocode
# ---------------------------------------------------------------------------

def geocode_address(address, city=None, state=None, zip_code=None):
    """Forward geocode an address string to lat/lng using Nominatim."""
    # Build a structured query for better results
    parts = []
    if address and address.lower() not in ("tbd", "n/a", "na", "none", "unknown", "not available"):
        parts.append(address)
    if city:
        parts.append(city)
    if state:
        parts.append(state)
    if zip_code:
        parts.append(str(zip_code))

    if not parts:
        return None

    query = ", ".join(parts)

    params = {
        "q": query,
        "format": "json",
        "limit": "1",
        "countrycodes": "us",
        "addressdetails": "1",
    }

    url = NOMINATIM_URL + "?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": USER_AGENT}
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.loads(resp.read().decode())
            if results:
                return {
                    "lat": float(results[0]["lat"]),
                    "lon": float(results[0]["lon"]),
                    "display_name": results[0].get("display_name", ""),
                }
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, KeyError) as e:
        print(f"  Geocode error for '{query}': {e}")
    except Exception as e:
        print(f"  Unexpected error for '{query}': {e}")

    return None


# ---------------------------------------------------------------------------
# Filter out garbage addresses
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
    # Skip if it's just a number
    if addr_lower.replace(" ", "").isdigit():
        return False
    # Skip grid infrastructure names (common in ISO queue data)
    grid_patterns = [
        "substation", "switchyard", "switching station", "bus#", "bus #",
        " kv ", " kv\n", "kv line", "kv bus", " kv,",
        "tapping the", "interconnect", "transmission line",
        "tap 138kv", "tap 345kv", "tap 230kv", "tap 69kv", "tap 115kv",
        "138kv", "345kv", "230kv", "500kv", "115kv", "69kv", "161kv",
    ]
    for pattern in grid_patterns:
        if pattern in addr_lower:
            return False
    # Also check if address ends with "kV" or "kv" (e.g., "Los Banos 230 kV")
    if addr_lower.rstrip().endswith("kv"):
        return False
    # Skip very short addresses (likely abbreviated/incomplete)
    if len(addr_lower) < 5:
        return False
    # Must contain a digit to look like a street address (e.g., "123 Main St")
    # OR have city+state context that can help geocode
    has_digit = any(c.isdigit() for c in address)
    if not has_digit:
        # No house number — might still work if it's a road name
        # But skip pure location names like "Mendota" or "Tranquility"
        words = addr_lower.split()
        if len(words) <= 2:
            return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Forward geocode addresses to coordinates")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    args = parser.parse_args()

    print("Forward Geocoding: Address → Coordinates")
    print("=" * 60)

    # Load records with address but no coordinates
    print("Loading records with address but no coordinates...")
    all_records = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,address,city,state,zip_code,source_record_id",
            "latitude": "is.null",
            "address": "not.is.null",
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

    print(f"  Found {len(all_records)} records with address but no coordinates")

    # Filter to valid addresses
    valid_records = [r for r in all_records if is_valid_address(r.get("address"))]
    skipped = len(all_records) - len(valid_records)
    print(f"  Valid addresses to geocode: {len(valid_records)} (skipped {skipped} garbage)")

    if not valid_records:
        print("No valid records to geocode.")
        return

    # Show sample of skipped
    if skipped > 0:
        skipped_records = [r for r in all_records if not is_valid_address(r.get("address"))]
        print(f"\n  Sample skipped addresses:")
        for r in skipped_records[:5]:
            print(f"    {r['source_record_id']}: '{r.get('address')}'")

    # Show sample of valid
    print(f"\n  Sample valid addresses:")
    for r in valid_records[:5]:
        addr = r.get("address", "")
        city = r.get("city", "")
        state = r.get("state", "")
        print(f"    {r['source_record_id']}: '{addr}', {city}, {state}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would geocode {len(valid_records)} records.")
        return

    # Geocode each record
    print(f"\nGeocoding {len(valid_records)} records (rate: 1 req/sec)...")
    geocoded = 0
    failed = 0
    errors = 0

    for i, record in enumerate(valid_records):
        address = record.get("address")
        city = record.get("city")
        state = record.get("state")
        zip_code = record.get("zip_code")

        result = geocode_address(address, city, state, zip_code)
        time.sleep(RATE_LIMIT)

        if result:
            patch = {
                "latitude": result["lat"],
                "longitude": result["lon"],
            }
            ok = supabase_patch(
                "solar_installations",
                patch,
                {"id": f"eq.{record['id']}"},
            )
            if ok:
                geocoded += 1
            else:
                errors += 1
        else:
            failed += 1

        if (i + 1) % 50 == 0:
            print(f"  Progress: {i+1}/{len(valid_records)} | geocoded: {geocoded}, failed: {failed}, errors: {errors}")

    print(f"\n{'=' * 60}")
    print("Forward Geocoding Summary")
    print(f"{'=' * 60}")
    print(f"  Total candidates: {len(all_records)}")
    print(f"  Valid addresses: {len(valid_records)}")
    print(f"  Successfully geocoded: {geocoded}")
    print(f"  Geocode failed (no result): {failed}")
    print(f"  Patch errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Reverse geocode installations that have coordinates but no street address.

Uses Nominatim (OpenStreetMap) - free, 1 request/second rate limit.
Targets USPVDB (~5,712) and NY-Sun (~7,653) records that have lat/lon
but no address field.

Rate: ~1 req/sec = ~3.5 hours for ~13K records.
"""

import os
import sys
import json
import time
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

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "SolarTrack/1.0 (solar installation database enrichment)"
RATE_LIMIT = 1.1  # seconds between requests (slightly > 1 per Nominatim policy)


def supabase_get(table, params):
    """GET request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  GET error ({e.code}): {e.read().decode()[:200]}")
        return []


def supabase_patch(record_id, data):
    """PATCH a single installation record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{record_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
        return False


def reverse_geocode(lat, lon):
    """Reverse geocode a lat/lon using Nominatim."""
    params = urllib.parse.urlencode({
        "format": "json",
        "lat": lat,
        "lon": lon,
        "addressdetails": 1,
        "zoom": 18,  # Building-level detail
    })
    url = f"{NOMINATIM_URL}?{params}"

    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept-Language": "en",
    })

    try:
        res = urllib.request.urlopen(req, timeout=10)
        data = json.loads(res.read().decode())
        return data
    except Exception as e:
        return None


def extract_address(nominatim_result):
    """Extract structured address from Nominatim response."""
    if not nominatim_result or "address" not in nominatim_result:
        return None

    addr = nominatim_result["address"]

    # Build street address
    house_number = addr.get("house_number", "")
    road = addr.get("road", "")
    street_address = f"{house_number} {road}".strip() if road else None

    city = (addr.get("city") or addr.get("town") or
            addr.get("village") or addr.get("hamlet") or "")
    county = addr.get("county", "")
    state = addr.get("state", "")
    postcode = addr.get("postcode", "")

    # Only return if we got meaningful data
    if not street_address and not city:
        return None

    return {
        "address": street_address,
        "city": city or None,
        "county": county.replace(" County", "").strip() or None,
        "zip_code": postcode[:10] if postcode else None,
    }


def main():
    print("Reverse Geocoding Script (Nominatim)")
    print("=" * 60)
    print(f"Rate limit: {RATE_LIMIT}s between requests")

    # Fetch records with coordinates but no address
    # Target: USPVDB and NY-Sun records
    sources = [
        ("uspvdb_*", "USPVDB"),
        ("nysun_*", "NY-Sun"),
    ]

    total_geocoded = 0
    total_updated = 0
    total_skipped = 0
    total_failed = 0

    for source_prefix, source_name in sources:
        print(f"\n{'=' * 60}")
        print(f"Processing {source_name} records...")
        print("=" * 60)

        offset = 0
        source_geocoded = 0
        source_updated = 0

        while True:
            records = supabase_get("solar_installations", {
                "select": "id,latitude,longitude,address,city,zip_code",
                "source_record_id": f"like.{source_prefix}",
                "latitude": "not.is.null",
                "longitude": "not.is.null",
                "address": "is.null",
                "limit": 1000,
                "offset": offset,
                "order": "id",
            })

            if not records:
                break

            print(f"  Fetched {len(records)} records (offset {offset})...")

            for i, rec in enumerate(records):
                lat = rec["latitude"]
                lon = rec["longitude"]

                # Skip if already has address
                if rec.get("address"):
                    total_skipped += 1
                    continue

                # Reverse geocode
                result = reverse_geocode(lat, lon)
                time.sleep(RATE_LIMIT)  # Rate limit

                if result:
                    addr_data = extract_address(result)
                    if addr_data:
                        # Only update fields that are currently null
                        update = {}
                        if addr_data.get("address") and not rec.get("address"):
                            update["address"] = addr_data["address"]
                        if addr_data.get("city") and not rec.get("city"):
                            update["city"] = addr_data["city"]
                        if addr_data.get("zip_code") and not rec.get("zip_code"):
                            update["zip_code"] = addr_data["zip_code"]

                        if update:
                            if supabase_patch(rec["id"], update):
                                source_updated += 1
                                total_updated += 1

                    source_geocoded += 1
                    total_geocoded += 1
                else:
                    total_failed += 1

                # Progress every 100 records
                if (source_geocoded + total_failed) % 100 == 0:
                    print(f"    Progress: geocoded={source_geocoded}, updated={source_updated}, failed={total_failed}")

            offset += 1000
            if len(records) < 1000:
                break

        print(f"  {source_name} complete: geocoded={source_geocoded}, updated={source_updated}")

    print(f"\n{'=' * 60}")
    print("Reverse Geocoding Summary")
    print("=" * 60)
    print(f"  Total geocoded: {total_geocoded}")
    print(f"  Total updated: {total_updated}")
    print(f"  Already had address: {total_skipped}")
    print(f"  Failed: {total_failed}")
    print("\nDone!")


if __name__ == "__main__":
    main()

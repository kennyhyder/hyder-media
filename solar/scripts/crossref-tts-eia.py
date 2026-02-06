#!/usr/bin/env python3
"""
Cross-reference TTS records against EIA-860 to inherit addresses.

TTS (Tracking the Sun) records have city+zip but no street address or coordinates.
EIA-860 records have full addresses + precise coordinates.

Match strategy:
1. Match by same state + same city + similar capacity (within 50%)
2. For matches, copy: address, latitude, longitude, operator_name
3. Update location_precision to 'address' for enriched records

This can recover addresses for thousands of TTS records.
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from collections import defaultdict
from dotenv import load_dotenv

# Load environment
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '..', '.env.local'))

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

CAPACITY_TOLERANCE = 0.50  # 50% capacity match tolerance


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


def supabase_patch_batch(records):
    """PATCH multiple records individually."""
    updated = 0
    for rec_id, data in records:
        url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{rec_id}"
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
            updated += 1
        except urllib.error.HTTPError as e:
            print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
    return updated


def normalize_city(city):
    """Normalize city name for matching."""
    if not city:
        return ""
    return city.lower().strip().replace(".", "").replace(" city", "").replace(" twp", "").replace(" township", "")


def capacity_match(cap1, cap2, tolerance=CAPACITY_TOLERANCE):
    """Check if two capacities are within tolerance of each other."""
    if not cap1 or not cap2:
        return False
    cap1 = float(cap1)
    cap2 = float(cap2)
    if cap1 == 0 or cap2 == 0:
        return False
    ratio = cap1 / cap2
    return (1 - tolerance) <= ratio <= (1 + tolerance)


def main():
    print("TTS ↔ EIA-860 Cross-Reference for Address Inheritance")
    print("=" * 60)

    # 1. Load all EIA-860 records with addresses
    print("\n1. Loading EIA-860 records with addresses...")
    eia_records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,address,city,state,zip_code,latitude,longitude,capacity_mw,operator_name,owner_name",
            "source_record_id": "like.eia860_*",
            "address": "not.is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        eia_records.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break

    print(f"  Loaded {len(eia_records)} EIA-860 records with addresses")

    # Index EIA records by state + normalized city
    eia_by_location = defaultdict(list)
    for rec in eia_records:
        key = (rec.get("state", "").upper(), normalize_city(rec.get("city")))
        eia_by_location[key].append(rec)

    print(f"  Indexed into {len(eia_by_location)} state+city groups")

    # 2. Load TTS records without addresses
    print("\n2. Loading TTS records without coordinates...")
    tts_records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,city,state,zip_code,capacity_mw,operator_name,owner_name,latitude,longitude",
            "source_record_id": "like.tts3_*",
            "latitude": "is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        tts_records.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break

    print(f"  Loaded {len(tts_records)} TTS records without coordinates")

    # 3. Also load CA DGStats records without coordinates
    print("\n3. Loading CA DGStats records without coordinates...")
    cadg_records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,city,state,zip_code,capacity_mw,operator_name,owner_name,latitude,longitude",
            "source_record_id": "like.cadg_*",
            "latitude": "is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        cadg_records.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break

    print(f"  Loaded {len(cadg_records)} CA DGStats records without coordinates")

    all_records = tts_records + cadg_records
    print(f"\n  Total records to cross-reference: {len(all_records)}")

    # 4. Match and enrich
    print(f"\n{'=' * 60}")
    print("4. Cross-referencing...")
    print("=" * 60)

    matched = 0
    enriched_address = 0
    enriched_coords = 0
    enriched_operator = 0
    no_match = 0
    updates_batch = []

    for i, tts_rec in enumerate(all_records):
        state = (tts_rec.get("state") or "").upper()
        city = normalize_city(tts_rec.get("city"))
        key = (state, city)

        candidates = eia_by_location.get(key, [])
        if not candidates:
            no_match += 1
            continue

        # Try capacity matching first
        best_match = None
        if tts_rec.get("capacity_mw"):
            for eia_rec in candidates:
                if capacity_match(tts_rec["capacity_mw"], eia_rec.get("capacity_mw")):
                    best_match = eia_rec
                    break

        # If no capacity match, just use first candidate in same city (for operator/name info only)
        if not best_match:
            # Only inherit location data if there's exactly one EIA record in this city
            if len(candidates) == 1:
                best_match = candidates[0]
            else:
                # Multiple EIA records in same city - can still inherit operator if all same
                operators = set(r.get("operator_name") for r in candidates if r.get("operator_name"))
                if len(operators) == 1 and not tts_rec.get("operator_name"):
                    # All EIA records in this city have the same operator
                    update = {"operator_name": operators.pop()}
                    updates_batch.append((tts_rec["id"], update))
                    enriched_operator += 1
                    matched += 1
                else:
                    no_match += 1
                continue

        # Build update from matched EIA record
        update = {}

        if best_match.get("address") and not tts_rec.get("address"):
            update["address"] = best_match["address"]
            enriched_address += 1

        if best_match.get("latitude") and not tts_rec.get("latitude"):
            update["latitude"] = best_match["latitude"]
            update["longitude"] = best_match["longitude"]
            update["location_precision"] = "address"
            enriched_coords += 1

        if best_match.get("operator_name") and not tts_rec.get("operator_name"):
            update["operator_name"] = best_match["operator_name"]
            enriched_operator += 1

        if update:
            updates_batch.append((tts_rec["id"], update))
            matched += 1

        # Flush batch
        if len(updates_batch) >= 50:
            supabase_patch_batch(updates_batch)
            updates_batch = []
            print(f"  Progress: {i+1}/{len(all_records)} checked, {matched} matched, {enriched_coords} coords, {enriched_address} addresses")

    # Flush remaining
    if updates_batch:
        supabase_patch_batch(updates_batch)

    # 5. Summary
    print(f"\n{'=' * 60}")
    print("Cross-Reference Summary")
    print("=" * 60)
    print(f"  Records checked: {len(all_records)}")
    print(f"  Matched to EIA-860: {matched}")
    print(f"  No match: {no_match}")
    print(f"\n  Enrichments:")
    print(f"    Addresses inherited: {enriched_address}")
    print(f"    Coordinates inherited: {enriched_coords}")
    print(f"    Operator names inherited: {enriched_operator}")
    print(f"\n  Note: Matches require same state + same city.")
    print(f"  Coordinate inheritance requires capacity match or single EIA record in city.")

    print("\nDone!")


if __name__ == "__main__":
    main()

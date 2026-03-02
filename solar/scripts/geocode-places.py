#!/usr/bin/env python3
"""
Google Places API geocoding for named solar installations.

Targets utility-scale (>=1 MW) active installations that have facility names
but no coordinates and no street addresses. Uses Google Places Text Search API
to find facilities by name + state/city.

Input: CSV file with columns: id, site_name, state, city, capacity_mw, source_record_id
Output: Patches latitude, longitude, location_precision, address to Supabase

Cost: ~$0.032/query (Basic tier, location only)
      1,549 records × $0.032 = ~$50

Usage:
    python3 -u scripts/geocode-places.py                                    # Full run
    python3 -u scripts/geocode-places.py --from-file data/named_installations_no_coords.csv
    python3 -u scripts/geocode-places.py --limit 100                        # Test first N
    python3 -u scripts/geocode-places.py --dry-run                          # Preview without patching
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
GOOGLE_API_KEY = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

if not GOOGLE_API_KEY:
    print("Error: GOOGLE_MAPS_API_KEY must be set")
    sys.exit(1)

# Google Places Text Search API (New)
PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
# Only request location fields (Basic tier = $0.032/query vs $0.040 for Advanced)
FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.types"

# US state name lookup for search queries
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "PR": "Puerto Rico", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

# Solar-related Google Places types that indicate a real solar facility
SOLAR_TYPES = {
    "electric_power_plant", "power_plant", "electrician", "electrical_contractor",
    "energy_equipment_and_solutions", "solar_energy_contractor", "solar_photovoltaic_power_plant",
}

# Types that indicate WRONG match (residential, restaurant, etc.)
BAD_TYPES = {
    "restaurant", "cafe", "bar", "store", "shopping_mall", "lodging", "hotel",
    "bank", "hospital", "school", "church", "gas_station", "car_dealer",
    "beauty_salon", "gym", "movie_theater", "amusement_park",
}


def search_places(name, state, city=None):
    """Search Google Places for a solar facility by name."""
    # Build search query
    query_parts = [name]
    if "solar" not in name.lower():
        query_parts.append("solar")
    if city and city.strip():
        query_parts.append(city.strip())
    if state:
        state_name = STATE_NAMES.get(state.upper(), state)
        query_parts.append(state_name)

    query = " ".join(query_parts)

    body = json.dumps({
        "textQuery": query,
        "languageCode": "en",
        "regionCode": "US",
    }).encode("utf-8")

    req = urllib.request.Request(
        PLACES_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": FIELD_MASK,
        },
        method="POST",
    )

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                return data.get("places", []), query
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 ** attempt)
                continue
            body_text = e.read().decode() if hasattr(e, 'read') else str(e)
            return None, f"HTTP {e.code}: {body_text[:200]}"
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
                continue
            return None, str(e)

    return None, "Max retries exceeded"


def validate_result(place, name, state, capacity_mw):
    """Check if a Places result is a plausible match for our installation."""
    display_name = place.get("displayName", {}).get("text", "")
    address = place.get("formattedAddress", "")
    types = set(place.get("types", []))
    location = place.get("location", {})

    lat = location.get("latitude")
    lng = location.get("longitude")

    if not lat or not lng:
        return None, "no_location"

    # Check if in the right state
    if state and state.upper() in STATE_NAMES:
        state_name = STATE_NAMES[state.upper()]
        state_abbr = state.upper()
        if state_abbr not in address and state_name not in address:
            return None, "wrong_state"

    # Check for bad types (restaurants, stores, etc.)
    if types & BAD_TYPES:
        return None, "wrong_type"

    # Check name similarity
    name_lower = name.lower()
    result_lower = display_name.lower()
    name_words = set(re.findall(r'\b[a-z]{3,}\b', name_lower))
    result_words = set(re.findall(r'\b[a-z]{3,}\b', result_lower))

    # Remove common filler words and geographic terms
    filler = {"solar", "energy", "power", "project", "farm", "plant", "the", "and",
              "for", "llc", "inc", "corp", "station", "facility", "center", "north",
              "south", "east", "west", "creek", "river", "lake", "spring", "springs",
              "mountain", "valley", "hill", "ridge", "grove", "field", "meadow",
              "branch", "fork", "run", "falls", "mills", "point", "park", "woods",
              "cove", "bay", "port", "landing", "crossing", "heights", "county",
              "renewable", "generation", "group", "partners", "holdings", "resources",
              "development", "green", "clean", "capital", "ventures"}
    name_core = name_words - filler
    result_core = result_words - filler

    # Calculate overlap
    overlap = name_core & result_core
    has_solar_type = bool(types & SOLAR_TYPES)

    # Result must contain "solar" in name or types to be a solar facility
    is_solar_result = (
        "solar" in result_lower
        or has_solar_type
        or any(t for t in types if "power" in t or "energy" in t or "electric" in t)
    )

    # Scoring — prioritize precision over recall:
    # We'd rather miss some records than patch wrong coordinates.
    #
    # - Best: 2+ core word overlap → accept
    # - Good: 1 core word overlap + solar result + word is 5+ chars (distinctive)
    # - Reject: everything else

    if len(name_core) == 0:
        # Name is all filler words (e.g., "Solar Energy Project") — too generic, skip
        return None, "generic_name"
    elif len(overlap) >= 2:
        pass  # Strong match — accept
    elif len(overlap) == 1:
        # Single word overlap — only accept if the word is distinctive (5+ chars)
        # AND the result is solar-related
        overlap_word = list(overlap)[0]
        if len(overlap_word) < 5:
            return None, "weak_short_overlap"
        if not is_solar_result:
            return None, "weak_match_no_solar"
    else:
        # No core word overlap — reject
        return None, "low_name_match"

    return {
        "latitude": round(lat, 7),
        "longitude": round(lng, 7),
        "address": address,
        "location_precision": "address",
    }, "matched"


def supabase_patch(record_id, data):
    """Patch a single installation record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{record_id}"
    body = json.dumps(data, allow_nan=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return True
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False
        except Exception:
            if attempt < 2:
                time.sleep(1)
                continue
            return False
    return False


def main():
    parser = argparse.ArgumentParser(description="Google Places geocoding for named solar installations")
    parser.add_argument("--from-file", help="CSV file with id, site_name, state, city, capacity_mw")
    parser.add_argument("--limit", type=int, help="Process first N records")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N records")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    args = parser.parse_args()

    print("Google Places Geocoding for Named Solar Installations")
    print("=" * 60)

    # Load records
    if args.from_file:
        print(f"\nLoading from {args.from_file}...")
        records = []
        with open(args.from_file, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                records.append({
                    "id": row["id"],
                    "site_name": row["site_name"],
                    "state": row.get("state", ""),
                    "city": row.get("city", ""),
                    "capacity_mw": float(row["capacity_mw"]) if row.get("capacity_mw") else None,
                    "source_record_id": row.get("source_record_id", ""),
                })
        print(f"  Loaded {len(records)} records")
    else:
        print("\nLoading from Supabase...")
        # Load via REST API
        records = []
        offset = 0
        while True:
            params = {
                "select": "id,site_name,state,city,capacity_mw,source_record_id",
                "latitude": "is.null",
                "capacity_mw": "gte.1",
                "site_status": "eq.active",
                "order": "capacity_mw.desc.nullslast",
                "limit": 1000,
                "offset": offset,
            }
            url = f"{SUPABASE_URL}/rest/v1/solar_installations?" + "&".join(
                f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
            )
            req = urllib.request.Request(url, headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            })
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode())
                    if not data:
                        break
                    for row in data:
                        name = (row.get("site_name") or "").strip()
                        if len(name) <= 3:
                            continue
                        if "Substation" in name or "kV" in name:
                            continue
                        # Skip ID-style names
                        if re.match(r'^[A-Z]{2,4}-[0-9]+', name):
                            continue
                        # Skip single-word names
                        if " " not in name:
                            continue
                        # Skip TTS city-as-name records
                        src = row.get("source_record_id", "")
                        city = (row.get("city") or "").strip()
                        if src.startswith("tts3_") and name.upper() == city.upper():
                            continue
                        records.append(row)
                    offset += len(data)
                    if len(data) < 1000:
                        break
            except Exception as e:
                print(f"  Error loading: {e}")
                break
        print(f"  Loaded {len(records)} candidate records")

    if args.skip:
        records = records[args.skip:]
        print(f"  Skipped {args.skip}, {len(records)} remaining")

    if args.limit:
        records = records[:args.limit]
        print(f"  Limited to {args.limit}")

    if not records:
        print("  No records to process")
        return

    est_cost = len(records) * 0.032
    print(f"\n  Estimated cost: ${est_cost:.2f} ({len(records)} × $0.032)")
    if args.dry_run:
        print("  DRY RUN — no patches will be applied")

    # Process records
    print(f"\n{'=' * 60}")
    print(f"Searching Google Places ({len(records)} installations)")
    print(f"{'=' * 60}")

    matched = 0
    failed = 0
    errors = 0
    patched = 0
    patch_errors = 0
    start_time = time.time()

    fail_reasons = {}
    samples = []

    for i, rec in enumerate(records):
        name = rec["site_name"]
        state = rec.get("state", "")
        city = rec.get("city", "")
        capacity = rec.get("capacity_mw")

        places, query = search_places(name, state, city)

        if places is None:
            errors += 1
            if i < 20:
                print(f"  ERROR [{i+1}]: {name} — {query}")
            continue

        if not places:
            failed += 1
            fail_reasons["not_found"] = fail_reasons.get("not_found", 0) + 1
            continue

        # Validate best result
        result, reason = validate_result(places[0], name, state, capacity)

        if result is None:
            failed += 1
            fail_reasons[reason] = fail_reasons.get(reason, 0) + 1
            continue

        matched += 1

        if not args.dry_run:
            if supabase_patch(rec["id"], result):
                patched += 1
            else:
                patch_errors += 1

        if len(samples) < 10:
            display = places[0].get("displayName", {}).get("text", "?")
            samples.append({
                "query": name,
                "found": display,
                "lat": result["latitude"],
                "lng": result["longitude"],
                "address": result["address"],
            })

        # Rate limit: 10 QPS max for Places
        time.sleep(0.15)

        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(records) - i - 1) / rate / 60 if rate > 0 else 0
            actual_cost = (matched + failed + errors) * 0.032
            print(f"  Progress: {i+1}/{len(records)} "
                  f"({matched} matched, {failed} failed, {errors} errors, "
                  f"{rate:.1f}/sec, ${actual_cost:.2f}, ETA: {eta:.0f}min)")

    elapsed = time.time() - start_time
    actual_cost = (matched + failed + errors) * 0.032

    # Results
    print(f"\n{'=' * 60}")
    print("Results")
    print(f"{'=' * 60}")
    print(f"  Total processed: {matched + failed + errors}")
    print(f"  Matched: {matched} ({matched/(matched+failed+errors)*100:.1f}%)" if matched + failed + errors > 0 else "")
    print(f"  Failed: {failed}")
    print(f"  Errors: {errors}")
    print(f"  Cost: ${actual_cost:.2f}")
    print(f"  Time: {elapsed:.0f}s")

    if not args.dry_run:
        print(f"  Patched: {patched}")
        print(f"  Patch errors: {patch_errors}")

    if fail_reasons:
        print(f"\n  Failure reasons:")
        for reason, count in sorted(fail_reasons.items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}")

    if samples:
        print(f"\n  Sample matches:")
        for s in samples:
            print(f"    '{s['query']}' → '{s['found']}'")
            print(f"      {s['lat']}, {s['lng']} | {s['address']}")

    print("\nDone!")


if __name__ == "__main__":
    main()

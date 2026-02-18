#!/usr/bin/env python3
"""
Google Places API Enrichment Script

Uses Google Places API (New) Text Search to enrich entity tables with:
- Website, phone number, address
- Google rating and review count
- Business status
- Google Place ID for future updates

Cost: ~$40/1000 queries (Advanced tier for contact fields)
Free credit: $200/month Google Maps Platform = ~5,000 queries/month

Usage:
  python3 -u scripts/enrich-google-places.py                          # Both tables, top entities
  python3 -u scripts/enrich-google-places.py --table installers       # Installers only
  python3 -u scripts/enrich-google-places.py --table owners           # Owners only
  python3 -u scripts/enrich-google-places.py --table manufacturers    # Manufacturers only
  python3 -u scripts/enrich-google-places.py --limit 5000             # Process first N
  python3 -u scripts/enrich-google-places.py --min-sites 5            # Only entities with 5+ sites
  python3 -u scripts/enrich-google-places.py --dry-run                # Preview without patching
"""

import os
import sys
import json
import time
import re
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
GOOGLE_API_KEY = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

if not GOOGLE_API_KEY:
    print("Error: GOOGLE_MAPS_API_KEY must be set in .env.local")
    sys.exit(1)

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus"

# Patterns to skip (non-business names)
SKIP_PATTERNS = [
    re.compile(r"^(mr|mrs|ms|dr|rev|hon)\b", re.I),
    re.compile(r"\b(trust|estate|heirs|heir|deceased|revocable|irrevocable)\b", re.I),
    re.compile(r"\b(city of|county of|town of|state of|department of|village of|township of)\b", re.I),
    re.compile(r"\b(school district|housing authority|water district|fire district)\b", re.I),
    re.compile(r"^[A-Z][a-z]+ [A-Z][a-z]+$"),  # Two-word personal names like "John Smith"
]

BUSINESS_KEYWORDS = re.compile(
    r"\b(solar|energy|power|electric|inc|llc|corp|co\b|ltd|group|partners|"
    r"services|construction|install|utility|renewable|sun|volt|watt|light|"
    r"generation|development|resources|holdings|capital|solutions|systems)\b", re.I
)


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


def supabase_patch(table, data, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    body = json.dumps(data, allow_nan=False).encode()
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


# ---------------------------------------------------------------------------
# Google Places API
# ---------------------------------------------------------------------------

def search_place(entity_name, state=None, search_type="solar"):
    """Search Google Places for a business entity."""
    query = entity_name
    if state:
        query += f" {state}"
    # Add context keyword if not already in name for better matching
    if search_type == "manufacturer":
        if not re.search(r"\b(solar|energy|power|electric|inverter|panel|module|battery)\b", entity_name, re.I):
            query += " solar manufacturer"
    elif not re.search(r"\b(solar|energy|power|electric)\b", entity_name, re.I):
        query += " solar"

    body = json.dumps({
        "textQuery": query,
        "maxResultCount": 1,
    }).encode()

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    req = urllib.request.Request(PLACES_URL, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            places = data.get("places", [])
            return places[0] if places else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if hasattr(e, 'read') else str(e)
        print(f"    Google API error {e.code}: {error_body[:200]}")
        return None
    except Exception as e:
        print(f"    Google API error: {e}")
        return None


def name_match_score(our_name, google_name):
    """Compute word overlap score between entity name and Google's returned name."""
    if not our_name or not google_name:
        return 0

    def normalize(s):
        s = re.sub(r"[^a-z0-9\s]", "", s.lower())
        # Remove common suffixes
        s = re.sub(r"\b(inc|llc|corp|co|ltd|group|the)\b", "", s)
        return set(s.split())

    our_words = normalize(our_name)
    google_words = normalize(google_name)

    if not our_words or not google_words:
        return 0

    overlap = our_words & google_words
    # Score = overlap / min(len) — high if most words match
    return len(overlap) / min(len(our_words), len(google_words))


def parse_address_components(components):
    """Parse Google address components into city, state, zip."""
    city = state = zip_code = None
    for comp in (components or []):
        types = comp.get("types", [])
        if "locality" in types:
            city = comp.get("longText")
        elif "administrative_area_level_1" in types:
            state = comp.get("shortText")
        elif "postal_code" in types:
            zip_code = comp.get("longText")
    return city, state, zip_code


def should_skip(name):
    """Check if entity name looks like a non-business (person, trust, government)."""
    if not name:
        return True
    for pattern in SKIP_PATTERNS:
        if pattern.search(name):
            # But allow if it also has business keywords
            if BUSINESS_KEYWORDS.search(name):
                return False
            return True
    return False


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_table(table_name, min_sites, dry_run=False, limit=None):
    """Process entities in a table via Google Places API."""
    print(f"\n{'='*60}")
    print(f"Processing {table_name}")
    print(f"{'='*60}")

    is_manufacturer = table_name == "solar_manufacturers"

    # Load entities that haven't been enriched yet
    if is_manufacturer:
        site_count_col = "equipment_count"
        min_count = 10  # At least 10 equipment records
    elif table_name == "solar_installers":
        site_count_col = "installation_count"
        min_count = min_sites
    else:
        site_count_col = "site_count"
        min_count = min_sites

    page = 0
    page_size = 1000
    entities = []
    while True:
        rows = supabase_get(table_name, {
            "select": "id,name,state,website,phone" if not is_manufacturer else "id,name,website,phone,equipment_count",
            "enrichment_status": "is.null",
            f"{site_count_col}": f"gte.{min_count}",
            "order": f"{site_count_col}.desc",
            "offset": str(page * page_size),
            "limit": str(page_size),
        })
        if not rows:
            break
        entities.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
        if limit and len(entities) >= limit:
            entities = entities[:limit]
            break

    print(f"Found {len(entities)} entities to enrich (min_{site_count_col}={min_count})")

    # Filter out non-business names (skip for manufacturers — all are businesses)
    business_entities = []
    skipped_names = 0
    for e in entities:
        if not is_manufacturer and should_skip(e["name"]):
            skipped_names += 1
        else:
            business_entities.append(e)

    print(f"Skipped {skipped_names} non-business names, processing {len(business_entities)} business entities")

    if not business_entities:
        return

    patched = 0
    not_found = 0
    low_match = 0
    errors = 0
    api_calls = 0

    for idx, entity in enumerate(business_entities):
        eid = entity["id"]
        name = entity["name"]
        state = entity.get("state") if not is_manufacturer else None

        # Search Google Places
        try:
            search_type = "manufacturer" if is_manufacturer else "solar"
            place = search_place(name, state, search_type=search_type)
            api_calls += 1
        except Exception as e:
            print(f"  [{idx+1}/{len(business_entities)}] ERROR searching {name}: {e}")
            errors += 1
            continue

        if not place:
            not_found += 1
            if not dry_run:
                # Mark as searched but not found
                supabase_patch(table_name, {
                    "enrichment_status": "not_found",
                    "enriched_at": datetime.now(timezone.utc).isoformat(),
                }, {"id": f"eq.{eid}"})
            continue

        # Validate name match
        google_name = place.get("displayName", {}).get("text", "")
        score = name_match_score(name, google_name)
        if score < 0.5:
            low_match += 1
            if dry_run and idx < 20:
                print(f"  [{idx+1}] LOW MATCH: '{name}' vs '{google_name}' (score={score:.2f})")
            if not dry_run:
                supabase_patch(table_name, {
                    "enrichment_status": "low_match",
                    "enriched_at": datetime.now(timezone.utc).isoformat(),
                }, {"id": f"eq.{eid}"})
            continue

        # Extract fields
        website = place.get("websiteUri")
        phone = place.get("nationalPhoneNumber")
        rating = place.get("rating")
        review_count = place.get("userRatingCount")
        business_status = place.get("businessStatus")
        address = place.get("formattedAddress")
        place_id = place.get("id")
        city, addr_state, zip_code = parse_address_components(
            place.get("addressComponents")
        )

        if dry_run:
            if idx < 30:
                print(f"  [{idx+1}] MATCH: '{name}' -> '{google_name}' (score={score:.2f})")
                print(f"         web={website}, phone={phone}, rating={rating} ({review_count} reviews)")
                print(f"         addr={address}, status={business_status}")
            patched += 1
            continue

        # Build patch — only fill empty fields
        patch = {
            "google_place_id": place_id,
            "enrichment_status": "enriched",
            "enriched_at": datetime.now(timezone.utc).isoformat(),
        }
        if rating is not None:
            patch["rating"] = rating
        if review_count is not None:
            patch["review_count"] = review_count
        if business_status:
            patch["business_status"] = business_status

        # Only fill website/phone/address if currently empty
        if website and not entity.get("website"):
            patch["website"] = website
        if phone and not entity.get("phone"):
            patch["phone"] = phone
        if address and not entity.get("address"):
            patch["address"] = address
        if city and not entity.get("city"):
            patch["city"] = city
        if addr_state and not entity.get("state"):
            patch["state"] = addr_state
        if zip_code and not entity.get("zip_code"):
            patch["zip_code"] = zip_code

        try:
            supabase_patch(table_name, patch, {"id": f"eq.{eid}"})
            patched += 1
        except Exception as e:
            print(f"  [{idx+1}] ERROR patching {name}: {e}")
            errors += 1
            continue

        if (idx + 1) % 50 == 0:
            print(f"  [{idx+1}/{len(business_entities)}] {patched} enriched, {not_found} not found, "
                  f"{low_match} low match, {errors} errors ({api_calls} API calls)")

        # Rate limit: ~10 QPS max for Places API
        time.sleep(0.1)

    print(f"\nDone: {patched} enriched, {not_found} not found, {low_match} low match, "
          f"{errors} errors ({api_calls} API calls)")
    est_cost = api_calls * 0.04
    print(f"Estimated cost: ${est_cost:.2f} ({api_calls} queries @ $0.04/query)")


def main():
    parser = argparse.ArgumentParser(description="Enrich entities via Google Places API")
    parser.add_argument("--table", choices=["installers", "owners", "manufacturers", "both", "all"], default="both")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--limit", type=int, help="Process first N entities per table")
    parser.add_argument("--min-sites", type=int, default=2, help="Min site count to query (default: 2)")
    args = parser.parse_args()

    start = time.time()

    if args.table in ("installers", "both", "all"):
        process_table("solar_installers", args.min_sites, dry_run=args.dry_run, limit=args.limit)

    if args.table in ("owners", "both", "all"):
        process_table("solar_site_owners", args.min_sites, dry_run=args.dry_run, limit=args.limit)

    if args.table in ("manufacturers", "all"):
        process_table("solar_manufacturers", args.min_sites, dry_run=args.dry_run, limit=args.limit)

    elapsed = time.time() - start
    print(f"\nTotal time: {elapsed:.1f}s")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Cross-reference OpenStreetMap solar farm data against our database.

Matches OSM plants (9,753 utility-scale solar facilities) against our
113K installation records using proximity matching on coordinates.

For matched records, enriches with:
- Site name (if we don't have one or ours is just an ID)
- Operator name
- Owner name (rare in OSM, but some have it)

Uses a grid-based spatial index for efficient matching.
"""

import os
import sys
import json
import math
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# Load environment
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '..', '.env.local'))

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

OSM_DATA_FILE = Path(script_dir).parent / "data" / "osm_solar_farms.json"
MATCH_RADIUS_KM = 2.0  # Match within 2 km
CAPACITY_TOLERANCE = 0.5  # 50% capacity tolerance for confirmation


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two lat/lon points in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def grid_key(lat, lon, cell_size=0.05):
    """Convert lat/lon to grid cell key (~5 km cells)."""
    return (round(lat / cell_size), round(lon / cell_size))


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


def is_placeholder_name(name):
    """Check if a site_name is just a placeholder/ID rather than a real name."""
    if not name:
        return True
    # Check if it's just digits, or a source prefix + digits
    stripped = name.strip()
    if stripped.isdigit():
        return True
    # Common ID patterns from our sources
    for prefix in ['uspvdb_', 'eia860_', 'tts3_', 'cadg_', 'nysun_', 'ilshines_', 'mapts_']:
        if stripped.lower().startswith(prefix):
            return True
    # Very short numeric-heavy strings are likely IDs
    if len(stripped) <= 10 and sum(c.isdigit() for c in stripped) > len(stripped) * 0.6:
        return True
    return False


def main():
    print("OSM Solar Farm Cross-Reference")
    print("=" * 60)

    # Load OSM data
    print("\n1. Loading OSM data...")
    if not OSM_DATA_FILE.exists():
        print(f"  ERROR: {OSM_DATA_FILE} not found. Run fetch-osm-solar.py first.")
        sys.exit(1)

    with open(OSM_DATA_FILE) as f:
        osm_data = json.load(f)

    plants = osm_data.get("plants", [])
    print(f"  Loaded {len(plants)} OSM solar plants")

    # Filter to plants with coordinates
    plants = [p for p in plants if p.get("latitude") and p.get("longitude")]
    print(f"  With coordinates: {len(plants)}")

    # Filter to those with useful data (name, operator, or capacity)
    useful_plants = [p for p in plants if p.get("name") or p.get("operator") or p.get("owner")]
    print(f"  With name/operator/owner: {len(useful_plants)}")

    # We'll try to match ALL plants (even without metadata) to find proximity matches
    # But only enrich from plants with useful data

    # 2. Fetch all DB records with exact coordinates
    print("\n2. Loading database records with coordinates...")
    db_records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,site_name,latitude,longitude,capacity_mw,owner_name,operator_name,source_record_id",
            "latitude": "not.is.null",
            "longitude": "not.is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        db_records.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break

    print(f"  Loaded {len(db_records)} records with coordinates")

    # 3. Build spatial grid index for DB records
    print("\n3. Building spatial index...")
    grid = {}
    for rec in db_records:
        key = grid_key(rec["latitude"], rec["longitude"])
        if key not in grid:
            grid[key] = []
        grid[key].append(rec)
    print(f"  Grid cells: {len(grid)}")

    # 4. Match OSM plants to DB records
    print(f"\n{'=' * 60}")
    print("4. Matching OSM plants to database...")
    print("=" * 60)

    matched = 0
    enriched_name = 0
    enriched_operator = 0
    enriched_owner = 0
    no_match = 0
    multiple_matches = 0

    # Track all matches for reporting
    match_results = []

    for i, plant in enumerate(plants):
        if not plant.get("name") and not plant.get("operator") and not plant.get("owner"):
            continue  # Skip plants with no enrichment data

        plat, plon = plant["latitude"], plant["longitude"]
        pkey = grid_key(plat, plon)

        # Check neighboring grid cells (3x3 area)
        candidates = []
        for di in range(-1, 2):
            for dj in range(-1, 2):
                nkey = (pkey[0] + di, pkey[1] + dj)
                if nkey in grid:
                    candidates.extend(grid[nkey])

        if not candidates:
            no_match += 1
            continue

        # Find closest DB record within radius
        best_match = None
        best_dist = MATCH_RADIUS_KM + 1
        all_matches = []

        for rec in candidates:
            dist = haversine_km(plat, plon, rec["latitude"], rec["longitude"])
            if dist <= MATCH_RADIUS_KM:
                all_matches.append((rec, dist))
                if dist < best_dist:
                    best_dist = dist
                    best_match = rec

        if not best_match:
            no_match += 1
            continue

        if len(all_matches) > 1:
            multiple_matches += 1
            # If multiple matches and OSM has capacity, prefer capacity match
            if plant.get("capacity_mw"):
                for rec, dist in all_matches:
                    if rec.get("capacity_mw"):
                        ratio = rec["capacity_mw"] / plant["capacity_mw"] if plant["capacity_mw"] > 0 else 0
                        if 1 - CAPACITY_TOLERANCE <= ratio <= 1 + CAPACITY_TOLERANCE:
                            best_match = rec
                            best_dist = dist
                            break

        matched += 1

        # Determine what to enrich
        update = {}

        # Enrich name if OSM has one and ours is a placeholder
        if plant.get("name") and is_placeholder_name(best_match.get("site_name")):
            update["site_name"] = plant["name"]
            enriched_name += 1

        # Enrich operator if we don't have one
        if plant.get("operator") and not best_match.get("operator_name"):
            update["operator_name"] = plant["operator"]
            enriched_operator += 1

        # Enrich owner if we don't have one
        if plant.get("owner") and not best_match.get("owner_name"):
            update["owner_name"] = plant["owner"]
            enriched_owner += 1

        if update:
            supabase_patch(best_match["id"], update)
            match_results.append({
                "osm_name": plant.get("name"),
                "db_name": best_match.get("site_name"),
                "distance_km": round(best_dist, 3),
                "updates": list(update.keys()),
            })

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i+1}/{len(useful_plants)} checked, {matched} matched, {enriched_name} names, {enriched_operator} operators")

    # 5. Summary
    print(f"\n{'=' * 60}")
    print("Cross-Reference Summary")
    print("=" * 60)
    print(f"  OSM plants processed: {len(useful_plants)}")
    print(f"  Matched to DB: {matched}")
    print(f"  No match (>2km from any DB record): {no_match}")
    print(f"  Multiple DB records within 2km: {multiple_matches}")
    print(f"\n  Enrichments:")
    print(f"    Site names updated: {enriched_name}")
    print(f"    Operator names added: {enriched_operator}")
    print(f"    Owner names added: {enriched_owner}")

    if match_results[:5]:
        print(f"\n  Sample matches:")
        for m in match_results[:10]:
            print(f"    OSM: {m['osm_name']} → DB: {m['db_name']} ({m['distance_km']}km) [{', '.join(m['updates'])}]")

    print("\nDone!")


if __name__ == "__main__":
    main()

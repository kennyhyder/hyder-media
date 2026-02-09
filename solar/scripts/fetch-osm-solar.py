#!/usr/bin/env python3
"""
Fetch solar farm data from OpenStreetMap via Overpass API.

Queries for power=plant + plant:source=solar in the United States.
Downloads coordinates, names, operator, capacity, and other metadata.
Saves to data/osm_solar_farms.json for cross-referencing.

Free, no API key required.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "osm_solar_farms.json"

# US states for state-by-state queries if full US query times out
US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming"
]


def overpass_query(query):
    """Execute an Overpass API query."""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, method="POST", headers={
        "User-Agent": "SolarTrack/1.0 (solar installation database)",
        "Content-Type": "application/x-www-form-urlencoded",
    })

    try:
        res = urllib.request.urlopen(req, timeout=660)
        return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  Overpass error ({e.code}): {e.read().decode()[:200]}")
        return None
    except Exception as e:
        print(f"  Error: {e}")
        return None


def query_us_solar_plants():
    """Query all US solar power plants from OSM."""
    query = """
[out:json][timeout:600][maxsize:536870912];

// United States
area["ISO3166-1"="US"][admin_level=2]->.searchArea;

// Solar power plants (utility-scale)
(
  node["power"="plant"]["plant:source"="solar"](area.searchArea);
  way["power"="plant"]["plant:source"="solar"](area.searchArea);
  relation["power"="plant"]["plant:source"="solar"](area.searchArea);
);

out center tags;
"""
    print("  Querying Overpass API for US solar power plants...")
    print("  (This may take 1-5 minutes)")
    return overpass_query(query)


def query_us_solar_generators():
    """Query ground-mounted solar generators (not rooftop) from OSM."""
    query = """
[out:json][timeout:600][maxsize:536870912];

// United States
area["ISO3166-1"="US"][admin_level=2]->.searchArea;

// Ground-mounted solar generators (exclude rooftop)
(
  way["power"="generator"]["generator:source"="solar"]["location"!="roof"](area.searchArea);
  relation["power"="generator"]["generator:source"="solar"]["location"!="roof"](area.searchArea);
);

out center tags;
"""
    print("  Querying ground-mounted solar generators...")
    return overpass_query(query)


def parse_osm_element(element):
    """Parse an OSM element into a structured record."""
    tags = element.get("tags", {})

    # Get coordinates
    lat = element.get("lat") or (element.get("center", {}).get("lat"))
    lon = element.get("lon") or (element.get("center", {}).get("lon"))

    if not lat or not lon:
        return None

    # Parse capacity
    capacity_str = (tags.get("plant:output:electricity") or
                    tags.get("generator:output:electricity") or "")
    capacity_mw = None
    if capacity_str:
        cap = capacity_str.lower().replace(",", "").strip()
        try:
            if "gw" in cap:
                capacity_mw = float(cap.replace("gw", "").strip()) * 1000
            elif "mw" in cap:
                capacity_mw = float(cap.replace("mw", "").strip())
            elif "kw" in cap:
                capacity_mw = float(cap.replace("kw", "").strip()) / 1000
            elif "w" in cap:
                capacity_mw = float(cap.replace("w", "").strip()) / 1000000
            else:
                capacity_mw = float(cap)  # Assume MW
        except ValueError:
            pass

    return {
        "osm_id": element.get("id"),
        "osm_type": element.get("type"),
        "latitude": lat,
        "longitude": lon,
        "name": tags.get("name"),
        "operator": tags.get("operator"),
        "owner": tags.get("owner"),
        "capacity_mw": capacity_mw,
        "capacity_raw": capacity_str,
        "start_date": tags.get("start_date"),
        "website": tags.get("website"),
        "wikidata": tags.get("wikidata"),
        "description": tags.get("description"),
        "plant_method": tags.get("plant:method") or tags.get("generator:method"),
        "all_tags": tags,
    }


def main():
    print("OpenStreetMap Solar Farm Fetcher")
    print("=" * 60)

    # Step 1: Query solar power plants
    print("\n1. Fetching solar power plants (power=plant + plant:source=solar)...")
    plants_data = query_us_solar_plants()

    plants = []
    if plants_data and "elements" in plants_data:
        for elem in plants_data["elements"]:
            parsed = parse_osm_element(elem)
            if parsed:
                plants.append(parsed)
        print(f"  Found {len(plants)} solar power plants")
    else:
        print("  Failed to fetch plants, trying state-by-state...")
        # Fall back to state-by-state queries
        for state in US_STATES:
            query = f"""
[out:json][timeout:300];
area["name"="{state}"]["admin_level"="4"]->.searchArea;
(
  way["power"="plant"]["plant:source"="solar"](area.searchArea);
  relation["power"="plant"]["plant:source"="solar"](area.searchArea);
);
out center tags;
"""
            print(f"    {state}...", end=" ", flush=True)
            result = overpass_query(query)
            if result and "elements" in result:
                count = 0
                for elem in result["elements"]:
                    parsed = parse_osm_element(elem)
                    if parsed:
                        plants.append(parsed)
                        count += 1
                print(f"{count} plants")
            else:
                print("failed")
            time.sleep(2)  # Be polite to the API

    # Step 2: Query ground-mounted generators (may time out for full US)
    print(f"\n2. Fetching ground-mounted solar generators...")
    generators_data = query_us_solar_generators()

    generators = []
    if generators_data and "elements" in generators_data:
        for elem in generators_data["elements"]:
            parsed = parse_osm_element(elem)
            if parsed:
                generators.append(parsed)
        print(f"  Found {len(generators)} ground-mounted solar generators")
    else:
        print("  Generator query timed out or failed (expected for full US)")
        print("  Proceeding with plant data only")

    # Step 3: Save results
    output = {
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "plants": plants,
        "generators": generators,
        "total_plants": len(plants),
        "total_generators": len(generators),
    }

    os.makedirs(OUTPUT_FILE.parent, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"Results saved to {OUTPUT_FILE}")
    print(f"  Solar power plants: {len(plants)}")
    print(f"  Ground-mounted generators: {len(generators)}")

    # Show some stats
    with_name = sum(1 for p in plants if p.get("name"))
    with_operator = sum(1 for p in plants if p.get("operator"))
    with_capacity = sum(1 for p in plants if p.get("capacity_mw"))
    print(f"\n  Plants with name: {with_name}")
    print(f"  Plants with operator: {with_operator}")
    print(f"  Plants with capacity: {with_capacity}")

    if plants:
        print(f"\n  Sample entries:")
        for p in plants[:5]:
            cap = f"{p['capacity_mw']:.1f} MW" if p.get('capacity_mw') else "unknown"
            print(f"    {p.get('name', 'unnamed')} ({cap}) @ {p['latitude']:.4f}, {p['longitude']:.4f}")

    print("\nDone! Run cross-reference script next to match with database.")


if __name__ == "__main__":
    main()

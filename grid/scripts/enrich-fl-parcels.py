#!/usr/bin/env python3
"""Enrich FL grid_dc_sites with parcel owner data via targeted FeatureServer queries.

FL's statewide Cadastral FeatureServer has spatial queries DISABLED, but WHERE
queries work fine. Strategy: for each FL gap record, query parcels in the same
county (CO_NO), download their polygons, and do local point-in-polygon matching.

Uses a county-level parcel cache to avoid re-downloading parcels for nearby sites.

Usage:
    python3 -u scripts/enrich-fl-parcels.py           # Full run
    python3 -u scripts/enrich-fl-parcels.py --dry-run  # Preview
    python3 -u scripts/enrich-fl-parcels.py --limit 100 # Process first N
"""

import os, sys, json, time, argparse, urllib.parse, urllib.request, ssl
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
if not os.environ.get("SUPABASE_URL"):
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    sys.exit(1)

ssl_ctx = ssl.create_default_context()

FL_FEATURESERVER = "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0"

# FL county FIPS codes (CO_NO in FL Cadastral = county number 1-67)
# We'll discover these dynamically from the data

def supabase_get(path, params=None, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise

def supabase_patch(table, filters, data, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{filters}"
    body = json.dumps(data, allow_nan=False).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, method="PATCH", headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                return True
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return False

def load_fl_gap_records():
    """Load all FL DC sites that need parcel owner."""
    records = []
    offset = 0
    page_size = 1000
    while True:
        data = supabase_get("grid_dc_sites", {
            "select": "id,latitude,longitude,name,county",
            "state": "eq.FL",
            "parcel_owner": "is.null",
            "latitude": "not.is.null",
            "order": "id",
            "limit": str(page_size),
            "offset": str(offset),
        })
        if not data:
            break
        records.extend(data)
        if len(data) < page_size:
            break
        offset += page_size
    return records

def query_fl_parcels_near(lat, lng, radius_deg=0.005):
    """Query FL parcels within a small bbox around a point.

    Uses WHERE clause with extent-based filtering since spatial queries are broken.
    Downloads parcel polygons and returns them for local point-in-polygon.
    """
    # Build a bbox
    xmin, ymin = lng - radius_deg, lat - radius_deg
    xmax, ymax = lng + radius_deg, lat + radius_deg

    # Use SQL expression to filter by centroid approximation
    # FL Cadastral doesn't support spatial queries, but we can use
    # a small WHERE envelope via the returnExtentOnly or just get nearby parcels
    # Actually, the simplest approach: use the extent filter via outSR + geometry
    # But that's broken too. So we query ALL parcels and filter locally.

    # Better approach: use the objectIds approach or WHERE with extent
    # Actually, FL Cadastral stores coordinates in WKID 3086.
    # Let's use a SQL expression to get nearby parcels by checking if the
    # parcel's extent overlaps our bbox.

    # Unfortunately we can't do spatial WHERE in SQL. Let's try a different approach:
    # query by OBJECTID range near the point, or use the working spatial approach.

    # Actually the most practical approach: download ALL parcels for a county
    # and cache them. County files are 100K-500K parcels. Too many.

    # BEST approach: Use per-site envelope query against the ORIGINAL FL GIO Hub API
    # which might support spatial queries differently.
    pass


def query_fl_hub_spatial(lat, lng, timeout=30):
    """Query FL GIO ArcGIS Hub for parcel at a specific point.

    Try the Florida GIO Hub API which may have different spatial query support
    than the Cadastral FeatureServer.
    """
    delta = 0.0005
    geom = json.dumps({
        "xmin": lng - delta, "ymin": lat - delta,
        "xmax": lng + delta, "ymax": lat + delta,
        "spatialReference": {"wkid": 4326}
    })

    params = urllib.parse.urlencode({
        "geometry": geom,
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "OWN_NAME,PARCEL_ID,PHY_ADDR1",
        "returnGeometry": "false",
        "f": "json",
        "inSR": "4326",
        "resultRecordCount": "1",
    })

    url = f"{FL_FEATURESERVER}/query?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GridScout/1.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            data = json.loads(resp.read())
        features = data.get("features", [])
        if features:
            return features[0].get("attributes", {})
    except Exception:
        pass
    return None


def query_per_site_bulk(records, dry_run=False):
    """For each FL gap record, download a small set of parcels from the county,
    build local spatial index, and check point-in-polygon.

    Since spatial queries are broken, we download parcels page-by-page for the
    county and check each record's point against all downloaded polygons.
    """
    from shapely.geometry import Point, shape

    # Group records by county
    county_groups = {}
    for rec in records:
        county = (rec.get("county") or "").strip().lower()
        # Normalize county name
        county = county.replace(" county", "").strip()
        if not county:
            county = "unknown"
        if county not in county_groups:
            county_groups[county] = []
        county_groups[county].append(rec)

    print(f"\n  FL: {len(records)} gap records across {len(county_groups)} counties")

    # FL county name to CO_NO mapping (we'll discover dynamically)
    # First, get the mapping
    county_to_no = get_county_number_map()

    found_total = 0
    patched_total = 0
    errors_total = 0

    for county_name, county_recs in sorted(county_groups.items(), key=lambda x: -len(x[1])):
        co_no = county_to_no.get(county_name)
        if not co_no and county_name != "unknown":
            # Try partial match
            for k, v in county_to_no.items():
                if county_name in k or k in county_name:
                    co_no = v
                    break

        if not co_no:
            print(f"    {county_name}: {len(county_recs)} records — no CO_NO mapping, skipping")
            continue

        print(f"    {county_name} (CO_NO={co_no}): {len(county_recs)} records — downloading parcels...")

        # Download all parcels for this county with geometry
        parcels = download_county_parcels(co_no)
        if not parcels:
            print(f"      No parcels downloaded")
            continue

        print(f"      Downloaded {len(parcels)} parcels — matching...")

        # Build spatial index (simple bbox pre-filter)
        found = 0
        patched = 0

        for rec in county_recs:
            pt = Point(rec["longitude"], rec["latitude"])

            # Check each parcel (brute force for small county sets)
            for parcel in parcels:
                geom = parcel.get("geometry")
                owner = parcel.get("owner")
                if not geom or not owner:
                    continue
                try:
                    poly = shape(geom)
                    if poly.contains(pt):
                        found += 1
                        if not dry_run:
                            patch = {"parcel_owner": owner}
                            apn = parcel.get("apn")
                            addr = parcel.get("address")
                            if apn:
                                patch["parcel_apn"] = apn
                            if addr:
                                patch["parcel_address"] = addr
                            ok = supabase_patch("grid_dc_sites", f"id=eq.{rec['id']}", patch)
                            if ok:
                                patched += 1
                            else:
                                errors_total += 1
                        if found <= 3:
                            print(f"      Found: {owner} for {rec.get('name', 'unknown')}")
                        break
                except Exception:
                    continue

        found_total += found
        patched_total += patched
        pct = 100 * found / len(county_recs) if county_recs else 0
        print(f"      {found}/{len(county_recs)} matched ({pct:.0f}%), {patched} patched")

    print(f"\n  FL Total: {found_total} found, {patched_total} patched, {errors_total} errors")
    return found_total, patched_total


def download_county_parcels(co_no, max_pages=50):
    """Download all parcels for a FL county via WHERE query + pagination.

    Returns list of {"geometry": geojson_dict, "owner": str, "apn": str, "address": str}
    """
    parcels = []
    offset = 0
    page_size = 2000  # FL max is 2000

    for page in range(max_pages):
        params = urllib.parse.urlencode({
            "where": f"CO_NO={co_no}",
            "outFields": "OWN_NAME,PARCEL_ID,PHY_ADDR1",
            "returnGeometry": "true",
            "outSR": "4326",
            "resultRecordCount": str(page_size),
            "resultOffset": str(offset),
            "f": "geojson",  # GeoJSON format for easy shapely parsing
        })

        url = f"{FL_FEATURESERVER}/query?{params}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GridScout/1.0"})
            with urllib.request.urlopen(req, timeout=120, context=ssl_ctx) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            print(f"      Page {page} error: {e}")
            break

        features = data.get("features", [])
        if not features:
            break

        for f in features:
            props = f.get("properties", {})
            owner = (props.get("OWN_NAME") or "").strip()
            if not owner or owner.upper() in ("", "UNKNOWN", "N/A", "NONE", "NULL"):
                continue
            # Title case
            if owner == owner.upper() or owner == owner.lower():
                owner = owner.title()

            parcels.append({
                "geometry": f.get("geometry"),
                "owner": owner,
                "apn": (props.get("PARCEL_ID") or "").strip() or None,
                "address": (props.get("PHY_ADDR1") or "").strip() or None,
            })

        offset += page_size
        if len(features) < page_size:
            break

        # Rate limit
        time.sleep(0.5)

    return parcels


def get_county_number_map():
    """Get FL county name → CO_NO mapping from the FeatureServer."""
    # FL has 67 counties numbered 1-67 in alphabetical order
    fl_counties = {
        "alachua": 1, "baker": 2, "bay": 3, "bradford": 4, "brevard": 5,
        "broward": 6, "calhoun": 7, "charlotte": 8, "citrus": 9, "clay": 10,
        "collier": 11, "columbia": 12, "desoto": 13, "dixie": 14, "duval": 15,
        "escambia": 16, "flagler": 17, "franklin": 18, "gadsden": 19, "gilchrist": 20,
        "glades": 21, "gulf": 22, "hamilton": 23, "hardee": 24, "hendry": 25,
        "hernando": 26, "highlands": 27, "hillsborough": 28, "holmes": 29, "indian river": 30,
        "jackson": 31, "jefferson": 32, "lafayette": 33, "lake": 34, "lee": 35,
        "leon": 36, "levy": 37, "liberty": 38, "madison": 39, "manatee": 40,
        "marion": 41, "martin": 42, "miami-dade": 43, "monroe": 44, "nassau": 45,
        "okaloosa": 46, "okeechobee": 47, "orange": 48, "osceola": 49, "palm beach": 50,
        "pasco": 51, "pinellas": 52, "polk": 53, "putnam": 54, "santa rosa": 55,
        "sarasota": 56, "seminole": 57, "st. johns": 58, "st. lucie": 59, "sumter": 60,
        "suwannee": 61, "taylor": 62, "union": 63, "volusia": 64, "wakulla": 65,
        "walton": 66, "washington": 67,
    }
    return fl_counties


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, help="Process first N records")
    args = parser.parse_args()

    print("FL Parcel Owner Enrichment (Cadastral FeatureServer + local spatial join)")

    records = load_fl_gap_records()
    if not records:
        print("  No FL gap records")
        return

    if args.limit:
        records = records[:args.limit]

    print(f"  Loaded {len(records)} FL gap records")

    query_per_site_bulk(records, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

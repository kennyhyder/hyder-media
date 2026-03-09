#!/usr/bin/env python3
"""Bulk spatial join of downloaded parcel geodatabases to grid_dc_sites.

Downloads statewide parcel files (FGDB, Shapefile, GeoPackage) and performs
local point-in-polygon spatial joins to find parcel owners for DC sites.

Much faster than ArcGIS REST API queries (minutes vs hours/days).

Usage:
    python3 -u scripts/join-parcel-owners.py --state FL    # Single state
    python3 -u scripts/join-parcel-owners.py --all          # All configured states
    python3 -u scripts/join-parcel-owners.py --dry-run      # Preview without patching
    python3 -u scripts/join-parcel-owners.py --list         # Show configured sources
"""

import os, sys, json, time, argparse, urllib.parse, urllib.request, zipfile, tempfile
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
if not os.environ.get("SUPABASE_URL"):
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    sys.exit(1)

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'parcels')

# ── Bulk Parcel Sources ──────────────────────────────────────────────────────
# Each entry: download URL, format details, owner field name, layer name (for FGDB)

BULK_SOURCES = {
    "FL": {
        "name": "Florida GIO Statewide Parcels",
        "url": "https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels/api",
        "hub_id": "florida-statewide-parcels",
        # FL GIO uses ArcGIS Hub - we'll query the API for download URL
        "format": "geojson_api",  # Use ArcGIS Hub API to query by geometry
        "owner_field": "OWN_NAME",
        "apn_field": "PARCELNO",
        "address_field": "SITEADDR",
    },
    "WV": {
        "name": "WVGIS Tax Maps",
        "url": "https://wvgis.wvu.edu/data/dataset.php?ID=371",
        "format": "manual",  # Requires manual download
        "owner_field": "FullOwnerName",
        "apn_field": None,
    },
    "VA": {
        "name": "VGIN Statewide Parcels + Local Schema",
        "url": "https://vgin.vdem.virginia.gov/pages/cl-data-download",
        "format": "manual",
        "owner_field": "OWNER",
        "apn_field": "PARCELID",
    },
}

# ── Supabase helpers ─────────────────────────────────────────────────────────

def supabase_get(path, params=None, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Prefer": "count=exact",
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

def load_gap_records(state):
    """Load all DC sites in state that need parcel owner."""
    records = []
    offset = 0
    page_size = 1000
    while True:
        data = supabase_get("grid_dc_sites", {
            "select": "id,latitude,longitude,name",
            "state": f"eq.{state}",
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


# ── Spatial join using geopandas ─────────────────────────────────────────────

def spatial_join_file(state, parcel_file, owner_field, apn_field=None,
                      address_field=None, layer=None, dry_run=False):
    """Join DC sites to parcel polygons from a local file."""
    import geopandas as gpd
    from shapely.geometry import Point

    print(f"\n  Loading parcel file: {parcel_file}")
    if layer:
        parcels = gpd.read_file(parcel_file, layer=layer, engine="pyogrio")
    else:
        parcels = gpd.read_file(parcel_file, engine="pyogrio")
    print(f"  Loaded {len(parcels):,} parcels")

    # Ensure WGS84
    if parcels.crs and parcels.crs.to_epsg() != 4326:
        print(f"  Reprojecting from {parcels.crs} to EPSG:4326...")
        parcels = parcels.to_crs(epsg=4326)

    # Load gap records
    records = load_gap_records(state)
    if not records:
        print(f"  {state}: 0 gap records")
        return 0, 0

    print(f"  {state}: {len(records)} gap records → joining...")

    # Create points GeoDataFrame
    points = gpd.GeoDataFrame(
        records,
        geometry=[Point(r["longitude"], r["latitude"]) for r in records],
        crs="EPSG:4326"
    )

    # Spatial join
    joined = gpd.sjoin(points, parcels, how="inner", predicate="within")
    print(f"  Matched: {len(joined)} sites to parcels")

    if len(joined) == 0:
        return 0, 0

    # Extract and patch
    found = 0
    patched = 0
    errors = 0

    for _, row in joined.iterrows():
        owner = None
        if owner_field and owner_field in row and row[owner_field]:
            owner = str(row[owner_field]).strip()
            # Filter junk
            if owner.upper() in ("", "UNKNOWN", "N/A", "NONE", "NULL", "OWNER OF RECORD"):
                continue
            # Title case
            if owner == owner.upper() or owner == owner.lower():
                owner = owner.title()

        if not owner:
            continue

        found += 1
        apn = str(row[apn_field]).strip() if apn_field and apn_field in row and row[apn_field] else None
        addr = str(row[address_field]).strip() if address_field and address_field in row and row[address_field] else None

        if found <= 3:
            print(f"    Found: {owner} (APN: {apn}) for {row.get('name', 'unknown')}")

        if not dry_run:
            patch = {"parcel_owner": owner}
            if apn:
                patch["parcel_apn"] = apn
            if addr and addr.upper() not in ("", "UNKNOWN", "N/A"):
                patch["parcel_address"] = addr
            ok = supabase_patch("grid_dc_sites", f"id=eq.{row['id']}", patch)
            if ok:
                patched += 1
            else:
                errors += 1

        if found % 500 == 0:
            print(f"    {found} found, {patched} patched, {errors} errors")

    print(f"  Done: {found} found ({100*found/len(records):.1f}%), {patched} patched, {errors} errors")
    return found, patched


def query_arcgis_hub(state, hub_url, owner_field, apn_field=None,
                     address_field=None, dry_run=False):
    """Query ArcGIS Hub/FeatureServer directly with per-site envelope queries.

    For large statewide services where downloading the full file isn't practical,
    we query the FeatureServer directly with small envelope geometries.
    """
    import ssl
    ssl_ctx = ssl.create_default_context()

    records = load_gap_records(state)
    if not records:
        print(f"  {state}: 0 gap records")
        return 0, 0

    print(f"\n  {state}: {len(records)} gap records → querying FeatureServer...")

    found = 0
    patched = 0
    errors = 0
    pending = []

    def flush():
        nonlocal patched, errors
        for p in pending:
            ok = supabase_patch("grid_dc_sites", f"id=eq.{p['id']}", p["patch"])
            if ok:
                patched += 1
            else:
                errors += 1
        pending.clear()

    for i, rec in enumerate(records):
        lat, lng = rec["latitude"], rec["longitude"]
        delta = 0.0005
        geom = json.dumps({
            "xmin": lng - delta, "ymin": lat - delta,
            "xmax": lng + delta, "ymax": lat + delta,
            "spatialReference": {"wkid": 4326}
        })

        out_fields = owner_field
        if apn_field:
            out_fields += f",{apn_field}"
        if address_field:
            out_fields += f",{address_field}"

        params = urllib.parse.urlencode({
            "geometry": geom,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
            "inSR": "4326",
            "resultRecordCount": "1",
        })

        url = f"{hub_url}/query?{params}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GridScout/1.0"})
            with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
                data = json.loads(resp.read())
        except Exception:
            errors += 1
            continue

        features = data.get("features", [])
        if not features:
            continue

        attrs = features[0].get("attributes", {})
        owner = attrs.get(owner_field, "")
        if not owner or str(owner).strip().upper() in ("", "UNKNOWN", "N/A", "NONE", "NULL", "OWNER OF RECORD"):
            continue

        owner = str(owner).strip()
        if owner == owner.upper() or owner == owner.lower():
            owner = owner.title()

        found += 1
        apn = str(attrs.get(apn_field, "")).strip() if apn_field else None
        addr = str(attrs.get(address_field, "")).strip() if address_field else None

        if found <= 3:
            print(f"    Found: {owner} (APN: {apn}) for {rec.get('name', 'unknown')}")

        if not dry_run:
            patch = {"parcel_owner": owner}
            if apn and apn not in ("None", ""):
                patch["parcel_apn"] = apn
            if addr and addr.upper() not in ("", "UNKNOWN", "N/A", "None"):
                patch["parcel_address"] = addr
            pending.append({"id": rec["id"], "patch": patch})
            if len(pending) >= 100:
                flush()

        if (i + 1) % 500 == 0:
            print(f"    {i+1}/{len(records)}: {found} found, {patched} patched")

    if pending:
        flush()

    print(f"  Done: {found} found ({100*found/len(records):.1f}%), {patched} patched, {errors} errors")
    return found, patched


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", help="Single state to process")
    parser.add_argument("--all", action="store_true", help="Process all configured states")
    parser.add_argument("--file", help="Path to parcel file (FGDB, SHP, GPKG)")
    parser.add_argument("--owner-field", help="Owner name field in parcel file")
    parser.add_argument("--apn-field", help="APN/parcel ID field")
    parser.add_argument("--address-field", help="Site address field")
    parser.add_argument("--layer", help="Layer name for FGDB files")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    if args.list:
        print("Configured bulk parcel sources:")
        for state, cfg in sorted(BULK_SOURCES.items()):
            print(f"  {state}: {cfg['name']} ({cfg['format']})")
        return

    # Manual file mode - join any parcel file to a state's gap records
    if args.file and args.state and args.owner_field:
        spatial_join_file(
            args.state, args.file, args.owner_field,
            apn_field=args.apn_field, address_field=args.address_field,
            layer=args.layer, dry_run=args.dry_run
        )
        return

    states = []
    if args.state:
        states = [args.state.upper()]
    elif args.all:
        states = list(BULK_SOURCES.keys())
    else:
        parser.print_help()
        return

    # FeatureServer endpoints for per-site querying (too large to download as bulk)
    # Per-site FeatureServer/MapServer endpoints (for services too large to download)
    FEATURESERVER_SOURCES = {
        "TX": {
            "url": "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap25_land_parcels_48/MapServer/0",
            "owner_field": "owner_name", "apn_field": None, "address_field": None,
        },
        "CO": {
            "url": "https://gis.colorado.gov/public/rest/services/Address_and_Parcels/MapServer/1",
            "owner_field": "Owner", "apn_field": "PARCEL", "address_field": None,
        },
        "NY": {
            "url": "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/0",
            "owner_field": "OWNER1", "apn_field": None, "address_field": None,
        },
        "WV": {
            "url": "https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0",
            "owner_field": "FullOwnerName", "apn_field": "CleanParcelID", "address_field": "FullPhysicalAddress",
        },
    }

    for state in states:
        if state in FEATURESERVER_SOURCES:
            cfg = FEATURESERVER_SOURCES[state]
            query_arcgis_hub(
                state, cfg["url"],
                owner_field=cfg["owner_field"],
                apn_field=cfg.get("apn_field"),
                address_field=cfg.get("address_field"),
                dry_run=args.dry_run,
            )
        elif state in BULK_SOURCES:
            cfg = BULK_SOURCES[state]
            if cfg["format"] == "manual":
                # Check if file was manually downloaded
                state_dir = os.path.join(DATA_DIR, state.lower())
                if os.path.isdir(state_dir):
                    files = [f for f in os.listdir(state_dir)
                             if f.endswith(('.gdb', '.shp', '.gpkg', '.geojson'))]
                    if files:
                        fpath = os.path.join(state_dir, files[0])
                        spatial_join_file(
                            state, fpath, cfg["owner_field"],
                            apn_field=cfg.get("apn_field"),
                            address_field=cfg.get("address_field"),
                            dry_run=args.dry_run
                        )
                        continue
                print(f"\n  {state}: Manual download required from {cfg['url']}")
                print(f"    Download to: {DATA_DIR}/{state.lower()}/")
        else:
            print(f"\n  {state}: Not configured in BULK_SOURCES or FEATURESERVER_SOURCES")


if __name__ == "__main__":
    main()

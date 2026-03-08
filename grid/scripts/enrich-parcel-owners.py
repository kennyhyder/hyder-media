#!/usr/bin/env python3
"""Enrich grid_dc_sites with parcel owner data from ArcGIS tax parcel endpoints.

Reuses the proven ArcGIS point-in-polygon approach from solar/scripts/enrich-parcel-owners.py.
Queries statewide and county-level parcel layers for land ownership information.

Usage:
    python3 -u scripts/enrich-parcel-owners.py              # Run all endpoints
    python3 -u scripts/enrich-parcel-owners.py --state TX    # Single state
    python3 -u scripts/enrich-parcel-owners.py --dry-run     # Preview
    python3 -u scripts/enrich-parcel-owners.py --counts      # Show gap records per state
    python3 -u scripts/enrich-parcel-owners.py --list        # Show configured endpoints
"""

import os, sys, json, time, argparse, urllib.parse, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
# Fallback to parent .env.local (hyder-media root)
if not os.environ.get("SUPABASE_URL"):
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    sys.exit(1)

import urllib.request, ssl

ssl_ctx = ssl.create_default_context()
ssl_ctx_noverify = ssl.create_default_context()
ssl_ctx_noverify.check_hostname = False
ssl_ctx_noverify.verify_mode = ssl.CERT_NONE

# ── ArcGIS Parcel Endpoints ──────────────────────────────────────────────────

STATEWIDE_ENDPOINTS = {
    "MT": {
        "url": "https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0",
        "owner_field": "OwnerName", "type": "MapServer",
    },
    "WI": {
        "url": "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0",
        "owner_field": "OWNERNME1", "type": "FeatureServer",
    },
    "NC": {
        "url": "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
        "owner_field": "ownname", "type": "FeatureServer",
    },
    "CT": {
        "url": "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0",
        "owner_field": "Owner", "type": "FeatureServer",
    },
    "VT": {
        "url": "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0",
        "owner_field": "OWNER1", "type": "FeatureServer",
    },
    "FL": {
        "url": "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
        "owner_field": "OWN_NAME", "type": "FeatureServer",
    },
    "AR": {
        "url": "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6",
        "owner_field": "ownername", "type": "FeatureServer",
    },
    "MN": {
        "url": "https://services.arcgis.com/9OIuDHbyhmH91RfZ/arcgis/rest/services/plan_parcels_open_gdb/FeatureServer/0",
        "owner_field": "owner_name", "type": "FeatureServer", "timeout": 60,
    },
    "MD": {
        "url": "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0",
        "owner_field": "OWNNAME1", "type": "MapServer",
    },
    "TX": {
        "url": "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap25_land_parcels_48/MapServer/0",
        "owner_field": "owner_name", "type": "MapServer", "use_envelope": True,
    },
    "MA": {
        "url": "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer/0",
        "owner_field": "OWNER1", "type": "FeatureServer", "use_envelope": True,
    },
    "OH": {
        "url": "https://gis.ohiodnr.gov/arcgis_site2/rest/services/OIT_Services/odnr_landbase_v2/MapServer/4",
        "owner_field": "OWNER1", "type": "MapServer", "ssl_skip": True,
    },
    "NY": {
        "url": "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1",
        "owner_field": "PRIMARY_OWNER", "type": "FeatureServer", "timeout": 45,
    },
    "CO": {
        "url": "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0",
        "owner_field": "owner", "type": "FeatureServer",
    },
}

COUNTY_ENDPOINTS = {
    "AZ": {
        "maricopa": {
            "url": "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0",
            "owner_field": "OWNER_NAME", "type": "MapServer",
        },
        "pima": {
            "url": "https://azwatermaps.azwater.gov/arcgis/rest/services/General/Parcels_for_TEST/FeatureServer/6",
            "owner_field": "OWNER_NAME", "type": "FeatureServer",
        },
    },
    "LA": {
        "orleans": {
            "url": "https://gis.nola.gov/arcgis/rest/services/ParcelSearch/MapServer/0",
            "owner_field": "OWNERNME1", "type": "MapServer",
            "ssl_skip": True, "skip_record_count": True,
        },
        "east_baton_rouge": {
            "url": "https://maps.brla.gov/gis/rest/services/Cadastral/Tax_Parcel/MapServer/0",
            "owner_field": "OWNER", "type": "MapServer", "use_envelope": True,
        },
    },
    "IN": {
        "marion": {
            "url": "https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10",
            "owner_field": "FULLOWNERNAME", "type": "MapServer", "use_envelope": True,
        },
    },
    "OR": {
        "portland_metro": {
            "url": "https://services.arcgis.com/uUvqNMGPm7axC2dD/ArcGIS/rest/services/TaxlotsMetro/FeatureServer/0",
            "owner_field": "OWNER1", "type": "FeatureServer",
        },
    },
    "TN": {
        "davidson": {
            "url": "https://maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0",
            "owner_field": "Owner", "type": "MapServer", "use_envelope": True,
        },
        "shelby": {
            "url": "https://gis.shelbycountytn.gov/arcgis/rest/services/Parcel/CERT_Parcel/MapServer/0",
            "owner_field": "OWNER", "type": "MapServer", "use_envelope": True,
        },
    },
    "GA": {
        "dekalb": {
            "url": "https://dcgis.dekalbcountyga.gov/hosted/rest/services/Parcels/MapServer/0",
            "owner_field": "OWNERNME1", "type": "MapServer", "use_envelope": True,
        },
        "fulton": {
            "url": "https://gismaps.fultoncountyga.gov/arcgispub2/rest/services/PropertyMapViewer/PropertyMapViewer/MapServer/11",
            "owner_field": "Owner", "type": "MapServer", "use_envelope": True,
        },
    },
    "SC": {
        "charleston": {
            "url": "https://gisccapps.charlestoncounty.org/arcgis/rest/services/GIS_VIEWER/Public_Search/MapServer/4",
            "owner_field": "OWNER1", "type": "MapServer", "use_envelope": True,
        },
    },
    "MI": {
        "wayne": {
            "url": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
            "owner_field": "taxpayer_1", "type": "FeatureServer", "use_envelope": True,
        },
    },
    "NV": {
        "clark": {
            "url": "https://maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AssessorMapv2/MapServer/1",
            "owner_field": "APN", "type": "skip",  # Two-step lookup needed (ArcGIS→APN→ASPX scraper)
        },
    },
    "PA": {
        "philadelphia": {
            "url": "https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/OPA_Properties_Public/FeatureServer/0",
            "owner_field": "owner_1", "type": "FeatureServer", "use_distance": True,
        },
    },
    "CA": {
        "san_diego": {
            "url": "https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/FeatureServer/0",
            "owner_field": "OWN_NAME1", "type": "FeatureServer", "use_envelope": True,
        },
    },
    "DC": {
        "district": {
            "url": "https://maps2.dcgis.dc.gov/dcgis/rest/services/Property_and_Land_WebMercator/MapServer/40",
            "owner_field": "OWNERNAME", "type": "MapServer",
        },
    },
    "KS": {
        "johnson": {
            "url": "https://maps.jocogov.org/arcgis/rest/services/Parcels/Parcels/MapServer/0",
            "owner_field": "OWNER_NAME", "type": "MapServer", "use_envelope": True,
        },
    },
    "AL": {
        "jefferson": {
            "url": "https://jeffcoal.maps.arcgis.com/apps/instant/basic/index.html",
            "owner_field": "OWNER", "type": "skip",
        },
    },
    "ND": {
        "cass": {
            "url": "https://gis.casscountynd.gov/arcgis/rest/services/CassCounty/CASS_CadastreParcels/MapServer/0",
            "owner_field": "OWNER1", "type": "MapServer", "use_envelope": True,
        },
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
                data = json.loads(resp.read())
                return data
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise

def supabase_patch(path, params, body, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())
    data = json.dumps(body).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method="PATCH", headers={
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
                print(f"    PATCH error: {e}")
                return False


# ── ArcGIS query ─────────────────────────────────────────────────────────────

def query_arcgis(lat, lng, cfg):
    """Query ArcGIS parcel endpoint for owner at given lat/lng."""
    url = cfg["url"] + "/query"
    timeout = cfg.get("timeout", 30)
    ctx = ssl_ctx_noverify if cfg.get("ssl_skip") else ssl_ctx

    owner_field = cfg["owner_field"]
    out_fields = "*"  # Request all fields to capture APN/address variants

    if cfg.get("use_distance"):
        params = {
            "geometry": f"{lng},{lat}",
            "geometryType": "esriGeometryPoint",
            "spatialRel": "esriSpatialRelIntersects",
            "distance": 100,
            "units": "esriSRUnit_Meter",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
            "inSR": "4326",
            "outSR": "4326",
        }
    elif cfg.get("use_envelope"):
        delta = 0.0005  # ~55m envelope
        params = {
            "geometry": json.dumps({
                "xmin": lng - delta, "ymin": lat - delta,
                "xmax": lng + delta, "ymax": lat + delta,
                "spatialReference": {"wkid": 4326}
            }),
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
            "inSR": "4326",
            "outSR": "4326",
        }
    else:
        params = {
            "geometry": f"{lng},{lat}",
            "geometryType": "esriGeometryPoint",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "false",
            "f": "json",
            "inSR": "4326",
            "outSR": "4326",
        }

    if not cfg.get("skip_record_count"):
        params["resultRecordCount"] = "1"

    query_str = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_str}"

    try:
        req = urllib.request.Request(full_url, headers={"User-Agent": "GridScout/1.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        return None

    if data.get("error"):
        return None

    features = data.get("features", [])
    if not features:
        return None

    attrs = features[0].get("attributes", {})
    owner = attrs.get(owner_field, "")
    if cfg.get("owner_field_2"):
        first = attrs.get(cfg["owner_field_2"], "") or ""
        owner = f"{first} {owner}".strip() if first else owner

    if not owner or owner.strip() in ("", "UNKNOWN", "N/A", "NA", "NONE", "OWNER OF RECORD", "TBD"):
        return None

    # Title case normalization
    owner = owner.strip()
    if owner == owner.upper() and len(owner) > 3:
        owner = owner.title()

    # Try to find APN
    apn = None
    for key in ("APN", "apn", "PARCEL_ID", "ParcelID", "parcel_id", "PIN", "pin", "PARNO", "parno", "PARID"):
        if key in attrs and attrs[key]:
            apn = str(attrs[key]).strip()
            break

    # Try to find address
    address = None
    for key in ("SITUS", "SitusAddress", "SITUS_ADDR", "SITEADDR", "site_addr", "PropertyAddress",
                "PROP_ADDR", "ADDRESS", "LOC_ADDR", "PhysAddr", "phys_addr", "FULL_STREET_NAME"):
        if key in attrs and attrs[key]:
            addr = str(attrs[key]).strip()
            if addr and addr not in ("", "N/A", "NONE", "0"):
                address = addr.title() if addr == addr.upper() else addr
                break

    return {"owner": owner, "apn": apn, "address": address}


# ── Processing ───────────────────────────────────────────────────────────────

def load_gap_records(state, limit=None):
    """Load grid_dc_sites with coords but no parcel_owner for a given state."""
    params = {
        "select": "id,latitude,longitude,name,county",
        "state": f"eq.{state}",
        "parcel_owner": "is.null",
        "order": "id",
        "limit": str(limit or 10000),
    }
    # Paginate
    all_records = []
    offset = 0
    page_size = 1000
    while True:
        p = dict(params)
        p["offset"] = str(offset)
        p["limit"] = str(min(page_size, (limit or 999999) - len(all_records)))
        rows = supabase_get("grid_dc_sites", p)
        if not rows:
            break
        all_records.extend(rows)
        if len(rows) < page_size or (limit and len(all_records) >= limit):
            break
        offset += page_size
    return all_records


def process_state(state, cfg, dry_run=False, limit=None):
    """Process all gap records for a state using given ArcGIS endpoint."""
    if cfg.get("type") == "skip":
        return 0, 0

    records = load_gap_records(state, limit)
    if not records:
        print(f"\n  {state}: 0 gap records")
        return 0, 0

    print(f"\n  {state}: {len(records)} gap records → querying {cfg['url'][:60]}...")

    found = 0
    patched = 0
    errors = 0
    pending = []

    def flush_patches():
        nonlocal patched
        if not pending or dry_run:
            return
        for rec_id, result in pending:
            body = {"parcel_owner": result["owner"]}
            if result.get("apn"):
                body["parcel_apn"] = result["apn"]
            if result.get("address"):
                body["parcel_address"] = result["address"]
            ok = supabase_patch("grid_dc_sites", {"id": f"eq.{rec_id}"}, body)
            if ok:
                patched += 1
            else:
                pass  # Error already logged
        pending.clear()

    for i, rec in enumerate(records):
        lat, lng = rec.get("latitude"), rec.get("longitude")
        if not lat or not lng:
            continue

        result = query_arcgis(float(lat), float(lng), cfg)
        if result:
            found += 1
            pending.append((rec["id"], result))
            if found <= 3:
                print(f"    Found: {result['owner']} (APN: {result.get('apn')}) for {rec.get('name', '?')[:40]}")

        if len(pending) >= 100:
            flush_patches()

        if (i + 1) % 500 == 0:
            print(f"    {i+1}/{len(records)}: {found} found, {patched} patched")

    flush_patches()
    rate = f"{found/len(records)*100:.1f}%" if records else "N/A"
    print(f"    Done: {found} found ({rate}), {patched} patched")
    return found, patched


def count_gap_by_state():
    """Count gap records by state."""
    # Use raw SQL via RPC or just load state counts
    gaps = {}
    for state_code in ["AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN",
                        "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
                        "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
                        "VT","VA","WA","WV","WI","WY"]:
        params = {
            "select": "id",
            "state": f"eq.{state_code}",
            "parcel_owner": "is.null",
            "limit": "1",
        }
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/grid_dc_sites?{urllib.parse.urlencode(params)}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Prefer": "count=exact",
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                count = resp.headers.get("content-range", "").split("/")[-1]
                if count and count != "*":
                    cnt = int(count)
                    if cnt > 0:
                        gaps[state_code] = cnt
        except:
            pass
    return dict(sorted(gaps.items(), key=lambda x: -x[1]))


def main():
    parser = argparse.ArgumentParser(description="Enrich grid_dc_sites with parcel owner data")
    parser.add_argument("--state", help="Process single state (e.g., TX)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--limit", type=int, help="Limit records per state")
    parser.add_argument("--list", action="store_true", help="List configured endpoints")
    parser.add_argument("--counts", action="store_true", help="Show gap records per state")
    args = parser.parse_args()

    if args.list:
        print(f"Statewide endpoints ({len(STATEWIDE_ENDPOINTS)}):")
        for state, cfg in sorted(STATEWIDE_ENDPOINTS.items()):
            print(f"  {state:<4} {cfg['owner_field']:<15} {cfg['url'][:70]}")
        print(f"\nCounty endpoints ({sum(len(v) for v in COUNTY_ENDPOINTS.values())}):")
        for state in sorted(COUNTY_ENDPOINTS.keys()):
            for county, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
                if cfg.get("type") == "skip":
                    continue
                print(f"  {state}/{county:<18} {cfg['owner_field']:<15} {cfg['url'][:55]}")
        return

    if args.counts:
        gaps = count_gap_by_state()
        print(f"\nGap records by state (no parcel_owner):")
        print(f"{'State':<6} {'Count':>8} {'Endpoint?'}")
        print("-" * 35)
        total = 0
        covered = 0
        for state, count in gaps.items():
            has_ep = "✓" if state in STATEWIDE_ENDPOINTS else ("◇" if state in COUNTY_ENDPOINTS else "")
            print(f"{state:<6} {count:>8,} {has_ep}")
            total += count
            if state in STATEWIDE_ENDPOINTS or state in COUNTY_ENDPOINTS:
                covered += count
        print(f"\nTotal: {total:,} gap records")
        print(f"Covered by endpoints: {covered:,} ({covered/total*100:.1f}%)")
        return

    if args.state:
        state = args.state.upper()
        if state in STATEWIDE_ENDPOINTS:
            process_state(state, STATEWIDE_ENDPOINTS[state], dry_run=args.dry_run, limit=args.limit)
        elif state in COUNTY_ENDPOINTS:
            for county_key, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
                process_state(state, cfg, dry_run=args.dry_run, limit=args.limit)
        else:
            all_states = set(STATEWIDE_ENDPOINTS.keys()) | set(COUNTY_ENDPOINTS.keys())
            print(f"No endpoint for {state}. Available: {', '.join(sorted(all_states))}")
            sys.exit(1)
        return

    # Process all
    print("=" * 60)
    print("GridScout Parcel Owner Enrichment — All States")
    print("=" * 60)

    total_found = 0
    total_patched = 0
    state_results = {}

    for state in sorted(STATEWIDE_ENDPOINTS.keys()):
        try:
            found, patched = process_state(state, STATEWIDE_ENDPOINTS[state],
                                           dry_run=args.dry_run, limit=args.limit)
            state_results[state] = (found, patched)
            total_found += found
            total_patched += patched
        except Exception as e:
            print(f"\n  ERROR {state}: {e}")
            state_results[state] = (0, 0)

    for state in sorted(COUNTY_ENDPOINTS.keys()):
        if state in STATEWIDE_ENDPOINTS:
            continue  # Already processed
        state_found = 0
        state_patched = 0
        for county_key, cfg in sorted(COUNTY_ENDPOINTS[state].items()):
            try:
                found, patched = process_state(state, cfg, dry_run=args.dry_run, limit=args.limit)
                state_found += found
                state_patched += patched
            except Exception as e:
                print(f"\n  ERROR {state}/{county_key}: {e}")
        state_results[state] = (state_found, state_patched)
        total_found += state_found
        total_patched += state_patched

    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"{'State':<6} {'Found':>8} {'Patched':>8}")
    print(f"{'-'*30}")
    for state, (found, patched) in sorted(state_results.items()):
        if found > 0 or patched > 0:
            print(f"{state:<6} {found:>8,} {patched:>8,}")
    print(f"{'-'*30}")
    print(f"{'Total':<6} {total_found:>8,} {total_patched:>8,}")
    if args.dry_run:
        print(f"\nDRY RUN — no records were patched")


if __name__ == "__main__":
    main()

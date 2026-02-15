#!/usr/bin/env python3
"""
BLM Solar Energy Right-of-Way Ingestion Script

Downloads solar energy facility right-of-way (ROW) records from BLM's
National MLRS Land Use Authorization ArcGIS FeatureServer. These are
utility-scale solar projects on federal public lands (AZ, CA, CO, NV, NM, UT, WY).

Data source: BLM National MLRS LUA ROW FeatureServer
API: https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0
Filter: CMMDTY='SOLAR ENERGY FACILITIES'

Records: ~900 solar ROWs (94 authorized, 283 pending, 511 closed, 10 interim)
Fields: developer/holder name, polygon boundaries, acreage, status, dates, state

Usage:
  python3 -u scripts/ingest-blm-solar.py                # All solar ROWs
  python3 -u scripts/ingest-blm-solar.py --active-only   # Authorized + Pending only
  python3 -u scripts/ingest-blm-solar.py --dry-run        # Preview without ingesting
"""

import os
import sys
import json
import re
import time
import urllib.request
import urllib.parse
import argparse
from pathlib import Path

from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50

# BLM ArcGIS FeatureServer
BLM_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0/query"


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
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def supabase_post(table, records):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    body = json.dumps(records, allow_nan=False).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True, None
    except Exception as e:
        err_body = ""
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                pass
        return False, f"{e} | {err_body}" if err_body else str(e)


def get_data_source_id(name):
    rows = supabase_get("solar_data_sources", {"name": f"eq.{name}", "select": "id"})
    if rows:
        return rows[0]["id"]
    url = f"{SUPABASE_URL}/rest/v1/solar_data_sources"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    body = json.dumps({
        "name": name,
        "url": "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0"
    }).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


def get_existing_source_ids(prefix):
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}_*",
            "offset": offset,
            "limit": 1000,
        })
        if not batch:
            break
        for r in batch:
            existing.add(r["source_record_id"])
        offset += len(batch)
        if len(batch) < 1000:
            break
    return existing


# ---------------------------------------------------------------------------
# BLM API query
# ---------------------------------------------------------------------------

def fetch_blm_solar(active_only=False):
    """Fetch all solar energy facility ROWs from BLM ArcGIS FeatureServer."""
    where = "CMMDTY='SOLAR ENERGY FACILITIES'"
    if active_only:
        where += " AND (CSE_DISP='Authorized' OR CSE_DISP='Pending' OR CSE_DISP='Interim')"

    all_features = []
    offset = 0
    batch_size = 1000

    while True:
        params = {
            "where": where,
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(batch_size),
        }
        url = BLM_URL + "?" + urllib.parse.urlencode(params)

        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        })
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())

        features = data.get("features", [])
        if not features:
            break
        all_features.extend(features)
        print(f"  Fetched {len(all_features)} records (offset {offset})...")

        if len(features) < batch_size:
            break
        offset += len(features)

    return all_features


def polygon_centroid(geometry):
    """Calculate centroid of a GeoJSON polygon."""
    if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        return None, None

    coords = geometry.get("coordinates", [])
    if not coords:
        return None, None

    # For MultiPolygon, use first polygon
    if geometry["type"] == "MultiPolygon":
        coords = coords[0]

    # Use first ring of polygon
    ring = coords[0] if coords else []
    if not ring:
        return None, None

    # Average coordinates for centroid approximation
    n = len(ring)
    if n == 0:
        return None, None
    avg_lng = sum(p[0] for p in ring) / n
    avg_lat = sum(p[1] for p in ring) / n

    return avg_lat, avg_lng


def safe_date(timestamp_ms):
    """Convert ArcGIS Unix ms timestamp to YYYY-MM-DD."""
    if not timestamp_ms:
        return None
    try:
        ts = int(timestamp_ms) / 1000
        import datetime
        dt = datetime.datetime.fromtimestamp(ts)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None


def clean_name(name):
    """Clean up developer/holder names."""
    if not name:
        return None
    # Remove common suffixes
    name = re.sub(r'\s+c/o\s+.*$', '', name, flags=re.IGNORECASE)
    name = name.strip()
    if len(name) < 3:
        return None
    return name[:255]


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

STATUS_MAP = {
    "Authorized": "active",
    "Pending": "proposed",
    "Interim": "proposed",
    "Closed": "canceled",
}


def transform_feature(feature, data_source_id):
    """Transform a BLM GeoJSON feature into installation record."""
    props = feature.get("properties", {})
    geom = feature.get("geometry")

    case_nr = props.get("CSE_NR", "")
    if not case_nr:
        return None, None

    source_id = f"blm_{case_nr}"

    # Developer/holder name
    holder = props.get("CUST_NM_SEC", "")
    developer_name = clean_name(holder)

    # Project name
    site_name = props.get("CSE_NAME", "")
    if not site_name or site_name == case_nr:
        site_name = None

    # State
    state = props.get("GEO_STATE", props.get("ADMIN_STATE", ""))
    if state and len(state) > 2:
        # Map full state names to abbreviations
        STATE_MAP = {
            "Arizona": "AZ", "California": "CA", "Colorado": "CO",
            "Nevada": "NV", "New Mexico": "NM", "Utah": "UT",
            "Wyoming": "WY", "Oregon": "OR", "Idaho": "ID",
            "Montana": "MT", "Washington": "WA",
        }
        state = STATE_MAP.get(state, state[:2].upper())

    # Centroid from polygon
    lat, lng = polygon_centroid(geom)

    # Acreage → approximate capacity (rough: 5-8 acres per MW for utility PV)
    acres = props.get("RCRD_ACRS")
    capacity_mw = None
    if acres and acres > 0:
        # Conservative estimate: 7 acres per MW
        capacity_mw = round(acres / 7, 1)

    # Disposition date
    disp_date = safe_date(props.get("CSE_DISP_DT"))

    # Status
    disposition = props.get("CSE_DISP", "")
    site_status = STATUS_MAP.get(disposition, "proposed")

    inst = {
        "source_record_id": source_id,
        "site_name": site_name[:255] if site_name else None,
        "site_type": "utility",
        "address": None,
        "city": None,
        "state": state if state else None,
        "zip_code": None,
        "county": None,
        "latitude": lat,
        "longitude": lng,
        "capacity_mw": capacity_mw,
        "install_date": disp_date,
        "site_status": site_status,
        "installer_name": None,
        "owner_name": developer_name,
        "developer_name": developer_name,
        "operator_name": None,
        "total_cost": None,
        "data_source_id": data_source_id,
        "mount_type": "ground_fixed",
        "location_precision": "exact" if lat else None,
    }

    return source_id, inst


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="BLM Solar Energy ROW ingestion")
    parser.add_argument("--active-only", action="store_true",
                        help="Only ingest Authorized, Pending, and Interim records")
    parser.add_argument("--dry-run", action="store_true", help="Preview without ingesting")
    args = parser.parse_args()

    print("BLM Solar Energy ROW Ingestion")
    print("=" * 60)
    print(f"  Active only: {args.active_only}")
    print(f"  Dry run: {args.dry_run}")

    # Fetch from BLM ArcGIS
    print(f"\nFetching solar ROWs from BLM FeatureServer...")
    features = fetch_blm_solar(active_only=args.active_only)
    print(f"  Total solar features: {len(features)}")

    if not features:
        print("No features found.")
        return

    # Status breakdown
    status_counts = {}
    for f in features:
        disp = f.get("properties", {}).get("CSE_DISP", "Unknown")
        status_counts[disp] = status_counts.get(disp, 0) + 1
    for status, count in sorted(status_counts.items()):
        print(f"    {status}: {count}")

    # State breakdown
    state_counts = {}
    for f in features:
        st = f.get("properties", {}).get("GEO_STATE", "Unknown")
        state_counts[st] = state_counts.get(st, 0) + 1
    print(f"\n  States:")
    for state, count in sorted(state_counts.items(), key=lambda x: -x[1]):
        print(f"    {state}: {count}")

    # Setup
    ds_name = "blm_solar_row"
    prefix = "blm"
    if not args.dry_run:
        data_source_id = get_data_source_id(ds_name)
        existing_ids = get_existing_source_ids(prefix)
        print(f"\n  Existing records: {len(existing_ids)}")
    else:
        data_source_id = "dry-run"
        existing_ids = set()

    # Transform
    installations = []
    skipped_dup = 0
    skipped_no_id = 0
    seen_ids = set()

    for feature in features:
        source_id, inst = transform_feature(feature, data_source_id)

        if not source_id or not inst:
            skipped_no_id += 1
            continue

        if source_id in existing_ids or source_id in seen_ids:
            skipped_dup += 1
            continue

        seen_ids.add(source_id)
        installations.append(inst)

    print(f"\n  New records to ingest: {len(installations)}")
    print(f"  Skipped (duplicate): {skipped_dup}")
    print(f"  Skipped (no ID): {skipped_no_id}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
        for inst in installations[:10]:
            print(f"    {inst['source_record_id']} | {inst.get('state', '?')} | "
                  f"{inst.get('site_name') or 'unnamed'} | "
                  f"{inst.get('developer_name') or 'unknown'} | "
                  f"{inst.get('capacity_mw', '?')} MW est | "
                  f"{inst.get('site_status', '?')}")
        return

    if not installations:
        print("  No new records to ingest.")
        return

    # Insert
    print(f"\n  Inserting {len(installations)} records...")
    created = 0
    errors = 0
    for i in range(0, len(installations), BATCH_SIZE):
        batch = installations[i:i + BATCH_SIZE]
        ok, err = supabase_post("solar_installations", batch)
        if ok:
            created += len(batch)
        else:
            errors += len(batch)
            print(f"    Batch error at {i}: {err}")
        if (i + BATCH_SIZE) % 200 == 0:
            print(f"    Progress: {created} created, {errors} errors")

    print(f"\n{'=' * 60}")
    print(f"BLM Solar ROW Ingestion Summary")
    print(f"{'=' * 60}")
    print(f"  Total features: {len(features)}")
    print(f"  Created: {created}")
    print(f"  Errors: {errors}")
    print(f"\nDone!")


if __name__ == "__main__":
    main()

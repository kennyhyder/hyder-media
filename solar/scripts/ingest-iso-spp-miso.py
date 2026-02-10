#!/usr/bin/env python3
"""
Ingest SPP and MISO interconnection queue data.

SPP: Direct CSV download from opsportal.spp.org
MISO: JSON API at misoenergy.org

These two ISOs were previously blocked in the gridstatus library:
- SPP: Column parsing bug in gridstatus 0.29.1
- MISO: Cloudflare 403 on gridstatus scraper

This script downloads directly from the ISO websites instead.

Usage:
  python3 -u scripts/ingest-iso-spp-miso.py               # Both ISOs
  python3 -u scripts/ingest-iso-spp-miso.py --iso spp      # SPP only
  python3 -u scripts/ingest-iso-spp-miso.py --iso miso     # MISO only
  python3 -u scripts/ingest-iso-spp-miso.py --redownload   # Force re-download
"""

import os
import sys
import csv
import json
import uuid
import argparse
import ssl
import io
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "iso_queues"
BATCH_SIZE = 50
MIN_CAPACITY_MW = 1  # Utility-scale threshold

SPP_URL = "https://opsportal.spp.org/Studies/GenerateActiveCSV"
MISO_URL = "https://www.misoenergy.org/api/giqueue/getprojects"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_request(method, table, data=None, params=None, headers_extra=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    if headers_extra:
        headers.update(headers_extra)

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        print(f"  Supabase error ({e.code}): {error_body}")
        return None


def get_existing_source_ids(prefix):
    """Query DB for existing source_record_ids with given prefix."""
    existing = set()
    offset = 0
    while True:
        params = {
            "source_record_id": f"like.{prefix}*",
            "select": "source_record_id",
            "limit": "1000",
            "offset": str(offset),
        }
        rows = supabase_request("GET", "solar_installations", params=params)
        if not rows:
            break
        for r in rows:
            existing.add(r["source_record_id"])
        if len(rows) < 1000:
            break
        offset += 1000
    return existing


def get_or_create_data_source():
    """Get or create the iso_queues data source record."""
    params = {"name": "eq.iso_queues", "select": "id"}
    existing = supabase_request("GET", "solar_data_sources", params=params)
    if existing:
        return existing[0]["id"]

    ds_id = str(uuid.uuid4())
    supabase_request("POST", "solar_data_sources", {
        "id": ds_id,
        "name": "iso_queues",
        "description": "ISO Interconnection Queues - Solar projects from regional grid operators",
        "url": "https://opsportal.spp.org/Studies/GIActiveQueue",
        "record_count": 0,
    })
    return ds_id


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def safe_str(val):
    if val is None or val == "" or val == "N/A" or val == "n/a":
        return None
    s = str(val).strip()
    return s if s else None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None


def parse_date(val):
    if not val:
        return None
    val = str(val).strip()
    if not val or val.lower() in ("n/a", "tbd", "none", "na", ""):
        return None
    for fmt in ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M:%S%z", "%m-%d-%Y", "%d-%b-%Y"]:
        try:
            dt = datetime.strptime(val.split("+")[0].split("Z")[0], fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def map_spp_status(status_str):
    """Map SPP queue status to site_status."""
    if not status_str:
        return "proposed"
    s = status_str.lower()
    if "commercial operation" in s:
        return "active"
    if "on schedule" in s:
        return "under_construction"
    return "proposed"


def map_miso_status(status_str):
    """Map MISO applicationStatus to site_status."""
    if not status_str:
        return "proposed"
    s = status_str.lower()
    if s == "done":
        return "active"
    if s == "withdrawn":
        return None  # Skip
    return "proposed"


# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def download_url(url, label=""):
    """Download URL content and return bytes."""
    print(f"  Downloading {label} from {url}...")
    ctx = ssl.create_default_context()
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SolarTrack/1.0",
            "Accept": "*/*",
        })
        with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
            data = resp.read()
            print(f"  Downloaded {len(data)/1024:.1f} KB")
            return data
    except Exception as e:
        print(f"  Download failed: {e}")
        return None


# ---------------------------------------------------------------------------
# SPP CSV Ingestion
# ---------------------------------------------------------------------------

def process_spp(data_source_id, redownload=False):
    """Download and ingest SPP interconnection queue CSV."""
    print(f"\n{'=' * 60}")
    print("Processing SPP (Southwest Power Pool)")
    print(f"{'=' * 60}")

    spp_dir = DATA_DIR / "spp"
    spp_dir.mkdir(parents=True, exist_ok=True)
    filepath = spp_dir / "spp_queue.csv"

    # Download
    if redownload and filepath.exists():
        filepath.unlink()
    if not filepath.exists():
        data = download_url(SPP_URL, "SPP Active Queue CSV")
        if not data:
            print("  SKIPPING SPP - download failed")
            return {"created": 0, "skipped": 0, "errors": 0, "solar_total": 0}
        filepath.write_bytes(data)
    else:
        print(f"  Using existing file ({filepath.stat().st_size / 1024:.1f} KB)")

    # Parse CSV (first line is "Last Updated On,date," - skip it)
    text = filepath.read_text(encoding="utf-8")
    lines = text.splitlines()

    # Find actual header row (skip "Last Updated On" line)
    header_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('"Last Updated On"') or line.startswith("Last Updated On"):
            header_idx = i + 1
            break

    csv_text = "\n".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    print(f"  Found {len(rows)} total rows")

    # Filter solar
    solar_rows = []
    for row in rows:
        fuel = (row.get("Fuel Type") or "").strip().lower()
        gen = (row.get("Generation Type") or "").strip().lower()
        if "solar" in fuel or "solar" in gen or "photovoltaic" in fuel:
            solar_rows.append(row)
    print(f"  Solar records: {len(solar_rows)}")

    # Skip records already in DB
    existing_ids = get_existing_source_ids("iso_spp_")
    print(f"  Existing in DB: {len(existing_ids)}")

    # Process solar rows
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0
    already_exists = 0

    for row in solar_rows:
        capacity_mw = safe_float(row.get("Capacity"))
        if not capacity_mw or capacity_mw < MIN_CAPACITY_MW:
            skipped += 1
            continue

        queue_id = safe_str(row.get("Generation Interconnection Number"))
        if not queue_id:
            skipped += 1
            continue

        queue_id_clean = queue_id.strip().replace(" ", "_").replace("/", "-")
        source_record_id = f"iso_spp_{queue_id_clean}"

        if source_record_id in existing_ids:
            already_exists += 1
            continue

        state = safe_str(row.get("State"))
        if state:
            state = state.strip()[:2].upper()

        # SPP has " Nearest Town or County" with leading space
        county = safe_str(row.get(" Nearest Town or County") or row.get("Nearest Town or County"))

        status_raw = safe_str(row.get("Status"))
        site_status = map_spp_status(status_raw)

        queue_date = parse_date(row.get("Request Received"))
        proposed_cod = parse_date(row.get("Commercial Operation Date"))
        actual_cod = parse_date(row.get("In-Service Date"))

        poi = safe_str(row.get("Substation or Line"))
        to_at_poi = safe_str(row.get("TO at POI"))

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": f"SPP Queue {queue_id}",
            "state": state,
            "county": county,
            "capacity_mw": round(capacity_mw, 3),
            "capacity_dc_kw": round(capacity_mw * 1000, 3),
            "site_type": "utility",
            "site_status": site_status,
            "developer_name": None,
            "operator_name": to_at_poi[:255] if to_at_poi else None,
            "install_date": actual_cod or proposed_cod,
            "address": poi[:255] if poi else None,
            "interconnection_date": actual_cod,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)
            inst_batch = []
            if (created + errors) % 100 == 0:
                print(f"    Progress: {created} created, {errors} errors, {skipped} skipped")

    # Flush remaining
    if inst_batch:
        res = supabase_request("POST", "solar_installations", inst_batch)
        if res is not None:
            created += len(inst_batch)
        else:
            errors += len(inst_batch)

    stats = {"created": created, "skipped": skipped, "errors": errors, "solar_total": len(solar_rows)}
    print(f"\n  SPP Results:")
    print(f"    Solar found: {len(solar_rows)}")
    print(f"    Already in DB: {already_exists}")
    print(f"    Created: {created}")
    print(f"    Skipped: {skipped}")
    print(f"    Errors: {errors}")
    return stats


# ---------------------------------------------------------------------------
# MISO JSON Ingestion
# ---------------------------------------------------------------------------

def process_miso(data_source_id, redownload=False):
    """Download and ingest MISO interconnection queue JSON."""
    print(f"\n{'=' * 60}")
    print("Processing MISO (Midcontinent ISO)")
    print(f"{'=' * 60}")

    miso_dir = DATA_DIR / "miso"
    miso_dir.mkdir(parents=True, exist_ok=True)
    filepath = miso_dir / "miso_queue.json"

    # Download
    if redownload and filepath.exists():
        filepath.unlink()
    if not filepath.exists():
        data = download_url(MISO_URL, "MISO GI Queue JSON API")
        if not data:
            print("  SKIPPING MISO - download failed")
            return {"created": 0, "skipped": 0, "errors": 0, "solar_total": 0}
        filepath.write_bytes(data)
    else:
        print(f"  Using existing file ({filepath.stat().st_size / 1024:.1f} KB)")

    # Parse JSON
    records = json.loads(filepath.read_text())
    print(f"  Found {len(records)} total records")

    # Filter solar
    solar_rows = []
    for rec in records:
        fuel = (rec.get("fuelType") or "").lower()
        facility = (rec.get("facilityType") or "").lower()
        if "solar" in fuel or "solar" in facility or "photovoltaic" in facility:
            solar_rows.append(rec)
    print(f"  Solar records: {len(solar_rows)}")

    # Deduplicate by projectNumber (MISO can return same project twice)
    seen_projects = set()
    deduped = []
    for rec in solar_rows:
        pn = rec.get("projectNumber")
        if pn and pn in seen_projects:
            continue
        if pn:
            seen_projects.add(pn)
        deduped.append(rec)
    if len(deduped) < len(solar_rows):
        print(f"  Deduplicated: {len(solar_rows)} → {len(deduped)} (removed {len(solar_rows) - len(deduped)} dupes)")
    solar_rows = deduped

    # Skip records already in DB
    existing_ids = get_existing_source_ids("iso_miso_")
    print(f"  Existing in DB: {len(existing_ids)}")

    # Process solar rows
    inst_batch = []
    created = 0
    skipped = 0
    errors = 0
    withdrawn = 0
    already_exists = 0

    for rec in solar_rows:
        # Skip withdrawn
        app_status = (rec.get("applicationStatus") or "").strip()
        site_status = map_miso_status(app_status)
        if site_status is None:
            withdrawn += 1
            continue

        capacity_mw = safe_float(rec.get("summerNetMW"))
        if not capacity_mw or capacity_mw < MIN_CAPACITY_MW:
            skipped += 1
            continue

        project_num = safe_str(rec.get("projectNumber"))
        if not project_num:
            skipped += 1
            continue

        source_record_id = f"iso_miso_{project_num.strip()}"

        if source_record_id in existing_ids:
            already_exists += 1
            continue

        state = safe_str(rec.get("state"))
        if state:
            state = state.strip()[:2].upper()

        county = safe_str(rec.get("county"))
        poi = safe_str(rec.get("poiName"))
        to_name = safe_str(rec.get("transmissionOwner"))

        queue_date = parse_date(rec.get("queueDate"))
        proposed_cod = parse_date(rec.get("inService"))

        installation = {
            "id": str(uuid.uuid4()),
            "source_record_id": source_record_id,
            "data_source_id": data_source_id,
            "site_name": f"MISO Queue {project_num}",
            "state": state,
            "county": county,
            "capacity_mw": round(capacity_mw, 3),
            "capacity_dc_kw": round(capacity_mw * 1000, 3),
            "site_type": "utility",
            "site_status": site_status,
            "developer_name": None,
            "operator_name": to_name[:255] if to_name else None,
            "install_date": proposed_cod,
            "address": poi[:255] if poi else None,
            "interconnection_date": None,
        }

        inst_batch.append(installation)

        if len(inst_batch) >= BATCH_SIZE:
            res = supabase_request("POST", "solar_installations", inst_batch)
            if res is not None:
                created += len(inst_batch)
            else:
                errors += len(inst_batch)
            inst_batch = []
            if (created + errors) % 100 == 0:
                print(f"    Progress: {created} created, {errors} errors, {skipped} skipped")

    # Flush remaining
    if inst_batch:
        res = supabase_request("POST", "solar_installations", inst_batch)
        if res is not None:
            created += len(inst_batch)
        else:
            errors += len(inst_batch)

    stats = {"created": created, "skipped": skipped, "errors": errors,
             "solar_total": len(solar_rows), "withdrawn": withdrawn}
    print(f"\n  MISO Results:")
    print(f"    Solar found: {len(solar_rows)}")
    print(f"    Already in DB: {already_exists}")
    print(f"    Withdrawn (skipped): {withdrawn}")
    print(f"    Created: {created}")
    print(f"    Skipped (small/invalid): {skipped}")
    print(f"    Errors: {errors}")
    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ingest SPP and MISO interconnection queue data")
    parser.add_argument(
        "--iso",
        nargs="+",
        choices=["spp", "miso"],
        default=["spp", "miso"],
        help="ISOs to process (default: both)",
    )
    parser.add_argument(
        "--redownload",
        action="store_true",
        help="Force re-download of data files",
    )
    args = parser.parse_args()

    print("SPP + MISO Interconnection Queue Ingestion")
    print("=" * 60)
    print(f"ISOs to process: {', '.join(args.iso)}")
    print(f"Minimum capacity: {MIN_CAPACITY_MW} MW")
    print(f"Batch size: {BATCH_SIZE}")

    data_source_id = get_or_create_data_source()
    print(f"Data source ID: {data_source_id}")

    results = {}

    if "spp" in args.iso:
        results["spp"] = process_spp(data_source_id, redownload=args.redownload)

    if "miso" in args.iso:
        results["miso"] = process_miso(data_source_id, redownload=args.redownload)

    # Update data source record count (add to existing count)
    total_new = sum(r["created"] for r in results.values())
    if total_new > 0:
        existing = supabase_request("GET", "solar_data_sources",
                                     params={"name": "eq.iso_queues", "select": "record_count"})
        old_count = existing[0]["record_count"] if existing else 0
        supabase_request(
            "PATCH",
            "solar_data_sources",
            {"record_count": old_count + total_new, "last_import": datetime.now().isoformat()},
            params={"name": "eq.iso_queues"},
        )

    # Summary
    print(f"\n{'=' * 60}")
    print("Ingestion Summary")
    print(f"{'=' * 60}")
    for iso_name, stats in results.items():
        print(f"\n  {iso_name.upper()}:")
        print(f"    Solar found: {stats['solar_total']}")
        print(f"    Created: {stats['created']}")
        print(f"    Skipped: {stats['skipped']}")
        if "withdrawn" in stats:
            print(f"    Withdrawn: {stats['withdrawn']}")
        print(f"    Errors: {stats['errors']}")

    total_created = sum(r["created"] for r in results.values())
    total_errors = sum(r["errors"] for r in results.values())
    print(f"\n  TOTAL: {total_created} created, {total_errors} errors")
    print("\nDone!")


if __name__ == "__main__":
    main()

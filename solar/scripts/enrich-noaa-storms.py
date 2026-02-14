#!/usr/bin/env python3
"""
NOAA Storm Events Enrichment Script

Downloads NOAA Storm Events Database bulk CSVs and cross-references hail and
wind events with solar installation locations. Creates solar_site_events records
for installations in counties that experienced damaging weather.

This is HIGH VALUE for Blue Water Battery: hail damage = panel replacement leads.

Data source: https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
Filters: Hail >= 1.0 inch, Wind >= 58 knots (~67 mph)
Matching: County FIPS code + date overlap with installation existence

Usage:
  python3 -u scripts/enrich-noaa-storms.py                  # Full enrichment (2010-2025)
  python3 -u scripts/enrich-noaa-storms.py --dry-run         # Report without patching
  python3 -u scripts/enrich-noaa-storms.py --years 2020 2025 # Specific year range
  python3 -u scripts/enrich-noaa-storms.py --skip-download   # Use existing files
"""

import os
import sys
import json
import csv
import gzip
import uuid
import time
import argparse
import urllib.request
import urllib.parse
import math
import glob as globmod
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data" / "noaa_storms"
NOAA_BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
WORKERS = 20
BATCH_SIZE = 50

# Thresholds
MIN_HAIL_INCHES = 1.0     # >= 1 inch hail damages panels
MIN_WIND_KNOTS = 58        # >= 58 knots (~67 mph) can damage racking

# State name → abbreviation mapping
STATE_ABBREV = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD",
    "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS",
    "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
    "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK",
    "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
    "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY", "DISTRICT OF COLUMBIA": "DC",
    "PUERTO RICO": "PR", "VIRGIN ISLANDS": "VI", "GUAM": "GU",
    "AMERICAN SAMOA": "AS",
}


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


def supabase_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        if "duplicate" not in err.lower() and "conflict" not in err.lower():
            print(f"  POST error ({e.code}): {err}")
        return False


def supabase_patch(table, data, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}): {e.read().decode()[:200]}")
        return False


# ---------------------------------------------------------------------------
# Download NOAA files
# ---------------------------------------------------------------------------

def find_noaa_filename(year):
    """Find the actual filename for a year by listing the directory."""
    # NOAA filenames include a creation date suffix that changes
    # Try to find it from our cached files first
    pattern = str(DATA_DIR / f"StormEvents_details-ftp_v1.0_d{year}_c*.csv.gz")
    matches = globmod.glob(pattern)
    if matches:
        return Path(matches[0])
    return None


def download_noaa_year(year):
    """Download NOAA Storm Events details file for a specific year."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # First check if we already have it
    existing = find_noaa_filename(year)
    if existing and existing.exists():
        print(f"  {year}: Already downloaded ({existing.name})")
        return existing

    # Need to find the actual filename from the directory listing
    print(f"  {year}: Finding filename...")
    try:
        req = urllib.request.Request(NOAA_BASE_URL, headers={
            "User-Agent": "SolarTrack/1.0",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode()

        # Parse filenames from directory listing
        import re
        pattern = f'StormEvents_details-ftp_v1\\.0_d{year}_c\\d+\\.csv\\.gz'
        matches = re.findall(pattern, html)
        if not matches:
            print(f"  {year}: No file found in directory listing")
            return None

        filename = matches[-1]  # Use the latest version
    except Exception as e:
        print(f"  {year}: Error finding filename: {e}")
        return None

    # Download
    url = NOAA_BASE_URL + filename
    local_path = DATA_DIR / filename
    print(f"  {year}: Downloading {filename}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SolarTrack/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        with open(local_path, "wb") as f:
            f.write(data)
        print(f"  {year}: Saved ({len(data):,} bytes)")
        return local_path
    except Exception as e:
        print(f"  {year}: Download error: {e}")
        return None


# ---------------------------------------------------------------------------
# Parse storm events
# ---------------------------------------------------------------------------

def parse_storm_events(filepath, year):
    """Parse a NOAA Storm Events details CSV for hail and wind events."""
    events = []

    with gzip.open(filepath, "rt", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            event_type = row.get("EVENT_TYPE", "").strip()

            # Only hail and wind events
            if event_type not in ("Hail", "Thunderstorm Wind", "High Wind"):
                continue

            # Parse magnitude
            try:
                magnitude = float(row.get("MAGNITUDE", "0") or "0")
            except (ValueError, TypeError):
                continue

            # Apply thresholds
            if event_type == "Hail" and magnitude < MIN_HAIL_INCHES:
                continue
            if event_type in ("Thunderstorm Wind", "High Wind") and magnitude < MIN_WIND_KNOTS:
                continue

            # Geographic info
            state_name = row.get("STATE", "").strip().upper()
            state = STATE_ABBREV.get(state_name, state_name[:2] if len(state_name) == 2 else None)
            if not state:
                continue

            cz_type = row.get("CZ_TYPE", "").strip()
            cz_fips = row.get("CZ_FIPS", "").strip()
            cz_name = row.get("CZ_NAME", "").strip()
            state_fips = row.get("STATE_FIPS", "").strip()

            # Build county FIPS (only for county-type zones)
            county_fips = None
            if cz_type == "C" and state_fips and cz_fips:
                try:
                    county_fips = f"{int(state_fips):02d}{int(cz_fips):03d}"
                except ValueError:
                    pass

            # Parse coordinates
            lat = None
            lon = None
            try:
                lat = float(row.get("BEGIN_LAT", "") or "0") or None
                lon = float(row.get("BEGIN_LON", "") or "0") or None
            except (ValueError, TypeError):
                pass

            # Parse date
            begin_date = row.get("BEGIN_DATE_TIME", "").strip()
            event_date = None
            if begin_date:
                for fmt in ["%d-%b-%y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S"]:
                    try:
                        event_date = datetime.strptime(begin_date, fmt).strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        continue

            if not event_date:
                # Fallback: construct from year/month/day columns
                try:
                    ym = row.get("BEGIN_YEARMONTH", "")
                    day = row.get("BEGIN_DAY", "1")
                    if ym and len(ym) >= 6:
                        event_date = f"{ym[:4]}-{ym[4:6]}-{int(day):02d}"
                except (ValueError, TypeError):
                    continue

            if not event_date:
                continue

            # Parse damage
            damage_property = row.get("DAMAGE_PROPERTY", "").strip()
            damage_amount = parse_damage(damage_property)

            # Event narrative
            narrative = row.get("EVENT_NARRATIVE", "").strip()
            if not narrative:
                narrative = row.get("EPISODE_NARRATIVE", "").strip()

            event_id = row.get("EVENT_ID", "").strip()

            events.append({
                "event_type": event_type,
                "magnitude": magnitude,
                "magnitude_type": row.get("MAGNITUDE_TYPE", "").strip(),
                "state": state,
                "county_name": cz_name.title() if cz_name else None,
                "county_fips": county_fips,
                "lat": lat,
                "lon": lon,
                "event_date": event_date,
                "damage_amount": damage_amount,
                "narrative": narrative[:500] if narrative else None,
                "noaa_event_id": event_id,
            })

    return events


def parse_damage(damage_str):
    """Parse NOAA damage string like '25K', '1.5M', '0' to numeric value."""
    if not damage_str or damage_str == "0":
        return 0
    damage_str = damage_str.strip().upper()
    multiplier = 1
    if damage_str.endswith("K"):
        multiplier = 1000
        damage_str = damage_str[:-1]
    elif damage_str.endswith("M"):
        multiplier = 1000000
        damage_str = damage_str[:-1]
    elif damage_str.endswith("B"):
        multiplier = 1000000000
        damage_str = damage_str[:-1]
    try:
        return float(damage_str) * multiplier
    except (ValueError, TypeError):
        return 0


# ---------------------------------------------------------------------------
# Load installations and match
# ---------------------------------------------------------------------------

def load_installations_by_state():
    """Load installations grouped by state + county for matching."""
    print("Loading installations from database...")
    all_records = []
    offset = 0
    limit = 1000

    while True:
        params = {
            "select": "id,state,county,install_date,latitude,longitude",
            "state": "not.is.null",
            "limit": str(limit),
            "offset": str(offset),
            "order": "id",
        }
        batch = supabase_get("solar_installations", params)
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < limit:
            break
        offset += limit

    print(f"  Total: {len(all_records)} installations loaded")

    # Group by state + county (normalized)
    by_state_county = {}
    for inst in all_records:
        state = inst.get("state")
        county = (inst.get("county") or "").strip().upper()
        if state:
            key = (state, county)
            by_state_county.setdefault(key, []).append(inst)

    print(f"  Unique state+county groups: {len(by_state_county)}")
    return by_state_county, all_records


def normalize_county(name):
    """Normalize county name for matching."""
    if not name:
        return ""
    n = name.strip().upper()
    # Remove common suffixes
    for suffix in [" COUNTY", " PARISH", " BOROUGH", " CENSUS AREA", " MUNICIPALITY",
                   " CITY AND BOROUGH", " CITY", " CO.", " CO"]:
        if n.endswith(suffix):
            n = n[:-len(suffix)]
    return n.strip()


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in km."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Cross-reference NOAA storm events with solar installations")
    parser.add_argument("--dry-run", action="store_true", help="Report without creating events")
    parser.add_argument("--skip-download", action="store_true", help="Use existing files")
    parser.add_argument("--years", nargs=2, type=int, default=[2010, 2025],
                        metavar=("START", "END"), help="Year range (default: 2010-2025)")
    args = parser.parse_args()

    start_year, end_year = args.years

    print("NOAA Storm Events × Solar Installation Cross-Reference")
    print("=" * 60)
    print(f"  Years: {start_year}-{end_year}")
    print(f"  Hail threshold: >= {MIN_HAIL_INCHES} inch")
    print(f"  Wind threshold: >= {MIN_WIND_KNOTS} knots (~{int(MIN_WIND_KNOTS * 1.151)} mph)")
    print(f"  Dry run: {args.dry_run}")

    # Step 1: Download NOAA files
    if not args.skip_download:
        print(f"\nDownloading NOAA Storm Events ({start_year}-{end_year})...")
        for year in range(start_year, end_year + 1):
            download_noaa_year(year)

    # Step 2: Parse all storm events
    print(f"\nParsing storm events...")
    all_storm_events = []
    for year in range(start_year, end_year + 1):
        filepath = find_noaa_filename(year)
        if not filepath or not filepath.exists():
            print(f"  {year}: File not found, skipping")
            continue
        events = parse_storm_events(filepath, year)
        all_storm_events.extend(events)
        hail_count = sum(1 for e in events if e["event_type"] == "Hail")
        wind_count = len(events) - hail_count
        print(f"  {year}: {len(events)} events (hail: {hail_count}, wind: {wind_count})")

    print(f"\n  Total damaging events: {len(all_storm_events)}")

    # Stats
    hail_events = [e for e in all_storm_events if e["event_type"] == "Hail"]
    wind_events = [e for e in all_storm_events if e["event_type"] != "Hail"]
    print(f"  Hail events (>= {MIN_HAIL_INCHES}\"): {len(hail_events)}")
    print(f"  Wind events (>= {MIN_WIND_KNOTS} kts): {len(wind_events)}")

    if hail_events:
        max_hail = max(e["magnitude"] for e in hail_events)
        avg_hail = sum(e["magnitude"] for e in hail_events) / len(hail_events)
        print(f"  Hail size range: {MIN_HAIL_INCHES}\"-{max_hail}\" (avg: {avg_hail:.2f}\")")

    # Top states by events
    state_counts = {}
    for e in all_storm_events:
        state_counts[e["state"]] = state_counts.get(e["state"], 0) + 1
    top_states = sorted(state_counts.items(), key=lambda x: -x[1])[:10]
    print(f"  Top states: {', '.join(f'{s}: {n}' for s, n in top_states)}")

    # Step 3: Load installations
    inst_by_state_county, all_installations = load_installations_by_state()

    # Step 4: Match storm events to installations
    print(f"\n{'=' * 60}")
    print("Matching storm events to solar installations")
    print(f"{'=' * 60}")

    # Group storm events by state + county for efficient matching
    storm_by_county = {}
    for event in all_storm_events:
        county_norm = normalize_county(event["county_name"])
        key = (event["state"], county_norm)
        storm_by_county.setdefault(key, []).append(event)

    # Match: for each installation county, find overlapping storm events
    # Strategy: Create ONE aggregate event per installation per year per type
    # to avoid millions of individual events. Only flag the worst event per year.
    site_events = []
    matched_installations = set()
    matched_storm_ids = set()

    for (state, county), installations in inst_by_state_county.items():
        county_norm = normalize_county(county)
        storms = storm_by_county.get((state, county_norm), [])
        if not storms:
            continue

        for inst in installations:
            inst_date = inst.get("install_date")

            # Group storms by year + type, keep worst per group
            yearly_worst = {}  # (year, type) -> worst storm
            for storm in storms:
                # Only count storms AFTER installation was built
                if inst_date and storm["event_date"] < inst_date:
                    continue

                year = storm["event_date"][:4]
                stype = "hail" if storm["event_type"] == "Hail" else "wind"
                key = (year, stype)

                if key not in yearly_worst or storm["magnitude"] > yearly_worst[key]["magnitude"]:
                    yearly_worst[key] = storm

            for (year, stype), storm in yearly_worst.items():
                # Build severity description
                if stype == "hail":
                    severity = f"{storm['magnitude']}\" hail"
                    if storm["magnitude"] >= 2.0:
                        event_type_label = "severe_hail"
                    else:
                        event_type_label = "hail"
                else:
                    mph = int(storm["magnitude"] * 1.151)
                    severity = f"{mph} mph wind"
                    event_type_label = "high_wind"

                description = f"NOAA Storm Event: {severity} in {storm['county_name'] or 'unknown'} County, {state} on {storm['event_date']}"
                if storm["damage_amount"] and storm["damage_amount"] > 0:
                    description += f" (${storm['damage_amount']:,.0f} property damage reported)"
                if storm["narrative"]:
                    description += f". {storm['narrative'][:200]}"

                site_event = {
                    "id": str(uuid.uuid4()),
                    "installation_id": inst["id"],
                    "event_type": event_type_label,
                    "event_date": storm["event_date"],
                    "description": description[:1000],
                    "data_source_id": None,
                    "old_capacity_kw": None,
                    "new_capacity_kw": None,
                    "equipment_changed": None,
                }
                site_events.append(site_event)
                matched_installations.add(inst["id"])
                matched_storm_ids.add(storm["noaa_event_id"])

    print(f"  Site events to create: {len(site_events)}")
    print(f"  Installations affected: {len(matched_installations)}")
    print(f"  Unique storm events matched: {len(matched_storm_ids)}")

    # Breakdown by type
    hail_site_events = [e for e in site_events if "hail" in e.get("event_type", "")]
    wind_site_events = [e for e in site_events if "wind" in e.get("event_type", "")]
    print(f"  Hail damage events: {len(hail_site_events)}")
    print(f"  Wind damage events: {len(wind_site_events)}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No events created.")
        # Show samples
        print(f"\n  Sample events:")
        for event in site_events[:10]:
            print(f"    {event['event_date']}: {event['description'][:120]}")
        return

    if not site_events:
        print("\n  No events to create.")
        return

    # Step 5: Load existing storm events to avoid duplicates
    # Use psql for fast bulk check (REST API can't handle 3M+ events)
    print(f"\nChecking for existing storm events...")
    existing_keys = set()
    try:
        import subprocess
        psql_cmd = [
            "psql",
            "-h", "aws-0-us-west-2.pooler.supabase.com",
            "-p", "6543",
            "-U", "postgres.ilbovwnhrowvxjdkvrln",
            "-d", "postgres",
            "-t", "-A", "-F", "|",
            "-c", "SELECT installation_id, event_type, event_date FROM solar_site_events WHERE event_type IN ('hail','severe_hail','high_wind')"
        ]
        env = os.environ.copy()
        env["PGPASSWORD"] = "#FsW7iqg%EYX&G3M"
        result = subprocess.run(psql_cmd, capture_output=True, text=True, env=env, timeout=120)
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if "|" in line:
                    parts = line.split("|")
                    if len(parts) >= 3:
                        existing_keys.add((parts[0], parts[1], parts[2]))
            print(f"  Loaded {len(existing_keys):,} existing storm event keys via psql")
        else:
            print(f"  psql failed: {result.stderr[:200]}")
            print(f"  Falling back to REST API dedup (may be slow)...")
            # Fallback: load via REST with retries
            offset = 0
            page_size = 1000
            while True:
                rows = supabase_get("solar_site_events", {
                    "select": "installation_id,event_type,event_date",
                    "event_type": "in.(hail,severe_hail,high_wind)",
                    "limit": page_size,
                    "offset": offset,
                    "order": "id",
                }, retries=5)
                if not rows:
                    break
                for r in rows:
                    existing_keys.add((r["installation_id"], r["event_type"], r["event_date"]))
                offset += len(rows)
                if offset % 100000 == 0:
                    print(f"    Loaded {offset:,} events...")
                if len(rows) < page_size:
                    break
    except Exception as e:
        print(f"  Error loading existing events: {e}")
        print(f"  Proceeding without dedup (may create duplicates)")

    if existing_keys:
        before = len(site_events)
        site_events = [e for e in site_events if (e["installation_id"], e["event_type"], e["event_date"]) not in existing_keys]
        print(f"  Skipped {before - len(site_events):,} duplicates, {len(site_events):,} new events to create")
    else:
        print(f"  No existing storm events found (clean run)")

    if not site_events:
        print("\n  All events already exist. Nothing to create.")
        return

    # Step 5b: Create site events in batches (parallel for speed)
    print(f"\nCreating {len(site_events)} site events in batches of {BATCH_SIZE} (10 parallel workers)...")
    created = 0
    errors = 0

    # Build all batches first
    all_batches = []
    for i in range(0, len(site_events), BATCH_SIZE):
        all_batches.append(site_events[i:i + BATCH_SIZE])

    # Process batches in parallel chunks of 10
    PARALLEL_WORKERS = 10
    for chunk_start in range(0, len(all_batches), PARALLEL_WORKERS):
        chunk = all_batches[chunk_start:chunk_start + PARALLEL_WORKERS]
        with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
            futures = {
                executor.submit(supabase_post, "solar_site_events", batch): len(batch)
                for batch in chunk
            }
            for future in as_completed(futures):
                batch_size = futures[future]
                if future.result():
                    created += batch_size
                else:
                    errors += batch_size

        if created % 5000 < PARALLEL_WORKERS * BATCH_SIZE:
            print(f"  Progress: {created} created, {errors} errors")

    print(f"\n{'=' * 60}")
    print("NOAA Storm Events Enrichment Summary")
    print(f"{'=' * 60}")
    print(f"  Storm events parsed: {len(all_storm_events)}")
    print(f"  Site events created: {created}")
    print(f"  Installations flagged: {len(matched_installations)}")
    print(f"  Errors: {errors}")
    print("\nDone!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Ingest frontier datacenter projects from Epoch AI into GridScout.
Source: https://epoch.ai/data/data_centers/data_center_timelines.csv
Target: grid_datacenters table

The CSV is a timeline with multiple rows per datacenter (one per observation date).
This script takes the LATEST row per datacenter (most recent power/status data),
filters to US-only projects, and inserts into grid_datacenters.

Usage:
  python3 -u scripts/ingest-epoch-datacenters.py              # Download + ingest
  python3 -u scripts/ingest-epoch-datacenters.py --dry-run    # Preview without inserting
"""

import os
import sys
import json
import csv
import time
import re
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from collections import defaultdict
from dotenv import load_dotenv

# Load env from grid/.env.local or solar/.env.local
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
load_dotenv(env_path)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

CSV_URL = "https://epoch.ai/data/data_centers/data_center_timelines.csv"
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'epoch')
CSV_PATH = os.path.join(DATA_DIR, 'data_center_timelines.csv')
BATCH_SIZE = 50

# --- US state extraction from datacenter name ---
# Epoch names follow pattern: "Operator Project City State" e.g. "xAI Colossus 1 Memphis Tennessee"
US_STATES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY',
}

# Manual corrections for names that need help parsing
# Format: { 'Data center name': { 'operator': ..., 'city': ..., 'state_abbr': ... } }
OVERRIDES = {
    'Fluidstack Lake Mariner': {'operator': 'Fluidstack / TeraWulf', 'city': 'Salem Township', 'state_abbr': 'PA'},
    'Crusoe Abilene Expansion': {'operator': 'Crusoe', 'city': 'Abilene', 'state_abbr': 'TX'},
    'OpenAI Stargate Shackelford': {'operator': 'OpenAI / Oracle', 'city': 'Shackelford County', 'state_abbr': 'TX'},
}


def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data, allow_nan=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                print(f"  Error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            raise


def safe_float(val):
    if val is None:
        return None
    try:
        v = float(str(val).strip())
        if v != v:  # NaN check
            return None
        return v
    except (ValueError, TypeError):
        return None


def safe_int(val):
    f = safe_float(val)
    if f is None:
        return None
    return int(f)


def make_slug(name):
    """Create a URL-safe slug from a datacenter name."""
    slug = re.sub(r'[^a-z0-9]+', '_', name.lower().strip())
    return slug.strip('_')


def parse_location(dc_name):
    """
    Extract operator, city, and state from Epoch datacenter name.
    Names follow pattern like "Google Cedar Rapids Iowa" or "xAI Colossus 1 Memphis Tennessee".
    Returns (operator, city, state_abbr) or None if not US.
    """
    # Check overrides first
    if dc_name in OVERRIDES:
        o = OVERRIDES[dc_name]
        return o['operator'], o['city'], o['state_abbr']

    # Try to find a US state name at the end of the string
    for state_name, state_abbr in sorted(US_STATES.items(), key=lambda x: -len(x[0])):
        if dc_name.endswith(state_name):
            prefix = dc_name[:-(len(state_name))].strip()
            # Try to extract city (last word(s) before state)
            # and operator (first word(s))
            # Heuristic: known operators
            operator = None
            city = None
            for op in ['Anthropic-Amazon', 'OpenAI-Oracle', 'Microsoft Fairwater',
                        'Amazon', 'Google', 'Meta', 'Microsoft', 'xAI', 'Crusoe',
                        'Coreweave', 'Fluidstack', 'QTS', 'OpenAI']:
                if prefix.startswith(op):
                    operator = op
                    remainder = prefix[len(op):].strip()
                    # City is everything after operator and before state
                    # But there may be a project name in between
                    # e.g. "Meta Hyperion Holly Ridge" -> operator=Meta, city=Holly Ridge
                    # e.g. "Google Cedar Rapids" -> operator=Google, city=Cedar Rapids
                    city = remainder if remainder else None
                    break

            if not operator:
                # Fallback: first word is operator
                parts = prefix.split(' ', 1)
                operator = parts[0]
                city = parts[1] if len(parts) > 1 else None

            # Clean up city — remove project codenames if obvious
            # e.g. "Hyperion Holly Ridge" -> "Holly Ridge", "Prometheus New Albany" -> "New Albany"
            if city:
                # Known project codenames to strip
                codenames = ['Hyperion', 'Prometheus', 'Fairwater', 'Helios',
                             'Project Rainier', 'Stargate', 'Colossus 1', 'Colossus 2',
                             'Abilene Expansion']
                for cn in sorted(codenames, key=len, reverse=True):
                    if city.startswith(cn):
                        city = city[len(cn):].strip()
                        break

            # Clean operator name
            operator = operator.replace('Anthropic-Amazon', 'Anthropic / Amazon')
            operator = operator.replace('OpenAI-Oracle', 'OpenAI / Oracle')
            operator = operator.replace('Microsoft Fairwater', 'Microsoft')

            return operator, city or None, state_abbr

    return None  # Not a US datacenter


def infer_status(construction_status, buildings_operational, power_mw):
    """
    Infer operational status from the latest construction status text.
    Returns: 'operational', 'under_construction', or 'announced'
    """
    status_lower = (construction_status or '').lower()
    bldg_count = safe_int(buildings_operational) or 0

    if bldg_count > 0 or 'operational' in status_lower:
        # Has operational buildings — could be partially operational
        return 'operational'
    elif any(kw in status_lower for kw in ['construction', 'building', 'clearing', 'grading',
                                            'foundation', 'erected', 'installed', 'chiller']):
        return 'under_construction'
    else:
        return 'announced'


def download_csv():
    """Download the Epoch AI CSV to data/epoch/."""
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"Downloading CSV from {CSV_URL}...")
    req = urllib.request.Request(CSV_URL, headers={
        'User-Agent': 'GridScout/1.0 (solar data pipeline)'
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        with open(CSV_PATH, 'wb') as f:
            f.write(data)
        print(f"  Saved {len(data):,} bytes to {CSV_PATH}")
    except Exception as e:
        print(f"  Download failed: {e}")
        if os.path.exists(CSV_PATH):
            print(f"  Using cached file: {CSV_PATH}")
        else:
            print("  No cached file available. Exiting.")
            sys.exit(1)


def parse_csv():
    """
    Parse the timeline CSV, take latest row per datacenter, filter to US.
    Returns list of dicts ready for insertion.
    """
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Parsed {len(rows)} timeline rows across {len(set(r['Data center'] for r in rows))} datacenters")

    # Group by datacenter name, keep latest (last) row per datacenter
    grouped = defaultdict(list)
    for r in rows:
        grouped[r['Data center']].append(r)

    records = []
    skipped_non_us = []

    for dc_name, entries in sorted(grouped.items()):
        latest = entries[-1]  # CSV is chronologically ordered

        # Parse location
        loc = parse_location(dc_name)
        if loc is None:
            skipped_non_us.append(dc_name)
            continue

        operator, city, state_abbr = loc
        power_mw = safe_float(latest.get('Power (MW)'))
        sqft = safe_float(latest.get('Building area (square feet)'))
        buildings_op = safe_int(latest.get('Buildings operational'))
        status = infer_status(latest.get('Construction status', ''), buildings_op, power_mw)

        # Extract year from earliest entry date
        first_date = entries[0].get('Date', '')
        year_built = None
        if first_date:
            try:
                year_built = int(first_date[:4])
            except (ValueError, IndexError):
                pass

        slug = make_slug(dc_name)
        source_record_id = f"epoch_{slug}"

        record = {
            'source_record_id': source_record_id,
            'name': dc_name,
            'operator': operator,
            'city': city,
            'state': state_abbr,
            'latitude': None,   # Epoch CSV has no coords
            'longitude': None,
            'capacity_mw': power_mw,
            'sqft': safe_int(sqft) if sqft else None,
            'dc_type': 'hyperscale',
            'year_built': year_built,
        }

        records.append({
            'record': record,
            'status': status,
            'buildings_operational': buildings_op or 0,
            'total_entries': len(entries),
            'latest_date': latest.get('Date', ''),
        })

    if skipped_non_us:
        print(f"  Skipped {len(skipped_non_us)} non-US datacenters: {', '.join(skipped_non_us)}")

    return records


def get_or_create_data_source(dry_run=False):
    """Get or create the epoch_ai data source record."""
    path = f"grid_data_sources?name=eq.epoch_ai&select=id"
    result = supabase_request('GET', path)
    if result:
        return result[0]['id']

    if dry_run:
        print("  [DRY RUN] Would create data source: epoch_ai")
        return 'dry-run-id'

    record = {
        'name': 'epoch_ai',
        'url': CSV_URL,
        'description': 'Epoch AI Frontier Data Center Timelines - satellite-tracked hyperscale datacenter construction',
        'record_count': 0,
    }
    result = supabase_request('POST', 'grid_data_sources', record, {
        'Prefer': 'return=representation'
    })
    ds_id = result[0]['id']
    print(f"  Created data source: epoch_ai (id: {ds_id})")
    return ds_id


def get_existing_ids():
    """Fetch existing epoch_ source_record_ids from grid_datacenters."""
    path = f"grid_datacenters?source_record_id=like.epoch_*&select=source_record_id"
    result = supabase_request('GET', path)
    return {r['source_record_id'] for r in (result or [])}


def main():
    dry_run = '--dry-run' in sys.argv

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    print("=" * 60)
    print("Epoch AI Frontier Datacenter Ingestion")
    print("=" * 60)

    # Download CSV
    download_csv()

    # Parse and filter
    print("\nParsing CSV...")
    records = parse_csv()
    print(f"  {len(records)} US frontier datacenters found")

    if not records:
        print("No records to process.")
        return

    # Print summary by status
    status_counts = defaultdict(int)
    total_power = 0
    for r in records:
        status_counts[r['status']] += 1
        pw = r['record'].get('capacity_mw')
        if pw:
            total_power += pw

    print(f"\n--- Status Summary ---")
    for status in ['operational', 'under_construction', 'announced']:
        count = status_counts.get(status, 0)
        if count:
            print(f"  {status}: {count}")
    print(f"  Total power: {total_power:,.0f} MW")

    # Print each record
    print(f"\n--- Records ---")
    for r in records:
        rec = r['record']
        pw = f"{rec['capacity_mw']:,.0f} MW" if rec['capacity_mw'] else 'N/A'
        sq = f"{rec['sqft']:,} sqft" if rec['sqft'] else ''
        bldg = f"{r['buildings_operational']} bldg" if r['buildings_operational'] else ''
        extras = ', '.join(filter(None, [pw, sq, bldg]))
        print(f"  [{r['status']:>20}] {rec['name']}")
        print(f"                        {rec['operator']} | {rec['city']}, {rec['state']} | {extras}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(records)} records into grid_datacenters")
        return

    # Get/create data source
    print("\nSetting up data source...")
    ds_id = get_or_create_data_source(dry_run)

    # Check existing records
    existing = get_existing_ids()
    new_records = [r for r in records if r['record']['source_record_id'] not in existing]
    skipped = len(records) - len(new_records)
    if skipped:
        print(f"  Skipping {skipped} existing records")

    if not new_records:
        print("All records already exist. Nothing to insert.")
        # Update record count
        count_path = f"grid_data_sources?name=eq.epoch_ai"
        supabase_request('PATCH', count_path, {
            'record_count': len(records),
            'last_import': datetime.now(timezone.utc).isoformat(),
        })
        return

    # Insert in batches
    print(f"\nInserting {len(new_records)} new records...")
    created = 0
    errors = 0

    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        batch_data = []
        for r in batch:
            rec = r['record'].copy()
            rec['data_source_id'] = ds_id
            # Remove None values that would cause issues, but keep all keys consistent
            batch_data.append(rec)

        try:
            supabase_request('POST', 'grid_datacenters', batch_data, {
                'Prefer': 'return=minimal'
            })
            created += len(batch)
            print(f"  Inserted batch {i // BATCH_SIZE + 1}: {len(batch)} records")
        except Exception as e:
            print(f"  ERROR inserting batch {i // BATCH_SIZE + 1}: {e}")
            errors += len(batch)

    # Update data source record count
    count_path = f"grid_data_sources?name=eq.epoch_ai"
    supabase_request('PATCH', count_path, {
        'record_count': created + skipped,
        'last_import': datetime.now(timezone.utc).isoformat(),
    })

    print(f"\n--- Results ---")
    print(f"  Created: {created}")
    print(f"  Skipped (existing): {skipped}")
    print(f"  Errors: {errors}")
    print("Done.")


if __name__ == '__main__':
    main()

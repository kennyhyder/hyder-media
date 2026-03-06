#!/usr/bin/env python3
"""
Ingest ERCOT SCED Binding Transmission Constraint Data

Downloads and inserts ERCOT shadow price data for binding transmission
constraints into grid_ercot_constraints. Two modes:

1. gridstatus mode (default, easier):
   Uses the gridstatus Python library to fetch shadow prices.
   Requires .venv with Python 3.10+ and gridstatus installed.
   Run: .venv/bin/python3.13 -u scripts/ingest-ercot-sced.py

2. API mode (--api flag):
   Uses ERCOT's public API directly with B2C authentication.
   Requires ERCOT_USERNAME, ERCOT_PASSWORD, ERCOT_SUBSCRIPTION_KEY in .env.local.
   Run: python3 -u scripts/ingest-ercot-sced.py --api

Source: https://www.ercot.com/mp/data-products/data-product-details?id=NP6-86-CD
Target: grid_ercot_constraints table

Usage:
  .venv/bin/python3.13 -u scripts/ingest-ercot-sced.py                # gridstatus, last 7 days
  .venv/bin/python3.13 -u scripts/ingest-ercot-sced.py --date 2026-03-01  # Single day
  .venv/bin/python3.13 -u scripts/ingest-ercot-sced.py --days 30      # Last 30 days
  python3 -u scripts/ingest-ercot-sced.py --api --days 7              # ERCOT API mode
  python3 -u scripts/ingest-ercot-sced.py --dry-run                   # Preview without inserting
"""

import os
import sys
import json
import math
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

# Load env vars from grid/.env.local
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# ERCOT API configuration
ERCOT_TOKEN_URL = (
    "https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com"
    "/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token"
)
ERCOT_API_BASE = "https://api.ercot.com/api/public-reports"
ERCOT_SCED_ENDPOINT = "np6-86-cd/shdw_prices_bnd_trns_const"
ERCOT_CLIENT_ID = "fec253ea-0d06-4272-a5e6-b478baeecd70"


# ---------------------------------------------------------------------------
# Supabase helpers (same pattern as ingest-hifld.py)
# ---------------------------------------------------------------------------

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


def get_data_source_id():
    """Get the ercot_sced data source ID (must exist from schema.sql seed)."""
    result = supabase_request('GET', 'grid_data_sources?name=eq.ercot_sced&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print("ERROR: ercot_sced data source not found in grid_data_sources.")
    print("  Run schema.sql first to create the data source record.")
    sys.exit(1)


def get_existing_keys():
    """Load existing (constraint_name, interval_start) pairs to avoid duplicates."""
    existing = set()
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_ercot_constraints?select=constraint_name,interval_start'
            f'&limit={page_size}&offset={offset}&order=id'
        )
        if not result:
            break
        for r in result:
            key = (r.get('constraint_name'), r.get('interval_start'))
            existing.add(key)
        if len(result) < page_size:
            break
        offset += page_size
    return existing


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def safe_float(val):
    """Safely convert a value to float, returning None for invalid/NaN."""
    if val is None:
        return None
    try:
        import pandas as pd
        if pd.isna(val):
            return None
    except (ImportError, TypeError):
        pass
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def safe_str(val, max_len=500):
    """Safely convert a value to string, returning None for empty/NaN."""
    if val is None:
        return None
    try:
        import pandas as pd
        if pd.isna(val):
            return None
    except (ImportError, TypeError):
        pass
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'nan', 'na', ''):
        return None
    return s[:max_len] if len(s) > max_len else s


def format_timestamp(val):
    """Convert a datetime/Timestamp to ISO 8601 string for Supabase."""
    if val is None:
        return None
    try:
        import pandas as pd
        if pd.isna(val):
            return None
        if isinstance(val, pd.Timestamp):
            return val.isoformat()
    except ImportError:
        pass
    if isinstance(val, datetime):
        return val.isoformat()
    s = str(val).strip()
    if not s or s.lower() in ('none', 'nat', 'nan'):
        return None
    return s


# ---------------------------------------------------------------------------
# gridstatus mode
# ---------------------------------------------------------------------------

def fetch_gridstatus(date_start, date_end):
    """Fetch ERCOT shadow prices via gridstatus library.

    Uses gridstatus's low-level _get_documents() + read_doc() to fetch the
    NP6-86-CD (SCED Binding Transmission Constraints) report directly.
    Report Type ID 12302 = SCEDBTCNP686_csv.

    gridstatus does NOT have a dedicated high-level method for this data product,
    so we use the internal document API with parse=False to get the raw CSV data.
    """
    try:
        from gridstatus import Ercot
    except ImportError:
        print("ERROR: gridstatus library not installed.")
        print("  Install: .venv/bin/pip install gridstatus")
        print("  Run with: .venv/bin/python3.13 -u scripts/ingest-ercot-sced.py")
        sys.exit(1)

    import pandas as pd

    SCED_BTC_REPORT_TYPE_ID = 12302  # NP6-86-CD Shadow Prices & Binding Constraints

    ercot = Ercot()
    all_rows = []

    # Fetch available documents for the date range.
    # ERCOT publishes these reports every ~5 minutes, so there are many per day.
    # _get_documents returns the full list; we filter by date.
    print(f"  Fetching document list for report type 12302 (NP6-86-CD)...")
    try:
        docs = ercot._get_documents(
            report_type_id=SCED_BTC_REPORT_TYPE_ID,
            verbose=False,
        )
        print(f"  {len(docs)} documents available in listing")
    except Exception as e:
        print(f"  ERROR fetching document list: {e}")
        return []

    # Filter documents to our date range using the publish_date
    # Documents are published with timestamps; filter to those within our range
    start_ts = pd.Timestamp(date_start.strftime('%Y-%m-%d')).tz_localize('US/Central')
    end_ts = pd.Timestamp((date_end + timedelta(days=1)).strftime('%Y-%m-%d')).tz_localize('US/Central')

    filtered_docs = [
        d for d in docs
        if d.publish_date >= start_ts and d.publish_date < end_ts
    ]
    print(f"  {len(filtered_docs)} documents in date range {date_start.strftime('%Y-%m-%d')} to {date_end.strftime('%Y-%m-%d')}")

    if not filtered_docs:
        print("  No documents found for date range.")
        return []

    # Read each document (each is a small CSV inside a zip, ~200 rows)
    for i, doc in enumerate(filtered_docs):
        try:
            df = ercot.read_doc(doc, parse=False, verbose=False)
            if df is not None and len(df) > 0:
                all_rows.append(df)
            if (i + 1) % 50 == 0:
                print(f"    Read {i + 1}/{len(filtered_docs)} documents ({sum(len(d) for d in all_rows)} rows)...")
        except Exception as e:
            print(f"    ERROR reading doc {doc.constructed_name}: {e}")
        # Small delay to be polite (these are cached CDN downloads, usually fast)
        if (i + 1) % 20 == 0:
            time.sleep(0.5)

    if not all_rows:
        return []

    combined = pd.concat(all_rows, ignore_index=True)
    print(f"\n  Total rows fetched: {len(combined)}")
    if len(combined) > 0:
        print(f"  Columns: {list(combined.columns)}")

    # Column mapping from raw ERCOT CSV to our schema
    # Raw columns: SCEDTimeStamp, RepeatedHourFlag, ConstraintID, ConstraintName,
    #              ContingencyName, ShadowPrice, MaxShadowPrice, Limit, Value,
    #              ViolatedMW, FromStation, ToStation, FromStationkV, ToStationkV,
    #              CCTStatus
    records = []
    for _, row in combined.iterrows():
        constraint_name = safe_str(row.get('ConstraintName'))
        sced_timestamp = safe_str(row.get('SCEDTimeStamp'))

        if not constraint_name or not sced_timestamp:
            continue

        # Parse ERCOT timestamp format: "MM/DD/YYYY HH:MM:SS" to ISO 8601
        interval_start = None
        try:
            dt = datetime.strptime(sced_timestamp, '%m/%d/%Y %H:%M:%S')
            interval_start = dt.isoformat()
        except (ValueError, TypeError):
            interval_start = sced_timestamp

        if not interval_start:
            continue

        record = {
            'constraint_name': constraint_name,
            'constraint_id': safe_str(row.get('ConstraintID')),
            'contingency_name': safe_str(row.get('ContingencyName')),
            'from_station': safe_str(row.get('FromStation')),
            'to_station': safe_str(row.get('ToStation')),
            'from_station_kv': safe_float(row.get('FromStationkV')),
            'to_station_kv': safe_float(row.get('ToStationkV')),
            'shadow_price': safe_float(row.get('ShadowPrice')),
            'max_shadow_price': safe_float(row.get('MaxShadowPrice')),
            'limit_mw': safe_float(row.get('Limit')),
            'value_mw': safe_float(row.get('Value')),
            'violated_mw': safe_float(row.get('ViolatedMW')),
            'interval_start': interval_start,
            'interval_end': None,  # NP6-86-CD doesn't have an explicit end column
        }
        records.append(record)

    return records


# ---------------------------------------------------------------------------
# ERCOT API mode
# ---------------------------------------------------------------------------

def ercot_api_get_token():
    """Authenticate with ERCOT B2C and return an id_token."""
    username = os.environ.get('ERCOT_USERNAME')
    password = os.environ.get('ERCOT_PASSWORD')

    if not username or not password:
        print("ERROR: ERCOT_USERNAME and ERCOT_PASSWORD must be set in .env.local")
        sys.exit(1)

    data = urllib.parse.urlencode({
        'grant_type': 'password',
        'username': username,
        'password': password,
        'scope': f'openid {ERCOT_CLIENT_ID} offline_access',
        'client_id': ERCOT_CLIENT_ID,
        'response_type': 'id_token',
    }).encode()

    req = urllib.request.Request(ERCOT_TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            token = body.get('id_token')
            if not token:
                print(f"ERROR: No id_token in response. Keys: {list(body.keys())}")
                sys.exit(1)
            print("  ERCOT authentication successful")
            return token
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ''
        print(f"ERROR: ERCOT auth failed (HTTP {e.code}): {error_body[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: ERCOT auth failed: {e}")
        sys.exit(1)


def fetch_ercot_api(date_start, date_end):
    """Fetch ERCOT shadow prices via the public API."""
    subscription_key = os.environ.get('ERCOT_SUBSCRIPTION_KEY')
    if not subscription_key:
        print("ERROR: ERCOT_SUBSCRIPTION_KEY must be set in .env.local")
        sys.exit(1)

    print("  Authenticating with ERCOT B2C...")
    token = ercot_api_get_token()

    all_records = []

    # ERCOT API paginates; iterate day by day to keep page sizes manageable
    current = date_start
    while current <= date_end:
        date_str = current.strftime("%Y-%m-%d")
        print(f"  Fetching API data for {date_str}...")

        page = 1
        day_count = 0

        while True:
            params = urllib.parse.urlencode({
                'deliveryDateFrom': date_str,
                'deliveryDateTo': date_str,
                'page': page,
                'size': 1000,
            })
            url = f"{ERCOT_API_BASE}/{ERCOT_SCED_ENDPOINT}?{params}"

            req = urllib.request.Request(url, method='GET')
            req.add_header('Authorization', f'Bearer {token}')
            req.add_header('Ocp-Apim-Subscription-Key', subscription_key)
            req.add_header('Accept', 'application/json')

            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        body = json.loads(resp.read().decode())
                        break
                except urllib.error.HTTPError as e:
                    error_body = e.read().decode() if e.fp else ''
                    if e.code == 401:
                        print("  Token expired, re-authenticating...")
                        token = ercot_api_get_token()
                        req = urllib.request.Request(url, method='GET')
                        req.add_header('Authorization', f'Bearer {token}')
                        req.add_header('Ocp-Apim-Subscription-Key', subscription_key)
                        req.add_header('Accept', 'application/json')
                        continue
                    if e.code in (429, 500, 502, 503) and attempt < 2:
                        wait = (2 ** attempt) * 2
                        print(f"    HTTP {e.code}, retrying in {wait}s...")
                        time.sleep(wait)
                        continue
                    print(f"    API error (HTTP {e.code}): {error_body[:500]}")
                    body = None
                    break
                except Exception as e:
                    if attempt < 2:
                        print(f"    Error: {e}, retrying in {2 ** attempt}s...")
                        time.sleep(2 ** attempt)
                        continue
                    print(f"    Failed after 3 attempts: {e}")
                    body = None
                    break

            if not body:
                break

            # ERCOT API returns data in a nested structure
            # The exact format may vary; handle both flat and nested responses
            data_items = body.get('data', body.get('records', body.get('results', [])))
            if isinstance(data_items, dict):
                data_items = data_items.get('records', data_items.get('data', []))

            if not data_items:
                break

            for item in data_items:
                constraint_name = safe_str(
                    item.get('constraintName')
                    or item.get('constraint_name')
                    or item.get('ConstraintName')
                )
                if not constraint_name:
                    continue

                # Parse interval timestamps
                interval_start = (
                    item.get('intervalStart')
                    or item.get('interval_start')
                    or item.get('SCEDTimestamp')
                    or item.get('sced_timestamp')
                    or item.get('deliveryDate')
                )
                if not interval_start:
                    continue

                # Normalize timestamp — ERCOT API may return various formats
                interval_start_str = str(interval_start).strip()
                if interval_start_str and 'T' not in interval_start_str and len(interval_start_str) == 10:
                    interval_start_str += 'T00:00:00'

                record = {
                    'constraint_name': constraint_name,
                    'constraint_id': safe_str(
                        item.get('constraintId')
                        or item.get('constraint_id')
                    ),
                    'contingency_name': safe_str(
                        item.get('contingencyName')
                        or item.get('contingency_name')
                        or item.get('ContingencyName')
                    ),
                    'from_station': safe_str(
                        item.get('fromStation')
                        or item.get('from_station')
                        or item.get('FromStation')
                    ),
                    'to_station': safe_str(
                        item.get('toStation')
                        or item.get('to_station')
                        or item.get('ToStation')
                    ),
                    'from_station_kv': safe_float(
                        item.get('fromStationKv')
                        or item.get('from_station_kv')
                        or item.get('FromStationKV')
                    ),
                    'to_station_kv': safe_float(
                        item.get('toStationKv')
                        or item.get('to_station_kv')
                        or item.get('ToStationKV')
                    ),
                    'shadow_price': safe_float(
                        item.get('shadowPrice')
                        or item.get('shadow_price')
                        or item.get('ShadowPrice')
                    ),
                    'max_shadow_price': safe_float(
                        item.get('maxShadowPrice')
                        or item.get('max_shadow_price')
                        or item.get('MaxShadowPrice')
                    ),
                    'limit_mw': safe_float(
                        item.get('limitMW')
                        or item.get('limit_mw')
                        or item.get('Limit')
                        or item.get('limit')
                    ),
                    'value_mw': safe_float(
                        item.get('valueMW')
                        or item.get('value_mw')
                        or item.get('Value')
                        or item.get('value')
                    ),
                    'violated_mw': safe_float(
                        item.get('violatedMW')
                        or item.get('violated_mw')
                        or item.get('ViolatedMW')
                    ),
                    'interval_start': interval_start_str,
                    'interval_end': safe_str(
                        item.get('intervalEnd')
                        or item.get('interval_end')
                    ),
                }
                all_records.append(record)
                day_count += 1

            # Check for more pages
            total_pages = body.get('totalPages', body.get('_meta', {}).get('totalPages', 1))
            if page >= total_pages:
                break
            page += 1
            time.sleep(0.5)

        print(f"    {day_count} records for {date_str}")
        current += timedelta(days=1)
        time.sleep(1.0)

    return all_records


# ---------------------------------------------------------------------------
# Insert records into Supabase
# ---------------------------------------------------------------------------

def insert_records(records, data_source_id, existing_keys, dry_run=False):
    """Insert constraint records, skipping duplicates by (constraint_name, interval_start)."""
    new_records = []
    skipped = 0

    for rec in records:
        key = (rec.get('constraint_name'), rec.get('interval_start'))
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)

        # Add data_source_id to each record
        rec['data_source_id'] = data_source_id
        new_records.append(rec)

    if dry_run:
        print(f"\n  DRY RUN: Would insert {len(new_records)} records (skipped {skipped} duplicates)")
        return len(new_records), skipped, 0

    print(f"\n  Inserting {len(new_records)} records (skipped {skipped} duplicates)...")
    created = 0
    errors = 0

    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request(
                'POST',
                'grid_ercot_constraints',
                batch,
                {'Prefer': 'return=minimal'}
            )
            created += len(batch)
            if created % 500 == 0 or created == len(new_records):
                print(f"    {created}/{len(new_records)} inserted")
        except Exception as e:
            # Fall back to one-by-one insertion on batch error
            print(f"  Batch error at offset {i}: {e}")
            for rec in batch:
                try:
                    supabase_request(
                        'POST',
                        'grid_ercot_constraints',
                        [rec],
                        {'Prefer': 'return=minimal'}
                    )
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"    Record error ({rec.get('constraint_name')}): {e2}")

    return created, skipped, errors


# ---------------------------------------------------------------------------
# Analytics: aggregate stats
# ---------------------------------------------------------------------------

def print_analytics(records):
    """Print top binding constraints and shadow price stats."""
    if not records:
        print("\n  No records to analyze.")
        return

    # Count binding events per constraint
    binding_counts = {}
    shadow_prices = {}

    for rec in records:
        name = rec.get('constraint_name', 'UNKNOWN')
        sp = rec.get('shadow_price')

        if name not in binding_counts:
            binding_counts[name] = 0
            shadow_prices[name] = []
        binding_counts[name] += 1
        if sp is not None:
            shadow_prices[name].append(sp)

    # Top 10 most-frequently-binding constraints
    print("\n" + "=" * 70)
    print("Top 10 Most-Frequently-Binding Constraints")
    print("-" * 70)
    print(f"  {'Constraint':<45} {'Intervals':>10} {'Avg $/MWh':>10}")
    print(f"  {'─' * 45} {'─' * 10} {'─' * 10}")

    sorted_by_count = sorted(binding_counts.items(), key=lambda x: x[1], reverse=True)
    for name, count in sorted_by_count[:10]:
        prices = shadow_prices.get(name, [])
        avg_price = sum(prices) / len(prices) if prices else 0
        display_name = name[:44] if len(name) > 44 else name
        print(f"  {display_name:<45} {count:>10,} ${avg_price:>9.2f}")

    # Top 10 highest shadow price constraints (by max shadow price seen)
    print("\n" + "=" * 70)
    print("Top 10 Highest Shadow Price Constraints")
    print("-" * 70)
    print(f"  {'Constraint':<40} {'Max $/MWh':>10} {'Avg $/MWh':>10} {'Count':>8}")
    print(f"  {'─' * 40} {'─' * 10} {'─' * 10} {'─' * 8}")

    max_prices = {}
    for name, prices in shadow_prices.items():
        if prices:
            max_prices[name] = max(prices)

    sorted_by_max = sorted(max_prices.items(), key=lambda x: x[1], reverse=True)
    for name, max_p in sorted_by_max[:10]:
        prices = shadow_prices.get(name, [])
        avg_p = sum(prices) / len(prices) if prices else 0
        count = binding_counts.get(name, 0)
        display_name = name[:39] if len(name) > 39 else name
        print(f"  {display_name:<40} ${max_p:>9.2f} ${avg_p:>9.2f} {count:>8,}")

    # Overall summary
    all_prices = [p for prices in shadow_prices.values() for p in prices]
    print(f"\n  Summary:")
    print(f"    Unique constraints: {len(binding_counts):,}")
    print(f"    Total binding intervals: {sum(binding_counts.values()):,}")
    if all_prices:
        print(f"    Shadow price range: ${min(all_prices):.2f} - ${max(all_prices):.2f}")
        print(f"    Average shadow price: ${sum(all_prices) / len(all_prices):.2f}")
        print(f"    Median shadow price: ${sorted(all_prices)[len(all_prices) // 2]:.2f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Ingest ERCOT SCED binding transmission constraint data'
    )
    parser.add_argument('--date', type=str, default=None,
                        help='Fetch single day (YYYY-MM-DD). Default: yesterday')
    parser.add_argument('--days', type=int, default=7,
                        help='Fetch last N days (default: 7). Ignored if --date is set.')
    parser.add_argument('--api', action='store_true',
                        help='Use ERCOT API instead of gridstatus library')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview without inserting into database')
    args = parser.parse_args()

    # Determine date range
    if args.date:
        try:
            date_start = datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            print(f"ERROR: Invalid date format '{args.date}'. Use YYYY-MM-DD.")
            sys.exit(1)
        date_end = date_start
        print(f"Fetching data for: {args.date}")
    else:
        date_end = datetime.now() - timedelta(days=1)
        date_start = date_end - timedelta(days=args.days - 1)
        print(f"Fetching data for: {date_start.strftime('%Y-%m-%d')} to {date_end.strftime('%Y-%m-%d')} ({args.days} days)")

    mode = "ERCOT API" if args.api else "gridstatus"
    print(f"Mode: {mode}")
    if args.dry_run:
        print("DRY RUN: No data will be inserted")

    print()
    print("=" * 60)
    print("GridScout ERCOT SCED Binding Constraint Ingestion")
    print("=" * 60)

    # Verify Supabase credentials
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
        sys.exit(1)

    # Get data source ID
    data_source_id = get_data_source_id()
    print(f"  Data source ID: {data_source_id}")

    # Load existing keys for dedup
    print("  Loading existing constraint records...")
    existing_keys = get_existing_keys()
    print(f"  {len(existing_keys)} existing records in DB")

    # Fetch data
    print(f"\n  Fetching ERCOT shadow prices via {mode}...")
    if args.api:
        records = fetch_ercot_api(date_start, date_end)
    else:
        records = fetch_gridstatus(date_start, date_end)

    print(f"\n  Total records fetched: {len(records)}")

    if not records:
        print("  No records to process. Exiting.")
        return

    # Show analytics before inserting
    print_analytics(records)

    # Insert into Supabase
    created, skipped, errors = insert_records(
        records, data_source_id, existing_keys, dry_run=args.dry_run
    )

    # Update data source record count and last_import
    if not args.dry_run and created > 0:
        total_in_db = len(existing_keys)
        supabase_request(
            'PATCH',
            'grid_data_sources?name=eq.ercot_sced',
            {
                'record_count': total_in_db,
                'last_import': datetime.now(timezone.utc).isoformat()
            }
        )

    # Final summary
    print(f"\n{'=' * 60}")
    print("ERCOT SCED Ingestion Complete")
    print(f"  Date range: {date_start.strftime('%Y-%m-%d')} to {date_end.strftime('%Y-%m-%d')}")
    print(f"  Mode: {mode}")
    print(f"  Fetched: {len(records):,}")
    print(f"  Created: {created:,}")
    print(f"  Skipped (existing): {skipped:,}")
    print(f"  Errors: {errors:,}")
    if not args.dry_run:
        print(f"  Total in DB: {len(existing_keys):,}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

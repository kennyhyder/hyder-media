#!/usr/bin/env python3
"""
Extract substations from HIFLD transmission line endpoints.

HIFLD Transmission Lines have SUB_1 and SUB_2 fields containing the names of
start/end substations. The full HIFLD Substations dataset is restricted (secure
access only), but we can extract substation names and approximate locations from
the line endpoints.

Creates a grid_substations table (if needed) and populates it with unique
substation names, approximate coordinates (from line start/end vertices),
voltage levels, and owner information.
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50


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
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def create_substations_table():
    """Create grid_substations table via SQL if it doesn't exist."""
    # Check if table exists by trying a query
    try:
        supabase_request('GET', 'grid_substations?select=id&limit=1')
        return True  # Table exists
    except:
        pass

    # Table doesn't exist — we need to create it via psql
    print("  grid_substations table not found. Creating via psql...")
    import subprocess
    sql = """
    CREATE TABLE IF NOT EXISTS grid_substations (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(11,7),
        max_voltage_kv NUMERIC(8,2),
        min_voltage_kv NUMERIC(8,2),
        owners TEXT[],
        connected_line_count INTEGER DEFAULT 0,
        connected_line_ids INTEGER[],
        data_source_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(name, state)
    );

    CREATE INDEX IF NOT EXISTS idx_grid_substations_state ON grid_substations(state);
    CREATE INDEX IF NOT EXISTS idx_grid_substations_voltage ON grid_substations(max_voltage_kv);
    """

    db_pass = os.environ.get('SUPABASE_DB_PASSWORD', '#FsW7iqg%EYX&G3M')
    result = subprocess.run(
        ['psql', '-h', 'aws-0-us-west-2.pooler.supabase.com', '-p', '6543',
         '-U', 'postgres.ilbovwnhrowvxjdkvrln', '-d', 'postgres',
         '-c', sql],
        env={**os.environ, 'PGPASSWORD': db_pass},
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
        return False
    print("  Table created successfully")
    return True


def fetch_all_lines():
    """Fetch all transmission lines with their geometry endpoints."""
    lines = []
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_transmission_lines?select=hifld_id,sub_1,sub_2,voltage_kv,owner,state,geometry_wkt'
            f'&limit={page_size}&offset={offset}&order=hifld_id'
        )
        if not result:
            break
        lines.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
        print(f"  Loaded {len(lines)} lines...")
    return lines


def parse_endpoint(wkt, start=True):
    """Extract start or end coordinate from WKT LINESTRING/MULTILINESTRING."""
    if not wkt:
        return None, None

    # Extract coordinate pairs from WKT
    try:
        # Remove type prefix
        inner = wkt
        for prefix in ['MULTILINESTRING(', 'LINESTRING(']:
            if inner.startswith(prefix):
                inner = inner[len(prefix):]
                break

        # Remove trailing parens
        inner = inner.rstrip(')')

        # Split into coordinate pairs
        # For MULTILINESTRING, get first or last path
        parts = inner.split('(')
        if start:
            coords_str = parts[0] if len(parts) == 1 else parts[1]
        else:
            coords_str = parts[-1] if len(parts) > 1 else parts[0]

        coords_str = coords_str.strip().strip(',').strip(')')
        pairs = coords_str.strip().split(',')

        if start:
            pair = pairs[0].strip()
        else:
            pair = pairs[-1].strip()

        lon, lat = pair.split()
        return float(lat), float(lon)
    except:
        return None, None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'not available', '-999', '-9999'):
        return None
    return s


def main():
    print("=" * 60)
    print("GridScout Substation Extraction from HIFLD Lines")
    print("=" * 60)

    # Ensure table exists
    if not create_substations_table():
        print("ERROR: Could not create grid_substations table")
        sys.exit(1)

    # Get data source ID
    result = supabase_request('GET', 'grid_data_sources?name=eq.hifld_transmission&select=id')
    data_source_id = result[0]['id'] if result else None

    # Load all transmission lines
    print("\nLoading transmission lines...")
    lines = fetch_all_lines()
    print(f"  {len(lines)} lines loaded")

    # Extract unique substations
    substations = {}  # key: (name, state) -> data
    for line in lines:
        hifld_id = line.get('hifld_id')
        voltage = line.get('voltage_kv')
        owner = safe_str(line.get('owner'))
        state = line.get('state')
        wkt = line.get('geometry_wkt')

        for sub_field, is_start in [('sub_1', True), ('sub_2', False)]:
            name = safe_str(line.get(sub_field))
            if not name:
                continue

            lat, lon = parse_endpoint(wkt, start=is_start)
            key = (name, state)

            if key not in substations:
                substations[key] = {
                    'name': name,
                    'state': state,
                    'lats': [],
                    'lons': [],
                    'voltages': [],
                    'owners': set(),
                    'line_ids': [],
                }

            if lat is not None and lon is not None:
                substations[key]['lats'].append(lat)
                substations[key]['lons'].append(lon)
            if voltage:
                substations[key]['voltages'].append(float(voltage))
            if owner:
                substations[key]['owners'].add(owner)
            if hifld_id:
                substations[key]['line_ids'].append(hifld_id)

    print(f"\n  {len(substations)} unique substations extracted")

    # Convert to records
    records = []
    for (name, state), data in substations.items():
        lat = sum(data['lats']) / len(data['lats']) if data['lats'] else None
        lon = sum(data['lons']) / len(data['lons']) if data['lons'] else None
        max_v = max(data['voltages']) if data['voltages'] else None
        min_v = min(data['voltages']) if data['voltages'] else None
        owners = sorted(data['owners']) if data['owners'] else None

        record = {
            'name': name,
            'state': state,
            'latitude': round(lat, 7) if lat else None,
            'longitude': round(lon, 7) if lon else None,
            'max_voltage_kv': max_v,
            'min_voltage_kv': min_v,
            'owners': owners,
            'connected_line_count': len(set(data['line_ids'])),
            'connected_line_ids': sorted(set(data['line_ids']))[:100],  # Cap at 100
            'data_source_id': data_source_id,
        }
        records.append(record)

    # Check existing
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_substations?select=name,state&limit=1000&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add((r['name'], r.get('state')))
        if len(result) < 1000:
            break
        offset += 1000

    # Filter to new records
    new_records = [r for r in records if (r['name'], r.get('state')) not in existing]
    print(f"  {len(existing)} already in DB, {len(new_records)} new to insert")

    # Insert in batches
    total_created = 0
    total_errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_substations', batch, {'Prefer': 'return=minimal'})
            total_created += len(batch)
        except Exception as e:
            print(f"  Batch error: {e}")
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_substations', [rec], {'Prefer': 'return=minimal'})
                    total_created += 1
                except:
                    total_errors += 1

        if (i + BATCH_SIZE) % 500 == 0:
            print(f"  Inserted {total_created}...")

    # Print stats
    print(f"\n{'=' * 60}")
    print(f"Substation Extraction Complete")
    print(f"  Total unique substations: {len(substations)}")
    print(f"  Created: {total_created}")
    print(f"  Skipped (existing): {len(existing)}")
    print(f"  Errors: {total_errors}")

    # Voltage distribution
    voltage_buckets = {}
    for rec in records:
        v = rec.get('max_voltage_kv')
        if v:
            if v < 100:
                bucket = '<100 kV'
            elif v < 200:
                bucket = '100-199 kV'
            elif v < 300:
                bucket = '200-299 kV'
            elif v < 400:
                bucket = '300-399 kV'
            elif v < 600:
                bucket = '400-599 kV'
            else:
                bucket = '600+ kV'
            voltage_buckets[bucket] = voltage_buckets.get(bucket, 0) + 1

    print(f"\n  Voltage distribution:")
    for bucket in sorted(voltage_buckets.keys()):
        print(f"    {bucket}: {voltage_buckets[bucket]}")

    # State distribution
    state_counts = {}
    for rec in records:
        s = rec.get('state', 'Unknown')
        state_counts[s] = state_counts.get(s, 0) + 1

    print(f"\n  State distribution:")
    for state in sorted(state_counts.keys(), key=lambda x: state_counts[x], reverse=True):
        print(f"    {state}: {state_counts[state]}")

    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

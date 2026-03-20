#!/usr/bin/env python3
"""
Ingest HIFLD General Manufacturing facility data into grid_dc_sites.

The original HIFLD national endpoint (services1.arcgis.com/Hp6G80Pky0om7QvQ)
has been decommissioned. This script queries available mirror endpoints that
host copies of the HIFLD General Manufacturing dataset with the same schema:

  - I81 ManufactHIFLD (VA only, ~938 records) — HDR ArcGIS
  - MDOT Transit Study POI (MS only, ~1,445 records) — HDR ArcGIS
  - Indiana General Manufacturing 2009 (IN only, ~5,274 records) — IndianaMap

All three share the same HIFLD field schema:
  NAME, ADDRESS, CITY, STATE, ZIP, COUNTY, FIPS, LATITUDE, LONGITUDE,
  EMP (employees), NAICS, NAICSDESCR, PRODUCT, SIC, WEB, PHONE

Manufacturing facilities are relevant for DC site selection because they
indicate industrial zoning, power infrastructure, and workforce availability.

Target: grid_dc_sites table with site_type = 'manufacturing'

Usage:
  python3 -u scripts/ingest-hifld-manufacturing.py              # Full ingestion
  python3 -u scripts/ingest-hifld-manufacturing.py --dry-run     # Preview without inserting
  python3 -u scripts/ingest-hifld-manufacturing.py --state VA    # Single state
  python3 -u scripts/ingest-hifld-manufacturing.py --limit 100   # Limit records
"""

import os
import sys
import json
import math
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

# macOS system Python SSL fix
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    SSL_CTX.load_verify_locations(certifi.where())
except ImportError:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
UA = 'GridScout/1.0 (hifld-manufacturing)'

# ── HIFLD Manufacturing mirror endpoints ──────────────────────
# All share the same HIFLD schema with LATITUDE/LONGITUDE, NAME, STATE, etc.
# Field names may be upper or lower case depending on endpoint.

HIFLD_MFG_ENDPOINTS = [
    {
        'name': 'I81 ManufactHIFLD (VA)',
        'url': 'https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/I81_ManufactHIFLD/FeatureServer/0',
        'state_filter': 'VA',
        'max_record_count': 1000,
    },
    {
        'name': 'MDOT Transit Study POI (MS)',
        'url': 'https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/MDOT_Transit_Study_POI/FeatureServer/1',
        'state_filter': 'MS',
        'max_record_count': 2000,
    },
    {
        'name': 'Indiana General Manufacturing 2009 (IN)',
        'url': 'https://gisdata.in.gov/server/rest/services/Hosted/General_Manufacturing_Facilities_2009/FeatureServer/0',
        'state_filter': 'IN',
        'max_record_count': 2000,
    },
]


def http_get(url, timeout=60):
    """Make an HTTP GET request with retry logic."""
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            err_body = ''
            try:
                err_body = e.read().decode()[:300]
            except Exception:
                pass
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return {'error': f'HTTP {e.code}', 'detail': err_body}
        except Exception as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return {'error': str(e)}
    return {'error': 'max retries'}


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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = ''
            try:
                err_body = e.read().decode()[:500]
            except Exception:
                pass
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', '', '.', '<null>'):
        return None
    return s[:max_len] if len(s) > max_len else s


def safe_int(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def ensure_data_source():
    """Create or find the hifld_manufacturing data source entry."""
    result = supabase_request('GET', 'grid_data_sources?name=eq.hifld_manufacturing&select=id')
    if result and len(result) > 0:
        return result[0]['id']

    print("  Creating hifld_manufacturing data source...")
    result = supabase_request('POST', 'grid_data_sources', [{
        'name': 'hifld_manufacturing',
        'url': 'https://hifld-geoplatform.hub.arcgis.com/',
        'description': 'HIFLD General Manufacturing Facilities (mirror endpoints)',
    }], {'Prefer': 'return=representation'})
    if result:
        return result[0]['id']
    return None


def get_existing_ids():
    """Load existing source_record_ids for hifld_mfg_ prefix."""
    existing = set()
    offset = 0
    while True:
        path = (f'grid_dc_sites?select=source_record_id'
                f'&source_record_id=like.hifld_mfg_*'
                f'&limit=1000&offset={offset}')
        result = supabase_request('GET', path)
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    return existing


def fetch_features(endpoint):
    """Fetch all features from an ArcGIS endpoint with pagination."""
    base_url = endpoint['url']
    name = endpoint['name']
    page_size = endpoint.get('max_record_count', 2000)

    print(f"\n  Fetching: {name}")
    print(f"    URL: {base_url}")

    # Get record count
    count_url = f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json"
    count_data = http_get(count_url)
    if 'error' in count_data:
        print(f"    ERROR: Could not get count: {count_data.get('error')}")
        return []
    total = count_data.get('count', 0)
    print(f"    Total records: {total:,}")

    if total == 0:
        return []

    # Paginate
    all_features = []
    offset = 0
    seen_oids = set()

    while True:
        params = {
            'where': '1=1',
            'outFields': '*',
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        }
        query_url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
        data = http_get(query_url, timeout=120)

        if 'error' in data:
            print(f"    Error at offset {offset}: {data.get('error')}")
            break

        features = data.get('features', [])
        if not features:
            break

        # OID-based dedup
        new_count = 0
        for feat in features:
            attrs = feat.get('attributes', {})
            oid = attrs.get('OBJECTID') or attrs.get('OBJECTID_1') or attrs.get('fid')
            if oid and oid in seen_oids:
                continue
            if oid:
                seen_oids.add(oid)
            all_features.append(feat)
            new_count += 1

        if new_count == 0:
            break

        offset += len(features)
        if offset % 5000 == 0:
            print(f"    Fetched {offset:,}...")

        if len(features) < page_size:
            break

        time.sleep(0.2)

    print(f"    Fetched {len(all_features):,} features")
    return all_features


def features_to_records(features, endpoint):
    """Convert ArcGIS features to grid_dc_sites records."""
    records = []
    state_filter = endpoint.get('state_filter')

    for feat in features:
        attrs = feat.get('attributes', {})
        # Case-insensitive field access
        a = {k.upper(): v for k, v in attrs.items()}

        # Extract fields
        name = safe_str(a.get('NAME'))
        state = safe_str(a.get('STATE'))
        county = safe_str(a.get('COUNTY'))
        city = safe_str(a.get('CITY'))
        address = safe_str(a.get('ADDRESS'))
        zip_code = safe_str(a.get('ZIP'))
        fips = safe_str(a.get('FIPS'))
        lat = safe_float(a.get('LATITUDE'))
        lng = safe_float(a.get('LONGITUDE'))
        employees = safe_int(a.get('EMP'))
        naics = safe_str(a.get('NAICS'))
        naics_desc = safe_str(a.get('NAICSDESCR'))
        product = safe_str(a.get('PRODUCT'))
        web = safe_str(a.get('WEB'))
        phone = safe_str(a.get('PHONE'))
        unique_id = safe_str(a.get('UNIQUE_ID'))

        # Try geometry for coordinates if LATITUDE/LONGITUDE missing
        if not lat or not lng:
            geom = feat.get('geometry', {})
            if geom:
                lat = safe_float(geom.get('y'))
                lng = safe_float(geom.get('x'))

        # Skip records without coordinates (grid_dc_sites requires lat/lng NOT NULL)
        if not lat or not lng:
            continue

        # Validate coordinates (US bounds)
        if lat < 17.5 or lat > 72.0 or lng > -60.0 or lng < -180.0:
            continue

        # Skip if no state
        if not state:
            if state_filter:
                state = state_filter
            else:
                continue

        # Validate state is 2-letter
        if len(state) > 2:
            continue

        # Build source_record_id from UNIQUE_ID or OBJECTID
        oid = a.get('OBJECTID') or a.get('OBJECTID_1') or a.get('FID')
        if unique_id:
            src_id = f"hifld_mfg_{unique_id}"
        elif oid:
            src_id = f"hifld_mfg_{state}_{oid}"
        else:
            # Hash-based fallback
            coord_key = f"{lat:.5f}_{lng:.5f}"
            src_id = f"hifld_mfg_{state}_{coord_key}"

        # Build descriptive name with context
        display_name = name
        if display_name and naics_desc:
            display_name = f"{name} ({naics_desc})"
        elif display_name and product:
            display_name = f"{name} ({product})"
        # Truncate to 500 chars
        if display_name and len(display_name) > 500:
            display_name = display_name[:497] + '...'

        # Build address string
        full_address = address
        if full_address and city and state and zip_code:
            full_address = f"{address}, {city}, {state} {zip_code}"
        elif full_address and city and state:
            full_address = f"{address}, {city}, {state}"

        record = {
            'source_record_id': src_id,
            'name': display_name,
            'site_type': 'manufacturing',
            'state': state,
            'county': county,
            'fips_code': fips,
            'address': full_address,
            'latitude': round(lat, 7),
            'longitude': round(lng, 7),
        }
        records.append(record)

    return records


def main():
    print("=" * 60)
    print("GridScout HIFLD Manufacturing Facility Ingestion")
    print("=" * 60)

    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    target_state = None
    limit = None

    for i, arg in enumerate(args):
        if arg == '--state' and i + 1 < len(args):
            target_state = args[i + 1].upper()
        if arg == '--limit' and i + 1 < len(args):
            limit = int(args[i + 1])

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    # Filter endpoints by state if specified
    endpoints = HIFLD_MFG_ENDPOINTS
    if target_state:
        endpoints = [e for e in endpoints if e['state_filter'] == target_state]
        if not endpoints:
            print(f"ERROR: No endpoint configured for state {target_state}")
            print(f"Available states: {', '.join(e['state_filter'] for e in HIFLD_MFG_ENDPOINTS)}")
            sys.exit(1)

    if dry_run:
        print("DRY RUN MODE -- no records will be inserted\n")

    # Fetch from all endpoints
    all_records = []
    for endpoint in endpoints:
        features = fetch_features(endpoint)
        if not features:
            continue
        records = features_to_records(features, endpoint)
        print(f"    Converted to {len(records):,} valid DC site records")
        all_records.extend(records)

    if not all_records:
        print("\nNo records to insert.")
        return

    # Apply limit
    if limit and len(all_records) > limit:
        all_records = all_records[:limit]
        print(f"\nLimited to {limit} records")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Total records: {len(all_records):,}")
    state_counts = {}
    for r in all_records:
        st = r.get('state', '??')
        state_counts[st] = state_counts.get(st, 0) + 1
    print("By state:")
    for st, cnt in sorted(state_counts.items(), key=lambda x: -x[1]):
        print(f"  {st}: {cnt:,}")

    # Show sample records
    print(f"\nSample records:")
    for r in all_records[:5]:
        print(f"  {r['source_record_id']}: {r.get('name', 'unnamed')}")
        print(f"    {r.get('address', 'no address')} | {r['state']} | ({r['latitude']}, {r['longitude']})")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(all_records):,} manufacturing site records.")
        return

    # Ensure data source exists
    data_source_id = ensure_data_source()
    if not data_source_id:
        print("ERROR: Could not create/find data source")
        sys.exit(1)
    print(f"\nData source ID: {data_source_id}")

    # Assign data_source_id + created_at
    for r in all_records:
        r['data_source_id'] = data_source_id
        r['created_at'] = datetime.now(timezone.utc).isoformat()

    # Load existing records to deduplicate
    print("Loading existing records...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids):,} existing hifld_mfg_ records in DB")

    new_records = [r for r in all_records if r['source_record_id'] not in existing_ids]
    print(f"  {len(new_records):,} new records to insert "
          f"({len(all_records) - len(new_records)} already exist)")

    if not new_records:
        print("\nAll records already exist. Nothing to do.")
        return

    # Insert in batches
    created = 0
    errors = 0

    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {
                'Prefer': 'return=minimal',
            })
            created += len(batch)
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            # Try one at a time
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_dc_sites', [rec], {
                        'Prefer': 'return=minimal',
                    })
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Record error ({rec['source_record_id']}): {e2}")

        if (i // BATCH_SIZE) % 10 == 0 and i > 0:
            print(f"  Progress: {min(i + BATCH_SIZE, len(new_records)):,}/{len(new_records):,} "
                  f"({created:,} created, {errors} errors)")

    # Update data source record count
    total_in_db = len(existing_ids) + created
    supabase_request('PATCH', f'grid_data_sources?name=eq.hifld_manufacturing', {
        'record_count': total_in_db,
        'last_import': datetime.now(timezone.utc).isoformat(),
    })

    print(f"\n{'=' * 60}")
    print(f"HIFLD Manufacturing Ingestion Complete")
    print(f"  Created: {created:,}")
    print(f"  Skipped (existing): {len(all_records) - len(new_records):,}")
    print(f"  Errors: {errors}")
    print(f"  Total in DB: {total_in_db:,}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

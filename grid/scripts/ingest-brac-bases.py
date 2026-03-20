#!/usr/bin/env python3
"""
Ingest BRAC (Base Realignment and Closure) military installations.

Source: USDOT/Esri Military Installations ArcGIS FeatureServer
URL: https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/
     Military_Bases/FeatureServer/0/query

Also queries the HIFLD Military Installations endpoint as fallback:
URL: https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/
     Military_Installations_Ranges_and_Training_Areas/FeatureServer/0/query

Filters to closed/BRAC/realigning bases and inserts into grid_dc_sites
with site_type='military_brac'.

Usage:
    python3 -u scripts/ingest-brac-bases.py
    python3 -u scripts/ingest-brac-bases.py --dry-run
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# Primary endpoint: Esri Living Atlas Military Bases
ARCGIS_URLS = [
    'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Military_Bases/FeatureServer/0/query',
    'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Military_Installations_Ranges_and_Training_Areas/FeatureServer/0/query',
]

US_STATES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
    'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
    'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
    'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
    'WV', 'WI', 'WY',
}

STATE_ISO = {
    'TX': 'ERCOT', 'CA': 'CAISO', 'NY': 'NYISO', 'CT': 'ISO-NE', 'MA': 'ISO-NE',
    'ME': 'ISO-NE', 'NH': 'ISO-NE', 'RI': 'ISO-NE', 'VT': 'ISO-NE',
    'PA': 'PJM', 'NJ': 'PJM', 'MD': 'PJM', 'DE': 'PJM', 'DC': 'PJM',
    'VA': 'PJM', 'WV': 'PJM', 'OH': 'PJM', 'IN': 'PJM', 'IL': 'PJM',
    'MI': 'PJM', 'KY': 'PJM', 'NC': 'PJM',
    'MN': 'MISO', 'IA': 'MISO', 'WI': 'MISO', 'MO': 'MISO', 'AR': 'MISO',
    'MS': 'MISO', 'LA': 'MISO',
    'OK': 'SPP', 'KS': 'SPP', 'NE': 'SPP', 'SD': 'SPP', 'ND': 'SPP',
    'NM': 'SPP', 'MT': 'SPP',
    'OR': 'WECC', 'WA': 'WECC', 'ID': 'WECC', 'UT': 'WECC', 'WY': 'WECC',
    'CO': 'WECC', 'AZ': 'WECC', 'NV': 'WECC',
    'GA': 'SERC', 'FL': 'SERC', 'AL': 'SERC', 'SC': 'SERC', 'TN': 'SERC',
}

# Known BRAC base names (for matching if STATUS field is missing)
BRAC_KEYWORDS = [
    'brac', 'closed', 'realign', 'decommission', 'former',
    'inactive', 'surplus', 'excess',
]


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
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def fetch_arcgis_page(base_url, offset=0, page_size=1000, where='1=1'):
    """Fetch a page of results from ArcGIS."""
    params = urllib.parse.urlencode({
        'where': where,
        'outFields': '*',
        'f': 'json',
        'resultRecordCount': page_size,
        'resultOffset': offset,
        'returnGeometry': 'true',
        'outSR': '4326',
    })
    url = f"{base_url}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < 2:
                print(f"  Retry {attempt + 1}: {e}")
                time.sleep(2 ** attempt)
                continue
            raise


def fetch_all_features(base_url, where='1=1'):
    """Fetch all features from ArcGIS with pagination."""
    all_features = []
    offset = 0
    page_size = 1000

    while True:
        data = fetch_arcgis_page(base_url, offset, page_size, where)
        features = data.get('features', [])
        if not features:
            break
        all_features.extend(features)
        offset += len(features)
        if not data.get('exceededTransferLimit', False) and len(features) < page_size:
            break
        time.sleep(0.5)

    return all_features


def safe_float(val):
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def get_centroid(geometry):
    """Extract centroid lat/lng from ArcGIS geometry (point or polygon rings)."""
    if not geometry:
        return None, None

    # Point geometry
    if 'x' in geometry and 'y' in geometry:
        return safe_float(geometry['y']), safe_float(geometry['x'])

    # Polygon geometry - compute centroid from rings
    if 'rings' in geometry:
        all_x, all_y = [], []
        for ring in geometry['rings']:
            for coord in ring:
                if len(coord) >= 2:
                    all_x.append(coord[0])
                    all_y.append(coord[1])
        if all_x and all_y:
            return sum(all_y) / len(all_y), sum(all_x) / len(all_x)

    return None, None


def is_brac_or_closed(attrs):
    """Check if a military installation is closed/BRAC/realigning."""
    # Check explicit status fields
    for field in ['STATUS', 'CLOSURE_STATUS', 'OPER_STAT', 'BRAC_STATUS',
                  'JOINTBASE', 'SITE_STATUS', 'INSTALLATIONSTATUS']:
        val = safe_str(attrs.get(field))
        if val:
            val_lower = val.lower()
            for kw in BRAC_KEYWORDS:
                if kw in val_lower:
                    return True

    # Check name for BRAC keywords
    name = safe_str(attrs.get('SITE_NAME') or attrs.get('NAME') or
                    attrs.get('INSTALLATIONNAME') or attrs.get('FULLNAME'))
    if name:
        name_lower = name.lower()
        for kw in ['brac', 'former', 'closed']:
            if kw in name_lower:
                return True

    return False


def get_or_create_data_source():
    ds = supabase_request('GET', 'grid_data_sources?name=eq.brac_bases&select=id')
    if ds:
        return ds[0]['id']
    supabase_request('POST', 'grid_data_sources', [{
        'name': 'brac_bases',
        'description': 'BRAC/closed military installations (USDOT/HIFLD ArcGIS)',
        'url': 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Military_Bases/FeatureServer',
    }], {'Prefer': 'return=representation'})
    ds = supabase_request('GET', 'grid_data_sources?name=eq.brac_bases&select=id')
    return ds[0]['id'] if ds else None


def main():
    print("=" * 60)
    print("GridScout: Ingest BRAC Military Bases")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Fetch from ArcGIS endpoints
    print("\n[Step 1] Fetching military installations...")
    all_features = []

    for url in ARCGIS_URLS:
        print(f"\n  Trying: {url.split('/services/')[1].split('/')[0]}...")
        try:
            # First check what fields are available
            meta_url = url.replace('/query', '') + '?f=json'
            req = urllib.request.Request(meta_url, headers={'User-Agent': 'GridScout/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    meta = json.loads(resp.read().decode())
                    field_names = [f['name'] for f in meta.get('fields', [])]
                    print(f"  Fields: {field_names[:15]}...")
            except Exception:
                print(f"  Could not fetch metadata, trying queries anyway...")

            features = fetch_all_features(url)
            print(f"  Fetched {len(features)} features")

            if features:
                all_features.extend(features)
                break  # Use first successful endpoint
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    if not all_features:
        print("\nERROR: Could not fetch military base data from any endpoint")
        sys.exit(1)

    # Step 2: Filter and transform
    print(f"\n[Step 2] Filtering to BRAC/closed bases...")
    data_source_id = None if dry_run else get_or_create_data_source()

    candidates = []
    skipped_active = 0
    skipped_coords = 0
    skipped_state = 0
    seen_ids = set()

    for feat in all_features:
        attrs = feat.get('attributes', {})

        # Check if BRAC/closed
        if not is_brac_or_closed(attrs):
            skipped_active += 1
            continue

        # Get coordinates
        lat, lng = get_centroid(feat.get('geometry'))

        # Fall back to attribute lat/lng
        if lat is None or lng is None:
            lat = safe_float(attrs.get('LATITUDE') or attrs.get('Y'))
            lng = safe_float(attrs.get('LONGITUDE') or attrs.get('X'))

        if lat is None or lng is None or abs(lat) > 90 or abs(lng) > 180:
            skipped_coords += 1
            continue

        # Get state
        state = safe_str(attrs.get('STATE') or attrs.get('STATE_TERR') or
                        attrs.get('STATENAME'))
        if state and len(state) > 2:
            # Full state name → abbreviation mapping
            state_map = {
                'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
                'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
                'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI',
                'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
                'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME',
                'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
                'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
                'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
                'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
                'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI',
                'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
                'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
                'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
            }
            state = state_map.get(state, state[:2].upper())

        if not state or state not in US_STATES:
            skipped_state += 1
            continue

        # Build unique ID
        obj_id = safe_str(attrs.get('OBJECTID') or attrs.get('FID') or
                         attrs.get('FACILITYID') or attrs.get('SITE_ID'))
        name = safe_str(attrs.get('SITE_NAME') or attrs.get('NAME') or
                       attrs.get('INSTALLATIONNAME') or attrs.get('FULLNAME'))
        if not obj_id:
            obj_id = f"{lat:.4f}_{lng:.4f}"
        source_id = f"brac_{obj_id}"
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)

        if not name:
            name = 'Military Installation'

        branch = safe_str(attrs.get('BRANCH') or attrs.get('COMPONENT') or
                         attrs.get('SERVICE'))
        acres = safe_float(attrs.get('ACRES') or attrs.get('AREAACRES') or
                          attrs.get('SHAPE__AREA'))
        # Convert sq meters to acres if needed
        if acres and acres > 100000:
            acres = acres / 4046.86

        county = safe_str(attrs.get('COUNTY') or attrs.get('COUNTYNAME'))

        former_use = f"Military ({branch})" if branch else 'Military installation'

        candidates.append({
            'source_record_id': source_id,
            'name': name[:200] if name else None,
            'site_type': 'military_brac',
            'state': state,
            'county': county,
            'latitude': lat,
            'longitude': lng,
            'acreage': acres,
            'former_use': former_use[:300] if former_use else None,
            'cleanup_status': safe_str(attrs.get('STATUS') or attrs.get('OPER_STAT')),
            'iso_region': STATE_ISO.get(state),
            'data_source_id': data_source_id,
        })

    print(f"  Total features: {len(all_features)}")
    print(f"  BRAC/closed candidates: {len(candidates)}")
    print(f"  Skipped (active): {skipped_active}")
    print(f"  Skipped (no coords): {skipped_coords}")
    print(f"  Skipped (no/bad state): {skipped_state}")

    if candidates:
        states = {}
        for c in candidates:
            st = c.get('state', 'UNK')
            states[st] = states.get(st, 0) + 1
        top_states = dict(sorted(states.items(), key=lambda x: -x[1])[:10])
        print(f"  Top states: {top_states}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(candidates)} BRAC military sites")
        for c in candidates[:10]:
            print(f"  {c['source_record_id']} {c['state']} {c['name'][:50]} ({c.get('acreage'):.0f} acres)" if c.get('acreage') else
                  f"  {c['source_record_id']} {c['state']} {c['name'][:50]}")
        return

    if not candidates:
        print("\nNo BRAC/closed bases found. This may indicate the ArcGIS endpoint")
        print("doesn't have a STATUS field distinguishing active from closed bases.")
        print("Consider manually maintaining a BRAC base list.")
        return

    # Step 3: Insert
    print(f"\n[Step 3] Inserting {len(candidates)} sites...")
    created = 0
    errors = 0

    all_keys = set()
    for rec in candidates:
        all_keys.update(rec.keys())

    for i in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[i:i + BATCH_SIZE]
        normalized = [{k: rec.get(k) for k in all_keys} for rec in batch]

        try:
            supabase_request(
                'POST', 'grid_dc_sites', normalized,
                {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
            )
            created += len(batch)
        except Exception:
            for rec in normalized:
                try:
                    supabase_request(
                        'POST', 'grid_dc_sites', [rec],
                        {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
                    )
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Error: {e2}")

        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  Progress: {min(i + BATCH_SIZE, len(candidates))}/{len(candidates)} ({created} ok, {errors} err)")

    print(f"\n  Created: {created}, Errors: {errors}")

    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print("\nDone!")


if __name__ == '__main__':
    main()

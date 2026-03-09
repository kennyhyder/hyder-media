#!/usr/bin/env python3
"""
Expand GridScout datacenter inventory by merging PeeringDB and OSM sources.
Target: grid_datacenters table

Phase 1: PeeringDB (free API, no auth) — US datacenter/colocation facilities
Phase 2: OSM Overpass API (free) — telecom=data_center + man_made=data_centre
Phase 3: Dedup against existing records + cross-source dedup + insert net new

Usage:
  python3 -u scripts/ingest-dc-inventory.py              # Full run
  python3 -u scripts/ingest-dc-inventory.py --dry-run    # Preview without inserting
"""

import os
import sys
import json
import math
import time
import re
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'dc_inventory')

PEERINGDB_API = "https://www.peeringdb.com/api"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass query: both telecom=data_center AND man_made=data_centre tags
OVERPASS_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  nwr["telecom"="data_center"](area.us);
  nwr["man_made"="data_centre"](area.us);
  nwr["building"="data_center"](area.us);
  nwr["building"="data_centre"](area.us);
);
out center tags;
"""


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


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', ''):
        return None
    return s[:max_len] if len(s) > max_len else s


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def normalize_name(name):
    """Normalize datacenter name for dedup comparison."""
    if not name:
        return ''
    s = name.lower().strip()
    # Remove common suffixes/prefixes
    for remove in ['data center', 'data centre', 'datacenter', 'datacentre',
                    'dc', 'facility', 'campus', 'building', 'bldg',
                    'inc', 'inc.', 'llc', 'corp', 'corporation', 'co.']:
        s = s.replace(remove, '')
    # Remove punctuation and extra whitespace
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def haversine_m(lat1, lon1, lat2, lon2):
    """Distance in meters between two lat/lng points."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def classify_dc_type(operator):
    """Classify datacenter type from operator name."""
    if not operator:
        return None
    op_lower = operator.lower()
    if any(h in op_lower for h in ['amazon', 'aws', 'google', 'microsoft', 'azure',
                                     'meta', 'facebook', 'apple', 'oracle']):
        return 'hyperscale'
    if any(c in op_lower for c in ['equinix', 'digital realty', 'coresite', 'cyrusone',
                                    'qts', 'switch', 'databank', 'flexential',
                                    'tierpoint', 'cologix', 'datacenter', 'vantage',
                                    'stack', 'aligned', 'compass']):
        return 'colocation'
    return 'enterprise'


# State bounding boxes for coordinate-to-state lookup
STATE_BOUNDS = {
    'AL': (30.2, -88.5, 35.0, -84.9), 'AK': (51.2, -180.0, 71.4, -130.0),
    'AZ': (31.3, -114.8, 37.0, -109.0), 'AR': (33.0, -94.6, 36.5, -89.6),
    'CA': (32.5, -124.5, 42.0, -114.1), 'CO': (36.9, -109.1, 41.0, -102.0),
    'CT': (41.0, -73.7, 42.1, -71.8), 'DE': (38.4, -75.8, 39.8, -75.0),
    'DC': (38.8, -77.1, 39.0, -76.9), 'FL': (24.5, -87.6, 31.0, -80.0),
    'GA': (30.4, -85.6, 35.0, -80.8), 'HI': (18.9, -160.3, 22.2, -154.8),
    'ID': (42.0, -117.2, 49.0, -111.0), 'IL': (36.9, -91.5, 42.5, -87.0),
    'IN': (37.8, -88.1, 41.8, -84.8), 'IA': (40.4, -96.6, 43.5, -90.1),
    'KS': (37.0, -102.1, 40.0, -94.6), 'KY': (36.5, -89.6, 39.1, -82.0),
    'LA': (28.9, -94.0, 33.0, -89.0), 'ME': (43.0, -71.1, 47.5, -66.9),
    'MD': (37.9, -79.5, 39.7, -75.0), 'MA': (41.2, -73.5, 42.9, -69.9),
    'MI': (41.7, -90.4, 48.3, -82.4), 'MN': (43.5, -97.2, 49.4, -89.5),
    'MS': (30.2, -91.7, 35.0, -88.1), 'MO': (36.0, -95.8, 40.6, -89.1),
    'MT': (44.4, -116.1, 49.0, -104.0), 'NE': (40.0, -104.1, 43.0, -95.3),
    'NV': (35.0, -120.0, 42.0, -114.0), 'NH': (42.7, -72.6, 45.3, -71.0),
    'NJ': (38.9, -75.6, 41.4, -73.9), 'NM': (31.3, -109.1, 37.0, -103.0),
    'NY': (40.5, -79.8, 45.0, -71.9), 'NC': (33.8, -84.3, 36.6, -75.5),
    'ND': (45.9, -104.1, 49.0, -96.6), 'OH': (38.4, -84.8, 42.0, -80.5),
    'OK': (33.6, -103.0, 37.0, -94.4), 'OR': (42.0, -124.6, 46.3, -116.5),
    'PA': (39.7, -80.5, 42.3, -74.7), 'RI': (41.1, -71.9, 42.0, -71.1),
    'SC': (32.0, -83.4, 35.2, -78.5), 'SD': (42.5, -104.1, 46.0, -96.4),
    'TN': (34.9, -90.3, 36.7, -81.6), 'TX': (25.8, -106.7, 36.5, -93.5),
    'UT': (37.0, -114.1, 42.0, -109.0), 'VT': (42.7, -73.4, 45.0, -71.5),
    'VA': (36.5, -83.7, 39.5, -75.2), 'WA': (45.5, -124.8, 49.0, -116.9),
    'WV': (37.2, -82.6, 40.6, -77.7), 'WI': (42.5, -92.9, 47.1, -86.2),
    'WY': (41.0, -111.1, 45.0, -104.1),
}

US_STATES = {
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


def coords_to_state(lat, lng):
    """Simple point-in-bounding-box state lookup."""
    for state, (s, w, n, e) in STATE_BOUNDS.items():
        if s <= lat <= n and w <= lng <= e:
            return state
    return None


# ─── Phase 1: PeeringDB ────────────────────────────────────────────────────────

def fetch_peeringdb():
    """Fetch all US datacenter facilities from PeeringDB API."""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache_path = os.path.join(DATA_DIR, 'peeringdb_fac.json')

    # Use cache if < 7 days old
    if os.path.exists(cache_path):
        age_days = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age_days < 7:
            print(f"  Using cached PeeringDB data ({age_days:.1f} days old)")
            with open(cache_path, 'r') as f:
                return json.load(f)

    print("  Querying PeeringDB API for US facilities...")
    url = f"{PEERINGDB_API}/fac?country=US&limit=10000"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0 (datacenter-research)')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode())
                with open(cache_path, 'w') as f:
                    json.dump(result, f)
                return result
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                time.sleep(10 * (attempt + 1))

    return None


def parse_peeringdb(data):
    """Parse PeeringDB facility response into datacenter records."""
    if not data or 'data' not in data:
        return []

    records = []
    for fac in data['data']:
        fac_id = fac.get('id')
        name = safe_str(fac.get('name'))
        org_name = safe_str(fac.get('org_name'))
        city = safe_str(fac.get('city'))
        state = safe_str(fac.get('state'))
        zipcode = safe_str(fac.get('zipcode'))
        lat = safe_float(fac.get('latitude'))
        lng = safe_float(fac.get('longitude'))
        website = safe_str(fac.get('website'))
        address = safe_str(fac.get('address1'))

        if not lat or not lng:
            continue

        # Skip if outside US bounds
        if lat < 18 or lat > 72 or lng < -180 or lng > -66:
            continue

        # Normalize state
        if state and len(state) > 2:
            state = US_STATES.get(state, state)
        if not state or len(state) != 2:
            state = coords_to_state(lat, lng)
        if not state:
            continue

        state = state.upper()

        # Classify type from org name
        dc_type = classify_dc_type(org_name) or 'colocation'

        source_id = f"peeringdb_{fac_id}"

        records.append({
            'source_record_id': source_id,
            'name': name or (f"{org_name} Facility" if org_name else f"PeeringDB Fac {fac_id}"),
            'operator': org_name,
            'city': city,
            'state': state,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'capacity_mw': None,
            'sqft': None,
            'dc_type': dc_type,
            'year_built': None,
        })

    return records


# ─── Phase 2: OSM Overpass ──────────────────────────────────────────────────────

def fetch_osm():
    """Download datacenter data from OSM Overpass API."""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache_path = os.path.join(DATA_DIR, 'osm_dc_inventory.json')

    # Use cache if < 7 days old
    if os.path.exists(cache_path):
        age_days = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age_days < 7:
            print(f"  Using cached OSM data ({age_days:.1f} days old)")
            with open(cache_path, 'r') as f:
                return json.load(f)

    print("  Querying Overpass API (may take 30-60s)...")
    post_data = urllib.parse.urlencode({'data': OVERPASS_QUERY}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=post_data)
    req.add_header('User-Agent', 'GridScout/1.0 (datacenter-research)')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read().decode())
                with open(cache_path, 'w') as f:
                    json.dump(result, f)
                return result
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                time.sleep(15 * (attempt + 1))

    return None


def parse_osm(data):
    """Parse Overpass API response into datacenter records."""
    if not data or 'elements' not in data:
        return []

    records = []
    seen_osm_ids = set()

    for elem in data['elements']:
        osm_id = elem.get('id')
        if osm_id in seen_osm_ids:
            continue
        seen_osm_ids.add(osm_id)

        tags = elem.get('tags', {})
        osm_type = elem.get('type', 'node')

        # Get coordinates (use center for ways/relations)
        if osm_type == 'node':
            lat = elem.get('lat')
            lng = elem.get('lon')
        else:
            center = elem.get('center', {})
            lat = center.get('lat')
            lng = center.get('lon')

        if not lat or not lng:
            continue

        # Skip non-US
        if lat < 18 or lat > 72 or lng < -180 or lng > -66:
            continue

        name = safe_str(tags.get('name'))
        operator = safe_str(tags.get('operator'))
        city = safe_str(tags.get('addr:city'))
        state = safe_str(tags.get('addr:state'))

        if not state:
            state = coords_to_state(lat, lng)
        if not state:
            continue

        if state and len(state) > 2:
            state = US_STATES.get(state, state[:2].upper())

        dc_type = classify_dc_type(operator)

        source_id = f"osm_dc_{osm_type[0]}{osm_id}"

        records.append({
            'source_record_id': source_id,
            'name': name or (f"{operator} DC" if operator else f"Datacenter OSM-{osm_id}"),
            'operator': operator,
            'city': city,
            'state': state,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'capacity_mw': None,
            'sqft': None,
            'dc_type': dc_type,
            'year_built': None,
        })

    return records


# ─── Phase 3: Dedup + Insert ────────────────────────────────────────────────────

def load_existing():
    """Load all existing grid_datacenters records for dedup."""
    records = []
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_datacenters?select=id,source_record_id,name,operator,city,state,latitude,longitude,dc_type&limit=1000&offset={offset}'
        )
        if not result:
            break
        records.extend(result)
        if len(result) < 1000:
            break
        offset += 1000
    return records


def is_duplicate(new_rec, existing_records):
    """Check if new_rec is a duplicate of any existing record.

    Matches by:
    1. Normalized name similarity (same state + similar name)
    2. Proximity: <500m apart

    Returns the matched existing record if duplicate, else None.
    """
    new_lat = new_rec['latitude']
    new_lng = new_rec['longitude']
    new_name_norm = normalize_name(new_rec.get('name', ''))
    new_state = new_rec.get('state', '')

    for ex in existing_records:
        ex_lat = float(ex.get('latitude', 0) or 0)
        ex_lng = float(ex.get('longitude', 0) or 0)

        if not ex_lat or not ex_lng:
            continue

        # Quick bounding box check (~5km) before expensive haversine
        if abs(new_lat - ex_lat) > 0.05 or abs(new_lng - ex_lng) > 0.05:
            continue

        dist = haversine_m(new_lat, new_lng, ex_lat, ex_lng)

        # Proximity match: <500m
        if dist < 500:
            return ex

        # Name similarity match: same state + substantial name overlap
        if new_state and new_state == ex.get('state', ''):
            ex_name_norm = normalize_name(ex.get('name', ''))
            if new_name_norm and ex_name_norm:
                # Check if one name is a substring of the other, or high word overlap
                if new_name_norm in ex_name_norm or ex_name_norm in new_name_norm:
                    return ex
                # Word overlap check
                new_words = set(new_name_norm.split())
                ex_words = set(ex_name_norm.split())
                if new_words and ex_words:
                    overlap = len(new_words & ex_words)
                    total = min(len(new_words), len(ex_words))
                    if total > 0 and overlap / total >= 0.6 and overlap >= 2:
                        return ex

    return None


def dedup_new_against_new(records):
    """Remove duplicates within the new records list (PeeringDB vs OSM overlap)."""
    kept = []
    for rec in records:
        match = is_duplicate(rec, kept)
        if match:
            # Merge: if new record has better data, update the kept record
            if not match.get('operator') and rec.get('operator'):
                match['operator'] = rec['operator']
            if not match.get('city') and rec.get('city'):
                match['city'] = rec['city']
            if not match.get('dc_type') and rec.get('dc_type'):
                match['dc_type'] = rec['dc_type']
            continue
        kept.append(rec)
    return kept


def build_update_patches(new_records, existing_records):
    """Find existing records that can be enriched with data from new records."""
    patches = []
    remaining = []

    for rec in new_records:
        match = is_duplicate(rec, existing_records)
        if match:
            # Check if new record has fields the existing one lacks
            patch = {}
            ex_id = match['id']
            if not match.get('operator') and rec.get('operator'):
                patch['operator'] = rec['operator']
            if not match.get('city') and rec.get('city'):
                patch['city'] = rec['city']
            if not match.get('dc_type') and rec.get('dc_type'):
                patch['dc_type'] = rec['dc_type']
            if patch:
                patches.append((ex_id, patch))
        else:
            remaining.append(rec)

    return remaining, patches


def get_or_create_source(name, url, description):
    """Get or create a data source entry."""
    ds = supabase_request('GET', f'grid_data_sources?name=eq.{name}&select=id')
    if ds:
        return ds[0]['id']
    result = supabase_request('POST', 'grid_data_sources', [{
        'name': name,
        'url': url,
        'description': description,
    }], {'Prefer': 'return=representation'})
    return result[0]['id'] if result else None


def main():
    print("=" * 60)
    print("GridScout DC Inventory Expansion (PeeringDB + OSM)")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # ─── Phase 1: PeeringDB ─────────────────────────────────────────────
    print("\n--- Phase 1: PeeringDB Facilities ---")
    pdb_data = fetch_peeringdb()
    if not pdb_data:
        print("ERROR: Could not fetch PeeringDB data")
        pdb_records = []
    else:
        pdb_records = parse_peeringdb(pdb_data)
        print(f"  {len(pdb_records)} US facility records parsed from PeeringDB")

    # ─── Phase 2: OSM Overpass ──────────────────────────────────────────
    print("\n--- Phase 2: OSM Overpass Datacenters ---")
    osm_data = fetch_osm()
    if not osm_data:
        print("ERROR: Could not fetch OSM data")
        osm_records = []
    else:
        total_elements = len(osm_data.get('elements', []))
        print(f"  {total_elements} total OSM elements")
        osm_records = parse_osm(osm_data)
        print(f"  {len(osm_records)} US datacenter records parsed from OSM")

    if not pdb_records and not osm_records:
        print("\nNo data from either source. Exiting.")
        sys.exit(1)

    # ─── Phase 3: Dedup + Insert ────────────────────────────────────────
    print("\n--- Phase 3: Deduplication ---")

    # Combine all new records
    all_new = pdb_records + osm_records
    print(f"  Total new candidates: {len(all_new)} ({len(pdb_records)} PeeringDB + {len(osm_records)} OSM)")

    # Cross-source dedup (PeeringDB vs OSM)
    all_new = dedup_new_against_new(all_new)
    cross_dedup = (len(pdb_records) + len(osm_records)) - len(all_new)
    print(f"  After cross-source dedup: {len(all_new)} ({cross_dedup} duplicates between PeeringDB/OSM)")

    # Load existing DB records
    print("\n  Loading existing grid_datacenters...")
    existing = load_existing()
    print(f"  {len(existing)} existing records in DB")

    # Filter by source_record_id first (fast exact match)
    existing_ids = {r['source_record_id'] for r in existing if r.get('source_record_id')}
    id_filtered = [r for r in all_new if r['source_record_id'] not in existing_ids]
    id_skipped = len(all_new) - len(id_filtered)
    print(f"  Skipped {id_skipped} by source_record_id match")

    # Spatial + name dedup against existing
    net_new, patches = build_update_patches(id_filtered, existing)
    print(f"  Spatial/name dedup removed: {len(id_filtered) - len(net_new)}")
    print(f"  Enrichment patches for existing records: {len(patches)}")
    print(f"  Net new records to insert: {len(net_new)}")

    # Summary stats
    pdb_new = sum(1 for r in net_new if r['source_record_id'].startswith('peeringdb_'))
    osm_new = sum(1 for r in net_new if r['source_record_id'].startswith('osm_dc_'))
    print(f"\n  Net new breakdown: {pdb_new} PeeringDB + {osm_new} OSM")

    states = {}
    for r in net_new:
        s = r.get('state', '??')
        states[s] = states.get(s, 0) + 1
    print(f"\n  Net new by state (top 15):")
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
        print(f"    {s}: {c}")

    operators = {}
    for r in net_new:
        o = r.get('operator') or 'Unknown'
        operators[o] = operators.get(o, 0) + 1
    print(f"\n  Net new by operator (top 15):")
    for o, c in sorted(operators.items(), key=lambda x: -x[1])[:15]:
        print(f"    {o}: {c}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(net_new)} records and apply {len(patches)} patches.")
        return

    # ─── Get/create data sources ────────────────────────────────────────
    pdb_ds_id = get_or_create_source(
        'peeringdb_dc',
        'https://www.peeringdb.com/',
        'PeeringDB US datacenter/colocation facilities'
    )
    osm_ds_id = get_or_create_source(
        'osm_dc_inventory',
        'https://wiki.openstreetmap.org/wiki/Tag:telecom%3Ddata_center',
        'OSM datacenter facilities (telecom=data_center + man_made=data_centre)'
    )

    # ─── Apply enrichment patches to existing records ───────────────────
    if patches:
        print(f"\n  Applying {len(patches)} enrichment patches...")
        patch_ok = 0
        patch_err = 0
        for ex_id, patch in patches:
            try:
                supabase_request('PATCH', f'grid_datacenters?id=eq.{ex_id}', patch)
                patch_ok += 1
            except Exception as e:
                patch_err += 1
                if patch_err <= 5:
                    print(f"    Patch error: {e}")
        print(f"    {patch_ok} patched, {patch_err} errors")

    # ─── Insert net new records ─────────────────────────────────────────
    print(f"\n  Inserting {len(net_new)} new records...")
    now = datetime.now(timezone.utc).isoformat()

    for r in net_new:
        if r['source_record_id'].startswith('peeringdb_') and pdb_ds_id:
            r['data_source_id'] = pdb_ds_id
        elif r['source_record_id'].startswith('osm_dc_') and osm_ds_id:
            r['data_source_id'] = osm_ds_id
        r['created_at'] = now

    created = 0
    errors = 0
    for i in range(0, len(net_new), BATCH_SIZE):
        batch = net_new[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_datacenters', batch, {'Prefer': 'return=minimal'})
            created += len(batch)
            if created % 200 == 0 or i + BATCH_SIZE >= len(net_new):
                print(f"    Inserted {created}/{len(net_new)}...")
        except Exception as e:
            print(f"    Batch error at {i}: {e}")
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_datacenters', [rec], {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"    Record error ({rec['source_record_id']}): {e2}")

    # ─── Update data source counts ─────────────────────────────────────
    total_in_db = len(existing) + created
    for ds_id in [pdb_ds_id, osm_ds_id]:
        if ds_id:
            try:
                supabase_request('PATCH', f'grid_data_sources?id=eq.{ds_id}', {
                    'last_import': now,
                })
            except Exception:
                pass

    print(f"\n{'=' * 60}")
    print(f"DC Inventory Expansion Complete")
    print(f"  PeeringDB fetched: {len(pdb_records)}")
    print(f"  OSM fetched: {len(osm_records)}")
    print(f"  Cross-source duplicates: {cross_dedup}")
    print(f"  Already in DB (source_record_id): {id_skipped}")
    print(f"  Spatial/name duplicates: {len(id_filtered) - len(net_new)}")
    print(f"  Enrichment patches applied: {len(patches)}")
    print(f"  Net new inserted: {created}")
    print(f"  Errors: {errors}")
    print(f"  Total in grid_datacenters: {total_in_db}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

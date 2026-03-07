#!/usr/bin/env python3
"""
Ingest US datacenter locations into GridScout.
Source: PNNL IM3 Datacenter Atlas (Zenodo archive), with hardcoded fallback.
Target: grid_datacenters table

Attempts to download the PNNL IM3 datacenter dataset from Zenodo. If download
fails, uses a hardcoded list of ~200 major US datacenter facilities compiled
from public sources (operator websites, press releases, industry reports).

Usage:
  python3 -u scripts/ingest-pnnl-dc.py              # Download + ingest
  python3 -u scripts/ingest-pnnl-dc.py --dry-run    # Preview without inserting
  python3 -u scripts/ingest-pnnl-dc.py --fallback   # Force use of hardcoded fallback data
"""

import os
import sys
import json
import csv
import time
import math
import io
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

# Primary: Zenodo archive of PNNL IM3 datacenter data
ZENODO_URL = "https://zenodo.org/records/8343012/files/us_datacenters.csv"
# Alternate URLs to try
ALTERNATE_URLS = [
    "https://zenodo.org/api/records/8343012/files/us_datacenters.csv/content",
    "https://zenodo.org/record/8343012/files/us_datacenters.csv",
]

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'pnnl_dc')
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
    if not s or s.lower() in ('none', 'null', 'n/a', 'unknown', ''):
        return None
    return s[:max_len] if len(s) > max_len else s


GPKG_PATH = '/tmp/pnnl_dc.gpkg'


def parse_geopackage(gpkg_path):
    """Parse PNNL IM3 GeoPackage (SQLite) into datacenter records."""
    records = []
    conn = sqlite3.connect(gpkg_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    for layer in ('point', 'building', 'campus'):
        cur.execute(f'SELECT COUNT(*) FROM "{layer}"')
        count = cur.fetchone()[0]
        print(f"  {layer}: {count} records")

        cur.execute(f'SELECT * FROM "{layer}"')
        for row in cur.fetchall():
            lat = row['lat']
            lon = row['lon']
            if not lat or not lon:
                continue

            state = row['state_abb']
            if not state or len(state) != 2:
                continue

            name = safe_str(row['name'])
            operator = safe_str(row['operator'])
            sqft = safe_float(row['sqft'])
            dc_id = row['id'] or ''

            # Classify dc_type from operator name
            dc_type = None
            if operator:
                op_lower = operator.lower()
                if any(h in op_lower for h in ['amazon', 'aws', 'google', 'microsoft', 'azure', 'meta', 'facebook', 'apple', 'oracle']):
                    dc_type = 'hyperscale'
                elif any(c in op_lower for c in ['equinix', 'digital realty', 'coresite', 'cyrusone', 'qts', 'switch', 'databank']):
                    dc_type = 'colocation'
                else:
                    dc_type = 'enterprise'

            source_id = f"pnnl_gpkg_{layer[0]}_{dc_id}" if dc_id else f"pnnl_gpkg_{layer[0]}_{len(records)}"

            records.append({
                'source_record_id': source_id,
                'name': name or (f"{operator} DC" if operator else f"Datacenter {dc_id}"),
                'operator': operator,
                'city': None,  # GeoPackage has county but not city
                'state': state,
                'latitude': round(lat, 6),
                'longitude': round(lon, 6),
                'capacity_mw': None,
                'sqft': int(sqft) if sqft else None,
                'dc_type': dc_type,
                'year_built': None,
            })

    conn.close()
    return records


def try_download_pnnl():
    """Attempt to download PNNL IM3 datacenter CSV from Zenodo."""
    os.makedirs(DATA_DIR, exist_ok=True)
    csv_path = os.path.join(DATA_DIR, 'us_datacenters.csv')

    if os.path.exists(csv_path):
        size_kb = os.path.getsize(csv_path) / 1024
        if size_kb > 1:
            print(f"  Using cached CSV ({size_kb:.1f} KB)")
            return csv_path

    urls_to_try = [ZENODO_URL] + ALTERNATE_URLS
    for url in urls_to_try:
        print(f"  Trying: {url}")
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0 (datacenter-research)')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                if len(data) < 100:
                    print(f"    Response too small ({len(data)} bytes), skipping")
                    continue
                # Verify it looks like CSV
                text = data.decode('utf-8', errors='replace')
                if ',' in text[:500] and '\n' in text[:500]:
                    with open(csv_path, 'wb') as f:
                        f.write(data)
                    print(f"    Downloaded {len(data) / 1024:.1f} KB")
                    return csv_path
                else:
                    print(f"    Response doesn't look like CSV, skipping")
        except Exception as e:
            print(f"    Failed: {e}")

    return None


def parse_pnnl_csv(csv_path):
    """Parse PNNL IM3 datacenter CSV into records."""
    records = []
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        print(f"  CSV columns: {cols}")

        for row in reader:
            # Try common column name patterns
            name = (safe_str(row.get('name')) or safe_str(row.get('Name'))
                    or safe_str(row.get('facility_name')) or safe_str(row.get('FACILITY_NAME')))
            operator = (safe_str(row.get('operator')) or safe_str(row.get('Operator'))
                        or safe_str(row.get('company')) or safe_str(row.get('Company'))
                        or safe_str(row.get('owner')) or safe_str(row.get('Owner')))
            city = (safe_str(row.get('city')) or safe_str(row.get('City'))
                    or safe_str(row.get('CITY')))
            state = (safe_str(row.get('state')) or safe_str(row.get('State'))
                     or safe_str(row.get('STATE')))
            lat = safe_float(row.get('latitude') or row.get('Latitude')
                             or row.get('lat') or row.get('LAT') or row.get('y'))
            lng = safe_float(row.get('longitude') or row.get('Longitude')
                             or row.get('lon') or row.get('lng') or row.get('LON') or row.get('x'))
            capacity = safe_float(row.get('capacity_mw') or row.get('Capacity_MW')
                                  or row.get('power_mw') or row.get('MW'))
            sqft = safe_float(row.get('sqft') or row.get('square_feet')
                              or row.get('SqFt') or row.get('area_sqft'))
            dc_type = (safe_str(row.get('dc_type')) or safe_str(row.get('type'))
                       or safe_str(row.get('Type')) or safe_str(row.get('facility_type')))
            year = safe_float(row.get('year_built') or row.get('Year')
                              or row.get('year') or row.get('YEAR'))

            if not lat or not lng:
                continue

            # Normalize state to 2-letter abbreviation
            if state and len(state) > 2:
                state = STATE_ABBREVS.get(state.upper(), state)

            idx = len(records) + 1
            source_id = f"pnnl_{idx}"
            if name:
                # Make a more stable source_record_id from name
                name_key = name.lower().replace(' ', '_')[:40]
                source_id = f"pnnl_{name_key}_{state or 'XX'}"

            records.append({
                'source_record_id': source_id,
                'name': name,
                'operator': operator,
                'city': city,
                'state': state,
                'latitude': lat,
                'longitude': lng,
                'capacity_mw': capacity,
                'sqft': int(sqft) if sqft else None,
                'dc_type': dc_type,
                'year_built': int(year) if year and 1900 < year < 2030 else None,
            })

    return records


def get_fallback_datacenters():
    """Hardcoded list of ~200 major US datacenter facilities from public sources."""
    # Format: (name, operator, city, state, lat, lng, dc_type)
    facilities = [
        # Northern Virginia / Ashburn (largest DC market in the world)
        ("Ashburn Campus", "Equinix", "Ashburn", "VA", 39.0438, -77.4874, "colocation"),
        ("DC1-DC15 Ashburn", "Equinix", "Ashburn", "VA", 39.0415, -77.4890, "colocation"),
        ("ACC2 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0385, -77.4920, "colocation"),
        ("ACC3 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0370, -77.4935, "colocation"),
        ("ACC4 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0360, -77.4950, "colocation"),
        ("ACC5 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0350, -77.4940, "colocation"),
        ("ACC6 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0340, -77.4960, "colocation"),
        ("ACC7 Ashburn", "Digital Realty", "Ashburn", "VA", 39.0390, -77.4890, "colocation"),
        ("VA1 Ashburn", "CoreSite", "Reston", "VA", 38.9530, -77.3450, "colocation"),
        ("VA2 Reston", "CoreSite", "Reston", "VA", 38.9510, -77.3480, "colocation"),
        ("VA3 Reston", "CoreSite", "Reston", "VA", 38.9550, -77.3430, "colocation"),
        ("QTS Ashburn", "QTS", "Ashburn", "VA", 39.0460, -77.4830, "colocation"),
        ("QTS Richmond", "QTS", "Richmond", "VA", 37.5407, -77.4360, "colocation"),
        ("IAD1 Manassas", "Amazon (AWS)", "Manassas", "VA", 38.7520, -77.4760, "hyperscale"),
        ("IAD2 Ashburn", "Amazon (AWS)", "Ashburn", "VA", 39.0470, -77.4700, "hyperscale"),
        ("Ashburn Campus", "Microsoft Azure", "Ashburn", "VA", 39.0450, -77.4850, "hyperscale"),
        ("CyrusOne Sterling", "CyrusOne", "Sterling", "VA", 39.0060, -77.4090, "colocation"),
        ("CyrusOne Ashburn", "CyrusOne", "Ashburn", "VA", 39.0440, -77.4860, "colocation"),
        ("Aligned Ashburn", "Aligned", "Ashburn", "VA", 39.0480, -77.4800, "colocation"),
        ("CloudHQ Ashburn", "CloudHQ", "Ashburn", "VA", 39.0425, -77.4910, "colocation"),
        ("Iron Mountain VA-1", "Iron Mountain", "Manassas", "VA", 38.7480, -77.4750, "colocation"),
        ("NTT Ashburn", "NTT", "Ashburn", "VA", 39.0490, -77.4820, "colocation"),
        ("Lumen Ashburn", "Lumen", "Ashburn", "VA", 39.0400, -77.4900, "colocation"),
        ("T5 Ashburn", "T5", "Ashburn", "VA", 39.0410, -77.4880, "colocation"),
        ("vXchnge Ashburn", "vXchnge", "Ashburn", "VA", 39.0430, -77.4870, "colocation"),

        # Dallas-Fort Worth
        ("DFW1 Richardson", "Equinix", "Richardson", "TX", 32.9483, -96.7299, "colocation"),
        ("DFW2 Richardson", "Equinix", "Richardson", "TX", 32.9470, -96.7310, "colocation"),
        ("DFW3 Plano", "Equinix", "Plano", "TX", 33.0198, -96.6989, "colocation"),
        ("DFW10 Irving", "Digital Realty", "Irving", "TX", 32.8684, -96.9500, "colocation"),
        ("DFW11 Garland", "Digital Realty", "Garland", "TX", 32.9126, -96.6389, "colocation"),
        ("DFW14 Dallas", "Digital Realty", "Dallas", "TX", 32.7767, -96.7970, "colocation"),
        ("CyrusOne Carrollton", "CyrusOne", "Carrollton", "TX", 32.9537, -96.8903, "colocation"),
        ("CyrusOne Allen", "CyrusOne", "Allen", "TX", 33.1032, -96.6706, "colocation"),
        ("QTS Irving", "QTS", "Irving", "TX", 32.8620, -96.9420, "colocation"),
        ("DataBank DFW1", "DataBank", "Dallas", "TX", 32.8060, -96.8150, "colocation"),
        ("DataBank DFW2", "DataBank", "Plano", "TX", 33.0130, -96.7080, "colocation"),
        ("Stream Dallas", "Stream", "Dallas", "TX", 32.8500, -96.8500, "colocation"),
        ("Flexential Dallas", "Flexential", "Dallas", "TX", 32.8100, -96.8400, "colocation"),
        ("TierPoint Dallas", "TierPoint", "Dallas", "TX", 32.7900, -96.8300, "colocation"),
        ("Aligned Dallas", "Aligned", "Plano", "TX", 33.0200, -96.7500, "colocation"),
        ("Compass Dallas", "Compass Datacenters", "Dallas", "TX", 32.8300, -96.8600, "colocation"),

        # Chicago
        ("CH1 Chicago", "Equinix", "Chicago", "IL", 41.8854, -87.6365, "colocation"),
        ("CH2 Chicago", "Equinix", "Chicago", "IL", 41.8830, -87.6340, "colocation"),
        ("CH3 Elk Grove", "Equinix", "Elk Grove Village", "IL", 42.0045, -87.9708, "colocation"),
        ("CH4 Chicago", "Equinix", "Chicago", "IL", 41.8870, -87.6320, "colocation"),
        ("350 E Cermak", "Digital Realty", "Chicago", "IL", 41.8527, -87.6182, "colocation"),
        ("CyrusOne Aurora", "CyrusOne", "Aurora", "IL", 41.7606, -88.3201, "colocation"),
        ("QTS Chicago", "QTS", "Chicago", "IL", 41.8650, -87.7520, "colocation"),
        ("CoreSite CH1", "CoreSite", "Chicago", "IL", 41.8820, -87.6380, "colocation"),
        ("DataBank Chicago", "DataBank", "Chicago", "IL", 41.8780, -87.6400, "colocation"),
        ("TierPoint Chicago", "TierPoint", "Chicago", "IL", 41.8800, -87.6360, "colocation"),
        ("Aligned Elk Grove", "Aligned", "Elk Grove Village", "IL", 42.0060, -87.9730, "colocation"),

        # Phoenix / Mesa / Chandler
        ("PH1 Phoenix", "Equinix", "Phoenix", "AZ", 33.4484, -112.0740, "colocation"),
        ("PH2 Mesa", "Equinix", "Mesa", "AZ", 33.4152, -111.8315, "colocation"),
        ("PHX1 Phoenix", "Digital Realty", "Phoenix", "AZ", 33.4700, -111.9750, "colocation"),
        ("CyrusOne Chandler", "CyrusOne", "Chandler", "AZ", 33.3062, -111.8413, "colocation"),
        ("QTS Phoenix", "QTS", "Mesa", "AZ", 33.3930, -111.8100, "colocation"),
        ("Stream Goodyear", "Stream", "Goodyear", "AZ", 33.4350, -112.3580, "colocation"),
        ("Aligned Phoenix", "Aligned", "Phoenix", "AZ", 33.4500, -112.0800, "colocation"),
        ("Microsoft Phoenix", "Microsoft Azure", "Goodyear", "AZ", 33.4400, -112.3600, "hyperscale"),
        ("Apple Mesa", "Apple", "Mesa", "AZ", 33.3800, -111.7200, "hyperscale"),
        ("Compass Phoenix", "Compass Datacenters", "Mesa", "AZ", 33.4100, -111.8200, "colocation"),
        ("EdgeCore Mesa", "EdgeCore", "Mesa", "AZ", 33.3900, -111.8000, "colocation"),

        # Silicon Valley / San Jose / Santa Clara
        ("SV1 San Jose", "Equinix", "San Jose", "CA", 37.3861, -121.9301, "colocation"),
        ("SV2 San Jose", "Equinix", "San Jose", "CA", 37.3840, -121.9280, "colocation"),
        ("SV5 San Jose", "Equinix", "San Jose", "CA", 37.3870, -121.9320, "colocation"),
        ("SV10 Santa Clara", "Equinix", "Santa Clara", "CA", 37.3520, -121.9550, "colocation"),
        ("SV11 Sunnyvale", "Equinix", "Sunnyvale", "CA", 37.3882, -122.0133, "colocation"),
        ("Digital Realty Santa Clara", "Digital Realty", "Santa Clara", "CA", 37.3500, -121.9600, "colocation"),
        ("CoreSite SV1", "CoreSite", "Santa Clara", "CA", 37.3530, -121.9530, "colocation"),
        ("CoreSite SV2", "CoreSite", "Milpitas", "CA", 37.4320, -121.9000, "colocation"),
        ("CoreSite SV7", "CoreSite", "Santa Clara", "CA", 37.3540, -121.9520, "colocation"),
        ("QTS Santa Clara", "QTS", "Santa Clara", "CA", 37.3510, -121.9540, "colocation"),
        ("CyrusOne San Jose", "CyrusOne", "San Jose", "CA", 37.3900, -121.9350, "colocation"),

        # New York / New Jersey
        ("NY1 Secaucus", "Equinix", "Secaucus", "NJ", 40.7895, -74.0565, "colocation"),
        ("NY2 Secaucus", "Equinix", "Secaucus", "NJ", 40.7890, -74.0580, "colocation"),
        ("NY4 Secaucus", "Equinix", "Secaucus", "NJ", 40.7880, -74.0570, "colocation"),
        ("NY5 Secaucus", "Equinix", "Secaucus", "NJ", 40.7885, -74.0560, "colocation"),
        ("NY6 Secaucus", "Equinix", "Secaucus", "NJ", 40.7870, -74.0575, "colocation"),
        ("NY7 Secaucus", "Equinix", "Secaucus", "NJ", 40.7875, -74.0555, "colocation"),
        ("NY9 Manhattan", "Equinix", "New York", "NY", 40.7280, -74.0060, "colocation"),
        ("111 8th Ave", "Google", "New York", "NY", 40.7411, -74.0026, "hyperscale"),
        ("60 Hudson St", "Digital Realty", "New York", "NY", 40.7200, -74.0080, "colocation"),
        ("32 Avenue of the Americas", "Digital Realty", "New York", "NY", 40.7220, -74.0050, "colocation"),
        ("CoreSite NY1", "CoreSite", "Secaucus", "NJ", 40.7900, -74.0590, "colocation"),
        ("QTS Piscataway", "QTS", "Piscataway", "NJ", 40.5366, -74.4594, "colocation"),
        ("DataBank NJ", "DataBank", "Piscataway", "NJ", 40.5350, -74.4600, "colocation"),
        ("CyrusOne NJ", "CyrusOne", "Jersey City", "NJ", 40.7282, -74.0776, "colocation"),
        ("Digital Realty NJ1", "Digital Realty", "Piscataway", "NJ", 40.5370, -74.4580, "colocation"),

        # Atlanta
        ("AT1 Atlanta", "Equinix", "Atlanta", "GA", 33.7490, -84.3880, "colocation"),
        ("AT2 Marietta", "Equinix", "Marietta", "GA", 33.9526, -84.5499, "colocation"),
        ("AT3 Lithia Springs", "Equinix", "Lithia Springs", "GA", 33.7730, -84.6430, "colocation"),
        ("QTS Atlanta Metro", "QTS", "Atlanta", "GA", 33.7600, -84.4200, "colocation"),
        ("QTS Suwanee", "QTS", "Suwanee", "GA", 34.0515, -84.0713, "colocation"),
        ("Digital Realty Atlanta", "Digital Realty", "Atlanta", "GA", 33.7510, -84.3850, "colocation"),
        ("CyrusOne Atlanta", "CyrusOne", "Lithia Springs", "GA", 33.7750, -84.6450, "colocation"),
        ("DataBank Atlanta", "DataBank", "Atlanta", "GA", 33.7520, -84.3900, "colocation"),
        ("Switch Atlanta", "Switch", "Lithia Springs", "GA", 33.7700, -84.6400, "colocation"),
        ("TierPoint Atlanta", "TierPoint", "Atlanta", "GA", 33.7550, -84.3920, "colocation"),

        # Denver / Colorado
        ("DE1 Denver", "Equinix", "Denver", "CO", 39.7392, -104.9903, "colocation"),
        ("DE2 Denver", "Equinix", "Denver", "CO", 39.7370, -104.9880, "colocation"),
        ("CoreSite DE1", "CoreSite", "Denver", "CO", 39.7380, -104.9890, "colocation"),
        ("CyrusOne Aurora", "CyrusOne", "Aurora", "CO", 39.7294, -104.8319, "colocation"),
        ("Digital Realty Denver", "Digital Realty", "Denver", "CO", 39.7400, -104.9920, "colocation"),
        ("Flexential Denver", "Flexential", "Denver", "CO", 39.7410, -104.9930, "colocation"),
        ("DataBank Denver", "DataBank", "Denver", "CO", 39.7360, -104.9870, "colocation"),
        ("TierPoint Denver", "TierPoint", "Denver", "CO", 39.7350, -104.9860, "colocation"),

        # Seattle / Pacific Northwest
        ("SE2 Seattle", "Equinix", "Seattle", "WA", 47.6062, -122.3321, "colocation"),
        ("SE3 Seattle", "Equinix", "Seattle", "WA", 47.6050, -122.3340, "colocation"),
        ("Digital Realty Westin", "Digital Realty", "Seattle", "WA", 47.6100, -122.3350, "colocation"),
        ("CoreSite SE1", "CoreSite", "Seattle", "WA", 47.6040, -122.3300, "colocation"),
        ("CyrusOne Seattle", "CyrusOne", "Tukwila", "WA", 47.4740, -122.2610, "colocation"),
        ("DataBank Seattle", "DataBank", "Seattle", "WA", 47.6080, -122.3330, "colocation"),
        ("Flexential Tukwila", "Flexential", "Tukwila", "WA", 47.4750, -122.2600, "colocation"),

        # Portland, OR
        ("Equinix Portland", "Equinix", "Portland", "OR", 45.5152, -122.6784, "colocation"),
        ("Digital Realty Portland", "Digital Realty", "Portland", "OR", 45.5130, -122.6800, "colocation"),
        ("Flexential Portland", "Flexential", "Hillsboro", "OR", 45.5229, -122.9898, "colocation"),
        ("DataBank Portland", "DataBank", "Portland", "OR", 45.5140, -122.6790, "colocation"),
        ("Compass Portland", "Compass Datacenters", "Hillsboro", "OR", 45.5200, -122.9850, "colocation"),

        # Hillsboro, OR (major DC cluster)
        ("Intel Ronler Acres", "Intel", "Hillsboro", "OR", 45.5345, -122.9190, "enterprise"),
        ("Aligned Hillsboro", "Aligned", "Hillsboro", "OR", 45.5250, -122.9900, "colocation"),
        ("Stack Infrastructure Hillsboro", "Stack Infrastructure", "Hillsboro", "OR", 45.5270, -122.9870, "colocation"),

        # Quincy, WA (Microsoft/Yahoo mega campus)
        ("Columbia Data Center", "Microsoft Azure", "Quincy", "WA", 47.2343, -119.8526, "hyperscale"),
        ("Quincy Campus", "Microsoft Azure", "Quincy", "WA", 47.2330, -119.8540, "hyperscale"),
        ("Yahoo Quincy", "Yahoo", "Quincy", "WA", 47.2350, -119.8510, "hyperscale"),
        ("Sabey Quincy", "Sabey", "Quincy", "WA", 47.2360, -119.8500, "colocation"),
        ("NTT Quincy", "NTT", "Quincy", "WA", 47.2340, -119.8530, "colocation"),

        # Council Bluffs, IA (Google mega campus)
        ("Google Council Bluffs 1", "Google", "Council Bluffs", "IA", 41.2619, -95.8608, "hyperscale"),
        ("Google Council Bluffs 2", "Google", "Council Bluffs", "IA", 41.2630, -95.8620, "hyperscale"),
        ("Google Council Bluffs 3", "Google", "Council Bluffs", "IA", 41.2640, -95.8630, "hyperscale"),
        ("Meta Council Bluffs", "Meta", "Council Bluffs", "IA", 41.2600, -95.8580, "hyperscale"),

        # Papillion / Omaha, NE (Meta mega campus)
        ("Meta Papillion", "Meta", "Papillion", "NE", 41.1544, -96.0422, "hyperscale"),
        ("Meta Sarpy County", "Meta", "Papillion", "NE", 41.1530, -96.0440, "hyperscale"),

        # Columbus, OH
        ("QTS Columbus", "QTS", "Columbus", "OH", 39.9612, -82.9988, "colocation"),
        ("CyrusOne Columbus", "CyrusOne", "Columbus", "OH", 39.9630, -82.9970, "colocation"),
        ("Flexential Columbus", "Flexential", "Columbus", "OH", 39.9600, -83.0000, "colocation"),
        ("Google New Albany", "Google", "New Albany", "OH", 40.0812, -82.8087, "hyperscale"),
        ("Amazon (AWS) Columbus", "Amazon (AWS)", "Columbus", "OH", 39.9650, -82.9960, "hyperscale"),
        ("Meta New Albany", "Meta", "New Albany", "OH", 40.0800, -82.8100, "hyperscale"),

        # Salt Lake City, UT
        ("Equinix Salt Lake City", "Equinix", "Salt Lake City", "UT", 40.7608, -111.8910, "colocation"),
        ("C7 Data Centers SLC", "C7 Data Centers", "Salt Lake City", "UT", 40.7590, -111.8920, "colocation"),
        ("Flexential SLC", "Flexential", "Salt Lake City", "UT", 40.7600, -111.8930, "colocation"),
        ("DataBank SLC", "DataBank", "Salt Lake City", "UT", 40.7620, -111.8900, "colocation"),
        ("Meta Eagle Mountain", "Meta", "Eagle Mountain", "UT", 40.3141, -112.0000, "hyperscale"),

        # Las Vegas, NV
        ("LV1 Las Vegas", "Equinix", "Las Vegas", "NV", 36.1699, -115.1398, "colocation"),
        ("Switch SuperNAP", "Switch", "Las Vegas", "NV", 36.0400, -115.0800, "colocation"),
        ("Switch Citadel", "Switch", "North Las Vegas", "NV", 36.2700, -115.1200, "colocation"),
        ("Digital Realty Las Vegas", "Digital Realty", "Las Vegas", "NV", 36.1720, -115.1380, "colocation"),

        # Sacramento, CA
        ("Equinix Sacramento", "Equinix", "Sacramento", "CA", 38.5816, -121.4944, "colocation"),
        ("CyrusOne Sacramento", "CyrusOne", "Sacramento", "CA", 38.5800, -121.4960, "colocation"),

        # Austin, TX
        ("DataBank Austin", "DataBank", "Austin", "TX", 30.2672, -97.7431, "colocation"),
        ("Flexential Austin", "Flexential", "Austin", "TX", 30.2660, -97.7440, "colocation"),
        ("TierPoint Austin", "TierPoint", "Austin", "TX", 30.2680, -97.7420, "colocation"),

        # San Antonio, TX
        ("CyrusOne San Antonio", "CyrusOne", "San Antonio", "TX", 29.4241, -98.4936, "colocation"),
        ("Rackspace Castle", "Rackspace", "San Antonio", "TX", 29.5091, -98.5733, "enterprise"),
        ("Microsoft San Antonio", "Microsoft Azure", "San Antonio", "TX", 29.4260, -98.4920, "hyperscale"),
        ("NSA Texas Cryptologic Center", "NSA", "San Antonio", "TX", 29.5200, -98.5800, "enterprise"),

        # Los Angeles
        ("LA1 Los Angeles", "Equinix", "Los Angeles", "CA", 34.0407, -118.2468, "colocation"),
        ("LA2 El Segundo", "Equinix", "El Segundo", "CA", 33.9192, -118.4165, "colocation"),
        ("LA3 El Segundo", "Equinix", "El Segundo", "CA", 33.9180, -118.4180, "colocation"),
        ("LA4 Los Angeles", "Equinix", "Los Angeles", "CA", 34.0390, -118.2480, "colocation"),
        ("CoreSite LA1", "CoreSite", "Los Angeles", "CA", 34.0400, -118.2490, "colocation"),
        ("CoreSite LA2", "CoreSite", "Los Angeles", "CA", 34.0410, -118.2500, "colocation"),
        ("Digital Realty 600 W 7th", "Digital Realty", "Los Angeles", "CA", 34.0480, -118.2570, "colocation"),

        # Reno, NV
        ("Switch Tahoe Reno", "Switch", "Reno", "NV", 39.5296, -119.8138, "colocation"),
        ("Apple Reno", "Apple", "Reno", "NV", 39.5250, -119.7800, "hyperscale"),
        ("Google Storey County", "Google", "Reno", "NV", 39.5600, -119.5100, "hyperscale"),
        ("Tesla Gigafactory", "Tesla", "Sparks", "NV", 39.5380, -119.4430, "enterprise"),

        # The Dalles, OR (Google)
        ("Google The Dalles", "Google", "The Dalles", "OR", 45.5946, -121.1787, "hyperscale"),
        ("Google The Dalles 2", "Google", "The Dalles", "OR", 45.5960, -121.1770, "hyperscale"),

        # Prineville, OR (Meta/Apple)
        ("Meta Prineville", "Meta", "Prineville", "OR", 44.2986, -120.7336, "hyperscale"),
        ("Apple Prineville", "Apple", "Prineville", "OR", 44.2970, -120.7350, "hyperscale"),

        # Des Moines, IA / Altoona (Meta)
        ("Meta Altoona", "Meta", "Altoona", "IA", 41.6440, -93.4600, "hyperscale"),
        ("Microsoft West Des Moines", "Microsoft Azure", "West Des Moines", "IA", 41.5770, -93.7110, "hyperscale"),

        # Lenoir, NC (Google)
        ("Google Lenoir", "Google", "Lenoir", "NC", 35.9137, -81.5390, "hyperscale"),

        # Forest City, NC (Apple)
        ("Apple Maiden", "Apple", "Maiden", "NC", 35.5762, -81.3816, "hyperscale"),

        # Pryor, OK (Google)
        ("Google Pryor", "Google", "Pryor", "OK", 36.3085, -95.3161, "hyperscale"),

        # Fort Worth, TX (Meta)
        ("Meta Fort Worth", "Meta", "Fort Worth", "TX", 32.7555, -97.3308, "hyperscale"),

        # Midlothian, TX (Google)
        ("Google Midlothian", "Google", "Midlothian", "TX", 32.4820, -96.9940, "hyperscale"),

        # Loudoun County, VA (additional)
        ("Amazon (AWS) Loudoun", "Amazon (AWS)", "Sterling", "VA", 39.0062, -77.4286, "hyperscale"),
        ("Microsoft Boydton", "Microsoft Azure", "Boydton", "VA", 36.6674, -78.3875, "hyperscale"),

        # Minneapolis
        ("Equinix Minneapolis", "Equinix", "Minneapolis", "MN", 44.9778, -93.2650, "colocation"),
        ("CyrusOne Minneapolis", "CyrusOne", "Shakopee", "MN", 44.7731, -93.5145, "colocation"),
        ("DataBank Minneapolis", "DataBank", "Minneapolis", "MN", 44.9760, -93.2670, "colocation"),
        ("Flexential Minneapolis", "Flexential", "Chanhassen", "MN", 44.8622, -93.5305, "colocation"),

        # Houston, TX
        ("Equinix Houston", "Equinix", "Houston", "TX", 29.7604, -95.3698, "colocation"),
        ("CyrusOne Houston West", "CyrusOne", "Houston", "TX", 29.7750, -95.6400, "colocation"),
        ("QTS Houston", "QTS", "Houston", "TX", 29.7620, -95.3680, "colocation"),
        ("Digital Realty Houston", "Digital Realty", "Houston", "TX", 29.7590, -95.3710, "colocation"),
        ("DataBank Houston", "DataBank", "Houston", "TX", 29.7610, -95.3700, "colocation"),

        # Boston / New England
        ("BO1 Boston", "Equinix", "Boston", "MA", 42.3601, -71.0589, "colocation"),
        ("CoreSite BO1", "CoreSite", "Somerville", "MA", 42.3876, -71.0995, "colocation"),
        ("CyrusOne Waltham", "CyrusOne", "Waltham", "MA", 42.3765, -71.2356, "colocation"),
        ("Digital Realty Boston", "Digital Realty", "Boston", "MA", 42.3580, -71.0600, "colocation"),

        # Miami / South Florida
        ("MI1 Miami", "Equinix", "Miami", "FL", 25.7617, -80.1918, "colocation"),
        ("NAP of the Americas", "Equinix", "Miami", "FL", 25.7600, -80.1930, "colocation"),
        ("Digital Realty Miami", "Digital Realty", "Coral Gables", "FL", 25.7213, -80.2684, "colocation"),
        ("CyrusOne Miami", "CyrusOne", "Miami", "FL", 25.7630, -80.1900, "colocation"),

        # Washington DC / Maryland
        ("DC1 Ashburn", "Equinix", "Ashburn", "VA", 39.0420, -77.4895, "colocation"),
        ("Digital Realty Laurel", "Digital Realty", "Laurel", "MD", 39.0993, -76.8483, "colocation"),
        ("QTS Suitland", "QTS", "Suitland", "MD", 38.8484, -76.9251, "colocation"),

        # Albuquerque, NM (Meta)
        ("Meta Los Lunas", "Meta", "Los Lunas", "NM", 34.8061, -106.7333, "hyperscale"),

        # Raleigh-Durham, NC
        ("Digital Realty Raleigh", "Digital Realty", "Raleigh", "NC", 35.7796, -78.6382, "colocation"),
        ("Flexential Raleigh", "Flexential", "Raleigh", "NC", 35.7780, -78.6400, "colocation"),
        ("QTS Raleigh", "QTS", "Raleigh", "NC", 35.7810, -78.6360, "colocation"),

        # Kansas City
        ("Digital Realty Kansas City", "Digital Realty", "Kansas City", "MO", 39.0997, -94.5786, "colocation"),
        ("DataBank Kansas City", "DataBank", "Kansas City", "MO", 39.0980, -94.5800, "colocation"),
        ("TierPoint Kansas City", "TierPoint", "Kansas City", "MO", 39.1010, -94.5770, "colocation"),

        # St. Louis
        ("Digital Realty St Louis", "Digital Realty", "St. Louis", "MO", 38.6270, -90.1994, "colocation"),
        ("TierPoint St Louis", "TierPoint", "St. Louis", "MO", 38.6250, -90.2010, "colocation"),

        # Indianapolis
        ("Flexential Indianapolis", "Flexential", "Indianapolis", "IN", 39.7684, -86.1581, "colocation"),
        ("TierPoint Indianapolis", "TierPoint", "Indianapolis", "IN", 39.7670, -86.1590, "colocation"),
        ("Lifeline Data Centers", "Lifeline", "Indianapolis", "IN", 39.7700, -86.1560, "colocation"),

        # Pittsburgh
        ("Flexential Pittsburgh", "Flexential", "Pittsburgh", "PA", 40.4406, -79.9959, "colocation"),
        ("TierPoint Pittsburgh", "TierPoint", "Pittsburgh", "PA", 40.4390, -79.9970, "colocation"),

        # Nashville, TN
        ("DataBank Nashville", "DataBank", "Nashville", "TN", 36.1627, -86.7816, "colocation"),
        ("TierPoint Nashville", "TierPoint", "Nashville", "TN", 36.1610, -86.7830, "colocation"),

        # San Francisco Bay Area (additional)
        ("Equinix Fremont", "Equinix", "Fremont", "CA", 37.5485, -121.9886, "colocation"),

        # Cheyenne, WY (Microsoft + NCAR)
        ("Microsoft Cheyenne", "Microsoft Azure", "Cheyenne", "WY", 41.1400, -104.8202, "hyperscale"),
        ("NCAR Cheyenne", "NCAR-Wyoming", "Cheyenne", "WY", 41.1380, -104.8220, "enterprise"),

        # Lubbock, TX (Aligned)
        ("Aligned Lubbock", "Aligned", "Lubbock", "TX", 33.5779, -101.8552, "colocation"),

        # Scottsdale, AZ
        ("DataBank Scottsdale", "DataBank", "Scottsdale", "AZ", 33.4942, -111.9261, "colocation"),

        # Tampa Bay, FL
        ("Digital Realty Tampa", "Digital Realty", "Tampa", "FL", 27.9506, -82.4572, "colocation"),
        ("CyrusOne Tampa", "CyrusOne", "Tampa", "FL", 27.9490, -82.4590, "colocation"),
    ]

    records = []
    for i, (name, operator, city, state, lat, lng, dc_type) in enumerate(facilities):
        name_key = name.lower().replace(' ', '_').replace('/', '_')[:40]
        source_id = f"fallback_{name_key}_{state}"
        records.append({
            'source_record_id': source_id,
            'name': name,
            'operator': operator,
            'city': city,
            'state': state,
            'latitude': lat,
            'longitude': lng,
            'capacity_mw': None,
            'sqft': None,
            'dc_type': dc_type,
            'year_built': None,
        })

    return records


def get_existing_ids():
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_datacenters?select=source_record_id&limit=1000&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    return existing


STATE_ABBREVS = {
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'DISTRICT OF COLUMBIA': 'DC', 'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI',
    'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA',
    'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME',
    'MARYLAND': 'MD', 'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN',
    'MISSISSIPPI': 'MS', 'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE',
    'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM',
    'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH',
    'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX',
    'UTAH': 'UT', 'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA',
    'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY',
}


def main():
    print("=" * 60)
    print("GridScout PNNL IM3 Datacenter Ingestion")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    force_fallback = '--fallback' in sys.argv

    records = []

    if not force_fallback:
        # Try GeoPackage first (local file from PNNL IM3)
        if os.path.exists(GPKG_PATH):
            print(f"\nParsing PNNL IM3 GeoPackage ({os.path.getsize(GPKG_PATH)/1024:.0f} KB)...")
            records = parse_geopackage(GPKG_PATH)
            print(f"  {len(records)} total records from GeoPackage")
        else:
            # Try downloading PNNL CSV from Zenodo
            print("\nAttempting PNNL IM3 datacenter download...")
            csv_path = try_download_pnnl()
            if csv_path:
                print("Parsing PNNL CSV...")
                records = parse_pnnl_csv(csv_path)
                print(f"  {len(records)} records from PNNL data")

    if not records:
        print("\nUsing hardcoded fallback datacenter data...")
        records = get_fallback_datacenters()
        print(f"  {len(records)} facilities from fallback list")

    # Summary
    states = {}
    types = {}
    operators = {}
    for r in records:
        s = r.get('state', '??')
        states[s] = states.get(s, 0) + 1
        t = r.get('dc_type', 'unknown')
        types[t] = types.get(t, 0) + 1
        o = r.get('operator', 'Unknown')
        operators[o] = operators.get(o, 0) + 1

    print(f"\nBy state (top 10):")
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:10]:
        print(f"  {s}: {c}")
    print(f"\nBy type:")
    for t, c in sorted(types.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")
    print(f"\nBy operator (top 15):")
    for o, c in sorted(operators.items(), key=lambda x: -x[1])[:15]:
        print(f"  {o}: {c}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(records)} datacenter records.")
        return

    # Get data source ID
    ds = supabase_request('GET', 'grid_data_sources?name=eq.pnnl_im3&select=id')
    data_source_id = ds[0]['id'] if ds else None
    if not data_source_id:
        print("WARNING: pnnl_im3 data source not found. Creating...")
        result = supabase_request('POST', 'grid_data_sources', [{
            'name': 'pnnl_im3',
            'url': 'https://im3data.pnnl.gov/',
            'description': 'PNNL IM3 US Datacenter Atlas + public fallback data',
        }], {'Prefer': 'return=representation'})
        if result:
            data_source_id = result[0]['id']

    # Load existing records
    print("\nLoading existing records...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing records in DB")

    # Add data_source_id and filter existing
    new_records = []
    for r in records:
        if r['source_record_id'] in existing_ids:
            continue
        if data_source_id:
            r['data_source_id'] = data_source_id
        r['created_at'] = datetime.now(timezone.utc).isoformat()
        new_records.append(r)

    print(f"  {len(new_records)} new records to insert ({len(records) - len(new_records)} already exist)")

    # Insert in batches
    created = 0
    errors = 0
    for i in range(0, len(new_records), BATCH_SIZE):
        batch = new_records[i:i + BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_datacenters', batch, {'Prefer': 'return=minimal'})
            created += len(batch)
        except Exception as e:
            print(f"  Batch error: {e}")
            for rec in batch:
                try:
                    supabase_request('POST', 'grid_datacenters', [rec], {'Prefer': 'return=minimal'})
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Record error ({rec['source_record_id']}): {e2}")

    # Update data source
    if data_source_id:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{data_source_id}', {
            'record_count': len(existing_ids) + created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"PNNL Datacenter Ingestion Complete")
    print(f"  Created: {created}")
    print(f"  Skipped (existing): {len(records) - len(new_records)}")
    print(f"  Errors: {errors}")
    print(f"  Total in DB: {len(existing_ids) + created}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

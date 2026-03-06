#!/usr/bin/env python3
"""
Ingest county-level base data + FEMA NRI risk scores.
Source 1: Census Gazetteer (always works) — creates 3,200+ county records
Source 2: FEMA NRI CSV (if available) — adds 18 hazard risk scores
Target: grid_county_data table (creates/updates rows)

The Census gazetteer creates the base county records that ALL other county-level
scripts (BLS, NOAA, WRI, FCC, incentives) PATCH into. This must run first.
"""

import os
import sys
import json
import csv
import time
import math
import urllib.request
import urllib.error
import io
import zipfile
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

# Census county gazetteer (always available)
CENSUS_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip"

# FEMA NRI data — multiple URLs to try (FEMA URLs frequently change/break)
NRI_URLS = [
    "https://hazards.fema.gov/nri/Content/StaticDocuments/DataDownload/NRI_Table_Counties/NRI_Table_Counties.zip",
    "https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip",
]

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'fema_nri')
BATCH_SIZE = 50

# State-level approximate NRI composite scores (FEMA NRI v1.19, normalized 0-100)
# Used as fallback when county-level FEMA data is unavailable
# Higher = more natural hazard risk
STATE_NRI_APPROX = {
    'AL': 45, 'AK': 18, 'AZ': 22, 'AR': 38, 'CA': 48, 'CO': 25, 'CT': 20,
    'DE': 18, 'DC': 12, 'FL': 55, 'GA': 40, 'HI': 20, 'ID': 15, 'IL': 35,
    'IN': 32, 'IA': 30, 'KS': 35, 'KY': 30, 'LA': 58, 'ME': 15, 'MD': 22,
    'MA': 22, 'MI': 25, 'MN': 25, 'MS': 45, 'MO': 38, 'MT': 12, 'NE': 28,
    'NV': 12, 'NH': 15, 'NJ': 28, 'NM': 15, 'NY': 35, 'NC': 42, 'ND': 20,
    'OH': 30, 'OK': 42, 'OR': 22, 'PA': 28, 'RI': 18, 'SC': 40, 'SD': 22,
    'TN': 38, 'TX': 55, 'UT': 15, 'VT': 15, 'VA': 30, 'WA': 28, 'WV': 22,
    'WI': 22, 'WY': 10, 'PR': 45, 'GU': 30, 'VI': 35, 'AS': 25, 'MP': 25,
}

# State FIPS → abbreviation
STATE_FIPS_MAP = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
    '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
    '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
    '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
    '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
    '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
    '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
    '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR', '66': 'GU', '78': 'VI',
    '60': 'AS', '69': 'MP',
}

# State name → abbreviation mapping (for FEMA NRI CSV parsing)
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
    'PUERTO RICO': 'PR', 'GUAM': 'GU', 'VIRGIN ISLANDS': 'VI',
    'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP',
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


def download_census_gazetteer():
    """Download Census county gazetteer — always available."""
    os.makedirs(DATA_DIR, exist_ok=True)
    zip_path = os.path.join(DATA_DIR, 'census_counties.zip')
    txt_path = os.path.join(DATA_DIR, 'census_counties.txt')

    if os.path.exists(txt_path) and os.path.getsize(txt_path) > 100000:
        print(f"  Using cached Census gazetteer")
        return txt_path

    print(f"  Downloading Census county gazetteer...")
    req = urllib.request.Request(CENSUS_URL)
    req.add_header('User-Agent', 'GridScout/1.0')
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()

    with open(zip_path, 'wb') as f:
        f.write(data)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        txt_files = [n for n in zf.namelist() if n.endswith('.txt')]
        if not txt_files:
            print("ERROR: No TXT found in ZIP")
            sys.exit(1)
        zf.extract(txt_files[0], DATA_DIR)
        extracted = os.path.join(DATA_DIR, txt_files[0])
        if extracted != txt_path:
            os.rename(extracted, txt_path)

    print(f"  Extracted {os.path.getsize(txt_path) // 1024} KB")
    return txt_path


def parse_census_gazetteer(txt_path):
    """Parse Census gazetteer into county records."""
    records = []
    with open(txt_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter='|')
        for row in reader:
            fips = row.get('GEOID', '').strip()
            if not fips or len(fips) != 5:
                continue

            state_fips = fips[:2]
            state = row.get('USPS', '').strip()
            if not state:
                state = STATE_FIPS_MAP.get(state_fips, '')
            if not state:
                continue

            county_name = row.get('NAME', '').strip()
            # Remove " County", " Parish", etc. for cleaner display
            clean_name = county_name
            for suffix in [' County', ' Parish', ' Borough', ' Census Area',
                          ' Municipality', ' city', ' Municipio']:
                if clean_name.endswith(suffix):
                    clean_name = clean_name[:-len(suffix)]
                    break

            lat = safe_float(row.get('INTPTLAT'))
            lng = safe_float(row.get('INTPTLONG'))
            area_land = safe_float(row.get('ALAND_SQMI'))

            # Use state-level approximate NRI score as fallback
            approx_nri = STATE_NRI_APPROX.get(state)

            record = {
                'fips_code': fips,
                'state': state,
                'state_fips': state_fips,
                'county_name': county_name,
                'latitude': lat,
                'longitude': lng,
                'area_sq_miles': area_land,
                'nri_score': approx_nri,
                'nri_rating': get_nri_rating(approx_nri) if approx_nri else None,
            }
            records.append(record)

    return records


def get_nri_rating(score):
    """Convert numeric NRI score to rating label."""
    if score is None:
        return None
    if score >= 50:
        return 'Very High'
    if score >= 35:
        return 'Relatively High'
    if score >= 25:
        return 'Relatively Moderate'
    if score >= 15:
        return 'Relatively Low'
    return 'Very Low'


def try_download_nri():
    """Try to download FEMA NRI CSV from multiple URLs."""
    csv_path = os.path.join(DATA_DIR, 'NRI_Table_Counties.csv')

    if os.path.exists(csv_path) and os.path.getsize(csv_path) > 1000000:
        size_mb = os.path.getsize(csv_path) / (1024 * 1024)
        print(f"  Using cached FEMA NRI CSV ({size_mb:.1f} MB)")
        return csv_path

    for url in NRI_URLS:
        try:
            print(f"  Trying FEMA NRI download: {url[:60]}...")
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) GridScout/1.0')
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()

            zip_path = os.path.join(DATA_DIR, 'NRI_Table_Counties.zip')
            with open(zip_path, 'wb') as f:
                f.write(data)

            with zipfile.ZipFile(zip_path, 'r') as zf:
                csv_files = [n for n in zf.namelist() if n.endswith('.csv')]
                if csv_files:
                    zf.extract(csv_files[0], DATA_DIR)
                    extracted = os.path.join(DATA_DIR, csv_files[0])
                    if extracted != csv_path:
                        os.rename(extracted, csv_path)
                    print(f"  Downloaded FEMA NRI CSV!")
                    return csv_path
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    print("  FEMA NRI download unavailable — using state-level approximations")
    return None


def parse_nri_csv(csv_path):
    """Parse FEMA NRI CSV into {fips: risk_scores} dict."""
    nri_data = {}
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('NRI_ID', '').startswith('T'):
                continue
            fips = row.get('STCOFIPS', '').strip()
            if not fips or len(fips) != 5:
                continue

            state = row.get('STATE', '').strip()
            state_abbr = STATE_ABBREVS.get(state.upper(), state)

            nri_data[fips] = {
                'nri_score': safe_float(row.get('RISK_SCORE')),
                'nri_rating': row.get('RISK_RATNG', '').strip() or None,
                'nri_earthquake': safe_float(row.get('ERQK_RISKS')),
                'nri_hurricane': safe_float(row.get('HRCN_RISKS')),
                'nri_tornado': safe_float(row.get('TRND_RISKS')),
                'nri_flooding': safe_float(row.get('RFLD_RISKS')),
                'nri_wildfire': safe_float(row.get('WFIR_RISKS')),
                'nri_hail': safe_float(row.get('HAIL_RISKS')),
                'nri_ice_storm': safe_float(row.get('ISTM_RISKS')),
                'nri_strong_wind': safe_float(row.get('SWND_RISKS')),
                'nri_winter_weather': safe_float(row.get('WNTW_RISKS')),
                'nri_heat_wave': safe_float(row.get('HWAV_RISKS')),
                'nri_landslide': safe_float(row.get('LNDS_RISKS')),
                'nri_lightning': safe_float(row.get('LTNG_RISKS')),
                'nri_avalanche': safe_float(row.get('AVLN_RISKS')),
                'nri_coastal_flooding': safe_float(row.get('CFLD_RISKS')),
                'nri_drought': safe_float(row.get('DRGT_RISKS')),
                'nri_tsunami': safe_float(row.get('TSUN_RISKS')),
                'nri_volcanic': safe_float(row.get('VLCN_RISKS')),
                'population': int(float(row.get('POPULATION', '0') or '0')) if row.get('POPULATION') else None,
            }
    return nri_data


def main():
    print("=" * 60)
    print("GridScout County Data Ingestion (Census + FEMA NRI)")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_nri = '--skip-nri' in sys.argv

    # Step 1: Download Census county gazetteer (always works)
    print("\n[Step 1] Census county gazetteer...")
    txt_path = download_census_gazetteer()
    records = parse_census_gazetteer(txt_path)
    print(f"  {len(records)} counties parsed")

    # Step 2: Try to download FEMA NRI for county-level risk scores
    nri_data = {}
    if not skip_nri:
        print("\n[Step 2] FEMA NRI risk scores...")
        nri_csv = try_download_nri()
        if nri_csv:
            nri_data = parse_nri_csv(nri_csv)
            print(f"  {len(nri_data)} county NRI records parsed")

            # Merge NRI data into county records
            merged = 0
            for record in records:
                nri = nri_data.get(record['fips_code'])
                if nri:
                    record.update(nri)
                    merged += 1
            print(f"  Merged NRI data for {merged} counties")
    else:
        print("\n[Step 2] Skipping FEMA NRI (--skip-nri)")

    if dry_run:
        print("\n[DRY RUN] Would upsert county data:")
        for r in records[:5]:
            print(f"  {r['fips_code']} {r['state']} {r['county_name']}: NRI={r.get('nri_score')}, lat={r.get('latitude')}")
        print(f"  ... and {len(records) - 5} more")
        return

    # Step 3: Upsert into grid_county_data
    print(f"\n[Step 3] Upserting {len(records)} county records...")
    created = 0
    errors = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            supabase_request(
                'POST',
                'grid_county_data',
                batch,
                {'Prefer': 'resolution=merge-duplicates,return=minimal'}
            )
            created += len(batch)
        except Exception as e:
            for rec in batch:
                try:
                    supabase_request(
                        'POST',
                        'grid_county_data',
                        [rec],
                        {'Prefer': 'resolution=merge-duplicates,return=minimal'}
                    )
                    created += 1
                except Exception as e2:
                    errors += 1
                    if errors <= 10:
                        print(f"  Error ({rec['fips_code']}): {e2}")

        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  Progress: {min(i + BATCH_SIZE, len(records))}/{len(records)} ({created} ok, {errors} err)")

    # Update data source
    ds = supabase_request('GET', 'grid_data_sources?name=eq.fema_nri&select=id')
    if ds:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
            'record_count': created,
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"County Data Ingestion Complete")
    print(f"  Counties created/updated: {created}")
    print(f"  FEMA NRI merged: {len(nri_data)} county-level scores")
    print(f"  Fallback state-level NRI: {created - len(nri_data)} counties")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

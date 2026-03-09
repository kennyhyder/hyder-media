#!/usr/bin/env python3
"""
Enrich grid_dc_sites with zone-level wholesale LMP data from all 7 ISOs.

Phase 1: Fetch 7-day Day-Ahead LMP from all 7 ISOs via gridstatus
  - CAISO (3 trading hubs), NYISO (15 zones), PJM (23 utility zones),
    MISO (regional hubs), ERCOT (hubs+zones), SPP (2 hubs), ISO-NE (9 zones)
  - Calculate average LMP per zone over 7-day period
  - Cache to grid/data/lmp_zone_prices.json

Phase 2: Map DC sites to LMP zones via state/lat/utility mapping tables

Phase 3: Update grid_dc_sites via psql
  - Add columns: lmp_zone TEXT, lmp_wholesale_mwh NUMERIC(8,2)
  - Keep energy_price_mwh as EIA retail for ALL sites (comparable baseline)
  - Set lmp_zone + lmp_wholesale_mwh for ISO-covered sites (~54K)

Usage:
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --dry-run
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --skip-download
  .venv/bin/python3.13 -u scripts/enrich-energy-prices.py --skip-download --dry-run

Must run from: /Users/kennyhyder/Desktop/hyder-media/grid/
Must use:      /Users/kennyhyder/Desktop/hyder-media/solar/.venv/bin/python3.13
"""

import os
import sys
import json
import time
import subprocess
from datetime import date, timedelta, datetime

# Set PJM API key BEFORE importing gridstatus (it reads env at import time)
os.environ['PJM_API_KEY'] = '6a35dfcd9b0b41e894e43bfa5dda1551'

# Add solar dir for .env.local
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'solar'))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local'))

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
CACHE_FILE = os.path.join(DATA_DIR, 'lmp_zone_prices.json')

PSQL_CMD = [
    'psql',
    '-h', 'aws-0-us-west-2.pooler.supabase.com',
    '-p', '6543',
    '-U', 'postgres.ilbovwnhrowvxjdkvrln',
    '-d', 'postgres',
]
PSQL_ENV = {**os.environ, 'PGPASSWORD': '#FsW7iqg%EYX&G3M'}

# EIA state-level average commercial electricity rates (cents/kWh)
# Source: EIA Electric Power Monthly, Table 5.6.a, 2024 annual averages
EIA_STATE_RATES_CENTS = {
    'AL': 12.73, 'AK': 22.18, 'AZ': 11.19, 'AR': 9.60, 'CA': 23.41,
    'CO': 11.48, 'CT': 20.38, 'DE': 11.79, 'DC': 13.04, 'FL': 11.54,
    'GA': 11.42, 'HI': 37.53, 'ID': 8.15, 'IL': 10.37, 'IN': 11.68,
    'IA': 13.11, 'KS': 11.89, 'KY': 10.12, 'LA': 9.93, 'ME': 17.96,
    'MD': 12.24, 'MA': 22.59, 'MI': 13.90, 'MN': 12.17, 'MS': 11.35,
    'MO': 10.80, 'MT': 10.87, 'NE': 10.62, 'NV': 9.75, 'NH': 19.24,
    'NJ': 14.05, 'NM': 11.33, 'NY': 17.62, 'NC': 10.00, 'ND': 10.42,
    'OH': 10.88, 'OK': 9.42, 'OR': 9.83, 'PA': 10.05, 'RI': 22.34,
    'SC': 10.84, 'SD': 11.89, 'TN': 11.08, 'TX': 10.28, 'UT': 9.28,
    'VT': 17.73, 'VA': 9.49, 'WA': 9.09, 'WV': 10.12, 'WI': 12.66,
    'WY': 9.79, 'PR': 24.00, 'GU': 30.00, 'VI': 35.00,
}

# ============================================================
# Zone mapping tables
# ============================================================

# CAISO: 3 trading hubs mapped by latitude
# NP15 = Northern CA (lat > 37), ZP26 = Central (36-37), SP15 = Southern (lat < 36)
CAISO_ZONES = {
    'NP15': {'lat_min': 37.0, 'lat_max': 90.0},
    'ZP26': {'lat_min': 36.0, 'lat_max': 37.0},
    'SP15': {'lat_min': -90.0, 'lat_max': 36.0},
}
CAISO_ZONE_KEYS = {
    'NP15': 'TH_NP15_GEN-APND',
    'ZP26': 'TH_ZP26_GEN-APND',
    'SP15': 'TH_SP15_GEN-APND',
}

# NYISO: 11 load zones mapped by region within NY state
NYISO_ZONE_STATE_MAP = {
    'WEST':      {'counties': None, 'lat_min': 42.0, 'lat_max': 44.0, 'lng_max': -77.5},
    'GENESE':    {'counties': None, 'lat_min': 42.5, 'lat_max': 44.0, 'lng_min': -77.5, 'lng_max': -76.5},
    'CENTRL':    {'counties': None, 'lat_min': 42.5, 'lat_max': 44.0, 'lng_min': -76.5, 'lng_max': -75.5},
    'NORTH':     {'counties': None, 'lat_min': 43.5, 'lat_max': 46.0, 'lng_min': -75.5},
    'MHK VL':    {'counties': None, 'lat_min': 41.5, 'lat_max': 43.0, 'lng_min': -75.0, 'lng_max': -73.5},
    'CAPITL':    {'counties': None, 'lat_min': 42.3, 'lat_max': 43.5, 'lng_min': -74.5, 'lng_max': -73.3},
    'HUD VL':    {'counties': None, 'lat_min': 41.0, 'lat_max': 42.3, 'lng_min': -74.5, 'lng_max': -73.3},
    'MILLWD':    {'counties': None, 'lat_min': 41.0, 'lat_max': 41.3, 'lng_min': -73.9, 'lng_max': -73.6},
    'DUNWOD':    {'counties': None, 'lat_min': 40.85, 'lat_max': 41.1, 'lng_min': -73.9, 'lng_max': -73.6},
    'N.Y.C.':    {'counties': None, 'lat_min': 40.4, 'lat_max': 40.95, 'lng_min': -74.3, 'lng_max': -73.6},
    'LONGIL':    {'counties': None, 'lat_min': 40.4, 'lat_max': 41.2, 'lng_min': -73.6, 'lng_max': -71.5},
}

# ISO-NE: zones by state abbreviation
ISONE_STATE_ZONE = {
    'CT': '.Z.CONNECTICUT',
    'ME': '.Z.MAINE',
    'NH': '.Z.NEWHAMPSHIRE',
    'RI': '.Z.RHODEISLAND',
    'VT': '.Z.VERMONT',
    'MA': '.Z.SEMASS',  # default MA zone; Boston/NEMA may differ
}

# PJM: utility zone -> state mapping (primary serving territory)
PJM_UTILITY_ZONES = {
    # Zone name -> list of (state, optional geographic qualifier)
    'PSEG':  ['NJ'],
    'PECO':  ['PA'],  # Philadelphia metro
    'PPL':   ['PA'],  # Central/Eastern PA
    'BGE':   ['MD'],
    'PEPCO': ['DC', 'MD'],
    'JCPL':  ['NJ'],
    'METED': ['PA'],
    'PENELEC': ['PA'],
    'AEP':   ['OH', 'WV', 'VA'],
    'DOM':   ['VA'],
    'COMED': ['IL'],
    'DPL':   ['DE', 'MD'],
    'APS':   ['OH', 'WV'],
    'DUKE':  ['OH', 'IN', 'KY', 'NC'],
    'ATSI':  ['OH'],
    'DEOK':  ['OH', 'KY'],
    'DAY':   ['OH'],
    'EKPC':  ['KY'],
    'OVEC':  ['OH', 'IN'],
    'DUQ':   ['PA'],
    'RECO':  ['NJ'],
    'AECO':  ['NJ'],
}
# Map PJM states to best-fit utility zone
PJM_STATE_TO_ZONE = {
    'IL': 'COMED',
    'OH': 'AEP',
    'PA': 'PECO',
    'NJ': 'PSEG',
    'MD': 'BGE',
    'VA': 'DOM',
    'DC': 'PEPCO',
    'DE': 'DPL',
    'WV': 'APS',
    'IN': 'DUKE',
    'KY': 'DUKE',
    'NC': 'DUKE',
    'MI': 'ATSI',  # PJM covers some of MI
}

# ERCOT: geographic regions by latitude/longitude within TX
ERCOT_ZONE_MAP = {
    'LZ_NORTH':   {'lat_min': 32.5, 'lat_max': 34.5, 'lng_min': -98.0, 'lng_max': -96.0},
    'LZ_HOUSTON': {'lat_min': 29.0, 'lat_max': 30.5, 'lng_min': -96.0, 'lng_max': -94.5},
    'LZ_SOUTH':   {'lat_min': 26.0, 'lat_max': 29.5, 'lng_min': -100.0, 'lng_max': -96.5},
    'LZ_WEST':    {'lat_min': 30.0, 'lat_max': 33.0, 'lng_min': -105.0, 'lng_max': -100.0},
}
# Fallback: if no zone matches, use HB_HOUSTON (largest load center)
ERCOT_DEFAULT_ZONE = 'LZ_HOUSTON'

# MISO: state -> regional hub mapping
MISO_STATE_HUB = {
    'IL': 'ILLINOIS.HUB',
    'IN': 'INDIANA.HUB',
    'MI': 'MICHIGAN.HUB',
    'WI': 'ILLINOIS.HUB',     # WI is in MISO North, close to IL hub
    'MN': 'MINN.HUB',
    'IA': 'MINN.HUB',         # IA in MISO Midwest
    'MO': 'ILLINOIS.HUB',     # MO borders IL hub
    'AR': 'ARKANSAS.HUB',
    'LA': 'LOUISIANA.HUB',
    'MS': 'MS.HUB',
    'TX': 'TEXAS.HUB',        # MISO TX (not ERCOT)
    'ND': 'MINN.HUB',
    'SD': 'MINN.HUB',
    'MT': 'MINN.HUB',
    'KY': 'INDIANA.HUB',
    'TN': 'MS.HUB',
}

# SPP: north/south split by latitude
SPP_LAT_SPLIT = 37.0  # North of 37° = SPPNORTH, south = SPPSOUTH


def run_psql(sql, timeout=120):
    """Execute SQL via psql."""
    result = subprocess.run(
        PSQL_CMD + ['-c', sql],
        env=PSQL_ENV,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result.stdout


def fetch_pjm_zones_direct(end_date, days=7):
    """Fetch PJM zone-level LMP via direct API (gridstatus 'zones' param is broken)."""
    import requests

    start = end_date - timedelta(days=days)
    print(f"\n  Fetching PJM zone-level LMP via direct API ({start} to {end_date})...")

    all_items = []
    d = start
    while d < end_date:
        e = d + timedelta(days=1)
        url = 'https://api.pjm.com/api/v1/da_hrl_lmps'
        params = {
            'fields': 'datetime_beginning_ept,pnode_name,type,total_lmp_da',
            'row_is_current': 'TRUE',
            'startRow': 1,
            'rowCount': 50000,
            'datetime_beginning_ept': f'{d.month:02d}/{d.day:02d}/{d.year} 00:00to{e.month:02d}/{e.day:02d}/{e.year} 00:00',
            'type': 'ZONE',
        }
        headers = {'Ocp-Apim-Subscription-Key': '6a35dfcd9b0b41e894e43bfa5dda1551'}

        for attempt in range(3):
            try:
                r = requests.get(url, params=params, headers=headers, timeout=30)
                if r.status_code == 429:
                    wait = 5 * (attempt + 1)
                    print(f"    Rate limited on {d}, waiting {wait}s...")
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                items = r.json().get('items', [])
                all_items.extend(items)
                print(f"    {d}: {len(items)} records")
                break
            except Exception as ex:
                if attempt < 2:
                    time.sleep(3)
                else:
                    print(f"    {d}: Failed after 3 attempts - {ex}")

        time.sleep(1)  # Rate limit courtesy
        d += timedelta(days=1)

    if not all_items:
        return None

    # Aggregate by zone
    zones = {}
    for item in all_items:
        name = item.get('pnode_name', 'unknown')
        lmp = item.get('total_lmp_da', 0)
        if name == 'PJM-RTO' or name == 'MID-ATL/APS':
            continue  # Skip aggregates
        zones.setdefault(name, []).append(lmp)

    zone_avgs = {}
    for name, vals in zones.items():
        zone_avgs[name] = round(sum(vals) / len(vals), 2)

    overall = sum(sum(v) for v in zones.values()) / sum(len(v) for v in zones.values())

    print(f"    Total: {len(all_items)} records, {len(zone_avgs)} zones, mean ${overall:.2f}/MWh")
    for z in sorted(zone_avgs, key=lambda x: zone_avgs[x]):
        print(f"      {z}: ${zone_avgs[z]:.2f}/MWh")

    return {
        'date_start': str(start),
        'date_end': str(end_date),
        'overall_mean': round(overall, 2),
        'zones': zone_avgs,
        'record_count': len(all_items),
        'fetched_at': datetime.now().isoformat(),
    }


def fetch_spp_lmp(iso_obj, end_date, days=7):
    """Fetch SPP LMP via get_lmp_day_ahead_hourly (SPP has no get_lmp)."""
    start = end_date - timedelta(days=days)
    print(f"\n  Fetching SPP Day-Ahead LMP ({start} to {end_date})...")

    try:
        lmp = iso_obj.get_lmp_day_ahead_hourly(date=str(start), end=str(end_date))
        if lmp is None or len(lmp) == 0:
            return None

        print(f"    Got {len(lmp)} records, {lmp['Location'].nunique()} locations")

        # Filter to hubs only
        hubs = lmp[lmp['Location Type'] == 'Hub']
        if len(hubs) == 0:
            print(f"    No hub data found")
            return None

        zone_avgs = {}
        avgs = hubs.groupby('Location')['LMP'].mean()
        for loc, val in avgs.items():
            zone_avgs[str(loc)] = round(float(val), 2)

        overall = float(hubs['LMP'].mean())
        print(f"    Hub mean: ${overall:.2f}/MWh, {len(zone_avgs)} hubs")
        for z in sorted(zone_avgs, key=lambda x: zone_avgs[x]):
            print(f"      {z}: ${zone_avgs[z]:.2f}/MWh")

        return {
            'date_start': str(start),
            'date_end': str(end_date),
            'overall_mean': round(overall, 2),
            'zones': zone_avgs,
            'record_count': len(hubs),
            'fetched_at': datetime.now().isoformat(),
        }
    except Exception as e:
        print(f"    ERROR: {type(e).__name__}: {str(e)[:300]}")
        return None


def fetch_lmp_7day(iso_name, iso_obj, end_date, days=7):
    """Fetch 7-day Day-Ahead LMP for an ISO. Returns zone averages dict or None."""
    start = end_date - timedelta(days=days)

    print(f"\n  Fetching {iso_name} Day-Ahead LMP ({start} to {end_date})...")

    try:
        if iso_name == 'ERCOT':
            # ERCOT: try latest (most reliable)
            lmp = iso_obj.get_lmp('latest')
        elif iso_name == 'NYISO':
            lmp = iso_obj.get_lmp(
                date=str(start), end=str(end_date),
                market='DAY_AHEAD_HOURLY',
                location_type='zone'
            )
        else:
            lmp = iso_obj.get_lmp(
                date=str(start), end=str(end_date),
                market='DAY_AHEAD_HOURLY'
            )

        if lmp is None or len(lmp) == 0:
            print(f"    No data returned")
            return None

        print(f"    Got {len(lmp)} records")
        if 'Location' in lmp.columns:
            print(f"    Locations: {lmp['Location'].nunique()} unique")
        if 'Location Type' in lmp.columns:
            print(f"    Location Types: {dict(lmp['Location Type'].value_counts())}")

        # Calculate zone averages
        zone_avgs = {}

        if 'Location' in lmp.columns and 'LMP' in lmp.columns:
            # Filter to relevant location types if available
            if 'Location Type' in lmp.columns:
                loc_types = lmp['Location Type'].unique()
                # Prefer: Trading Hub > Load Zone > Hub > Zone > Aggregate
                preferred = []
                for lt in ['Trading Hub', 'Load Zone', 'Hub', 'ZONE', 'Zone', 'Aggregate']:
                    if lt in loc_types:
                        preferred.append(lt)

                if preferred:
                    subset = lmp[lmp['Location Type'].isin(preferred)]
                    if len(subset) > 0:
                        avgs = subset.groupby('Location')['LMP'].mean()
                        for loc, val in avgs.items():
                            zone_avgs[str(loc)] = round(float(val), 2)

                # Also get all locations for completeness
                if not zone_avgs:
                    avgs = lmp.groupby('Location')['LMP'].mean()
                    for loc, val in avgs.items():
                        zone_avgs[str(loc)] = round(float(val), 2)
            else:
                avgs = lmp.groupby('Location')['LMP'].mean()
                for loc, val in avgs.items():
                    zone_avgs[str(loc)] = round(float(val), 2)

        overall = float(lmp['LMP'].mean()) if 'LMP' in lmp.columns else 0

        print(f"    Overall mean: ${overall:.2f}/MWh, {len(zone_avgs)} zones")

        # Show top/bottom zones
        if zone_avgs:
            sorted_zones = sorted(zone_avgs.items(), key=lambda x: x[1])
            if len(sorted_zones) > 6:
                print(f"    Cheapest: {sorted_zones[0][0]} ${sorted_zones[0][1]}/MWh")
                print(f"    Most expensive: {sorted_zones[-1][0]} ${sorted_zones[-1][1]}/MWh")

        return {
            'date_start': str(start),
            'date_end': str(end_date),
            'overall_mean': round(overall, 2),
            'zones': zone_avgs,
            'record_count': len(lmp),
            'fetched_at': datetime.now().isoformat(),
        }

    except Exception as e:
        print(f"    ERROR: {type(e).__name__}: {str(e)[:300]}")
        return None


def fetch_all_lmp():
    """Fetch 7-day LMP data from all 7 ISOs."""
    import gridstatus

    end_date = date.today() - timedelta(days=1)  # yesterday
    all_data = {}

    # --- PJM: Direct API (gridstatus 'zones' param is buggy) ---
    try:
        result = fetch_pjm_zones_direct(end_date)
        if result:
            all_data['PJM'] = result
    except Exception as e:
        print(f"    SKIPPING PJM — {type(e).__name__}: {str(e)[:200]}")

    # --- SPP: Use get_lmp_day_ahead_hourly (SPP has no get_lmp) ---
    try:
        spp_obj = gridstatus.SPP()
        result = fetch_spp_lmp(spp_obj, end_date)
        if result:
            all_data['SPP'] = result
    except Exception as e:
        print(f"    SKIPPING SPP — {type(e).__name__}: {str(e)[:200]}")

    # --- Standard ISOs via gridstatus get_lmp ---
    iso_configs = [
        ('CAISO',  gridstatus.CAISO),
        ('NYISO',  gridstatus.NYISO),
        ('MISO',   gridstatus.MISO),
        ('ERCOT',  gridstatus.Ercot),
        ('ISO-NE', gridstatus.ISONE),
    ]

    for iso_name, iso_cls in iso_configs:
        try:
            iso_obj = iso_cls()
            result = fetch_lmp_7day(iso_name, iso_obj, end_date)
            if result:
                all_data[iso_name] = result
            else:
                # Try shorter window
                print(f"    Retrying {iso_name} with 3-day window...")
                result = fetch_lmp_7day(iso_name, iso_obj, end_date, days=3)
                if result:
                    all_data[iso_name] = result
                else:
                    print(f"    SKIPPING {iso_name} — no data available")
        except Exception as e:
            print(f"    SKIPPING {iso_name} — {type(e).__name__}: {str(e)[:200]}")

    return all_data


def map_caiso_zone(lat):
    """Map a latitude to CAISO zone."""
    if lat >= 37.0:
        return 'NP15'
    elif lat >= 36.0:
        return 'ZP26'
    else:
        return 'SP15'


def map_nyiso_zone(lat, lng):
    """Map lat/lng to NYISO load zone."""
    # NYC metro
    if 40.4 <= lat <= 40.95 and -74.3 <= lng <= -73.6:
        return 'N.Y.C.'
    # Long Island
    if 40.4 <= lat <= 41.2 and lng > -73.6:
        return 'LONGIL'
    # Dunwoodie (lower Westchester)
    if 40.85 <= lat <= 41.1 and -73.9 <= lng <= -73.6:
        return 'DUNWOD'
    # Millwood (upper Westchester)
    if 41.0 <= lat <= 41.3 and -73.9 <= lng <= -73.6:
        return 'MILLWD'
    # Hudson Valley
    if 41.0 <= lat <= 42.3 and -74.5 <= lng <= -73.3:
        return 'HUD VL'
    # Capital (Albany area)
    if 42.3 <= lat <= 43.5 and -74.5 <= lng <= -73.3:
        return 'CAPITL'
    # Mohawk Valley
    if 41.5 <= lat <= 43.0 and -75.0 <= lng <= -73.5:
        return 'MHK VL'
    # North Country
    if lat >= 43.5 and lng >= -75.5:
        return 'NORTH'
    # Central
    if lat >= 42.5 and -76.5 <= lng <= -75.5:
        return 'CENTRL'
    # Genesee (Rochester area)
    if lat >= 42.5 and -77.5 <= lng <= -76.5:
        return 'GENESE'
    # West (Buffalo area)
    if lat >= 42.0 and lng <= -77.5:
        return 'WEST'
    # Default: Capital
    return 'CAPITL'


def map_ercot_zone(lat, lng):
    """Map lat/lng to ERCOT load zone."""
    # Houston metro
    if 29.0 <= lat <= 30.5 and -96.0 <= lng <= -94.5:
        return 'LZ_HOUSTON'
    # North (DFW area)
    if lat >= 32.0 and -98.0 <= lng <= -96.0:
        return 'LZ_NORTH'
    # South (SA, RGV, Corpus)
    if lat <= 30.0 and lng >= -100.0:
        return 'LZ_SOUTH'
    # West (Permian Basin, El Paso)
    if lng <= -100.0:
        return 'LZ_WEST'
    # Austin / Central — use North as closest
    if 30.0 <= lat <= 32.0:
        return 'LZ_NORTH'
    return ERCOT_DEFAULT_ZONE


def build_zone_assignments(lmp_data):
    """Build SQL for zone-level LMP assignments.

    Returns list of (sql_condition, zone_name, lmp_price, iso_name) tuples.
    """
    assignments = []

    # --- CAISO ---
    if 'CAISO' in lmp_data:
        zones = lmp_data['CAISO']['zones']
        for zone_label, zone_key in CAISO_ZONE_KEYS.items():
            if zone_key in zones:
                price = zones[zone_key]
                bounds = CAISO_ZONES[zone_label]
                sql_cond = f"iso_region = 'CAISO' AND latitude >= {bounds['lat_min']} AND latitude < {bounds['lat_max']}"
                assignments.append((sql_cond, f'CAISO_{zone_label}', price, 'CAISO'))
        # Fallback for CAISO sites not matching any zone
        overall = lmp_data['CAISO']['overall_mean']
        assignments.append((
            "iso_region = 'CAISO' AND lmp_zone IS NULL",
            'CAISO_SP15', overall, 'CAISO'
        ))

    # --- NYISO ---
    if 'NYISO' in lmp_data:
        zones = lmp_data['NYISO']['zones']
        if '_overall' in zones and len(zones) == 1:
            # Only got overall — assign by geo region with same price
            overall = zones['_overall']
            assignments.append((
                "iso_region = 'NYISO'",
                'NYISO_OVERALL', overall, 'NYISO'
            ))
        else:
            # Got zone-level data — map by geographic region
            nyiso_zone_sql = _build_nyiso_geo_sql(zones)
            if nyiso_zone_sql:
                assignments.extend(nyiso_zone_sql)
            # Always add fallback for NYISO sites not matching any geo zone
            overall = lmp_data['NYISO']['overall_mean']
            assignments.append((
                "iso_region = 'NYISO' AND lmp_zone IS NULL",
                'NYISO_CAPITL', overall, 'NYISO'  # Default to Capital region
            ))

    # --- PJM ---
    if 'PJM' in lmp_data:
        zones = lmp_data['PJM']['zones']
        # Map PJM states to utility zone prices
        for state, zone_name in PJM_STATE_TO_ZONE.items():
            price = _find_pjm_zone_price(zones, zone_name)
            if price is not None:
                assignments.append((
                    f"iso_region = 'PJM' AND state = '{state}'",
                    f'PJM_{zone_name}', price, 'PJM'
                ))
            else:
                # Use overall if specific zone not found
                overall = lmp_data['PJM']['overall_mean']
                assignments.append((
                    f"iso_region = 'PJM' AND state = '{state}'",
                    f'PJM_{zone_name}', overall, 'PJM'
                ))
        # Fallback for PJM states not in mapping
        overall = lmp_data['PJM']['overall_mean']
        assignments.append((
            "iso_region = 'PJM' AND lmp_zone IS NULL",
            'PJM_RTO', overall, 'PJM'
        ))

    # --- MISO ---
    if 'MISO' in lmp_data:
        zones = lmp_data['MISO']['zones']
        for state, hub_name in MISO_STATE_HUB.items():
            if hub_name in zones:
                price = zones[hub_name]
                assignments.append((
                    f"iso_region = 'MISO' AND state = '{state}'",
                    f'MISO_{hub_name.replace(".HUB", "")}', price, 'MISO'
                ))
        # Fallback
        overall = lmp_data['MISO']['overall_mean']
        assignments.append((
            "iso_region = 'MISO' AND lmp_zone IS NULL",
            'MISO_AGGREGATE', overall, 'MISO'
        ))

    # --- ERCOT ---
    if 'ERCOT' in lmp_data:
        zones = lmp_data['ERCOT']['zones']
        ercot_zone_names = ['LZ_NORTH', 'LZ_HOUSTON', 'LZ_SOUTH', 'LZ_WEST']
        for zone_label in ercot_zone_names:
            # Find zone in data (may have different prefix)
            price = None
            for zk, zv in zones.items():
                if zone_label in zk or zone_label.replace('LZ_', '') in zk.upper():
                    price = zv
                    break
            if price is None:
                # Try hub names
                hub_map = {'LZ_NORTH': 'HB_NORTH', 'LZ_HOUSTON': 'HB_HOUSTON',
                          'LZ_SOUTH': 'HB_SOUTH', 'LZ_WEST': 'HB_WEST'}
                for zk, zv in zones.items():
                    if hub_map.get(zone_label, '') in zk:
                        price = zv
                        break

            if price is not None:
                bounds = ERCOT_ZONE_MAP[zone_label]
                sql_cond = (
                    f"iso_region = 'ERCOT' AND "
                    f"latitude >= {bounds['lat_min']} AND latitude < {bounds['lat_max']} AND "
                    f"longitude >= {bounds['lng_min']} AND longitude < {bounds['lng_max']}"
                )
                assignments.append((sql_cond, f'ERCOT_{zone_label.replace("LZ_", "")}', price, 'ERCOT'))

        # Fallback for ERCOT sites not matching any zone
        overall = lmp_data['ERCOT']['overall_mean']
        assignments.append((
            "iso_region = 'ERCOT' AND lmp_zone IS NULL",
            'ERCOT_CENTRAL', overall, 'ERCOT'
        ))

    # --- SPP ---
    if 'SPP' in lmp_data:
        zones = lmp_data['SPP']['zones']
        # Find SPPNORTH_HUB and SPPSOUTH_HUB prices
        north_price = zones.get('SPPNORTH_HUB')
        south_price = zones.get('SPPSOUTH_HUB')

        # Fallback: search by pattern
        if north_price is None or south_price is None:
            for zk, zv in zones.items():
                zk_upper = zk.upper()
                if north_price is None and ('NORTH' in zk_upper):
                    north_price = zv
                elif south_price is None and ('SOUTH' in zk_upper):
                    south_price = zv

        overall = lmp_data['SPP']['overall_mean']
        if north_price is None:
            north_price = overall
        if south_price is None:
            south_price = overall

        assignments.append((
            f"iso_region = 'SPP' AND latitude >= {SPP_LAT_SPLIT}",
            'SPP_NORTH', north_price, 'SPP'
        ))
        assignments.append((
            f"iso_region = 'SPP' AND latitude < {SPP_LAT_SPLIT}",
            'SPP_SOUTH', south_price, 'SPP'
        ))

    # --- ISO-NE ---
    if 'ISO-NE' in lmp_data:
        zones = lmp_data['ISO-NE']['zones']
        for state, zone_key in ISONE_STATE_ZONE.items():
            # Find matching zone in data
            price = None
            for zk, zv in zones.items():
                if zone_key.upper() in zk.upper() or zone_key in zk:
                    price = zv
                    break
            if price is None:
                # Try state name match
                state_names = {
                    'CT': 'CONNECTICUT', 'ME': 'MAINE', 'NH': 'NEWHAMPSHIRE',
                    'RI': 'RHODEISLAND', 'VT': 'VERMONT', 'MA': 'MASSACHUSETTS',
                }
                for zk, zv in zones.items():
                    if state_names.get(state, '') in zk.upper():
                        price = zv
                        break

            if price is None:
                price = lmp_data['ISO-NE']['overall_mean']

            assignments.append((
                f"iso_region = 'ISO-NE' AND state = '{state}'",
                f'ISONE_{state}', price, 'ISO-NE'
            ))

    return assignments


def _build_nyiso_geo_sql(zones):
    """Build NYISO zone assignments using geographic mapping."""
    # Map NYISO zone names to our geo-based labels
    zone_name_map = {
        'WEST': ['WEST'],
        'GENESE': ['GENESE', 'GENESEE'],
        'CENTRL': ['CENTRL', 'CENTRAL'],
        'NORTH': ['NORTH'],
        'MHK VL': ['MHK VL', 'MOHAWK', 'MHK_VL'],
        'CAPITL': ['CAPITL', 'CAPITAL'],
        'HUD VL': ['HUD VL', 'HUDSON', 'HUD_VL'],
        'MILLWD': ['MILLWD', 'MILLWOOD'],
        'DUNWOD': ['DUNWOD', 'DUNWOODIE'],
        'N.Y.C.': ['N.Y.C.', 'NYC', 'NEW YORK CITY'],
        'LONGIL': ['LONGIL', 'LONG ISLAND'],
    }

    assignments = []
    for our_zone, search_names in zone_name_map.items():
        price = None
        for zk, zv in zones.items():
            for sn in search_names:
                if sn.upper() in zk.upper():
                    price = zv
                    break
            if price is not None:
                break

        if price is None:
            continue

        # Build geographic SQL condition
        geo = NYISO_ZONE_STATE_MAP.get(our_zone, {})
        conditions = ["iso_region = 'NYISO'"]
        if 'lat_min' in geo:
            conditions.append(f"latitude >= {geo['lat_min']}")
        if 'lat_max' in geo:
            conditions.append(f"latitude < {geo['lat_max']}")
        if 'lng_min' in geo:
            conditions.append(f"longitude >= {geo['lng_min']}")
        if 'lng_max' in geo:
            conditions.append(f"longitude < {geo['lng_max']}")

        assignments.append((
            ' AND '.join(conditions),
            f'NYISO_{our_zone.replace(" ", "_").replace(".", "")}',
            price,
            'NYISO'
        ))

    return assignments


def _find_pjm_zone_price(zones, zone_name):
    """Find price for a PJM utility zone from LMP data."""
    # Try exact match first
    if zone_name in zones:
        return zones[zone_name]

    # Try with common suffixes/prefixes
    for zk, zv in zones.items():
        zk_upper = zk.upper()
        zone_upper = zone_name.upper()
        # Match "PSEG" in "PSEG-AGG" or "PSEG_ZONE"
        if zone_upper in zk_upper or zk_upper.startswith(zone_upper + ' ') or zk_upper.startswith(zone_upper + '_'):
            return zv

    return None


def main():
    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Zone-Level Wholesale LMP Enrichment (All 7 ISOs)")
    print("=" * 60)

    # -------------------------------------------------------
    # Phase 1: Fetch 7-day LMP data from all ISOs
    # -------------------------------------------------------
    lmp_data = {}

    if skip_download and os.path.exists(CACHE_FILE):
        print(f"\n[1/3] Loading cached LMP data from {CACHE_FILE}")
        with open(CACHE_FILE) as f:
            lmp_data = json.load(f)
        for iso, data in lmp_data.items():
            n_zones = len(data.get('zones', {}))
            print(f"  {iso}: ${data['overall_mean']:.2f}/MWh avg, {n_zones} zones "
                  f"({data.get('date_start', data.get('date', '?'))} to {data.get('date_end', '?')})")
    else:
        print(f"\n[1/3] Fetching 7-day LMP data from all 7 ISOs via gridstatus...")
        lmp_data = fetch_all_lmp()

        if lmp_data:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(CACHE_FILE, 'w') as f:
                json.dump(lmp_data, f, indent=2)
            print(f"\n  Cached to {CACHE_FILE}")
            print(f"  ISOs fetched: {list(lmp_data.keys())} ({len(lmp_data)}/7)")
        else:
            print("  WARNING: No LMP data fetched. Nothing to update.")
            return

    # -------------------------------------------------------
    # Phase 2: Build zone-level assignments
    # -------------------------------------------------------
    print(f"\n[2/3] Building zone-level LMP assignments...")

    assignments = build_zone_assignments(lmp_data)
    print(f"  Created {len(assignments)} zone assignments across {len(lmp_data)} ISOs")

    # Print price summary by ISO
    print(f"\n  Zone-level price summary:")
    print(f"  {'Zone':<30} {'$/MWh':>8}  {'ISO':<8}")
    print(f"  {'-'*30} {'-'*8}  {'-'*8}")

    prices_by_iso = {}
    for _, zone, price, iso in sorted(assignments, key=lambda x: x[2]):
        if 'NULL' not in _[0]:  # Skip fallback entries for display
            prices_by_iso.setdefault(iso, []).append((zone, price))

    for _, zone, price, iso in sorted(assignments, key=lambda x: x[2]):
        print(f"  {zone:<30} ${price:>7.2f}  {iso}")

    # -------------------------------------------------------
    # Phase 3: Update grid_dc_sites via psql
    # -------------------------------------------------------
    print(f"\n[3/3] Updating grid_dc_sites with zone-level LMP data...")

    if dry_run:
        print(f"\n  Would execute {len(assignments)} UPDATE statements")
        print(f"  Would add columns: lmp_zone TEXT, lmp_wholesale_mwh NUMERIC(8,2)")

        # Count expected coverage
        for _, zone, price, iso in assignments:
            print(f"    {zone}: ${price:.2f}/MWh")
        return

    # Add new columns if needed
    add_cols_sql = """
    DO $$ BEGIN
        ALTER TABLE grid_dc_sites ADD COLUMN lmp_zone TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
        ALTER TABLE grid_dc_sites ADD COLUMN lmp_wholesale_mwh NUMERIC(8,2);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    """
    print("  Adding columns if needed...")
    run_psql(add_cols_sql)

    # Clear existing LMP data for clean update
    print("  Clearing existing LMP zone data...")
    run_psql("UPDATE grid_dc_sites SET lmp_zone = NULL, lmp_wholesale_mwh = NULL WHERE lmp_zone IS NOT NULL;")

    # Execute zone assignments in order (specific zones first, fallbacks last)
    # Sort so fallback (IS NULL) entries come last
    sorted_assignments = sorted(assignments, key=lambda x: ('IS NULL' in x[0], x[0]))

    total_updated = 0
    for sql_cond, zone, price, iso in sorted_assignments:
        sql = f"""
        UPDATE grid_dc_sites
        SET lmp_zone = '{zone}',
            lmp_wholesale_mwh = {price}
        WHERE {sql_cond};
        """
        result = run_psql(sql)
        count = 0
        if result and 'UPDATE' in result:
            try:
                count = int(result.strip().split()[-1])
            except (ValueError, IndexError):
                pass

        if count > 0:
            total_updated += count
            print(f"    {zone}: {count} sites @ ${price:.2f}/MWh")

    print(f"\n  Total sites with LMP zone data: {total_updated}")

    # Also ensure EIA retail rates are set for ALL sites
    print("\n  Ensuring EIA retail rates for all sites...")
    eia_count = 0
    for state, cents in sorted(EIA_STATE_RATES_CENTS.items()):
        mwh_price = round(cents * 10, 2)
        sql = f"""
        UPDATE grid_dc_sites
        SET energy_price_mwh = {mwh_price},
            energy_price_source = 'eia_retail'
        WHERE state = '{state}' AND (energy_price_mwh IS NULL OR energy_price_source = 'eia_retail');
        """
        result = run_psql(sql)
        if result and 'UPDATE' in result:
            try:
                n = int(result.strip().split()[-1])
                eia_count += n
            except (ValueError, IndexError):
                pass

    if eia_count > 0:
        print(f"  Updated {eia_count} EIA retail prices")

    # -------------------------------------------------------
    # Summary statistics
    # -------------------------------------------------------
    print(f"\n{'='*60}")
    print("Summary Statistics")
    print(f"{'='*60}")

    print("\nLMP zone coverage:")
    print(run_psql("""
    SELECT
        COUNT(*) AS total_sites,
        COUNT(lmp_zone) AS has_lmp_zone,
        COUNT(*) - COUNT(lmp_zone) AS no_lmp_zone,
        ROUND(100.0 * COUNT(lmp_zone) / COUNT(*), 1) AS pct_covered
    FROM grid_dc_sites;
    """))

    print("LMP zones (sorted by price):")
    print(run_psql("""
    SELECT
        lmp_zone AS zone,
        COUNT(*) AS sites,
        ROUND(AVG(lmp_wholesale_mwh)::numeric, 2) AS avg_lmp,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_retail,
        ROUND((AVG(energy_price_mwh) - AVG(lmp_wholesale_mwh))::numeric, 2) AS savings
    FROM grid_dc_sites
    WHERE lmp_zone IS NOT NULL
    GROUP BY lmp_zone
    ORDER BY avg_lmp;
    """))

    print("By ISO (wholesale vs retail):")
    print(run_psql("""
    SELECT
        COALESCE(iso_region, 'None') AS iso,
        COUNT(*) AS sites,
        ROUND(AVG(lmp_wholesale_mwh)::numeric, 2) AS avg_wholesale,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_retail,
        ROUND((AVG(energy_price_mwh) - COALESCE(AVG(lmp_wholesale_mwh), AVG(energy_price_mwh)))::numeric, 2) AS retail_premium
    FROM grid_dc_sites
    GROUP BY iso_region
    ORDER BY avg_wholesale NULLS LAST;
    """))

    print("Cheapest zones for DC procurement:")
    print(run_psql("""
    SELECT
        lmp_zone AS zone,
        COUNT(*) AS sites,
        ROUND(AVG(lmp_wholesale_mwh)::numeric, 2) AS wholesale_mwh,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS retail_mwh
    FROM grid_dc_sites
    WHERE lmp_zone IS NOT NULL
    GROUP BY lmp_zone
    ORDER BY AVG(lmp_wholesale_mwh)
    LIMIT 15;
    """))

    print("Most expensive zones:")
    print(run_psql("""
    SELECT
        lmp_zone AS zone,
        COUNT(*) AS sites,
        ROUND(AVG(lmp_wholesale_mwh)::numeric, 2) AS wholesale_mwh,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS retail_mwh
    FROM grid_dc_sites
    WHERE lmp_zone IS NOT NULL
    GROUP BY lmp_zone
    ORDER BY AVG(lmp_wholesale_mwh) DESC
    LIMIT 10;
    """))

    print("Non-ISO sites (EIA retail only):")
    print(run_psql("""
    SELECT
        COALESCE(iso_region, 'None') AS iso,
        COUNT(*) AS sites,
        ROUND(AVG(energy_price_mwh)::numeric, 2) AS avg_retail
    FROM grid_dc_sites
    WHERE lmp_zone IS NULL
    GROUP BY iso_region
    ORDER BY COUNT(*) DESC;
    """))

    print("Done!")


if __name__ == '__main__':
    main()

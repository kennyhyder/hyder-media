#!/usr/bin/env python3
"""
Enrich grid_transmission_lines with NREL Dynamic Line Ratings (SLR) data.

Reads SLR_A-75C.h5 to get static line rating (amps) per HIFLD line ID.
Maps our DB hifld_id (OBJECTID) to HIFLD ID via ArcGIS API lookup.
Computes: capacity_mw = sqrt(3) * voltage_kv * slr_amps / 1000
Updates capacity_mw and upgrade_candidate in grid_transmission_lines.

Source: https://data.openei.org/submissions/6231
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
import h5py
import numpy as np
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

HIFLD_URL = "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0"

HDF5_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'nrel_dlr', 'SLR_A-75C.h5')

BATCH_SIZE = 50

# State bounding boxes (same as ingest-hifld.py)
STATE_BBOXES = {
    'TX': (-106.65, 25.84, -93.51, 36.50),
    'NM': (-109.05, 31.33, -103.00, 37.00),
    'AZ': (-114.82, 31.33, -109.04, 37.00),
    'NV': (-120.01, 35.00, -114.04, 42.00),
    'CO': (-109.06, 36.99, -102.04, 41.00),
    'UT': (-114.05, 37.00, -109.04, 42.00),
    'WY': (-111.06, 40.99, -104.05, 45.01),
    'CA': (-124.41, 32.53, -114.13, 42.01),
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


def load_nrel_slr():
    """Load NREL SLR data from HDF5 file. Returns dict of {hifld_id: slr_amps}."""
    print(f"Loading NREL SLR data from {HDF5_PATH}...")
    f = h5py.File(HDF5_PATH, 'r')
    idx = f['index'][:]
    data = f['data'][:]
    f.close()

    # Build dict: HIFLD ID -> SLR amps
    slr_map = {}
    for i in range(len(idx)):
        hifld_id = int(idx[i])
        amps = float(data[i])
        if amps > 0 and not math.isnan(amps):
            slr_map[hifld_id] = round(amps, 2)

    print(f"  Loaded {len(slr_map)} lines with SLR data")
    print(f"  HIFLD ID range: {min(slr_map.keys())}-{max(slr_map.keys())}")
    print(f"  Amps range: {min(slr_map.values()):.1f}-{max(slr_map.values()):.1f}")
    return slr_map


def fetch_objectid_to_id_mapping():
    """
    Query HIFLD ArcGIS API to build OBJECTID -> ID mapping for our target states.

    Our DB stores OBJECTID as hifld_id, but NREL indexes by the HIFLD ID field.
    We need this mapping to join them.
    """
    print("\nFetching OBJECTID -> ID mapping from HIFLD ArcGIS API...")
    objectid_to_id = {}
    seen = set()

    for state, bbox in STATE_BBOXES.items():
        xmin, ymin, xmax, ymax = bbox
        geometry_json = json.dumps({
            'xmin': xmin, 'ymin': ymin,
            'xmax': xmax, 'ymax': ymax,
            'spatialReference': {'wkid': 4326}
        })

        offset = 0
        state_count = 0
        while True:
            params = {
                'where': '1=1',
                'geometry': geometry_json,
                'geometryType': 'esriGeometryEnvelope',
                'spatialRel': 'esriSpatialRelIntersects',
                'inSR': '4326',
                'outFields': 'OBJECTID,ID',
                'returnGeometry': 'false',
                'f': 'json',
                'resultOffset': offset,
                'resultRecordCount': 2000,
            }
            url = f"{HIFLD_URL}/query?{urllib.parse.urlencode(params)}"

            for attempt in range(3):
                try:
                    req = urllib.request.Request(url)
                    req.add_header('User-Agent', 'GridScout/1.0')
                    with urllib.request.urlopen(req, timeout=180) as resp:
                        data = json.loads(resp.read().decode())
                        break
                except Exception as e:
                    if attempt < 2:
                        print(f"  Fetch error for {state}: {e}, retrying...")
                        time.sleep(2 ** attempt)
                        continue
                    print(f"  Failed to fetch {state} after 3 attempts: {e}")
                    data = {'features': []}

            features = data.get('features', [])
            if not features:
                break

            for feat in features:
                attrs = feat.get('attributes', {})
                objectid = attrs.get('OBJECTID')
                hifld_id_raw = attrs.get('ID')
                if objectid is not None and hifld_id_raw is not None and objectid not in seen:
                    seen.add(objectid)
                    # HIFLD ID field is returned as string — convert to int for NREL lookup
                    try:
                        hifld_id = int(hifld_id_raw)
                    except (ValueError, TypeError):
                        continue
                    objectid_to_id[objectid] = hifld_id
                    state_count += 1

            has_more = data.get('exceededTransferLimit', False)
            if not has_more:
                break
            offset += len(features)
            time.sleep(0.3)

        print(f"  {state}: {state_count} mappings")

    print(f"  Total OBJECTID -> ID mappings: {len(objectid_to_id)}")
    return objectid_to_id


def load_db_lines():
    """Load all transmission lines from DB with hifld_id and voltage_kv."""
    print("\nLoading transmission lines from database...")
    lines = []
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_transmission_lines?select=id,hifld_id,voltage_kv,capacity_mw,static_rating_amps'
            f'&limit={page_size}&offset={offset}'
        )
        if not result:
            break
        lines.extend(result)
        if len(result) < page_size:
            break
        offset += page_size

    print(f"  Loaded {len(lines)} transmission lines from DB")
    return lines


def main():
    print("=" * 60)
    print("GridScout NREL DLR Capacity Enrichment")
    print("=" * 60)

    # Step 1: Load NREL SLR data (HIFLD ID -> amps)
    slr_map = load_nrel_slr()

    # Step 2: Build OBJECTID -> HIFLD ID mapping
    objectid_to_id = fetch_objectid_to_id_mapping()

    # Step 3: Load our DB lines
    db_lines = load_db_lines()

    # Step 4: Match and compute capacity
    print("\nMatching lines and computing capacity...")
    updates = []
    matched = 0
    no_mapping = 0
    no_slr = 0
    no_voltage = 0

    for line in db_lines:
        objectid = line['hifld_id']
        voltage_kv = line['voltage_kv']

        # Map our OBJECTID to HIFLD ID
        hifld_id = objectid_to_id.get(objectid)
        if hifld_id is None:
            no_mapping += 1
            continue

        # Look up SLR amps
        slr_amps = slr_map.get(hifld_id)
        if slr_amps is None:
            no_slr += 1
            continue

        if voltage_kv is None or voltage_kv <= 0:
            no_voltage += 1
            continue

        # Compute capacity: sqrt(3) * voltage_kv * slr_amps / 1000
        capacity_mw = round(math.sqrt(3) * float(voltage_kv) * slr_amps / 1000, 2)

        # Upgrade candidate: capacity between 50 and 100 MW
        upgrade_candidate = 50 <= capacity_mw <= 100

        updates.append({
            'id': line['id'],
            'static_rating_amps': slr_amps,
            'capacity_mw': capacity_mw,
            'upgrade_candidate': upgrade_candidate,
        })
        matched += 1

    print(f"  Matched: {matched}")
    print(f"  No OBJECTID->ID mapping: {no_mapping}")
    print(f"  No SLR data for HIFLD ID: {no_slr}")
    print(f"  No voltage: {no_voltage}")

    if not updates:
        print("\nNo updates to apply. Exiting.")
        return

    # Step 5: Apply updates in batches
    print(f"\nApplying {len(updates)} updates in batches of {BATCH_SIZE}...")
    applied = 0
    errors = 0

    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i:i + BATCH_SIZE]
        for record in batch:
            line_id = record['id']
            patch_data = {
                'static_rating_amps': record['static_rating_amps'],
                'capacity_mw': record['capacity_mw'],
                'upgrade_candidate': record['upgrade_candidate'],
            }
            try:
                supabase_request(
                    'PATCH',
                    f'grid_transmission_lines?id=eq.{line_id}',
                    patch_data
                )
                applied += 1
            except Exception as e:
                errors += 1
                if errors <= 10:
                    print(f"  Error updating {line_id}: {e}")

        if (i + BATCH_SIZE) % 500 == 0 or i + BATCH_SIZE >= len(updates):
            print(f"  Progress: {min(i + BATCH_SIZE, len(updates))}/{len(updates)} "
                  f"({applied} applied, {errors} errors)")

    # Step 6: Summary stats
    upgrade_count = sum(1 for u in updates if u['upgrade_candidate'])
    capacities = [u['capacity_mw'] for u in updates]
    amps_values = [u['static_rating_amps'] for u in updates]

    print(f"\n{'=' * 60}")
    print("NREL DLR Enrichment Complete")
    print(f"{'=' * 60}")
    print(f"  Lines in DB:         {len(db_lines)}")
    print(f"  OBJECTID->ID mapped: {len(objectid_to_id)}")
    print(f"  Matched with SLR:    {matched}")
    print(f"  Updated:             {applied}")
    print(f"  Errors:              {errors}")
    print(f"  Upgrade candidates:  {upgrade_count} (50-100 MW)")
    print(f"  SLR amps range:      {min(amps_values):.1f} - {max(amps_values):.1f}")
    print(f"  Capacity MW range:   {min(capacities):.1f} - {max(capacities):.1f}")
    print(f"  Avg capacity MW:     {sum(capacities)/len(capacities):.1f}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

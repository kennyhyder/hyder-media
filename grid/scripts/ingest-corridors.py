#!/usr/bin/env python3
"""
Ingest energy corridors from multiple sources into grid_corridors table:
1. BLM Solar Designated Leasing Areas (ArcGIS FeatureServer)
2. Section 368 corridors (download attempted, manual fallback)
3. NIETC Phase 3 corridors (download attempted, manual fallback)

All three corridor types are stored in the same table with corridor_type column.
"""

import os
import sys
import json
import time
import math
import urllib.request
import urllib.parse
import urllib.error
import zipfile
import tempfile
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

# BLM Solar DLA FeatureServer
BLM_SOLAR_DLA_URL = "https://services1.arcgis.com/SyUSN23vOoYdfLC8/arcgis/rest/services/BLM_Natl_Solar_Designated_Leasing_Areas/FeatureServer/0"

# NIETC Phase 3 download
NIETC_URL = "https://gem.anl.gov/tool/layers/potential_nietcs_phase3_241216/versions/1/download.zip"

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
    body = json.dumps(data).encode() if data else None
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


def get_data_source_id(name):
    result = supabase_request('GET', f'grid_data_sources?name=eq.{name}&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print(f"WARNING: {name} data source not found.")
    return None


def get_existing_ids():
    existing = set()
    offset = 0
    while True:
        result = supabase_request(
            'GET',
            f'grid_corridors?select=source_record_id&limit=1000&offset={offset}'
        )
        if not result:
            break
        for r in result:
            existing.add(r['source_record_id'])
        if len(result) < 1000:
            break
        offset += 1000
    return existing


def rings_to_wkt(rings):
    """Convert ArcGIS polygon rings to WKT."""
    if not rings:
        return None
    parts = []
    for ring in rings:
        coords = ', '.join(f"{p[0]} {p[1]}" for p in ring)
        parts.append(f"({coords})")
    if len(parts) == 1:
        return f"POLYGON({parts[0]})"
    return f"POLYGON({', '.join(parts)})"


def safe_str(val, max_len=500):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a'):
        return None
    return s[:max_len]


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


# ─── BLM Solar Designated Leasing Areas ───

def ingest_blm_solar_dla(existing_ids):
    """Ingest BLM Solar Designated Leasing Areas."""
    print("\n--- BLM Solar Designated Leasing Areas ---")

    ds_id = get_data_source_id('blm_solar_dla')
    total_fetched = 0
    total_created = 0
    offset = 0

    while True:
        params = {
            'where': '1=1',
            'outFields': '*',
            'outSR': '4326',
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': 500,
        }
        url = f"{BLM_SOLAR_DLA_URL}/query?{urllib.parse.urlencode(params)}"

        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"  Fetch error: {e}")
            break

        features = data.get('features', [])
        if not features:
            break

        records = []
        for f in features:
            total_fetched += 1
            attrs = f.get('attributes', {})
            geom = f.get('geometry', {})

            oid = attrs.get('OBJECTID') or attrs.get('FID') or total_fetched
            source_id = f"blm_dla_{oid}"

            if source_id in existing_ids:
                continue

            name = safe_str(attrs.get('DLA_NAME') or attrs.get('NAME') or attrs.get('AREA_NAME'))
            state = safe_str(attrs.get('STATE') or attrs.get('ST'))
            acreage = safe_float(attrs.get('GIS_ACRES') or attrs.get('ACRES') or attrs.get('ACREAGE'))

            wkt = rings_to_wkt(geom.get('rings', [])) if geom else None

            records.append({
                'source_record_id': source_id,
                'corridor_type': 'blm_solar_dla',
                'corridor_id': safe_str(attrs.get('DLA_ID')),
                'name': name,
                'states': [state] if state else [],
                'agency': 'BLM',
                'acreage': acreage,
                'geometry_wkt': wkt,
                'data_source_id': ds_id,
                'created_at': datetime.now(timezone.utc).isoformat(),
            })
            existing_ids.add(source_id)

        # Insert batch
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                supabase_request('POST', 'grid_corridors', batch, {'Prefer': 'return=minimal'})
                total_created += len(batch)
            except Exception as e:
                print(f"  Batch error: {e}")
                for rec in batch:
                    try:
                        supabase_request('POST', 'grid_corridors', [rec], {'Prefer': 'return=minimal'})
                        total_created += 1
                    except:
                        pass

        has_more = data.get('exceededTransferLimit', False)
        if not has_more:
            break
        offset += len(features)
        time.sleep(1)

    # Update data source count
    if ds_id:
        supabase_request(
            'PATCH',
            'grid_data_sources?name=eq.blm_solar_dla',
            {'record_count': total_created, 'last_import': datetime.now(timezone.utc).isoformat()}
        )

    print(f"  BLM Solar DLA: {total_fetched} fetched, {total_created} created")
    return total_created


# ─── NIETC Phase 3 Corridors ───

def ingest_nietc(existing_ids):
    """Download and ingest NIETC Phase 3 corridor data."""
    print("\n--- NIETC Phase 3 Corridors ---")

    ds_id = get_data_source_id('nietc_phase3')

    # Try to download shapefile
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'nietc')
    os.makedirs(data_dir, exist_ok=True)
    zip_path = os.path.join(data_dir, 'nietc_phase3.zip')

    if not os.path.exists(zip_path):
        print(f"  Downloading NIETC Phase 3 from {NIETC_URL}...")
        try:
            req = urllib.request.Request(NIETC_URL)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(zip_path, 'wb') as f:
                    f.write(resp.read())
            print(f"  Downloaded {os.path.getsize(zip_path)} bytes")
        except Exception as e:
            print(f"  Download failed: {e}")
            print("  Will create placeholder records for 3 known NIETC corridors")
            return ingest_nietc_placeholder(existing_ids, ds_id)

    # Try to parse shapefile (needs geopandas)
    try:
        import geopandas as gpd

        # Extract zip
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(data_dir)

        # Find .shp file
        shp_files = [f for f in os.listdir(data_dir) if f.endswith('.shp')]
        if not shp_files:
            # Check subdirectories
            for root, dirs, files in os.walk(data_dir):
                for f in files:
                    if f.endswith('.shp'):
                        shp_files.append(os.path.join(root, f))
                        break

        if not shp_files:
            print("  No .shp file found in download")
            return ingest_nietc_placeholder(existing_ids, ds_id)

        shp_path = shp_files[0] if os.path.isabs(shp_files[0]) else os.path.join(data_dir, shp_files[0])
        print(f"  Reading shapefile: {shp_path}")

        gdf = gpd.read_file(shp_path)
        gdf = gdf.to_crs(epsg=4326)  # Ensure WGS84

        print(f"  Found {len(gdf)} features")
        print(f"  Columns: {list(gdf.columns)}")

        total_created = 0
        records = []

        for idx, row in gdf.iterrows():
            oid = row.get('OBJECTID', idx)
            source_id = f"nietc3_{oid}"
            if source_id in existing_ids:
                continue

            name = str(row.get('NAME', '') or row.get('name', '') or row.get('NIETC_NAME', '') or f'NIETC Corridor {oid}')
            wkt = row.geometry.wkt if row.geometry else None

            # Try to extract states from geometry bounds or attributes
            states = []
            state_val = row.get('STATE', '') or row.get('STATES', '') or ''
            if state_val:
                states = [s.strip() for s in str(state_val).split(',') if s.strip()]

            records.append({
                'source_record_id': source_id,
                'corridor_type': 'nietc',
                'corridor_id': safe_str(row.get('CORRIDOR_ID') or row.get('ID')),
                'name': name,
                'states': states,
                'agency': 'DOE',
                'environmental_status': safe_str(row.get('STATUS')),
                'acreage': safe_float(row.get('ACRES') or row.get('ACREAGE')),
                'geometry_wkt': wkt,
                'data_source_id': ds_id,
                'created_at': datetime.now(timezone.utc).isoformat(),
            })
            existing_ids.add(source_id)

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                supabase_request('POST', 'grid_corridors', batch, {'Prefer': 'return=minimal'})
                total_created += len(batch)
            except Exception as e:
                print(f"  Insert error: {e}")

        if ds_id:
            supabase_request(
                'PATCH',
                'grid_data_sources?name=eq.nietc_phase3',
                {'record_count': total_created, 'last_import': datetime.now(timezone.utc).isoformat()}
            )

        print(f"  NIETC Phase 3: {total_created} created from shapefile")
        return total_created

    except ImportError:
        print("  geopandas not installed — using placeholder records")
        return ingest_nietc_placeholder(existing_ids, ds_id)


def ingest_nietc_placeholder(existing_ids, ds_id):
    """Insert placeholder records for known NIETC Phase 3 corridors."""
    corridors = [
        {
            'source_record_id': 'nietc3_swgc',
            'corridor_type': 'nietc',
            'corridor_id': 'SWGC',
            'name': 'Southwestern Grid Connector',
            'states': ['CO', 'NM'],
            'agency': 'DOE',
            'environmental_status': 'Phase 3 Designated',
            'data_source_id': ds_id,
            'created_at': datetime.now(timezone.utc).isoformat(),
        },
        {
            'source_record_id': 'nietc3_midatlantic',
            'corridor_type': 'nietc',
            'corridor_id': 'MAR',
            'name': 'Mid-Atlantic Region',
            'states': ['MD', 'PA', 'VA', 'WV'],
            'agency': 'DOE',
            'environmental_status': 'Phase 3 Designated',
            'data_source_id': ds_id,
            'created_at': datetime.now(timezone.utc).isoformat(),
        },
        {
            'source_record_id': 'nietc3_ny_ne',
            'corridor_type': 'nietc',
            'corridor_id': 'NYNE',
            'name': 'New York-New England',
            'states': ['NY', 'CT', 'MA', 'VT', 'NH', 'ME'],
            'agency': 'DOE',
            'environmental_status': 'Phase 3 Designated',
            'data_source_id': ds_id,
            'created_at': datetime.now(timezone.utc).isoformat(),
        },
    ]

    created = 0
    for c in corridors:
        if c['source_record_id'] in existing_ids:
            continue
        try:
            supabase_request('POST', 'grid_corridors', [c], {'Prefer': 'return=minimal'})
            created += 1
        except Exception as e:
            print(f"  Error inserting {c['name']}: {e}")

    print(f"  NIETC Phase 3: {created} placeholder records created")
    return created


# ─── Section 368 Corridors ───

def ingest_section368(existing_ids):
    """Ingest Section 368 energy corridors."""
    print("\n--- Section 368 Energy Corridors ---")

    ds_id = get_data_source_id('section_368')

    # Section 368 data is available from corridoreis.anl.gov
    # Try GeoJSON API first
    s368_url = "https://corridoreis.anl.gov/documents/fpeis/maps/geojson/corridors.geojson"

    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'section368')
    os.makedirs(data_dir, exist_ok=True)
    geojson_path = os.path.join(data_dir, 'corridors.geojson')

    if not os.path.exists(geojson_path):
        print(f"  Downloading Section 368 corridors...")
        try:
            req = urllib.request.Request(s368_url)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=60) as resp:
                with open(geojson_path, 'wb') as f:
                    f.write(resp.read())
            print(f"  Downloaded {os.path.getsize(geojson_path)} bytes")
        except Exception as e:
            print(f"  GeoJSON download failed: {e}")
            print("  Trying shapefile download...")

            # Try shapefile
            shp_url = "https://corridoreis.anl.gov/documents/fpeis/maps/shapefiles/Section368_Corridors.zip"
            zip_path = os.path.join(data_dir, 'section368.zip')
            try:
                req = urllib.request.Request(shp_url)
                req.add_header('User-Agent', 'GridScout/1.0')
                with urllib.request.urlopen(req, timeout=120) as resp:
                    with open(zip_path, 'wb') as f:
                        f.write(resp.read())
                print(f"  Downloaded shapefile {os.path.getsize(zip_path)} bytes")
                return ingest_section368_shapefile(zip_path, data_dir, existing_ids, ds_id)
            except Exception as e2:
                print(f"  Shapefile download also failed: {e2}")
                return ingest_section368_placeholder(existing_ids, ds_id)

    # Parse GeoJSON
    try:
        with open(geojson_path, 'r') as f:
            geojson = json.load(f)

        features = geojson.get('features', [])
        print(f"  Found {len(features)} features in GeoJSON")

        total_created = 0
        records = []

        for idx, feat in enumerate(features):
            props = feat.get('properties', {})
            geom = feat.get('geometry', {})

            oid = props.get('OBJECTID', idx)
            source_id = f"s368_{oid}"
            if source_id in existing_ids:
                continue

            name = safe_str(props.get('CORRIDOR_NAME') or props.get('NAME') or props.get('name'))
            states_str = safe_str(props.get('STATES') or props.get('STATE'))
            states = [s.strip() for s in states_str.split(',')] if states_str else []
            agency = safe_str(props.get('AGENCY') or props.get('MANAGING_AGENCY'))

            # Convert geometry to WKT
            wkt = None
            if geom:
                gtype = geom.get('type', '')
                coords = geom.get('coordinates', [])
                if gtype == 'Polygon' and coords:
                    ring_strs = []
                    for ring in coords:
                        ring_strs.append('(' + ', '.join(f"{p[0]} {p[1]}" for p in ring) + ')')
                    wkt = f"POLYGON({', '.join(ring_strs)})"
                elif gtype == 'MultiPolygon' and coords:
                    poly_strs = []
                    for poly in coords:
                        ring_strs = []
                        for ring in poly:
                            ring_strs.append('(' + ', '.join(f"{p[0]} {p[1]}" for p in ring) + ')')
                        poly_strs.append(f"({', '.join(ring_strs)})")
                    wkt = f"MULTIPOLYGON({', '.join(poly_strs)})"
                elif gtype == 'LineString' and coords:
                    wkt = f"LINESTRING({', '.join(f'{p[0]} {p[1]}' for p in coords)})"

            records.append({
                'source_record_id': source_id,
                'corridor_type': 'section_368',
                'corridor_id': safe_str(props.get('CORRIDOR_ID') or props.get('ID')),
                'name': name,
                'states': states,
                'agency': agency or 'BLM/USFS',
                'environmental_status': safe_str(props.get('EIS_STATUS')),
                'width_miles': safe_float(props.get('WIDTH_MILES') or props.get('WIDTH')),
                'acreage': safe_float(props.get('ACRES') or props.get('ACREAGE')),
                'geometry_wkt': wkt,
                'data_source_id': ds_id,
                'created_at': datetime.now(timezone.utc).isoformat(),
            })
            existing_ids.add(source_id)

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                supabase_request('POST', 'grid_corridors', batch, {'Prefer': 'return=minimal'})
                total_created += len(batch)
            except Exception as e:
                print(f"  Insert error: {e}")

        if ds_id:
            supabase_request(
                'PATCH',
                'grid_data_sources?name=eq.section_368',
                {'record_count': total_created, 'last_import': datetime.now(timezone.utc).isoformat()}
            )

        print(f"  Section 368: {total_created} created from GeoJSON")
        return total_created

    except Exception as e:
        print(f"  GeoJSON parse error: {e}")
        return ingest_section368_placeholder(existing_ids, ds_id)


def ingest_section368_shapefile(zip_path, data_dir, existing_ids, ds_id):
    """Parse Section 368 shapefile with geopandas."""
    try:
        import geopandas as gpd

        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(data_dir)

        shp_files = []
        for root, dirs, files in os.walk(data_dir):
            for f in files:
                if f.endswith('.shp'):
                    shp_files.append(os.path.join(root, f))

        if not shp_files:
            print("  No .shp file found")
            return ingest_section368_placeholder(existing_ids, ds_id)

        gdf = gpd.read_file(shp_files[0]).to_crs(epsg=4326)
        print(f"  Found {len(gdf)} features, columns: {list(gdf.columns)}")

        total_created = 0
        records = []

        for idx, row in gdf.iterrows():
            oid = row.get('OBJECTID', idx)
            source_id = f"s368_{oid}"
            if source_id in existing_ids:
                continue

            records.append({
                'source_record_id': source_id,
                'corridor_type': 'section_368',
                'corridor_id': safe_str(row.get('CORRIDOR_ID', str(oid))),
                'name': safe_str(row.get('NAME') or row.get('CORRIDOR_NAME')),
                'states': [s.strip() for s in str(row.get('STATES', '')).split(',') if s.strip()],
                'agency': safe_str(row.get('AGENCY')) or 'BLM/USFS',
                'width_miles': safe_float(row.get('WIDTH_MILES')),
                'acreage': safe_float(row.get('ACRES')),
                'geometry_wkt': row.geometry.wkt if row.geometry else None,
                'data_source_id': ds_id,
                'created_at': datetime.now(timezone.utc).isoformat(),
            })
            existing_ids.add(source_id)

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                supabase_request('POST', 'grid_corridors', batch, {'Prefer': 'return=minimal'})
                total_created += len(batch)
            except Exception as e:
                print(f"  Insert error: {e}")

        print(f"  Section 368: {total_created} created from shapefile")
        return total_created

    except ImportError:
        print("  geopandas not installed — using placeholder records")
        return ingest_section368_placeholder(existing_ids, ds_id)


def ingest_section368_placeholder(existing_ids, ds_id):
    """Insert known Section 368 corridor summaries as placeholders."""
    # Major Section 368 corridors in target states
    corridors = [
        ('West-Wide Energy Corridor (AZ-NV)', ['AZ', 'NV'], 'BLM'),
        ('West-Wide Energy Corridor (AZ-NM)', ['AZ', 'NM'], 'BLM'),
        ('West-Wide Energy Corridor (NV-CA)', ['NV', 'CA'], 'BLM'),
        ('West-Wide Energy Corridor (CO-UT)', ['CO', 'UT'], 'BLM'),
        ('West-Wide Energy Corridor (UT-NV)', ['UT', 'NV'], 'BLM'),
        ('West-Wide Energy Corridor (WY-CO)', ['WY', 'CO'], 'BLM/USFS'),
        ('West-Wide Energy Corridor (CA)', ['CA'], 'BLM'),
        ('West-Wide Energy Corridor (NM)', ['NM'], 'BLM'),
    ]

    created = 0
    for i, (name, states, agency) in enumerate(corridors):
        source_id = f"s368_placeholder_{i}"
        if source_id in existing_ids:
            continue
        try:
            supabase_request('POST', 'grid_corridors', [{
                'source_record_id': source_id,
                'corridor_type': 'section_368',
                'name': name,
                'states': states,
                'agency': agency,
                'environmental_status': 'Designated (2009 PEIS)',
                'data_source_id': ds_id,
                'created_at': datetime.now(timezone.utc).isoformat(),
            }], {'Prefer': 'return=minimal'})
            created += 1
        except Exception as e:
            print(f"  Error: {e}")

    print(f"  Section 368: {created} placeholder records created")
    print("  Note: Download Section 368 shapefiles from https://corridoreis.anl.gov/maps/ for full geometry")
    return created


def main():
    print("=" * 60)
    print("GridScout Energy Corridor Ingestion")
    print("=" * 60)

    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} existing corridor records")

    total = 0

    # 1. BLM Solar DLAs
    total += ingest_blm_solar_dla(existing_ids)

    # 2. NIETC Phase 3
    total += ingest_nietc(existing_ids)

    # 3. Section 368
    total += ingest_section368(existing_ids)

    print(f"\n{'=' * 60}")
    print(f"Corridor Ingestion Complete: {total} total records")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

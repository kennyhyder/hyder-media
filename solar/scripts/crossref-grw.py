#!/usr/bin/env python3
"""
Microsoft Global Renewables Watch (GRW) Cross-Reference

Cross-references 11,212 US solar installation polygons from GRW against our
704K+ SolarTrack installations. GRW provides satellite-detected polygon boundaries
with area (m2) and construction dates (quarterly 2017-2024).

Strategy:
  Phase 1: Coordinate proximity match (2km) + capacity tolerance (50%)
           For installations WITH coordinates
  Phase 2: Zip + capacity match for city/zip-precision records
           Using Census ZCTA shapefile for point-in-polygon zip assignment
  Phase 3: Insert remaining GRW records as new installations
           (Solar farms detected by satellite not in any government database)

Data source: https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0
License: MIT

Usage:
  python3 -u scripts/crossref-grw.py              # Full run
  python3 -u scripts/crossref-grw.py --dry-run     # Preview without patching
  python3 -u scripts/crossref-grw.py --phase 1     # Phase 1 only
  python3 -u scripts/crossref-grw.py --stats        # Just show GRW stats
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
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load environment
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

GRW_FILE = Path(__file__).parent.parent / "data" / "grw" / "solar_all_2024q2_v1.gpkg"

# Area to capacity conversion (LBNL 2024 study)
# Ground-mount: ~5 acres/MW average = ~20,234 m2/MW
# We use 20,000 m2/MW as a round number
M2_PER_MW = 20000

ZCTA_DIR = Path(__file__).parent.parent / "data" / "zcta_shapes"
ZCTA_URL = "https://www2.census.gov/geo/tiger/TIGER2023/ZCTA520/tl_2023_us_zcta520.zip"


def supabase_get(table, params, retries=3):
    """GET from Supabase REST API with retry."""
    qs = urllib.parse.urlencode(params, safe=".*,()!<>=")
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise


def supabase_patch(table, match_col, match_val, data, retries=3):
    """PATCH a single record in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_col}=eq.{urllib.parse.quote(str(match_val), safe='')}"
    body = json.dumps(data, allow_nan=False).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return True
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  PATCH error for {match_val}: {e}")
                return False


def supabase_post(table, records, retries=3):
    """POST batch of records to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(records, allow_nan=False).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return True
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  POST error: {e}")
                return False


def haversine_km(lat1, lon1, lat2, lon2):
    """Haversine distance in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def load_grw_us():
    """Load GRW US records, compute centroids in WGS84."""
    import geopandas as gpd
    import warnings
    warnings.filterwarnings('ignore')

    print(f"Loading GRW data from {GRW_FILE}...")
    gdf = gpd.read_file(GRW_FILE)
    us = gdf[gdf['COUNTRY'] == 'United States'].copy()
    print(f"  {len(us):,} US solar installations")

    # Convert to WGS84 for centroid extraction
    us_wgs = us.to_crs(epsg=4326)
    centroids = us_wgs.geometry.centroid
    us['lat'] = centroids.y.values
    us['lng'] = centroids.x.values
    us['capacity_mw_est'] = us['area'] / M2_PER_MW

    print(f"  Capacity range: {us['capacity_mw_est'].min():.2f} - {us['capacity_mw_est'].max():.1f} MW")
    return us


def load_db_installations():
    """Load installations from DB via psql CSV export (handles 704K+ records)."""
    import csv
    import subprocess
    import tempfile

    print("Exporting installations from database via psql...")
    csv_path = Path(tempfile.gettempdir()) / "solar_grw_crossref.csv"

    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        f"-c \"\\copy (SELECT id, source_record_id, site_name, state, county, city, zip_code, "
        f"capacity_mw, latitude, longitude, location_precision, install_date, crossref_ids "
        f"FROM solar_installations WHERE is_canonical = true) "
        f"TO '{csv_path}' WITH CSV HEADER\""
    )

    result = subprocess.run(psql_cmd, shell=True, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
        sys.exit(1)

    # Read CSV
    all_records = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Convert types
            row['capacity_mw'] = float(row['capacity_mw']) if row['capacity_mw'] else None
            row['latitude'] = float(row['latitude']) if row['latitude'] else None
            row['longitude'] = float(row['longitude']) if row['longitude'] else None
            # Parse crossref_ids from JSONB text
            cids = row.get('crossref_ids', '')
            if cids and cids not in ('', '[]'):
                try:
                    row['crossref_ids'] = json.loads(cids)
                except (json.JSONDecodeError, ValueError):
                    row['crossref_ids'] = []
            else:
                row['crossref_ids'] = []
            all_records.append(row)

    print(f"  Total: {len(all_records):,} installations loaded from CSV")
    csv_path.unlink(missing_ok=True)
    return all_records


def reverse_geocode_state(lat, lng):
    """Simple state lookup from coordinates using bounding boxes."""
    return None


def download_zcta_shapefile():
    """Download Census ZCTA shapefile for zip code polygon boundaries."""
    import zipfile
    ZCTA_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = ZCTA_DIR / "zcta.zip"
    print(f"    Downloading ZCTA shapefile from {ZCTA_URL}...")
    urllib.request.urlretrieve(ZCTA_URL, zip_path)
    print(f"    Extracting ({zip_path.stat().st_size / 1024 / 1024:.0f} MB)...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(ZCTA_DIR)
    zip_path.unlink()
    print(f"    ZCTA shapefile saved to {ZCTA_DIR}")


def phase1_coord_match(grw_records, db_records, dry_run=False):
    """Phase 1: Match GRW to DB records by coordinate proximity + capacity."""
    print("\n" + "="*60)
    print("Phase 1: Coordinate proximity matching")
    print("="*60)

    # Build spatial index of DB records with coordinates
    db_with_coords = [r for r in db_records if r.get('latitude') and r.get('longitude')]
    print(f"  DB records with coordinates: {len(db_with_coords):,}")

    # Build grid-based spatial index (~0.025 degree cells, ~2.5km)
    # Each cell maps to a list of DB records whose coords fall in that cell
    GRID_SIZE = 0.025  # ~2.5km at mid-latitudes
    grid = {}
    for r in db_with_coords:
        rlat = float(r['latitude'])
        rlng = float(r['longitude'])
        cell = (int(rlat / GRID_SIZE), int(rlng / GRID_SIZE))
        if cell not in grid:
            grid[cell] = []
        grid[cell].append(r)
    print(f"  Spatial grid: {len(grid):,} cells")

    matched = 0
    patches = 0
    errors = 0
    matched_grw_ids = set()

    for idx, grw in grw_records.iterrows():
        grw_lat = grw['lat']
        grw_lng = grw['lng']
        grw_mw = grw['capacity_mw_est']
        grw_area = grw['area']
        grw_year = grw.get('construction_year')
        grw_quarter = grw.get('construction_quarter')

        best_match = None
        best_dist = 999

        # Check nearby grid cells (3x3 neighborhood for 2km search radius)
        center_cell_r = int(grw_lat / GRID_SIZE)
        center_cell_c = int(grw_lng / GRID_SIZE)
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                cell = (center_cell_r + dr, center_cell_c + dc)
                if cell not in grid:
                    continue
                for r in grid[cell]:
                    rlat = float(r['latitude'])
                    rlng = float(r['longitude'])

                    # Quick bounding box filter
                    if abs(rlat - grw_lat) > 0.025 or abs(rlng - grw_lng) > 0.035:
                        continue

                    dist = haversine_km(grw_lat, grw_lng, rlat, rlng)
                    if dist > 2.0:
                        continue

                    # Capacity tolerance: 50% for records with capacity, skip check if no capacity
                    r_mw = r.get('capacity_mw')
                    if r_mw and grw_mw > 0:
                        r_mw = float(r_mw)
                        ratio = max(r_mw, grw_mw) / max(min(r_mw, grw_mw), 0.001)
                        if ratio > 2.0:  # More than 2x difference
                            continue

                    if dist < best_dist:
                        best_dist = dist
                        best_match = r

        if best_match:
            matched += 1
            matched_grw_ids.add(idx)

            # Build patch data
            patch = {}

            # Fill missing coordinates
            if not best_match.get('latitude') or not best_match.get('longitude'):
                patch['latitude'] = round(grw_lat, 7)
                patch['longitude'] = round(grw_lng, 7)
                patch['location_precision'] = 'exact'

            # Fill missing capacity from area estimate
            if not best_match.get('capacity_mw') and grw_mw > 0:
                patch['capacity_mw'] = round(grw_mw, 3)

            # Fill install_date from construction year/quarter
            if not best_match.get('install_date') and grw_year:
                month = (grw_quarter - 1) * 3 + 1 if grw_quarter else 1
                patch['install_date'] = f"{grw_year}-{month:02d}-01"

            # Add GRW cross-reference ID
            crossref_ids = best_match.get('crossref_ids') or []
            grw_ref = f"grw_{idx}"
            if grw_ref not in crossref_ids:
                crossref_ids.append(grw_ref)
                patch['crossref_ids'] = crossref_ids

            if patch and not dry_run:
                ok = supabase_patch("solar_installations", "id", best_match['id'], patch)
                if ok:
                    patches += 1
                else:
                    errors += 1
            elif patch:
                patches += 1

            if matched <= 5:
                print(f"  Match: GRW {grw_mw:.1f}MW @ ({grw_lat:.4f},{grw_lng:.4f}) "
                      f"→ {best_match['source_record_id']} ({best_match.get('capacity_mw','?')}MW) "
                      f"dist={best_dist:.2f}km, patch={list(patch.keys())}")

        if (matched + 1) % 500 == 0:
            print(f"  Progress: {matched:,} matched, {patches:,} patches, {errors} errors")

    print(f"\n  Phase 1 results: {matched:,} matched, {patches:,} patches, {errors} errors")
    return matched_grw_ids


def phase2_zip_capacity_match(grw_records, db_records, matched_ids, dry_run=False):
    """Phase 2: Match unmatched GRW to city/zip-precision targets by zip+capacity."""
    print("\n" + "="*60)
    print("Phase 2: Zip + capacity matching (city/zip-precision records)")
    print("="*60)

    import geopandas as gpd
    from shapely.geometry import Point
    import warnings
    warnings.filterwarnings('ignore')

    unmatched_grw = grw_records[~grw_records.index.isin(matched_ids)]
    print(f"  Unmatched GRW records: {len(unmatched_grw):,}")

    # --- Step 1: Load ZCTA shapefile ---
    zcta_shp = ZCTA_DIR / "tl_2023_us_zcta520.shp"
    if not zcta_shp.exists():
        download_zcta_shapefile()

    print("  Loading ZCTA shapefile...")
    zcta = gpd.read_file(zcta_shp)
    zcta = zcta.to_crs(epsg=4326)
    print(f"  ZCTA polygons: {len(zcta):,}")

    # --- Step 2: Spatial join GRW centroids → zip codes ---
    print("  Spatial joining GRW centroids to ZCTA polygons...")
    grw_gdf = gpd.GeoDataFrame(
        unmatched_grw,
        geometry=[Point(row['lng'], row['lat']) for _, row in unmatched_grw.iterrows()],
        crs="EPSG:4326"
    )

    grw_with_zip = gpd.sjoin(grw_gdf, zcta[['ZCTA5CE20', 'geometry']], how='left', predicate='within')
    grw_valid = grw_with_zip[grw_with_zip['ZCTA5CE20'].notna()].copy()
    grw_valid['zip5'] = grw_valid['ZCTA5CE20'].astype(str).str[:5]
    print(f"  GRW records with zip: {len(grw_valid):,} / {len(unmatched_grw):,}")

    # --- Step 3: Get target records (city/zip precision, have zip + capacity) ---
    targets = [r for r in db_records
               if r.get('location_precision') in ('city', 'zip', 'county')
               and r.get('zip_code')
               and r.get('capacity_mw')
               and float(r['capacity_mw']) > 0]

    targets_by_zip = {}
    for t in targets:
        z = str(t['zip_code']).strip()[:5]
        if z:
            targets_by_zip.setdefault(z, []).append(t)

    print(f"  Target records (city/zip precision + zip + capacity): {len(targets):,}")
    print(f"  Unique target zips: {len(targets_by_zip):,}")

    # --- Step 4: Group GRW by zip and find common zips ---
    grw_by_zip = {}
    for _, grw in grw_valid.iterrows():
        z = str(grw['zip5']).strip()
        grw_by_zip.setdefault(z, []).append(grw)

    common_zips = set(grw_by_zip.keys()) & set(targets_by_zip.keys())
    print(f"  Common zips (GRW ∩ targets): {len(common_zips):,}")

    # --- Step 5: Match by zip + capacity ---
    matched = 0
    patches = 0
    errors = 0
    high_conf = 0
    med_conf = 0
    new_matched_ids = set()
    matched_target_ids = set()

    for zip_code in sorted(common_zips):
        grw_list = grw_by_zip[zip_code]
        target_list = [t for t in targets_by_zip[zip_code] if t['id'] not in matched_target_ids]

        if not target_list:
            continue

        for grw in grw_list:
            grw_mw = grw['capacity_mw_est']
            grw_idx = grw.name

            if grw_idx in new_matched_ids:
                continue

            # Find best capacity match among unmatched targets
            best = None
            best_ratio = 999
            for t in target_list:
                if t['id'] in matched_target_ids:
                    continue
                t_mw = float(t['capacity_mw'])
                if t_mw <= 0 or grw_mw <= 0:
                    continue
                ratio = max(t_mw, grw_mw) / max(min(t_mw, grw_mw), 0.001)
                if ratio <= 2.0 and ratio < best_ratio:
                    best = t
                    best_ratio = ratio

            if not best:
                continue

            # Determine confidence based on uniqueness
            n_grw_in_zip = len(grw_list)
            n_targets_in_zip = len([t for t in target_list if t['id'] not in matched_target_ids])

            if n_grw_in_zip == 1 and n_targets_in_zip == 1:
                confidence = 'HIGH'
                precision = 'exact'
                high_conf += 1
            elif best_ratio <= 1.25:
                confidence = 'HIGH'
                precision = 'exact'
                high_conf += 1
            else:
                confidence = 'MEDIUM'
                precision = 'address'
                med_conf += 1

            # Build patch
            patch = {
                'latitude': round(float(grw['lat']), 7),
                'longitude': round(float(grw['lng']), 7),
                'location_precision': precision,
            }

            # Fill capacity from GRW area estimate if missing
            if not best.get('capacity_mw'):
                patch['capacity_mw'] = round(float(grw_mw), 3)

            # Fill install_date from construction year/quarter
            grw_year = grw.get('construction_year')
            grw_quarter = grw.get('construction_quarter')
            if not best.get('install_date') and grw_year:
                month = (grw_quarter - 1) * 3 + 1 if grw_quarter else 1
                patch['install_date'] = f"{int(grw_year)}-{int(month):02d}-01"

            # Add crossref ID
            crossref_ids = best.get('crossref_ids') or []
            grw_ref = f"grw_{grw_idx}"
            if grw_ref not in crossref_ids:
                crossref_ids.append(grw_ref)
                patch['crossref_ids'] = crossref_ids

            if not dry_run:
                ok = supabase_patch("solar_installations", "id", best['id'], patch)
                if ok:
                    patches += 1
                else:
                    errors += 1
            else:
                patches += 1

            matched += 1
            new_matched_ids.add(grw_idx)
            matched_target_ids.add(best['id'])

            if matched <= 10:
                print(f"  Match: GRW {grw_mw:.2f}MW zip={zip_code} → {best['source_record_id']} "
                      f"({best['capacity_mw']}MW) ratio={best_ratio:.2f} conf={confidence}")

        if matched > 0 and matched % 500 == 0:
            print(f"  Progress: {matched:,} matched, {patches:,} patches, {errors} errors")

    print(f"\n  Phase 2 results: {matched:,} matched, {patches:,} patches, {errors} errors")
    print(f"    HIGH confidence: {high_conf:,}")
    print(f"    MEDIUM confidence: {med_conf:,}")
    return new_matched_ids


def phase3_insert_new(grw_records, matched_ids, dry_run=False):
    """Phase 3: Insert unmatched GRW records as new installations."""
    print("\n" + "="*60)
    print("Phase 3: Insert new GRW-discovered installations")
    print("="*60)

    unmatched = grw_records[~grw_records.index.isin(matched_ids)]
    print(f"  Unmatched GRW records to insert: {len(unmatched):,}")

    # Get data source ID for GRW
    ds = supabase_get("solar_data_sources", {
        "select": "id",
        "name": "eq.grw_microsoft",
        "limit": 1,
    })

    if not ds:
        if dry_run:
            print("  Would create data source: grw_microsoft")
            ds_id = "dry-run-id"
        else:
            # Create data source
            body = json.dumps({
                "name": "grw_microsoft",
                "url": "https://github.com/microsoft/global-renewables-watch",
                "description": "Microsoft Global Renewables Watch - satellite-detected solar installation polygons from Planet Labs imagery (MIT license)",
            }).encode()
            req = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/solar_data_sources",
                data=body, method="POST", headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                })
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read())
                ds_id = result[0]['id'] if isinstance(result, list) else result['id']
                print(f"  Created data source: grw_microsoft (id={ds_id})")
    else:
        ds_id = ds[0]['id']
        print(f"  Data source: grw_microsoft (id={ds_id})")

    # Check existing GRW records to avoid duplicates (via psql for reliability)
    import subprocess
    import tempfile
    existing = set()
    csv_path = Path(tempfile.gettempdir()) / "solar_grw_existing.csv"
    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        f"-c \"\\copy (SELECT source_record_id FROM solar_installations "
        f"WHERE source_record_id LIKE 'grw\\_%') TO '{csv_path}' WITH CSV\""
    )
    result = subprocess.run(psql_cmd, shell=True, capture_output=True, text=True, timeout=60)
    if result.returncode == 0 and csv_path.exists():
        with open(csv_path, 'r') as f:
            for line in f:
                existing.add(line.strip())
        csv_path.unlink(missing_ok=True)

    print(f"  Existing GRW records in DB: {len(existing):,}")

    # Prepare records for insertion
    created = 0
    errors = 0
    batch = []

    for _, grw in unmatched.iterrows():
        src_id = f"grw_{grw.name}"
        if src_id in existing:
            continue

        grw_mw = grw['capacity_mw_est']
        grw_year = grw.get('construction_year')
        grw_quarter = grw.get('construction_quarter')

        # Determine site type from capacity
        if grw_mw >= 1:
            site_type = 'utility'
        elif grw_mw >= 0.025:
            site_type = 'commercial'
        else:
            site_type = 'commercial'

        month = (grw_quarter - 1) * 3 + 1 if grw_quarter else 1
        install_date = f"{grw_year}-{month:02d}-01" if grw_year else None

        record = {
            "source_record_id": src_id,
            "site_name": f"GRW Solar {grw.name}",
            "latitude": round(float(grw['lat']), 7),
            "longitude": round(float(grw['lng']), 7),
            "capacity_mw": round(float(grw_mw), 3),
            "site_type": site_type,
            "site_status": "active",
            "location_precision": "exact",
            "mount_type": "ground",
            "install_date": install_date,
            "data_source_id": ds_id,
        }

        batch.append(record)

        if len(batch) >= 50:
            if not dry_run:
                ok = supabase_post("solar_installations", batch)
                if ok:
                    created += len(batch)
                else:
                    errors += len(batch)
            else:
                created += len(batch)
            batch = []

            if created % 500 == 0:
                print(f"  Progress: {created:,} created, {errors} errors")

    # Flush remaining
    if batch:
        if not dry_run:
            ok = supabase_post("solar_installations", batch)
            if ok:
                created += len(batch)
            else:
                errors += len(batch)
        else:
            created += len(batch)

    print(f"\n  Phase 3 results: {created:,} new installations, {errors} errors")
    return created


def main():
    parser = argparse.ArgumentParser(description="Cross-reference Microsoft GRW solar data")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--phase", type=int, help="Run specific phase only (1, 2, or 3)")
    parser.add_argument("--stats", action="store_true", help="Show GRW stats only")
    args = parser.parse_args()

    if not GRW_FILE.exists():
        print(f"Error: GRW file not found at {GRW_FILE}")
        print("Download from: https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0")
        sys.exit(1)

    # Load GRW data
    grw = load_grw_us()

    if args.stats:
        print("\nGRW US Statistics:")
        print(f"  Total: {len(grw):,}")
        print(f"  Utility (>=1MW est): {(grw['capacity_mw_est'] >= 1).sum():,}")
        print(f"  Commercial (<1MW est): {(grw['capacity_mw_est'] < 1).sum():,}")
        print(f"  Total estimated capacity: {grw['capacity_mw_est'].sum():.0f} MW")
        return

    # Load DB installations
    db = load_db_installations()

    # Phase 1: Coordinate matching
    matched_ids = set()
    if not args.phase or args.phase == 1:
        matched_ids = phase1_coord_match(grw, db, dry_run=args.dry_run)

    # Phase 2: County matching (for records without coords)
    if not args.phase or args.phase == 2:
        phase2_ids = phase2_zip_capacity_match(grw, db, matched_ids, dry_run=args.dry_run)
        matched_ids.update(phase2_ids)

    # If running Phase 3 alone, recover matched IDs from DB crossref_ids
    if args.phase and args.phase >= 3 and not matched_ids:
        print("  Recovering matched GRW IDs from DB crossref_ids...")
        for r in db:
            cids = r.get('crossref_ids', [])
            for cid in cids:
                if isinstance(cid, str) and cid.startswith('grw_'):
                    try:
                        gid = int(cid.replace('grw_', ''))
                        matched_ids.add(gid)
                    except ValueError:
                        pass
        print(f"  Recovered {len(matched_ids):,} matched GRW IDs from DB")

    # Phase 3: Insert new
    if not args.phase or args.phase == 3:
        phase3_insert_new(grw, matched_ids, dry_run=args.dry_run)

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"  GRW US records: {len(grw):,}")
    print(f"  Matched to existing: {len(matched_ids):,}")
    print(f"  Unmatched (new discoveries): {len(grw) - len(matched_ids):,}")
    if args.dry_run:
        print("\n  [DRY RUN - no changes made]")


if __name__ == "__main__":
    main()

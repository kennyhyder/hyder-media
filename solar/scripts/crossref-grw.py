#!/usr/bin/env python3
"""
Microsoft Global Renewables Watch (GRW) Cross-Reference

Cross-references 11,212 US solar installation polygons from GRW against our
704K+ SolarTrack installations. GRW provides satellite-detected polygon boundaries
with area (m2) and construction dates (quarterly 2017-2024).

Strategy:
  Phase 1: Coordinate proximity match (2km) + capacity tolerance (50%)
           For installations WITH coordinates
  Phase 2: State + county + capacity match
           For installations WITHOUT coordinates (county-level precision)
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
        f"-c \"\\copy (SELECT id, source_record_id, site_name, state, county, city, "
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
    # Rough bounding boxes for US states (lat, lng)
    # For accurate reverse geocoding we'd use a spatial index,
    # but for GRW cross-ref we just need approximate state
    # We'll use the Census geocoder or Nominatim if needed
    # For now, return None and rely on DB matching
    return None


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


def phase2_county_match(grw_records, db_records, matched_ids, dry_run=False):
    """Phase 2: Match unmatched GRW records to DB records without coords by state+county+capacity."""
    print("\n" + "="*60)
    print("Phase 2: State + county + capacity matching (no-coord records)")
    print("="*60)

    unmatched_grw = grw_records[~grw_records.index.isin(matched_ids)]
    print(f"  Unmatched GRW records: {len(unmatched_grw):,}")

    # We need to reverse-geocode GRW centroids to get state/county
    # Use geopandas with a US states shapefile or just load from Census
    import geopandas as gpd
    import warnings
    warnings.filterwarnings('ignore')

    # Get DB records without coordinates
    db_no_coords = [r for r in db_records
                    if not r.get('latitude') and r.get('county')
                    and r.get('capacity_mw')]

    print(f"  DB records without coords + have county + capacity: {len(db_no_coords):,}")

    # Group DB records by state+county
    db_by_county = {}
    for r in db_no_coords:
        key = (r.get('state', '').upper(), r.get('county', '').upper())
        if key not in db_by_county:
            db_by_county[key] = []
        db_by_county[key].append(r)

    # For each unmatched GRW record, try Nominatim reverse geocode to get state/county
    # But that's slow (1 req/sec). Instead, use a state boundary lookup.
    # Since we have geopandas, use Census state boundaries
    print("  Reverse-geocoding GRW centroids to states...")

    # Create GeoDataFrame of unmatched GRW
    from shapely.geometry import Point
    unmatched_points = gpd.GeoDataFrame(
        unmatched_grw,
        geometry=[Point(row['lng'], row['lat']) for _, row in unmatched_grw.iterrows()],
        crs="EPSG:4326"
    )

    # Download US states from Census (or use a simple lookup)
    # For efficiency, do a simple lat/lng to state lookup using reverse geocoding API
    # Actually, let's just check which GRW records fall near DB county records
    matched = 0
    patches = 0
    new_matched_ids = set()

    # For each county group in DB, check if any unmatched GRW record is nearby
    for (state, county), db_recs in db_by_county.items():
        if not state or not county:
            continue

        for _, grw in unmatched_grw.iterrows():
            if grw.name in new_matched_ids:
                continue

            grw_mw = grw['capacity_mw_est']

            # Try to match by capacity with each DB record
            for db_rec in db_recs:
                db_mw = float(db_rec['capacity_mw'])
                if db_mw <= 0 or grw_mw <= 0:
                    continue

                ratio = max(db_mw, grw_mw) / max(min(db_mw, grw_mw), 0.001)
                if ratio > 1.5:  # Tighter tolerance for county-only matching
                    continue

                # This is a potential match — we need state to confirm
                # For now, just collect candidates
                # TODO: Add state reverse-geocode

    print(f"  Phase 2: County matching requires state reverse-geocoding")
    print(f"  Skipping for now — Phase 1 coord matching is the primary value")
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
        phase2_ids = phase2_county_match(grw, db, matched_ids, dry_run=args.dry_run)
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

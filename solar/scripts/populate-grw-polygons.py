#!/usr/bin/env python3
"""
Populate GRW polygon boundaries into solar_installations.site_boundary

Reads the GRW GeoPackage, extracts polygon GeoJSON for each US solar installation,
and stores it in the site_boundary JSONB column for ~11K records (both direct GRW
records and cross-referenced installations).

Uses psql temp table + UPDATE JOIN for fast bulk updates (~15K records in seconds).

Usage:
  python3 -u scripts/populate-grw-polygons.py              # Full run
  python3 -u scripts/populate-grw-polygons.py --dry-run     # Preview without patching
  python3 -u scripts/populate-grw-polygons.py --limit 100   # Process first N
"""

import os
import sys
import json
import argparse
import subprocess
import tempfile
import csv
from pathlib import Path
from dotenv import load_dotenv

# Load environment
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

GRW_FILE = Path(__file__).parent.parent / "data" / "grw" / "solar_all_2024q2_v1.gpkg"

PSQL_CMD_PREFIX = (
    "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
    "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
    "-U postgres.ilbovwnhrowvxjdkvrln -d postgres"
)


def run_psql(sql, timeout=300):
    """Run SQL via psql."""
    cmd = f'{PSQL_CMD_PREFIX} -c "{sql}"'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
    return result


def run_psql_file(sql_path, timeout=300):
    """Run SQL file via psql."""
    cmd = f'{PSQL_CMD_PREFIX} -f {sql_path}'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Populate GRW polygon boundaries")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--limit", type=int, help="Process first N records only")
    args = parser.parse_args()

    if not GRW_FILE.exists():
        print(f"Error: GRW file not found at {GRW_FILE}")
        sys.exit(1)

    # --- Step 1: Load GRW GeoPackage ---
    import geopandas as gpd
    from shapely.geometry import mapping
    import warnings
    warnings.filterwarnings('ignore')

    print(f"Loading GRW data from {GRW_FILE}...")
    gdf = gpd.read_file(GRW_FILE)
    us = gdf[gdf['COUNTRY'] == 'United States'].copy()
    print(f"  {len(us):,} US solar polygons")

    # Reproject to WGS84 for GeoJSON output
    us_wgs = us.to_crs(epsg=4326)

    # Build lookup: GRW DataFrame index -> polygon GeoJSON + area
    print("Building polygon lookup...")
    grw_lookup = {}

    def round_coords(coords):
        if isinstance(coords[0], (list, tuple)):
            return [round_coords(c) for c in coords]
        return [round(coords[0], 6), round(coords[1], 6)]

    for idx, row in us_wgs.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        # Simplify polygon to reduce JSONB size (tolerance ~0.00005 degrees, ~5m)
        simplified = geom.simplify(0.00005, preserve_topology=True)
        geojson = mapping(simplified)
        if geojson['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        geojson['coordinates'] = round_coords(geojson['coordinates'])
        grw_lookup[idx] = {
            'geojson': geojson,
            'area_m2': round(float(row['area']), 1) if 'area' in row and row['area'] else None,
        }
    print(f"  {len(grw_lookup):,} polygons in lookup")

    # --- Step 2: Get target installations from DB ---
    print("Querying DB for GRW-linked installations...")
    csv_path = Path(tempfile.gettempdir()) / "solar_grw_targets.csv"

    psql_cmd = (
        f"{PSQL_CMD_PREFIX} "
        f"-c \"\\copy (SELECT id, source_record_id, crossref_ids "
        f"FROM solar_installations "
        f"WHERE source_record_id LIKE 'grw\\_%' "
        f"   OR crossref_ids::text LIKE '%grw\\_%' "
        f") TO '{csv_path}' WITH CSV HEADER\""
    )

    result = subprocess.run(psql_cmd, shell=True, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
        sys.exit(1)

    targets = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            targets.append(row)
    csv_path.unlink(missing_ok=True)
    print(f"  {len(targets):,} target installations")

    if args.limit:
        targets = targets[:args.limit]
        print(f"  Limited to {len(targets):,}")

    # --- Step 3: Match targets to GRW polygons ---
    print("Matching installations to GRW polygons...")
    patches = []
    no_match = 0

    for t in targets:
        src_id = t['source_record_id']
        crossref_raw = t.get('crossref_ids', '')

        grw_idx = None

        # Direct GRW record: source_record_id = "grw_1234"
        if src_id and src_id.startswith('grw_'):
            try:
                grw_idx = int(src_id.replace('grw_', ''))
            except ValueError:
                pass

        # Cross-referenced: crossref_ids contains "grw_1234"
        if grw_idx is None and crossref_raw:
            try:
                cids = json.loads(crossref_raw) if isinstance(crossref_raw, str) else crossref_raw
                for cid in (cids or []):
                    if isinstance(cid, str) and cid.startswith('grw_'):
                        try:
                            grw_idx = int(cid.replace('grw_', ''))
                            break
                        except ValueError:
                            continue
            except (json.JSONDecodeError, TypeError):
                pass

        if grw_idx is None or grw_idx not in grw_lookup:
            no_match += 1
            continue

        poly_data = grw_lookup[grw_idx]
        patches.append({
            "id": t['id'],
            "site_boundary": json.dumps(poly_data['geojson']),
            "area_m2": poly_data['area_m2'],
        })

    print(f"  Matched: {len(patches):,}")
    print(f"  No GRW polygon found: {no_match:,}")

    if not patches:
        print("No patches to apply.")
        return

    # Sample output
    sample = patches[0]
    geojson = json.loads(sample['site_boundary'])
    n_coords = len(geojson.get('coordinates', [[]])[0]) if geojson['type'] == 'Polygon' else '?'
    print(f"\n  Sample: id={sample['id'][:8]}... type={geojson['type']} vertices={n_coords} area={sample.get('area_m2')}m2")

    if args.dry_run:
        print(f"\n[DRY RUN] Would patch {len(patches):,} installations")
        return

    # --- Step 4: Write CSV + SQL for bulk update via psql ---
    print(f"\nApplying {len(patches):,} patches via psql bulk update...")

    # Write patches to CSV for \copy import
    data_csv = Path(tempfile.gettempdir()) / "solar_grw_polygons.csv"
    with open(data_csv, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'site_boundary', 'area_m2'])
        for p in patches:
            writer.writerow([p['id'], p['site_boundary'], p['area_m2'] or ''])

    # Write SQL file for atomic operation
    sql_path = Path(tempfile.gettempdir()) / "solar_grw_polygons.sql"
    with open(sql_path, 'w') as f:
        f.write("""
-- Create temp table
CREATE TEMP TABLE _grw_polys (
    id UUID,
    site_boundary JSONB,
    area_m2 NUMERIC(12,1)
);

-- Import CSV
\\copy _grw_polys FROM '""" + str(data_csv) + """' WITH CSV HEADER;

-- Bulk update
UPDATE solar_installations si
SET site_boundary = gp.site_boundary,
    area_m2 = COALESCE(gp.area_m2, si.area_m2)
FROM _grw_polys gp
WHERE si.id = gp.id;

-- Report
SELECT count(*) AS updated FROM solar_installations WHERE site_boundary IS NOT NULL;

DROP TABLE _grw_polys;
""")

    result = run_psql_file(sql_path, timeout=120)
    print(result.stdout)

    # Cleanup
    data_csv.unlink(missing_ok=True)
    sql_path.unlink(missing_ok=True)

    # Verify
    verify = run_psql(
        "SELECT count(*) AS total, "
        "count(site_boundary) AS with_boundary, "
        "round(avg(area_m2)) AS avg_area "
        "FROM solar_installations WHERE site_boundary IS NOT NULL"
    )
    print(verify.stdout)
    print("Done!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
HIFLD Electric Retail Service Territory Enrichment Script

Uploads 2,919 US utility territory polygons from HIFLD GeoJSON to PostGIS,
then runs per-state spatial joins to fill operator_name on solar installations.

Fallback phases use zip-to-utility and county-to-utility lookups.

Data source: https://hifld-geoplatform.hub.arcgis.com/datasets/electric-retail-service-territories-2
GeoJSON: /tmp/territories_all_simplified.geojson (pre-downloaded, 4.2MB)

Usage:
  python3 -u scripts/enrich-utility-territories.py              # Full enrichment
  python3 -u scripts/enrich-utility-territories.py --skip-upload # Skip territory upload (already done)
  python3 -u scripts/enrich-utility-territories.py --dry-run     # Report without patching
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

GEOJSON_FILE = Path("/tmp/territories_all_simplified.geojson")

# DB connection for psql
DB_HOST = "aws-0-us-west-2.pooler.supabase.com"
DB_PORT = "6543"
DB_USER = "postgres.ilbovwnhrowvxjdkvrln"
DB_NAME = "postgres"
DB_PASS = "#FsW7iqg%EYX&G3M"

# Types to exclude from spatial join (not real distribution utilities)
EXCLUDED_TYPES = (
    'COMMUNITY CHOICE AGGREGATOR',
    'WHOLESALE POWER MARKETER',
    'MUNICIPAL MKTG AUTHORITY',
)


def run_sql(sql, timeout=120):
    """Run SQL via psql, return output."""
    env = os.environ.copy()
    env["PGPASSWORD"] = DB_PASS
    result = subprocess.run(
        ["psql", "-h", DB_HOST, "-p", DB_PORT, "-U", DB_USER, "-d", DB_NAME, "-c", sql],
        capture_output=True, text=True, timeout=timeout, env=env
    )
    if result.returncode != 0:
        print(f"  SQL error: {result.stderr.strip()}")
    return result.stdout.strip()


def upload_territories():
    """Upload HIFLD GeoJSON to solar_utility_territories table."""
    print(f"\n=== Phase 1: Upload HIFLD territories ===")

    if not GEOJSON_FILE.exists():
        print(f"Error: {GEOJSON_FILE} not found. Download from HIFLD ArcGIS first.")
        sys.exit(1)

    with open(GEOJSON_FILE) as f:
        data = json.load(f)

    features = data["features"]
    print(f"  Loaded {len(features)} territory features")

    # Clear existing data
    run_sql("TRUNCATE solar_utility_territories RESTART IDENTITY;")
    print("  Cleared existing territory data")

    # Build INSERT statements in batches
    batch_size = 50
    total_inserted = 0
    errors = 0

    for i in range(0, len(features), batch_size):
        batch = features[i:i+batch_size]
        values = []

        for feat in batch:
            props = feat["properties"]
            geom = feat["geometry"]

            name = (props.get("NAME") or "").replace("'", "''").strip()
            state = (props.get("STATE") or "").replace("'", "''").strip()
            util_type = (props.get("TYPE") or "").replace("'", "''").strip()
            customers = props.get("CUSTOMERS")
            holding_co = (props.get("HOLDING_CO") or "").replace("'", "''").strip()
            hifld_id = str(props.get("ID") or "").replace("'", "''").strip()

            if not name:
                continue

            # Convert geometry to GeoJSON string
            geom_json = json.dumps(geom).replace("'", "''")

            cust_val = f"{customers}" if customers is not None else "NULL"

            # Use ST_MakeValid to fix any geometry issues
            geom_sql = f"ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('{geom_json}'), 4326))"

            values.append(
                f"('{hifld_id}', '{name}', '{state}', '{util_type}', {cust_val}, "
                f"'{holding_co}', {geom_sql})"
            )

        if not values:
            continue

        sql = f"""INSERT INTO solar_utility_territories
            (hifld_id, name, state, type, customers, holding_company, geom)
            VALUES {', '.join(values)};"""

        result = run_sql(sql, timeout=60)
        if "INSERT" in result:
            count = int(result.split(" ")[-1])
            total_inserted += count
        else:
            errors += 1
            print(f"  Batch {i//batch_size + 1} error: {result[:200]}")

        if (i // batch_size + 1) % 10 == 0:
            print(f"  Uploaded {total_inserted} territories...")

    print(f"  Total uploaded: {total_inserted} territories, {errors} batch errors")

    # Verify
    result = run_sql("SELECT COUNT(*) FROM solar_utility_territories;")
    print(f"  Verified in DB: {result}")

    # ANALYZE for query planner
    run_sql("ANALYZE solar_utility_territories;")
    print("  ANALYZE complete")

    return total_inserted


def spatial_join(dry_run=False):
    """Run per-state spatial join to fill operator_name."""
    print(f"\n=== Phase 2: Spatial join (operator_name) ===")

    # Get list of states with NULL operator_name
    result = run_sql("""
        SELECT state, COUNT(*) as cnt
        FROM solar_installations
        WHERE operator_name IS NULL AND state IS NOT NULL
        GROUP BY state ORDER BY cnt DESC;
    """)

    states = []
    for line in result.split("\n"):
        line = line.strip()
        if "|" in line and not line.startswith("-") and not line.startswith("state"):
            parts = [p.strip() for p in line.split("|")]
            if len(parts) == 2 and parts[0] and parts[1].isdigit():
                states.append((parts[0], int(parts[1])))

    print(f"  {len(states)} states with NULL operator_name")
    total_before = sum(c for _, c in states)
    print(f"  Total records needing operator: {total_before}")

    if dry_run:
        print("  [DRY RUN] Would run spatial join per state")
        return 0

    total_patched = 0
    excluded_list = ", ".join(f"'{t}'" for t in EXCLUDED_TYPES)

    for state, count in states:
        safe_state = state.replace("'", "''")

        sql = f"""
        WITH matches AS (
            SELECT DISTINCT ON (i.id)
                i.id,
                t.name as utility_name
            FROM solar_installations i
            JOIN solar_utility_territories t
                ON ST_Within(i.location::geometry, t.geom)
            WHERE i.operator_name IS NULL
            AND i.state = '{safe_state}'
            AND i.location IS NOT NULL
            AND t.type NOT IN ({excluded_list})
            ORDER BY i.id, t.customers ASC NULLS LAST
        )
        UPDATE solar_installations si
        SET operator_name = m.utility_name
        FROM matches m
        WHERE si.id = m.id;
        """

        result = run_sql(sql, timeout=300)

        if "UPDATE" in result:
            patched = int(result.split(" ")[-1])
            total_patched += patched
            if patched > 0:
                print(f"  {state}: {patched} / {count} patched")
        else:
            print(f"  {state}: error - {result[:150]}")

    print(f"\n  Total spatial join patches: {total_patched}")
    return total_patched


def zip_fallback(dry_run=False):
    """Use OpenEI zip-to-utility CSV for records without coordinates."""
    print(f"\n=== Phase 3: Zip-to-utility fallback ===")

    # Count records that still need operator AND have zip but no location
    result = run_sql("""
        SELECT COUNT(*) FROM solar_installations
        WHERE operator_name IS NULL AND zip_code IS NOT NULL;
    """)
    print(f"  Records with zip but no operator: {result}")

    # Download OpenEI CSVs if not present
    import urllib.request

    data_dir = Path(__file__).parent.parent / "data" / "openei"
    data_dir.mkdir(parents=True, exist_ok=True)

    iou_file = data_dir / "iou_zipcodes_2024.csv"
    non_iou_file = data_dir / "non_iou_zipcodes_2024.csv"

    if not iou_file.exists():
        print("  Downloading IOU zip-utility CSV...")
        urllib.request.urlretrieve(
            "https://data.openei.org/files/8563/iou_zipcodes_2024.csv",
            iou_file
        )

    if not non_iou_file.exists():
        print("  Downloading non-IOU zip-utility CSV...")
        urllib.request.urlretrieve(
            "https://data.openei.org/files/8563/non_iou_zipcodes_2024.csv",
            non_iou_file
        )

    # Build zip → utility mapping (prefer IOU)
    import csv

    zip_to_utility = {}

    # Load IOU first (preferred)
    with open(iou_file) as f:
        reader = csv.DictReader(f)
        for row in reader:
            zc = row.get("zip", "").strip()
            name = row.get("utility_name", "").strip()
            if zc and name and zc not in zip_to_utility:
                zip_to_utility[zc] = name

    # Load non-IOU (only if zip not already mapped to IOU)
    with open(non_iou_file) as f:
        reader = csv.DictReader(f)
        for row in reader:
            zc = row.get("zip", "").strip()
            name = row.get("utility_name", "").strip()
            if zc and name and zc not in zip_to_utility:
                zip_to_utility[zc] = name

    print(f"  Loaded {len(zip_to_utility)} unique zip→utility mappings")

    if dry_run:
        print("  [DRY RUN] Would patch via zip lookup")
        return 0

    # Get all zip codes with NULL operator
    result = run_sql("""
        SELECT DISTINCT zip_code FROM solar_installations
        WHERE operator_name IS NULL AND zip_code IS NOT NULL
        ORDER BY zip_code;
    """)

    zips_needing = []
    for line in result.split("\n"):
        line = line.strip()
        if line and not line.startswith("-") and not line.startswith("zip") and line != "(0 rows)":
            zips_needing.append(line)

    print(f"  {len(zips_needing)} unique zip codes need operator")

    total_patched = 0
    batch = []

    for zc in zips_needing:
        utility = zip_to_utility.get(zc)
        if not utility:
            continue

        safe_name = utility.replace("'", "''")
        safe_zip = zc.replace("'", "''")

        batch.append(f"WHEN zip_code = '{safe_zip}' THEN '{safe_name}'")

        if len(batch) >= 200:
            sql = f"""
            UPDATE solar_installations
            SET operator_name = CASE {' '.join(batch)} END
            WHERE operator_name IS NULL
            AND zip_code IN ({', '.join(f"'{z}'" for z in zips_needing[:200])});
            """
            result = run_sql(sql, timeout=120)
            if "UPDATE" in result:
                patched = int(result.split(" ")[-1])
                total_patched += patched
            batch = []
            zips_needing = zips_needing[200:]

    # Remaining batch — do it per-zip for simplicity
    if batch:
        for zc in zips_needing:
            utility = zip_to_utility.get(zc)
            if not utility:
                continue
            safe_name = utility.replace("'", "''")
            safe_zip = zc.replace("'", "''")
            sql = f"""
            UPDATE solar_installations SET operator_name = '{safe_name}'
            WHERE operator_name IS NULL AND zip_code = '{safe_zip}';
            """
            result = run_sql(sql, timeout=30)
            if "UPDATE" in result:
                patched = int(result.split(" ")[-1])
                total_patched += patched

    print(f"  Total zip fallback patches: {total_patched}")
    return total_patched


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-upload", action="store_true", help="Skip territory upload")
    parser.add_argument("--dry-run", action="store_true", help="Report without patching")
    parser.add_argument("--phase", type=int, help="Run specific phase only (1=upload, 2=spatial, 3=zip)")
    args = parser.parse_args()

    print("=== HIFLD Utility Territory Operator Enrichment ===")

    # Check current operator coverage
    result = run_sql("""
        SELECT COUNT(*) as total,
               COUNT(operator_name) as with_op,
               ROUND(100.0 * COUNT(operator_name) / COUNT(*), 1) as pct
        FROM solar_installations;
    """)
    print(f"\nCurrent operator coverage: {result}")

    if args.phase is None or args.phase == 1:
        if not args.skip_upload:
            upload_territories()
        else:
            print("\n  [Skipping territory upload]")

    if args.phase is None or args.phase == 2:
        spatial_join(dry_run=args.dry_run)

    if args.phase is None or args.phase == 3:
        zip_fallback(dry_run=args.dry_run)

    # Final stats
    result = run_sql("""
        SELECT COUNT(*) as total,
               COUNT(operator_name) as with_op,
               ROUND(100.0 * COUNT(operator_name) / COUNT(*), 1) as pct
        FROM solar_installations;
    """)
    print(f"\nFinal operator coverage: {result}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
FEMA Flood Zone Enrichment — Query FEMA NFHL for flood risk per installation.

Queries FEMA National Flood Hazard Layer (NFHL) MapServer Layer 28 (Flood Hazard Zones)
using point-in-polygon spatial queries. Adds flood_zone, flood_zone_sfha, and flood_zone_bfe
to each installation with exact coordinates.

API: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query
- Free, no auth, no API key required
- Point-in-polygon spatial queries supported
- Returns FLD_ZONE (A, AE, V, VE, X, D), SFHA_TF (T/F), STATIC_BFE (elevation)

Usage:
  python3 -u scripts/enrich-fema-flood.py              # Full run (~400K records)
  python3 -u scripts/enrich-fema-flood.py --dry-run     # Preview without patching
  python3 -u scripts/enrich-fema-flood.py --limit 1000   # Process first N
  python3 -u scripts/enrich-fema-flood.py --state CA     # Single state
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

PSQL_CMD = "PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres"

# FEMA NFHL MapServer Layer 28 - Flood Hazard Zones
FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"

WORKERS = 5
BATCH_SIZE = 500  # Patch flush threshold


def fema_query(lat, lng, retries=3):
    """Query FEMA NFHL for flood zone at a specific point."""
    params = {
        "where": "1=1",
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE",
        "returnGeometry": "false",
        "f": "json",
    }
    url = FEMA_URL + "?" + urllib.parse.urlencode(params)

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SolarTrack/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())

            features = data.get("features", [])
            if not features:
                return None  # No flood zone data for this location

            attrs = features[0].get("attributes", {})
            fld_zone = attrs.get("FLD_ZONE")
            sfha_tf = attrs.get("SFHA_TF")
            static_bfe = attrs.get("STATIC_BFE")

            if not fld_zone:
                return None

            result = {
                "flood_zone": fld_zone,
                "flood_zone_sfha": sfha_tf == "T",
            }

            # BFE: -9999 is the null sentinel
            if static_bfe is not None and static_bfe != -9999 and static_bfe != -9999.0:
                result["flood_zone_bfe"] = float(static_bfe)

            return result

        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                time.sleep(wait)
            else:
                return None  # Skip on persistent failure
        except Exception:
            return None


def supabase_patch(table, data, match_filter, retries=3):
    """PATCH a single record in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_filter}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data, allow_nan=False).encode()

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                return False


def process_installation(inst):
    """Query FEMA for a single installation and return patch if found."""
    inst_id, lat, lng = inst
    result = fema_query(lat, lng)
    if result:
        return (inst_id, result)
    return None


def main():
    parser = argparse.ArgumentParser(description="Enrich installations with FEMA flood zone data")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--limit", type=int, default=0, help="Process first N records")
    parser.add_argument("--state", type=str, default=None, help="Single state filter")
    args = parser.parse_args()

    print("FEMA Flood Zone Enrichment")
    print("=" * 60)
    print(f"  API: {FEMA_URL}")
    print(f"  Workers: {WORKERS}")
    print(f"  Dry run: {args.dry_run}")
    if args.limit:
        print(f"  Limit: {args.limit}")
    if args.state:
        print(f"  State: {args.state}")

    # Load installations via psql (avoids REST API pagination issues)
    print("\nLoading installations with coordinates and no flood zone...")

    where_clause = "WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND flood_zone IS NULL"
    if args.state:
        where_clause += f" AND state = '{args.state.upper()}'"
    limit_clause = f" LIMIT {args.limit}" if args.limit else ""

    sql = f"""
    SELECT json_agg(row_to_json(t)) FROM (
      SELECT id, latitude, longitude
      FROM solar_installations
      {where_clause}
      ORDER BY location_precision ASC, id
      {limit_clause}
    ) t;
    """

    result = subprocess.run(
        f"{PSQL_CMD} -t -A -c \"{sql.strip()}\"",
        shell=True, capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr.strip()}")
        sys.exit(1)

    raw = result.stdout.strip()
    if not raw or raw == "null":
        print("  No installations to process!")
        return

    records = json.loads(raw)
    print(f"  Loaded {len(records)} installations")

    # Prepare work items
    work_items = [(r["id"], float(r["latitude"]), float(r["longitude"])) for r in records]

    # Process with thread pool
    print(f"\nQuerying FEMA NFHL ({WORKERS} workers)...")
    queried = 0
    found = 0
    errors = 0
    patches = []
    patch_errors = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(process_installation, item): item for item in work_items}

        for future in as_completed(futures):
            queried += 1
            try:
                result = future.result()
                if result:
                    found += 1
                    patches.append(result)
                # else: no flood zone data (FEMA coverage gap or open water)
            except Exception:
                errors += 1

            # Flush patches periodically
            if len(patches) >= BATCH_SIZE and not args.dry_run:
                print(f"  FLUSH: {len(patches)} patches at position {queried}...")
                for inst_id, patch in patches:
                    ok = supabase_patch("solar_installations", patch, f"id=eq.{inst_id}")
                    if not ok:
                        patch_errors += 1
                patches = []

            if queried % 1000 == 0:
                elapsed = time.time() - start_time
                rate = queried / elapsed if elapsed > 0 else 0
                pct = queried / len(work_items) * 100
                print(f"  [{pct:.1f}%] {queried}/{len(work_items)} queried, "
                      f"{found} found ({found/queried*100:.1f}%), "
                      f"{errors} errors, {rate:.1f} queries/sec")

    # Final flush
    if patches and not args.dry_run:
        print(f"  FLUSH: {len(patches)} remaining patches...")
        for inst_id, patch in patches:
            ok = supabase_patch("solar_installations", patch, f"id=eq.{inst_id}")
            if not ok:
                patch_errors += 1
        patches = []

    elapsed = time.time() - start_time

    print(f"\n{'='*60}")
    print("FEMA Flood Zone Summary")
    print(f"{'='*60}")
    print(f"  Queried: {queried}")
    print(f"  Found: {found} ({found/max(queried,1)*100:.1f}%)")
    print(f"  No data: {queried - found - errors}")
    print(f"  Errors: {errors}")
    print(f"  Patch errors: {patch_errors}")
    print(f"  Time: {elapsed/60:.1f} min ({queried/max(elapsed,1):.1f} queries/sec)")

    if args.dry_run and found > 0:
        print(f"\n  [DRY RUN] Sample patches:")
        # Collect some results for display
        sample = [(inst_id, patch) for inst_id, patch in
                  [(r["id"], fema_query(float(r["latitude"]), float(r["longitude"])))
                   for r in records[:20]]
                  if patch is not None]
        for inst_id, patch in sample[:10]:
            print(f"    {inst_id}: {patch}")

    print("\nDone!")


if __name__ == "__main__":
    main()

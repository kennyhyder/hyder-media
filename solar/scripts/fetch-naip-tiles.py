#!/usr/bin/env python3
"""
Download satellite imagery tiles for zip codes containing solar targets.

Supports two sources:
  - NAIP: Free 0.6m resolution USGS aerial imagery (ML allowed, no API key)
  - Google Maps: ~0.15m resolution satellite tiles (proven NREL detection, $2/1K tiles)

Downloads tiles centered on zip code centroids for zips with city/zip-level
coordinate installations. Tiles are scanned by NREL Panel-Segmentation model.

Usage:
    python3 -u scripts/fetch-naip-tiles.py --source google   # Google Maps (recommended)
    python3 -u scripts/fetch-naip-tiles.py --source naip     # NAIP (free but low detection)
    python3 -u scripts/fetch-naip-tiles.py --tier A           # Tier A only (1 target/zip)
    python3 -u scripts/fetch-naip-tiles.py --dry-run          # Count tiles only
    python3 -u scripts/fetch-naip-tiles.py --zip 94102        # Specific zip
    python3 -u scripts/fetch-naip-tiles.py --state CA         # Specific state
    python3 -u scripts/fetch-naip-tiles.py --limit 1000       # Max tiles
    python3 -u scripts/fetch-naip-tiles.py --workers 3        # Parallel downloads
    python3 -u scripts/fetch-naip-tiles.py --use-grw          # Center tiles on GRW detections

Google Maps cost: ~$2 per 1,000 tiles ($200/mo free credit covers ~100K tiles)
"""

import argparse
import base64
import csv
import hashlib
import hmac
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
GOOGLE_MAPS_SIGNING_SECRET = os.environ.get("GOOGLE_MAPS_SIGNING_SECRET", "").strip()

NAIP_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"
ZCTA_DIR = Path(__file__).parent.parent / "data" / "zcta_shapes"
ZCTA_URL = "https://www2.census.gov/geo/tiger/TIGER2023/ZCTA520/tl_2023_us_zcta520.zip"
TILE_DIR = Path(__file__).parent.parent / "data" / "naip_tiles"
GRW_FILE = Path(__file__).parent.parent / "data" / "grw" / "solar_all_2024q2_v1.gpkg"

TILE_SIZE = 640       # pixels
OVERLAP = 0.25        # 25% overlap between adjacent tiles

# Default NAIP resolution (overridden for Google Maps in main())
PIXEL_M = 0.6         # meters per pixel at NAIP native resolution
TILE_SPAN_M = TILE_SIZE * PIXEL_M  # 384m
STRIDE_M = TILE_SPAN_M * (1 - OVERLAP)  # 288m

# Convert meters to approximate degrees at mid-latitudes (~38N for US average)
M_PER_DEG_LAT = 111320
M_PER_DEG_LNG_38 = 111320 * math.cos(math.radians(38))
TILE_SPAN_LAT = TILE_SPAN_M / M_PER_DEG_LAT   # ~0.00345 degrees
TILE_SPAN_LNG = TILE_SPAN_M / M_PER_DEG_LNG_38  # ~0.00438 degrees
STRIDE_LAT = STRIDE_M / M_PER_DEG_LAT
STRIDE_LNG = STRIDE_M / M_PER_DEG_LNG_38


def recalc_tile_params(pixel_m):
    """Recalculate tile geometry globals for a given pixel resolution."""
    global PIXEL_M, TILE_SPAN_M, STRIDE_M
    global TILE_SPAN_LAT, TILE_SPAN_LNG, STRIDE_LAT, STRIDE_LNG
    PIXEL_M = pixel_m
    TILE_SPAN_M = TILE_SIZE * PIXEL_M
    STRIDE_M = TILE_SPAN_M * (1 - OVERLAP)
    TILE_SPAN_LAT = TILE_SPAN_M / M_PER_DEG_LAT
    TILE_SPAN_LNG = TILE_SPAN_M / M_PER_DEG_LNG_38
    STRIDE_LAT = STRIDE_M / M_PER_DEG_LAT
    STRIDE_LNG = STRIDE_M / M_PER_DEG_LNG_38

MAX_TILES_PER_ZIP = 200   # Large zips get centered grid capped at this
DOWNLOAD_WORKERS = 3
RATE_LIMIT = 0.2  # seconds between requests


def download_zcta_shapefile():
    """Download Census ZCTA shapefile if not present."""
    import zipfile
    ZCTA_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = ZCTA_DIR / "zcta.zip"
    print(f"  Downloading ZCTA shapefile from Census Bureau...")
    urllib.request.urlretrieve(ZCTA_URL, zip_path)
    print(f"  Extracting ({zip_path.stat().st_size / 1024 / 1024:.0f} MB)...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(ZCTA_DIR)
    zip_path.unlink()
    print(f"  Saved to {ZCTA_DIR}")


def load_targets():
    """Load target installations: city/zip precision, have zip + capacity, no exact coords."""
    csv_path = Path(tempfile.gettempdir()) / "solar_naip_targets.csv"
    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        "-c \"\\copy (SELECT id, source_record_id, zip_code, capacity_mw, state, city, "
        "site_type, location_precision "
        "FROM solar_installations "
        "WHERE location_precision IN ('city','zip','county') "
        "AND zip_code IS NOT NULL AND zip_code != '' "
        "AND capacity_mw IS NOT NULL AND capacity_mw > 0 "
        "AND is_canonical = true) "
        f"TO '{csv_path}' WITH CSV HEADER\""
    )
    result = subprocess.run(psql_cmd, shell=True, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
        sys.exit(1)

    targets = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row['capacity_mw'] = float(row['capacity_mw']) if row['capacity_mw'] else None
            targets.append(row)
    csv_path.unlink(missing_ok=True)
    return targets


def load_grw_unmatched_by_zip(zcta_gdf):
    """Load GRW records not yet matched, assign zip codes via spatial join."""
    if not GRW_FILE.exists():
        return {}

    import geopandas as gpd
    from shapely.geometry import Point
    import warnings
    warnings.filterwarnings('ignore')

    print("  Loading GRW unmatched records...")
    gdf = gpd.read_file(GRW_FILE)
    us = gdf[gdf['COUNTRY'] == 'United States'].copy()
    us_wgs = us.to_crs(epsg=4326)
    centroids = us_wgs.geometry.centroid
    us['lat'] = centroids.y.values
    us['lng'] = centroids.x.values
    us['area_m2'] = us['area']

    # Check which GRW records are already cross-referenced in DB
    csv_path = Path(tempfile.gettempdir()) / "solar_grw_existing.csv"
    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        "-c \"\\copy (SELECT source_record_id FROM solar_installations "
        "WHERE source_record_id LIKE 'grw\\_%') TO '{csv_path}' WITH CSV\""
    )
    result = subprocess.run(psql_cmd.format(csv_path=csv_path), shell=True,
                            capture_output=True, text=True, timeout=60)
    existing_grw = set()
    if result.returncode == 0 and csv_path.exists():
        with open(csv_path, 'r') as f:
            for line in f:
                existing_grw.add(line.strip())
        csv_path.unlink(missing_ok=True)

    # Filter to unmatched
    unmatched_indices = [idx for idx in us.index if f"grw_{idx}" not in existing_grw]
    unmatched = us.loc[unmatched_indices]
    print(f"  GRW unmatched: {len(unmatched):,}")

    if len(unmatched) == 0:
        return {}

    # Spatial join to get zip codes
    grw_gdf = gpd.GeoDataFrame(
        unmatched,
        geometry=[Point(row['lng'], row['lat']) for _, row in unmatched.iterrows()],
        crs="EPSG:4326"
    )
    grw_with_zip = gpd.sjoin(grw_gdf, zcta_gdf[['ZCTA5CE20', 'geometry']],
                              how='left', predicate='within')
    grw_valid = grw_with_zip[grw_with_zip['ZCTA5CE20'].notna()]

    # Group by zip
    grw_by_zip = {}
    for _, row in grw_valid.iterrows():
        z = str(row['ZCTA5CE20'])[:5]
        grw_by_zip.setdefault(z, []).append({
            'lat': float(row['lat']),
            'lng': float(row['lng']),
            'area_m2': float(row['area_m2']),
        })

    print(f"  GRW detections in {len(grw_by_zip):,} zips")
    return grw_by_zip


def compute_tile_grid(bbox, grw_centers=None, max_tiles=200):
    """Compute tile grid covering a bounding box, optionally centered on GRW detections.

    For zips larger than max_tiles, creates a centered grid capped at max_tiles
    rather than skipping the zip entirely.
    """
    min_lat, min_lng, max_lat, max_lng = bbox

    tiles = []

    if grw_centers:
        # Center tiles on GRW detection coordinates instead of gridding entire zip
        for center in grw_centers:
            clat, clng = center['lat'], center['lng']
            # 3x3 grid of tiles centered on detection (covers ~1km x 1km)
            for dr in range(-1, 2):
                for dc in range(-1, 2):
                    tlat = clat + dr * STRIDE_LAT
                    tlng = clng + dc * STRIDE_LNG
                    tiles.append({
                        'min_lat': tlat - TILE_SPAN_LAT / 2,
                        'max_lat': tlat + TILE_SPAN_LAT / 2,
                        'min_lng': tlng - TILE_SPAN_LNG / 2,
                        'max_lng': tlng + TILE_SPAN_LNG / 2,
                    })
        # Deduplicate overlapping tiles (from multiple GRW centers)
        if len(grw_centers) > 1:
            seen = set()
            unique = []
            for t in tiles:
                key = (round(t['min_lat'], 5), round(t['min_lng'], 5))
                if key not in seen:
                    seen.add(key)
                    unique.append(t)
            tiles = unique
    else:
        # Calculate full grid dimensions
        n_rows = max(1, math.ceil((max_lat - min_lat) / STRIDE_LAT))
        n_cols = max(1, math.ceil((max_lng - min_lng) / STRIDE_LNG))
        full_count = n_rows * n_cols

        if full_count <= max_tiles:
            # Small zip: grid the entire bounding box
            lat = min_lat
            while lat < max_lat:
                lng = min_lng
                while lng < max_lng:
                    tiles.append({
                        'min_lat': lat,
                        'max_lat': lat + TILE_SPAN_LAT,
                        'min_lng': lng,
                        'max_lng': lng + TILE_SPAN_LNG,
                    })
                    lng += STRIDE_LNG
                lat += STRIDE_LAT
        else:
            # Large zip: create centered grid capped at max_tiles
            center_lat = (min_lat + max_lat) / 2
            center_lng = (min_lng + max_lng) / 2
            side = int(math.sqrt(max_tiles))
            half = side // 2
            for r in range(-half, half + 1):
                for c in range(-half, half + 1):
                    if len(tiles) >= max_tiles:
                        break
                    tlat = center_lat + r * STRIDE_LAT
                    tlng = center_lng + c * STRIDE_LNG
                    tiles.append({
                        'min_lat': tlat,
                        'max_lat': tlat + TILE_SPAN_LAT,
                        'min_lng': tlng,
                        'max_lng': tlng + TILE_SPAN_LNG,
                    })

    return tiles


def download_naip_tile(tile_bbox, save_path, retries=3):
    """Download a single NAIP tile from USGS ImageServer."""
    bbox_str = f"{tile_bbox['min_lng']},{tile_bbox['min_lat']},{tile_bbox['max_lng']},{tile_bbox['max_lat']}"
    params = {
        'bbox': bbox_str,
        'bboxSR': '4326',
        'imageSR': '4326',
        'size': f'{TILE_SIZE},{TILE_SIZE}',
        'format': 'png',
        'f': 'image',
        'interpolation': 'RSP_BilinearInterpolation',
    }
    url = NAIP_URL + "?" + urllib.parse.urlencode(params)

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'SolarTrack/1.0 (solar panel detection research)',
            })
            resp = urllib.request.urlopen(req, timeout=60)
            content = resp.read()

            ct = resp.headers.get('Content-Type', '')
            if 'image' not in ct:
                return False, f"Not an image: {ct}"
            if len(content) < 500:
                return False, f"Too small ({len(content)} bytes)"

            save_path.parent.mkdir(parents=True, exist_ok=True)
            with open(save_path, 'wb') as f:
                f.write(content)
            return True, None
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return False, str(e)


def sign_url(input_url, secret):
    """Sign a Google Maps URL with HMAC-SHA1."""
    url = urllib.parse.urlparse(input_url)
    url_to_sign = url.path + "?" + url.query
    decoded_key = base64.urlsafe_b64decode(secret)
    signature = hmac.new(decoded_key, url_to_sign.encode(), hashlib.sha1)
    encoded_sig = base64.urlsafe_b64encode(signature.digest()).decode()
    return input_url + "&signature=" + encoded_sig


def download_google_tile(center_lat, center_lng, zoom, save_path, retries=3):
    """Download a single satellite tile from Google Maps Static API."""
    url = (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={center_lat},{center_lng}&zoom={zoom}&size={TILE_SIZE}x{TILE_SIZE}"
        f"&maptype=satellite&key={GOOGLE_MAPS_API_KEY}"
    )
    if GOOGLE_MAPS_SIGNING_SECRET:
        url = sign_url(url, GOOGLE_MAPS_SIGNING_SECRET)

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=30)
            content = resp.read()

            if len(content) < 1000:
                return False, f"Too small ({len(content)} bytes)"

            save_path.parent.mkdir(parents=True, exist_ok=True)
            with open(save_path, 'wb') as f:
                f.write(content)
            return True, None
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return False, str(e)


def main():
    parser = argparse.ArgumentParser(description="Download satellite tiles for solar detection")
    parser.add_argument("--source", type=str, default="google", choices=["google", "naip"],
                        help="Tile source: google (recommended, $2/1K) or naip (free but low detection)")
    parser.add_argument("--zoom", type=int, default=18,
                        help="Google Maps zoom level (default: 18, proven 65%% detection)")
    parser.add_argument("--dry-run", action="store_true", help="Count tiles without downloading")
    parser.add_argument("--tier", type=str, default="AB", help="Tiers to process: A, B, AB (default)")
    parser.add_argument("--zip", type=str, help="Specific zip code(s), comma-separated")
    parser.add_argument("--state", type=str, help="Filter by state (2-letter code)")
    parser.add_argument("--limit", type=int, default=0, help="Max tiles to download")
    parser.add_argument("--workers", type=int, default=DOWNLOAD_WORKERS, help="Parallel workers")
    parser.add_argument("--use-grw", action="store_true",
                        help="Center tiles on GRW detections instead of gridding full zip")
    parser.add_argument("--min-capacity", type=float, default=0.1,
                        help="Min target capacity in MW (default: 0.1 = 100 kW)")
    parser.add_argument("--max-tiles-per-zip", type=int, default=MAX_TILES_PER_ZIP,
                        help=f"Max tiles per zip — large zips get centered grid (default: {MAX_TILES_PER_ZIP})")
    args = parser.parse_args()

    # Recalculate tile geometry for Google Maps zoom level
    if args.source == 'google':
        if not GOOGLE_MAPS_API_KEY:
            print("Error: GOOGLE_MAPS_API_KEY must be set in .env.local for --source google")
            sys.exit(1)
        # Google Maps resolution: 156543.03392 * cos(lat) / 2^zoom  m/pixel
        pixel_m = 156543.03392 * math.cos(math.radians(38)) / (2 ** args.zoom)
        recalc_tile_params(pixel_m)

    src_label = f"Google Maps (zoom {args.zoom})" if args.source == 'google' else "NAIP (0.6m)"
    print("Satellite Tile Downloader for Solar Detection")
    print("=" * 60)
    print(f"  Source: {src_label}")
    print(f"  Tile size: {TILE_SIZE}x{TILE_SIZE} px ({TILE_SPAN_M:.0f}m x {TILE_SPAN_M:.0f}m)")
    print(f"  Overlap: {OVERLAP*100:.0f}% (stride: {STRIDE_M:.0f}m)")
    print(f"  Tiers: {args.tier}")
    print(f"  Min capacity: {args.min_capacity} MW ({args.min_capacity*1000:.0f} kW)")
    print(f"  Max tiles/zip: {args.max_tiles_per_zip}")
    print(f"  Workers: {args.workers}")
    print(f"  Dry run: {args.dry_run}")
    if args.source == 'google':
        cost_est = len([]) # placeholder, calculated later
        print(f"  URL signing: {'yes' if GOOGLE_MAPS_SIGNING_SECRET else 'no'}")
    print()

    # --- Load target records ---
    print("Loading target installations from database...")
    targets = load_targets()
    print(f"  Total targets: {len(targets):,}")

    # Filter by capacity
    targets = [t for t in targets if t['capacity_mw'] and t['capacity_mw'] >= args.min_capacity]
    print(f"  After capacity filter (>= {args.min_capacity} MW): {len(targets):,}")

    # Filter by state
    if args.state:
        targets = [t for t in targets if t.get('state', '').upper() == args.state.upper()]
        print(f"  After state filter ({args.state}): {len(targets):,}")

    # Group by zip
    by_zip = {}
    for t in targets:
        z = str(t['zip_code']).strip()[:5]
        if z:
            by_zip.setdefault(z, []).append(t)

    # Classify into tiers
    tier_a = {z: ts for z, ts in by_zip.items() if len(ts) == 1}
    tier_b = {z: ts for z, ts in by_zip.items() if 2 <= len(ts) <= 3}
    tier_c = {z: ts for z, ts in by_zip.items() if len(ts) >= 4}

    print(f"\n  Tier A (1 target/zip): {len(tier_a):,} zips, {sum(len(v) for v in tier_a.values()):,} targets")
    print(f"  Tier B (2-3/zip):      {len(tier_b):,} zips, {sum(len(v) for v in tier_b.values()):,} targets")
    print(f"  Tier C (4+/zip):       {len(tier_c):,} zips, {sum(len(v) for v in tier_c.values()):,} targets (skipped)")

    # Select zips to process
    process_zips = {}
    if 'A' in args.tier.upper():
        process_zips.update(tier_a)
    if 'B' in args.tier.upper():
        process_zips.update(tier_b)

    if args.zip:
        specific = set(args.zip.split(','))
        process_zips = {z: ts for z, ts in process_zips.items() if z in specific}

    print(f"\n  Zips to process: {len(process_zips):,}")

    if not process_zips:
        print("  No zips to process!")
        return

    # --- Load ZCTA shapefile for bounding boxes ---
    zcta_shp = ZCTA_DIR / "tl_2023_us_zcta520.shp"
    if not zcta_shp.exists():
        download_zcta_shapefile()

    import geopandas as gpd
    import warnings
    warnings.filterwarnings('ignore')

    print("\nLoading ZCTA shapefile for zip bounding boxes...")
    zcta = gpd.read_file(zcta_shp)
    zcta = zcta.to_crs(epsg=4326)
    zcta['zip5'] = zcta['ZCTA5CE20'].astype(str).str[:5]
    zcta_lookup = {row['zip5']: row['geometry'].bounds for _, row in zcta.iterrows()}
    print(f"  ZCTA bounding boxes: {len(zcta_lookup):,}")

    # --- Optionally load GRW detections ---
    grw_by_zip = {}
    if args.use_grw:
        grw_by_zip = load_grw_unmatched_by_zip(zcta)

    # --- Compute tile grids ---
    print("\nComputing tile grids...")
    all_tiles = []  # (zip_code, tile_idx, tile_bbox)
    zips_with_tiles = 0
    zips_skipped = 0
    zips_capped = 0

    for zip_code, targets_in_zip in sorted(process_zips.items()):
        if zip_code not in zcta_lookup:
            zips_skipped += 1
            continue

        bounds = zcta_lookup[zip_code]  # (minx, miny, maxx, maxy)
        bbox = (bounds[1], bounds[0], bounds[3], bounds[2])  # (min_lat, min_lng, max_lat, max_lng)

        grw_centers = grw_by_zip.get(zip_code) if args.use_grw else None

        # Check if zip would need capping
        if not grw_centers:
            n_rows = max(1, math.ceil((bbox[2] - bbox[0]) / STRIDE_LAT))
            n_cols = max(1, math.ceil((bbox[3] - bbox[1]) / STRIDE_LNG))
            if n_rows * n_cols > args.max_tiles_per_zip:
                zips_capped += 1

        tiles = compute_tile_grid(bbox, grw_centers=grw_centers,
                                   max_tiles=args.max_tiles_per_zip)

        if tiles:
            zips_with_tiles += 1
            for i, tile in enumerate(tiles):
                all_tiles.append((zip_code, i, tile))

    print(f"  Zips with tiles: {zips_with_tiles:,}")
    print(f"  Zips skipped (no ZCTA match): {zips_skipped:,}")
    print(f"  Zips with centered grid (too large for full coverage): {zips_capped:,}")
    print(f"  Total tiles: {len(all_tiles):,}")

    if args.limit and len(all_tiles) > args.limit:
        all_tiles = all_tiles[:args.limit]
        print(f"  Limited to: {len(all_tiles):,}")

    # Check existing tiles
    existing = 0
    tiles_to_download = []
    for zip_code, tile_idx, tile_bbox in all_tiles:
        save_path = TILE_DIR / zip_code / f"{tile_idx}.png"
        if save_path.exists():
            existing += 1
        else:
            tiles_to_download.append((zip_code, tile_idx, tile_bbox))

    print(f"  Already downloaded: {existing:,}")
    print(f"  To download: {len(tiles_to_download):,}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No tiles downloaded.")
        # Save manifest for planning
        manifest_path = TILE_DIR / "plan.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        plan = {
            'source': args.source,
            'zoom': args.zoom if args.source == 'google' else None,
            'tile_span_m': round(TILE_SPAN_M, 1),
            'total_tiles': len(all_tiles),
            'to_download': len(tiles_to_download),
            'zips': zips_with_tiles,
            'tiers': args.tier,
            'est_cost': round(len(tiles_to_download) * 0.002, 2) if args.source == 'google' else 0,
        }
        with open(manifest_path, 'w') as f:
            json.dump(plan, f, indent=2)
        print(f"  Plan saved to {manifest_path}")
        return

    if not tiles_to_download:
        print("\n  All tiles already downloaded!")
        return

    # --- Download tiles ---
    cost_str = ""
    if args.source == 'google':
        est_cost = len(tiles_to_download) * 0.002
        cost_str = f" (est. ${est_cost:.2f})"
    print(f"\nDownloading {len(tiles_to_download):,} {args.source} tiles{cost_str}...")
    downloaded = 0
    errors = 0
    error_samples = []
    start_time = time.time()

    # Write manifests per zip as we go
    manifests = {}  # zip -> list of tile info

    def _download_one(item):
        zip_code, tile_idx, tile_bbox = item
        save_path = TILE_DIR / zip_code / f"{tile_idx}.png"
        time.sleep(RATE_LIMIT)
        if args.source == 'google':
            center_lat = (tile_bbox['min_lat'] + tile_bbox['max_lat']) / 2
            center_lng = (tile_bbox['min_lng'] + tile_bbox['max_lng']) / 2
            ok, err = download_google_tile(center_lat, center_lng, args.zoom, save_path)
        else:
            ok, err = download_naip_tile(tile_bbox, save_path)
        return zip_code, tile_idx, tile_bbox, ok, err

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(_download_one, item): item for item in tiles_to_download}

        for future in as_completed(futures):
            zip_code, tile_idx, tile_bbox, ok, err = future.result()
            if ok:
                downloaded += 1
                manifests.setdefault(zip_code, []).append({
                    'file': f"{tile_idx}.png",
                    'bbox': tile_bbox,
                })
            else:
                errors += 1
                if len(error_samples) < 10:
                    error_samples.append(f"  {zip_code}/{tile_idx}: {err}")

            total_done = downloaded + errors
            if total_done % 500 == 0:
                elapsed = time.time() - start_time
                rate = total_done / elapsed if elapsed > 0 else 0
                eta = (len(tiles_to_download) - total_done) / rate if rate > 0 else 0
                print(f"  Progress: {downloaded:,} downloaded, {errors} errors "
                      f"({total_done:,}/{len(tiles_to_download):,}, "
                      f"{rate:.1f}/sec, ETA: {eta/60:.0f}min)")

    # Write manifests
    for zip_code, tiles in manifests.items():
        n_targets = len(process_zips.get(zip_code, []))
        manifest = {
            'zip_code': zip_code,
            'source': args.source,
            'zoom': args.zoom if args.source == 'google' else None,
            'tile_span_m': round(TILE_SPAN_M, 1),
            'target_count': n_targets,
            'tier': 'A' if n_targets == 1 else ('B' if n_targets <= 3 else 'C'),
            'tiles': tiles,
            'targets': [
                {'id': t['id'], 'capacity_mw': t['capacity_mw'],
                 'source_record_id': t['source_record_id']}
                for t in process_zips.get(zip_code, [])
            ],
        }
        manifest_path = TILE_DIR / zip_code / "manifest.json"
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print("Download Results")
    print(f"{'='*60}")
    print(f"  Downloaded: {downloaded:,}")
    print(f"  Errors: {errors}")
    print(f"  Manifests written: {len(manifests):,}")
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    if error_samples:
        print(f"\n  Sample errors:")
        for e in error_samples:
            print(f"    {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()

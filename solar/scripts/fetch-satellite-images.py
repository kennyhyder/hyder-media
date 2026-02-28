#!/usr/bin/env python3
"""
Fetch satellite images from Google Maps Static API for solar installations.

Downloads 640x640 satellite images at zoom level 18 for each installation
with coordinates. These images are used by the NREL Panel-Segmentation model
to classify mount_type (ground/rooftop/carport) and tracking_type (fixed/single-axis).

Usage:
    python3 -u scripts/fetch-satellite-images.py                  # Fetch all missing images
    python3 -u scripts/fetch-satellite-images.py --limit 100      # Fetch first 100 only
    python3 -u scripts/fetch-satellite-images.py --batch-size 500  # Custom batch from DB
    python3 -u scripts/fetch-satellite-images.py --dry-run         # Count without downloading
    python3 -u scripts/fetch-satellite-images.py --site-type utility  # Only utility-scale
    python3 -u scripts/fetch-satellite-images.py --state CA        # Only California

Cost: Google Maps Static API = $2/1000 requests ($200/mo free credit).
  128K images = ~$256 total, minus $200 credit = ~$56 net cost.
  With --site-type utility: ~34K images = ~$68, fully covered by free credit.

Image specs: 640x640 RGB PNG, zoom 18, satellite maptype.
At zoom 18, each pixel = ~0.6m at equator. Solar panels clearly visible.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
GOOGLE_MAPS_SIGNING_SECRET = os.environ.get("GOOGLE_MAPS_SIGNING_SECRET", "").strip()

if not SUPABASE_URL or not SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

IMAGE_DIR = Path("data/satellite_images")
IMAGE_SIZE = "640x640"
ZOOM = 18
MAP_TYPE = "satellite"
DB_BATCH_SIZE = 1000
DOWNLOAD_WORKERS = 5  # Parallel downloads (Google allows higher but be nice)
RATE_LIMIT_DELAY = 0.05  # 50ms between requests = ~20/sec

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}


def supabase_get(endpoint, params=None):
    """GET request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())
    req = urllib.request.Request(url, headers={**HEADERS, "Prefer": "count=exact"})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    # Extract total count from content-range header
    cr = resp.headers.get("content-range", "")
    total = None
    if "/" in cr:
        try:
            total = int(cr.split("/")[1])
        except (ValueError, IndexError):
            pass
    return data, total


def sign_url(input_url, secret):
    """Sign a Google Maps API URL with HMAC-SHA1."""
    url = urllib.parse.urlparse(input_url)
    url_to_sign = url.path + "?" + url.query
    decoded_key = base64.urlsafe_b64decode(secret)
    signature = hmac.new(decoded_key, url_to_sign.encode(), hashlib.sha1)
    encoded_sig = base64.urlsafe_b64encode(signature.digest()).decode()
    return input_url + "&signature=" + encoded_sig


def download_image(lat, lng, api_key, save_path):
    """Download a single satellite image from Google Maps Static API."""
    url = (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lng}"
        f"&zoom={ZOOM}"
        f"&size={IMAGE_SIZE}"
        f"&maptype={MAP_TYPE}"
        f"&key={api_key}"
    )
    if GOOGLE_MAPS_SIGNING_SECRET:
        url = sign_url(url, GOOGLE_MAPS_SIGNING_SECRET)
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=30)
        content = resp.read()

        # Check if we got an actual image (not an error page)
        if len(content) < 1000:
            return False, f"Response too small ({len(content)} bytes)"

        # Check content type
        ct = resp.headers.get("Content-Type", "")
        if "image" not in ct:
            return False, f"Not an image: {ct}"

        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "wb") as f:
            f.write(content)
        return True, None
    except Exception as e:
        return False, str(e)


def main():
    parser = argparse.ArgumentParser(description="Fetch satellite images for solar installations")
    parser.add_argument("--dry-run", action="store_true", help="Count images needed without downloading")
    parser.add_argument("--limit", type=int, default=0, help="Max images to download (0 = all)")
    parser.add_argument("--batch-size", type=int, default=DB_BATCH_SIZE, help="DB fetch batch size")
    parser.add_argument("--site-type", type=str, help="Filter by site type (utility/commercial/community)")
    parser.add_argument("--state", type=str, help="Filter by state (2-letter code)")
    parser.add_argument("--api-key", type=str, default=GOOGLE_MAPS_API_KEY, help="Google Maps API key")
    parser.add_argument("--workers", type=int, default=DOWNLOAD_WORKERS, help="Parallel download workers")
    parser.add_argument("--location-precision", type=str, help="Filter by location_precision (exact/address/city/zip)")
    parser.add_argument("--source", type=str, help="Filter by source_record_id prefix (e.g., 'grw_' for GRW records)")
    args = parser.parse_args()

    api_key = args.api_key
    if not api_key and not args.dry_run:
        print("ERROR: No Google Maps API key. Set GOOGLE_MAPS_API_KEY env var or use --api-key")
        sys.exit(1)

    print("Satellite Image Fetcher for Solar Installations")
    print("=" * 60)
    print(f"  Image size: {IMAGE_SIZE}, zoom: {ZOOM}, type: {MAP_TYPE}")
    print(f"  Output dir: {IMAGE_DIR}")
    print(f"  Workers: {args.workers}")
    if args.site_type:
        print(f"  Filter: site_type = {args.site_type}")
    if args.state:
        print(f"  Filter: state = {args.state}")
    if args.location_precision:
        print(f"  Filter: location_precision = {args.location_precision}")
    if args.source:
        print(f"  Filter: source_record_id LIKE {args.source}%")
    if args.limit:
        print(f"  Limit: {args.limit}")
    print(f"  URL signing: {'enabled' if GOOGLE_MAPS_SIGNING_SECRET else 'disabled (no daily limit with signing)'}")
    print(f"  Dry run: {args.dry_run}")
    print()

    # Create output directory
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    # Get existing images (for resumability)
    existing = set()
    if IMAGE_DIR.exists():
        for f in IMAGE_DIR.glob("*.png"):
            existing.add(f.stem)  # installation ID without extension
    print(f"  Existing images: {len(existing)}")

    # Load installations with coordinates
    print("\nLoading installations with coordinates...")
    installations = []
    offset = 0

    while True:
        params = {
            "select": "id,latitude,longitude,site_type,state,location_precision",
            "latitude": "not.is.null",
            "longitude": "not.is.null",
            "order": "id",
            "offset": offset,
            "limit": args.batch_size,
        }
        if args.site_type:
            params["site_type"] = f"eq.{args.site_type}"
        if args.state:
            params["state"] = f"eq.{args.state}"
        if args.location_precision:
            params["location_precision"] = f"eq.{args.location_precision}"
        if args.source:
            params["source_record_id"] = f"like.{args.source}*"

        batch, total = supabase_get("solar_installations", params)
        if not batch:
            break
        installations.extend(batch)
        offset += len(batch)
        if offset % 10000 == 0:
            print(f"  Loaded {offset}...")
        if len(batch) < args.batch_size:
            break

    print(f"  Total with coordinates: {len(installations)}")

    # Filter out already-downloaded
    to_download = [inst for inst in installations if inst["id"] not in existing]
    print(f"  Already downloaded: {len(installations) - len(to_download)}")
    print(f"  Remaining to download: {len(to_download)}")

    if args.limit:
        to_download = to_download[:args.limit]
        print(f"  Limited to: {len(to_download)}")

    # Cost estimate
    cost = len(to_download) * 0.002  # $2/1000 requests
    free_credit = 200.0
    net_cost = max(0, cost - free_credit)
    print(f"\n  Estimated cost: ${cost:.2f} ({len(to_download)} images × $0.002)")
    print(f"  Free credit: ${free_credit:.2f}/month")
    print(f"  Net cost this month: ${net_cost:.2f}")

    # Breakdown by type
    type_counts = {}
    for inst in to_download:
        t = inst.get("site_type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    print(f"\n  By type: {', '.join(f'{k}: {v}' for k, v in sorted(type_counts.items(), key=lambda x: -x[1]))}")

    precision_counts = {}
    for inst in to_download:
        p = inst.get("location_precision", "unknown")
        precision_counts[p] = precision_counts.get(p, 0) + 1
    print(f"  By precision: {', '.join(f'{k}: {v}' for k, v in sorted(precision_counts.items(), key=lambda x: -x[1]))}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No images downloaded.")
        return

    if not to_download:
        print("\n  All images already downloaded!")
        return

    # Download images
    print(f"\nDownloading {len(to_download)} satellite images...")
    created = 0
    errors = 0
    error_samples = []
    start_time = time.time()

    def _download_one(inst):
        """Download a single image with rate limiting."""
        lat = inst["latitude"]
        lng = inst["longitude"]
        save_path = IMAGE_DIR / f"{inst['id']}.png"
        time.sleep(RATE_LIMIT_DELAY)
        return inst["id"], download_image(lat, lng, api_key, save_path)

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(_download_one, inst): inst for inst in to_download}

        for future in as_completed(futures):
            inst_id, (success, error) = future.result()
            if success:
                created += 1
            else:
                errors += 1
                if len(error_samples) < 10:
                    error_samples.append(f"  {inst_id}: {error}")

            total_done = created + errors
            if total_done % 500 == 0:
                elapsed = time.time() - start_time
                rate = total_done / elapsed if elapsed > 0 else 0
                eta = (len(to_download) - total_done) / rate if rate > 0 else 0
                print(f"  Progress: {created} downloaded, {errors} errors ({total_done}/{len(to_download)}, {rate:.1f}/sec, ETA: {eta/60:.0f}min)")

    elapsed = time.time() - start_time
    print(f"\n  Downloaded: {created}")
    print(f"  Errors: {errors}")
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    if error_samples:
        print(f"\n  Sample errors:")
        for e in error_samples:
            print(f"    {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()

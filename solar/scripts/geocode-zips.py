#!/usr/bin/env python3
"""
Geocode installations by zip code using Census ZCTA centroids.

Updates latitude/longitude for all installations that have a zip_code
but no coordinates, using the US Census Bureau's ZCTA centroid file.
"""

import os
import sys
import json
import csv
import urllib.request
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

ZCTA_FILE = Path(__file__).parent.parent / "data" / "zcta_centroids.txt"
BATCH_SIZE = 200  # Larger batches for PATCH since it's just lat/long


def supabase_request(method, table, data=None, params=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,=')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if headers_extra:
        headers.update(headers_extra)

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        print(f"  Supabase error ({e.code}): {error_body}")
        return None


def load_zip_centroids():
    """Load zip code → (lat, lon) mapping from Census ZCTA file."""
    centroids = {}
    with open(ZCTA_FILE, 'r') as f:
        reader = csv.DictReader(f, delimiter='\t')
        # Strip whitespace from field names
        reader.fieldnames = [name.strip() for name in reader.fieldnames]
        for row in reader:
            # Strip all values
            row = {k.strip(): v.strip() if v else '' for k, v in row.items()}
            geoid = row.get('GEOID', '')
            lat = row.get('INTPTLAT', '')
            lon = row.get('INTPTLONG', '')
            if geoid and lat and lon:
                try:
                    centroids[geoid] = (float(lat), float(lon))
                except ValueError:
                    pass
    return centroids


def main():
    print("Zip Code Geocoding Script")
    print("=" * 60)

    # Load centroids
    print("Loading Census ZCTA centroids...")
    centroids = load_zip_centroids()
    print(f"  Loaded {len(centroids)} zip code centroids")

    # Fetch installations with zip but no lat/long, in pages
    print("\nFetching installations needing geocoding...")

    total_updated = 0
    total_not_found = 0
    offset = 0
    page_size = 1000

    while True:
        params = {
            "latitude": "is.null",
            "zip_code": "not.is.null",
            "select": "id,zip_code",
            "limit": str(page_size),
            "offset": str(offset),
            "order": "id",
        }
        records = supabase_request("GET", "solar_installations", params=params)

        if not records:
            break

        print(f"  Fetched {len(records)} records (offset {offset})...")

        # Group by zip for efficient updates
        updates_by_zip = {}
        for rec in records:
            zip_code = str(rec["zip_code"]).strip()
            # Normalize: take first 5 digits
            zip5 = zip_code[:5].zfill(5)

            if zip5 in centroids:
                lat, lon = centroids[zip5]
                if zip5 not in updates_by_zip:
                    updates_by_zip[zip5] = {"lat": lat, "lon": lon, "ids": []}
                updates_by_zip[zip5]["ids"].append(rec["id"])
            else:
                total_not_found += 1

        # Update each zip group
        for zip5, info in updates_by_zip.items():
            ids = info["ids"]
            # Update in batches
            for i in range(0, len(ids), 50):
                batch_ids = ids[i:i+50]
                id_filter = ",".join(batch_ids)
                res = supabase_request(
                    "PATCH",
                    "solar_installations",
                    {"latitude": info["lat"], "longitude": info["lon"]},
                    params={"id": f"in.({id_filter})"},
                )
                if res is not None:
                    total_updated += len(batch_ids)

        print(f"    Updated: {total_updated}, Not found: {total_not_found}")

        if len(records) < page_size:
            break
        offset += page_size

    print(f"\n{'=' * 60}")
    print(f"Geocoding complete!")
    print(f"  Updated: {total_updated}")
    print(f"  Zip not in Census data: {total_not_found}")


if __name__ == "__main__":
    main()

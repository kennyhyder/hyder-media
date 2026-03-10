#!/usr/bin/env python3
"""
Ingest FRA North American Rail Network Lines from ArcGIS FeatureServer
and compute nearest rail distance for each DC site.

Rail corridors often have fiber optic cables alongside them. Proximity
to major rail = proxy for additional fiber connectivity options.

Source: FRA/BTS North American Rail Network (ArcGIS FeatureServer)
  https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0

Phase 1: Download US rail line segments from FRA ArcGIS (235K records, paginated)
Phase 2: Insert into grid_rail_lines (Supabase)
Phase 3: Compute nearest_rail_km for each grid_dc_sites record (psql bulk)

Each rail segment stores start/end/centroid coordinates for fast distance lookups.

Usage:
  python3 -u scripts/ingest-fra-rail.py
  python3 -u scripts/ingest-fra-rail.py --dry-run
  python3 -u scripts/ingest-fra-rail.py --skip-download
  python3 -u scripts/ingest-fra-rail.py --skip-insert
  python3 -u scripts/ingest-fra-rail.py --crossref-only    # Skip download+insert, just compute distances
  python3 -u scripts/ingest-fra-rail.py --state TX          # Filter DC sites to single state
  python3 -u scripts/ingest-fra-rail.py --limit 1000        # Limit DC sites processed
"""

import os
import sys
import json
import math
import time
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

FRA_URL = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0"

BATCH_SIZE = 50
ARCGIS_PAGE_SIZE = 2000
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'fra_rail')

# DB connection for psql bulk operations
DB_HOST = 'aws-0-us-west-2.pooler.supabase.com'
DB_PORT = '6543'
DB_USER = 'postgres.ilbovwnhrowvxjdkvrln'
DB_NAME = 'postgres'
DB_PASS = '#FsW7iqg%EYX&G3M'


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


def run_psql(sql):
    """Run SQL via psql."""
    env = os.environ.copy()
    env['PGPASSWORD'] = DB_PASS
    result = subprocess.run(
        ['psql', '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
         '-c', sql],
        capture_output=True, text=True, env=env, timeout=300
    )
    if result.returncode != 0:
        print(f"  psql error: {result.stderr[:500]}")
    return result.stdout


def fetch_fra_features(offset=0):
    """Fetch a page of US rail features from FRA ArcGIS."""
    params = {
        'where': "COUNTRY='US'",
        'outFields': 'FRAARCID,RROWNER1,SUBDIV,STATEAB,TRACKS,MILES,NET,STRACNET',
        'outSR': '4326',
        'f': 'json',
        'resultOffset': offset,
        'resultRecordCount': ARCGIS_PAGE_SIZE,
    }
    url = f"{FRA_URL}/query?{urllib.parse.urlencode(params)}"

    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'GridScout/1.0')
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
                if 'error' in data:
                    print(f"  ArcGIS error: {data['error']}")
                    return [], False
                exceeded = data.get('exceededTransferLimit', False)
                features = data.get('features', [])
                return features, exceeded
        except Exception as e:
            if attempt < 2:
                print(f"  Fetch error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  Fetch failed after 3 attempts: {e}")
            return [], False


def get_line_endpoints(paths):
    """Extract start point, end point, and centroid from ArcGIS polyline paths."""
    if not paths:
        return None, None, None, None, None, None

    all_points = []
    for path in paths:
        all_points.extend(path)

    if len(all_points) < 2:
        return None, None, None, None, None, None

    start = all_points[0]   # [lng, lat]
    end = all_points[-1]    # [lng, lat]
    mid = all_points[len(all_points) // 2]

    return (
        round(start[1], 7), round(start[0], 7),  # start_lat, start_lng
        round(end[1], 7), round(end[0], 7),      # end_lat, end_lng
        round(mid[1], 7), round(mid[0], 7),       # centroid_lat, centroid_lng
    )


def safe_str(val, max_len=200):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ('none', 'null', 'n/a', '-999'):
        return None
    return s[:max_len]


def safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def safe_float(val):
    if val is None or val == '' or val == ' ':
        return None
    try:
        f = float(val)
        return f if not math.isnan(f) and not math.isinf(f) else None
    except (ValueError, TypeError):
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(min(1.0, math.sqrt(a)))


def ensure_table():
    """Create grid_rail_lines table if it doesn't exist."""
    sql = """
    CREATE TABLE IF NOT EXISTS grid_rail_lines (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        fra_id TEXT UNIQUE,
        railroad_owner TEXT,
        track_class TEXT,
        subdivision TEXT,
        track_type TEXT,
        state TEXT,
        tracks INTEGER,
        miles NUMERIC(10,3),
        stracnet TEXT,
        start_lat NUMERIC(10,7),
        start_lng NUMERIC(11,7),
        end_lat NUMERIC(10,7),
        end_lng NUMERIC(11,7),
        centroid_lat NUMERIC(10,7),
        centroid_lng NUMERIC(11,7),
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rail_lines_state ON grid_rail_lines(state);
    CREATE INDEX IF NOT EXISTS idx_rail_lines_centroid ON grid_rail_lines(centroid_lat, centroid_lng);
    """
    print("  Creating grid_rail_lines table...")
    run_psql(sql)


def ensure_dc_column():
    """Add nearest_rail_km column to grid_dc_sites if missing."""
    sql = """
    ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_rail_km NUMERIC(8,2);
    """
    run_psql(sql)


def phase1_download(dry_run=False):
    """Download all US rail features from FRA ArcGIS."""
    os.makedirs(DATA_DIR, exist_ok=True)

    print("\nPhase 1: Download FRA Rail Network Lines (US only)")
    print("-" * 60)

    all_features = []
    offset = 0

    while True:
        features, exceeded = fetch_fra_features(offset)
        if not features:
            break

        all_features.extend(features)
        print(f"  Fetched {len(all_features):,} records (offset={offset})...")

        if dry_run and len(all_features) >= 4000:
            print(f"  --dry-run: stopping after {len(all_features):,} records")
            break

        if not exceeded and len(features) < ARCGIS_PAGE_SIZE:
            break

        offset += len(features)
        time.sleep(0.3)  # Be polite to ArcGIS

    print(f"  Total downloaded: {len(all_features):,} US rail segments")

    # Cache to disk
    cache_file = os.path.join(DATA_DIR, 'fra_rail_us.json')
    if not dry_run:
        with open(cache_file, 'w') as f:
            json.dump(all_features, f)
        print(f"  Cached to {cache_file}")

    return all_features


def phase2_insert(features, dry_run=False):
    """Insert rail lines into Supabase."""
    print(f"\nPhase 2: Insert {len(features):,} rail lines into grid_rail_lines")
    print("-" * 60)

    if dry_run:
        # Show sample
        for feat in features[:5]:
            a = feat['attributes']
            print(f"  FRAARCID={a.get('FRAARCID')} OWNER={a.get('RROWNER1')} "
                  f"STATE={a.get('STATEAB')} SUBDIV={a.get('SUBDIV')} "
                  f"MILES={a.get('MILES')}")
        print(f"  ... and {len(features) - 5:,} more")
        return 0, 0

    # Get existing fra_ids for dedup
    print("  Loading existing fra_ids...")
    existing_ids = set()
    offset = 0
    while True:
        rows = supabase_request('GET',
            f'grid_rail_lines?select=fra_id&offset={offset}&limit=1000')
        if not rows:
            break
        for r in rows:
            if r.get('fra_id'):
                existing_ids.add(r['fra_id'])
        if len(rows) < 1000:
            break
        offset += 1000
    print(f"  Found {len(existing_ids):,} existing records")

    created = 0
    errors = 0
    batch = []

    for i, feat in enumerate(features):
        a = feat['attributes']
        geometry = feat.get('geometry', {})
        paths = geometry.get('paths', [])

        fra_id = str(a.get('FRAARCID', ''))
        if not fra_id or fra_id in existing_ids:
            continue

        start_lat, start_lng, end_lat, end_lng, cent_lat, cent_lng = get_line_endpoints(paths)
        if cent_lat is None:
            continue

        record = {
            'fra_id': fra_id,
            'railroad_owner': safe_str(a.get('RROWNER1')),
            'track_class': safe_str(a.get('NET')),
            'subdivision': safe_str(a.get('SUBDIV')),
            'track_type': safe_str(a.get('STRACNET')),
            'state': safe_str(a.get('STATEAB')),
            'tracks': safe_int(a.get('TRACKS')),
            'miles': safe_float(a.get('MILES')),
            'stracnet': safe_str(a.get('STRACNET')),
            'start_lat': start_lat,
            'start_lng': start_lng,
            'end_lat': end_lat,
            'end_lng': end_lng,
            'centroid_lat': cent_lat,
            'centroid_lng': cent_lng,
        }

        batch.append(record)

        if len(batch) >= BATCH_SIZE:
            try:
                supabase_request('POST', 'grid_rail_lines', batch, {
                    'Prefer': 'resolution=ignore-duplicates,return=minimal'
                })
                created += len(batch)
            except Exception as e:
                errors += len(batch)
                if errors <= 50:
                    print(f"  Batch error at {i}: {e}")
            batch = []

            if created % 5000 == 0 and created > 0:
                print(f"  Inserted {created:,} / {len(features):,} ({errors} errors)")

    # Final batch
    if batch:
        try:
            supabase_request('POST', 'grid_rail_lines', batch, {
                'Prefer': 'resolution=ignore-duplicates,return=minimal'
            })
            created += len(batch)
        except Exception as e:
            errors += len(batch)
            print(f"  Final batch error: {e}")

    print(f"  Created: {created:,}, Errors: {errors}")
    return created, errors


def phase3_crossref(dry_run=False, state_filter=None, limit=None):
    """Compute nearest_rail_km for each DC site using psql bulk SQL.

    Uses a bounding box join (0.5 degrees ~55km) then Haversine distance
    to find the nearest rail line centroid for each DC site.
    """
    print(f"\nPhase 3: Cross-reference DC sites with rail lines")
    print("-" * 60)

    ensure_dc_column()

    # Build WHERE clause for state/limit filtering
    where_parts = []
    if state_filter:
        where_parts.append(f"s.state = '{state_filter}'")
        print(f"  Filtering to state: {state_filter}")
    if limit:
        print(f"  Limiting to {limit} sites")

    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    limit_clause = f"LIMIT {limit}" if limit else ""

    if dry_run:
        count_sql = f"SELECT count(*) FROM grid_dc_sites s {where_clause}"
        result = run_psql(count_sql)
        print(f"  Would compute rail distance for sites: {result.strip()}")

        # Show current coverage
        result = run_psql(
            "SELECT count(*) AS total, "
            "count(nearest_rail_km) AS has_rail "
            "FROM grid_dc_sites"
        )
        print(f"  Current coverage: {result.strip()}")
        return

    # Use psql for bulk distance computation
    # Strategy: For each DC site, find the nearest rail line centroid within ~55km bounding box
    # then compute Haversine distance to the closest one.
    # Also checks start/end points for better accuracy.
    sql = f"""
    WITH site_subset AS (
        SELECT id, latitude, longitude, state
        FROM grid_dc_sites s
        {where_clause}
        ORDER BY id
        {limit_clause}
    ),
    nearest AS (
        SELECT DISTINCT ON (s.id)
            s.id AS site_id,
            ROUND(
                LEAST(
                    -- Distance to centroid
                    6371 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(r.centroid_lat - s.latitude) / 2), 2) +
                        COS(RADIANS(s.latitude)) * COS(RADIANS(r.centroid_lat)) *
                        POWER(SIN(RADIANS(r.centroid_lng - s.longitude) / 2), 2)
                    )),
                    -- Distance to start point
                    6371 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(r.start_lat - s.latitude) / 2), 2) +
                        COS(RADIANS(s.latitude)) * COS(RADIANS(r.start_lat)) *
                        POWER(SIN(RADIANS(r.start_lng - s.longitude) / 2), 2)
                    )),
                    -- Distance to end point
                    6371 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(r.end_lat - s.latitude) / 2), 2) +
                        COS(RADIANS(s.latitude)) * COS(RADIANS(r.end_lat)) *
                        POWER(SIN(RADIANS(r.end_lng - s.longitude) / 2), 2)
                    ))
                )::numeric, 2
            ) AS dist_km
        FROM site_subset s
        JOIN grid_rail_lines r ON
            r.centroid_lat BETWEEN s.latitude - 0.5 AND s.latitude + 0.5
            AND r.centroid_lng BETWEEN s.longitude - 0.5 AND s.longitude + 0.5
        ORDER BY s.id,
            LEAST(
                POWER(r.centroid_lat - s.latitude, 2) + POWER(r.centroid_lng - s.longitude, 2),
                POWER(r.start_lat - s.latitude, 2) + POWER(r.start_lng - s.longitude, 2),
                POWER(r.end_lat - s.latitude, 2) + POWER(r.end_lng - s.longitude, 2)
            )
    )
    UPDATE grid_dc_sites s
    SET nearest_rail_km = n.dist_km,
        updated_at = NOW()
    FROM nearest n
    WHERE s.id = n.site_id;
    """

    print("  Running bulk distance computation via psql...")
    print("  (this may take a few minutes for ~40K sites x 235K rail lines)")
    t0 = time.time()
    result = run_psql(sql)
    elapsed = time.time() - t0
    print(f"  Result: {result.strip()} ({elapsed:.1f}s)")

    # Check coverage
    result = run_psql(
        "SELECT count(*) AS total, "
        "count(nearest_rail_km) AS has_rail, "
        "ROUND(AVG(nearest_rail_km)::numeric, 1) AS avg_km, "
        "ROUND(MIN(nearest_rail_km)::numeric, 1) AS min_km, "
        "ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY nearest_rail_km)::numeric, 1) AS median_km, "
        "ROUND(MAX(nearest_rail_km)::numeric, 1) AS max_km "
        "FROM grid_dc_sites"
    )
    print(f"  Coverage: {result.strip()}")

    # Distribution buckets
    result = run_psql(
        "SELECT "
        "count(*) FILTER (WHERE nearest_rail_km < 1) AS under_1km, "
        "count(*) FILTER (WHERE nearest_rail_km < 5) AS under_5km, "
        "count(*) FILTER (WHERE nearest_rail_km < 10) AS under_10km, "
        "count(*) FILTER (WHERE nearest_rail_km < 25) AS under_25km, "
        "count(*) FILTER (WHERE nearest_rail_km < 50) AS under_50km, "
        "count(*) FILTER (WHERE nearest_rail_km IS NOT NULL) AS total_with_rail "
        "FROM grid_dc_sites"
    )
    print(f"  Distribution: {result.strip()}")


def main():
    print("=" * 60)
    print("GridScout FRA Rail Network Ingestion")
    print(f"  Source: FRA North American Rail Network Lines")
    print(f"  Target: grid_rail_lines + grid_dc_sites.nearest_rail_km")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    skip_download = '--skip-download' in sys.argv
    skip_insert = '--skip-insert' in sys.argv
    crossref_only = '--crossref-only' in sys.argv

    # Parse --state and --limit
    state_filter = None
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--state' and i + 1 < len(sys.argv):
            state_filter = sys.argv[i + 1].upper()
        if arg == '--limit' and i + 1 < len(sys.argv):
            try:
                limit = int(sys.argv[i + 1])
            except ValueError:
                pass

    if dry_run:
        print("  *** DRY RUN — no database changes ***")
    if state_filter:
        print(f"  State filter: {state_filter}")
    if limit:
        print(f"  Limit: {limit} sites")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env.local")
        sys.exit(1)

    # Ensure table exists
    if not dry_run:
        ensure_table()

    if crossref_only:
        phase3_crossref(dry_run, state_filter, limit)
        print(f"\n{'=' * 60}")
        print("Cross-reference complete")
        print(f"{'=' * 60}")
        return

    # Phase 1: Download
    cache_file = os.path.join(DATA_DIR, 'fra_rail_us.json')
    if skip_download and os.path.exists(cache_file):
        print(f"\n  Loading cached data from {cache_file}...")
        with open(cache_file) as f:
            features = json.load(f)
        print(f"  Loaded {len(features):,} features from cache")
    else:
        features = phase1_download(dry_run)

    if not features:
        print("  No features downloaded. Exiting.")
        return

    # State distribution
    state_counts = {}
    for feat in features:
        st = feat['attributes'].get('STATEAB', 'Unknown')
        state_counts[st] = state_counts.get(st, 0) + 1
    top_states = sorted(state_counts.items(), key=lambda x: -x[1])[:10]
    print(f"\n  Top states: {', '.join(f'{s}={c:,}' for s, c in top_states)}")

    # Owner distribution
    owner_counts = {}
    for feat in features:
        owner = feat['attributes'].get('RROWNER1', 'Unknown')
        if owner:
            owner_counts[owner] = owner_counts.get(owner, 0) + 1
    top_owners = sorted(owner_counts.items(), key=lambda x: -x[1])[:10]
    print(f"  Top owners: {', '.join(f'{o}={c:,}' for o, c in top_owners)}")

    # Phase 2: Insert
    if not skip_insert:
        created, errors = phase2_insert(features, dry_run)

    # Phase 3: Cross-reference
    phase3_crossref(dry_run, state_filter, limit)

    # Update data source record
    if not dry_run:
        ds = supabase_request('GET', 'grid_data_sources?name=eq.fra_rail&select=id')
        if not ds:
            # Create data source
            supabase_request('POST', 'grid_data_sources', {
                'name': 'fra_rail',
                'display_name': 'FRA North American Rail Network',
                'url': FRA_URL,
                'record_count': len(features),
                'last_import': datetime.now(timezone.utc).isoformat(),
            })
        else:
            supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
                'record_count': len(features),
                'last_import': datetime.now(timezone.utc).isoformat(),
            })

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")
    print(f"  Rail segments downloaded:  {len(features):,}")
    print(f"  States covered:           {len(state_counts)}")
    print(f"  Railroad owners:          {len(owner_counts)}")
    if dry_run:
        print(f"  Mode:                     DRY RUN (no changes applied)")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

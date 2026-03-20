#!/usr/bin/env python3
"""
Ingest fiber routes from additional sources into grid_fiber_routes.

Source 1: NTIA Middle Mile - Existing IRU Layer (Layer 0)
  - 8 existing fiber IRU routes from NTIA Middle Mile dashboard
  - ArcGIS FeatureServer at utility.arcgis.com
  - Already have Layer 1 (35 awarded routes) via ingest-fiber-routes.py
  - This script adds Layer 0 (8 existing/in-kind routes)

Source 2: NTIA Tracking Dashboard enrichment
  - Same 35 awarded routes but with progress/status data
  - Enriches existing ntia_mm records with completion % and miles

Source 3: Zayo KMZ — NOT VIABLE
  - Zayo does not publish downloadable KMZ/KML/GeoJSON
  - zayo.com/resources/global-network-capabilities/ requires form gate
  - No public API or machine-readable route data
  - NV Zayo routes (2,871 records) already ingested from NV OSIT ArcGIS

Source 4: Internet2 — NOT VIABLE
  - internet2.edu has no downloadable KMZ/KML/GeoJSON
  - No public API or network topology export
  - Network map is interactive-only (no data behind it)

Usage:
  python3 -u scripts/ingest-fiber-extra.py
  python3 -u scripts/ingest-fiber-extra.py --dry-run
"""

import os
import sys
import json
import math
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

# macOS system Python SSL fix
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    SSL_CTX.load_verify_locations(certifi.where())
except ImportError:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

# Load env
grid_env = os.path.join(os.path.dirname(__file__), '..', '.env.local')
solar_env = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
if os.path.exists(grid_env):
    load_dotenv(grid_env)
else:
    load_dotenv(solar_env)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DRY_RUN = '--dry-run' in sys.argv
BATCH_SIZE = 50

# US state centroids for rough state assignment
STATE_CENTROIDS = {
    'AL': (32.8, -86.8), 'AK': (64.0, -153.0), 'AZ': (34.3, -111.7), 'AR': (34.8, -92.2),
    'CA': (37.2, -119.7), 'CO': (39.0, -105.5), 'CT': (41.6, -72.7), 'DE': (39.0, -75.5),
    'FL': (28.6, -82.4), 'GA': (32.7, -83.5), 'HI': (20.8, -156.3), 'ID': (44.4, -114.6),
    'IL': (40.0, -89.2), 'IN': (39.8, -86.3), 'IA': (42.0, -93.5), 'KS': (38.5, -98.3),
    'KY': (37.8, -85.3), 'LA': (31.0, -92.0), 'ME': (45.4, -69.2), 'MD': (39.0, -76.7),
    'MA': (42.2, -71.8), 'MI': (44.2, -84.5), 'MN': (46.3, -94.3), 'MS': (32.7, -89.7),
    'MO': (38.4, -92.5), 'MT': (47.1, -109.6), 'NE': (41.5, -99.8), 'NV': (39.5, -116.9),
    'NH': (43.7, -71.6), 'NJ': (40.1, -74.7), 'NM': (34.4, -106.1), 'NY': (42.9, -75.5),
    'NC': (35.6, -79.8), 'ND': (47.5, -100.5), 'OH': (40.3, -82.8), 'OK': (35.5, -97.5),
    'OR': (44.0, -120.5), 'PA': (40.9, -77.8), 'RI': (41.7, -71.5), 'SC': (33.9, -80.9),
    'SD': (44.4, -100.2), 'TN': (35.8, -86.4), 'TX': (31.5, -99.3), 'UT': (39.3, -111.7),
    'VT': (44.1, -72.6), 'VA': (37.5, -78.9), 'WA': (47.4, -120.7), 'WV': (38.6, -80.6),
    'WI': (44.6, -89.8), 'WY': (43.0, -107.6), 'DC': (38.9, -77.0),
}


def haversine(lat1, lng1, lat2, lng2):
    rlat1, rlng1 = math.radians(lat1), math.radians(lng1)
    rlat2, rlng2 = math.radians(lat2), math.radians(lng2)
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat/2)**2 + math.cos(rlat1)*math.cos(rlat2)*math.sin(dlng/2)**2
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def nearest_state(lat, lng):
    best, best_d = None, 1e9
    for st, (slat, slng) in STATE_CENTROIDS.items():
        d = haversine(lat, lng, slat, slng)
        if d < best_d:
            best, best_d = st, d
    return best


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
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as resp:
                text = resp.read().decode()
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {err_body[:200]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def fetch_arcgis_layer(base_url, out_sr=4326):
    """Fetch all features from an ArcGIS FeatureServer layer."""
    all_features = []
    offset = 0
    page_size = 1000

    while True:
        params = urllib.parse.urlencode({
            'where': '1=1',
            'outFields': '*',
            'outSR': out_sr,
            'f': 'geojson',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        })
        query_url = f"{base_url}/query?{params}"
        req = urllib.request.Request(query_url, headers={'User-Agent': 'GridScout/1.0'})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as resp:
                    data = json.loads(resp.read().decode())
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(10 * (attempt + 1))
                else:
                    print(f"    FAILED at offset {offset}: {e}")
                    data = {'features': []}

        features = data.get('features', [])
        if not features:
            break

        all_features.extend(features)
        offset += len(features)

        if len(features) < page_size:
            break
        time.sleep(0.5)

    return all_features


# ── Source 1: NTIA Existing IRU Routes (Layer 0) ──────────────

def ingest_ntia_iru():
    """Ingest NTIA Middle Mile Existing IRU/In-Kind routes (Layer 0)."""
    print("\n" + "="*60)
    print("Source 1: NTIA Middle Mile — Existing IRU Routes (Layer 0)")
    print("="*60)

    url = "https://utility.arcgis.com/usrsvcs/servers/53d104cecb964033a75c5cd05cab3657/rest/services/MM_Dashboard_Layers_ForPublic/FeatureServer/0"

    # Check count
    count_url = f"{url}/query?where=1%3D1&returnCountOnly=true&f=json"
    req = urllib.request.Request(count_url, headers={'User-Agent': 'GridScout/1.0'})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        total = json.loads(resp.read().decode()).get('count', 0)
    print(f"  Records available: {total}")

    # Check existing
    existing = supabase_request('GET',
        'grid_fiber_routes?source_record_id=like.ntia_iru*&select=source_record_id',
        headers_extra={'Prefer': 'count=exact'})
    existing_ids = {r['source_record_id'] for r in (existing or [])}
    print(f"  Already in DB: {len(existing_ids)}")

    # Fetch features
    features = fetch_arcgis_layer(url)
    print(f"  Fetched: {len(features)} features")

    records = []
    for feat in features:
        geom = feat.get('geometry')
        props = feat.get('properties', {})
        if not geom:
            continue

        geom_type = geom.get('type', '')
        coords = geom.get('coordinates', [])

        if geom_type == 'LineString' and len(coords) < 2:
            continue
        elif geom_type == 'MultiLineString' and (not coords or all(len(line) < 2 for line in coords)):
            continue
        elif geom_type not in ('LineString', 'MultiLineString'):
            continue

        # Centroid
        if geom_type == 'LineString':
            mid = coords[len(coords)//2]
            clng, clat = mid[0], mid[1]
        else:
            longest = max(coords, key=len)
            mid = longest[len(longest)//2]
            clng, clat = mid[0], mid[1]

        oid = props.get('OBJECTID') or props.get('FID')
        src_id = f"ntia_iru_fiber_{oid}"

        if src_id in existing_ids:
            continue

        state = nearest_state(clat, clng)
        applicant = props.get('applicant') or props.get('Applicant') or None
        grant_id = props.get('grant_id') or None
        route_type = props.get('route_type') or None
        project_desc = props.get('ProjectDesc') or None
        ntia_cost = props.get('NTIA_Cost')
        total_cost = props.get('Cost')

        name_parts = []
        if applicant:
            name_parts.append(str(applicant).strip())
        if route_type:
            name_parts.append(f"({str(route_type).strip()})")
        route_name = ' '.join(name_parts) if name_parts else (grant_id or f"NTIA IRU {oid}")

        records.append({
            'name': route_name,
            'operator': str(applicant).strip() if applicant else None,
            'fiber_type': 'middle_mile',
            'location_type': None,
            'source': 'ntia_iru',
            'source_record_id': src_id,
            'geometry_json': geom,
            'centroid_lat': round(clat, 7),
            'centroid_lng': round(clng, 7),
            'state': state,
        })

    print(f"  New records to insert: {len(records)}")

    if DRY_RUN:
        for r in records:
            print(f"    {r['source_record_id']}: {r['name']} ({r['state']})")
        return len(records)

    if not records:
        print("  Nothing new to insert.")
        return 0

    # Insert in batches
    created = 0
    errors = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        try:
            supabase_request('POST', 'grid_fiber_routes', batch,
                headers_extra={'Prefer': 'resolution=ignore-duplicates'})
            created += len(batch)
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            errors += len(batch)

    print(f"  Created: {created}, Errors: {errors}")
    return created


# ── Source 2: NTIA Tracking Dashboard enrichment ──────────────

def enrich_ntia_tracking():
    """Enrich existing NTIA MM records with progress data from tracking dashboard."""
    print("\n" + "="*60)
    print("Source 2: NTIA Tracking Dashboard — Progress Enrichment")
    print("="*60)

    url = "https://utility.arcgis.com/usrsvcs/servers/e2d02c54fda94a0b91c200044d77706b/rest/services/Middle_Mile_Program_Awards_ForTracking_Dashboard/FeatureServer/0"

    features = fetch_arcgis_layer(url)
    print(f"  Fetched: {len(features)} tracking records")

    # Load existing ntia_mm records
    existing = supabase_request('GET',
        'grid_fiber_routes?source_record_id=like.ntia_mm*&select=source_record_id,name,operator',
        headers_extra={'Prefer': 'count=exact'})
    existing_map = {r['source_record_id']: r for r in (existing or [])}
    print(f"  Existing NTIA MM records: {len(existing_map)}")

    enriched = 0
    for feat in features:
        props = feat.get('properties', {})
        oid = props.get('FID') or props.get('OBJECTID')
        if not oid:
            continue

        # Try to match to existing record
        src_id = f"ntia_mm_fiber_{oid}"
        if src_id not in existing_map:
            continue

        # Extract progress fields
        completion = props.get('OverallProjectCompletion')
        miles_completed = props.get('Miles_Completed')
        total_miles = props.get('Total_Miles')
        status = props.get('Status')
        applicant = props.get('Applicant2')

        info_parts = []
        if status:
            info_parts.append(f"Status: {status}")
        if completion is not None:
            info_parts.append(f"Completion: {completion}%")
        if miles_completed is not None and total_miles is not None:
            info_parts.append(f"Miles: {miles_completed}/{total_miles}")

        if not info_parts:
            continue

        # Update name to include progress info
        old = existing_map[src_id]
        new_name = old.get('name') or ''
        progress_suffix = f" [{', '.join(info_parts)}]"

        if DRY_RUN:
            print(f"    {src_id}: {new_name}{progress_suffix}")
            enriched += 1
            continue

        # Patch the record
        try:
            patch_data = {}
            if applicant and not old.get('operator'):
                patch_data['operator'] = str(applicant).strip()
            # We could update name with progress, but that changes on each run
            # Instead just report
            enriched += 1
            if patch_data:
                supabase_request('PATCH',
                    f"grid_fiber_routes?source_record_id=eq.{urllib.parse.quote(src_id)}",
                    patch_data)
        except Exception as e:
            print(f"    Error patching {src_id}: {e}")

    print(f"  Enriched: {enriched} records with tracking data")

    # Print summary of tracking status
    print("\n  NTIA Middle Mile Project Status Summary:")
    statuses = {}
    for feat in features:
        props = feat.get('properties', {})
        status = props.get('Status') or 'Unknown'
        completion = props.get('OverallProjectCompletion') or 0
        applicant = props.get('Applicant2') or 'Unknown'
        miles = props.get('Total_Miles') or 0

        if status not in statuses:
            statuses[status] = {'count': 0, 'total_miles': 0}
        statuses[status]['count'] += 1
        statuses[status]['total_miles'] += float(miles) if miles else 0

        # Print individual project status
        pct = f"{completion:.0f}%" if completion else "N/A"
        print(f"    {applicant[:40]:40s} | {status:20s} | {pct:6s} | {miles:,.0f} mi" if miles else
              f"    {applicant[:40]:40s} | {status:20s} | {pct:6s}")

    print(f"\n  Status breakdown:")
    for status, info in sorted(statuses.items()):
        print(f"    {status}: {info['count']} projects, {info['total_miles']:,.0f} total miles")

    return enriched


# ── Source 3: Zayo — NOT VIABLE ───────────────────────────────

def report_zayo():
    """Report on Zayo data availability."""
    print("\n" + "="*60)
    print("Source 3: Zayo KMZ Files — NOT VIABLE")
    print("="*60)
    print("""
  Research findings:
  - zayo.com/network/ links to /resources/global-network-capabilities/
  - The resources page requires a form submission (lead gate) to access mapbook PDFs
  - No downloadable KMZ, KML, GeoJSON, or Shapefile available publicly
  - No public API endpoint for network route data
  - The interactive map on zayo.com is rendered client-side with no data API

  Already in database:
  - 2,871 NV Zayo routes from Nevada OSIT ArcGIS FeatureServer
    (ingested via ingest-fiber-routes.py, prefix 'nv_zayo')
  - Source: services8.arcgis.com/.../Zayo_Region_10_May_2024/FeatureServer/605

  Conclusion: Zayo route data is proprietary. The only public source is
  the Nevada OSIT endpoint which publishes Zayo's open-access routes
  as part of the state's broadband program. Already ingested.
""")


# ── Source 4: Internet2 — NOT VIABLE ─────────────────────────

def report_internet2():
    """Report on Internet2 data availability."""
    print("\n" + "="*60)
    print("Source 4: Internet2 Network — NOT VIABLE")
    print("="*60)
    print("""
  Research findings:
  - internet2.edu/network/ has no downloadable data
  - No KMZ, KML, GeoJSON, Shapefile, or API endpoint found
  - Network map is interactive-only (likely Mapbox GL or custom renderer)
  - Searched: /network/, /network/internet2-infrastructure/,
    /network/internet2-network/, /community/internet2-network-map/
    — all return 404 or have no data links
  - sitemap.xml has no map/topology/infrastructure URLs
  - No public REST API for route geometry

  Internet2 operates ~16,000 miles of backbone fiber across the US
  but treats route geometry as proprietary/internal data.

  Conclusion: No machine-readable Internet2 route data available.
  Their backbone is primarily research/education — less relevant
  for datacenter site selection than commercial fiber providers.
""")


# ── Main ──────────────────────────────────────────────────────

def main():
    print("="*60)
    print("GridScout Fiber Route Ingestion — Additional Sources")
    print("="*60)

    if DRY_RUN:
        print("DRY RUN — no data will be written\n")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
        sys.exit(1)

    total_new = 0

    # Source 1: NTIA IRU routes
    total_new += ingest_ntia_iru()

    # Source 2: NTIA tracking enrichment
    enrich_ntia_tracking()

    # Source 3 & 4: Report on non-viable sources
    report_zayo()
    report_internet2()

    print("\n" + "="*60)
    print(f"SUMMARY: {total_new} new fiber routes ingested")
    print("="*60)


if __name__ == '__main__':
    main()

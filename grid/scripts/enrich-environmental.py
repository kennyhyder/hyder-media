#!/usr/bin/env python3
"""
Enrich grid_dc_sites with environmental constraint data from 3 free federal APIs.

Data Sources:
1. USFWS Critical Habitat — ArcGIS FeatureServer (Final layer 0 + Proposed layer 2)
   Endpoint: https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/USFWS_Critical_Habitat/FeatureServer
   Spatial query with envelope in inSR=4326. Returns species name + listing status.
   Layer 0 = Final (798 designations), Layer 2 = Proposed (53 designations)

2. NWI Wetlands — USFWS Wetlands_Raster ImageServer identify endpoint
   Endpoint: https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Raster/ImageServer/identify
   Point geometry, returns pixel value: "NoData" = no wetland, RGB color = wetland present.
   NOTE: Vector NWI MapServer (layer 0) is broken (500 errors on all spatial queries).
   NOTE: ESRI Living Atlas USA_Wetlands FeatureServer times out (>30s per query).
   Binary presence/absence only — no wetland type classification from raster.

3. EPA Superfund + Hazardous Waste — EPA EMEF MapServer
   Endpoint: https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer
   Layer 0 = Superfund (NPL sites), Layer 4 = Hazardous Waste
   Envelope query with inSR=4326, ~1km buffer. Native CRS is WGS84.
   Fields: primary_name, pgm_sys_acrnm (SEMS=Superfund)

Fields populated:
- critical_habitat       (boolean)  — site intersects USFWS critical habitat polygon
- critical_habitat_species (text)   — comma-separated species names
- wetland_present        (boolean)  — NWI wetland detected at site location
- wetland_type           (text)     — wetland classification (from raster: "detected" or NULL)
- superfund_nearby       (boolean)  — Superfund/hazwaste site within 1km
- superfund_site_name    (text)     — nearest contaminated site name
- environmental_flags    (jsonb)    — detailed constraint data for all 3 sources

Columns added to grid_dc_sites (run ADD COLUMN IF NOT EXISTS):
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS critical_habitat BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS critical_habitat_species TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wetland_present BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wetland_type TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS superfund_nearby BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS superfund_site_name TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS environmental_flags JSONB;

Usage:
  python3 -u scripts/enrich-environmental.py
  python3 -u scripts/enrich-environmental.py --dry-run
  python3 -u scripts/enrich-environmental.py --limit 500
  python3 -u scripts/enrich-environmental.py --state CA
  python3 -u scripts/enrich-environmental.py --source habitat
  python3 -u scripts/enrich-environmental.py --source wetlands
  python3 -u scripts/enrich-environmental.py --source superfund
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load env from grid/.env.local or solar/.env.local
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'solar', '.env.local')
load_dotenv(env_path)

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 200  # Flush PATCH to Supabase every 200 records
RATE_LIMIT = 0.05  # Seconds between ArcGIS queries per worker

# ============================================================================
# API Endpoints (all verified working as of 2026-03-10)
# ============================================================================

# USFWS Critical Habitat — envelope query with inSR=4326
# Layer 0: Final designations (798 polygons)
HABITAT_FINAL_URL = (
    "https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/"
    "USFWS_Critical_Habitat/FeatureServer/0/query"
)
# Layer 2: Proposed designations (53 polygons)
HABITAT_PROPOSED_URL = (
    "https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/"
    "USFWS_Critical_Habitat/FeatureServer/2/query"
)

# NWI Wetlands Raster — ImageServer identify (point geometry)
# Returns pixel value: "NoData" = no wetland, RGB = wetland present
WETLANDS_RASTER_URL = (
    "https://fwsprimary.wim.usgs.gov/server/rest/services/"
    "Wetlands_Raster/ImageServer/identify"
)

# EPA EMEF — MapServer query with envelope, native WGS84 (inSR=4326)
# Layer 0: Superfund NPL sites
EPA_SUPERFUND_URL = (
    "https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer/0/query"
)
# Layer 4: Hazardous Waste sites
EPA_HAZWASTE_URL = (
    "https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer/4/query"
)


# ============================================================================
# Supabase helpers
# ============================================================================

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
            with urllib.request.urlopen(req, timeout=30) as resp:
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


def load_paginated(table, select='*', filters='', page_size=1000):
    rows = []
    offset = 0
    while True:
        path = f"{table}?select={select}&limit={page_size}&offset={offset}{filters}"
        batch = supabase_request('GET', path, headers_extra={
            'Prefer': 'count=exact',
            'Range-Unit': 'items',
        })
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


# ============================================================================
# ArcGIS helpers
# ============================================================================

def arcgis_query(url, params, timeout=30):
    """Execute an ArcGIS REST query with retry. Returns features list or []."""
    encoded = urllib.parse.urlencode(params)
    full_url = f"{url}?{encoded}"
    req = urllib.request.Request(full_url)
    req.add_header('User-Agent', 'GridScout/1.0')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            if 'error' in data:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return []
            return data.get('features', [])
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return []
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return []


def arcgis_identify(url, params, timeout=20):
    """Execute an ArcGIS ImageServer identify call. Returns parsed JSON or None."""
    encoded = urllib.parse.urlencode(params)
    full_url = f"{url}?{encoded}"
    req = urllib.request.Request(full_url)
    req.add_header('User-Agent', 'GridScout/1.0')

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            if 'error' in data:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return None
            return data
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None


def make_envelope_str(lat, lng, buffer_m):
    """Create envelope string 'xmin,ymin,xmax,ymax' in WGS84 degrees."""
    lat_deg_per_m = 1.0 / 111320.0
    lng_deg_per_m = 1.0 / (111320.0 * max(0.01, math.cos(math.radians(lat))))
    d_lat = buffer_m * lat_deg_per_m
    d_lng = buffer_m * lng_deg_per_m
    return f'{lng - d_lng},{lat - d_lat},{lng + d_lng},{lat + d_lat}'


def haversine_km(lat1, lng1, lat2, lng2):
    """Distance in km between two WGS84 points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ============================================================================
# Source 1: USFWS Critical Habitat
# ============================================================================

def query_habitat(lat, lng):
    """
    Point-in-polygon query for critical habitat (Final + Proposed layers).
    Returns (is_habitat: bool, species_list: str or None).
    Uses small envelope (~100m) with inSR=4326 for spatial query.
    """
    species = []

    # ~100m envelope around the point
    envelope = make_envelope_str(lat, lng, 100)

    for url in [HABITAT_FINAL_URL, HABITAT_PROPOSED_URL]:
        features = arcgis_query(url, {
            'geometry': envelope,
            'geometryType': 'esriGeometryEnvelope',
            'inSR': '4326',
            'spatialRel': 'esriSpatialRelIntersects',
            'outFields': 'comname,status',
            'returnGeometry': 'false',
            'resultRecordCount': '20',
            'f': 'json',
        })
        for feat in features:
            attrs = feat.get('attributes', {})
            name = attrs.get('comname', '')
            status = attrs.get('status', '')
            if name:
                species.append(f"{name} ({status})")

    if species:
        # Deduplicate
        unique = list(dict.fromkeys(species))
        return True, ', '.join(unique[:10])  # Cap at 10 species
    return False, None


# ============================================================================
# Source 2: NWI Wetlands (Raster ImageServer)
# ============================================================================

def query_wetlands(lat, lng):
    """
    Query NWI Wetlands Raster at site location.
    Returns (wetland_present: bool, wetland_type: str or None).

    The raster returns:
    - "NoData" pixel value = no wetland
    - RGB color value (e.g. "127, 195, 28") = wetland present
    """
    params = {
        'geometry': json.dumps({
            "x": float(lng),
            "y": float(lat),
            "spatialReference": {"wkid": 4326}
        }),
        'geometryType': 'esriGeometryPoint',
        'returnGeometry': 'false',
        'returnCatalogItems': 'false',
        'f': 'json',
    }

    result = arcgis_identify(WETLANDS_RASTER_URL, params)
    if result is None:
        return None, None

    value = result.get('value', 'NoData')
    if value == 'NoData' or not value:
        return False, None
    else:
        # Wetland detected — raster is RGB so we can't get Cowardin type
        return True, 'detected'


# ============================================================================
# Source 3: EPA Superfund + Hazardous Waste
# ============================================================================

def query_superfund(lat, lng):
    """
    Query EPA Superfund (layer 0) and Hazardous Waste (layer 4) within ~1km.
    Returns (superfund_nearby: bool, site_name: str or None, flags: dict).
    """
    envelope = make_envelope_str(lat, lng, 1000)  # 1km buffer
    all_sites = []

    for url, layer_name in [(EPA_SUPERFUND_URL, 'superfund'), (EPA_HAZWASTE_URL, 'hazwaste')]:
        features = arcgis_query(url, {
            'geometry': envelope,
            'geometryType': 'esriGeometryEnvelope',
            'inSR': '4326',
            'spatialRel': 'esriSpatialRelIntersects',
            'outFields': 'primary_name,pgm_sys_acrnm',
            'returnGeometry': 'true',
            'outSR': '4326',
            'resultRecordCount': '20',
            'f': 'json',
        })

        for feat in features:
            attrs = feat.get('attributes', {})
            geom = feat.get('geometry', {})
            feat_lat = geom.get('y')
            feat_lng = geom.get('x')
            if feat_lat is not None and feat_lng is not None:
                dist = haversine_km(lat, lng, feat_lat, feat_lng)
                if dist <= 1.0:  # Exact 1km radius filter (envelope is a box)
                    all_sites.append({
                        'name': attrs.get('primary_name', 'Unknown'),
                        'type': layer_name,
                        'program': attrs.get('pgm_sys_acrnm', ''),
                        'distance_km': round(dist, 3),
                    })

    if not all_sites:
        return False, None, {}

    # Sort by distance, take nearest
    all_sites.sort(key=lambda s: s['distance_km'])
    nearest = all_sites[0]

    flags = {
        'superfund_count': sum(1 for s in all_sites if s['type'] == 'superfund'),
        'hazwaste_count': sum(1 for s in all_sites if s['type'] == 'hazwaste'),
        'nearest_name': nearest['name'],
        'nearest_type': nearest['type'],
        'nearest_distance_km': nearest['distance_km'],
        'sites': [{'name': s['name'], 'type': s['type'], 'distance_km': s['distance_km']}
                  for s in all_sites[:5]],
    }

    return True, nearest['name'], flags


# ============================================================================
# Processing functions (one per worker thread)
# ============================================================================

def process_site(site, sources):
    """
    Query all requested sources for a single site.
    Returns (site_id, patch_dict, found_count).
    """
    lat = float(site['latitude'])
    lng = float(site['longitude'])
    site_id = site['id']
    patch = {}
    env_flags = {}
    found = 0

    # Source 1: Critical Habitat
    if 'habitat' in sources:
        try:
            is_habitat, species_str = query_habitat(lat, lng)
            patch['critical_habitat'] = is_habitat
            if species_str:
                patch['critical_habitat_species'] = species_str
            else:
                patch['critical_habitat_species'] = None
            env_flags['critical_habitat'] = {
                'present': is_habitat,
                'species': species_str,
            }
            if is_habitat:
                found += 1
        except Exception as e:
            env_flags['critical_habitat_error'] = str(e)[:100]
        time.sleep(RATE_LIMIT)

    # Source 2: Wetlands
    if 'wetlands' in sources:
        try:
            wetland_present, wetland_type = query_wetlands(lat, lng)
            if wetland_present is not None:
                patch['wetland_present'] = wetland_present
                patch['wetland_type'] = wetland_type
                env_flags['wetland'] = {
                    'present': wetland_present,
                    'type': wetland_type,
                }
                if wetland_present:
                    found += 1
        except Exception as e:
            env_flags['wetland_error'] = str(e)[:100]
        time.sleep(RATE_LIMIT)

    # Source 3: Superfund
    if 'superfund' in sources:
        try:
            nearby, site_name, flags = query_superfund(lat, lng)
            patch['superfund_nearby'] = nearby
            patch['superfund_site_name'] = site_name
            if flags:
                env_flags['superfund'] = flags
            else:
                env_flags['superfund'] = {'nearby': False}
            if nearby:
                found += 1
        except Exception as e:
            env_flags['superfund_error'] = str(e)[:100]
        time.sleep(RATE_LIMIT)

    # Build environmental_flags JSONB from all sources
    # Pass as dict (not json.dumps string) so Supabase stores as native JSONB
    if env_flags:
        patch['environmental_flags'] = env_flags

    return site_id, patch, found


# ============================================================================
# Flush patches to Supabase
# ============================================================================

def flush_patches(patches, dry_run):
    """PATCH a list of (site_id, patch_dict) to Supabase one by one."""
    if dry_run:
        return 0, 0
    patched = 0
    errs = 0
    for site_id, patch_data in patches:
        try:
            eid = urllib.parse.quote(str(site_id), safe='')
            supabase_request('PATCH',
                             f"grid_dc_sites?id=eq.{eid}",
                             patch_data,
                             headers_extra={'Prefer': 'return=minimal'})
            patched += 1
        except Exception as e:
            errs += 1
            if errs <= 5:
                print(f"  Patch error for {site_id}: {e}")
    return patched, errs


# ============================================================================
# Schema migration
# ============================================================================

def ensure_columns():
    """Add new columns if they don't exist. Uses Supabase RPC or prints SQL."""
    # We can't run DDL via REST API. Print the SQL for manual execution.
    print("\n  Checking columns... (if new columns are needed, run the SQL below via psql)")
    print("""
  -- Run via psql if columns don't exist yet:
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS critical_habitat BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS critical_habitat_species TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wetland_present BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wetland_type TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS superfund_nearby BOOLEAN;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS superfund_site_name TEXT;
  ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS environmental_flags JSONB;
""")


# ============================================================================
# Main
# ============================================================================

def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    state_filter = None
    source_filter = None

    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
        elif arg == '--state' and i + 1 < len(sys.argv):
            state_filter = sys.argv[i + 1].upper()
        elif arg == '--source' and i + 1 < len(sys.argv):
            source_filter = sys.argv[i + 1].lower()

    valid_sources = ('habitat', 'wetlands', 'superfund')
    if source_filter and source_filter not in valid_sources:
        print(f"Unknown source: {source_filter}. Use: {', '.join(valid_sources)}")
        sys.exit(1)

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Environmental Constraints")
    print("=" * 55)

    ensure_columns()

    # Determine which sources to query
    if source_filter:
        sources = {source_filter}
    else:
        sources = set(valid_sources)
    print(f"  Sources: {', '.join(sorted(sources))}")

    # -----------------------------------------------------------------------
    # Load sites
    # -----------------------------------------------------------------------
    print("\n[1/2] Loading grid_dc_sites with coordinates...")
    filters = '&latitude=not.is.null&longitude=not.is.null&order=id'
    if state_filter:
        filters += f'&state=eq.{urllib.parse.quote(state_filter)}'

    # Build filter for sites that still need enrichment
    # A site needs enrichment if ANY of the requested source fields are NULL
    # PostgREST OR syntax: or=(field.is.null,field2.is.null)
    null_conditions = []
    if 'habitat' in sources:
        null_conditions.append('critical_habitat.is.null')
    if 'wetlands' in sources:
        null_conditions.append('wetland_present.is.null')
    if 'superfund' in sources:
        null_conditions.append('superfund_nearby.is.null')

    if null_conditions:
        or_clause = ','.join(null_conditions)
        filters += f'&or=({or_clause})'

    sites = load_paginated('grid_dc_sites',
                           'id,latitude,longitude,state',
                           filters)
    print(f"  {len(sites)} sites need enrichment")

    if limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  Nothing to do. All sites already enriched for requested sources.")
        return

    # State distribution
    by_state = {}
    for s in sites:
        st = s.get('state', 'XX')
        by_state.setdefault(st, []).append(s)
    top_states = sorted(by_state.items(), key=lambda x: -len(x[1]))[:10]
    state_str = ', '.join(f"{st}:{len(lst)}" for st, lst in top_states)
    print(f"  {len(by_state)} states (top: {state_str})")

    # -----------------------------------------------------------------------
    # Process sites with ThreadPoolExecutor
    # -----------------------------------------------------------------------
    print(f"\n[2/2] Querying {len(sources)} source(s) for {len(sites)} sites (15 workers)")
    print("-" * 55)

    pending = []
    queried = 0
    total_found = 0
    total_patched = 0
    total_errors = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=15) as executor:
        futures = {executor.submit(process_site, s, sources): s for s in sites}

        for future in as_completed(futures):
            queried += 1
            try:
                site_id, patch, found_count = future.result()
                if patch:
                    pending.append((site_id, patch))
                    total_found += found_count
            except Exception as e:
                total_errors += 1
                if total_errors <= 5:
                    site = futures[future]
                    print(f"  Error processing {site.get('id', '?')}: {e}")

            # Progress every 500 sites
            if queried % 500 == 0:
                elapsed = time.time() - start_time
                rate = queried / max(1, elapsed)
                remaining = len(sites) - queried
                eta_min = remaining / max(0.1, rate) / 60
                pct = 100.0 * queried / len(sites)
                print(f"  Progress: {queried}/{len(sites)} ({pct:.1f}%), "
                      f"{total_found} constraints found, "
                      f"{rate:.1f} sites/sec, ETA {eta_min:.0f}m")

            # Flush every BATCH_SIZE records
            if len(pending) >= BATCH_SIZE and not dry_run:
                p, e = flush_patches(pending, dry_run)
                total_patched += p
                total_errors += e
                if e > 0:
                    print(f"  FLUSH: {p} patched, {e} errors")
                pending = []

    # Final flush
    if pending:
        if dry_run:
            # Show samples
            print(f"\n  Would patch {len(pending)} sites. Samples:")
            for sid, pd in pending[:5]:
                # Truncate environmental_flags for display
                display = {k: v for k, v in pd.items() if k != 'environmental_flags'}
                print(f"    {sid}: {display}")
            # Summarize
            hab_true = sum(1 for _, p in pending if p.get('critical_habitat') is True)
            wet_true = sum(1 for _, p in pending if p.get('wetland_present') is True)
            sf_true = sum(1 for _, p in pending if p.get('superfund_nearby') is True)
            print(f"\n  Summary of {len(pending)} sites:")
            if 'habitat' in sources:
                print(f"    Critical habitat: {hab_true} ({100*hab_true/max(1,len(pending)):.1f}%)")
            if 'wetlands' in sources:
                print(f"    Wetland present:  {wet_true} ({100*wet_true/max(1,len(pending)):.1f}%)")
            if 'superfund' in sources:
                print(f"    Superfund nearby: {sf_true} ({100*sf_true/max(1,len(pending)):.1f}%)")
        else:
            p, e = flush_patches(pending, dry_run)
            total_patched += p
            total_errors += e

    elapsed = time.time() - start_time

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    print(f"\n{'=' * 55}")
    print(f"Environmental Enrichment Complete!")
    print(f"  Sites queried:      {queried}")
    print(f"  Constraints found:  {total_found}")
    print(f"  Records patched:    {total_patched}")
    print(f"  Errors:             {total_errors}")
    print(f"  Elapsed:            {elapsed:.0f}s ({elapsed/60:.1f}m)")
    if queried > 0:
        print(f"  Rate:               {queried/max(1,elapsed):.1f} sites/sec")
    if dry_run:
        print("  (DRY RUN - no changes made)")


if __name__ == '__main__':
    main()

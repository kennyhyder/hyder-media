#!/usr/bin/env python3
"""
Cross-Source Deduplication & Enrichment

Matches the same physical solar site across multiple data sources and
bidirectionally copies missing fields so each record is as complete as possible.
No records are deleted — only enrichment in place.

Matching strategy (3 phases, ordered by confidence):
  Phase 1: ID-based matching (EIA plant codes) — zero false positives
  Phase 2: Proximity matching (state+city+capacity, or coords) — high confidence
  Phase 3: Broad proximity (grid spatial index, all remaining) — moderate confidence

Usage:
  python3 -u scripts/crossref-dedup.py              # All phases
  python3 -u scripts/crossref-dedup.py --phase 1    # ID matching only
  python3 -u scripts/crossref-dedup.py --phase 2    # Proximity only
  python3 -u scripts/crossref-dedup.py --phase 3    # Broad proximity only
  python3 -u scripts/crossref-dedup.py --dry-run    # Report without patching
  python3 -u scripts/crossref-dedup.py --setup      # Add crossref_ids column (prints SQL)

Requires: crossref_ids JSONB column on solar_installations.
Run with --setup first if column doesn't exist.
"""

import os
import sys
import json
import math
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from dotenv import load_dotenv

# Load environment
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '..', '.env.local'))

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

PARALLEL_WORKERS = 20
CAPACITY_TOLERANCE = 0.50  # 50% tolerance for capacity matching
COORD_MATCH_KM = 0.5      # 500m for same-source proximity
BROAD_MATCH_KM = 0.5      # 500m for broad proximity (Phase 3)

# Location precision upgrade order (higher index = more precise)
PRECISION_RANK = {
    'state': 0,
    'county': 1,
    'zip': 2,
    'city': 3,
    'address': 4,
    'exact': 5,
}

# Fields we select from the database
SELECT_FIELDS = (
    "id,source_record_id,site_name,latitude,longitude,capacity_mw,"
    "state,city,zip_code,address,county,"
    "owner_name,operator_name,developer_name,installer_name,"
    "install_date,interconnection_date,total_cost,cost_per_watt,"
    "location_precision,crossref_ids"
)


# ─── Supabase helpers ───────────────────────────────────────────────

def supabase_get(table, params):
    """GET request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}"
            for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        if "crossref_ids" in body and "does not exist" in body:
            print("  ERROR: crossref_ids column does not exist.")
            print("  Run: python3 -u scripts/crossref-dedup.py --setup")
            sys.exit(1)
        print(f"  GET error ({e.code}): {body}")
        return []


def supabase_patch(record_id, data):
    """PATCH a single installation record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{record_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"  PATCH error ({e.code}) for {record_id}: {e.read().decode()[:200]}")
        return False


# ─── Geo helpers (from crossref-osm.py) ─────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    """Distance between two lat/lon points in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def grid_key(lat, lon, cell_size=0.01):
    """Grid cell key (~1.1 km cells at mid-latitudes)."""
    return (round(lat / cell_size), round(lon / cell_size))


def get_nearby_from_grid(grid, lat, lon):
    """Get all records from a grid within the 3x3 neighborhood."""
    key = grid_key(lat, lon)
    results = []
    for di in range(-1, 2):
        for dj in range(-1, 2):
            nkey = (key[0] + di, key[1] + dj)
            if nkey in grid:
                results.extend(grid[nkey])
    return results


# ─── Matching helpers (from crossref-tts-eia.py) ────────────────────

def normalize_city(city):
    """Normalize city name for matching."""
    if not city:
        return ""
    return (city.lower().strip()
            .replace(".", "")
            .replace(" city", "")
            .replace(" twp", "")
            .replace(" township", ""))


def capacity_match(cap1, cap2, tolerance=CAPACITY_TOLERANCE):
    """Check if two capacities are within tolerance of each other."""
    if not cap1 or not cap2:
        return False
    try:
        cap1 = float(cap1)
        cap2 = float(cap2)
    except (ValueError, TypeError):
        return False
    if cap1 == 0 or cap2 == 0:
        return False
    ratio = cap1 / cap2
    return (1 - tolerance) <= ratio <= (1 + tolerance)


# ─── Source prefix extraction ────────────────────────────────────────

def get_source_prefix(source_record_id):
    """Extract the source prefix (e.g., 'eia860', 'tts3') from a source_record_id."""
    if not source_record_id:
        return ""
    # Match prefix before first underscore + digits
    m = re.match(r'^([a-z]+\d*[a-z]*)_', source_record_id)
    return m.group(1) if m else ""


def extract_eia_plant_gen(source_record_id):
    """Extract (plant_code, generator_id) from eia860_XXXXX_YYY or eia860m_XXXXX_YYY."""
    if not source_record_id:
        return None, None
    # eia860_12345_GEN1 or eia860m_12345_GEN1
    m = re.match(r'^eia860m?_(\d+)_(.+)$', source_record_id)
    if m:
        return m.group(1), m.group(2)
    # eia860m_12345 (no generator suffix)
    m = re.match(r'^eia860m?_(\d+)$', source_record_id)
    if m:
        return m.group(1), None
    return None, None


def extract_lbnl_eia_id(source_record_id):
    """Extract numeric EIA plant ID from lbnl_XXXXX (only if numeric)."""
    if not source_record_id:
        return None
    m = re.match(r'^lbnl_(\d+)$', source_record_id)
    return m.group(1) if m else None


# ─── Enrichment builders ────────────────────────────────────────────

def build_enrichment(target, source):
    """Build a PATCH dict that fills NULL fields on target from source.
    Never overwrites existing values."""
    update = {}

    # Text fields: only fill if target is NULL
    for field in [
        'owner_name', 'operator_name', 'developer_name', 'installer_name',
        'address', 'city', 'county', 'zip_code',
    ]:
        if not target.get(field) and source.get(field):
            update[field] = source[field]

    # Date fields
    for field in ['install_date', 'interconnection_date']:
        if not target.get(field) and source.get(field):
            update[field] = source[field]

    # Numeric fields
    for field in ['total_cost', 'cost_per_watt']:
        if not target.get(field) and source.get(field):
            update[field] = source[field]

    return update


def build_location_enrichment(target, source):
    """Build location enrichment, only upgrading precision.
    Returns dict to merge into the PATCH, or empty dict."""
    update = {}

    # If target has no coords but source does, copy them
    if not target.get('latitude') and source.get('latitude'):
        update['latitude'] = source['latitude']
        update['longitude'] = source['longitude']
        # Set precision from source or default to 'city'
        src_prec = source.get('location_precision') or 'city'
        tgt_prec = target.get('location_precision') or 'state'
        if PRECISION_RANK.get(src_prec, 0) > PRECISION_RANK.get(tgt_prec, 0):
            update['location_precision'] = src_prec
        return update

    # If target has coords, only upgrade precision (don't change coords)
    if target.get('latitude') and source.get('latitude'):
        src_prec = source.get('location_precision') or 'city'
        tgt_prec = target.get('location_precision') or 'city'
        if PRECISION_RANK.get(src_prec, 0) > PRECISION_RANK.get(tgt_prec, 0):
            # Only upgrade precision if source coords are better
            update['location_precision'] = src_prec
            # If upgrading TO exact, also update coords
            if src_prec == 'exact':
                update['latitude'] = source['latitude']
                update['longitude'] = source['longitude']

    return update


def build_crossref_update(record, linked_source_record_id):
    """Add a source_record_id to the record's crossref_ids list."""
    existing = record.get('crossref_ids') or []
    if isinstance(existing, str):
        try:
            existing = json.loads(existing)
        except (json.JSONDecodeError, TypeError):
            existing = []
    if linked_source_record_id not in existing:
        return existing + [linked_source_record_id]
    return None  # Already linked


# ─── Data loading ───────────────────────────────────────────────────

def load_all_installations():
    """Load all 125K+ installations, paginated 1000/page."""
    print("Loading all installations...")
    records = []
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": SELECT_FIELDS,
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        records.extend(batch)
        offset += 1000
        if offset % 10000 == 0:
            print(f"  Loaded {len(records)} records...")
        if len(batch) < 1000:
            break
    print(f"  Total: {len(records)} installations loaded")
    return records


def load_uspvdb_eia_map():
    """Load USPVDB equipment records that have eia_id in specs.
    Returns dict: uspvdb_installation_id -> eia_plant_code."""
    print("Loading USPVDB equipment EIA IDs...")
    eia_map = {}
    offset = 0
    while True:
        batch = supabase_get("solar_equipment", {
            "select": "installation_id,specs",
            "equipment_type": "eq.module",
            "specs": "not.is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id",
        })
        if not batch:
            break
        for rec in batch:
            specs = rec.get('specs')
            if isinstance(specs, str):
                try:
                    specs = json.loads(specs)
                except (json.JSONDecodeError, TypeError):
                    continue
            if not isinstance(specs, dict):
                continue
            if specs and specs.get('eia_id'):
                eia_id = str(specs['eia_id']).strip()
                if eia_id and eia_id != 'None':
                    eia_map[rec['installation_id']] = eia_id
        offset += 1000
        if len(batch) < 1000:
            break
    print(f"  Found {len(eia_map)} USPVDB installations with EIA IDs")
    return eia_map


# ─── Phase implementations ──────────────────────────────────────────

def phase1_id_matching(records, uspvdb_eia_map):
    """Phase 1: ID-based matching using EIA plant codes.
    Returns list of (target_record, source_record) match pairs."""

    print("\n" + "=" * 60)
    print("PHASE 1: ID-Based Matching")
    print("=" * 60)

    matches = []

    # Index records by source prefix
    by_prefix = defaultdict(list)
    by_id = {}
    for rec in records:
        sid = rec.get('source_record_id', '')
        prefix = get_source_prefix(sid)
        by_prefix[prefix].append(rec)
        by_id[rec['id']] = rec

    print(f"  Record counts by source:")
    for prefix in sorted(by_prefix.keys()):
        if prefix:
            print(f"    {prefix}: {len(by_prefix[prefix])}")

    # --- 1a: EIA-860 ↔ EIA-860M ---
    print("\n  Phase 1a: EIA-860 ↔ EIA-860M (plant_code + generator_id)")
    eia860_index = {}  # (plant_code, gen_id) -> record
    for rec in by_prefix.get('eia860', []):
        plant, gen = extract_eia_plant_gen(rec['source_record_id'])
        if plant:
            eia860_index[(plant, gen)] = rec
            # Also index by plant_code only (for records with no gen match)
            if plant not in eia860_index:
                eia860_index[(plant, None)] = rec

    matched_1a = 0
    for rec in by_prefix.get('eia860m', []):
        plant, gen = extract_eia_plant_gen(rec['source_record_id'])
        if plant:
            # Try exact (plant, gen) first
            eia_rec = eia860_index.get((plant, gen))
            if not eia_rec and gen:
                # Try plant-only match
                eia_rec = eia860_index.get((plant, None))
            if eia_rec:
                matches.append((rec, eia_rec))
                matches.append((eia_rec, rec))  # Bidirectional
                matched_1a += 1

    print(f"    Matched: {matched_1a}")

    # --- 1b: EIA-860 ↔ LBNL ---
    print("\n  Phase 1b: EIA-860 ↔ LBNL (EIA plant code in LBNL source_record_id)")
    # Build plant_code -> eia860 record index
    eia_by_plant = {}
    for rec in by_prefix.get('eia860', []):
        plant, _ = extract_eia_plant_gen(rec['source_record_id'])
        if plant:
            eia_by_plant[plant] = rec

    matched_1b = 0
    for rec in by_prefix.get('lbnl', []):
        eia_id = extract_lbnl_eia_id(rec['source_record_id'])
        if eia_id and eia_id in eia_by_plant:
            eia_rec = eia_by_plant[eia_id]
            matches.append((rec, eia_rec))
            matches.append((eia_rec, rec))
            matched_1b += 1

    print(f"    Matched: {matched_1b}")

    # --- 1c: EIA-860 ↔ USPVDB (via equipment specs.eia_id) ---
    print("\n  Phase 1c: EIA-860 ↔ USPVDB (equipment specs.eia_id)")
    matched_1c = 0
    for uspvdb_install_id, eia_plant_code in uspvdb_eia_map.items():
        uspvdb_rec = by_id.get(uspvdb_install_id)
        eia_rec = eia_by_plant.get(eia_plant_code)
        if uspvdb_rec and eia_rec:
            matches.append((uspvdb_rec, eia_rec))
            matches.append((eia_rec, uspvdb_rec))
            matched_1c += 1

    print(f"    Matched: {matched_1c}")
    print(f"\n  Phase 1 total match pairs: {len(matches)} ({matched_1a + matched_1b + matched_1c} unique site matches)")

    return matches


def phase2_proximity_matching(records):
    """Phase 2: Proximity matching using state+city+capacity and coords.
    Returns list of (target_record, source_record) match pairs."""

    print("\n" + "=" * 60)
    print("PHASE 2: Proximity Matching")
    print("=" * 60)

    matches = []

    # Index records by source prefix
    by_prefix = defaultdict(list)
    for rec in records:
        sid = rec.get('source_record_id', '')
        prefix = get_source_prefix(sid)
        by_prefix[prefix].append(rec)

    # --- 2a: EIA ↔ TTS/CADG/NY/IL/MA (state + city + capacity) ---
    print("\n  Phase 2a: EIA ↔ state registries (state + city + capacity)")

    # Build EIA index by (state, normalized_city)
    eia_sources = list(by_prefix.get('eia860', [])) + list(by_prefix.get('eia860m', []))
    eia_city_index = defaultdict(list)
    for rec in eia_sources:
        state = (rec.get('state') or '').upper()
        city = normalize_city(rec.get('city'))
        if state and city:
            eia_city_index[(state, city)].append(rec)

    print(f"    EIA records with state+city: {sum(len(v) for v in eia_city_index.values())}")
    print(f"    EIA unique state+city groups: {len(eia_city_index)}")

    registry_prefixes = ['tts3', 'cadg', 'nysun', 'ilshines', 'mapts']
    matched_2a = 0

    for prefix in registry_prefixes:
        prefix_matched = 0
        for rec in by_prefix.get(prefix, []):
            state = (rec.get('state') or '').upper()
            city = normalize_city(rec.get('city'))
            if not state or not city:
                continue

            candidates = eia_city_index.get((state, city), [])
            if not candidates:
                continue

            # Require capacity match — city alone is too loose
            # (e.g., a single EIA utility plant in San Diego != TTS rooftop)
            best = None
            if rec.get('capacity_mw'):
                for eia_rec in candidates:
                    if capacity_match(rec['capacity_mw'], eia_rec.get('capacity_mw')):
                        best = eia_rec
                        break

            if best:
                matches.append((rec, best))
                matches.append((best, rec))
                prefix_matched += 1

        if by_prefix.get(prefix):
            print(f"    {prefix}: {prefix_matched}/{len(by_prefix[prefix])} matched")
        matched_2a += prefix_matched

    print(f"    Total 2a matches: {matched_2a}")

    # --- 2b: NY-Sun ↔ TTS3_NY (coordinate proximity) ---
    print("\n  Phase 2b: NY-Sun ↔ TTS_NY (coords within 500m)")

    # Build grid for TTS NY records with coords
    tts_ny = [r for r in by_prefix.get('tts3', [])
              if (r.get('state') or '').upper() == 'NY'
              and r.get('latitude') and r.get('longitude')]
    tts_ny_grid = defaultdict(list)
    for rec in tts_ny:
        key = grid_key(rec['latitude'], rec['longitude'])
        tts_ny_grid[key].append(rec)

    matched_2b = 0
    for rec in by_prefix.get('nysun', []):
        if not rec.get('latitude') or not rec.get('longitude'):
            continue
        nearby = get_nearby_from_grid(tts_ny_grid, rec['latitude'], rec['longitude'])
        best = None
        best_dist = COORD_MATCH_KM + 1
        for cand in nearby:
            dist = haversine_km(rec['latitude'], rec['longitude'],
                                cand['latitude'], cand['longitude'])
            if dist < best_dist:
                # Prefer capacity-confirmed matches
                if capacity_match(rec.get('capacity_mw'), cand.get('capacity_mw')):
                    best = cand
                    best_dist = dist
                elif dist < best_dist and not best:
                    best = cand
                    best_dist = dist

        if best and best_dist <= COORD_MATCH_KM:
            matches.append((rec, best))
            matches.append((best, rec))
            matched_2b += 1

    print(f"    Matched: {matched_2b}")

    # --- 2c: LBNL ↔ USPVDB (coordinate proximity + capacity) ---
    print("\n  Phase 2c: LBNL ↔ USPVDB (coords within 1km + capacity)")

    uspvdb_grid = defaultdict(list)
    for rec in by_prefix.get('uspvdb', []):
        if rec.get('latitude') and rec.get('longitude'):
            key = grid_key(rec['latitude'], rec['longitude'])
            uspvdb_grid[key].append(rec)

    matched_2c = 0
    for rec in by_prefix.get('lbnl', []):
        if not rec.get('latitude') or not rec.get('longitude'):
            continue
        nearby = get_nearby_from_grid(uspvdb_grid, rec['latitude'], rec['longitude'])
        best = None
        best_dist = 1.0 + 1  # 1km radius for this pair
        for cand in nearby:
            dist = haversine_km(rec['latitude'], rec['longitude'],
                                cand['latitude'], cand['longitude'])
            if dist < best_dist and capacity_match(rec.get('capacity_mw'), cand.get('capacity_mw')):
                best = cand
                best_dist = dist

        if best and best_dist <= 1.0:
            matches.append((rec, best))
            matches.append((best, rec))
            matched_2c += 1

    print(f"    Matched: {matched_2c}")
    print(f"\n  Phase 2 total match pairs: {len(matches)}")

    return matches


def phase3_broad_proximity(records, already_matched_ids):
    """Phase 3: Broad proximity matching for remaining unmatched records.
    Uses grid-based spatial index, 500m radius + tight capacity check.
    Only matches cross-tier sources (EIA/LBNL/USPVDB vs state registries).
    Returns list of (target_record, source_record) match pairs."""

    print("\n" + "=" * 60)
    print("PHASE 3: Broad Proximity Matching")
    print("=" * 60)

    matches = []

    # Source tier classification: only match across tiers
    # Tier 1: Federal/national (have owner/operator, often lack installer/equipment)
    # Tier 2: State registries (have installer/equipment, often lack owner/operator)
    TIER1 = {'eia860', 'eia860m', 'lbnl', 'uspvdb', 'iso'}
    TIER2 = {'tts3', 'tts', 'tts2', 'cadg', 'nysun', 'ilshines', 'mapts'}

    # Only consider records with coords that haven't been matched yet
    unmatched = [r for r in records
                 if r.get('latitude') and r.get('longitude')
                 and r['id'] not in already_matched_ids]

    print(f"  Unmatched records with coords: {len(unmatched)}")

    # Build grid
    grid = defaultdict(list)
    for rec in unmatched:
        key = grid_key(rec['latitude'], rec['longitude'])
        grid[key].append(rec)

    print(f"  Grid cells: {len(grid)}")

    # For each record, find cross-tier matches nearby
    matched_count = 0
    checked = 0
    TIGHT_TOLERANCE = 0.25  # Tighter 25% tolerance for broad matching

    for rec in unmatched:
        checked += 1
        rec_prefix = get_source_prefix(rec.get('source_record_id', ''))
        rec_tier = 1 if rec_prefix in TIER1 else (2 if rec_prefix in TIER2 else 0)
        if rec_tier == 0:
            continue

        nearby = get_nearby_from_grid(grid, rec['latitude'], rec['longitude'])

        for cand in nearby:
            if cand['id'] == rec['id']:
                continue
            cand_prefix = get_source_prefix(cand.get('source_record_id', ''))
            cand_tier = 1 if cand_prefix in TIER1 else (2 if cand_prefix in TIER2 else 0)

            # Must be from different source AND different tier
            if cand_prefix == rec_prefix or cand_tier == rec_tier:
                continue

            dist = haversine_km(rec['latitude'], rec['longitude'],
                                cand['latitude'], cand['longitude'])
            if dist <= BROAD_MATCH_KM:
                # Tight capacity match required
                if capacity_match(rec.get('capacity_mw'), cand.get('capacity_mw'),
                                  tolerance=TIGHT_TOLERANCE):
                    matches.append((rec, cand))
                    matched_count += 1

        if checked % 20000 == 0:
            print(f"  Progress: {checked}/{len(unmatched)} checked, {matched_count} matches")

    print(f"\n  Phase 3 raw match pairs: {matched_count}")
    print(f"  (includes bidirectional duplicates)")

    return matches


# ─── Patch application ──────────────────────────────────────────────

def apply_patches(match_pairs, all_records_by_id, dry_run=False):
    """Apply enrichment patches from match pairs.
    Each pair is (target_record, source_record) meaning:
    target gets enriched FROM source."""

    print("\n" + "=" * 60)
    print("Applying Enrichment Patches" + (" (DRY RUN)" if dry_run else ""))
    print("=" * 60)

    # Deduplicate and merge: for each target, collect all sources
    target_sources = defaultdict(list)
    for target, source in match_pairs:
        target_sources[target['id']].append(source)

    print(f"  Unique targets to enrich: {len(target_sources)}")

    # Build combined patches
    patches = {}  # record_id -> patch_dict
    crossref_updates = {}  # record_id -> [source_record_ids]

    stats = {
        'owner_name': 0,
        'operator_name': 0,
        'developer_name': 0,
        'installer_name': 0,
        'address': 0,
        'city': 0,
        'install_date': 0,
        'total_cost': 0,
        'location_upgraded': 0,
        'crossref_linked': 0,
    }

    for target_id, sources in target_sources.items():
        target = all_records_by_id[target_id]
        combined_patch = {}
        crossref_ids_to_add = []

        for source in sources:
            # Data enrichment (fill NULLs)
            enrichment = build_enrichment(target, source)
            # Only add fields not already in the combined patch
            for k, v in enrichment.items():
                if k not in combined_patch and not target.get(k):
                    combined_patch[k] = v

            # Location enrichment (precision upgrade only)
            loc_enrichment = build_location_enrichment(target, source)
            for k, v in loc_enrichment.items():
                if k not in combined_patch:
                    combined_patch[k] = v

            # Cross-reference link
            src_id = source.get('source_record_id')
            if src_id:
                crossref_ids_to_add.append(src_id)

        # Build crossref_ids update
        if crossref_ids_to_add:
            existing = target.get('crossref_ids') or []
            if isinstance(existing, str):
                try:
                    existing = json.loads(existing)
                except (json.JSONDecodeError, TypeError):
                    existing = []
            new_ids = [sid for sid in crossref_ids_to_add if sid not in existing]
            if new_ids:
                # Cap at 20 cross-references per record to prevent explosion
                all_ids = existing + new_ids
                if len(all_ids) > 20:
                    all_ids = all_ids[:20]
                combined_patch['crossref_ids'] = all_ids
                stats['crossref_linked'] += 1

        if combined_patch:
            patches[target_id] = combined_patch
            # Count stats
            for field in ['owner_name', 'operator_name', 'developer_name',
                          'installer_name', 'address', 'city', 'install_date', 'total_cost']:
                if field in combined_patch:
                    stats[field] += 1
            if 'location_precision' in combined_patch:
                stats['location_upgraded'] += 1

    print(f"  Patches to apply: {len(patches)}")
    print(f"\n  Field enrichment counts:")
    for field, count in sorted(stats.items()):
        if count > 0:
            print(f"    {field}: {count}")

    if dry_run:
        print("\n  DRY RUN - no patches applied")
        # Show sample patches
        sample_count = 0
        for rec_id, patch in list(patches.items())[:5]:
            rec = all_records_by_id[rec_id]
            print(f"\n  Sample: {rec.get('source_record_id')}")
            for k, v in patch.items():
                if k == 'crossref_ids':
                    print(f"    crossref_ids: +{len(v) - len(rec.get('crossref_ids') or [])} links")
                else:
                    print(f"    {k}: NULL → {str(v)[:60]}")
            sample_count += 1
        return stats

    # Apply patches in parallel
    print(f"\n  Applying {len(patches)} patches with {PARALLEL_WORKERS} workers...")
    applied = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
        futures = {
            executor.submit(supabase_patch, rec_id, data): rec_id
            for rec_id, data in patches.items()
        }
        for i, future in enumerate(as_completed(futures)):
            if future.result():
                applied += 1
            else:
                errors += 1
            if (i + 1) % 1000 == 0:
                print(f"    Progress: {i+1}/{len(patches)} ({applied} applied, {errors} errors)")

    print(f"\n  Applied: {applied}")
    print(f"  Errors: {errors}")
    return stats


# ─── Main ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Cross-source deduplication & enrichment')
    parser.add_argument('--phase', type=int, choices=[1, 2, 3],
                        help='Run only a specific phase (1=ID, 2=proximity, 3=broad)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Report matches without applying patches')
    parser.add_argument('--setup', action='store_true',
                        help='Print SQL to add crossref_ids column')
    args = parser.parse_args()

    if args.setup:
        print("Run this SQL in Supabase SQL Editor (https://supabase.com/dashboard):")
        print()
        print("  ALTER TABLE solar_installations")
        print("    ADD COLUMN IF NOT EXISTS crossref_ids JSONB DEFAULT '[]'::jsonb;")
        print()
        print("Then re-run this script without --setup.")
        return

    print("Cross-Source Deduplication & Enrichment")
    print("=" * 60)
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"  Phase: {args.phase or 'ALL'}")
    print(f"  Workers: {PARALLEL_WORKERS}")
    print()

    # Load data
    records = load_all_installations()
    records_by_id = {r['id']: r for r in records}

    # Track which records get matched (for Phase 3 exclusion)
    all_matches = []
    matched_ids = set()

    # Phase 1: ID-based matching
    if not args.phase or args.phase == 1:
        uspvdb_eia_map = load_uspvdb_eia_map()
        p1_matches = phase1_id_matching(records, uspvdb_eia_map)
        all_matches.extend(p1_matches)
        for t, s in p1_matches:
            matched_ids.add(t['id'])
            matched_ids.add(s['id'])

    # Phase 2: Proximity matching
    if not args.phase or args.phase == 2:
        p2_matches = phase2_proximity_matching(records)
        all_matches.extend(p2_matches)
        for t, s in p2_matches:
            matched_ids.add(t['id'])
            matched_ids.add(s['id'])

    # Phase 3: Broad proximity
    if not args.phase or args.phase == 3:
        p3_matches = phase3_broad_proximity(records, matched_ids)
        all_matches.extend(p3_matches)

    # Deduplicate match pairs: keep unique (target_id, source_id) pairs
    seen_pairs = set()
    unique_matches = []
    for target, source in all_matches:
        pair_key = (target['id'], source['id'])
        if pair_key not in seen_pairs:
            seen_pairs.add(pair_key)
            unique_matches.append((target, source))

    print(f"\n{'=' * 60}")
    print(f"Total unique match pairs: {len(unique_matches)}")
    print(f"Unique records involved: {len(set(t['id'] for t, _ in unique_matches) | set(s['id'] for _, s in unique_matches))}")

    # Apply patches
    stats = apply_patches(unique_matches, records_by_id, dry_run=args.dry_run)

    print(f"\n{'=' * 60}")
    print("Done!")


if __name__ == "__main__":
    main()

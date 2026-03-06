#!/usr/bin/env python3
"""
Cross-reference ERCOT SCED binding constraints to transmission lines.

Matches constraint from_station/to_station names to transmission line sub_1/sub_2,
then aggregates shadow_price, binding_count, and mw_limit onto grid_transmission_lines.

Usage:
    python3 -u scripts/crossref-ercot-lines.py
    python3 -u scripts/crossref-ercot-lines.py --dry-run
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
import argparse
from collections import defaultdict
from dotenv import load_dotenv

# Load env vars from grid/.env.local
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
BATCH_SIZE = 50


def supabase_request(method, path, body=None, extra_headers=None):
    """Make a request to the Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if extra_headers:
        headers.update(extra_headers)

    data = json.dumps(body).encode() if body else None

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                content = resp.read().decode()
                return json.loads(content) if content.strip() else None
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


def normalize_station(name):
    """Normalize a station name for matching.

    ERCOT constraint station names (e.g., 'NELRIO', 'BRUNI_69_1') are abbreviated
    codes, while HIFLD substation names (e.g., 'Nelson Rio Grande', 'Bruni') are
    more descriptive. We extract the core name part and join WITHOUT underscores
    to match the HIFLD space-removed format in the station index.
    """
    if not name:
        return ''
    s = name.upper().strip()
    # Remove trailing _kV_N patterns (e.g., _69_1, _138_2)
    parts = s.split('_')
    core_parts = []
    for p in parts:
        if p.isdigit():
            break
        core_parts.append(p)
    # Join WITHOUT underscores so LA_PALMA -> LAPALMA (matches HIFLD "LA PALMA" -> "LAPALMA")
    return ''.join(core_parts) if core_parts else s


def levenshtein(s1, s2):
    """Compute Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


# Manual mapping for ERCOT compressed/abbreviated station names -> HIFLD normalized names.
# ERCOT uses aggressive abbreviation (max 8 chars) that can't be resolved algorithmically.
ERCOT_TO_HIFLD = {
    'NELRIO': ['NELSONRIOGRANDE', 'NELSONRIO'],
    'HONDOCK': ['HONDOCREEK', 'HONDO'],
    'SANMIGL': ['SANMIGUEL'],
    'SANELENA': ['SANELENA'],
    'RANCHOSEC': ['RANCHOSECO'],
    'LAGOVST': ['LAGOVISTA'],
    'PALMHUR': ['PALMHURST'],
    'SEADRFTC': ['SEADRIFT', 'SEADRIFTCOKE'],
    'JOURDANT': ['JOURDANTON'],
    'NATALISS': ['NATALIA'],
    'SOMMRVL': ['SOMERVILLE'],
    'WESLAU': ['WESLACO'],
    'TOMBSTNE': ['TOMBSTONE'],
    'FURHMAN': ['FUHRMAN'],
    'VICTOIA': ['VICTORIA'],
    'VONORMY': ['VONORMY'],
    'ELNINDIO': ['ELNINDIO'],
    'RIOHONDO': ['RIOHONDO'],
    'ROUNDMT': ['ROUNDMOUNTAIN', 'ROUNDMT'],
    'WLAREDO': ['WESTLAREDO', 'WLAREDO'],
    'BDAVIS': ['BDAVIS', 'FORTDAVIS'],
    'MVRIOHO': ['MVRIOHO', 'MISSIONVALLEYRIOHONDO'],
    'FLATTOP': ['FLATTOP'],
}


def load_constraints():
    """Load all ERCOT constraint records from DB."""
    all_records = []
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_ercot_constraints?select=constraint_name,from_station,to_station,'
            f'from_station_kv,to_station_kv,shadow_price,limit_mw,violated_mw'
            f'&limit={page_size}&offset={offset}&order=id'
        )
        if not result:
            break
        all_records.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
    return all_records


def load_tx_lines():
    """Load all Texas transmission lines with substation info."""
    all_lines = []
    offset = 0
    page_size = 1000
    while True:
        result = supabase_request(
            'GET',
            f'grid_transmission_lines?select=id,hifld_id,sub_1,sub_2,voltage_kv,'
            f'capacity_mw,upgrade_candidate,naession,owner,state'
            f'&state=eq.TX'
            f'&limit={page_size}&offset={offset}&order=id'
        )
        if not result:
            break
        all_lines.extend(result)
        if len(result) < page_size:
            break
        offset += page_size
    return all_lines


def build_station_index(lines):
    """Build a lookup from normalized station name -> list of line IDs.

    For each line, index both sub_1 and sub_2 names.
    """
    index = defaultdict(list)
    for line in lines:
        line_id = line['id']
        sub_1 = line.get('sub_1')
        sub_2 = line.get('sub_2')
        voltage = line.get('voltage_kv')

        if sub_1:
            # Normalize the HIFLD substation name
            norm = sub_1.upper().strip().replace(' ', '')
            index[norm].append({
                'id': line_id,
                'sub': sub_1,
                'voltage_kv': voltage,
                'capacity_mw': line.get('capacity_mw'),
                'endpoint': 'sub_1'
            })
        if sub_2:
            norm = sub_2.upper().strip().replace(' ', '')
            index[norm].append({
                'id': line_id,
                'sub': sub_2,
                'voltage_kv': voltage,
                'capacity_mw': line.get('capacity_mw'),
                'endpoint': 'sub_2'
            })
    return index


def clean_ercot_name(name):
    """Strip ERCOT-specific suffixes and return candidate names to try.

    ERCOT naming patterns:
    - SW suffix = Switch (DEVINESW, DILLEYSW, BAKESW)
    - SRC suffix = Source (COFESSRC, WALTSSRC, TEXASSRC)
    - SWT suffix = Switch (EDCSWT, ESTSWT, GOLDSWWT, SHFTSWT, TRIPPSWT, PTSWT)
    - WWT suffix variant (GOLDSWWT)
    """
    candidates = [name]
    for suffix in ['SRC', 'SWT', 'WWT', 'SW']:
        if name.endswith(suffix) and len(name) - len(suffix) >= 3:
            stripped = name[:-len(suffix)]
            candidates.append(stripped)
    return candidates


def station_name_match(ercot_name, hifld_name):
    """Check if an ERCOT station name matches an HIFLD substation name.

    Multi-strategy matching:
    1. Exact match
    2. Manual mapping table (for compressed abbreviations)
    3. Prefix match: shorter >= 4 chars AND covers >= 40% of longer name
    4. Suffix-stripped match: strip SW/SRC/SWT then retry prefix
    5. Levenshtein distance <= 2 for strings >= 5 chars (spelling variants)
    """
    if not ercot_name or not hifld_name:
        return False
    if ercot_name == hifld_name:
        return True

    # Check manual mapping table
    if ercot_name in ERCOT_TO_HIFLD:
        return hifld_name in ERCOT_TO_HIFLD[ercot_name]

    # Try all cleaned variants of the ERCOT name
    ercot_candidates = clean_ercot_name(ercot_name)

    for ercot_clean in ercot_candidates:
        if ercot_clean == hifld_name:
            return True

        # Prefix matching (ERCOT is typically the shorter/truncated name)
        if len(ercot_clean) <= len(hifld_name):
            shorter, longer = ercot_clean, hifld_name
        else:
            shorter, longer = hifld_name, ercot_clean

        # Same length, different strings — try edit distance below
        if len(shorter) != len(longer) and len(shorter) >= 4:
            if longer.startswith(shorter):
                # 40% coverage threshold (lowered from 60% to handle multi-word HIFLD names
                # like ARGYLESWITCH where ERCOT truncates to ARGYL)
                if len(shorter) / len(longer) >= 0.4:
                    return True

        # Levenshtein distance for spelling variants (KLEBERG/KLEBURG, ODESA/ODESSA)
        if len(ercot_clean) >= 5 and len(hifld_name) >= 5:
            len_diff = abs(len(ercot_clean) - len(hifld_name))
            if len_diff <= 2:
                dist = levenshtein(ercot_clean, hifld_name)
                # Allow 1 edit for strings 5-6 chars, 2 edits for 7+ chars
                max_edits = 1 if min(len(ercot_clean), len(hifld_name)) < 7 else 2
                if dist <= max_edits:
                    return True

    return False


def build_ercot_to_hifld_map(ercot_stations, station_index):
    """Pre-compute mapping from ERCOT station names to matching HIFLD index keys.

    This runs ONCE for all 144 ERCOT stations against 5,243 HIFLD keys,
    instead of per-constraint (17,813 × 5,243 = too slow with Levenshtein).
    """
    mapping = {}  # ercot_norm -> set of matching HIFLD index keys

    for ercot_norm in ercot_stations:
        matched_keys = set()

        # 1. Exact lookup
        if ercot_norm in station_index:
            matched_keys.add(ercot_norm)

        # 2. Manual mapping table
        if ercot_norm in ERCOT_TO_HIFLD:
            for mapped_name in ERCOT_TO_HIFLD[ercot_norm]:
                if mapped_name in station_index:
                    matched_keys.add(mapped_name)

        # 3. Suffix-stripped variants
        for ercot_clean in clean_ercot_name(ercot_norm):
            if ercot_clean != ercot_norm and ercot_clean in station_index:
                matched_keys.add(ercot_clean)

        # 4. Fuzzy matching against all index keys (prefix + edit distance)
        for norm_key in station_index:
            if station_name_match(ercot_norm, norm_key):
                matched_keys.add(norm_key)

        if matched_keys:
            mapping[ercot_norm] = matched_keys

    return mapping


def match_constraint_to_lines(constraint, station_index, lines_by_id, ercot_hifld_map):
    """Try to match an ERCOT constraint to one or more transmission lines.

    Uses pre-computed ERCOT→HIFLD station mapping for fast lookups.

    Strategy:
    1. Look up from/to station names in pre-computed mapping
    2. Get candidate line IDs from matching HIFLD keys
    3. Filter by voltage tolerance (±20 kV)
    4. Prefer connecting matches (both endpoints match same line)
    5. Strict single-station fallback (exactly 1 line + voltage confirmation)
    """
    from_station = constraint.get('from_station')
    to_station = constraint.get('to_station')
    from_kv = constraint.get('from_station_kv')
    to_kv = constraint.get('to_station_kv')

    if not from_station and not to_station:
        return []

    from_norm = normalize_station(from_station)
    to_norm = normalize_station(to_station)

    def find_station_lines(ercot_norm, kv):
        """Find line IDs matching an ERCOT station via pre-computed map."""
        if not ercot_norm or ercot_norm not in ercot_hifld_map:
            return set()

        candidates = set()
        for hifld_key in ercot_hifld_map[ercot_norm]:
            for entry in station_index[hifld_key]:
                if kv and entry['voltage_kv']:
                    try:
                        if abs(float(kv) - float(entry['voltage_kv'])) > 20:
                            continue
                    except (ValueError, TypeError):
                        pass
                candidates.add(entry['id'])
        return candidates

    from_lines = find_station_lines(from_norm, from_kv)
    to_lines = find_station_lines(to_norm, to_kv)

    # Only accept connecting matches: lines where one endpoint matches from_station
    # and the other matches to_station. Single-station matches are too noisy.
    if from_lines and to_lines:
        connecting = from_lines & to_lines
        if connecting:
            return list(connecting)

    # Strict fallback: single-station match ONLY if exactly 1 line matches
    # and we have voltage confirmation. This handles cases where both ERCOT
    # stations are on the same HIFLD line but only one name was resolved.
    if from_kv and len(from_lines) == 1:
        return list(from_lines)
    if to_kv and len(to_lines) == 1:
        return list(to_lines)

    return []


def aggregate_constraints(constraints, station_index, lines_by_id, ercot_hifld_map):
    """Aggregate constraint data per transmission line.

    For each line, compute:
    - ercot_shadow_price: average shadow price across all matched constraints
    - ercot_binding_count: total number of binding intervals
    - ercot_mw_limit: average MW limit from constraints
    """
    line_stats = defaultdict(lambda: {
        'shadow_prices': [],
        'binding_count': 0,
        'mw_limits': [],
        'constraints': set(),
    })

    matched_count = 0
    unmatched_count = 0

    for c in constraints:
        line_ids = match_constraint_to_lines(c, station_index, lines_by_id, ercot_hifld_map)
        if line_ids:
            matched_count += 1
            cname = c.get('constraint_name', 'UNKNOWN')
            for lid in line_ids:
                stats = line_stats[lid]
                sp = c.get('shadow_price')
                if sp is not None:
                    stats['shadow_prices'].append(float(sp))
                stats['binding_count'] += 1
                lm = c.get('limit_mw')
                if lm is not None:
                    stats['mw_limits'].append(float(lm))
                stats['constraints'].add(cname)
        else:
            unmatched_count += 1

    return line_stats, matched_count, unmatched_count


def main():
    parser = argparse.ArgumentParser(
        description='Cross-reference ERCOT SCED constraints to transmission lines'
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview without updating database')
    args = parser.parse_args()

    print("=" * 60)
    print("GridScout: ERCOT Constraint -> Transmission Line Cross-Reference")
    print("=" * 60)
    if args.dry_run:
        print("DRY RUN: No changes will be made")

    # Load data
    print("\n  Loading ERCOT constraints...")
    constraints = load_constraints()
    print(f"  {len(constraints):,} constraint records loaded")

    if not constraints:
        print("  No constraints to process. Run ingest-ercot-sced.py first.")
        return

    print("  Loading Texas transmission lines...")
    lines = load_tx_lines()
    print(f"  {len(lines):,} TX lines loaded")

    # Build index
    print("  Building substation name index...")
    station_index = build_station_index(lines)
    print(f"  {len(station_index):,} unique station names indexed")

    lines_by_id = {l['id']: l for l in lines}

    # Show some sample station names for debugging
    ercot_stations = set()
    for c in constraints:
        if c.get('from_station'):
            ercot_stations.add(normalize_station(c['from_station']))
        if c.get('to_station'):
            ercot_stations.add(normalize_station(c['to_station']))

    print(f"  {len(ercot_stations):,} unique ERCOT station names")

    # Show overlap
    hifld_stations = set(station_index.keys())
    overlap = ercot_stations & hifld_stations
    print(f"  Exact name overlap: {len(overlap)} stations")

    if overlap:
        sample = sorted(overlap)[:10]
        print(f"  Sample matches: {', '.join(sample)}")

    # Pre-compute ERCOT -> HIFLD station name mapping (once, not per-constraint)
    print("  Building ERCOT -> HIFLD station mapping...")
    ercot_hifld_map = build_ercot_to_hifld_map(ercot_stations, station_index)
    print(f"  {len(ercot_hifld_map):,} of {len(ercot_stations):,} ERCOT stations mapped to HIFLD")

    unmapped = sorted(ercot_stations - set(ercot_hifld_map.keys()))
    if unmapped:
        print(f"  Unmapped ERCOT stations ({len(unmapped)}): {', '.join(unmapped[:20])}")
        if len(unmapped) > 20:
            print(f"    ... and {len(unmapped) - 20} more")

    # Aggregate
    print("\n  Matching constraints to lines...")
    line_stats, matched, unmatched = aggregate_constraints(
        constraints, station_index, lines_by_id, ercot_hifld_map
    )
    print(f"  {matched:,} constraint records matched to {len(line_stats):,} lines")
    print(f"  {unmatched:,} constraint records unmatched")

    if not line_stats:
        print("\n  No matches found. ERCOT station names may not align with HIFLD substation names.")
        print("  This is expected — ERCOT uses internal codes while HIFLD uses full names.")
        print("  Consider enriching grid_substations with ERCOT station name mappings.")
        return

    # Show top lines by congestion
    print(f"\n  Top 10 Most Congested Lines:")
    print(f"  {'Line ID':<38} {'Binding':>8} {'Avg $/MW':>10} {'Avg MW Limit':>12}")
    print(f"  {'─' * 38} {'─' * 8} {'─' * 10} {'─' * 12}")

    sorted_lines = sorted(
        line_stats.items(),
        key=lambda x: x[1]['binding_count'],
        reverse=True
    )
    for lid, stats in sorted_lines[:10]:
        line = lines_by_id.get(lid, {})
        avg_sp = sum(stats['shadow_prices']) / len(stats['shadow_prices']) if stats['shadow_prices'] else 0
        avg_lm = sum(stats['mw_limits']) / len(stats['mw_limits']) if stats['mw_limits'] else 0
        name = line.get('naession') or f"{line.get('sub_1', '?')} - {line.get('sub_2', '?')}"
        name = name[:36] if len(name) > 36 else name
        print(f"  {name:<38} {stats['binding_count']:>8,} ${avg_sp:>9.2f} {avg_lm:>12.1f}")

    # Update transmission lines
    if args.dry_run:
        print(f"\n  DRY RUN: Would update {len(line_stats):,} transmission lines")
        return

    print(f"\n  Updating {len(line_stats):,} transmission lines...")
    updated = 0
    errors = 0

    for lid, stats in line_stats.items():
        avg_sp = sum(stats['shadow_prices']) / len(stats['shadow_prices']) if stats['shadow_prices'] else None
        avg_lm = sum(stats['mw_limits']) / len(stats['mw_limits']) if stats['mw_limits'] else None

        # Round for clean display
        if avg_sp is not None:
            avg_sp = round(avg_sp, 2)
        if avg_lm is not None:
            avg_lm = round(avg_lm, 1)

        try:
            supabase_request(
                'PATCH',
                f'grid_transmission_lines?id=eq.{lid}',
                {
                    'ercot_shadow_price': avg_sp,
                    'ercot_binding_count': stats['binding_count'],
                    'ercot_mw_limit': avg_lm,
                }
            )
            updated += 1
            if updated % 100 == 0:
                print(f"    {updated}/{len(line_stats)} updated")
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"    Error updating {lid}: {e}")

    print(f"\n{'=' * 60}")
    print("ERCOT Cross-Reference Complete")
    print(f"  Constraint records processed: {len(constraints):,}")
    print(f"  Matched to lines: {matched:,} ({matched * 100 / len(constraints):.1f}%)")
    print(f"  Unmatched: {unmatched:,}")
    print(f"  Lines updated: {updated:,}")
    print(f"  Errors: {errors:,}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

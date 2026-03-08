#!/usr/bin/env python3
"""
Score DC candidate sites with composite DC Readiness Score (0-100).

Phase 3b of the GridScout DC plan. Weighted formula:
  DC_Score = 0.25*power + 0.20*speed_to_power + 0.15*fiber
           + 0.10*water + 0.10*hazard + 0.05*labor
           + 0.05*existing_dc + 0.05*land + 0.03*tax + 0.02*climate

Each sub-score is 0-100. Higher = better for DC development.

Target: grid_dc_sites (updates dc_score + 10 sub-scores)
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# Sub-score weights (must sum to 1.0)
# Recalibrated per I Squared Capital feedback:
# - Water dropped from 10% to 3% ("helpful but much lower weighted")
# - Power and fiber increased (core requirements)
# - Existing DC cluster value increased
WEIGHTS = {
    'power': 0.30,
    'speed_to_power': 0.20,
    'fiber': 0.18,
    'water': 0.03,
    'hazard': 0.07,
    'labor': 0.05,
    'existing_dc': 0.07,
    'land': 0.05,
    'tax': 0.03,
    'climate': 0.02,
}


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
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def load_paginated(table, select, extra_filter='', page_size=1000):
    records = []
    offset = 0
    while True:
        path = f'{table}?select={select}{extra_filter}&order=id&limit={page_size}&offset={offset}'
        rows = supabase_request('GET', path)
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break
    return records


def build_grid_index(items, lat_key='latitude', lng_key='longitude', cell_size=0.5):
    index = {}
    for item in items:
        lat = item.get(lat_key)
        lng = item.get(lng_key)
        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)
        cell = (int(lat / cell_size), int(lng / cell_size))
        if cell not in index:
            index[cell] = []
        index[cell].append(item)
    return index


def find_nearest(lat, lng, spatial_index, cell_size=0.5, max_km=250):
    """Find nearest item from spatial index."""
    cell_lat = int(lat / cell_size)
    cell_lng = int(lng / cell_size)
    search_cells = max(2, int(max_km / (111 * cell_size)) + 1)

    best = None
    best_dist = float('inf')

    for di in range(-search_cells, search_cells + 1):
        for dj in range(-search_cells, search_cells + 1):
            cell = (cell_lat + di, cell_lng + dj)
            for item in spatial_index.get(cell, []):
                dist = haversine_km(lat, lng, float(item['latitude']), float(item['longitude']))
                if dist < best_dist:
                    best_dist = dist
                    best = item

    if best and best_dist <= max_km:
        return best, round(best_dist, 2)
    return None, None


def clamp(val, lo=0, hi=100):
    return max(lo, min(hi, val))


def linear_score(val, best_val, worst_val):
    """Linear interpolation: best_val → 100, worst_val → 0."""
    if val is None:
        return 50  # Default to neutral
    if best_val == worst_val:
        return 50
    score = 100 * (val - worst_val) / (best_val - worst_val)
    return clamp(score)


# ═══════════════════════════════════════════════════════════
# Sub-score functions (each returns 0-100)
# ═══════════════════════════════════════════════════════════

def score_power(site):
    """Power availability: substation distance, voltage, capacity."""
    dist = site.get('nearest_substation_distance_km')
    voltage = site.get('substation_voltage_kv')
    capacity = site.get('available_capacity_mw')

    # Distance: 0 km = 100, 10 km = 0
    dist_score = linear_score(dist, 0, 10) if dist is not None else 30

    # Voltage: 500 kV = 100, 69 kV = 30
    voltage_score = linear_score(voltage, 500, 69) if voltage else 30

    # Capacity: 200+ MW = 100, 0 MW = 0
    capacity_score = linear_score(capacity, 200, 0) if capacity else 30

    return clamp(dist_score * 0.4 + voltage_score * 0.35 + capacity_score * 0.25)


def score_speed_to_power(site, queue_data):
    """Speed to energization: ISO queue depth, wait time, congestion."""
    state = site.get('state', '')
    iso = site.get('iso_region', '')

    # Find best queue summary for this state/ISO — prefer state match with wait data
    queue_depth = None
    avg_wait = None
    best_match = None
    for q in queue_data:
        if q.get('state') == state and q.get('iso') == iso:
            if q.get('avg_wait_years') is not None:
                best_match = q
                break
            elif best_match is None:
                best_match = q
        elif q.get('iso') == iso and best_match is None:
            best_match = q

    if best_match:
        queue_depth = best_match.get('total_projects')
        avg_wait = best_match.get('avg_wait_years')

    # Fall back to site's own avg_queue_wait_years (set by enrich-queue-wait-times.py)
    if avg_wait is None:
        avg_wait = site.get('avg_queue_wait_years')

    # Store queue info on site for patch output
    site['_queue_depth'] = queue_depth
    site['_avg_queue_wait_years'] = avg_wait

    # Queue depth score: fewer projects = faster (0 projects = 100, 30+ = 0)
    if queue_depth is not None:
        depth_score = linear_score(queue_depth, 0, 30)
    else:
        depth_score = 50

    # Wait time score: shorter wait = better (1 year = 100, 6+ years = 0)
    # LBNL data: ERCOT ~2.5yr (fast), PJM ~4.5yr (slow), CAISO ~5yr (slowest)
    if avg_wait is not None:
        wait_score = linear_score(float(avg_wait), 1.0, 6.0)
    else:
        wait_score = 50

    # Combine: 40% depth + 60% wait time (wait time is more actionable)
    queue_score = 0.4 * depth_score + 0.6 * wait_score

    if site.get('brownfield_id'):
        # Brownfield sites get a bonus for existing grid connection, but scale
        # the base queue_score down so the bonus creates differentiation rather
        # than saturating all brownfields at 100.
        # Base: 60% of queue_score (max 60) + brownfield bonus (10)
        # + capacity bonus (0-20 based on existing infrastructure size)
        # + substation proximity bonus (0-10 based on distance)
        # Result range: ~20 to ~100 depending on queue, capacity, and substation distance
        brownfield_bonus = 10

        capacity_bonus = 0
        existing_cap = site.get('existing_capacity_mw')
        if existing_cap and float(existing_cap) > 0:
            # 500+ MW = full 20 points, scales linearly from 0
            capacity_bonus = min(20, float(existing_cap) / 25)

        # Substation proximity bonus: closer substation = faster energization
        sub_dist = site.get('nearest_substation_distance_km')
        proximity_bonus = 0
        if sub_dist is not None:
            if float(sub_dist) < 1:
                proximity_bonus = 10
            elif float(sub_dist) < 5:
                proximity_bonus = 7
            elif float(sub_dist) < 15:
                proximity_bonus = 4
            elif float(sub_dist) < 30:
                proximity_bonus = 2

        return clamp(queue_score * 0.6 + brownfield_bonus + capacity_bonus + proximity_bonus)
    else:
        return clamp(queue_score)


def score_fiber(site, ixp_index, ixp_cell_size, county_data):
    """Fiber connectivity: IXP distance + county fiber presence."""
    lat, lng = site['latitude'], site['longitude']

    # Find nearest IXP
    nearest_ixp, ixp_dist = find_nearest(lat, lng, ixp_index, ixp_cell_size, max_km=250)

    # IXP distance: 0 km = 100, 50 km = 0
    ixp_score = linear_score(ixp_dist, 0, 50) if ixp_dist is not None else 10

    # Store nearest IXP info on site for later use
    if nearest_ixp:
        site['_nearest_ixp_id'] = nearest_ixp['id']
        site['_nearest_ixp_name'] = nearest_ixp.get('name')
        site['_nearest_ixp_distance_km'] = ixp_dist

    # County fiber: has_fiber = 100, no fiber = 30
    fips = site.get('fips_code')
    county = county_data.get(fips, {})
    has_fiber = county.get('has_fiber')
    fiber_providers = county.get('fiber_provider_count') or 0

    fiber_score = 30
    if has_fiber:
        fiber_score = min(100, 60 + fiber_providers * 4)  # More providers = better
    elif has_fiber is False:
        fiber_score = 20

    return clamp(ixp_score * 0.6 + fiber_score * 0.4)


def score_water(site, county_data):
    """Water availability: WRI stress score (0=low stress=good, 5=extreme=bad)."""
    fips = site.get('fips_code')
    county = county_data.get(fips, {})
    stress = county.get('water_stress_score')

    if stress is not None:
        # Low stress (0) = 100, Extreme stress (5) = 0
        return clamp(linear_score(float(stress), 0, 5))
    return 50


def score_hazard(site, county_data):
    """Natural hazard risk: FEMA NRI composite (lower risk = higher score)."""
    fips = site.get('fips_code')
    county = county_data.get(fips, {})
    nri = county.get('nri_score')

    if nri is not None:
        # Low risk (0) = 100, Very high risk (100) = 0
        return clamp(100 - float(nri))
    return 50


def score_labor(site, county_data, percentiles):
    """Labor pool: construction + IT employment per capita."""
    fips = site.get('fips_code')
    county = county_data.get(fips, {})

    construction = county.get('construction_employment') or 0
    it = county.get('it_employment') or 0
    population = county.get('population') or 0

    if population > 0:
        labor_density = (construction + it) / population * 1000  # Per 1000 residents
    else:
        labor_density = 0

    # Convert to percentile rank
    if percentiles.get('labor'):
        p = percentiles['labor']
        if labor_density >= p[90]:
            return 100
        elif labor_density >= p[75]:
            return 80
        elif labor_density >= p[50]:
            return 60
        elif labor_density >= p[25]:
            return 40
        else:
            return 20
    return 50


def score_existing_dc(site, dc_index, dc_cell_size):
    """Existing DC proximity: near existing DCs is good (ecosystem)."""
    lat, lng = site['latitude'], site['longitude']
    nearest_dc, dc_dist = find_nearest(lat, lng, dc_index, dc_cell_size, max_km=250)

    # Store nearest DC info
    if nearest_dc:
        site['_nearest_dc_id'] = nearest_dc['id']
        site['_nearest_dc_name'] = nearest_dc.get('name')
        site['_nearest_dc_distance_km'] = dc_dist

    if dc_dist is not None:
        # < 5 km = 100 (in existing DC cluster), > 250 km = 10
        if dc_dist < 5:
            return 100
        elif dc_dist < 25:
            return 80
        elif dc_dist < 50:
            return 60
        elif dc_dist < 100:
            return 40
        elif dc_dist < 250:
            return 20
        else:
            return 10
    return 10


def score_land(site, county_data):
    """Land suitability: acreage, land type, land cost."""
    acreage = site.get('acreage')
    site_type = site.get('site_type', '')
    fips = site.get('fips_code')
    county = county_data.get(fips, {})

    # Acreage: 100+ acres = 100, 0 acres = 30
    acreage_score = 50
    if acreage is not None:
        acreage_score = clamp(linear_score(float(acreage), 100, 0))

    # Type bonus: brownfield = 80 (pre-cleared), substation = 50 (may need land acquisition)
    type_score = 80 if site_type == 'brownfield' else 50

    # Land cost: cheaper land = better ($/acre: $500=100, $15000=0)
    land_value = county.get('avg_land_value_per_acre_usd')
    cost_score = 50
    if land_value is not None:
        cost_score = clamp(linear_score(float(land_value), 500, 15000))

    return clamp(acreage_score * 0.35 + type_score * 0.35 + cost_score * 0.30)


def score_tax(site, county_data):
    """Tax incentive: state has DC-specific tax incentive."""
    fips = site.get('fips_code')
    county = county_data.get(fips, {})
    has_incentive = county.get('has_dc_tax_incentive')

    return 100 if has_incentive else 0


def score_climate(site, county_data):
    """Climate/cooling: fewer cooling degree days = cheaper to cool DCs."""
    fips = site.get('fips_code')
    county = county_data.get(fips, {})
    cdd = county.get('cooling_degree_days')

    if cdd is not None:
        # < 500 CDD = 100, > 2500 CDD = 20
        return clamp(linear_score(float(cdd), 500, 2500))
    return 50


# ═══════════════════════════════════════════════════════════

def compute_percentiles(county_data):
    """Compute percentile thresholds for labor scoring."""
    labor_densities = []
    for fips, county in county_data.items():
        construction = county.get('construction_employment') or 0
        it = county.get('it_employment') or 0
        population = county.get('population') or 0
        if population > 0:
            density = (construction + it) / population * 1000
            labor_densities.append(density)

    if not labor_densities:
        return {}

    labor_densities.sort()
    n = len(labor_densities)
    return {
        'labor': {
            25: labor_densities[n // 4],
            50: labor_densities[n // 2],
            75: labor_densities[3 * n // 4],
            90: labor_densities[int(n * 0.9)],
        }
    }


def main():
    print("=" * 60)
    print("GridScout DC Site Scoring Engine")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Load all reference data
    rescore_all = '--rescore' in sys.argv
    print("\n[1/7] Loading DC sites...")
    extra = '' if rescore_all else '&dc_score=is.null'
    sites = load_paginated(
        'grid_dc_sites',
        '*',
        extra
    )
    print(f"  {len(sites)} sites to score" + ("" if rescore_all else " (unscored only)"))
    if not sites:
        print("  No sites found. Run generate-dc-sites.py first.")
        return

    print("[2/7] Loading county data...")
    counties_raw = load_paginated('grid_county_data', '*')
    county_data = {c['fips_code']: c for c in counties_raw if c.get('fips_code')}
    print(f"  {len(county_data)} counties")

    print("[3/7] Loading IXP facilities...")
    ixps = load_paginated('grid_ixp_facilities', 'id,name,latitude,longitude,ix_count,network_count',
                          '&latitude=not.is.null&longitude=not.is.null')
    ixp_index = build_grid_index(ixps, cell_size=0.5)
    print(f"  {len(ixps)} IXPs")

    print("[4/7] Loading existing datacenters...")
    dcs = load_paginated('grid_datacenters', 'id,name,latitude,longitude,capacity_mw',
                         '&latitude=not.is.null&longitude=not.is.null')
    dc_index = build_grid_index(dcs, cell_size=0.5)
    print(f"  {len(dcs)} datacenters")

    print("[5/7] Loading queue summaries...")
    queue_data = load_paginated('grid_queue_summary', 'state,iso,total_projects,avg_wait_years')
    print(f"  {len(queue_data)} queue summaries")

    print("[6/7] Computing percentiles...")
    percentiles = compute_percentiles(county_data)
    if percentiles.get('labor'):
        p = percentiles['labor']
        print(f"  Labor density percentiles: p25={p[25]:.1f}, p50={p[50]:.1f}, p75={p[75]:.1f}, p90={p[90]:.1f}")

    # Score all sites
    print(f"\n[7/7] Scoring {len(sites)} sites...")
    scored = 0
    errors = 0
    score_dist = {
        '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0
    }
    patches = []

    for i, site in enumerate(sites):
        try:
            # Compute all 10 sub-scores
            s_power = round(score_power(site), 1)
            s_speed = round(score_speed_to_power(site, queue_data), 1)
            s_fiber = round(score_fiber(site, ixp_index, 0.5, county_data), 1)
            s_water = round(score_water(site, county_data), 1)
            s_hazard = round(score_hazard(site, county_data), 1)
            s_labor = round(score_labor(site, county_data, percentiles), 1)
            s_dc = round(score_existing_dc(site, dc_index, 0.5), 1)
            s_land = round(score_land(site, county_data), 1)
            s_tax = round(score_tax(site, county_data), 1)
            s_climate = round(score_climate(site, county_data), 1)

            # Weighted composite
            dc_score = round(
                WEIGHTS['power'] * s_power +
                WEIGHTS['speed_to_power'] * s_speed +
                WEIGHTS['fiber'] * s_fiber +
                WEIGHTS['water'] * s_water +
                WEIGHTS['hazard'] * s_hazard +
                WEIGHTS['labor'] * s_labor +
                WEIGHTS['existing_dc'] * s_dc +
                WEIGHTS['land'] * s_land +
                WEIGHTS['tax'] * s_tax +
                WEIGHTS['climate'] * s_climate,
                1
            )

            patch = {
                'id': site['id'],
                'dc_score': dc_score,
                'score_power': s_power,
                'score_speed_to_power': s_speed,
                'score_fiber': s_fiber,
                'score_water': s_water,
                'score_hazard': s_hazard,
                'score_labor': s_labor,
                'score_existing_dc': s_dc,
                'score_land': s_land,
                'score_tax': s_tax,
                'score_climate': s_climate,
            }

            # Add nearest IXP/DC info if computed during scoring
            if site.get('_nearest_ixp_id'):
                patch['nearest_ixp_id'] = site['_nearest_ixp_id']
                patch['nearest_ixp_name'] = site.get('_nearest_ixp_name')
                patch['nearest_ixp_distance_km'] = site.get('_nearest_ixp_distance_km')
            if site.get('_nearest_dc_id'):
                patch['nearest_dc_id'] = site['_nearest_dc_id']
                patch['nearest_dc_name'] = site.get('_nearest_dc_name')
                patch['nearest_dc_distance_km'] = site.get('_nearest_dc_distance_km')

            # Add queue data from speed_to_power scoring
            if site.get('_queue_depth') is not None:
                patch['queue_depth'] = site['_queue_depth']
            if site.get('_avg_queue_wait_years') is not None:
                patch['avg_queue_wait_years'] = site['_avg_queue_wait_years']

            patches.append(patch)
            scored += 1

            # Track distribution
            if dc_score < 20:
                score_dist['0-20'] += 1
            elif dc_score < 40:
                score_dist['20-40'] += 1
            elif dc_score < 60:
                score_dist['40-60'] += 1
            elif dc_score < 80:
                score_dist['60-80'] += 1
            else:
                score_dist['80-100'] += 1

        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error scoring {site.get('source_record_id')}: {e}")

        if (i + 1) % 2000 == 0:
            print(f"  Scored {i + 1}/{len(sites)}...")

    print(f"  Scored: {scored}, Errors: {errors}")
    print(f"  Score distribution: {score_dist}")

    # Compute summary stats
    all_scores = [p['dc_score'] for p in patches]
    if all_scores:
        avg = sum(all_scores) / len(all_scores)
        all_scores.sort()
        median = all_scores[len(all_scores) // 2]
        top10 = sorted(patches, key=lambda x: x['dc_score'], reverse=True)[:10]
        print(f"  Average score: {avg:.1f}, Median: {median:.1f}")
        print(f"\n  Top 10 sites:")
        for t in top10:
            site = next((s for s in sites if s['id'] == t['id']), {})
            print(f"    {t['dc_score']:.1f} — {site.get('name', '?')[:40]} ({site.get('state')})"
                  f" | pwr={t['score_power']} spd={t['score_speed_to_power']}"
                  f" fib={t['score_fiber']} wtr={t['score_water']}"
                  f" haz={t['score_hazard']}")

    if dry_run:
        print(f"\n[DRY RUN] Would update {len(patches)} sites with scores")
        return

    # Apply patches with concurrent workers for speed
    print(f"\n  Applying {len(patches)} score patches (20 workers)...")
    patched = 0
    patch_errors = 0

    def apply_patch(patch):
        site_id = patch.pop('id')
        for attempt in range(3):
            try:
                supabase_request('PATCH', f'grid_dc_sites?id=eq.{site_id}', patch)
                return True
            except Exception:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(apply_patch, p): p for p in patches}
        for i, future in enumerate(as_completed(futures)):
            try:
                future.result()
                patched += 1
            except Exception as e:
                patch_errors += 1
                if patch_errors <= 10:
                    print(f"  Patch error: {e}")
            if (i + 1) % 2000 == 0:
                print(f"  Patched {i + 1}/{len(patches)}...")

    print(f"\n{'=' * 60}")
    print(f"DC Site Scoring Complete")
    print(f"  Sites scored: {scored}")
    print(f"  Patches applied: {patched}")
    print(f"  Scoring errors: {errors}")
    print(f"  Patch errors: {patch_errors}")
    print(f"  Score distribution: {score_dist}")
    if all_scores:
        print(f"  Average: {avg:.1f}, Median: {median:.1f}")
        print(f"  Min: {min(all_scores):.1f}, Max: {max(all_scores):.1f}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

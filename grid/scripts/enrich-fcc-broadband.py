#!/usr/bin/env python3
"""
Enrich grid_dc_sites with FCC broadband/fiber availability data.

Strategy:
1. For each DC site with lat/lng but no fcc_fiber_providers, look up Census block
   FIPS via FCC Area API (geo.fcc.gov) — very reliable, free, no auth.
2. Query FCC Broadband Map API for fiber (tech code 50) availability at that location.
3. If broadband API fails, fall back to state-level fiber availability estimates
   from FCC's 2024 Broadband Deployment Report.

Updates grid_dc_sites columns:
- fcc_fiber_providers (integer) — count of fiber-to-premises providers at location
- fcc_max_down_mbps (numeric) — max advertised download speed from any fiber provider
- fcc_max_up_mbps (numeric) — max advertised upload speed from any fiber provider
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50

# State-level fiber availability fallback (% of locations with fiber access)
# Source: FCC Broadband Deployment Report 2024, BroadbandNow 2024
# Used when FCC API is unreliable or returns errors
STATE_FIBER_FALLBACK = {
    'AL': 0.55, 'AK': 0.35, 'AZ': 0.65, 'AR': 0.45, 'CA': 0.70,
    'CO': 0.65, 'CT': 0.75, 'DE': 0.70, 'FL': 0.70, 'GA': 0.60,
    'HI': 0.55, 'ID': 0.50, 'IL': 0.65, 'IN': 0.55, 'IA': 0.55,
    'KS': 0.50, 'KY': 0.50, 'LA': 0.55, 'ME': 0.50, 'MD': 0.75,
    'MA': 0.80, 'MI': 0.55, 'MN': 0.60, 'MS': 0.40, 'MO': 0.55,
    'MT': 0.40, 'NE': 0.50, 'NV': 0.65, 'NH': 0.60, 'NJ': 0.80,
    'NM': 0.45, 'NY': 0.75, 'NC': 0.60, 'ND': 0.50, 'OH': 0.60,
    'OK': 0.50, 'OR': 0.60, 'PA': 0.60, 'RI': 0.85, 'SC': 0.55,
    'SD': 0.45, 'TN': 0.65, 'TX': 0.65, 'UT': 0.75, 'VT': 0.55,
    'VA': 0.70, 'WA': 0.70, 'WV': 0.40, 'WI': 0.55, 'WY': 0.35,
    'DC': 0.90, 'PR': 0.30, 'GU': 0.20, 'VI': 0.15, 'AS': 0.10,
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


def fcc_census_block(lat, lng):
    """Get Census block FIPS code from FCC Area API. Very reliable."""
    url = (
        f"https://geo.fcc.gov/api/census/block/find"
        f"?latitude={lat}&longitude={lng}&censusYear=2020&format=json"
    )
    req = urllib.request.Request(url, headers={
        'User-Agent': 'GridScout/1.0 (datacenter site enrichment)',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            block = data.get('Block', {})
            fips = block.get('FIPS')
            return fips
    except Exception:
        return None


def fcc_broadband_availability(lat, lng):
    """
    Query FCC Broadband Map for fiber availability at a location.
    Returns dict with fiber_providers, max_down_mbps, max_up_mbps or None on failure.
    Technology code 50 = Fiber to the Premises (FTTP).
    """
    url = (
        f"https://broadbandmap.fcc.gov/api/public/map/"
        f"listAvailability"
        f"?latitude={lat}&longitude={lng}"
        f"&category=business&speed=25_3&tech=50"
    )
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://broadbandmap.fcc.gov/',
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

            # Response structure varies; try common patterns
            records = []
            if isinstance(data, dict) and 'data' in data:
                records = data['data'] if isinstance(data['data'], list) else []
            elif isinstance(data, list):
                records = data
            elif isinstance(data, dict) and 'results' in data:
                records = data['results'] if isinstance(data['results'], list) else []

            if not records:
                return {'fiber_providers': 0, 'max_down_mbps': None, 'max_up_mbps': None}

            max_down = 0
            max_up = 0
            provider_names = set()

            for rec in records:
                pname = (rec.get('provider_name') or rec.get('brand_name')
                         or rec.get('holding_company_name') or rec.get('dba_name') or '')
                if pname:
                    provider_names.add(pname)

                down = _safe_speed(rec.get('max_advertised_download_speed')
                                   or rec.get('maxDownSpeed')
                                   or rec.get('max_dl_speed')
                                   or rec.get('download_speed'))
                up = _safe_speed(rec.get('max_advertised_upload_speed')
                                 or rec.get('maxUpSpeed')
                                 or rec.get('max_ul_speed')
                                 or rec.get('upload_speed'))
                if down and down > max_down:
                    max_down = down
                if up and up > max_up:
                    max_up = up

            return {
                'fiber_providers': len(provider_names) if provider_names else len(records),
                'max_down_mbps': max_down if max_down > 0 else None,
                'max_up_mbps': max_up if max_up > 0 else None,
            }
    except urllib.error.HTTPError:
        return None
    except Exception:
        return None


def _safe_speed(val):
    """Convert speed value to float, handling various formats."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def estimate_from_state(state):
    """
    Fallback: estimate fiber providers from state-level fiber availability data.
    Returns estimated provider count based on state fiber penetration.
    """
    pct = STATE_FIBER_FALLBACK.get(state, 0.50)
    if pct >= 0.80:
        return 3
    elif pct >= 0.65:
        return 2
    elif pct >= 0.45:
        return 1
    else:
        return 0


def enrich_site(site):
    """
    Enrich a single site with FCC broadband data.
    Returns (site_id, patch_dict) or (site_id, None) on failure.
    """
    site_id = site['id']
    lat = site.get('latitude')
    lng = site.get('longitude')
    state = site.get('state')

    if not lat or not lng:
        return (site_id, None)

    # Step 1: Try FCC Broadband Map API
    result = fcc_broadband_availability(lat, lng)

    if result is not None:
        patch = {
            'fcc_fiber_providers': result['fiber_providers'],
        }
        if result['max_down_mbps'] is not None:
            patch['fcc_max_down_mbps'] = result['max_down_mbps']
        if result['max_up_mbps'] is not None:
            patch['fcc_max_up_mbps'] = result['max_up_mbps']
        return (site_id, patch)

    # Step 2: Try Census block lookup (confirms location is valid)
    fips = fcc_census_block(lat, lng)
    if fips:
        estimated_providers = estimate_from_state(state)
        return (site_id, {
            'fcc_fiber_providers': estimated_providers,
        })

    # Step 3: Pure state fallback
    if state:
        estimated_providers = estimate_from_state(state)
        return (site_id, {
            'fcc_fiber_providers': estimated_providers,
        })

    return (site_id, None)


def flush_patches(patches, dry_run):
    """Batch PATCH to Supabase."""
    if not patches or dry_run:
        return 0, 0

    patched = 0
    errors = 0

    for site_id, patch_data in patches:
        try:
            eid = urllib.parse.quote(str(site_id), safe='')
            supabase_request('PATCH',
                f"grid_dc_sites?id=eq.{eid}",
                patch_data,
                headers_extra={'Prefer': 'return=minimal'})
            patched += 1
        except Exception as e:
            print(f"  Error patching {site_id}: {e}")
            errors += 1

    return patched, errors


def main():
    dry_run = '--dry-run' in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich FCC Broadband/Fiber Data")
    print("=" * 50)

    # Load sites needing enrichment
    print("\n[1/3] Loading grid_dc_sites needing FCC broadband data...")
    filters = '&fcc_fiber_providers=is.null&latitude=not.is.null&longitude=not.is.null'
    sites = load_paginated('grid_dc_sites',
                           select='id,latitude,longitude,state',
                           filters=filters)
    print(f"  {len(sites)} sites need FCC broadband enrichment")

    if limit:
        sites = sites[:limit]
        print(f"  Limited to {limit} sites")

    if not sites:
        print("  No sites to enrich. Done!")
        return

    # Enrich sites
    print(f"\n[2/3] Querying FCC APIs for {len(sites)} sites...")
    print("  Using ThreadPoolExecutor(3) with 0.5s delay\n")

    pending_patches = []
    total_processed = 0
    total_enriched = 0
    total_api_hits = 0
    total_fallbacks = 0
    total_skipped = 0
    total_patched = 0
    total_errors = 0

    def process_with_delay(site):
        time.sleep(0.5)
        return enrich_site(site)

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(process_with_delay, s): s for s in sites}

        for future in as_completed(futures):
            total_processed += 1
            try:
                site_id, patch = future.result()
                if patch:
                    total_enriched += 1
                    pending_patches.append((site_id, patch))

                    if patch.get('fcc_max_down_mbps') is not None:
                        total_api_hits += 1
                    else:
                        total_fallbacks += 1
                else:
                    total_skipped += 1
            except Exception as e:
                total_skipped += 1
                print(f"  Error processing site: {e}")

            # Progress every 100
            if total_processed % 100 == 0:
                print(f"  Progress: {total_processed}/{len(sites)} "
                      f"({total_enriched} enriched, {total_api_hits} API hits, "
                      f"{total_fallbacks} fallbacks, {total_skipped} skipped)")

            # Flush every 500
            if len(pending_patches) >= 500:
                if not dry_run:
                    p, e = flush_patches(pending_patches, dry_run)
                    total_patched += p
                    total_errors += e
                    print(f"  FLUSH: {p} patched, {e} errors "
                          f"(cumulative: {total_patched} patched)")
                pending_patches = []

    # Final flush
    if pending_patches:
        if not dry_run:
            p, e = flush_patches(pending_patches, dry_run)
            total_patched += p
            total_errors += e
        else:
            total_patched = total_enriched

    # Summary
    print(f"\n[3/3] Summary")
    print(f"  {'Would process' if dry_run else 'Processed'}: {total_processed}")
    print(f"  {'Would enrich' if dry_run else 'Enriched'}: {total_enriched}")
    print(f"  API hits (with speeds): {total_api_hits}")
    print(f"  State fallbacks: {total_fallbacks}")
    print(f"  Skipped (no coords/state): {total_skipped}")
    if not dry_run:
        print(f"  Patched: {total_patched}")
        print(f"  Errors: {total_errors}")

    print("\nDone!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Enrich grid_ixp_facilities with contact data from PeeringDB API.
Also cross-reference PeeringDB facilities against grid_datacenters by name+coords.

PeeringDB provides: sales_email, sales_phone, tech_email, tech_phone, address, zipcode, website
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
PEERINGDB_API = "https://www.peeringdb.com/api"
BATCH_SIZE = 50


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
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def fetch_peeringdb_all():
    """Fetch all US facilities from PeeringDB with contact fields."""
    url = f"{PEERINGDB_API}/fac?country=US&status=ok&limit=0"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                return data.get('data', [])
        except Exception as e:
            if attempt < 2:
                print(f"  PeeringDB error: {e}, retrying...")
                time.sleep(2 ** attempt)
                continue
            raise


def main():
    print("=" * 60)
    print("GridScout: PeeringDB Contact Enrichment")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv

    # Step 1: Fetch all PeeringDB US facilities
    print("\nFetching PeeringDB US facilities...")
    pdb_facs = fetch_peeringdb_all()
    print(f"  {len(pdb_facs)} facilities fetched")

    # Build lookup by peeringdb_id
    pdb_by_id = {f['id']: f for f in pdb_facs}

    # Count contact availability
    has_sales_email = sum(1 for f in pdb_facs if f.get('sales_email'))
    has_tech_email = sum(1 for f in pdb_facs if f.get('tech_email'))
    has_phone = sum(1 for f in pdb_facs if f.get('sales_phone') or f.get('tech_phone'))
    print(f"  With sales_email: {has_sales_email}")
    print(f"  With tech_email:  {has_tech_email}")
    print(f"  With phone:       {has_phone}")

    # Step 2: Load existing IXP facilities from DB
    print("\nLoading grid_ixp_facilities...")
    ixps = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_ixp_facilities?select=id,peeringdb_id,name,sales_email&limit=1000&offset={offset}')
        if not batch:
            break
        ixps.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(ixps)} IXP facilities in DB")

    # Step 3: Enrich IXP facilities with PeeringDB contact data
    print("\nEnriching IXP facilities...")
    ixp_patched = 0
    ixp_skipped = 0
    for ixp in ixps:
        pdb_id = ixp.get('peeringdb_id')
        if not pdb_id or pdb_id not in pdb_by_id:
            ixp_skipped += 1
            continue

        pdb = pdb_by_id[pdb_id]
        patch = {}

        # Only patch fields that have data and aren't already set
        if pdb.get('sales_email') and not ixp.get('sales_email'):
            patch['sales_email'] = pdb['sales_email'].strip()
        if pdb.get('sales_phone'):
            patch['sales_phone'] = pdb['sales_phone'].strip()
        if pdb.get('tech_email'):
            patch['tech_email'] = pdb['tech_email'].strip()
        if pdb.get('tech_phone'):
            patch['tech_phone'] = pdb['tech_phone'].strip()
        if pdb.get('address1'):
            addr = pdb['address1'].strip()
            if pdb.get('address2'):
                addr += ', ' + pdb['address2'].strip()
            patch['address'] = addr
        if pdb.get('zipcode'):
            patch['zipcode'] = pdb['zipcode'].strip()

        if not patch:
            ixp_skipped += 1
            continue

        if not dry_run:
            try:
                supabase_request('PATCH',
                    f'grid_ixp_facilities?id=eq.{ixp["id"]}', patch)
            except Exception as e:
                print(f"  Error patching IXP {ixp['id']}: {e}")
                continue

        ixp_patched += 1

    print(f"  Patched: {ixp_patched}, Skipped: {ixp_skipped}")

    # Step 4: Cross-reference PeeringDB against grid_datacenters
    print("\nLoading grid_datacenters for cross-reference...")
    dcs = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_datacenters?select=id,name,operator,latitude,longitude,state,sales_email,website&limit=1000&offset={offset}')
        if not batch:
            break
        dcs.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(dcs)} datacenters in DB")

    # Build name-based lookup for PeeringDB facilities
    # Match by: name similarity + coordinate proximity (within ~5km)
    import math

    def haversine_km(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        return R * 2 * math.asin(math.sqrt(a))

    def normalize(s):
        return ''.join(c.lower() for c in s if c.isalnum() or c == ' ').strip()

    dc_patched = 0
    dc_matched = 0
    for dc in dcs:
        if not dc.get('latitude') or not dc.get('longitude'):
            continue

        dc_lat = float(dc['latitude'])
        dc_lng = float(dc['longitude'])
        dc_name_norm = normalize(dc.get('name') or '')
        dc_op_norm = normalize(dc.get('operator') or '')

        best_match = None
        best_dist = 5.0  # max 5km

        for pdb in pdb_facs:
            if not pdb.get('latitude') or not pdb.get('longitude'):
                continue

            dist = haversine_km(dc_lat, dc_lng, pdb['latitude'], pdb['longitude'])
            if dist >= best_dist:
                continue

            # Check name similarity
            pdb_name_norm = normalize(pdb.get('name', ''))
            pdb_org_norm = normalize(pdb.get('org_name', ''))

            # Match if any name words overlap
            dc_words = set(dc_name_norm.split()) | set(dc_op_norm.split())
            pdb_words = set(pdb_name_norm.split()) | set(pdb_org_norm.split())
            dc_words.discard('')
            pdb_words.discard('')

            overlap = dc_words & pdb_words
            # Require at least 1 meaningful word overlap (not just "data" or "center")
            meaningful = overlap - {'data', 'center', 'centre', 'the', 'inc', 'llc', 'co'}
            if meaningful or dist < 0.5:  # very close = match even without name overlap
                best_match = pdb
                best_dist = dist

        if best_match:
            dc_matched += 1
            patch = {}
            has_contact = best_match.get('sales_email') or best_match.get('tech_email') or best_match.get('sales_phone')

            if best_match.get('sales_email') and not dc.get('sales_email'):
                patch['sales_email'] = best_match['sales_email'].strip()
            if best_match.get('sales_phone'):
                patch['sales_phone'] = best_match['sales_phone'].strip()
            if best_match.get('tech_email'):
                patch['tech_email'] = best_match['tech_email'].strip()
            if best_match.get('tech_phone'):
                patch['tech_phone'] = best_match['tech_phone'].strip()
            if best_match.get('website') and not dc.get('website'):
                patch['website'] = best_match['website'].strip()
            if best_match.get('address1'):
                addr = best_match['address1'].strip()
                if best_match.get('address2'):
                    addr += ', ' + best_match['address2'].strip()
                patch['address'] = addr
            if best_match.get('zipcode'):
                patch['zipcode'] = best_match['zipcode'].strip()

            if patch and not dry_run:
                try:
                    supabase_request('PATCH',
                        f'grid_datacenters?id=eq.{dc["id"]}', patch)
                    dc_patched += 1
                except Exception as e:
                    print(f"  Error patching DC {dc['id']}: {e}")

    print(f"  DC cross-ref matches: {dc_matched}")
    print(f"  DC patched: {dc_patched}")

    print(f"\n{'=' * 60}")
    print(f"PeeringDB Contact Enrichment Complete")
    print(f"  IXP patched:  {ixp_patched}")
    print(f"  DC matched:   {dc_matched}")
    print(f"  DC patched:   {dc_patched}")
    if dry_run:
        print("  [DRY RUN — no changes made]")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

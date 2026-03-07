#!/usr/bin/env python3
"""
Enrich grid_dc_sites with land acquisition contact information.

Logic by site type:
1. brownfield sites -> State Environmental Cleanup Program (per-state URLs)
2. greenfield sites with BLM source -> BLM State Office contacts
3. substation and all other sites -> County Assessor search links

Usage:
  python3 -u scripts/enrich-land-contacts.py
  python3 -u scripts/enrich-land-contacts.py --dry-run
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

BATCH_SIZE = 50

# --- State Environmental Cleanup / Brownfield Programs (all 50 states + DC) ---
STATE_PROGRAMS = {
    'AL': 'https://adem.alabama.gov/programs/land/brownfields.cnt',
    'AK': 'https://dec.alaska.gov/spar/csp/brownfields/',
    'AZ': 'https://www.azdeq.gov/WQARF',
    'AR': 'https://www.adeq.state.ar.us/land/brownfields/',
    'CA': 'https://dtsc.ca.gov/brownfields/',
    'CO': 'https://cdphe.colorado.gov/voluntary-cleanup-program',
    'CT': 'https://portal.ct.gov/deep/remediation--site-clean-up/brownfields/brownfields',
    'DE': 'https://dnrec.alpha.delaware.gov/waste-hazardous/remediation/brownfields/',
    'DC': 'https://doee.dc.gov/service/brownfield-program',
    'FL': 'https://floridadep.gov/waste/waste-cleanup/content/brownfields-program',
    'GA': 'https://epd.georgia.gov/land-protection-branch/brownfield-program',
    'HI': 'https://health.hawaii.gov/shwb/brownfields/',
    'ID': 'https://www.deq.idaho.gov/waste-mgmt-remediation/brownfields/',
    'IL': 'https://epa.illinois.gov/topics/cleanup-programs/brownfields.html',
    'IN': 'https://www.in.gov/idem/cleanups/brownfields/',
    'IA': 'https://www.iowadnr.gov/Environmental-Protection/Land-Quality/Contaminated-Sites/Brownfields',
    'KS': 'https://www.kdhe.ks.gov/411/Brownfields-Program',
    'KY': 'https://eec.ky.gov/Environmental-Protection/Waste/brownfields/Pages/default.aspx',
    'LA': 'https://www.deq.louisiana.gov/page/brownfields',
    'ME': 'https://www.maine.gov/dep/spills/brownfields/',
    'MD': 'https://mde.maryland.gov/programs/land/MarylandBrownfieldVCP/Pages/index.aspx',
    'MA': 'https://www.mass.gov/brownfields-support',
    'MI': 'https://www.michigan.gov/egle/about/organization/remediation-and-redevelopment/brownfields',
    'MN': 'https://www.pca.state.mn.us/waste/brownfields',
    'MS': 'https://www.mdeq.ms.gov/geology/brownfields-voluntary-cleanup/',
    'MO': 'https://dnr.mo.gov/waste-recycling/brownfield-voluntary-cleanup-program',
    'MT': 'https://deq.mt.gov/cleanupandrec/Programs/brownfields',
    'NE': 'https://deq.ne.gov/publica.nsf/pages/05-036',
    'NV': 'https://ndep.nv.gov/land/brownfields',
    'NH': 'https://www.des.nh.gov/waste/brownfields',
    'NJ': 'https://www.nj.gov/dep/srp/brownfields/',
    'NM': 'https://www.env.nm.gov/gwqb/brownfields-program/',
    'NY': 'https://www.dec.ny.gov/chemical/8450.html',
    'NC': 'https://www.deq.nc.gov/about/divisions/waste-management/brownfields-program',
    'ND': 'https://deq.nd.gov/WM/brownfields/',
    'OH': 'https://epa.ohio.gov/divisions-and-offices/environmental-response-revitalization/programs/brownfield-program',
    'OK': 'https://www.deq.ok.gov/land-protection-division/brownfields-program/',
    'OR': 'https://www.oregon.gov/deq/land/Pages/Brownfields.aspx',
    'PA': 'https://www.dep.pa.gov/Business/Land/Remediation/brownfields-program/Pages/default.aspx',
    'RI': 'https://dem.ri.gov/brownfields',
    'SC': 'https://scdhec.gov/environment/brownfields-voluntary-cleanup',
    'SD': 'https://danr.sd.gov/Environment/GroundWaterPrograms/VoluntaryCleanup/Default.aspx',
    'TN': 'https://www.tn.gov/environment/remediation/brownfields-program.html',
    'TX': 'https://www.tceq.texas.gov/remediation/vcp',
    'UT': 'https://deq.utah.gov/environmental-response-and-remediation/brownfields-program',
    'VT': 'https://dec.vermont.gov/waste-management/contaminated-sites/brownfields',
    'VA': 'https://www.deq.virginia.gov/land-waste/remediation/voluntary-remediation-program',
    'WA': 'https://ecology.wa.gov/Spills-Cleanup/Contamination-cleanup/Brownfields',
    'WI': 'https://dnr.wisconsin.gov/topic/Brownfields',
    'WV': 'https://dep.wv.gov/dlr/oer/brownfields/Pages/default.aspx',
    'WY': 'https://deq.wyoming.gov/shwd/voluntary-remediation-program/',
}

# --- BLM State/District Offices ---
BLM_OFFICES = {
    'AK': {'name': 'BLM Alaska State Office',            'url': 'https://www.blm.gov/office/alaska-state-office',            'phone': '(907) 271-5960'},
    'AZ': {'name': 'BLM Arizona State Office',            'url': 'https://www.blm.gov/office/arizona-state-office',           'phone': '(602) 417-9200'},
    'CA': {'name': 'BLM California State Office',         'url': 'https://www.blm.gov/office/california-state-office',        'phone': '(916) 978-4400'},
    'CO': {'name': 'BLM Colorado State Office',           'url': 'https://www.blm.gov/office/colorado-state-office',          'phone': '(303) 239-3600'},
    'ID': {'name': 'BLM Idaho State Office',              'url': 'https://www.blm.gov/office/idaho-state-office',             'phone': '(208) 373-4000'},
    'MT': {'name': 'BLM Montana/Dakotas State Office',    'url': 'https://www.blm.gov/office/montana-dakotas-state-office',   'phone': '(406) 896-5000'},
    'NV': {'name': 'BLM Nevada State Office',             'url': 'https://www.blm.gov/office/nevada-state-office',            'phone': '(775) 861-6400'},
    'NM': {'name': 'BLM New Mexico State Office',         'url': 'https://www.blm.gov/office/new-mexico-state-office',        'phone': '(505) 954-2000'},
    'ND': {'name': 'BLM Montana/Dakotas State Office',    'url': 'https://www.blm.gov/office/montana-dakotas-state-office',   'phone': '(406) 896-5000'},
    'SD': {'name': 'BLM Montana/Dakotas State Office',    'url': 'https://www.blm.gov/office/montana-dakotas-state-office',   'phone': '(406) 896-5000'},
    'OR': {'name': 'BLM Oregon/Washington State Office',  'url': 'https://www.blm.gov/office/oregon-washington-state-office', 'phone': '(503) 808-6001'},
    'WA': {'name': 'BLM Oregon/Washington State Office',  'url': 'https://www.blm.gov/office/oregon-washington-state-office', 'phone': '(503) 808-6001'},
    'UT': {'name': 'BLM Utah State Office',               'url': 'https://www.blm.gov/office/utah-state-office',              'phone': '(801) 539-4001'},
    'WY': {'name': 'BLM Wyoming State Office',            'url': 'https://www.blm.gov/office/wyoming-state-office',           'phone': '(307) 775-6256'},
    # Eastern States Office covers states east of the Mississippi
    'AL': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'AR': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'CT': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'DE': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'DC': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'FL': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'GA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'HI': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'IL': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'IN': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'IA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'KS': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'KY': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'LA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'ME': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MD': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MI': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MN': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MS': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'MO': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'NE': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'NH': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'NJ': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'NY': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'NC': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'OH': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'OK': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'PA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'RI': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'SC': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'TN': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'TX': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'VT': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'VA': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'WV': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
    'WI': {'name': 'BLM Eastern States Office', 'url': 'https://www.blm.gov/office/eastern-states-office', 'phone': '(202) 912-7700'},
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
        except Exception as e:
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


def build_patch(site):
    """Determine land contact fields for a given site."""
    site_type = (site.get('site_type') or '').lower()
    source_id = (site.get('source_record_id') or '').lower()
    name = (site.get('name') or '').upper()
    state = site.get('state') or ''
    county = site.get('county') or ''

    # 1. Brownfield sites -> State Environmental Cleanup Program
    if site_type == 'brownfield':
        url = STATE_PROGRAMS.get(state,
            f'https://www.google.com/search?q={urllib.parse.quote(state + " brownfield cleanup program")}')
        return {
            'land_contact_type': 'state_program',
            'land_contact_name': 'State Environmental Cleanup Program',
            'land_contact_url': url,
            'land_contact_phone': None,
        }

    # 2. Greenfield sites with BLM source -> BLM State Office
    if site_type == 'greenfield' and (source_id.startswith('blm_') or 'BLM' in name):
        office = BLM_OFFICES.get(state)
        if office:
            return {
                'land_contact_type': 'blm_office',
                'land_contact_name': office['name'],
                'land_contact_url': office['url'],
                'land_contact_phone': office['phone'],
            }
        return {
            'land_contact_type': 'blm_office',
            'land_contact_name': 'Bureau of Land Management',
            'land_contact_url': 'https://www.blm.gov/office/national-office',
            'land_contact_phone': '(202) 208-3801',
        }

    # 3. Substation and all other sites -> County Assessor
    if county and state:
        search_q = urllib.parse.quote(f"{county} County {state} tax assessor parcel search")
    elif county:
        search_q = urllib.parse.quote(f"{county} County tax assessor parcel search")
    elif state:
        search_q = urllib.parse.quote(f"{state} tax assessor parcel search")
    else:
        search_q = urllib.parse.quote("county tax assessor parcel search")

    contact_name = f"{county} County Assessor" if county else "County Assessor"

    return {
        'land_contact_type': 'county_assessor',
        'land_contact_name': contact_name,
        'land_contact_url': f'https://www.google.com/search?q={search_q}',
        'land_contact_phone': None,
    }


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN -- no changes will be made ===\n")

    print("GridScout: Enrich Land Acquisition Contacts")
    print("=" * 50)

    # Load sites missing land_contact_type
    print("\n[1/2] Loading grid_dc_sites where land_contact_type IS NULL...")
    sites = load_paginated(
        'grid_dc_sites',
        'id,site_type,source_record_id,name,state,county',
        '&land_contact_type=is.null'
    )
    print(f"  {len(sites):,} sites need land contact info")

    if not sites:
        print("  All sites already have land contact info. Done!")
        return

    # Tally by contact type
    type_counts = {}
    for s in sites:
        st = (s.get('site_type') or 'unknown').lower()
        src = (s.get('source_record_id') or '').lower()
        nm = (s.get('name') or '').upper()
        if st == 'brownfield':
            key = 'brownfield -> state_program'
        elif st == 'greenfield' and (src.startswith('blm_') or 'BLM' in nm):
            key = 'greenfield/BLM -> blm_office'
        else:
            key = f'{st} -> county_assessor'
        type_counts[key] = type_counts.get(key, 0) + 1

    for k, v in sorted(type_counts.items()):
        print(f"    {k}: {v:,}")

    # Patch in batches
    print(f"\n[2/2] Patching {len(sites):,} sites in batches of {BATCH_SIZE}...")
    total_patched = 0
    total_errors = 0

    for i in range(0, len(sites), BATCH_SIZE):
        batch = sites[i:i + BATCH_SIZE]

        for site in batch:
            patch = build_patch(site)

            if dry_run:
                if total_patched < 10:
                    print(f"  [{site['id'][:8]}] {patch['land_contact_type']}: {patch['land_contact_name']}")
                elif total_patched == 10:
                    print(f"  ... (suppressing further dry-run output)")
                total_patched += 1
                continue

            try:
                eid = urllib.parse.quote(site['id'], safe='')
                supabase_request('PATCH',
                    f"grid_dc_sites?id=eq.{eid}",
                    patch,
                    headers_extra={'Prefer': 'return=minimal'})
                total_patched += 1
            except Exception as e:
                print(f"  Error patching {site['id']}: {e}")
                total_errors += 1

        if not dry_run and (i + BATCH_SIZE) % 500 < BATCH_SIZE:
            print(f"  Progress: {min(i + BATCH_SIZE, len(sites)):,} / {len(sites):,} ({total_patched:,} patched, {total_errors} errors)")

    print(f"\n{'Would patch' if dry_run else 'Patched'}: {total_patched:,} sites")
    if total_errors:
        print(f"Errors: {total_errors}")

    print("\nDone!")


if __name__ == '__main__':
    main()

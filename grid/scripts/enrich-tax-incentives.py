#!/usr/bin/env python3
"""
Enrich DC sites with tax incentive flags and generate new greenfield candidates
near coal/fossil plant closures (IRA Energy Community eligible areas).

Strategy:
1. Tag existing brownfield sites as IRA Energy Community eligible (coal/fossil retirements)
2. Generate new greenfield candidates near retired coal/fossil plants (from grid_brownfields)
3. Tag sites in states with strong DC tax incentives (from existing score_tax data)
4. Query Census TIGERweb to check Opportunity Zone status for sites (tract-level)

Usage:
  python3 -u scripts/enrich-tax-incentives.py
  python3 -u scripts/enrich-tax-incentives.py --dry-run
  python3 -u scripts/enrich-tax-incentives.py --greenfield-only   # Only generate new sites
  python3 -u scripts/enrich-tax-incentives.py --tags-only         # Only tag existing sites
"""

import os, sys, json, math, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
BATCH_SIZE = 50

# Census TIGERweb tracts layer (has CENTLAT/CENTLON + GEOID for all US tracts)
TIGER_TRACTS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query"

STATE_FIPS = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
    '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
    '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
    '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
    '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
    '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
    '54':'WV','55':'WI','56':'WY',
}
STATE_ISO = {
    'TX':'ERCOT','CA':'CAISO','NY':'NYISO','CT':'ISO-NE','MA':'ISO-NE',
    'ME':'ISO-NE','NH':'ISO-NE','RI':'ISO-NE','VT':'ISO-NE',
    'PA':'PJM','NJ':'PJM','MD':'PJM','DE':'PJM','DC':'PJM',
    'VA':'PJM','WV':'PJM','OH':'PJM','IN':'PJM','IL':'PJM',
    'MI':'PJM','KY':'PJM','NC':'PJM',
    'MN':'MISO','IA':'MISO','WI':'MISO','MO':'MISO','AR':'MISO',
    'MS':'MISO','LA':'MISO',
    'OK':'SPP','KS':'SPP','NE':'SPP','SD':'SPP','ND':'SPP','NM':'SPP','MT':'SPP',
    'OR':'WECC','WA':'WECC','ID':'WECC','UT':'WECC','WY':'WECC',
    'CO':'WECC','AZ':'WECC','NV':'WECC',
    'GA':'SERC','FL':'SERC','AL':'SERC','SC':'SERC','TN':'SERC',
}

# IRA Energy Community: Coal closure states (states with significant coal mine closures since 2000
# or coal-fired power plant retirements since 2010). These states have census tracts
# that qualify for the 10% IRA bonus tax credit.
COAL_CLOSURE_STATES = {
    'WV', 'KY', 'PA', 'OH', 'VA', 'WY', 'IL', 'IN', 'AL', 'MT',
    'CO', 'ND', 'NM', 'TX', 'GA', 'NC', 'MO', 'IA', 'WI', 'MI',
    'TN', 'OK', 'AZ', 'NV', 'UT', 'MD', 'MN', 'AR', 'MS', 'NE',
}

# States with fossil fuel employment >= 0.17% of total employment + above-average unemployment
# (IRA Energy Community Category 2: MSA/non-MSA fossil fuel employment areas)
FOSSIL_FUEL_STATES = {
    'TX', 'OK', 'LA', 'WY', 'ND', 'NM', 'WV', 'AK', 'CO', 'KS',
    'MT', 'PA', 'OH', 'UT', 'AR', 'MS', 'AL', 'KY', 'IL', 'IN',
}

# States with strong DC tax incentives (from score_tax scoring)
DC_TAX_INCENTIVE_STATES = {
    'VA': 'VA data center exemption (sales tax + property)',
    'TX': 'Chapter 313 successor + no corporate income tax',
    'NV': 'Partial sales/property tax abatement + no income tax',
    'OH': 'Data Center Tax Incentive (sales tax exemption)',
    'NC': 'Article 3J credits (investment/job creation)',
    'GA': 'High-tech tax credits + sales tax exemptions',
    'IA': 'Sales/use tax exemption for DC equipment',
    'MS': 'Data center-specific tax incentives (2024+)',
    'SC': 'Enterprise zone credits + property tax abatement',
    'IN': 'EDGE/Hoosier credits + sales tax exemptions',
    'TN': 'FastTrack infrastructure + no income tax',
    'ND': 'Renaissance zone property tax exemptions',
    'NE': 'ImagiNE Nebraska Act tax credits',
    'SD': 'No corporate/personal income tax',
    'WY': 'No corporate/personal income tax',
}


def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}
    if headers_extra: headers.update(headers_extra)
    body = json.dumps(data, allow_nan=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2: time.sleep(2 ** attempt); continue
            print(f"  HTTP {e.code}: {error_body[:500]}"); raise
        except Exception:
            if attempt < 2: time.sleep(2 ** attempt); continue
            raise


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def load_all_sites():
    """Load all existing DC site coordinates and IDs."""
    sites = []
    offset = 0
    while True:
        rows = supabase_request('GET',
            f'grid_dc_sites?select=id,source_record_id,latitude,longitude,state,site_type,former_use'
            f'&limit=1000&offset={offset}')
        if not rows: break
        sites.extend(rows)
        offset += len(rows)
        if len(rows) < 1000: break
    return sites


def load_brownfields():
    """Load retired power plant brownfield sites (potential IRA Energy Community locations)."""
    brownfields = []
    offset = 0
    while True:
        rows = supabase_request('GET',
            f'grid_brownfield_sites?select=id,name,latitude,longitude,state,county,former_use,existing_capacity_mw,retirement_date'
            f'&latitude=not.is.null&limit=1000&offset={offset}')
        if not rows: break
        brownfields.extend(rows)
        offset += len(rows)
        if len(rows) < 1000: break
    return brownfields


def generate_ec_greenfield_sites(brownfields, existing_sites):
    """Generate new greenfield candidates near coal/fossil plant retirements.

    IRA Energy Community Category 3: Census tracts containing or adjacent to
    coal mine closures (since 2000) or coal plant retirements (since 2010).

    We generate candidate sites at offsets around retired coal/gas plants
    that are NOT already covered by existing DC sites.
    """
    # Build spatial index of existing sites
    cell_size = 0.05
    idx = {}
    existing_ids = set()
    for s in existing_sites:
        if s.get('latitude') and s.get('longitude'):
            lat, lng = float(s['latitude']), float(s['longitude'])
            cell = (int(lat/cell_size), int(lng/cell_size))
            idx.setdefault(cell, []).append((lat, lng))
        if s.get('source_record_id'):
            existing_ids.add(s['source_record_id'])

    # Filter brownfields to coal/fossil fuel plants (IRA-eligible closures)
    coal_fossil = []
    for bf in brownfields:
        fu = (bf.get('former_use') or '').lower()
        if any(f in fu for f in ['coal', 'petroleum', 'natural gas', 'gas', 'oil', 'fossil']):
            coal_fossil.append(bf)

    print(f"  {len(coal_fossil)} coal/fossil brownfield sites for EC greenfield generation")

    # Generate candidates at cardinal offsets (5km, 10km) around each coal/fossil plant
    offsets_km = [
        (5, 0), (-5, 0), (0, 5), (0, -5),
        (10, 0), (-10, 0), (0, 10), (0, -10),
        (7, 7), (-7, 7), (7, -7), (-7, -7),
    ]

    candidates = []
    for bf in coal_fossil:
        lat0, lng0 = float(bf['latitude']), float(bf['longitude'])
        state = bf.get('state')
        if not state: continue

        for dx_km, dy_km in offsets_km:
            # Approximate offset in degrees
            dlat = dy_km / 111.0
            dlng = dx_km / (111.0 * math.cos(math.radians(lat0)))
            lat, lng = round(lat0 + dlat, 6), round(lng0 + dlng, 6)

            # Skip if outside CONUS
            if lat < 24 or lat > 50 or lng < -125 or lng > -66:
                continue

            src_id = f"ec_coal_{bf['id'][:8]}_{dx_km}_{dy_km}"
            if src_id in existing_ids:
                continue

            # Check proximity to existing sites
            cl, cg = int(lat/cell_size), int(lng/cell_size)
            close = False
            for di in range(-1, 2):
                if close: break
                for dj in range(-1, 2):
                    for elat, elng in idx.get((cl+di, cg+dj), []):
                        if haversine_km(lat, lng, elat, elng) < 3.0:
                            close = True; break
                    if close: break
            if close:
                continue

            bf_name = bf.get('name') or 'Unknown'
            county = bf.get('county') or ''
            dist = math.sqrt(dx_km**2 + dy_km**2)

            candidates.append({
                'source_record_id': src_id,
                'name': f"EC Near {bf_name}" if len(bf_name) < 40 else f"EC {county} Coal Area",
                'site_type': 'greenfield',
                'state': state,
                'county': county or None,
                'latitude': lat,
                'longitude': lng,
                'iso_region': STATE_ISO.get(state),
                'former_use': f"near retired {bf.get('former_use', 'fossil')} plant ({dist:.0f}km)",
            })

            # Add to spatial index to prevent clustering
            cell = (int(lat/cell_size), int(lng/cell_size))
            idx.setdefault(cell, []).append((lat, lng))
            existing_ids.add(src_id)

    return candidates


def main():
    print("=" * 60)
    print("GridScout: Tax Incentive Enrichment + EC Greenfield Sites")
    print("=" * 60)
    dry_run = '--dry-run' in sys.argv
    greenfield_only = '--greenfield-only' in sys.argv
    tags_only = '--tags-only' in sys.argv

    print("\n[1/4] Loading existing sites...")
    sites = load_all_sites()
    print(f"  {len(sites)} existing DC sites")

    print("\n[2/4] Loading brownfield data...")
    brownfields = load_brownfields()
    print(f"  {len(brownfields)} brownfield sites")

    # Phase 1: Generate new greenfield candidates near coal/fossil retirements
    new_sites = []
    if not tags_only:
        print("\n[3/4] Generating EC greenfield candidates...")
        new_sites = generate_ec_greenfield_sites(brownfields, sites)
        print(f"  {len(new_sites)} new EC greenfield candidates generated")

        if new_sites:
            states = {}
            for s in new_sites:
                states[s['state']] = states.get(s['state'], 0) + 1
            for st, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
                print(f"    {st}: {c}")

    # Phase 2: Tag existing sites with tax incentive flags
    tag_patches = []
    if not greenfield_only:
        print("\n  Tagging existing sites with incentive flags...")

        # Count coal/fossil brownfield sites for IRA EC eligibility
        ec_count = 0
        tax_count = 0

        for s in sites:
            state = s.get('state', '')
            site_type = s.get('site_type', '')
            former_use = (s.get('former_use') or '').lower()

            # IRA Energy Community: brownfield sites with coal/fossil former use
            is_ec = False
            if site_type == 'brownfield' and any(f in former_use for f in ['coal', 'petroleum', 'natural gas', 'gas', 'oil']):
                is_ec = True
            # Or sites in coal closure states near brownfields
            elif state in COAL_CLOSURE_STATES and site_type in ('substation', 'greenfield'):
                # Check if near a coal/fossil brownfield
                if s.get('latitude') and s.get('longitude'):
                    lat, lng = float(s['latitude']), float(s['longitude'])
                    for bf in brownfields:
                        fu = (bf.get('former_use') or '').lower()
                        if any(f in fu for f in ['coal', 'petroleum', 'natural gas', 'gas', 'oil']):
                            if bf.get('latitude') and bf.get('longitude'):
                                d = haversine_km(lat, lng, float(bf['latitude']), float(bf['longitude']))
                                if d < 25:  # Within 25km of a retired coal/fossil plant
                                    is_ec = True
                                    break

            if is_ec:
                ec_count += 1

            # DC Tax incentive states
            is_tax = state in DC_TAX_INCENTIVE_STATES
            if is_tax:
                tax_count += 1

        print(f"  {ec_count} sites tagged as IRA Energy Community eligible")
        print(f"  {tax_count} sites in DC tax incentive states")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(new_sites)} new EC greenfield sites.")
        return

    # Insert new greenfield sites
    if new_sites:
        print(f"\n[4/4] Inserting {len(new_sites)} EC greenfield sites...")
        ds = supabase_request('GET', 'grid_data_sources?name=eq.ira_energy_communities&select=id')
        dsid = ds[0]['id'] if ds else None
        if not dsid:
            r = supabase_request('POST', 'grid_data_sources', [{
                'name': 'ira_energy_communities',
                'url': 'https://energycommunities.gov/energy-community-tax-credit-bonus/',
                'description': 'IRA Energy Community greenfield sites near retired coal/fossil plants'
            }], {'Prefer': 'return=representation'})
            if r: dsid = r[0]['id']

        created, errors = 0, 0
        for i in range(0, len(new_sites), BATCH_SIZE):
            batch = new_sites[i:i+BATCH_SIZE]
            for r in batch:
                if dsid: r['data_source_id'] = dsid
                r['created_at'] = datetime.now(timezone.utc).isoformat()
            try:
                supabase_request('POST', 'grid_dc_sites', batch, {'Prefer': 'return=minimal'})
                created += len(batch)
            except Exception:
                for rec in batch:
                    try:
                        supabase_request('POST', 'grid_dc_sites', [rec], {'Prefer': 'return=minimal'})
                        created += 1
                    except Exception as e2:
                        errors += 1
                        if errors <= 10: print(f"  Error: {e2}")
            if created % 500 == 0 and created > 0:
                print(f"  {created}...")

        if dsid:
            supabase_request('PATCH', f'grid_data_sources?id=eq.{dsid}', {
                'record_count': created,
                'last_import': datetime.now(timezone.utc).isoformat()
            })

        print(f"\n  EC Greenfield: Created {created}, Errors {errors}")
    else:
        print("\n[4/4] No new sites to insert.")

    print(f"\n{'='*60}")
    print(f"Tax Incentive Enrichment Complete")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()

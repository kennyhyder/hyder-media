#!/usr/bin/env python3
"""
Phase 2b: Ingest IRA Energy Community areas as greenfield DC sites.

IRA Section 48E Energy Communities get bonus tax credits (10-20% adder):
- Category 1: Brownfield sites (already covered by brownfield ingestion)
- Category 2: Statistical areas with fossil fuel employment >= 0.17% + unemployment above national avg
- Category 3: Census tracts with coal mine closures (since 2000) or coal plant retirements (since 2010)

Source: DOE Energy Communities ArcGIS
- Coal closure tracts: https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/IRA_EC_Coal_Closure/FeatureServer/0
- MSA/non-MSA areas: https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/IRA_EC_MSA_nonMSA/FeatureServer/0

Target: grid_dc_sites (site_type = 'greenfield', name includes 'EC')

Usage:
  python3 -u scripts/ingest-ira-energy-communities.py
  python3 -u scripts/ingest-ira-energy-communities.py --dry-run
  python3 -u scripts/ingest-ira-energy-communities.py --coal-only    # Coal closure tracts only
  python3 -u scripts/ingest-ira-energy-communities.py --msa-only     # MSA/non-MSA only
"""

import os, sys, json, math, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
BATCH_SIZE = 50
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'energy_communities')

# NETL ArcGIS endpoints (DOE Energy Communities)
COAL_API = "https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_Coal_Closure_Energy_Communities/FeatureServer/0/query"
MSA_API = "https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_MSAs_NonMSAs_that_are_Energy_Communities/FeatureServer/0/query"

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
    dlat, dlon = math.radians(lat2-lat1), math.radians(lon2-lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def fetch_arcgis_features(api_url, label, cache_file):
    """Fetch all features from an ArcGIS FeatureServer endpoint."""
    os.makedirs(DATA_DIR, exist_ok=True)
    cache_path = os.path.join(DATA_DIR, cache_file)
    
    if os.path.exists(cache_path):
        age = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age < 30:
            print(f"  Using cached {label} ({age:.1f} days old)")
            with open(cache_path) as f: return json.load(f)

    print(f"  Querying {label} ArcGIS...")
    all_features, offset = [], 0
    while True:
        params = {'where':'1=1','outFields':'*','returnGeometry':'true','returnCentroid':'true',
                  'outSR':'4326','resultOffset':str(offset),'resultRecordCount':'2000','f':'json'}
        url = f"{api_url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={'User-Agent':'GridScout/1.0'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read().decode()); break
            except Exception as e:
                if attempt < 2: print(f"    Retry: {e}"); time.sleep(5*(attempt+1))
                else: print(f"    FAILED: {e}"); return all_features
        features = data.get('features', [])
        if not features: break
        all_features.extend(features)
        offset += len(features)
        print(f"    {offset} features...")
        if len(features) < 2000: break
        time.sleep(0.5)
    with open(cache_path, 'w') as f: json.dump(all_features, f)
    return all_features

def parse_coal_features(features):
    """Parse NETL coal closure census tract features into site candidates."""
    candidates = []
    for feat in features:
        attrs = feat.get('attributes', {})
        centroid = feat.get('centroid', {})
        lat = centroid.get('y') if centroid else None
        lng = centroid.get('x') if centroid else None
        if (not lat or not lng) and feat.get('geometry'):
            rings = feat['geometry'].get('rings', [])
            if rings and rings[0]:
                pts = rings[0]
                lng, lat = sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
        if not lat or not lng: continue

        # NETL field names: geoid_tract_2020, fipstate_2020, county_name, state_name
        tract = str(attrs.get('geoid_tract_2020', attrs.get('GEOID', '')))
        state_fips = str(attrs.get('fipstate_2020', ''))
        if len(state_fips) < 2:
            state_fips = tract[:2] if len(tract) >= 2 else ''
        state_fips = state_fips.zfill(2)
        state = STATE_FIPS.get(state_fips)
        if not state: continue

        county_fips = str(attrs.get('geoid_county_2020', tract[:5] if len(tract) >= 5 else ''))
        county = attrs.get('county_name', '')

        # Determine coal closure type from NETL fields
        mine = attrs.get('mine_closure', 'No')
        gen = attrs.get('generator_closure', 'No')
        if mine == 'Yes':
            coal_type = 'coal mine'
        elif gen == 'Yes':
            coal_type = 'coal plant'
        else:
            coal_type = 'coal adjacent'  # adjacent_to_closure = Yes

        candidates.append({
            'source_record_id': f"ec_coal_{tract}",
            'name': f"EC Coal {county}" if county else f"EC Coal Tract {tract}",
            'site_type': 'greenfield', 'state': state,
            'county': county or None, 'fips_code': county_fips,
            'latitude': round(lat, 6), 'longitude': round(lng, 6),
            'iso_region': STATE_ISO.get(state),
            'former_use': coal_type,
        })
    return candidates

def parse_msa_features(features):
    """Parse NETL MSA/non-MSA fossil fuel employment area features."""
    candidates = []
    for feat in features:
        attrs = feat.get('attributes', {})

        # Only include records that qualify as Energy Communities
        ec_status = attrs.get('ec_qual_status', '')
        if ec_status != 'Yes': continue

        centroid = feat.get('centroid', {})
        lat = centroid.get('y') if centroid else None
        lng = centroid.get('x') if centroid else None
        if (not lat or not lng) and feat.get('geometry'):
            rings = feat['geometry'].get('rings', [])
            if rings and rings[0]:
                pts = rings[0]
                lng, lat = sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
        if not lat or not lng: continue

        # NETL field names: state_name, fipstate_2020, county_name_2020, geoid_cty_2020, msa_area_name
        state_fips = str(attrs.get('fipstate_2020', '')).zfill(2)
        state = STATE_FIPS.get(state_fips)
        if not state: continue

        county = attrs.get('county_name_2020', '')
        county_fips = str(attrs.get('geoid_cty_2020', ''))
        area_name = attrs.get('msa_area_name', attrs.get('msa_nmsa_label', ''))
        msa_type = attrs.get('msa_qual', '')  # MSA or Non_MSA

        source_id = f"ec_ffe_{county_fips}" if county_fips else f"ec_ffe_{state}_{len(candidates)}"

        candidates.append({
            'source_record_id': source_id,
            'name': f"EC FFE {county}" if county else f"EC FFE {area_name}",
            'site_type': 'greenfield', 'state': state,
            'county': county or None, 'fips_code': county_fips,
            'latitude': round(lat, 6), 'longitude': round(lng, 6),
            'iso_region': STATE_ISO.get(state),
            'former_use': 'fossil fuel employment',
        })
    return candidates

def main():
    print("=" * 60)
    print("GridScout Phase 2b: IRA Energy Community Greenfield Sites")
    print("=" * 60)
    dry_run = '--dry-run' in sys.argv
    coal_only = '--coal-only' in sys.argv
    msa_only = '--msa-only' in sys.argv
    
    candidates = []
    
    if not msa_only:
        print("\n[1/5] Fetching Coal Closure tracts...")
        coal_features = fetch_arcgis_features(COAL_API, "Coal Closure", "ec_coal_tracts.json")
        print(f"  {len(coal_features)} coal closure features")
        coal_candidates = parse_coal_features(coal_features)
        print(f"  {len(coal_candidates)} US coal closure tract centroids")
        candidates.extend(coal_candidates)
    
    if not coal_only:
        print("\n[2/5] Fetching MSA/non-MSA fossil fuel areas...")
        msa_features = fetch_arcgis_features(MSA_API, "MSA/non-MSA", "ec_msa_areas.json")
        print(f"  {len(msa_features)} MSA/non-MSA features")
        msa_candidates = parse_msa_features(msa_features)
        print(f"  {len(msa_candidates)} US MSA/non-MSA area centroids")
        candidates.extend(msa_candidates)
    
    print(f"\n  Total candidates: {len(candidates)}")
    if not candidates:
        print("  No candidates. Check API endpoints."); sys.exit(1)
    
    # Dedup by source_record_id
    seen = set()
    deduped = []
    for c in candidates:
        if c['source_record_id'] not in seen:
            seen.add(c['source_record_id'])
            deduped.append(c)
    candidates = deduped
    print(f"  After dedup: {len(candidates)}")
    
    print("\n[3/5] Checking existing records...")
    existing_ids = set()
    offset = 0
    while True:
        result = supabase_request('GET', f'grid_dc_sites?select=source_record_id&source_record_id=like.ec_*&limit=1000&offset={offset}')
        if not result: break
        for r in result: existing_ids.add(r['source_record_id'])
        if len(result) < 1000: break
        offset += 1000
    print(f"  {len(existing_ids)} existing EC records")
    
    print("\n[4/5] Proximity filtering...")
    coords = []
    offset = 0
    while True:
        rows = supabase_request('GET', f'grid_dc_sites?select=latitude,longitude&latitude=not.is.null&limit=1000&offset={offset}')
        if not rows: break
        for r in rows:
            if r.get('latitude') and r.get('longitude'):
                coords.append((float(r['latitude']), float(r['longitude'])))
        offset += len(rows)
        if len(rows) < 1000: break
    print(f"  {len(coords)} existing site locations")
    
    cell_size = 0.05
    idx = {}
    for lat, lng in coords:
        cell = (int(lat/cell_size), int(lng/cell_size))
        idx.setdefault(cell, []).append((lat, lng))
    
    filtered, skipped_prox, skipped_exist = [], 0, 0
    for c in candidates:
        if c['source_record_id'] in existing_ids:
            skipped_exist += 1; continue
        lat, lng = c['latitude'], c['longitude']
        cl, cg = int(lat/cell_size), int(lng/cell_size)
        close = False
        for di in range(-1, 2):
            if close: break
            for dj in range(-1, 2):
                for elat, elng in idx.get((cl+di, cg+dj), []):
                    if haversine_km(lat, lng, elat, elng) < 2.0:
                        close = True; break
                if close: break
        if close: skipped_prox += 1
        else: filtered.append(c)
    
    print(f"  New: {len(filtered)}, Skip proximity: {skipped_prox}, Skip existing: {skipped_exist}")
    states = {}
    for r in filtered: states[r.get('state','??')] = states.get(r.get('state','??'), 0) + 1
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:15]:
        print(f"    {s}: {c}")
    
    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(filtered)} EC sites."); return
    
    print(f"\n[5/5] Inserting {len(filtered)} EC sites...")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.ira_energy_communities&select=id')
    dsid = ds[0]['id'] if ds else None
    if not dsid:
        r = supabase_request('POST', 'grid_data_sources', [{'name':'ira_energy_communities',
            'url':'https://energycommunities.gov/energy-community-tax-credit-bonus/',
            'description':'IRA Energy Community bonus tax credit areas (coal closure + fossil fuel MSAs)'}], 
            {'Prefer':'return=representation'})
        if r: dsid = r[0]['id']
    
    created, errors = 0, 0
    for i in range(0, len(filtered), BATCH_SIZE):
        batch = filtered[i:i+BATCH_SIZE]
        for r in batch:
            if dsid: r['data_source_id'] = dsid
            r['created_at'] = datetime.now(timezone.utc).isoformat()
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {'Prefer':'return=minimal'})
            created += len(batch)
        except:
            for rec in batch:
                try: supabase_request('POST', 'grid_dc_sites', [rec], {'Prefer':'return=minimal'}); created += 1
                except: errors += 1
        if created % 500 == 0 and created > 0: print(f"  {created}...")
    
    if dsid:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{dsid}', {'record_count': created, 'last_import': datetime.now(timezone.utc).isoformat()})
    
    print(f"\n{'='*60}")
    print(f"EC Ingestion: Created {created}, Errors {errors}, Skip prox {skipped_prox}, Skip exist {skipped_exist}")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()

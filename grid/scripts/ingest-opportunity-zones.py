#!/usr/bin/env python3
"""
Phase 2a: Ingest Opportunity Zone census tract centroids as greenfield DC sites.

Source: CDFI Fund Designated QOZ Excel (8,764 tracts) + Census TIGERweb centroids.
Data file: data/opportunity_zones/designated_qoz.xlsx (from Wayback Machine archive)

Usage:
  python3 -u scripts/ingest-opportunity-zones.py
  python3 -u scripts/ingest-opportunity-zones.py --dry-run
"""

import os, sys, json, math, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
BATCH_SIZE = 50
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'opportunity_zones')

# Census TIGERweb 2020 tracts layer
TIGER_TRACTS_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/0/query"

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
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def load_oz_geoids():
    """Load OZ tract GEOIDs from CDFI Fund Excel file."""
    import openpyxl
    xlsx_path = os.path.join(DATA_DIR, 'designated_qoz.xlsx')
    if not os.path.exists(xlsx_path):
        print(f"  ERROR: {xlsx_path} not found")
        print(f"  Download from Wayback Machine or CDFI Fund")
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    ws = wb.active
    geoids = {}
    for row in ws.iter_rows(min_row=6, values_only=True):  # Skip 5 header rows
        tract = str(row[2] or '').strip() if len(row) > 2 else ''
        if len(tract) == 11 and tract[:2] in STATE_FIPS:
            county = str(row[1] or '').strip() if len(row) > 1 else ''
            geoids[tract] = county
    wb.close()
    return geoids

def fetch_centroids_by_state(state_fips, oz_geoids_in_state):
    """Query Census TIGERweb for all tracts in a state, return only OZ matches."""
    centroids = {}
    offset = 0
    oz_set = set(oz_geoids_in_state)

    while True:
        params = {
            'where': f"STATE='{state_fips}'",
            'outFields': 'GEOID,CENTLAT,CENTLON,BASENAME,COUNTY',
            'returnGeometry': 'false',
            'f': 'json',
            'resultRecordCount': '5000',
            'resultOffset': str(offset),
        }
        url = f"{TIGER_TRACTS_URL}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read().decode())
                    features = data.get('features', [])
                    for f in features:
                        attrs = f.get('attributes', {})
                        geoid = str(attrs.get('GEOID', ''))
                        if geoid in oz_set:
                            lat_str = str(attrs.get('CENTLAT', ''))
                            lon_str = str(attrs.get('CENTLON', ''))
                            try:
                                lat = float(lat_str.replace('+', ''))
                                lon = float(lon_str.replace('+', ''))
                                centroids[geoid] = {
                                    'lat': lat, 'lon': lon,
                                    'county_fips': f"{state_fips}{attrs.get('COUNTY', '')}",
                                }
                            except (ValueError, TypeError):
                                pass
                    if len(features) < 5000:
                        return centroids
                    offset += len(features)
                    break
            except Exception as e:
                if attempt < 2:
                    time.sleep(5 * (attempt + 1))
                else:
                    print(f"    FAILED: {e}")
                    return centroids
        time.sleep(0.3)

    return centroids

def main():
    print("=" * 60)
    print("GridScout Phase 2a: Opportunity Zone Greenfield Sites")
    print("=" * 60)
    dry_run = '--dry-run' in sys.argv

    print("\n[1/5] Loading OZ tract GEOIDs from Excel...")
    oz_geoids = load_oz_geoids()
    print(f"  {len(oz_geoids)} designated OZ tracts")

    # Group by state FIPS
    by_state = {}
    for geoid, county in oz_geoids.items():
        st = geoid[:2]
        by_state.setdefault(st, {})[geoid] = county

    print(f"  Across {len(by_state)} states/territories")

    print("\n[2/5] Looking up tract centroids from Census TIGERweb...")
    all_centroids = {}
    for st_fips in sorted(by_state.keys()):
        state_name = STATE_FIPS.get(st_fips, st_fips)
        if st_fips not in STATE_FIPS:
            continue  # Skip territories (PR, GU, VI, AS, MP)
        tracts_in_state = list(by_state[st_fips].keys())
        centroids = fetch_centroids_by_state(st_fips, tracts_in_state)
        all_centroids.update(centroids)
        print(f"    {state_name}: {len(centroids)}/{len(tracts_in_state)} OZ tracts matched")

    print(f"  Total: {len(all_centroids)} centroids found")

    print("\n[3/5] Building candidates...")
    candidates = []
    for geoid, info in all_centroids.items():
        state_fips = geoid[:2]
        state = STATE_FIPS.get(state_fips)
        if not state: continue
        county_name = oz_geoids.get(geoid, '')
        candidates.append({
            'source_record_id': f"oz_{geoid}",
            'name': f"OZ {county_name}" if county_name else f"OZ Tract {geoid}",
            'site_type': 'greenfield', 'state': state,
            'county': county_name or None,
            'fips_code': info.get('county_fips', geoid[:5]),
            'latitude': round(info['lat'], 6),
            'longitude': round(info['lon'], 6),
            'iso_region': STATE_ISO.get(state),
        })
    print(f"  {len(candidates)} OZ greenfield candidates")

    print("\n[4/5] Proximity filtering...")
    # Check existing records
    existing_ids = set()
    offset = 0
    while True:
        result = supabase_request('GET', f'grid_dc_sites?select=source_record_id&source_record_id=like.oz_*&limit=1000&offset={offset}')
        if not result: break
        for r in result: existing_ids.add(r['source_record_id'])
        if len(result) < 1000: break
        offset += 1000
    print(f"  {len(existing_ids)} existing OZ records")

    # Load existing site coords
    coords = []
    offset = 0
    while True:
        rows_db = supabase_request('GET', f'grid_dc_sites?select=latitude,longitude&latitude=not.is.null&limit=1000&offset={offset}')
        if not rows_db: break
        for r in rows_db:
            if r.get('latitude') and r.get('longitude'):
                coords.append((float(r['latitude']), float(r['longitude'])))
        offset += len(rows_db)
        if len(rows_db) < 1000: break
    print(f"  {len(coords)} existing site locations")

    # Spatial index
    cell_size = 0.05
    idx = {}
    for lat, lng in coords:
        cell = (int(lat / cell_size), int(lng / cell_size))
        idx.setdefault(cell, []).append((lat, lng))

    filtered, skipped_prox, skipped_exist = [], 0, 0
    for c in candidates:
        if c['source_record_id'] in existing_ids:
            skipped_exist += 1; continue
        lat, lng = c['latitude'], c['longitude']
        cl, cg = int(lat / cell_size), int(lng / cell_size)
        close = False
        for di in range(-1, 2):
            if close: break
            for dj in range(-1, 2):
                for elat, elng in idx.get((cl + di, cg + dj), []):
                    if haversine_km(lat, lng, elat, elng) < 2.0:
                        close = True; break
                if close: break
        if close:
            skipped_prox += 1
        else:
            filtered.append(c)
            cell = (int(lat / cell_size), int(lng / cell_size))
            idx.setdefault(cell, []).append((lat, lng))

    print(f"  New: {len(filtered)}, Skip proximity: {skipped_prox}, Skip existing: {skipped_exist}")
    states = {}
    for r in filtered: states[r['state']] = states.get(r['state'], 0) + 1
    for s, c in sorted(states.items(), key=lambda x: -x[1])[:10]:
        print(f"    {s}: {c}")

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(filtered)} OZ sites."); return

    print(f"\n[5/5] Inserting {len(filtered)} OZ sites...")
    ds = supabase_request('GET', 'grid_data_sources?name=eq.hud_opportunity_zones&select=id')
    dsid = ds[0]['id'] if ds else None
    if not dsid:
        r = supabase_request('POST', 'grid_data_sources', [{'name': 'hud_opportunity_zones',
            'url': 'https://www.cdfifund.gov/opportunity-zones',
            'description': 'CDFI Fund Designated Qualified Opportunity Zone census tracts'}], {'Prefer': 'return=representation'})
        if r: dsid = r[0]['id']

    created, errors = 0, 0
    for i in range(0, len(filtered), BATCH_SIZE):
        batch = filtered[i:i + BATCH_SIZE]
        for r in batch:
            if dsid: r['data_source_id'] = dsid
            r['created_at'] = datetime.now(timezone.utc).isoformat()
        try:
            supabase_request('POST', 'grid_dc_sites', batch, {'Prefer': 'return=minimal'})
            created += len(batch)
        except:
            for rec in batch:
                try: supabase_request('POST', 'grid_dc_sites', [rec], {'Prefer': 'return=minimal'}); created += 1
                except Exception as e2: errors += 1

        if created % 500 == 0 and created > 0: print(f"  {created}...")

    if dsid:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{dsid}', {'record_count': created, 'last_import': datetime.now(timezone.utc).isoformat()})

    print(f"\n{'=' * 60}")
    print(f"OZ Ingestion: Created {created}, Errors {errors}, Skip prox {skipped_prox}, Skip exist {skipped_exist}")
    print(f"{'=' * 60}")

if __name__ == '__main__':
    main()

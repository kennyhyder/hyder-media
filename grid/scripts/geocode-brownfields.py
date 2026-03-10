#!/usr/bin/env python3
"""Geocode brownfield sites missing coordinates using Nominatim API.
Then crossref to nearest substation and generate DC site records."""

import os, sys, json, time, urllib.request, urllib.parse, urllib.error
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
BATCH_SIZE = 50
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
TIGERWEB_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query"

STATE_FIPS = {
    'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
    'DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19',
    'KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27',
    'MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35',
    'NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','PR':'72',
    'RI':'44','SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51',
    'WA':'53','WV':'54','WI':'55','WY':'56','VI':'78','GU':'66','AS':'60',
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
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode()[:200]}")
        return None

def geocode_city_state_tigerweb(city, state, max_retries=3):
    """Geocode a city+state using Census TIGERweb Places layer (no strict rate limit)."""
    fips = STATE_FIPS.get(state)
    if not fips:
        return None, None
    # Clean city name for SQL LIKE query
    clean_city = city.replace("'", "''").strip()
    # Remove parenthetical notes like "(census-designated)"
    if '(' in clean_city:
        clean_city = clean_city[:clean_city.index('(')].strip()
    # Try exact match first, then prefix match
    for where in [
        f"BASENAME='{clean_city}' AND STATE='{fips}'",
        f"BASENAME LIKE '{clean_city}%' AND STATE='{fips}'",
    ]:
        params = urllib.parse.urlencode({
            'where': where,
            'outFields': 'CENTLAT,CENTLON,NAME',
            'f': 'json',
            'resultRecordCount': 1,
        })
        url = f"{TIGERWEB_URL}?{params}"
        for attempt in range(max_retries):
            req = urllib.request.Request(url, headers={'User-Agent': 'GridScout/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                    features = data.get('features', [])
                    if features:
                        attrs = features[0]['attributes']
                        return float(attrs['CENTLAT']), float(attrs['CENTLON'])
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(2)
                    continue
                print(f"  TIGERweb error for '{city}, {state}': {e}")
        # If exact match found nothing, try prefix
    return None, None

def geocode_city_state_nominatim(city, state, max_retries=3):
    """Geocode a city+state using Nominatim with retry on 429."""
    query = f"{city}, {state}, USA"
    params = urllib.parse.urlencode({
        'q': query,
        'format': 'json',
        'limit': 1,
        'countrycodes': 'us',
    })
    url = f"{NOMINATIM_URL}?{params}"
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={
            'User-Agent': 'GridScout/1.0 (kenny@hyder.me)'
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                results = json.loads(resp.read().decode())
                if results:
                    return float(results[0]['lat']), float(results[0]['lon'])
                return None, None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                wait = (attempt + 1) * 5
                print(f"  Rate limited, waiting {wait}s before retry...")
                time.sleep(wait)
                continue
            print(f"  Geocode error for '{query}': {e}")
        except Exception as e:
            print(f"  Geocode error for '{query}': {e}")
    return None, None

def main():
    dry_run = '--dry-run' in sys.argv

    print("=" * 60)
    print("Geocode Brownfield Sites Missing Coordinates")
    print("=" * 60)

    # Load brownfields missing coordinates
    print("\n[Step 1] Loading brownfields without coordinates...")
    brownfields = []
    offset = 0
    while True:
        result = supabase_request('GET',
            f'grid_brownfield_sites?select=id,name,city,state,site_type'
            f'&latitude=is.null&city=not.is.null'
            f'&order=state,city'
            f'&limit=1000&offset={offset}')
        if not result:
            break
        brownfields.extend(result)
        if len(result) < 1000:
            break
        offset += 1000

    # Filter out "unsited" records
    brownfields = [b for b in brownfields if b.get('city', '').lower() not in ('unsited', '', 'n/a', 'unknown')]
    print(f"  {len(brownfields)} brownfields to geocode")

    # Deduplicate city+state pairs to minimize API calls
    city_state_pairs = {}
    for bf in brownfields:
        key = (bf['city'].strip(), bf['state'])
        if key not in city_state_pairs:
            city_state_pairs[key] = []
        city_state_pairs[key].append(bf['id'])

    print(f"  {len(city_state_pairs)} unique city+state pairs")

    # Geocode each unique city+state (TIGERweb first, Nominatim fallback)
    print("\n[Step 2] Geocoding city+state pairs via Census TIGERweb...")
    geocoded = {}
    errors = 0
    nominatim_used = 0
    for i, ((city, state), ids) in enumerate(city_state_pairs.items()):
        lat, lng = geocode_city_state_tigerweb(city, state)
        if not lat or not lng:
            # Skip Nominatim fallback when rate-limited
            if '--with-nominatim' in sys.argv:
                lat, lng = geocode_city_state_nominatim(city, state)
                if lat and lng:
                    nominatim_used += 1
                    time.sleep(2.0)  # Nominatim rate limit
        if lat and lng:
            geocoded[(city, state)] = (lat, lng)
        else:
            errors += 1
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(city_state_pairs)}: {len(geocoded)} geocoded, {errors} failed, {nominatim_used} via Nominatim")
        time.sleep(0.2)  # Small delay between TIGERweb requests

    print(f"  Geocoded: {len(geocoded)}/{len(city_state_pairs)} ({errors} failed)")

    if dry_run:
        print(f"\n[DRY RUN] Would update {sum(len(ids) for (c,s), ids in city_state_pairs.items() if (c,s) in geocoded)} brownfield records")
        for (city, state), (lat, lng) in list(geocoded.items())[:10]:
            count = len(city_state_pairs[(city, state)])
            print(f"  {city}, {state}: ({lat:.4f}, {lng:.4f}) — {count} records")
        return

    # Update brownfield records with coordinates
    print("\n[Step 3] Patching coordinates...")
    patched = 0
    patch_errors = 0
    for (city, state), (lat, lng) in geocoded.items():
        ids = city_state_pairs[(city, state)]
        for bf_id in ids:
            result = supabase_request('PATCH',
                f'grid_brownfield_sites?id=eq.{bf_id}',
                {'latitude': lat, 'longitude': lng},
                {'Prefer': 'return=minimal'})
            if result is not None:
                patched += 1
            else:
                patch_errors += 1
        if patched % 100 == 0 and patched > 0:
            print(f"  {patched} patched...")

    print(f"  {patched} records patched, {patch_errors} errors")

    # Now run crossref-brownfield-substations for newly geocoded records
    print("\n[Step 4] Cross-referencing to nearest substations...")
    print("  Run: python3 -u grid/scripts/crossref-brownfield-substations.py")
    print("  Then: python3 -u grid/scripts/generate-dc-sites.py")
    print("  Then: python3 -u grid/scripts/score-dc-sites.py")

    print(f"\nDone! {patched} brownfields geocoded.")

if __name__ == '__main__':
    main()

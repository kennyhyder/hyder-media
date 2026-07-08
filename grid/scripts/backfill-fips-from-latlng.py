#!/usr/bin/env python3
"""
backfill-fips-from-latlng.py — assign county FIPS (+county name, state) to the
~80k grid_dc_sites rows that have lat/long but null fips_code, via local
point-in-polygon against Census county boundaries. Unlocks those sites for
county-based profile URLs on gridcensus.com.

Strategy: load Census county polygons once (geopandas), spatial-join all
null-fips points, then bulk-PATCH grouped by resolved county (id=in.(...)
batches) so it's a few thousand requests, not 80k.

Idempotent: only touches rows where fips_code is null. Safe to re-run.
Usage: python3 scripts/backfill-fips-from-latlng.py [--dry]
"""
import json, os, sys, urllib.request, urllib.error
import geopandas as gpd
from shapely.geometry import Point

DRY = "--dry" in sys.argv

def env(key):
    for p in ["/Users/kennyhyder/Desktop/hyder-media/grid/.env.local",
              "/Users/kennyhyder/Desktop/hyder-media/.env.local"]:
        try:
            for line in open(p):
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    raise SystemExit("missing " + key)

URL = env("SUPABASE_URL"); KEY = env("SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}

def rest(method, path, body=None, extra=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method,
                                 headers={**H, **(extra or {}), "Content-Type": "application/json"})
    r = urllib.request.urlopen(req)
    return r

print("Loading Census county boundaries…")
counties = gpd.read_file("https://www2.census.gov/geo/tiger/GENZ2022/shp/cb_2022_us_county_500k.zip")
counties = counties.to_crs(4326)[["GEOID", "NAME", "STUSPS", "geometry"]]
print(f"  {len(counties)} county polygons")

print("Fetching null-fips sites (paginated)…")
rows, offset = [], 0
while True:
    req = urllib.request.Request(
        URL + f"/rest/v1/grid_dc_sites?select=id,latitude,longitude&fips_code=is.null&latitude=not.is.null&order=id.asc&limit=1000&offset={offset}",
        headers=H)
    page = json.load(urllib.request.urlopen(req))
    if not page: break
    rows.extend(page); offset += 1000
    if len(page) < 1000: break
print(f"  {len(rows)} sites to locate")

pts = gpd.GeoDataFrame(
    {"id": [r["id"] for r in rows]},
    geometry=[Point(float(r["longitude"]), float(r["latitude"])) for r in rows],
    crs=4326)
joined = gpd.sjoin(pts, counties, how="left", predicate="within")
located = joined[joined["GEOID"].notna()]
print(f"  located {len(located)} / {len(rows)} (rest fall outside US county polygons)")

# group ids by resolved (fips, name, state)
groups = {}
for _, r in located.iterrows():
    key = (r["GEOID"], r["NAME"], r["STUSPS"])
    groups.setdefault(key, []).append(r["id"])
print(f"  {len(groups)} distinct counties")

if DRY:
    print("DRY run — no writes.")
    for (fips, name, st), ids in list(groups.items())[:8]:
        print(f"  {st} {name} ({fips}): {len(ids)} sites")
    sys.exit(0)

patched = 0
for (fips, name, st), ids in groups.items():
    county = name if str(name).lower().endswith("county") else f"{name} County"
    for i in range(0, len(ids), 100):
        batch = ids[i:i+100]
        idlist = ",".join(batch)
        body = {"fips_code": fips, "county": county, "state": st}
        try:
            rest("PATCH", f"grid_dc_sites?id=in.({idlist})", body,
                 {"Prefer": "return=minimal"})
            patched += len(batch)
        except urllib.error.HTTPError as e:
            print(f"  ERR {st} {name}: {e.code} {e.read()[:120]}")
    if patched % 5000 < 100:
        print(f"  …patched ~{patched}")
print(f"Done. Backfilled fips on ~{patched} sites.")

# verify remaining
req = urllib.request.Request(URL + "/rest/v1/grid_dc_sites?select=id&fips_code=is.null",
                             headers={**H, "Prefer": "count=exact", "Range": "0-0"})
try:
    r = urllib.request.urlopen(req)
    print("Remaining null-fips:", r.headers.get("content-range"))
except urllib.error.HTTPError as e:
    print("verify err", e.code)

#!/usr/bin/env python3
"""
backfill-fiber-route-distance.py — fill nearest_fiber_route_km on every
grid_dc_sites row that has lat/long but a NULL nearest_fiber_route_km
(80% -> 100% coverage). Distance is computed to the nearest of the ~545k
grid_fiber_routes centroids using geopandas sjoin_nearest (STRtree-backed KNN).

WHY geopandas/sjoin_nearest (vs the old enrich-osm-fiber.py grid-index loop):
  - grid_fiber_routes stores per-route CENTROIDS (centroid_lat/centroid_lng),
    so a point-to-nearest-centroid KNN is the right operation. sjoin_nearest
    on a projected CRS gives true planar nearest-neighbour in one vectorised
    call over all ~32k null sites at once.
  - The old script wrote via psql (direct DB). This one is PostgREST-only:
    batched PATCH grouped by id (mirrors backfill-fips-from-latlng.py).

SAFETY / id-stability:
  - ADDITIVE ONLY. Touches only rows where nearest_fiber_route_km IS NULL.
    Never wipes, never reassigns ids. Safe to re-run (idempotent — already
    -filled rows are skipped by the is.null filter). Does NOT recompute scores;
    score-dc-sites.py picks up the new nearest_fiber_route_km on its next run
    (it reads this column for score_fiber). Run scoring separately if desired.

Distance method:
  - Reproject both sites + route centroids to EPSG:5070 (CONUS Albers, metres),
    sjoin_nearest with distance_col, convert metres -> km, round to 2dp.
    (5070 is CONUS-only; AK/HI/territory sites get a slightly distorted metric
    distance but are a vanishingly small slice and still get a sane value. To
    be exact everywhere you could switch to a geodesic pass, but Albers is the
    proven CONUS convention used across these scripts.)

Usage:
  python3 scripts/backfill-fiber-route-distance.py            # run (writes)
  python3 scripts/backfill-fiber-route-distance.py --dry      # no writes
"""
import json, os, sys, time, urllib.request, urllib.error
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

DRY = "--dry" in sys.argv
METRIC_CRS = "EPSG:5070"  # CONUS Albers Equal Area, units = metres


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
    req = urllib.request.Request(
        URL + "/rest/v1/" + path, data=data, method=method,
        headers={**H, **(extra or {}), "Content-Type": "application/json"})
    return urllib.request.urlopen(req)


def load_keyset(table, select, filters="", page=1000):
    """Keyset (seek) pagination by id — O(1) per page. Deep OFFSET on the 545k
    grid_fiber_routes table hits a Postgres statement timeout (57014); keyset
    avoids it. `select` MUST include id. Loops until an empty page (PostgREST's
    default max-rows is 1000, so don't rely on a short page to detect EOF —
    keep seeking past the last id until nothing comes back)."""
    out, last_id, pages = [], None, 0
    while True:
        f = filters
        if last_id is not None:
            f += f"&id=gt.{last_id}"
        path = (f"{table}?select={select}{f}&order=id.asc&limit={page}")
        req = urllib.request.Request(URL + "/rest/v1/" + path, headers=H)
        chunk = json.load(urllib.request.urlopen(req))
        if not chunk:
            break
        out.extend(chunk)
        last_id = chunk[-1]["id"]
        pages += 1
        if pages % 25 == 0:
            print(f"    …{len(out)} rows", flush=True)
    return out


# ── Phase 1: fiber route centroids ─────────────────────────────────────────
print("Loading grid_fiber_routes centroids…")
routes = load_keyset(
    "grid_fiber_routes", "id,centroid_lat,centroid_lng",
    "&centroid_lat=not.is.null&centroid_lng=not.is.null")
print(f"  {len(routes)} fiber route centroids")
routes_gdf = gpd.GeoDataFrame(
    geometry=[Point(float(r["centroid_lng"]), float(r["centroid_lat"])) for r in routes],
    crs=4326).to_crs(METRIC_CRS)

# ── Phase 2: sites missing nearest_fiber_route_km ──────────────────────────
print("Loading null nearest_fiber_route_km sites (with lat/long)…")
sites = load_keyset(
    "grid_dc_sites", "id,latitude,longitude",
    "&nearest_fiber_route_km=is.null&latitude=not.is.null&longitude=not.is.null")
print(f"  {len(sites)} sites to fill")
if not sites:
    print("Nothing to do — all sites already have nearest_fiber_route_km.")
    sys.exit(0)

sites_gdf = gpd.GeoDataFrame(
    {"id": [s["id"] for s in sites]},
    geometry=[Point(float(s["longitude"]), float(s["latitude"])) for s in sites],
    crs=4326).to_crs(METRIC_CRS)

# ── Phase 3: KNN nearest ───────────────────────────────────────────────────
print("Computing nearest fiber route (sjoin_nearest)…")
joined = gpd.sjoin_nearest(sites_gdf, routes_gdf, how="left", distance_col="dist_m")
# sjoin_nearest can emit >1 row per site on exact ties; keep the min per id.
joined = joined.sort_values("dist_m").drop_duplicates(subset="id", keep="first")
joined["km"] = (joined["dist_m"] / 1000.0).round(2)
results = dict(zip(joined["id"], joined["km"]))
print(f"  computed {len(results)} distances "
      f"(min={joined['km'].min():.2f} median={joined['km'].median():.2f} "
      f"max={joined['km'].max():.2f} km)")

if DRY:
    print("DRY run — no writes. Sample:")
    for sid, km in list(results.items())[:10]:
        print(f"  {sid} -> {km} km")
    sys.exit(0)

# ── Phase 4: batched PATCH grouped by rounded distance ─────────────────────
# Group ids by identical rounded km so each PATCH carries one body for many ids
# (id=in.(...) batches of 100) — same shape as backfill-fips-from-latlng.py.
by_km = {}
for sid, km in results.items():
    by_km.setdefault(km, []).append(sid)
print(f"  {len(by_km)} distinct distance buckets")

patched, t0 = 0, time.time()
for km, ids in by_km.items():
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        idlist = ",".join(batch)
        try:
            rest("PATCH", f"grid_dc_sites?id=in.({idlist})",
                 {"nearest_fiber_route_km": km}, {"Prefer": "return=minimal"})
            patched += len(batch)
        except urllib.error.HTTPError as e:
            print(f"  ERR km={km}: {e.code} {e.read()[:120]}")
    if patched and patched % 5000 < 100:
        print(f"  …patched ~{patched} ({time.time()-t0:.0f}s)")
print(f"Done. Backfilled nearest_fiber_route_km on ~{patched} sites "
      f"in {time.time()-t0:.0f}s.")

# ── Freshness stamp (so cron-refresh.py --check can track this job) ─────────
from datetime import datetime, timezone
_stamp = {"last_import": datetime.now(timezone.utc).isoformat(), "record_count": patched}
try:
    existing = json.load(rest(
        "GET", "grid_data_sources?select=id&name=eq.fiber_route_distance&limit=1"))
    if existing:
        rest("PATCH", "grid_data_sources?name=eq.fiber_route_distance",
             _stamp, {"Prefer": "return=minimal"})
    else:
        rest("POST", "grid_data_sources",
             {"name": "fiber_route_distance",
              "url": "internal:grid_fiber_routes",
              "description": "nearest_fiber_route_km backfill (geopandas sjoin_nearest)",
              **_stamp}, {"Prefer": "return=minimal"})
except urllib.error.HTTPError as e:
    print("  (freshness stamp skipped:", e.code, ")")

# ── Verify ─────────────────────────────────────────────────────────────────
req = urllib.request.Request(
    URL + "/rest/v1/grid_dc_sites?select=id&nearest_fiber_route_km=is.null"
          "&latitude=not.is.null&longitude=not.is.null",
    headers={**H, "Prefer": "count=exact", "Range": "0-0"})
try:
    r = urllib.request.urlopen(req)
    print("Remaining null (with lat/long):", r.headers.get("content-range"))
except urllib.error.HTTPError as e:
    print("verify err", e.code)

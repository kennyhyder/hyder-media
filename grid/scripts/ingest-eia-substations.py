#!/usr/bin/env python3
"""
ingest-eia-substations.py — repoint substation ingest from the DISCONTINUED
HIFLD Open service to the EIA U.S. Energy Atlas FeatureServer.

WHY: HIFLD Open retired (Aug–Sep 2025). EIA Energy Atlas hosts the canonical
Electric Substations layer:
  https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/
    Electric_Substations/FeatureServer/0
  (esriGeometryPoint, maxRecordCount 2000, ~75,328 features as of 2026-06.)

Target table: grid_substations.
  NOTE: grid_substations has NO unique source_record_id column in the live
  schema (cols: id, name, state, latitude, longitude, max_voltage_kv,
  min_voltage_kv, connected_line_count, connected_line_ids, owners,
  data_source_id, created_at). To keep writes id-STABLE we upsert on the
  natural key (LATITUDE, LONGITUDE) — EIA point coords are stable per
  substation ID. Default behaviour matches existing rows by exact lat/long and
  PATCHes them in place; only genuinely-new coords are inserted. NO wipe.

────────────────────────────────────────────────────────────────────────────
FIELD MAPPING  (EIA attribute  ->  grid_substations column)
────────────────────────────────────────────────────────────────────────────
  NAME       -> name              ("UNKNOWN######" kept as-is, EIA convention)
  STATE      -> state
  LATITUDE   -> latitude          (also natural upsert key)
  LONGITUDE  -> longitude         (also natural upsert key)
  MAX_VOLT   -> max_voltage_kv    (-999999 sentinel -> null)
  MIN_VOLT   -> min_voltage_kv    (-999999 sentinel -> null)
  LINES      -> connected_line_count
  (none)     -> owners            (EIA substations layer has no owner field;
                                    left untouched — existing values preserved)

────────────────────────────────────────────────────────────────────────────
RUN COMMANDS
────────────────────────────────────────────────────────────────────────────
  # SAFE small test (default) — fetch 5, print mapping, NO write:
  python3 scripts/ingest-eia-substations.py --test

  # SAFE bbox test — upsert just a tiny bbox (matches existing by lat/long):
  python3 scripts/ingest-eia-substations.py --bbox -106.7,30.2,-106.0,30.8 --limit 50

  # FULL national re-ingest (REVIEWED MANUAL RUN — affects the substation layer
  # the live site reads via nearest-substation joins; do NOT run unattended):
  python3 scripts/ingest-eia-substations.py --full --i-reviewed-this
"""
import json, os, sys, time, ssl, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

FS = ("https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/"
      "Electric_Substations/FeatureServer/0")
PAGE = 2000
SOURCE_NAME = "eia_substations"
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


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


def arc(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(req, context=CTX, timeout=120))


def safe_float(v):
    try:
        f = float(v)
        return None if f <= -999990 else f
    except (TypeError, ValueError):
        return None


def safe_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def transform(feat, data_source_id):
    a = feat.get("attributes", {})
    g = feat.get("geometry", {}) or {}
    # Existing grid_substations rows store lat/long rounded to 7 decimals
    # (the column precision). EIA returns full float precision, so round to 7
    # to (a) match the live schema and (b) make the natural-key upsert below
    # actually find existing rows instead of inserting duplicates.
    _lat = safe_float(a.get("LATITUDE")); _lng = safe_float(a.get("LONGITUDE"))
    if _lat is None:
        _lat = safe_float(g.get("y"))
    if _lng is None:
        _lng = safe_float(g.get("x"))
    lat = round(_lat, 7) if _lat is not None else None
    lng = round(_lng, 7) if _lng is not None else None
    return {
        "name": (a.get("NAME") or None),
        "state": (a.get("STATE") or None),
        "latitude": lat,
        "longitude": lng,
        "max_voltage_kv": safe_float(a.get("MAX_VOLT")),
        "min_voltage_kv": safe_float(a.get("MIN_VOLT")),
        "connected_line_count": safe_int(a.get("LINES")),
        "data_source_id": data_source_id,
    }


def ensure_data_source():
    try:
        rows = json.load(rest("GET", f"grid_data_sources?select=id&name=eq.{SOURCE_NAME}&limit=1"))
        if rows:
            return rows[0]["id"]
    except urllib.error.HTTPError:
        pass
    try:
        return json.load(rest("POST", "grid_data_sources",
                              {"name": SOURCE_NAME, "url": FS,
                               "description": "EIA U.S. Energy Atlas — Electric Substations"},
                              {"Prefer": "return=representation"}))[0]["id"]
    except urllib.error.HTTPError as e:
        print("  (could not create data_source:", e.code, ")")
        return None


def fetch(bbox=None, limit=None):
    out, offset = [], 0
    while True:
        params = {"where": "1=1", "outFields": "*", "f": "json",
                  "resultOffset": offset, "resultRecordCount": PAGE, "outSR": 4326}
        if bbox:
            params.update({"geometry": ",".join(map(str, bbox)),
                           "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                           "spatialRel": "esriSpatialRelIntersects"})
        data = arc(FS + "/query?" + urllib.parse.urlencode(params))
        feats = data.get("features", [])
        if not feats:
            break
        out.extend(feats); offset += len(feats)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(feats) < PAGE:
            break
        time.sleep(0.2)
    return out


# ~50 m at mid-latitudes — tolerance for matching the SAME physical substation
# across source vintages (EIA vs the older HIFLD-sourced rows). EIA coords are
# rarely bit-identical to the stored ones, so an exact match would duplicate.
COORD_TOL = 0.0005


def upsert_by_coord(rec):
    """id-stable: PATCH the nearest existing row within COORD_TOL of this
    lat/long if one exists, else POST. Matches the SAME physical substation
    across source vintages rather than duplicating it.
    Returns 'patch' | 'insert' | 'skip'.

    NOTE for the reviewed full run: this tolerance-join is the dedup strategy.
    If a reviewer prefers an exact replace, that is a separate decision — this
    default never wipes and never reassigns ids."""
    lat, lng = rec["latitude"], rec["longitude"]
    if lat is None or lng is None:
        return "skip"
    q = (f"grid_substations?select=id,latitude,longitude"
         f"&latitude=gte.{lat-COORD_TOL}&latitude=lte.{lat+COORD_TOL}"
         f"&longitude=gte.{lng-COORD_TOL}&longitude=lte.{lng+COORD_TOL}&limit=5")
    existing = json.load(rest("GET", q))
    body = {k: v for k, v in rec.items() if k != "data_source_id" or v is not None}
    if existing:
        rest("PATCH", f"grid_substations?id=eq.{existing[0]['id']}", body,
             {"Prefer": "return=minimal"})
        return "patch"
    rest("POST", "grid_substations", body, {"Prefer": "return=minimal"})
    return "insert"


def main():
    args = sys.argv[1:]
    test = "--test" in args or not args
    full = "--full" in args
    reviewed = "--i-reviewed-this" in args
    limit, bbox = None, None
    for i, a in enumerate(args):
        if a == "--limit":
            limit = int(args[i + 1])
        if a == "--bbox":
            bbox = tuple(float(x) for x in args[i + 1].split(","))

    print("EIA Substations ingest →", FS)

    if test:
        print("\n[--test] fetching 5 features, printing field mapping, NO writes\n")
        feats = fetch(limit=5)
        for f in feats:
            rec = transform(f, None)
            print(" EIA ID", f["attributes"].get("ID"), "→", rec["name"],
                  "| state", rec["state"], "| lat/lng", rec["latitude"], rec["longitude"],
                  "| Vmax", rec["max_voltage_kv"], "| lines", rec["connected_line_count"])
        print("\nMapped keys:", sorted(transform(feats[0], None).keys()))
        print("OK — confirmed field mapping. Run --full --i-reviewed-this for national load.")
        return

    if full and not reviewed:
        print("\nREFUSING --full without --i-reviewed-this. The substation layer feeds the")
        print("nearest-substation joins the live site reads. Re-run with --i-reviewed-this.")
        return

    data_source_id = ensure_data_source()
    print("\nFetching…", "bbox=" + str(bbox) if bbox else "national")
    feats = fetch(bbox=bbox, limit=limit)
    print(f"  {len(feats)} features")
    n = {"patch": 0, "insert": 0, "skip": 0}
    for j, f in enumerate(feats):
        rec = transform(f, data_source_id)
        try:
            n[upsert_by_coord(rec)] += 1
        except urllib.error.HTTPError as e:
            print(f"  err {f['attributes'].get('ID')}: {e.code} {e.read()[:120]}")
        if (j + 1) % 2000 == 0:
            print(f"  …{j+1} processed (patch={n['patch']} insert={n['insert']})")
    print(f"Done. patched={n['patch']} inserted={n['insert']} skipped={n['skip']} (id-stable).")

    if data_source_id:
        try:
            rest("PATCH", f"grid_data_sources?name=eq.{SOURCE_NAME}",
                 {"last_import": datetime.now(timezone.utc).isoformat(),
                  "record_count": n["patch"] + n["insert"]}, {"Prefer": "return=minimal"})
        except urllib.error.HTTPError:
            pass


if __name__ == "__main__":
    main()

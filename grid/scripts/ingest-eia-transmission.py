#!/usr/bin/env python3
"""
ingest-eia-transmission.py — repoint transmission-line ingest from the
DISCONTINUED HIFLD Open service to the EIA U.S. Energy Atlas FeatureServer.

WHY: HIFLD Open was retired (Aug–Sep 2025). The canonical replacement for
electric transmission lines is the EIA Energy Atlas hosted FeatureServer:
  https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/
    US_Electric_Power_Transmission_Lines/FeatureServer/0
  (layer "Electric_Power_Transmission_Lines_A", esriGeometryPolyline,
   maxRecordCount 2000, ~94,619 features as of 2026-06).

Target table: grid_transmission_lines (UNIQUE on source_record_id).

────────────────────────────────────────────────────────────────────────────
FIELD MAPPING  (EIA attribute  ->  grid_transmission_lines column)
────────────────────────────────────────────────────────────────────────────
  ID          -> source_record_id  ("eia_{ID}")   ← STABLE EIA line id
              -> hifld_id          (int(ID) if numeric, else null)
  VOLTAGE     -> voltage_kv        (-999999 / -999998 sentinels -> null)
  VOLT_CLASS  -> volt_class
  OWNER       -> owner             ("NOT AVAILABLE" -> null)
  STATUS      -> status
  TYPE        -> line_type         (OVERHEAD / UNDERGROUND)
  SUB_1       -> sub_1
  SUB_2       -> sub_2
  (none)      -> naession          (EIA has no line-name field; left null —
                                     existing HIFLD rows keep theirs)
  geometry    -> geometry_wkt      (paths -> MULTILINESTRING WKT)
  VOLTAGE     -> capacity_mw       (estimated via voltage->capacity table,
                                     same heuristic as ingest-hifld.py)

────────────────────────────────────────────────────────────────────────────
id-STABILITY / SAFETY  (the live site reads grid_transmission_lines)
────────────────────────────────────────────────────────────────────────────
  * Writes are UPSERT on source_record_id (Prefer: resolution=merge-duplicates).
    EIA rows get source_record_id = "eia_{ID}". Existing HIFLD rows
    ("hifld_{OBJECTID}") are a SEPARATE keyspace and are NOT touched, so a
    parallel EIA layer can be staged additively. NO wipe, NO id reassignment.
  * --replace-hifld (NOT default, documented only): after a verified full EIA
    load you may retire the stale hifld_* rows. That is a reviewed manual op —
    this script never deletes unless explicitly asked AND --i-reviewed-this.

────────────────────────────────────────────────────────────────────────────
RUN COMMANDS
────────────────────────────────────────────────────────────────────────────
  # SAFE small test (default) — fetch 5 features, print field mapping, NO write:
  python3 scripts/ingest-eia-transmission.py --test

  # SAFE bbox test — fetch a tiny bbox, upsert just those (additive eia_* ids):
  python3 scripts/ingest-eia-transmission.py --bbox -106.7,30.2,-106.0,30.8 --limit 50

  # FULL national re-ingest (REVIEWED MANUAL RUN — overwrites/extends the
  # transmission layer the live site reads; do NOT run unattended):
  python3 scripts/ingest-eia-transmission.py --full --i-reviewed-this
"""
import json, os, sys, math, time, ssl, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

FS = ("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/"
      "US_Electric_Power_Transmission_Lines/FeatureServer/0")
PAGE = 2000  # = layer maxRecordCount
SOURCE_NAME = "eia_transmission"
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


# ── transforms ─────────────────────────────────────────────────────────────
def safe_float(v):
    try:
        f = float(v)
        return None if f <= -999990 else f   # EIA sentinels: -999999 / -999998
    except (TypeError, ValueError):
        return None


def safe_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return None if s == "" or s.upper() == "NOT AVAILABLE" else s


def paths_to_wkt(paths):
    if not paths:
        return None
    parts = []
    for path in paths:
        pts = ", ".join(f"{c[0]} {c[1]}" for c in path if len(c) >= 2)
        if pts:
            parts.append("(" + pts + ")")
    if not parts:
        return None
    return ("MULTILINESTRING(" + ", ".join(parts) + ")") if len(parts) > 1 \
        else ("LINESTRING" + parts[0])


def line_length_miles(paths):
    if not paths:
        return None
    total = 0.0
    for path in paths:
        for i in range(len(path) - 1):
            lng1, lat1 = path[i][0], path[i][1]
            lng2, lat2 = path[i + 1][0], path[i + 1][1]
            dlat = math.radians(lat2 - lat1); dlng = math.radians(lng2 - lng1)
            a = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) *
                 math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
            total += 3959.0 * 2 * math.asin(min(1, math.sqrt(a)))
    return round(total, 3)


VCAP = {69: 72, 115: 140, 138: 200, 161: 270, 230: 420, 345: 1230, 500: 2600, 765: 5500}


def transform(feat, data_source_id):
    a = feat.get("attributes", {}); g = feat.get("geometry", {})
    eia_id = a.get("ID")
    voltage = safe_float(a.get("VOLTAGE"))
    capacity_mw = None
    if voltage:
        closest = min(VCAP, key=lambda v: abs(v - voltage))
        if abs(closest - voltage) <= 15:
            capacity_mw = VCAP[closest]
    hifld_id = None
    if eia_id is not None and str(eia_id).isdigit():
        hifld_id = int(eia_id)
    paths = g.get("paths", [])
    return {
        "source_record_id": f"eia_{eia_id}",
        "hifld_id": hifld_id,
        "voltage_kv": voltage,
        "volt_class": safe_str(a.get("VOLT_CLASS")),
        "owner": safe_str(a.get("OWNER")),
        "status": safe_str(a.get("STATUS")),
        "line_type": safe_str(a.get("TYPE")),
        "sub_1": safe_str(a.get("SUB_1")),
        "sub_2": safe_str(a.get("SUB_2")),
        "length_miles": line_length_miles(paths),
        "capacity_mw": capacity_mw,
        "upgrade_candidate": capacity_mw is not None and 50 <= capacity_mw <= 100,
        "geometry_wkt": paths_to_wkt(paths),
        "data_source_id": data_source_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def ensure_data_source():
    try:
        r = rest("GET", f"grid_data_sources?select=id&name=eq.{SOURCE_NAME}&limit=1")
        rows = json.load(r)
        if rows:
            return rows[0]["id"]
    except urllib.error.HTTPError:
        pass
    try:
        r = rest("POST", "grid_data_sources",
                 {"name": SOURCE_NAME, "url": FS,
                  "description": "EIA U.S. Energy Atlas — Electric Power Transmission Lines"},
                 {"Prefer": "return=representation"})
        return json.load(r)[0]["id"]
    except urllib.error.HTTPError as e:
        print("  (could not create data_source:", e.code, e.read()[:120], ")")
        return None


def fetch(where="1=1", bbox=None, limit=None):
    """Paginate features via resultOffset. bbox = (xmin,ymin,xmax,ymax)."""
    out, offset = [], 0
    while True:
        params = {"where": where, "outFields": "*", "f": "geojson",
                  "resultOffset": offset, "resultRecordCount": PAGE,
                  "outSR": 4326}
        if bbox:
            params.update({"geometry": ",".join(map(str, bbox)),
                           "geometryType": "esriGeometryEnvelope",
                           "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"})
        # geojson lacks Esri "paths"; use f=json to keep paths geometry
        params["f"] = "json"
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


def main():
    args = sys.argv[1:]
    test = "--test" in args or not args
    full = "--full" in args
    reviewed = "--i-reviewed-this" in args
    limit = None
    bbox = None
    for i, a in enumerate(args):
        if a == "--limit":
            limit = int(args[i + 1])
        if a == "--bbox":
            bbox = tuple(float(x) for x in args[i + 1].split(","))

    print("EIA Transmission ingest →", FS)

    if test:
        print("\n[--test] fetching 5 features, printing field mapping, NO writes\n")
        feats = fetch(limit=5)
        for f in feats:
            rec = transform(f, None)
            print(" EIA ID", f["attributes"].get("ID"),
                  "→ src_id", rec["source_record_id"],
                  "| V", rec["voltage_kv"], "| owner", rec["owner"],
                  "| type", rec["line_type"], "| miles", rec["length_miles"])
        print("\nMapped keys:", sorted(transform(feats[0], None).keys()))
        print("OK — confirmed field mapping. Run --full --i-reviewed-this for national load.")
        return

    if full and not reviewed:
        print("\nREFUSING --full without --i-reviewed-this. A national load extends the")
        print("transmission layer the LIVE site reads. Re-run with --i-reviewed-this once")
        print("you've reviewed the field mapping above. (Upsert is additive on eia_* ids.)")
        return

    data_source_id = ensure_data_source()
    print("\nFetching features…", "bbox=" + str(bbox) if bbox else "national")
    feats = fetch(bbox=bbox, limit=limit)
    print(f"  {len(feats)} features fetched")
    recs = [transform(f, data_source_id) for f in feats if f["attributes"].get("ID") is not None]

    upserted = 0
    for i in range(0, len(recs), 500):
        batch = recs[i:i + 500]
        try:
            rest("POST", "grid_transmission_lines", batch,
                 {"Prefer": "resolution=merge-duplicates,return=minimal"})
            upserted += len(batch)
        except urllib.error.HTTPError as e:
            print(f"  batch err @ {i}: {e.code} {e.read()[:160]}")
        if upserted % 5000 < 500:
            print(f"  …upserted ~{upserted}")
    print(f"Done. Upserted {upserted} EIA transmission lines (additive, eia_* ids).")

    if data_source_id:
        try:
            rest("PATCH", f"grid_data_sources?name=eq.{SOURCE_NAME}",
                 {"last_import": datetime.now(timezone.utc).isoformat(),
                  "record_count": upserted}, {"Prefer": "return=minimal"})
        except urllib.error.HTTPError:
            pass


if __name__ == "__main__":
    main()

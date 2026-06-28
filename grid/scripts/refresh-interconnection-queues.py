#!/usr/bin/env python3
"""
refresh-interconnection-queues.py — refresh grid_queue_summary (per-ISO / per-POI
interconnection-queue rollups) from the best FREE source available.

Source priority:
  1. GridStatus.io API  — if GRIDSTATUS_API_KEY is in env. Pulls each ISO's
     interconnection-queue dataset, aggregates to ISO-level + the existing POI
     rows, and UPSERTS on (iso, poi_name). AUTOMATABLE.
  2. LBNL "Queued Up" — the comprehensive national queue dataset. Published as
     a LARGE multi-tab XLSX once or twice a year. There is NO stable API; the
     file must be downloaded + parsed manually. This script FLAGS that as a
     manual step (does not fabricate data).

id-STABILITY / SAFETY (the live site reads grid_queue_summary):
  * grid_queue_summary has a UNIQUE(iso, poi_name). All writes are UPSERT on
    that key (Prefer: resolution=merge-duplicates) — existing rows are updated
    IN PLACE (ids preserved), new POIs are inserted. NO wipe, NO regenerate.
  * Aggregate rows use poi_name="<STATE>_aggregate" to match existing rows
    (e.g. 'TX_aggregate', 'CA_aggregate').

RUN:
  python3 scripts/refresh-interconnection-queues.py            # auto (GridStatus if key)
  python3 scripts/refresh-interconnection-queues.py --dry      # no writes
  GRIDSTATUS_API_KEY=... python3 scripts/refresh-interconnection-queues.py

GridStatus dataset ids (interconnection queues), one per ISO:
  caiso_interconnection_queue, ercot_interconnection_queue,
  pjm_interconnection_queue, miso_interconnection_queue,
  spp_interconnection_queue, nyiso_interconnection_queue,
  isone_interconnection_queue
  API docs: https://docs.gridstatus.io/  (GET https://api.gridstatus.io/v1/datasets/{id}/query)
"""
import json, os, sys, time, ssl, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

DRY = "--dry" in sys.argv
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
SOURCE_NAME = "interconnection_queues"

GRIDSTATUS_DATASETS = {
    "CAISO": "caiso_interconnection_queue",
    "ERCOT": "ercot_interconnection_queue",
    "PJM":   "pjm_interconnection_queue",
    "MISO":  "miso_interconnection_queue",
    "SPP":   "spp_interconnection_queue",
    "NYISO": "nyiso_interconnection_queue",
    "ISO-NE": "isone_interconnection_queue",
}
ISO_STATE = {  # for the "<STATE>_aggregate" poi_name on single-state ISOs
    "ERCOT": "TX", "CAISO": "CA", "NYISO": "NY",
}


def env(key, files=None):
    files = files or ["/Users/kennyhyder/Desktop/hyder-media/grid/.env.local",
                      "/Users/kennyhyder/Desktop/hyder-media/.env.local"]
    if key in os.environ:
        return os.environ[key]
    for p in files:
        try:
            for line in open(p):
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return None


URL = env("SUPABASE_URL"); KEY = env("SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def rest(method, path, body=None, extra=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        URL + "/rest/v1/" + path, data=data, method=method,
        headers={**H, **(extra or {}), "Content-Type": "application/json"})
    return urllib.request.urlopen(req)


def gridstatus_rows(api_key, dataset):
    """Pull queue rows from GridStatus for one ISO dataset (paginated)."""
    rows, cursor = [], None
    base = f"https://api.gridstatus.io/v1/datasets/{dataset}/query"
    while True:
        params = {"api_key": api_key, "limit": 10000}
        if cursor:
            params["cursor"] = cursor
        req = urllib.request.Request(base + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "gridcensus/1.0"})
        data = json.load(urllib.request.urlopen(req, context=CTX, timeout=120))
        page = data.get("data", [])
        rows.extend(page)
        cursor = (data.get("meta") or {}).get("cursor") or data.get("cursor")
        if not cursor or not page:
            break
        time.sleep(0.3)
    return rows


def aggregate(iso, rows):
    """Roll up raw queue rows into a single <STATE>_aggregate summary row.
    Field names vary by ISO in GridStatus; probe a few common ones."""
    def num(r, *keys):
        for k in keys:
            v = r.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return None

    total_mw = 0.0
    n = 0
    solar = wind = storage = 0
    oldest = None
    for r in rows:
        mw = num(r, "capacity_mw", "Capacity (MW)", "mw", "summer_capacity_mw")
        if mw:
            total_mw += mw
        n += 1
        fuel = str(r.get("fuel") or r.get("resource_type") or
                   r.get("Generation Type") or r.get("type") or "").lower()
        if "solar" in fuel:
            solar += 1
        if "wind" in fuel:
            wind += 1
        if "storage" in fuel or "battery" in fuel:
            storage += 1
        yr = r.get("queue_year") or r.get("Queue Year")
        try:
            yr = int(str(yr)[:4]) if yr else None
        except ValueError:
            yr = None
        if yr and (oldest is None or yr < oldest):
            oldest = yr

    state = ISO_STATE.get(iso, iso)
    return {
        "iso": iso,
        "poi_name": f"{state}_aggregate",
        "state": ISO_STATE.get(iso),
        "total_projects": n,
        "total_capacity_mw": round(total_mw, 2),
        "solar_projects": solar,
        "wind_projects": wind,
        "storage_projects": storage,
        "oldest_project_year": oldest,
    }


def ensure_data_source():
    try:
        rows = json.load(rest("GET", f"grid_data_sources?select=id&name=eq.{SOURCE_NAME}&limit=1"))
        if rows:
            return rows[0]["id"]
    except urllib.error.HTTPError:
        pass
    try:
        rest("POST", "grid_data_sources",
             {"name": SOURCE_NAME, "url": "https://api.gridstatus.io/",
              "description": "ISO interconnection-queue rollups (GridStatus / LBNL)"},
             {"Prefer": "return=minimal"})
    except urllib.error.HTTPError:
        pass


def main():
    api_key = env("GRIDSTATUS_API_KEY")
    if not api_key:
        print("=" * 72)
        print("NO GRIDSTATUS_API_KEY in env — cannot auto-refresh.")
        print("MANUAL FALLBACK (LBNL 'Queued Up'):")
        print("  1. Download the latest LBNL Queued Up XLSX:")
        print("     https://emp.lbl.gov/queues  (multi-tab workbook, ~annual)")
        print("  2. Parse the per-ISO active-queue tabs (xlsx is available in")
        print("     repo deps) and aggregate to <STATE>_aggregate rows.")
        print("  3. UPSERT grid_queue_summary on (iso, poi_name).")
        print("  This script does NOT fabricate queue data. Re-run with a")
        print("  GRIDSTATUS_API_KEY set to automate, or wire the LBNL parser.")
        print("=" * 72)
        sys.exit(2)

    ensure_data_source()
    summaries = []
    for iso, dataset in GRIDSTATUS_DATASETS.items():
        try:
            print(f"Fetching {iso} ({dataset})…", flush=True)
            rows = gridstatus_rows(api_key, dataset)
            print(f"  {len(rows)} queue rows")
            if rows:
                summaries.append(aggregate(iso, rows))
        except urllib.error.HTTPError as e:
            print(f"  {iso} err: {e.code} {e.read()[:160]}")

    if DRY:
        print("\nDRY — would upsert these rollups:")
        for s in summaries:
            print(f"  {s['iso']:7} {s['poi_name']:14} proj={s['total_projects']} "
                  f"mw={s['total_capacity_mw']}")
        return

    up = 0
    for s in summaries:
        try:
            rest("POST", "grid_queue_summary", [s],
                 {"Prefer": "resolution=merge-duplicates,return=minimal"})
            up += 1
        except urllib.error.HTTPError as e:
            print(f"  upsert err {s['iso']}: {e.code} {e.read()[:160]}")
    print(f"Done. Upserted {up} ISO-aggregate queue rows (id-stable on iso,poi_name).")
    try:
        rest("PATCH", f"grid_data_sources?name=eq.{SOURCE_NAME}",
             {"last_import": datetime.now(timezone.utc).isoformat(), "record_count": up},
             {"Prefer": "return=minimal"})
    except urllib.error.HTTPError:
        pass


if __name__ == "__main__":
    main()

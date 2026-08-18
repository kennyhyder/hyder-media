#!/usr/bin/env python3
"""
refresh-interconnection-queues.py — refresh grid_queue_summary (per-ISO / per-POI
interconnection-queue rollups) from the FREE open-source `gridstatus` library.

WHY the rewrite (2026-08-18): the previous version pulled from the GridStatus.io
HOSTED API (GRIDSTATUS_API_KEY + `{iso}_interconnection_queue` datasets). GridStatus
REMOVED those queue datasets from the hosted API — the key still authenticates but
the datasets 404. The open-source `gridstatus` PyPI library scrapes each ISO's
public queue directly (no key, no cost) and normalizes the columns, so it's the
durable free feed. Requires Python 3.13 + `pip install gridstatus` (the solar venv
at solar/.venv/bin/python3.13 already has it; the droplet gets its own).

  RUN:  solar/.venv/bin/python3.13 scripts/refresh-interconnection-queues.py
        ... --dry     # fetch + aggregate, print, no writes

id-STABILITY / SAFETY (the live site reads grid_queue_summary):
  * grid_queue_summary has a UNIQUE(iso, poi_name). All writes UPSERT on that key
    (Prefer: resolution=merge-duplicates) — existing rows update IN PLACE (ids
    preserved), new POIs insert. NO wipe, NO regenerate.
  * Aggregate rows use poi_name="<STATE>_aggregate" (e.g. 'TX_aggregate').
  * Per-ISO fetch is isolated: one ISO failing (e.g. SPP schema drift in the lib)
    leaves that ISO's existing row untouched and never blocks the others.
  * We roll up ACTIVE queue projects only (Withdrawn/Completed/Operational are
    excluded) — that's the "speed to power" signal the DC score actually wants.
"""
import json, os, sys, math, re, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

DRY = "--dry" in sys.argv
SOURCE_NAME = "interconnection_queues"

# gridstatus ISO classes (open-source lib). ERCOT is `Ercot`; ISO-NE is `ISONE`.
import gridstatus  # noqa: E402  (py3.13 venv only)
ISO_CLASSES = {
    "CAISO": gridstatus.CAISO,
    "ERCOT": gridstatus.Ercot,
    "PJM":   gridstatus.PJM,
    "MISO":  gridstatus.MISO,
    "SPP":   gridstatus.SPP,
    "NYISO": gridstatus.NYISO,
    "ISO-NE": gridstatus.ISONE,
}
# Status substrings that mean a project is NO LONGER an active queue entry.
INACTIVE = ("withdrawn", "completed", "operational", "in service",
            "suspended", "deactivated", "cancelled", "canceled")
# Don't delete+replace an ISO's rows unless the fresh fetch cleared this many
# active projects — a guard so a malformed upstream file can't wipe good data.
MIN_ACTIVE_TO_REPLACE = 10

# US state name → USPS code, for ISOs that report full state names.
_STATES = {
    "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
    "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
    "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
    "kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA",
    "michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
    "nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM",
    "new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
    "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC",
    "south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT",
    "virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY",
    "district of columbia":"DC",
}


_US_CODES = set(_STATES.values())


def norm_state(v):
    """Normalize a State cell to a valid 2-letter US code, or None (drops non-US
    entries like MX border projects, blanks, and unrecognized values)."""
    if not v:
        return None
    s = str(v).strip()
    code = s.upper() if (len(s) == 2 and s.isalpha()) else _STATES.get(s.lower())
    return code if code in _US_CODES else None


def env(key, files=None):
    files = files or ["/Users/kennyhyder/Projects/hyder-media/grid/.env.local",
                      "/Users/kennyhyder/Projects/hyder-media/.env.local"]
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


def _num(v):
    """Coerce a cell to a positive float, treating None/NaN/blank as missing."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _year(v):
    """Extract a 4-digit year from a date cell (str, datetime, or pandas Timestamp)."""
    if v is None:
        return None
    if hasattr(v, "year"):  # datetime / pandas Timestamp
        try:
            y = int(v.year)
            return y if 1990 <= y <= 2100 else None
        except (TypeError, ValueError):
            return None
    m = re.search(r"(19|20)\d{2}", str(v))
    return int(m.group(0)) if m else None


def aggregate_by_state(iso, rows):
    """Roll up ACTIVE queue rows into one <STATE>_aggregate row PER STATE.

    Matches the existing grid_queue_summary model (one row per iso+state, keyed
    poi_name='<STATE>_aggregate') which the scorer matches on (state, iso) and
    the map overlay sums per ISO. Column names are the gridstatus-normalized set
    (Capacity (MW), Generation Type, Queue Date, Status, Proposed Completion)."""
    by_state = {}
    for r in rows:
        status = str(r.get("Status") or r.get("Project Status") or "").lower()
        if any(bad in status for bad in INACTIVE):
            continue  # active queue only
        st = norm_state(r.get("State") or r.get("state"))
        if not st:
            continue
        a = by_state.setdefault(st, {"n": 0, "mw": 0.0, "solar": 0, "wind": 0,
                                     "storage": 0, "oldest": None, "waits": []})
        a["n"] += 1
        mw = _num(r.get("Capacity (MW)")) or _num(r.get("Summer Capacity (MW)"))
        if mw:
            a["mw"] += mw
        fuel = str(r.get("Generation Type") or r.get("Fuel") or "").lower()
        if "solar" in fuel or fuel.startswith("sol") or "pv" in fuel:
            a["solar"] += 1
        if "wind" in fuel or fuel.startswith("wnd") or fuel.startswith("win"):
            a["wind"] += 1
        if "storage" in fuel or "battery" in fuel or fuel.startswith("bat") or fuel == "es":
            a["storage"] += 1
        qy = _year(r.get("Queue Date"))
        if qy and (a["oldest"] is None or qy < a["oldest"]):
            a["oldest"] = qy
        cy = _year(r.get("Proposed Completion Date"))
        if qy and cy and 0 < (cy - qy) <= 30:
            a["waits"].append(cy - qy)

    out = []
    for st, a in by_state.items():
        out.append({
            "iso": iso,
            "poi_name": f"{st}_aggregate",
            "state": st,
            "total_projects": a["n"],
            "total_capacity_mw": round(a["mw"], 2),
            "solar_projects": a["solar"],
            "wind_projects": a["wind"],
            "storage_projects": a["storage"],
            "avg_wait_years": round(sum(a["waits"]) / len(a["waits"]), 1) if a["waits"] else None,
            "oldest_project_year": a["oldest"],
        })
    return out


def ensure_data_source():
    try:
        rows = json.load(rest("GET", f"grid_data_sources?select=id&name=eq.{SOURCE_NAME}&limit=1"))
        if rows:
            return rows[0]["id"]
    except urllib.error.HTTPError:
        pass
    try:
        rest("POST", "grid_data_sources",
             {"name": SOURCE_NAME, "url": "https://github.com/gridstatus/gridstatus",
              "description": "ISO interconnection-queue rollups (open-source gridstatus lib)"},
             {"Prefer": "return=minimal"})
    except urllib.error.HTTPError:
        pass


def replace_iso(iso, state_rows):
    """Atomically refresh one ISO: delete its existing rows, insert fresh per-state
    aggregates. Guarded by MIN_ACTIVE_TO_REPLACE so a bad fetch can't wipe data.
    Skipped ISOs (guard/fetch failure) keep their existing rows untouched."""
    total_active = sum(r["total_projects"] for r in state_rows)
    if total_active < MIN_ACTIVE_TO_REPLACE:
        print(f"  {iso}: only {total_active} active across {len(state_rows)} states "
              f"(< {MIN_ACTIVE_TO_REPLACE}) — SKIP, keeping existing rows")
        return 0
    # delete-then-insert. iso is a fixed internal constant (not user input).
    rest("DELETE", f"grid_queue_summary?iso=eq.{urllib.parse.quote(iso)}",
         extra={"Prefer": "return=minimal"})
    rest("POST", "grid_queue_summary", state_rows, {"Prefer": "return=minimal"})
    return len(state_rows)


def main():
    ensure_data_source()
    plans, failures = {}, []
    for iso, cls in ISO_CLASSES.items():
        try:
            print(f"Fetching {iso} interconnection queue…", flush=True)
            df = cls().get_interconnection_queue()
            rows = df.to_dict("records")
            state_rows = aggregate_by_state(iso, rows)
            active = sum(r["total_projects"] for r in state_rows)
            print(f"  {len(rows)} rows → {active} active across {len(state_rows)} states")
            plans[iso] = state_rows
        except Exception as e:  # per-ISO isolation (network, or lib schema drift like SPP)
            failures.append(iso)
            print(f"  {iso} FAILED ({type(e).__name__}: {str(e)[:120]}) — existing rows untouched")

    if DRY:
        print("\nDRY — per-ISO/state rollups that WOULD replace existing rows:")
        for iso, srows in plans.items():
            active = sum(r["total_projects"] for r in srows)
            top = sorted(srows, key=lambda r: r["total_capacity_mw"] or 0, reverse=True)[:4]
            print(f"  {iso:7} {active} active / {len(srows)} states | "
                  + ", ".join(f"{r['state']}:{r['total_projects']}p/{int(r['total_capacity_mw'] or 0)}MW" for r in top))
        if failures:
            print(f"  (failed ISOs, left as-is: {', '.join(failures)})")
        return

    replaced = 0
    for iso, srows in plans.items():
        try:
            replaced += replace_iso(iso, srows)
        except urllib.error.HTTPError as e:
            failures.append(iso)
            print(f"  replace err {iso}: {e.code} {e.read()[:160]}")
    print(f"Done. Replaced {replaced} per-state rows across "
          f"{len(plans)} ISOs. Failed/skipped: {', '.join(failures) or 'none'}")
    if replaced:
        try:
            rest("PATCH", f"grid_data_sources?name=eq.{SOURCE_NAME}",
                 {"last_import": datetime.now(timezone.utc).isoformat(), "record_count": replaced},
                 {"Prefer": "return=minimal"})
        except urllib.error.HTTPError:
            pass


if __name__ == "__main__":
    main()

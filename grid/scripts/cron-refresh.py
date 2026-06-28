#!/usr/bin/env python3
"""
cron-refresh.py — Tier-A automatable data-freshness runner for GridCensus.

Runs ONLY the refreshes that are fully automatable from an API/REST source (no
manual download, no token gating, no multi-GB file), in dependency order, and
stamps each table's freshness via grid_data_sources.last_import / record_count.

This is the scheduled-pipeline scaffolding: point a Vercel cron (light jobs) or
the droplet (heavy jobs >300s) at this with the matching --tier / --only flags.
See scripts/REFRESH-RUNBOOK.md for per-source cadence + where each runs.

TIER-A (automatable, in this runner):
  fiber_route_distance  backfill-fiber-route-distance.py   (additive, id-stable)
  interconnection_queues refresh-interconnection-queues.py (GridStatus if key)
  peeringdb             ingest-peeringdb.py                 (IXP facilities, weekly)
  # EIA repoints are NOT here — they are reviewed manual national loads (see
  # ingest-eia-transmission.py / ingest-eia-substations.py docstrings). Add the
  # --full --i-reviewed-this run to this list only after a human review.

NOT in this runner (manual / gated — see REFRESH-RUNBOOK.md "manual" section):
  NREL DLR (19 GB HDF5), eGRID, LBNL Queued Up XLSX, FCC BDC bulk CSVs,
  national EIA transmission/substation re-ingest.

SAFETY: every job invoked here is itself ADDITIVE / id-stable (NULL-only
backfills or upserts on a natural key). cron-refresh never wipes. It refuses
to invoke an EIA --full load unless you pass --allow-eia-full (off by default).

RUN:
  python3 scripts/cron-refresh.py --check          # list jobs + last freshness
  python3 scripts/cron-refresh.py                  # run all Tier-A jobs
  python3 scripts/cron-refresh.py --only fiber_route_distance
  python3 scripts/cron-refresh.py --dry            # pass --dry to children where supported
"""
import json, os, sys, subprocess, time, urllib.request, urllib.error
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GRID_DIR = os.path.dirname(SCRIPT_DIR)

# job key -> (script + args, freshness data_source name, supports --dry, timeout_s)
TIER_A = [
    ("fiber_route_distance",
     ["backfill-fiber-route-distance.py"], "fiber_route_distance", True, 3600),
    ("peeringdb",
     ["ingest-peeringdb.py"], "peeringdb", False, 1200),
    ("interconnection_queues",
     ["refresh-interconnection-queues.py"], "interconnection_queues", True, 1800),
]


def env(key):
    if key in os.environ:
        return os.environ[key]
    for p in [os.path.join(GRID_DIR, ".env.local"),
              os.path.join(GRID_DIR, "..", ".env.local")]:
        try:
            for line in open(p):
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return None


URL = env("SUPABASE_URL"); KEY = env("SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY} if KEY else {}


def freshness(name):
    try:
        req = urllib.request.Request(
            URL + f"/rest/v1/grid_data_sources?select=last_import,record_count&name=eq.{name}&limit=1",
            headers=H)
        rows = json.load(urllib.request.urlopen(req))
        return rows[0] if rows else None
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError):
        return None


def stamp(name, count=None):
    """Best-effort freshness stamp (children also stamp their own source; this
    guarantees a timestamp even for children that don't)."""
    body = {"last_import": datetime.now(timezone.utc).isoformat()}
    if count is not None:
        body["record_count"] = count
    try:
        req = urllib.request.Request(
            URL + f"/rest/v1/grid_data_sources?name=eq.{name}",
            data=json.dumps(body).encode(), method="PATCH",
            headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"})
        urllib.request.urlopen(req)
    except (urllib.error.HTTPError, urllib.error.URLError):
        pass


def run_job(key, argv, timeout_s, dry, supports_dry):
    script = os.path.join(SCRIPT_DIR, argv[0])
    if not os.path.exists(script):
        print(f"  SKIP {key}: {argv[0]} not found")
        return None
    cmd = [sys.executable, "-u", script] + argv[1:]
    if dry and supports_dry:
        cmd.append("--dry")
    print(f"\n{'='*60}\nRUN {key}: {' '.join(argv)}{'  (--dry)' if dry and supports_dry else ''}\n{'='*60}", flush=True)
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=GRID_DIR, timeout=timeout_s)
        ok = r.returncode == 0
        # queue script exits 2 when no GridStatus key — that's an expected
        # "manual fallback" state, not a hard failure.
        if r.returncode == 2 and key == "interconnection_queues":
            ok = None
        print(f"  {'OK' if ok else ('MANUAL' if ok is None else f'FAILED (exit {r.returncode})')}"
              f" in {time.time()-t0:.0f}s")
        return ok
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT after {timeout_s}s")
        return False


def main():
    args = sys.argv[1:]
    check = "--check" in args
    dry = "--dry" in args
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1]

    print("GridCensus Tier-A refresh runner")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")

    if check:
        print("\nJob                      last_import                       count")
        for key, _, src, _, _ in TIER_A:
            f = freshness(src) or {}
            print(f"  {key:22} {str(f.get('last_import')):33} {f.get('record_count')}")
        print("\n(Tier-A only. NREL DLR / eGRID / LBNL XLSX / FCC BDC / EIA national")
        print(" re-ingest are manual — see scripts/REFRESH-RUNBOOK.md.)")
        return

    results = {}
    for key, argv, src, supports_dry, timeout_s in TIER_A:
        if only and key != only:
            continue
        ok = run_job(key, argv, timeout_s, dry, supports_dry)
        results[key] = ok
        if ok and not dry:
            stamp(src)  # ensure a freshness timestamp even if child didn't

    print(f"\n{'='*60}\nSummary:")
    for k, v in results.items():
        print(f"  {k:22} {'OK' if v else ('MANUAL/SKIP' if v is None else 'FAILED')}")
    failed = [k for k, v in results.items() if v is False]
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

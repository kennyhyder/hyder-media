#!/usr/bin/env python3
"""Precompute the ERCOT grid-congestion / captive-power aggregate.

Phase 2 (captive power). Aggregates grid_ercot_constraints (SCED binding
constraints, ~18k interval rows) into the distinct transmission bottlenecks,
ranked by severity (how often they bind x how expensive relief is). A site near
a persistently-binding, high-shadow-price constraint sits at a grid pinch point
where generation is curtailed / trapped — meaning underutilized ("captive")
power a co-located datacenter could absorb, often with a faster interconnection
than a greenfield build.

Writes src/data/ercot-congestion.json (committed, precomputed like rollups —
PostgREST aggregates are disabled on this project, so we aggregate here). Rerun
after an ERCOT SCED refresh:  python3 scripts/build-ercot-congestion.py
"""
import os, json, sys, urllib.request, urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
except Exception:
    pass

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ""
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "ercot-congestion.json")


def fetch_all():
    rows, off = [], 0
    while True:
        qs = urllib.parse.urlencode({
            "select": "constraint_name,from_station,to_station,from_station_kv,shadow_price,value_mw,limit_mw",
            "shadow_price": "gt.0", "limit": 1000, "offset": off, "order": "id",
        })
        url = f"{SUPABASE_URL}/rest/v1/grid_ercot_constraints?{qs}"
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            batch = json.load(r)
        rows += batch
        if len(batch) < 1000:
            break
        off += 1000
    return rows


def main():
    rows = fetch_all()
    agg = defaultdict(lambda: {"n": 0, "max_sp": 0.0, "sum_sp": 0.0, "kv": 0,
                                "fr": None, "to": None})
    for r in rows:
        k = r.get("constraint_name") or "?"
        a = agg[k]
        a["n"] += 1
        sp = float(r.get("shadow_price") or 0)
        a["max_sp"] = max(a["max_sp"], sp)
        a["sum_sp"] += sp
        if r.get("from_station"):
            a["fr"] = r["from_station"]
            a["to"] = r.get("to_station")
            a["kv"] = int(float(r.get("from_station_kv") or 0)) or a["kv"]

    items = []
    for name, a in agg.items():
        items.append({
            "constraint": name,
            "from_station": a["fr"],
            "to_station": a["to"],
            "kv": a["kv"] or None,
            "binding_intervals": a["n"],
            "max_shadow_price": round(a["max_sp"], 0),
            "avg_shadow_price": round(a["sum_sp"] / max(1, a["n"]), 0),
            # severity = how often it binds x how expensive relief gets
            "severity": round(a["n"] * a["max_sp"] / 1000.0, 1),
        })
    items.sort(key=lambda x: x["severity"], reverse=True)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "iso": "ERCOT",
        "intervals": len(rows),
        "distinct_constraints": len(items),
        "constraints": items[:50],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {OUT}: {len(items)} constraints from {len(rows)} intervals")
    print("Top 3:", [c["constraint"] for c in items[:3]])


if __name__ == "__main__":
    main()

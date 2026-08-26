#!/usr/bin/env python3
"""Build the frontier AI datacenter pipeline dataset (Phase 2 — DC pipeline v2).

Ingests Epoch AI's Frontier Data Centers hub (CC-BY, direct CSV) — the large AI
campuses under construction / operating — cleans it, geocodes the addresses, and
writes src/data/frontier-dc.json (committed, precomputed). This is Jon's
"current DCs in the pipeline + who's the off-taker" ask: the Epoch "Users" field
names the tenant/off-taker (e.g. Colossus 2 -> Anthropic, Cursor), which is the
single hardest piece to source and is usually non-public.

Source: https://epoch.ai/data/ai-data-centers  (CC-BY 4.0 — attribute Epoch AI)
Rerun:  python3 scripts/build-frontier-dc.py
"""
import os, re, csv, io, json, time, urllib.request, urllib.parse
from datetime import datetime, timezone

CSV_URL = "https://epoch.ai/data/data_centers/data_centers.csv"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "frontier-dc.json")
UA = {"User-Agent": "GridCensus/1.0 (+https://gridcensus.com; kenny@hyder.me)"}


def clean_tags(s):
    """Strip Epoch confidence tags (#confident / #likely / #speculative)."""
    if not s:
        return ""
    return re.sub(r"#\w+", "", s).strip()


def split_list(s):
    return [clean_tags(x).strip() for x in (s or "").split(",") if clean_tags(x).strip()]


def first_url(s):
    m = re.search(r"https?://[^\s\)\]]+", s or "")
    return m.group(0) if m else None


def geocode(addr):
    if not addr:
        return None, None
    # Census (full street addresses)
    try:
        url = (
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"
            + urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current", "format": "json"})
        )
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=10) as r:
            j = json.load(r)
        m = (j.get("result", {}).get("addressMatches") or [None])[0]
        if m and m.get("coordinates"):
            return round(m["coordinates"]["y"], 6), round(m["coordinates"]["x"], 6)
    except Exception:
        pass
    # Nominatim fallback (place-ish addresses), polite
    try:
        time.sleep(1.1)
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": addr, "format": "json", "limit": 1, "countrycodes": "us"}
        )
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=10) as r:
            j = json.load(r)
        if isinstance(j, list) and j:
            return round(float(j[0]["lat"]), 6), round(float(j[0]["lon"]), 6)
    except Exception:
        pass
    return None, None


def main():
    with urllib.request.urlopen(urllib.request.Request(CSV_URL, headers=UA), timeout=30) as r:
        text = r.read().decode("utf-8")
    rows = [x for x in csv.DictReader(io.StringIO(text)) if (x.get("Country") or "").strip() == "United States"]

    out = []
    for x in rows:
        addr = (x.get("Address") or "").strip()
        try:
            mw = float(x.get("Current power (MW)") or 0) or None
        except ValueError:
            mw = None
        try:
            capex = float(x.get("Current total capital cost (2025 USD billions)") or 0) or None
        except ValueError:
            capex = None
        lat, lng = geocode(addr) if addr else (None, None)
        out.append({
            "name": (x.get("Name") or "").strip(),
            "owner": clean_tags(x.get("Owner")),
            "off_takers": split_list(x.get("Users")),
            "power_mw": mw,
            "capex_b": capex,
            "chips": clean_tags(x.get("Current chip types")) or None,
            "address": addr or None,
            "lat": lat,
            "lng": lng,
            "source": first_url(x.get("Selected Sources")),
        })
        print(f"  {out[-1]['name'][:30]:30} {str(mw):>6} MW  {'geo' if lat else 'NO-GEO':6}  off:{','.join(out[-1]['off_takers'][:2])}")

    out.sort(key=lambda d: d["power_mw"] or 0, reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Epoch AI — Frontier Data Centers (CC-BY 4.0)",
        "source_url": "https://epoch.ai/data/ai-data-centers",
        "count": len(out),
        "geocoded": sum(1 for d in out if d["lat"] is not None),
        "projects": out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nWrote {OUT}: {len(out)} US projects, {payload['geocoded']} geocoded")


if __name__ == "__main__":
    main()

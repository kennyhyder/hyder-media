#!/usr/bin/env python3
"""
Data Source Health Check & Update Monitor

Checks all solar data sources for freshness, availability, and update status.
Run regularly (weekly/monthly) to ensure the database stays current.

Checks:
  1. Database record counts vs expected (detect data loss)
  2. Source URL availability (detect broken links)
  3. Last import date vs update frequency (flag stale data)
  4. File freshness for local data files
  5. New data availability at source URLs

Usage:
  python3 -u scripts/check-data-sources.py              # Full check
  python3 -u scripts/check-data-sources.py --json        # Output JSON report
  python3 -u scripts/check-data-sources.py --source eia  # Check specific source
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data"

# ============================================================================
# Complete Data Source Registry
# ============================================================================
# This is the canonical list of ALL data sources, their update schedules,
# scripts, and expected record counts. Keep this up to date!

DATA_SOURCES = [
    # ---- PRIMARY INGESTION SOURCES ----
    {
        "name": "uspvdb",
        "label": "USGS USPVDB",
        "description": "Utility-scale PV database (>=1 MW)",
        "url": "https://eerscmap.usgs.gov/uspvdb/assets/data/uspvdbGeoJSON.zip",
        "script": "ingest-uspvdb.ts",
        "run_cmd": "npx ts-node scripts/ingest-uspvdb.ts",
        "format": "GeoJSON ZIP",
        "update_frequency": "quarterly",
        "expected_min_records": 5000,
        "data_dir": "uspvdb_extract",
        "prefix": "uspvdb_",
        "notes": "Federal census of utility-scale solar. Exact coords, install year.",
    },
    {
        "name": "eia860",
        "label": "EIA-860 Annual",
        "description": "Annual electric generator census",
        "url": "https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip",
        "script": "ingest-eia860.py",
        "run_cmd": "python3 -u scripts/ingest-eia860.py",
        "format": "Excel ZIP",
        "update_frequency": "annual",
        "expected_min_records": 7000,
        "data_dir": "eia860_2024",
        "prefix": "eia860_",
        "notes": "Mandatory federal census. Owner, operator, capacity, location. Released ~September.",
    },
    {
        "name": "eia860m",
        "label": "EIA-860M Monthly",
        "description": "Monthly generator updates (operating, planned, retired)",
        "url": "https://www.eia.gov/electricity/data/eia860m/",
        "script": "ingest-eia860m.py",
        "run_cmd": "python3 -u scripts/ingest-eia860m.py",
        "format": "Excel",
        "update_frequency": "monthly",
        "expected_min_records": 9000,
        "data_dir": "eia860_2024",
        "prefix": "eia860m_",
        "notes": "Monthly supplement to EIA-860. Tracks new generators, retirements, status changes.",
    },
    {
        "name": "tts",
        "label": "Tracking the Sun (LBNL)",
        "description": "Distributed solar from 27 state utility programs",
        "url": "s3://oedi-data-lake/tracking-the-sun/2024/",
        "script": "ingest-tts.py",
        "run_cmd": "python3 -u scripts/ingest-tts.py",
        "format": "Parquet (S3)",
        "update_frequency": "annual",
        "expected_min_records": 55000,
        "data_dir": "tts_2024",
        "prefix": "tts3_",
        "notes": "Largest free distributed solar dataset. Equipment manufacturer/model. 27 states.",
    },
    {
        "name": "cadg",
        "label": "CA DGStats",
        "description": "California distributed generation interconnections",
        "url": "https://www.californiadgstats.ca.gov/downloads/",
        "script": "ingest-ca-dgstats.py",
        "run_cmd": "python3 -u scripts/ingest-ca-dgstats.py",
        "format": "CSV ZIP",
        "update_frequency": "monthly",
        "expected_min_records": 22000,
        "data_dir": "ca_dgstats",
        "prefix": "cadg_",
        "notes": "Richest equipment data: up to 8 module arrays + 64 inverter arrays per site. Monthly update.",
    },
    {
        "name": "nysun",
        "label": "NY-Sun",
        "description": "New York solar electric programs",
        "url": "https://data.ny.gov/api/views/3x8r-34rs/rows.csv?accessType=DOWNLOAD",
        "script": "ingest-ny-sun.py",
        "run_cmd": "python3 -u scripts/ingest-ny-sun.py",
        "format": "CSV (auto-download)",
        "update_frequency": "monthly",
        "expected_min_records": 7000,
        "data_dir": "ny_sun",
        "prefix": "nysun_",
        "notes": "Auto-downloads from NY Open Data. Monthly update.",
    },
    {
        "name": "ilshines",
        "label": "IL Shines",
        "description": "Illinois solar incentive program",
        "url": "https://cleanenergy.illinois.gov/download-data.html",
        "script": "ingest-il-shines.py",
        "run_cmd": "python3 -u scripts/ingest-il-shines.py",
        "format": "Excel (manual download)",
        "update_frequency": "quarterly",
        "expected_min_records": 3000,
        "data_dir": "il_shines",
        "prefix": "ilshines_",
        "notes": "NO equipment data. Manual download required.",
    },
    {
        "name": "mapts",
        "label": "MA PTS",
        "description": "Massachusetts Production Tracking System",
        "url": "https://www.masscec.com/public-records-requests",
        "script": "ingest-ma-pts.py",
        "run_cmd": "python3 -u scripts/ingest-ma-pts.py",
        "format": "Excel (manual download)",
        "update_frequency": "quarterly",
        "expected_min_records": 4000,
        "data_dir": "ma_pts",
        "prefix": "mapts_",
        "notes": "Header at row 11. Has manufacturer but NO model numbers.",
    },
    {
        "name": "lbnl_utility",
        "label": "LBNL Utility-Scale",
        "description": "Utility-scale solar with cost/developer data",
        "url": "https://eta-publications.lbl.gov/sites/default/files/2025-08/lbnl_ix_queue_data_file_thru2024_v2.xlsx",
        "script": "ingest-lbnl-utility.py",
        "run_cmd": "python3 -u scripts/ingest-lbnl-utility.py",
        "format": "Excel",
        "update_frequency": "annual",
        "expected_min_records": 1500,
        "data_dir": None,
        "prefix": "lbnl_",
        "notes": "Needs browser UA header for download. Has developer names and cost data.",
    },
    {
        "name": "iso_queues",
        "label": "ISO Interconnection Queues",
        "description": "Proposed solar from CAISO, NYISO, ERCOT, ISO-NE via gridstatus",
        "url": "https://opensource.gridstatus.io/en/stable/interconnection_queues.html",
        "script": "ingest-iso-gridstatus.py",
        "run_cmd": ".venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py",
        "format": "gridstatus Python library",
        "update_frequency": "monthly",
        "expected_min_records": 400,
        "data_dir": None,
        "prefix": "iso_",
        "notes": "Requires Python 3.10+ venv with gridstatus. Developer names. PJM/MISO/SPP blocked.",
    },
    {
        "name": "nj_dep",
        "label": "NJ DEP ArcGIS",
        "description": "New Jersey solar from DEP ArcGIS layers",
        "url": "https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer",
        "script": "ingest-nj-dep.py",
        "run_cmd": "python3 -u scripts/ingest-nj-dep.py",
        "format": "ArcGIS REST API",
        "update_frequency": "quarterly",
        "expected_min_records": 1500,
        "data_dir": None,
        "prefix": "njdep_",
        "notes": "3 layers: BTM >1MW (428), Public Facilities with installer names (1,322), Community Solar (100).",
    },

    # ---- ENRICHMENT SOURCES ----
    {
        "name": "cec_modules",
        "label": "CEC Module Database",
        "description": "California Energy Commission approved panel specs",
        "url": "https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Modules.csv",
        "script": "enrich-equipment-specs.py",
        "run_cmd": "python3 -u scripts/enrich-equipment-specs.py",
        "format": "CSV",
        "update_frequency": "monthly",
        "expected_min_records": None,
        "data_dir": "cec_specs",
        "prefix": None,
        "notes": "Updated 3x/month (1st, 11th, 21st). 20,743 panel models. Used for equipment enrichment.",
        "is_enrichment": True,
    },
    {
        "name": "cec_inverters",
        "label": "CEC Inverter Database",
        "description": "California Energy Commission approved inverter specs",
        "url": "https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Inverters.csv",
        "script": "enrich-equipment-specs.py",
        "run_cmd": "python3 -u scripts/enrich-equipment-specs.py",
        "format": "CSV",
        "update_frequency": "monthly",
        "expected_min_records": None,
        "data_dir": "cec_specs",
        "prefix": None,
        "notes": "Updated 3x/month. 2,084 inverter models.",
        "is_enrichment": True,
    },
    {
        "name": "noaa_storms",
        "label": "NOAA Storm Events",
        "description": "Hail and wind events cross-referenced with installations",
        "url": "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/",
        "script": "enrich-noaa-storms.py",
        "run_cmd": "python3 -u scripts/enrich-noaa-storms.py --skip-download --years 2015 2025",
        "format": "CSV.GZ (bulk download)",
        "update_frequency": "quarterly",
        "expected_min_records": None,
        "data_dir": "noaa_storms",
        "prefix": None,
        "notes": "~90 day processing delay. Hail >=1 inch, wind >=58 knots. Creates site_events.",
        "is_enrichment": True,
    },
    {
        "name": "cpsc_recalls",
        "label": "CPSC Equipment Recalls",
        "description": "Solar panel and inverter safety recalls",
        "url": "https://www.cpsc.gov/Recalls",
        "script": "enrich-cpsc-recalls.py",
        "run_cmd": "python3 -u scripts/enrich-cpsc-recalls.py",
        "format": "Hardcoded recall list",
        "update_frequency": "as_needed",
        "expected_min_records": None,
        "data_dir": None,
        "prefix": None,
        "notes": "7 known solar recalls. Check CPSC.gov quarterly for new recalls.",
        "is_enrichment": True,
    },
    {
        "name": "wregis",
        "label": "WREGIS (Western REC Tracking)",
        "description": "Western US generator ownership data",
        "url": "https://www.wecc.org/wecc-document/1136",
        "script": "enrich-wregis.py",
        "run_cmd": "python3 -u scripts/enrich-wregis.py",
        "format": "Excel",
        "update_frequency": "quarterly",
        "expected_min_records": None,
        "data_dir": "wregis",
        "prefix": None,
        "notes": "15,074 solar generators. Owner names for western US (CA, AZ, NV, OR, CO, NM, UT).",
        "is_enrichment": True,
    },
    {
        "name": "egrid",
        "label": "EPA eGRID",
        "description": "EPA power plant emissions and ownership data",
        "url": "https://www.epa.gov/egrid/detailed-data",
        "script": "enrich-egrid.py",
        "run_cmd": "python3 -u scripts/enrich-egrid.py",
        "format": "Excel",
        "update_frequency": "annual",
        "expected_min_records": None,
        "data_dir": "egrid",
        "prefix": None,
        "notes": "Operator + utility/owner names. 5,658 solar plants.",
        "is_enrichment": True,
    },
    {
        "name": "osm",
        "label": "OpenStreetMap Solar Plants",
        "description": "Crowd-sourced solar plant data",
        "url": "https://overpass-api.de/api/interpreter",
        "script": "crossref-osm.py",
        "run_cmd": "python3 -u scripts/fetch-osm-solar.py && python3 -u scripts/crossref-osm.py",
        "format": "Overpass API JSON",
        "update_frequency": "monthly",
        "expected_min_records": None,
        "data_dir": None,
        "prefix": None,
        "notes": "9,753 solar plants. Operator names and plant names.",
        "is_enrichment": True,
    },
    {
        "name": "nominatim",
        "label": "Nominatim Reverse Geocoding",
        "description": "OpenStreetMap reverse geocoding for addresses",
        "url": "https://nominatim.openstreetmap.org/reverse",
        "script": "reverse-geocode.py",
        "run_cmd": "python3 -u scripts/reverse-geocode.py",
        "format": "API (1 req/sec)",
        "update_frequency": "after_ingestion",
        "expected_min_records": None,
        "data_dir": None,
        "prefix": None,
        "notes": "~3.5 hours per run. 33,332 addresses generated so far.",
        "is_enrichment": True,
    },
]


# ============================================================================
# Supabase helpers
# ============================================================================

def supabase_get(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def supabase_count(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            cr = resp.headers.get("content-range", "")
            if "/" in cr:
                return int(cr.split("/")[1])
    except Exception:
        pass
    return None


# ============================================================================
# Checks
# ============================================================================

def check_url(url):
    """Check if a URL is reachable."""
    if url.startswith("s3://"):
        return {"status": "skip", "message": "S3 URL (requires AWS CLI)"}

    try:
        req = urllib.request.Request(url, method="HEAD", headers={
            "User-Agent": "SolarTrack/1.0 (data source health check)",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {"status": "ok", "code": resp.status}
    except urllib.error.HTTPError as e:
        return {"status": "error", "code": e.code, "message": str(e.reason)}
    except Exception as e:
        return {"status": "error", "message": str(e)[:100]}


def check_data_dir(source):
    """Check if local data directory exists and has files."""
    if not source.get("data_dir"):
        return {"status": "skip", "message": "No local data dir"}

    data_path = DATA_DIR / source["data_dir"]
    if not data_path.exists():
        return {"status": "missing", "message": f"Directory not found: {data_path}"}

    files = list(data_path.iterdir())
    if not files:
        return {"status": "empty", "message": "Directory exists but empty"}

    newest = max(f.stat().st_mtime for f in files if f.is_file()) if files else 0
    newest_date = datetime.fromtimestamp(newest).strftime("%Y-%m-%d") if newest else "unknown"
    return {
        "status": "ok",
        "files": len(files),
        "newest_file_date": newest_date,
    }


def check_freshness(source, db_source):
    """Check if data is stale based on update frequency."""
    last_import = db_source.get("last_import") if db_source else None
    if not last_import:
        return {"status": "never_imported", "message": "No last_import date"}

    try:
        last_dt = datetime.fromisoformat(last_import.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return {"status": "unknown", "message": f"Cannot parse: {last_import}"}

    now = datetime.now(last_dt.tzinfo) if last_dt.tzinfo else datetime.now()
    age_days = (now - last_dt).days

    freq = source.get("update_frequency", "unknown")
    thresholds = {
        "monthly": 45,
        "quarterly": 120,
        "annual": 400,
        "as_needed": 365,
        "after_ingestion": 90,
    }
    max_age = thresholds.get(freq, 365)

    if age_days > max_age:
        return {"status": "stale", "age_days": age_days, "threshold": max_age, "frequency": freq}
    return {"status": "fresh", "age_days": age_days, "frequency": freq}


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Check data source health and freshness")
    parser.add_argument("--json", action="store_true", help="Output JSON report")
    parser.add_argument("--source", type=str, help="Check specific source by name")
    args = parser.parse_args()

    print("SolarTrack Data Source Health Check")
    print("=" * 70)
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Sources registered: {len(DATA_SOURCES)}")

    # Load database source records
    db_sources = supabase_get("solar_data_sources", {"select": "*"})
    db_by_name = {s["name"]: s for s in db_sources}

    # Get total counts
    total_installations = supabase_count("solar_installations", {"select": "id"})
    total_equipment = supabase_count("solar_equipment", {"select": "id"})
    total_events = supabase_count("solar_site_events", {"select": "id"})

    print(f"  Database totals: {total_installations:,} installations, {total_equipment:,} equipment, {total_events:,} events")

    sources_to_check = DATA_SOURCES
    if args.source:
        sources_to_check = [s for s in DATA_SOURCES if args.source.lower() in s["name"].lower()]
        if not sources_to_check:
            print(f"  No source matching '{args.source}'")
            return

    report = []

    # Check each source
    print(f"\n{'='*70}")
    print(f"{'Source':<25} {'Records':>8} {'Age':>6} {'Status':<12} {'URL':<8}")
    print(f"{'-'*70}")

    for source in sources_to_check:
        name = source["name"]
        db_source = db_by_name.get(name)
        is_enrichment = source.get("is_enrichment", False)

        # Record count from DB
        if db_source:
            record_count = db_source.get("record_count", 0)
        elif source.get("prefix"):
            record_count = supabase_count("solar_installations", {
                "select": "id",
                "source_record_id": f"like.{source['prefix']}*",
            })
        else:
            record_count = None

        # Freshness check
        freshness = check_freshness(source, db_source)
        age_str = f"{freshness.get('age_days', '?')}d" if freshness.get("age_days") else "N/A"

        # URL check
        url_check = check_url(source["url"])
        url_status = url_check["status"]

        # Record count check
        expected = source.get("expected_min_records")
        if expected and record_count and record_count < expected * 0.8:
            count_status = "LOW"
        else:
            count_status = "ok"

        # Overall status
        issues = []
        if freshness["status"] == "stale":
            issues.append("STALE")
        if freshness["status"] == "never_imported":
            issues.append("NEVER")
        if url_status == "error":
            issues.append("URL_DOWN")
        if count_status == "LOW":
            issues.append("LOW_COUNT")

        status = ", ".join(issues) if issues else "OK"

        record_str = f"{record_count:,}" if record_count else ("N/A" if is_enrichment else "?")

        print(f"  {source['label']:<23} {record_str:>8} {age_str:>6} {status:<12} {url_status:<8}")

        report.append({
            "name": name,
            "label": source["label"],
            "record_count": record_count,
            "freshness": freshness,
            "url_check": url_check,
            "count_status": count_status,
            "status": status,
            "update_frequency": source.get("update_frequency"),
            "script": source.get("script"),
            "run_cmd": source.get("run_cmd"),
        })

    # Summary
    print(f"\n{'='*70}")
    ok_count = sum(1 for r in report if r["status"] == "OK")
    stale_count = sum(1 for r in report if "STALE" in r["status"])
    error_count = sum(1 for r in report if "URL_DOWN" in r["status"] or "LOW_COUNT" in r["status"])

    print(f"  OK: {ok_count} | Stale: {stale_count} | Issues: {error_count}")

    # Show stale sources with remediation
    stale_sources = [r for r in report if "STALE" in r["status"]]
    if stale_sources:
        print(f"\n  Stale sources needing update:")
        for s in stale_sources:
            age = s["freshness"].get("age_days", "?")
            freq = s.get("update_frequency", "?")
            print(f"    {s['label']}: {age} days old (updates {freq})")
            print(f"      Run: {s['run_cmd']}")

    # Show update schedule
    print(f"\n{'='*70}")
    print("Recommended Update Schedule")
    print(f"{'='*70}")
    print(f"  MONTHLY:    CA DGStats, NY-Sun, EIA-860M, CEC Specs, ISO Queues, OSM")
    print(f"  QUARTERLY:  USPVDB, IL Shines, MA PTS, NJ DEP, WREGIS, NOAA Storms")
    print(f"  ANNUAL:     EIA-860, TTS, LBNL Utility, eGRID")
    print(f"  AS NEEDED:  CPSC Recalls, Nominatim geocoding")
    print(f"\n  Post-update enrichment order:")
    print(f"    1. set-location-precision.py")
    print(f"    2. enrich-equipment-specs.py")
    print(f"    3. EIA enrichment scripts (only after annual EIA update)")
    print(f"    4. reverse-geocode.py")
    print(f"    5. crossref-osm.py")
    print(f"    6. crossref-tts-eia.py")
    print(f"    7. crossref-dedup.py (always run last)")

    if args.json:
        json_path = Path(__file__).parent.parent / "data" / "source_health_report.json"
        with open(json_path, "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "total_installations": total_installations,
                "total_equipment": total_equipment,
                "total_events": total_events,
                "sources": report,
            }, f, indent=2)
        print(f"\n  JSON report saved to {json_path}")


if __name__ == "__main__":
    main()

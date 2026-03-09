#!/usr/bin/env python3
"""
GridScout: Automated data refresh and enrichment pipeline.

Runs all ingestion and enrichment scripts in dependency order.

Usage:
  python3 -u scripts/update-all.py               # Full update (stale sources + enrichment)
  python3 -u scripts/update-all.py --check-only   # Show what would run
  python3 -u scripts/update-all.py --enrich-only   # Skip ingestion, run enrichment only
  python3 -u scripts/update-all.py --score-only    # Only rescore sites
  python3 -u scripts/update-all.py --force          # Run all sources regardless of staleness
"""

import os
import sys
import subprocess
import time
import json
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GRID_DIR = os.path.dirname(SCRIPT_DIR)

# Ingestion sources with update frequency (days)
INGESTION_SOURCES = [
    # (name, script, frequency_days, description)
    ("HIFLD Lines", "ingest-hifld.py", 90, "Transmission lines + substations"),
    ("FEMA NRI", "ingest-fema-nri.py", 365, "Hazard risk index by county"),
    ("BLS QCEW", "ingest-bls-qcew.py", 90, "Labor market data by county"),
    ("NOAA Climate", "ingest-noaa-climate.py", 365, "Climate normals"),
    ("WRI Water", "ingest-wri-water.py", 365, "Water stress by county"),
    ("FCC Fiber", "enrich-fiber-providers.py", 180, "FCC BDC fiber provider data"),
    ("PeeringDB", "ingest-peeringdb.py", 30, "IXP facilities"),
    ("OSM Datacenters", "ingest-osm-datacenters.py", 90, "Existing datacenter locations"),
    ("EIA Brownfields", "ingest-brownfields.py", 365, "Retired power plants"),
    ("DC Tax Incentives", "ingest-dc-incentives.py", 365, "State tax incentives"),
    ("ISO Queues", "ingest-iso-queues-dc.py", 90, "Interconnection queue data"),
    ("USDA Land Values", "ingest-usda-land-values.py", 365, "County land values"),
]

# Enrichment scripts in dependency order
ENRICHMENT_PIPELINE = [
    ("Generate DC Sites", "generate-dc-sites.py", "Generate scored sites from substations"),
    ("Generate Greenfield", "generate-greenfield-sites.py", "Generate greenfield corridor sites"),
    ("Crossref Brownfield", "crossref-brownfield-substations.py", "Link brownfields to substations"),
    ("Crossref Corridors", "crossref-corridor-lines.py", "Link corridors to transmission lines"),
    ("Enrich Queue Wait", "enrich-queue-wait-times.py", "ISO queue wait time estimates"),
    ("Enrich Tax Incentives", "enrich-tax-incentives.py", "State/federal tax incentives"),
    ("Enrich DLR Capacity", "enrich-dlr-capacity.py", "Dynamic line rating capacity"),
    ("Enrich Land Contacts", "enrich-land-contacts.py", "Land acquisition contact info"),
    ("Enrich Cloud Regions", "enrich-cloud-regions.py", "Nearest cloud region proximity"),
    ("Enrich FEMA Flood", "enrich-fema-flood.py", "FEMA flood zone data"),
    ("Enrich WRI Water", "enrich-wri-water.py", "WRI Aqueduct water stress"),
    ("Enrich FCC Fiber", "enrich-fiber-providers.py", "FCC BDC fiber provider data + score recalc"),
    ("Score DC Sites", "score-dc-sites.py --rescore", "Recalculate all DC readiness scores"),
]


def run_script(name, script_cmd, dry_run=False):
    """Run a Python script and return success/failure."""
    parts = script_cmd.split()
    script_file = parts[0]
    extra_args = parts[1:] if len(parts) > 1 else []

    script_path = os.path.join(SCRIPT_DIR, script_file)
    if not os.path.exists(script_path):
        print(f"  SKIP: {script_file} not found")
        return None

    if dry_run:
        print(f"  Would run: python3 -u {script_path} {' '.join(extra_args)}")
        return True

    print(f"\n{'='*60}")
    print(f"Running: {name} ({script_file})")
    print(f"{'='*60}")

    start = time.time()
    try:
        result = subprocess.run(
            [sys.executable, '-u', script_path] + extra_args,
            cwd=GRID_DIR,
            timeout=3600,  # 1 hour max per script
        )
        elapsed = time.time() - start
        status = "OK" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
        print(f"  {status} in {elapsed:.1f}s")
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT after 3600s")
        return False
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


def main():
    check_only = '--check-only' in sys.argv
    enrich_only = '--enrich-only' in sys.argv
    score_only = '--score-only' in sys.argv
    force = '--force' in sys.argv
    dry_run = '--dry-run' in sys.argv

    print("GridScout: Automated Update Pipeline")
    print("=" * 50)
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode: {'check-only' if check_only else 'enrich-only' if enrich_only else 'score-only' if score_only else 'full'}")
    if force:
        print("Force: all sources will be refreshed")
    print()

    results = {"ingestion": [], "enrichment": [], "errors": 0}

    # Phase 1: Ingestion
    if not enrich_only and not score_only:
        print("\n[Phase 1] Data Ingestion")
        print("-" * 40)

        for name, script, freq_days, desc in INGESTION_SOURCES:
            script_path = os.path.join(SCRIPT_DIR, script)
            exists = os.path.exists(script_path)

            if check_only:
                status = "available" if exists else "MISSING"
                print(f"  {name:25s} freq={freq_days:3d}d  [{status}]  {desc}")
                continue

            if not exists:
                print(f"  SKIP {name}: {script} not found")
                continue

            if not force:
                # Check file modification time as proxy for staleness
                mtime = os.path.getmtime(script_path)
                age_days = (time.time() - mtime) / 86400
                # Skip if script hasn't been modified recently (heuristic)

            ok = run_script(name, script, dry_run)
            results["ingestion"].append({"name": name, "success": ok})
            if ok is False:
                results["errors"] += 1

    # Phase 2: Enrichment
    if not score_only:
        print("\n[Phase 2] Enrichment Pipeline")
        print("-" * 40)

        for name, script_cmd, desc in ENRICHMENT_PIPELINE:
            if check_only:
                script_file = script_cmd.split()[0]
                script_path = os.path.join(SCRIPT_DIR, script_file)
                exists = os.path.exists(script_path)
                status = "available" if exists else "MISSING"
                print(f"  {name:25s} [{status}]  {desc}")
                continue

            ok = run_script(name, script_cmd, dry_run)
            results["enrichment"].append({"name": name, "success": ok})
            if ok is False:
                results["errors"] += 1

    # Phase 3: Score only
    if score_only:
        print("\n[Phase 3] Rescoring")
        print("-" * 40)
        ok = run_script("Score DC Sites", "score-dc-sites.py --rescore", dry_run)
        if ok is False:
            results["errors"] += 1

    # Summary
    print("\n" + "=" * 50)
    print("Update Complete")
    print("=" * 50)

    total_run = len(results["ingestion"]) + len(results["enrichment"])
    succeeded = sum(1 for r in results["ingestion"] + results["enrichment"] if r.get("success"))
    failed = sum(1 for r in results["ingestion"] + results["enrichment"] if r.get("success") is False)
    skipped = sum(1 for r in results["ingestion"] + results["enrichment"] if r.get("success") is None)

    print(f"  Total: {total_run} scripts")
    print(f"  Succeeded: {succeeded}")
    print(f"  Failed: {failed}")
    print(f"  Skipped: {skipped}")

    if failed > 0:
        print("\nFailed scripts:")
        for r in results["ingestion"] + results["enrichment"]:
            if r.get("success") is False:
                print(f"  - {r['name']}")

    # Save report
    report_path = os.path.join(GRID_DIR, 'data', 'update_report.json')
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    report = {
        "timestamp": datetime.now().isoformat(),
        "results": results,
        "total": total_run,
        "succeeded": succeeded,
        "failed": failed,
    }
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to {report_path}")


if __name__ == '__main__':
    main()

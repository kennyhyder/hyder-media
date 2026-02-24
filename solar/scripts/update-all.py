#!/usr/bin/env python3
"""
SolarTrack Automated Update Runner — Orchestrates data source updates and enrichment.

Checks all data sources for staleness, downloads new data where available,
runs ingestion and enrichment scripts in the correct order, and reports results.

Usage:
  python3 -u scripts/update-all.py                    # Full update (check + run stale)
  python3 -u scripts/update-all.py --check-only        # Report staleness without updating
  python3 -u scripts/update-all.py --force             # Force re-run all sources regardless of freshness
  python3 -u scripts/update-all.py --source cadg,nysun # Update specific sources only
  python3 -u scripts/update-all.py --enrich-only       # Skip ingestion, run enrichment only
  python3 -u scripts/update-all.py --skip-enrich       # Run ingestion, skip enrichment
  python3 -u scripts/update-all.py --skip-build        # Skip Next.js site rebuild
  python3 -u scripts/update-all.py --dry-run           # Show what would run without executing

Schedule (recommended cron):
  Monthly:  CA DGStats, NY-Sun, EIA-860M, CEC Specs, Municipal Permits, OSM
  Quarterly: USPVDB, IL Shines, MA PTS, NOAA Storms, WREGIS, CPSC Recalls, NJ DEP, ISO Queues
  Annual:   EIA-860, TTS, LBNL Utility, NREL Community Solar, eGRID, EPA RE-Powering
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

PSQL_CMD = "PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres"
PROJECT_DIR = Path(__file__).parent.parent
SCRIPTS_DIR = Path(__file__).parent

# ============================================================================
# Update Schedule — defines what to run and in what order
# ============================================================================

# Ingestion sources in dependency order
INGESTION_SOURCES = [
    # --- Auto-downloadable (can run unattended) ---
    {
        "name": "cadg",
        "label": "CA DGStats",
        "cmd": "python3 -u scripts/ingest-ca-dgstats.py",
        "frequency": "monthly",
        "auto_download": True,
        "prefix": "cadg_",
    },
    {
        "name": "nysun",
        "label": "NY-Sun",
        "cmd": "python3 -u scripts/ingest-ny-sun.py",
        "frequency": "monthly",
        "auto_download": True,
        "prefix": "nysun_",
    },
    {
        "name": "eia860m",
        "label": "EIA-860M Monthly",
        "cmd": "python3 -u scripts/ingest-eia860m.py",
        "frequency": "monthly",
        "auto_download": True,
        "prefix": "eia860m_",
    },
    {
        "name": "permits",
        "label": "Municipal Permits (75 portals)",
        "cmd": "python3 -u scripts/ingest-permits.py",
        "frequency": "monthly",
        "auto_download": True,
        "prefix": "permit_",
    },
    {
        "name": "sd_city",
        "label": "San Diego City CSV",
        "cmd": "python3 -u scripts/ingest-san-diego-csv.py --set 2",
        "frequency": "monthly",
        "auto_download": True,
        "prefix": "sdcity_",
    },
    {
        "name": "uspvdb",
        "label": "USGS USPVDB",
        "cmd": "npx ts-node scripts/ingest-uspvdb.ts",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "uspvdb_",
    },
    {
        "name": "nj_dep",
        "label": "NJ DEP ArcGIS",
        "cmd": "python3 -u scripts/ingest-nj-dep.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "njdep_",
    },
    {
        "name": "iso_queues",
        "label": "ISO Queues (CAISO+NYISO)",
        "cmd": "python3 -u scripts/ingest-iso-queues.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "iso_",
    },
    {
        "name": "iso_gridstatus",
        "label": "ISO gridstatus (ERCOT+ISO-NE)",
        "cmd": ".venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "iso_",
    },
    {
        "name": "iso_spp_miso",
        "label": "SPP + MISO Queues",
        "cmd": "python3 -u scripts/ingest-iso-spp-miso.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "iso_spp_",
    },
    {
        "name": "pjm_queue",
        "label": "PJM Queue",
        "cmd": "python3 -u scripts/ingest-pjm-queue.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "iso_pjm_",
    },
    {
        "name": "epa_repowering",
        "label": "EPA RE-Powering Tracker",
        "cmd": "python3 -u scripts/ingest-epa-repowering.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "epa_repower_",
    },
    {
        "name": "blm_solar",
        "label": "BLM Solar ROWs",
        "cmd": "python3 -u scripts/ingest-blm-solar.py",
        "frequency": "quarterly",
        "auto_download": True,
        "prefix": "blm_",
    },
    # --- Annual sources ---
    {
        "name": "eia860",
        "label": "EIA-860 Annual",
        "cmd": "python3 -u scripts/ingest-eia860.py",
        "frequency": "annual",
        "auto_download": True,
        "prefix": "eia860_",
    },
    {
        "name": "tts",
        "label": "Tracking the Sun",
        "cmd": "python3 -u scripts/ingest-tts.py",
        "frequency": "annual",
        "auto_download": True,
        "prefix": "tts3_",
    },
    {
        "name": "lbnl_utility",
        "label": "LBNL Utility-Scale",
        "cmd": "python3 -u scripts/ingest-lbnl-utility.py",
        "frequency": "annual",
        "auto_download": True,
        "prefix": "lbnl_",
    },
    {
        "name": "nrel_community",
        "label": "NREL Community Solar",
        "cmd": "python3 -u scripts/ingest-nrel-community.py",
        "frequency": "annual",
        "auto_download": True,
        "prefix": "nrel_cs_",
    },
    # --- State programs ---
    {
        "name": "mn_puc",
        "label": "MN PUC DER",
        "cmd": "python3 -u scripts/ingest-mn-puc.py",
        "frequency": "annual",
        "auto_download": False,  # Manual Excel download
        "prefix": "mnpuc_",
    },
    {
        "name": "pa_aeps",
        "label": "PA AEPS",
        "cmd": "python3 -u scripts/ingest-pa-aeps.py",
        "frequency": "quarterly",
        "auto_download": False,
        "prefix": "paaeps_",
    },
    {
        "name": "nc_ncuc",
        "label": "NC NCUC",
        "cmd": "python3 -u scripts/ingest-nc-ncuc.py",
        "frequency": "annual",
        "auto_download": False,
        "prefix": "ncncuc_",
    },
    {
        "name": "il_shines",
        "label": "IL Shines",
        "cmd": "python3 -u scripts/ingest-il-shines.py",
        "frequency": "quarterly",
        "auto_download": False,
        "prefix": "ilshines_",
    },
    {
        "name": "ma_pts",
        "label": "MA PTS",
        "cmd": "python3 -u scripts/ingest-ma-pts.py",
        "frequency": "quarterly",
        "auto_download": False,
        "prefix": "mapts_",
    },
]

# Enrichment pipeline in execution order (dependencies matter!)
ENRICHMENT_PIPELINE = [
    {
        "name": "location_precision",
        "label": "Location Precision",
        "cmd": "python3 -u scripts/set-location-precision.py",
        "frequency": "after_ingestion",
        "notes": "Must run first — tags quality of lat/lng",
    },
    {
        "name": "cec_specs",
        "label": "CEC Equipment Specs",
        "cmd": "python3 -u scripts/enrich-equipment-specs.py",
        "frequency": "monthly",
        "notes": "Downloads latest CEC module + inverter databases",
    },
    {
        "name": "eia860_owner",
        "label": "EIA-860 Owner Names",
        "cmd": "python3 -u scripts/enrich-eia860.py",
        "frequency": "annual",
        "notes": "Only after new EIA-860 annual release",
    },
    {
        "name": "eia860_plant",
        "label": "EIA-860 Plant Operators",
        "cmd": "python3 -u scripts/enrich-eia860-plant.py",
        "frequency": "annual",
        "notes": "Only after new EIA-860 annual release",
    },
    {
        "name": "egrid",
        "label": "EPA eGRID",
        "cmd": "python3 -u scripts/enrich-egrid.py",
        "frequency": "annual",
        "notes": "Operator + owner names for utility-scale",
    },
    {
        "name": "wregis",
        "label": "WREGIS Owners",
        "cmd": "python3 -u scripts/enrich-wregis.py",
        "frequency": "quarterly",
        "notes": "Owner names for western US",
    },
    {
        "name": "gem",
        "label": "GEM Solar Tracker",
        "cmd": "python3 -u scripts/enrich-gem.py",
        "frequency": "quarterly",
        "notes": "Owner/operator from Global Energy Monitor",
    },
    {
        "name": "lbnl_queues",
        "label": "LBNL Queued Up",
        "cmd": "python3 -u scripts/enrich-lbnl-queues.py",
        "frequency": "annual",
        "notes": "Developer names from interconnection queues",
    },
    {
        "name": "pjm_gats",
        "label": "PJM-GATS Owners",
        "cmd": "python3 -u scripts/enrich-pjm-gats.py",
        "frequency": "quarterly",
        "notes": "Owner names from PJM states. Manual XLSX export required.",
    },
    {
        "name": "backfill_source",
        "label": "Backfill Source Fields",
        "cmd": "python3 -u scripts/backfill-source-fields.py",
        "frequency": "after_ingestion",
        "notes": "Recover fields from CA DGStats, NY-Sun, TTS source files",
    },
    {
        "name": "osm",
        "label": "OSM Cross-Reference",
        "cmd": "python3 -u scripts/fetch-osm-solar.py && python3 -u scripts/crossref-osm.py",
        "frequency": "monthly",
        "notes": "Fetch OSM data then cross-reference names/operators",
    },
    {
        "name": "tts_eia_xref",
        "label": "TTS↔EIA Cross-Reference",
        "cmd": "python3 -u scripts/crossref-tts-eia.py",
        "frequency": "after_ingestion",
        "notes": "Inherit EIA addresses for TTS/CA records",
    },
    {
        "name": "noaa_storms",
        "label": "NOAA Storm Events",
        "cmd": "python3 -u scripts/enrich-noaa-storms.py",
        "frequency": "quarterly",
        "notes": "Downloads 11yr of storm data, ~35 min with parallel insert",
    },
    {
        "name": "cpsc_recalls",
        "label": "CPSC Recalls",
        "cmd": "python3 -u scripts/enrich-cpsc-recalls.py",
        "frequency": "quarterly",
        "notes": "Equipment recall events. Check cpsc.gov for new recalls.",
    },
    {
        "name": "ferc_eqr",
        "label": "FERC EQR (PPA Contracts)",
        "cmd": "python3 -u scripts/ingest-ferc-eqr.py",
        "frequency": "quarterly",
        "notes": "Solar PPA contracts from PUDL Parquet. Offtaker, PPA price, developer.",
    },
    {
        "name": "treasury_1603",
        "label": "Treasury 1603 Grants",
        "cmd": "python3 -u scripts/enrich-treasury-1603.py --skip-download",
        "frequency": "once",
        "notes": "Historical 2009-2017 grant data. Run once then skip.",
    },
    {
        "name": "crossref_dedup",
        "label": "Cross-Source Dedup",
        "cmd": "python3 -u scripts/crossref-dedup.py",
        "frequency": "after_ingestion",
        "notes": "ALWAYS run last — matches records across sources",
    },
]


def get_last_import(prefix):
    """Get the last import timestamp for a source prefix from the database."""
    sql = f"""
    SELECT MAX(created_at)::text
    FROM solar_installations
    WHERE source_record_id LIKE '{prefix}%'
    """
    result = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "{sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        return None
    val = result.stdout.strip()
    if not val or val == "" or val == "null":
        return None
    try:
        return datetime.fromisoformat(val.replace("+00", "+00:00").split(".")[0])
    except (ValueError, TypeError):
        return None


def get_record_count(prefix):
    """Get current record count for a source prefix."""
    sql = f"""
    SELECT COUNT(*) FROM solar_installations
    WHERE source_record_id LIKE '{prefix}%'
    """
    result = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "{sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        return 0
    try:
        return int(result.stdout.strip())
    except (ValueError, TypeError):
        return 0


def is_stale(last_import, frequency):
    """Check if a source is due for an update based on its schedule."""
    if last_import is None:
        return True

    now = datetime.utcnow()
    age = now - last_import

    thresholds = {
        "monthly": timedelta(days=35),
        "quarterly": timedelta(days=100),
        "annual": timedelta(days=380),
        "after_ingestion": timedelta(days=35),
        "once": timedelta(days=36500),  # ~100 years = never
    }

    threshold = thresholds.get(frequency, timedelta(days=35))
    return age > threshold


def run_script(cmd, label, dry_run=False, timeout=1800):
    """Run a script and return (success, output, duration)."""
    if dry_run:
        print(f"  [DRY RUN] Would run: {cmd}")
        return True, "", 0

    print(f"  Running: {cmd}")
    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(PROJECT_DIR),
        )
        duration = time.time() - start
        output = result.stdout + result.stderr

        if result.returncode != 0:
            print(f"  ERROR ({duration:.0f}s): {result.stderr[:200]}")
            return False, output, duration
        else:
            # Extract key metrics from output
            for line in output.split("\n"):
                line_lower = line.strip().lower()
                if any(kw in line_lower for kw in ["created", "applied", "patched", "enriched", "matched", "error"]):
                    if any(c.isdigit() for c in line):
                        print(f"    {line.strip()}")
            print(f"  OK ({duration:.0f}s)")
            return True, output, duration

    except subprocess.TimeoutExpired:
        duration = time.time() - start
        print(f"  TIMEOUT after {duration:.0f}s (limit: {timeout}s)")
        return False, "TIMEOUT", duration
    except Exception as e:
        duration = time.time() - start
        print(f"  EXCEPTION: {e}")
        return False, str(e), duration


def link_entities(dry_run=False):
    """Link any unlinked entity records to entity tables."""
    print("\nLinking entity records...")

    if dry_run:
        print("  [DRY RUN] Would link owner/developer/installer/operator entities")
        return

    sql = """
    -- Create new owner entities
    INSERT INTO solar_site_owners (name, normalized_name, entity_type, state)
    SELECT DISTINCT ON (LOWER(TRIM(i.owner_name)))
      MODE() WITHIN GROUP (ORDER BY i.owner_name),
      LOWER(TRIM(i.owner_name)),
      'owner',
      MODE() WITHIN GROUP (ORDER BY i.state)
    FROM solar_installations i
    WHERE i.owner_name IS NOT NULL AND i.owner_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM solar_site_owners o WHERE o.normalized_name = LOWER(TRIM(i.owner_name)))
    GROUP BY LOWER(TRIM(i.owner_name));

    -- Link owners
    UPDATE solar_installations i SET owner_id = o.id
    FROM solar_site_owners o
    WHERE i.owner_name IS NOT NULL AND i.owner_id IS NULL
      AND LOWER(TRIM(i.owner_name)) = o.normalized_name;

    -- Create new developer entities
    INSERT INTO solar_site_owners (name, normalized_name, entity_type, state)
    SELECT DISTINCT ON (LOWER(TRIM(i.developer_name)))
      MODE() WITHIN GROUP (ORDER BY i.developer_name),
      LOWER(TRIM(i.developer_name)),
      'developer',
      MODE() WITHIN GROUP (ORDER BY i.state)
    FROM solar_installations i
    WHERE i.developer_name IS NOT NULL AND i.developer_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM solar_site_owners o WHERE o.normalized_name = LOWER(TRIM(i.developer_name)))
    GROUP BY LOWER(TRIM(i.developer_name));

    -- Link developers
    UPDATE solar_installations i SET developer_id = o.id
    FROM solar_site_owners o
    WHERE i.developer_name IS NOT NULL AND i.developer_id IS NULL
      AND LOWER(TRIM(i.developer_name)) = o.normalized_name;

    -- Create new operator entities
    INSERT INTO solar_site_owners (name, normalized_name, entity_type, state)
    SELECT DISTINCT ON (LOWER(TRIM(i.operator_name)))
      MODE() WITHIN GROUP (ORDER BY i.operator_name),
      LOWER(TRIM(i.operator_name)),
      'operator',
      MODE() WITHIN GROUP (ORDER BY i.state)
    FROM solar_installations i
    WHERE i.operator_name IS NOT NULL AND i.operator_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM solar_site_owners o WHERE o.normalized_name = LOWER(TRIM(i.operator_name)))
    GROUP BY LOWER(TRIM(i.operator_name));

    -- Link operators
    UPDATE solar_installations i SET operator_id = o.id
    FROM solar_site_owners o
    WHERE i.operator_name IS NOT NULL AND i.operator_id IS NULL
      AND LOWER(TRIM(i.operator_name)) = o.normalized_name;

    -- Create new installer entities
    INSERT INTO solar_installers (name, normalized_name, state)
    SELECT DISTINCT ON (LOWER(TRIM(i.installer_name)))
      MODE() WITHIN GROUP (ORDER BY i.installer_name),
      LOWER(TRIM(i.installer_name)),
      MODE() WITHIN GROUP (ORDER BY i.state)
    FROM solar_installations i
    WHERE i.installer_name IS NOT NULL AND i.installer_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM solar_installers ins WHERE ins.normalized_name = LOWER(TRIM(i.installer_name)))
    GROUP BY LOWER(TRIM(i.installer_name));

    -- Link installers
    UPDATE solar_installations i SET installer_id = ins.id
    FROM solar_installers ins
    WHERE i.installer_name IS NOT NULL AND i.installer_id IS NULL
      AND LOWER(TRIM(i.installer_name)) = ins.normalized_name;
    """

    result = subprocess.run(
        f"""{PSQL_CMD} -c "{sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        print(f"  Entity linking error: {result.stderr[:200]}")
    else:
        print(f"  Entity linking complete")

    # Verify
    verify_sql = """
    SELECT 'unlinked_owner' as metric, COUNT(*) FROM solar_installations WHERE owner_name IS NOT NULL AND owner_id IS NULL
    UNION ALL SELECT 'unlinked_developer', COUNT(*) FROM solar_installations WHERE developer_name IS NOT NULL AND developer_id IS NULL
    UNION ALL SELECT 'unlinked_operator', COUNT(*) FROM solar_installations WHERE operator_name IS NOT NULL AND operator_id IS NULL
    UNION ALL SELECT 'unlinked_installer', COUNT(*) FROM solar_installations WHERE installer_name IS NOT NULL AND installer_id IS NULL;
    """
    result = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "{verify_sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=60,
    )
    if result.returncode == 0:
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                parts = line.split("|")
                if len(parts) == 2 and parts[1].strip() != "0":
                    print(f"  WARNING: {parts[0].strip()}: {parts[1].strip()}")


def rebuild_site(dry_run=False):
    """Rebuild the Next.js static site."""
    print("\nRebuilding Next.js site...")
    if dry_run:
        print("  [DRY RUN] Would run: npm run build")
        return True

    success, _, duration = run_script(
        "npm run build",
        "Next.js build",
        timeout=300,
    )
    return success


def get_db_summary():
    """Get current database summary stats."""
    sql = """
    SELECT
      (SELECT COUNT(*) FROM solar_installations) as installations,
      (SELECT COUNT(*) FROM solar_equipment) as equipment,
      (SELECT COUNT(*) FROM solar_site_events) as events,
      (SELECT COUNT(*) FROM solar_installers) as installers,
      (SELECT COUNT(*) FROM solar_site_owners) as owners,
      (SELECT COUNT(*) FROM solar_installations WHERE owner_name IS NOT NULL) as has_owner,
      (SELECT COUNT(*) FROM solar_installations WHERE flood_zone IS NOT NULL) as has_flood
    """
    result = subprocess.run(
        f"""{PSQL_CMD} -t -A -c "{sql.strip()}" """,
        shell=True, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        return {}
    parts = result.stdout.strip().split("|")
    if len(parts) >= 7:
        return {
            "installations": int(parts[0]),
            "equipment": int(parts[1]),
            "events": int(parts[2]),
            "installers": int(parts[3]),
            "owners": int(parts[4]),
            "has_owner": int(parts[5]),
            "has_flood": int(parts[6]),
        }
    return {}


def main():
    parser = argparse.ArgumentParser(description="SolarTrack Automated Update Runner")
    parser.add_argument("--check-only", action="store_true", help="Report staleness without updating")
    parser.add_argument("--force", action="store_true", help="Force re-run all sources")
    parser.add_argument("--source", type=str, help="Comma-separated source names to update")
    parser.add_argument("--enrich-only", action="store_true", help="Skip ingestion, run enrichment only")
    parser.add_argument("--skip-enrich", action="store_true", help="Run ingestion, skip enrichment")
    parser.add_argument("--skip-build", action="store_true", help="Skip Next.js site rebuild")
    parser.add_argument("--dry-run", action="store_true", help="Show what would run without executing")
    args = parser.parse_args()

    print("=" * 70)
    print("SolarTrack Automated Update Runner")
    print("=" * 70)
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Mode: {'check-only' if args.check_only else 'dry-run' if args.dry_run else 'live'}")
    if args.source:
        print(f"  Sources: {args.source}")
    if args.force:
        print(f"  Force: all sources will be re-run regardless of freshness")

    # Get initial DB stats
    print("\n--- Database Status ---")
    stats_before = get_db_summary()
    if stats_before:
        print(f"  Installations: {stats_before.get('installations', 0):,}")
        print(f"  Equipment: {stats_before.get('equipment', 0):,}")
        print(f"  Events: {stats_before.get('events', 0):,}")
        print(f"  Entities: {stats_before.get('installers', 0):,} installers, {stats_before.get('owners', 0):,} owners")
        print(f"  Owner coverage: {stats_before.get('has_owner', 0):,} ({stats_before.get('has_owner', 0)/max(stats_before.get('installations', 1), 1)*100:.1f}%)")
        if stats_before.get('has_flood', 0) > 0:
            print(f"  Flood zone: {stats_before.get('has_flood', 0):,} ({stats_before.get('has_flood', 0)/max(stats_before.get('installations', 1), 1)*100:.1f}%)")

    # Filter sources if specified
    source_filter = None
    if args.source:
        source_filter = set(s.strip() for s in args.source.split(","))

    # ========================================================================
    # Phase 1: Check and run ingestion sources
    # ========================================================================
    if not args.enrich_only:
        print("\n" + "=" * 70)
        print("Phase 1: Ingestion Sources")
        print("=" * 70)

        stale_sources = []
        fresh_sources = []
        manual_sources = []

        for src in INGESTION_SOURCES:
            if source_filter and src["name"] not in source_filter:
                continue

            last = get_last_import(src["prefix"])
            count = get_record_count(src["prefix"])
            stale = args.force or is_stale(last, src["frequency"])

            age_str = "never"
            if last:
                age_days = (datetime.utcnow() - last).days
                age_str = f"{age_days}d ago"

            status = "STALE" if stale else "fresh"
            symbol = "!" if stale else "✓"
            print(f"  [{symbol}] {src['label']:30s} {count:>8,} records  last: {age_str:>10s}  ({src['frequency']})  [{status}]")

            if stale:
                if src.get("auto_download", True):
                    stale_sources.append(src)
                else:
                    manual_sources.append(src)
            else:
                fresh_sources.append(src)

        if manual_sources:
            print(f"\n  Manual download required for {len(manual_sources)} sources:")
            for src in manual_sources:
                print(f"    - {src['label']}: requires manual data file download before running")

        if args.check_only:
            print(f"\n  Summary: {len(stale_sources)} stale (auto), {len(manual_sources)} stale (manual), {len(fresh_sources)} fresh")
            if not args.enrich_only:
                # Still show enrichment status
                pass
        elif stale_sources:
            print(f"\n  Running {len(stale_sources)} stale auto-download sources...")
            results = {"success": 0, "failed": 0, "skipped": 0}

            for src in stale_sources:
                print(f"\n  --- {src['label']} ---")
                success, output, duration = run_script(
                    src["cmd"], src["label"],
                    dry_run=args.dry_run,
                    timeout=3600,  # 1 hour max per source
                )
                if success:
                    results["success"] += 1
                else:
                    results["failed"] += 1

            print(f"\n  Ingestion results: {results['success']} succeeded, {results['failed']} failed")
        else:
            print(f"\n  All auto-download sources are fresh. Nothing to ingest.")

    # ========================================================================
    # Phase 2: Enrichment pipeline
    # ========================================================================
    if not args.skip_enrich and not args.check_only:
        print("\n" + "=" * 70)
        print("Phase 2: Enrichment Pipeline")
        print("=" * 70)

        enrichment_results = {"success": 0, "failed": 0, "skipped": 0}

        for step in ENRICHMENT_PIPELINE:
            if source_filter and step["name"] not in source_filter:
                enrichment_results["skipped"] += 1
                continue

            # Skip "once" frequency if already run
            if step["frequency"] == "once" and not args.force:
                enrichment_results["skipped"] += 1
                continue

            # Skip annual enrichments unless forced or source filter specified
            if step["frequency"] == "annual" and not args.force and not source_filter:
                enrichment_results["skipped"] += 1
                continue

            print(f"\n  --- {step['label']} ---")
            if step.get("notes"):
                print(f"    ({step['notes']})")

            success, output, duration = run_script(
                step["cmd"], step["label"],
                dry_run=args.dry_run,
                timeout=7200,  # 2 hours for enrichment
            )
            if success:
                enrichment_results["success"] += 1
            else:
                enrichment_results["failed"] += 1

        print(f"\n  Enrichment results: {enrichment_results['success']} succeeded, "
              f"{enrichment_results['failed']} failed, {enrichment_results['skipped']} skipped")

    # ========================================================================
    # Phase 3: Entity linking
    # ========================================================================
    if not args.check_only:
        link_entities(dry_run=args.dry_run)

    # ========================================================================
    # Phase 4: Site rebuild
    # ========================================================================
    if not args.skip_build and not args.check_only:
        rebuild_site(dry_run=args.dry_run)

    # ========================================================================
    # Final summary
    # ========================================================================
    print("\n" + "=" * 70)
    print("Update Complete")
    print("=" * 70)

    stats_after = get_db_summary()
    if stats_after and stats_before:
        delta_inst = stats_after.get("installations", 0) - stats_before.get("installations", 0)
        delta_equip = stats_after.get("equipment", 0) - stats_before.get("equipment", 0)
        delta_events = stats_after.get("events", 0) - stats_before.get("events", 0)

        print(f"  Installations: {stats_after.get('installations', 0):,} ({'+' if delta_inst >= 0 else ''}{delta_inst:,})")
        print(f"  Equipment: {stats_after.get('equipment', 0):,} ({'+' if delta_equip >= 0 else ''}{delta_equip:,})")
        print(f"  Events: {stats_after.get('events', 0):,} ({'+' if delta_events >= 0 else ''}{delta_events:,})")
        print(f"  Owner coverage: {stats_after.get('has_owner', 0):,} ({stats_after.get('has_owner', 0)/max(stats_after.get('installations', 1), 1)*100:.1f}%)")
        if stats_after.get('has_flood', 0) > 0:
            print(f"  Flood zone: {stats_after.get('has_flood', 0):,} ({stats_after.get('has_flood', 0)/max(stats_after.get('installations', 1), 1)*100:.1f}%)")

    # Save report
    report = {
        "timestamp": datetime.now().isoformat(),
        "stats_before": stats_before,
        "stats_after": stats_after,
        "mode": "check-only" if args.check_only else "dry-run" if args.dry_run else "live",
    }
    report_path = PROJECT_DIR / "data" / "update_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n  Report saved: {report_path}")
    print("\nDone!")


if __name__ == "__main__":
    main()

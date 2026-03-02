#!/usr/bin/env python3
"""
Satellite Scanning Pipeline - streaming batch approach.

Downloads Google Maps satellite tiles → rsyncs to droplet → runs NREL detection →
rsyncs results back → deletes tiles → repeats for next batch.

Processes zips in batches of 50 to stay within disk space limits
(~1 GB per batch instead of ~17 GB for all tiles).

Usage:
    python3 -u scripts/run-naip-pipeline.py                # Full pipeline
    python3 -u scripts/run-naip-pipeline.py --batch-size 20 # Smaller batches
    python3 -u scripts/run-naip-pipeline.py --match-only    # Just run matching
    python3 -u scripts/run-naip-pipeline.py --skip-scan     # Download only (no droplet)
"""

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TILE_DIR = PROJECT_DIR / "data" / "naip_tiles"
DET_DIR = PROJECT_DIR / "data" / "naip_detections"

DROPLET = "root@104.131.105.89"
DROPLET_DIR = "/root/solar-nrel"

MIN_CAPACITY = 1.0      # MW
MAX_TILES_PER_ZIP = 25   # 5x5 centered grid
TIER = "A"
BATCH_SIZE = 50          # zips per batch
SOURCE = "google"        # google (proven) or naip (free but low detection)
ZOOM = 18                # Google Maps zoom level (18 = ~301m/tile, proven 65% detection)


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def run(cmd, timeout=600, check=True):
    """Run a shell command, return (stdout, returncode)."""
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, timeout=timeout
    )
    if check and result.returncode != 0:
        log(f"  CMD FAILED: {cmd}")
        log(f"  STDERR: {result.stderr[:500]}")
    return result.stdout, result.returncode


def get_target_zips():
    """Get all target zip codes from database."""
    csv_path = Path(tempfile.gettempdir()) / "naip_target_zips.csv"
    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        f"-c \"\\copy (SELECT DISTINCT LEFT(zip_code,5) as z "
        f"FROM solar_installations "
        f"WHERE location_precision IN ('city','zip','county') "
        f"AND zip_code IS NOT NULL AND zip_code != '' "
        f"AND capacity_mw IS NOT NULL AND capacity_mw >= {MIN_CAPACITY} "
        f"AND is_canonical = true "
        f"ORDER BY z) TO '{csv_path}' WITH CSV\""
    )
    stdout, rc = run(psql_cmd, timeout=120)
    if rc != 0:
        log("ERROR: Failed to get target zips")
        sys.exit(1)

    zips = []
    with open(csv_path, 'r') as f:
        for line in f:
            z = line.strip().strip('"')
            if z and len(z) == 5:
                zips.append(z)
    csv_path.unlink(missing_ok=True)
    return zips


def check_droplet():
    """Verify droplet is reachable and sync scan script."""
    log("Checking droplet connectivity...")
    _, rc = run(f"ssh -o ConnectTimeout=10 {DROPLET} 'echo OK'", check=False)
    if rc != 0:
        log("ERROR: Cannot reach droplet at 104.131.105.89")
        return False

    # Sync scan script to droplet
    _, rc = run(f"rsync -az {SCRIPT_DIR}/scan-naip-solar.py {DROPLET}:{DROPLET_DIR}/")
    if rc != 0:
        log("WARNING: Could not sync scan script to droplet")
        return False

    log("  Droplet reachable, scan script synced")
    return True


def download_batch(zip_list):
    """Download NAIP tiles for a list of zips."""
    zip_str = ",".join(zip_list)
    cmd = (
        f"python3 -u {SCRIPT_DIR}/fetch-naip-tiles.py "
        f"--source {SOURCE} --zoom {ZOOM} "
        f"--tier {TIER} "
        f"--min-capacity {MIN_CAPACITY} "
        f"--max-tiles-per-zip {MAX_TILES_PER_ZIP} "
        f"--zip {zip_str}"
    )
    stdout, rc = run(cmd, timeout=3600, check=False)
    print(stdout, end='')
    return rc == 0


def rsync_to_droplet():
    """Rsync local tiles to droplet."""
    _, rc = run(
        f"rsync -az {TILE_DIR}/ {DROPLET}:{DROPLET_DIR}/naip_tiles/",
        timeout=600
    )
    return rc == 0


def run_detection(zip_list):
    """Run NREL detection on droplet for specific zips."""
    zip_str = ",".join(zip_list)
    cmd = (
        f"ssh -o ServerAliveInterval=60 {DROPLET} "
        f"'cd {DROPLET_DIR} && "
        f"/root/miniconda3/envs/nrel/bin/python -u scan-naip-solar.py "
        f"--zip {zip_str}'"
    )
    stdout, rc = run(cmd, timeout=7200, check=False)
    print(stdout, end='')
    return rc == 0


def rsync_results_back():
    """Rsync detection results from droplet."""
    DET_DIR.mkdir(parents=True, exist_ok=True)
    _, rc = run(
        f"rsync -az {DROPLET}:{DROPLET_DIR}/naip_detections/ {DET_DIR}/",
        timeout=300
    )
    return rc == 0


def cleanup_tiles(zip_list):
    """Delete tiles locally and on droplet to free disk space."""
    # Clean locally
    for z in zip_list:
        tile_path = TILE_DIR / z
        if tile_path.exists():
            shutil.rmtree(tile_path)

    # Clean on droplet
    zip_dirs = " ".join(f"{DROPLET_DIR}/naip_tiles/{z}" for z in zip_list)
    run(f"ssh {DROPLET} 'rm -rf {zip_dirs}'", check=False, timeout=60)


def count_detections(zip_list):
    """Count total detections in results for given zips."""
    total = 0
    for z in zip_list:
        det_file = DET_DIR / f"{z}.json"
        if det_file.exists():
            try:
                with open(det_file, 'r') as f:
                    data = json.load(f)
                total += data.get('merged_detections', 0)
            except Exception:
                pass
    return total


def run_matching():
    """Run the detection → database matching script."""
    log("Running detection matching...")
    cmd = f"python3 -u {SCRIPT_DIR}/match-naip-detections.py"
    stdout, rc = run(cmd, timeout=3600, check=False)
    print(stdout, end='')
    return rc == 0


def main():
    parser = argparse.ArgumentParser(description="NAIP Satellite Scanning Pipeline")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                        help=f"Zips per batch (default: {BATCH_SIZE})")
    parser.add_argument("--match-only", action="store_true",
                        help="Skip download/scan, just run matching")
    parser.add_argument("--skip-scan", action="store_true",
                        help="Download tiles only, don't scan on droplet")
    parser.add_argument("--resume", action="store_true", default=True,
                        help="Skip zips that already have detection results")
    args = parser.parse_args()

    log("=" * 60)
    log("SATELLITE SCANNING PIPELINE (Google Maps → NREL Detection)")
    log("=" * 60)
    log(f"  Source: {SOURCE} (zoom {ZOOM})")
    log(f"  Tier: {TIER}")
    log(f"  Min capacity: {MIN_CAPACITY} MW")
    log(f"  Max tiles/zip: {MAX_TILES_PER_ZIP}")
    log(f"  Batch size: {args.batch_size}")
    log(f"  Droplet: {DROPLET}")

    if args.match_only:
        run_matching()
        return

    # Verify droplet (unless skip-scan)
    if not args.skip_scan:
        if not check_droplet():
            log("ERROR: Droplet not reachable. Use --skip-scan to download only.")
            sys.exit(1)

    # Get target zips
    log("\nGetting target zip codes...")
    all_zips = get_target_zips()
    log(f"  Total target zips: {len(all_zips):,}")

    # Filter already-processed zips
    DET_DIR.mkdir(parents=True, exist_ok=True)
    remaining = [z for z in all_zips if not (DET_DIR / f"{z}.json").exists()]
    log(f"  Already processed: {len(all_zips) - len(remaining):,}")
    log(f"  Remaining: {len(remaining):,}")

    if not remaining:
        log("All zips already processed!")
        log("\nRunning matching...")
        run_matching()
        return

    # Process in batches
    total_batches = (len(remaining) + args.batch_size - 1) // args.batch_size
    total_downloaded = 0
    total_detected = 0
    total_errors = 0
    start_time = time.time()

    for batch_num in range(total_batches):
        batch_start = batch_num * args.batch_size
        batch_end = min(batch_start + args.batch_size, len(remaining))
        batch_zips = remaining[batch_start:batch_end]

        log(f"\n--- BATCH {batch_num + 1}/{total_batches} ({len(batch_zips)} zips) ---")

        # Step A: Download tiles
        log("  A: Downloading tiles...")
        download_batch(batch_zips)

        # Count tiles
        n_tiles = sum(1 for _ in TILE_DIR.rglob("*.png")) if TILE_DIR.exists() else 0
        total_downloaded += n_tiles
        log(f"  Downloaded: {n_tiles} tiles")

        if n_tiles == 0:
            log("  No tiles downloaded, skipping batch")
            continue

        if not args.skip_scan:
            # Step B: Rsync to droplet
            log("  B: Syncing to droplet...")
            if not rsync_to_droplet():
                log("  WARNING: Rsync to droplet failed")
                total_errors += 1
                cleanup_tiles(batch_zips)
                continue

            # Step C: Run detection
            log("  C: Running NREL detection...")
            if not run_detection(batch_zips):
                log("  WARNING: Detection had errors")
                total_errors += 1

            # Step D: Rsync results back
            log("  D: Syncing results back...")
            rsync_results_back()

            # Count detections
            batch_dets = count_detections(batch_zips)
            total_detected += batch_dets

        # Step E: Cleanup
        log("  E: Cleaning up tiles...")
        cleanup_tiles(batch_zips)

        elapsed = time.time() - start_time
        zips_done = batch_end
        zips_remaining = len(remaining) - zips_done
        rate = zips_done / elapsed * 3600 if elapsed > 0 else 0
        eta = zips_remaining / (zips_done / elapsed) if elapsed > 0 and zips_done > 0 else 0

        log(f"  Batch {batch_num + 1} done. "
            f"Totals: {total_downloaded:,} tiles, {total_detected:,} detections, "
            f"{total_errors} errors. "
            f"Rate: {rate:.0f} zips/hr. ETA: {eta/3600:.1f}hr")

    log("\n" + "=" * 60)
    log("DOWNLOAD + DETECTION COMPLETE")
    log(f"  Total tiles downloaded: {total_downloaded:,}")
    log(f"  Total detections: {total_detected:,}")
    log(f"  Batch errors: {total_errors}")
    log("=" * 60)

    # Step 5: Match detections to database records
    log("\nSTEP 5: Matching detections to database targets...")
    run_matching()

    log("\n" + "=" * 60)
    log("PIPELINE COMPLETE")
    log("=" * 60)
    log("Check data/naip_detections/match_report.json for results")


if __name__ == "__main__":
    main()

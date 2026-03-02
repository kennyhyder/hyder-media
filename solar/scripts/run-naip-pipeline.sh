#!/bin/bash
# NAIP Satellite Scanning Pipeline - streaming batch approach
# Processes zips in batches to stay within disk space limits.
#
# Usage: bash scripts/run-naip-pipeline.sh 2>&1 | tee data/naip_pipeline.log
#
# Approach: Download tiles for a batch of zips → rsync to droplet →
# scan on droplet → rsync results back → delete tiles → repeat

set -eo pipefail
cd "$(dirname "$0")/.."

LOG="data/naip_pipeline.log"
DROPLET="root@104.131.105.89"
DROPLET_DIR="/root/solar-nrel"
LOCAL_TILES="data/naip_tiles"
LOCAL_DETS="data/naip_detections"
BATCH_SIZE=50         # zips per batch
MIN_CAPACITY=1.0      # MW
MAX_TILES_PER_ZIP=25  # 5x5 centered grid
TIER="A"

mkdir -p data "$LOCAL_DETS"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=========================================="
log "NAIP STREAMING PIPELINE"
log "=========================================="
log "  Tier: $TIER"
log "  Min capacity: ${MIN_CAPACITY} MW"
log "  Max tiles/zip: $MAX_TILES_PER_ZIP"
log "  Batch size: $BATCH_SIZE zips"
log "  Droplet: $DROPLET"

# Step 0: Verify droplet connectivity + rsync scan script
log "STEP 0: Verifying droplet..."
ssh -o ConnectTimeout=10 "$DROPLET" "echo 'OK'" || { log "ERROR: Cannot reach droplet"; exit 1; }
rsync -az scripts/scan-naip-solar.py "$DROPLET:$DROPLET_DIR/"
log "  Droplet reachable, scan script synced"

# Step 1: Get the list of zips to process
log "STEP 1: Getting zip list..."
python3 -u scripts/fetch-naip-tiles.py \
    --tier "$TIER" \
    --min-capacity "$MIN_CAPACITY" \
    --max-tiles-per-zip "$MAX_TILES_PER_ZIP" \
    --dry-run 2>&1

# Extract zip directories that need processing (check for existing detection results)
# We'll process all zips returned by the download script

# Step 2-4: Process in batches
# Get all target zip codes from a quick psql query
ZIPS_FILE=$(mktemp)
python3 -c "
import csv, subprocess, sys, tempfile
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('$PWD/.env.local'))

csv_path = '/tmp/naip_target_zips.csv'
cmd = (
    \"PGPASSWORD='#FsW7iqg%EYX&G3M' psql \"
    \"-h aws-0-us-west-2.pooler.supabase.com -p 6543 \"
    \"-U postgres.ilbovwnhrowvxjdkvrln -d postgres \"
    \"-c \\\"\\\\copy (SELECT DISTINCT LEFT(zip_code,5) as z \"
    \"FROM solar_installations \"
    \"WHERE location_precision IN ('city','zip','county') \"
    \"AND zip_code IS NOT NULL AND zip_code != '' \"
    \"AND capacity_mw IS NOT NULL AND capacity_mw >= $MIN_CAPACITY \"
    \"AND is_canonical = true \"
    \"ORDER BY z) TO '$ZIPS_FILE' WITH CSV\\\"\"
)
r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
if r.returncode != 0:
    print(f'Error: {r.stderr}', file=sys.stderr)
    sys.exit(1)
"
TOTAL_ZIPS=$(wc -l < "$ZIPS_FILE" | tr -d ' ')
log "  Total target zips: $TOTAL_ZIPS"

# Filter to zips that don't already have detection results
REMAINING_FILE=$(mktemp)
while IFS= read -r zip; do
    zip=$(echo "$zip" | tr -d '"' | tr -d ' ')
    [ -z "$zip" ] && continue
    if [ ! -f "$LOCAL_DETS/${zip}.json" ]; then
        echo "$zip" >> "$REMAINING_FILE"
    fi
done < "$ZIPS_FILE"
REMAINING=$(wc -l < "$REMAINING_FILE" | tr -d ' ')
log "  Already processed: $((TOTAL_ZIPS - REMAINING))"
log "  Remaining: $REMAINING"

if [ "$REMAINING" -eq 0 ]; then
    log "All zips already processed!"
    rm -f "$ZIPS_FILE" "$REMAINING_FILE"
    # Skip to matching
    log "STEP 5: Running matching..."
    python3 -u scripts/match-naip-detections.py 2>&1
    exit 0
fi

# Process in batches
BATCH_NUM=0
TOTAL_BATCHES=$(( (REMAINING + BATCH_SIZE - 1) / BATCH_SIZE ))
TOTAL_DOWNLOADED=0
TOTAL_DETECTED=0
TOTAL_ERRORS=0

while IFS= read -r zip_batch; do
    BATCH_NUM=$((BATCH_NUM + 1))

    # Read next BATCH_SIZE zips
    BATCH_ZIPS=""
    COUNT=0
    while IFS= read -r zip && [ $COUNT -lt $BATCH_SIZE ]; do
        zip=$(echo "$zip" | tr -d '"' | tr -d ' ')
        [ -z "$zip" ] && continue
        if [ -n "$BATCH_ZIPS" ]; then
            BATCH_ZIPS="$BATCH_ZIPS,$zip"
        else
            BATCH_ZIPS="$zip"
        fi
        COUNT=$((COUNT + 1))
    done

    [ -z "$BATCH_ZIPS" ] && break

    log "--- BATCH $BATCH_NUM/$TOTAL_BATCHES ($COUNT zips) ---"

    # 2a: Download tiles for this batch
    log "  Downloading tiles for batch..."
    python3 -u scripts/fetch-naip-tiles.py \
        --tier "$TIER" \
        --min-capacity "$MIN_CAPACITY" \
        --max-tiles-per-zip "$MAX_TILES_PER_ZIP" \
        --zip "$BATCH_ZIPS" 2>&1 || {
        log "  WARNING: Download had errors, continuing..."
    }

    # Count downloaded tiles
    BATCH_TILES=$(find "$LOCAL_TILES" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    log "  Downloaded: $BATCH_TILES tiles"
    TOTAL_DOWNLOADED=$((TOTAL_DOWNLOADED + BATCH_TILES))

    if [ "$BATCH_TILES" -eq 0 ]; then
        log "  No tiles downloaded, skipping batch"
        continue
    fi

    # 2b: Rsync tiles to droplet
    log "  Syncing to droplet..."
    rsync -az "$LOCAL_TILES/" "$DROPLET:$DROPLET_DIR/naip_tiles/" 2>&1

    # 2c: Run detection on droplet for this batch's zips
    log "  Running detection on droplet..."
    ssh "$DROPLET" "cd $DROPLET_DIR && /root/miniconda3/envs/nrel/bin/python -u scan-naip-solar.py --zip $BATCH_ZIPS 2>&1" || {
        log "  WARNING: Detection had errors"
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    }

    # 2d: Rsync detection results back
    log "  Syncing results back..."
    rsync -az "$DROPLET:$DROPLET_DIR/naip_detections/" "$LOCAL_DETS/" 2>&1

    # Count detections in this batch
    for z in $(echo "$BATCH_ZIPS" | tr ',' '\n'); do
        if [ -f "$LOCAL_DETS/${z}.json" ]; then
            DETS=$(python3 -c "import json; d=json.load(open('$LOCAL_DETS/${z}.json')); print(d.get('merged_detections', 0))" 2>/dev/null || echo 0)
            TOTAL_DETECTED=$((TOTAL_DETECTED + DETS))
        fi
    done

    # 2e: Clean up tiles locally and on droplet
    log "  Cleaning up tiles..."
    rm -rf "$LOCAL_TILES"/*
    ssh "$DROPLET" "rm -rf $DROPLET_DIR/naip_tiles/*" 2>/dev/null

    log "  Batch $BATCH_NUM complete. Running totals: $TOTAL_DOWNLOADED tiles, $TOTAL_DETECTED detections, $TOTAL_ERRORS errors"

done < "$REMAINING_FILE"

# Cleanup temp files
rm -f "$ZIPS_FILE" "$REMAINING_FILE"

log "=========================================="
log "DOWNLOAD + DETECTION COMPLETE"
log "  Total tiles downloaded: $TOTAL_DOWNLOADED"
log "  Total detections: $TOTAL_DETECTED"
log "  Batch errors: $TOTAL_ERRORS"
log "=========================================="

# Step 5: Match detections to database records
log "STEP 5: Matching detections to database targets..."
python3 -u scripts/match-naip-detections.py 2>&1

log "=========================================="
log "PIPELINE COMPLETE"
log "=========================================="
log "Check data/naip_detections/match_report.json for results"

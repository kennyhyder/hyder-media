#!/bin/bash
# Wrapper to restart classification periodically to prevent OOM.
# Each run processes --limit images, then restarts with --skip-existing.
# Continues until no images remain.

BATCH=2000
LOGFILE="/root/solar-nrel/results/classify_batch3_wrapper.log"

echo "=== Classification wrapper started $(date) ===" | tee -a "$LOGFILE"
echo "  Batch size: $BATCH images per run" | tee -a "$LOGFILE"

RUN=1
while true; do
    echo "" | tee -a "$LOGFILE"
    echo "=== Run $RUN started $(date) ===" | tee -a "$LOGFILE"

    python3 -u classify-mount-type.py --skip-existing --limit $BATCH 2>&1 | tee -a "$LOGFILE"
    EXIT_CODE=$?

    # Check if "No images to classify" was printed (means we're done)
    if tail -5 "$LOGFILE" | grep -q "No images to classify"; then
        echo "" | tee -a "$LOGFILE"
        echo "=== All images classified! $(date) ===" | tee -a "$LOGFILE"
        break
    fi

    echo "  Run $RUN complete, restarting to free memory..." | tee -a "$LOGFILE"
    RUN=$((RUN + 1))

    # Brief pause between runs
    sleep 5
done

echo "=== Wrapper finished $(date) ===" | tee -a "$LOGFILE"

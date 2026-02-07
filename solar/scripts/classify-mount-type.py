#!/usr/bin/env python3
"""
Classify solar installation mount type from satellite images using NREL Panel-Segmentation.

Uses the NREL Panel-Segmentation model (Faster R-CNN ResNet-50 FPN) to classify
mount_type (ground-fixed, rooftop-fixed, carport-fixed, ground-single_axis_tracker)
from 640x640 satellite images downloaded by fetch-satellite-images.py.

Prerequisites:
    # Install Git LFS first (model files are ~3GB total)
    brew install git-lfs && git lfs install

    # Create a venv with Python 3.10 (model requires TF 2.13 + PyTorch)
    python3.10 -m venv .venv-nrel
    .venv-nrel/bin/pip install git+https://github.com/NREL/Panel-Segmentation.git@master
    .venv-nrel/bin/pip install git+https://github.com/open-mmlab/mmcv.git@v2.1.0

Usage:
    .venv-nrel/bin/python3 -u scripts/classify-mount-type.py                # Classify all
    .venv-nrel/bin/python3 -u scripts/classify-mount-type.py --limit 100    # First 100
    .venv-nrel/bin/python3 -u scripts/classify-mount-type.py --dry-run      # Count images only
    .venv-nrel/bin/python3 -u scripts/classify-mount-type.py --device cuda  # Use GPU
    .venv-nrel/bin/python3 -u scripts/classify-mount-type.py --confidence 0.5  # Lower threshold

Output: Updates solar_installations.mount_type column via Supabase PATCH.

Mount type mapping:
    ground-fixed             → "ground_fixed"
    ground-single_axis_tracker → "ground_single_axis"
    rooftop-fixed            → "rooftop"
    carport-fixed            → "carport"
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

IMAGE_DIR = Path("data/satellite_images")
BATCH_SIZE = 50
PATCH_WORKERS = 10

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

# Map NREL labels to our database values
MOUNT_TYPE_MAP = {
    "ground-fixed": "ground_fixed",
    "ground-single_axis_tracker": "ground_single_axis",
    "rooftop-fixed": "rooftop",
    "carport-fixed": "carport",
}


def supabase_patch(inst_id, data):
    """PATCH a single installation record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{inst_id}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=HEADERS, method="PATCH")
    try:
        resp = urllib.request.urlopen(req)
        return True, None
    except Exception as e:
        return False, str(e)


def classify_single(pd, image_path, confidence_cutoff):
    """
    Classify a single image using NREL Panel-Segmentation.

    Returns: (mount_type, confidence, num_panels) or (None, None, None) if no panels found.
    """
    import numpy as np
    from tensorflow.keras.preprocessing import image as imagex

    # Load and resize image
    img = imagex.load_img(str(image_path), color_mode="rgb", target_size=(640, 640))
    img_array = np.array(img)

    # Step 1: Check if panels exist
    has_panels = pd.hasPanels(img_array)
    if not has_panels:
        return None, 0.0, 0

    # Step 2: Classify mounting configuration
    try:
        scores, labels, boxes = pd.classifyMountingConfiguration(
            str(image_path),
            acc_cutoff=confidence_cutoff,
        )
    except Exception as e:
        return None, 0.0, 0

    if not labels:
        return None, 0.0, 0

    # Return the highest-confidence detection
    if scores:
        best_idx = scores.index(max(scores))
        return labels[best_idx], scores[best_idx], len(labels)
    return labels[0], confidence_cutoff, len(labels)


def main():
    parser = argparse.ArgumentParser(description="Classify mount type from satellite images")
    parser.add_argument("--dry-run", action="store_true", help="Count images without classifying")
    parser.add_argument("--limit", type=int, default=0, help="Max images to process (0 = all)")
    parser.add_argument("--confidence", type=float, default=0.65, help="Min confidence threshold")
    parser.add_argument("--device", type=str, default="cpu", help="Device: cpu or cuda")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip installations that already have mount_type set")
    args = parser.parse_args()

    print("NREL Panel-Segmentation Mount Type Classifier")
    print("=" * 60)
    print(f"  Image dir: {IMAGE_DIR}")
    print(f"  Confidence threshold: {args.confidence}")
    print(f"  Device: {args.device}")
    print(f"  Dry run: {args.dry_run}")
    print()

    # Find available images
    if not IMAGE_DIR.exists():
        print(f"ERROR: Image directory {IMAGE_DIR} does not exist.")
        print("Run fetch-satellite-images.py first to download satellite images.")
        sys.exit(1)

    image_files = sorted(IMAGE_DIR.glob("*.png"))
    print(f"  Available images: {len(image_files)}")

    if args.skip_existing and not args.dry_run:
        # Load installations that already have mount_type
        print("  Checking which installations already have mount_type...")
        existing_mount = set()
        offset = 0
        while True:
            url = (
                f"{SUPABASE_URL}/rest/v1/solar_installations"
                f"?select=id&mount_type=not.is.null&offset={offset}&limit=1000"
            )
            req = urllib.request.Request(url, headers={**HEADERS, "Prefer": "count=exact"})
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read())
            if not data:
                break
            for r in data:
                existing_mount.add(r["id"])
            offset += len(data)
            if len(data) < 1000:
                break
        print(f"  Already classified: {len(existing_mount)}")
        image_files = [f for f in image_files if f.stem not in existing_mount]
        print(f"  Remaining to classify: {len(image_files)}")

    if args.limit:
        image_files = image_files[:args.limit]
        print(f"  Limited to: {len(image_files)}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No classification performed.")
        # Estimate processing time
        per_image = 2.0 if args.device == "cpu" else 0.2  # seconds
        total_time = len(image_files) * per_image
        print(f"  Estimated time ({args.device}): {total_time/3600:.1f} hours")
        return

    if not image_files:
        print("\n  No images to classify!")
        return

    # Load NREL model
    print("\nLoading NREL Panel-Segmentation model...")
    try:
        from panel_segmentation.panel_detection import PanelDetection
        pd = PanelDetection()
        print("  Models loaded successfully.")
    except ImportError as e:
        print(f"ERROR: Could not import panel_segmentation: {e}")
        print("\nInstall with:")
        print("  brew install git-lfs && git lfs install")
        print("  python3.10 -m venv .venv-nrel")
        print("  .venv-nrel/bin/pip install git+https://github.com/NREL/Panel-Segmentation.git@master")
        print("  .venv-nrel/bin/pip install git+https://github.com/open-mmlab/mmcv.git@v2.1.0")
        sys.exit(1)

    # Process images
    print(f"\nClassifying {len(image_files)} images...")
    classified = 0
    no_panels = 0
    errors = 0
    patches_applied = 0
    patch_errors = 0
    results = {}  # mount_type -> count
    start_time = time.time()

    patches_queue = []

    def _apply_patches(patches):
        """Apply a batch of patches to Supabase."""
        nonlocal patches_applied, patch_errors
        with ThreadPoolExecutor(max_workers=PATCH_WORKERS) as executor:
            futures = []
            for inst_id, data in patches:
                futures.append(executor.submit(supabase_patch, inst_id, data))
            for f in futures:
                success, error = f.result()
                if success:
                    patches_applied += 1
                else:
                    patch_errors += 1

    for i, image_path in enumerate(image_files):
        inst_id = image_path.stem

        try:
            mount_label, confidence, num_detections = classify_single(
                pd, image_path, args.confidence
            )

            if mount_label:
                mount_type = MOUNT_TYPE_MAP.get(mount_label, mount_label)
                classified += 1
                results[mount_type] = results.get(mount_type, 0) + 1
                patches_queue.append((inst_id, {"mount_type": mount_type}))
            else:
                no_panels += 1

        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error on {inst_id}: {e}")

        # Apply patches in batches
        if len(patches_queue) >= BATCH_SIZE:
            _apply_patches(patches_queue)
            patches_queue = []

        # Progress
        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(image_files) - i - 1) / rate if rate > 0 else 0
            print(
                f"  Progress: {i+1}/{len(image_files)} "
                f"({classified} classified, {no_panels} no panels, {errors} errors, "
                f"{rate:.1f}/sec, ETA: {eta/60:.0f}min)"
            )

    # Apply remaining patches
    if patches_queue:
        _apply_patches(patches_queue)

    elapsed = time.time() - start_time
    print(f"\n{'=' * 60}")
    print("Classification Results")
    print(f"{'=' * 60}")
    print(f"  Processed: {len(image_files)}")
    print(f"  Classified: {classified}")
    print(f"  No panels detected: {no_panels}")
    print(f"  Errors: {errors}")
    print(f"  Patches applied: {patches_applied}")
    print(f"  Patch errors: {patch_errors}")
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"\n  Mount type breakdown:")
    for mt, count in sorted(results.items(), key=lambda x: -x[1]):
        print(f"    {mt}: {count}")

    print("\nDone!")


if __name__ == "__main__":
    main()

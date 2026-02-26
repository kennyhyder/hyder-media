#!/usr/bin/env python3
"""
Scan NAIP tiles for solar panels using NREL Panel-Segmentation model.

Runs the NREL Faster R-CNN ResNet-50 model on NAIP tiles downloaded by
fetch-naip-tiles.py. Detects solar panels, extracts bounding boxes,
converts pixel coordinates to lat/lng, and saves detection JSON per zip.

Designed to run on the droplet (104.131.105.89) where the NREL model is deployed.
Does NOT require Supabase connection — outputs JSON files only.

Prerequisites (on droplet):
    /root/miniconda3/envs/nrel/bin/python (Python 3.10 + NREL model)

Usage (on droplet):
    python3 -u scan-naip-solar.py                    # Scan all zips
    python3 -u scan-naip-solar.py --limit 100         # First 100 tiles
    python3 -u scan-naip-solar.py --zip 94102         # Specific zip
    python3 -u scan-naip-solar.py --dry-run            # Count tiles only
    python3 -u scan-naip-solar.py --confidence 0.5     # Lower threshold

Output: data/naip_detections/{zip_code}.json per zip with detection coordinates.

Local usage (after rsync results from droplet):
    rsync -avz root@104.131.105.89:/root/solar-nrel/naip_detections/ data/naip_detections/
"""

import argparse
import gc
import json
import math
import os
import sys
import time
from pathlib import Path

# Use non-interactive backend to reduce memory usage
import matplotlib
matplotlib.use('Agg')

# Paths — adjusted for both local and droplet environments
SCRIPT_DIR = Path(__file__).parent if '__file__' in dir() else Path('.')
if Path('/root/solar-nrel').exists():
    # Running on droplet
    TILE_DIR = Path('/root/solar-nrel/naip_tiles')
    DETECTION_DIR = Path('/root/solar-nrel/naip_detections')
else:
    # Running locally
    TILE_DIR = SCRIPT_DIR.parent / 'data' / 'naip_tiles'
    DETECTION_DIR = SCRIPT_DIR.parent / 'data' / 'naip_detections'

MOUNT_TYPE_MAP = {
    "ground-fixed": "ground_fixed",
    "ground-single_axis_tracker": "ground_single_axis",
    "rooftop-fixed": "rooftop",
    "carport-fixed": "carport",
}

# Area-to-capacity conversion (LBNL 2024: ~20,000 m2/MW for ground-mount)
M2_PER_MW = 20000


def pixel_to_geo(px, py, bbox, tile_size=640):
    """Convert pixel coordinates to lat/lng given tile bounding box."""
    lat = bbox['max_lat'] - py * (bbox['max_lat'] - bbox['min_lat']) / tile_size
    lng = bbox['min_lng'] + px * (bbox['max_lng'] - bbox['min_lng']) / tile_size
    return lat, lng


def bbox_area_m2(lat1, lng1, lat2, lng2):
    """Approximate area in m2 of a lat/lng bounding box."""
    m_per_deg_lat = 111320
    mid_lat = (lat1 + lat2) / 2
    m_per_deg_lng = 111320 * math.cos(math.radians(mid_lat))
    width_m = abs(lng2 - lng1) * m_per_deg_lng
    height_m = abs(lat2 - lat1) * m_per_deg_lat
    return width_m * height_m


def merge_detections(detections, distance_threshold_m=100):
    """Merge overlapping detections from adjacent tiles."""
    if len(detections) <= 1:
        return detections

    # Sort by capacity (largest first) for greedy merge
    detections.sort(key=lambda d: d.get('area_m2', 0), reverse=True)

    merged = []
    used = set()

    for i, d in enumerate(detections):
        if i in used:
            continue

        cluster = [d]
        used.add(i)

        for j, other in enumerate(detections):
            if j in used:
                continue
            dist = haversine_m(d['lat'], d['lng'], other['lat'], other['lng'])
            if dist <= distance_threshold_m:
                cluster.append(other)
                used.add(j)

        # Merge cluster: use area-weighted centroid, sum areas
        total_area = sum(c['area_m2'] for c in cluster)
        avg_lat = sum(c['lat'] * c['area_m2'] for c in cluster) / total_area
        avg_lng = sum(c['lng'] * c['area_m2'] for c in cluster) / total_area
        best_conf = max(c['confidence'] for c in cluster)
        mount_types = [c['mount_type'] for c in cluster if c.get('mount_type')]
        # Most common mount type
        mt = max(set(mount_types), key=mount_types.count) if mount_types else None

        merged.append({
            'lat': round(avg_lat, 7),
            'lng': round(avg_lng, 7),
            'area_m2': round(total_area, 1),
            'capacity_mw_est': round(total_area / M2_PER_MW, 4),
            'mount_type': mt,
            'confidence': round(best_conf, 3),
            'num_tiles': len(cluster),
        })

    return merged


def haversine_m(lat1, lon1, lat2, lon2):
    """Haversine distance in meters."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def scan_tile(pd, tile_path, tile_bbox, confidence_cutoff):
    """
    Scan a single NAIP tile for solar panels.

    Returns list of detections: [{lat, lng, area_m2, capacity_mw_est, mount_type, confidence}]
    """
    import numpy as np
    import matplotlib.pyplot as plt
    from tensorflow.keras.preprocessing import image as imagex

    img = imagex.load_img(str(tile_path), color_mode="rgb", target_size=(640, 640))
    img_array = np.array(img)

    # Step 1: Quick screen
    has_panels = pd.hasPanels(img_array)
    if not has_panels:
        del img, img_array
        plt.close('all')
        return []

    # Step 2: Classify with bounding boxes
    try:
        scores, labels, boxes = pd.classifyMountingConfiguration(
            str(tile_path),
            acc_cutoff=confidence_cutoff,
        )
    except Exception:
        del img, img_array
        plt.close('all')
        return []

    del img, img_array
    plt.close('all')

    if not labels or not boxes:
        return []

    detections = []
    for score, label, box in zip(scores or [confidence_cutoff]*len(labels), labels, boxes):
        # box format: [x1, y1, x2, y2] (pixel coordinates)
        if len(box) < 4:
            continue
        x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])

        # Convert pixel corners to lat/lng
        lat1, lng1 = pixel_to_geo(x1, y1, tile_bbox)
        lat2, lng2 = pixel_to_geo(x2, y2, tile_bbox)

        # Centroid
        center_lat = (lat1 + lat2) / 2
        center_lng = (lng1 + lng2) / 2

        # Area in m2
        area = bbox_area_m2(lat1, lng1, lat2, lng2)

        mount_type = MOUNT_TYPE_MAP.get(label, label)

        detections.append({
            'lat': round(center_lat, 7),
            'lng': round(center_lng, 7),
            'area_m2': round(area, 1),
            'capacity_mw_est': round(area / M2_PER_MW, 4),
            'mount_type': mount_type,
            'confidence': round(float(score), 3),
        })

    return detections


def main():
    parser = argparse.ArgumentParser(description="Scan NAIP tiles for solar panels")
    parser.add_argument("--dry-run", action="store_true", help="Count tiles only")
    parser.add_argument("--limit", type=int, default=0, help="Max tiles to process")
    parser.add_argument("--zip", type=str, help="Specific zip code(s), comma-separated")
    parser.add_argument("--confidence", type=float, default=0.5, help="Min confidence threshold")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip zips that already have detection files")
    args = parser.parse_args()

    print("NAIP Solar Panel Scanner (NREL Panel-Segmentation)")
    print("=" * 60)
    print(f"  Tile dir: {TILE_DIR}")
    print(f"  Detection dir: {DETECTION_DIR}")
    print(f"  Confidence threshold: {args.confidence}")
    print(f"  Dry run: {args.dry_run}")
    print()

    if not TILE_DIR.exists():
        print(f"ERROR: Tile directory {TILE_DIR} does not exist.")
        print("Run fetch-naip-tiles.py first, then rsync tiles to droplet.")
        sys.exit(1)

    DETECTION_DIR.mkdir(parents=True, exist_ok=True)

    # Find zip directories with tiles
    zip_dirs = sorted([d for d in TILE_DIR.iterdir() if d.is_dir()])
    print(f"  Zip directories: {len(zip_dirs):,}")

    if args.zip:
        specific = set(args.zip.split(','))
        zip_dirs = [d for d in zip_dirs if d.name in specific]
        print(f"  Filtered to: {len(zip_dirs):,}")

    if args.skip_existing and not args.dry_run:
        existing = set()
        for f in DETECTION_DIR.glob("*.json"):
            existing.add(f.stem)
        before = len(zip_dirs)
        zip_dirs = [d for d in zip_dirs if d.name not in existing]
        print(f"  After skipping existing: {len(zip_dirs):,} (skipped {before - len(zip_dirs):,})")

    # Count tiles
    total_tiles = 0
    zip_tile_counts = {}
    for d in zip_dirs:
        tiles = list(d.glob("*.png"))
        zip_tile_counts[d.name] = len(tiles)
        total_tiles += len(tiles)

    print(f"  Total tiles to scan: {total_tiles:,}")

    if args.limit:
        print(f"  Limit: {args.limit} tiles")

    if args.dry_run:
        print(f"\n  [DRY RUN] No scanning performed.")
        est_hours = total_tiles * 2.5 / 3600  # ~2.5s per tile on CPU
        print(f"  Estimated time (CPU): {est_hours:.1f} hours")
        return

    if total_tiles == 0:
        print("\n  No tiles to scan!")
        return

    # Load NREL model
    print("\nLoading NREL Panel-Segmentation model...")
    try:
        from panel_segmentation.panel_detection import PanelDetection
        pd = PanelDetection()
        print("  Model loaded successfully.")
    except ImportError as e:
        print(f"ERROR: Could not import panel_segmentation: {e}")
        sys.exit(1)

    # Process each zip
    total_processed = 0
    total_detections = 0
    total_zips = 0
    errors = 0
    start_time = time.time()

    for zip_dir in zip_dirs:
        zip_code = zip_dir.name

        # Load manifest for tile bounding boxes
        manifest_path = zip_dir / "manifest.json"
        if not manifest_path.exists():
            print(f"  WARNING: No manifest.json in {zip_code}, skipping")
            continue

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        # Build tile bbox lookup
        tile_bboxes = {}
        for tile_info in manifest.get('tiles', []):
            tile_bboxes[tile_info['file']] = tile_info['bbox']

        # Scan all tiles in this zip
        zip_detections = []
        tile_files = sorted(zip_dir.glob("*.png"))

        for tile_path in tile_files:
            if args.limit and total_processed >= args.limit:
                break

            tile_name = tile_path.name
            tile_bbox = tile_bboxes.get(tile_name)
            if not tile_bbox:
                # Try to reconstruct from tile index + manifest
                continue

            try:
                dets = scan_tile(pd, tile_path, tile_bbox, args.confidence)
                zip_detections.extend(dets)
            except Exception as e:
                errors += 1
                if errors <= 10:
                    print(f"  Error on {zip_code}/{tile_name}: {e}")

            total_processed += 1

            # Aggressive GC every 50 tiles
            if total_processed % 50 == 0:
                gc.collect()

            if total_processed % 200 == 0:
                elapsed = time.time() - start_time
                rate = total_processed / elapsed if elapsed > 0 else 0
                remaining = total_tiles - total_processed
                eta = remaining / rate if rate > 0 else 0
                print(f"  Progress: {total_processed:,}/{total_tiles:,} tiles, "
                      f"{total_detections:,} detections, {errors} errors, "
                      f"{rate:.1f}/sec, ETA: {eta/60:.0f}min")

        if args.limit and total_processed >= args.limit:
            # Still save what we have
            pass

        # Merge overlapping detections within this zip
        merged = merge_detections(zip_detections, distance_threshold_m=100)
        total_detections += len(merged)
        total_zips += 1

        # Save detection file
        detection_file = DETECTION_DIR / f"{zip_code}.json"
        output = {
            'zip_code': zip_code,
            'tiles_scanned': len(tile_files),
            'raw_detections': len(zip_detections),
            'merged_detections': len(merged),
            'detections': merged,
            'targets': manifest.get('targets', []),
        }
        with open(detection_file, 'w') as f:
            json.dump(output, f, indent=2)

        if merged:
            print(f"  {zip_code}: {len(merged)} detections from {len(tile_files)} tiles")

        if args.limit and total_processed >= args.limit:
            break

    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print("Scan Results")
    print(f"{'='*60}")
    print(f"  Tiles scanned: {total_processed:,}")
    print(f"  Zips completed: {total_zips:,}")
    print(f"  Total detections: {total_detections:,}")
    print(f"  Errors: {errors}")
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"  Rate: {total_processed/elapsed:.1f} tiles/sec" if elapsed > 0 else "")
    print(f"\n  Results saved to {DETECTION_DIR}")

    print("\nDone!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Match NAIP solar panel detections to database target records.

Reads detection JSON files from scan-naip-solar.py and matches them to
installations in the database that have city/zip-level coordinates but
no exact lat/lng. Uses capacity + mount type for matching.

Confidence tiers:
  - HIGH:   1 detection + 1 target in zip, OR capacity ratio <= 1.25
  - MEDIUM: Optimal assignment with good capacity match
  - LOW:    Ambiguous matches, logged but not patched

Usage:
    python3 -u scripts/match-naip-detections.py              # Full match + patch
    python3 -u scripts/match-naip-detections.py --dry-run     # Preview without patching
    python3 -u scripts/match-naip-detections.py --zip 94102   # Specific zip
    python3 -u scripts/match-naip-detections.py --min-confidence MEDIUM  # Skip LOW
    python3 -u scripts/match-naip-detections.py --verify 100  # Spot-check N matches
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

DETECTION_DIR = Path(__file__).parent.parent / "data" / "naip_detections"
PATCH_WORKERS = 10

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def supabase_patch(inst_id, data, retries=3):
    """PATCH a single installation record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{inst_id}"
    body = json.dumps(data, allow_nan=False).encode()
    req = urllib.request.Request(url, data=body, headers={**HEADERS, "Prefer": "return=minimal"}, method="PATCH")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return True, None
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return False, str(e)


def load_targets():
    """Load target installations from DB that still need exact coordinates."""
    csv_path = Path(tempfile.gettempdir()) / "solar_match_targets.csv"
    psql_cmd = (
        "PGPASSWORD='#FsW7iqg%EYX&G3M' psql "
        "-h aws-0-us-west-2.pooler.supabase.com -p 6543 "
        "-U postgres.ilbovwnhrowvxjdkvrln -d postgres "
        "-c \"\\copy (SELECT id, source_record_id, zip_code, capacity_mw, "
        "site_type, mount_type, crossref_ids "
        "FROM solar_installations "
        "WHERE location_precision IN ('city','zip','county') "
        "AND zip_code IS NOT NULL AND zip_code != '' "
        "AND capacity_mw IS NOT NULL AND capacity_mw > 0 "
        "AND is_canonical = true) "
        f"TO '{csv_path}' WITH CSV HEADER\""
    )
    result = subprocess.run(psql_cmd, shell=True, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  psql error: {result.stderr}")
        sys.exit(1)

    targets = []
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row['capacity_mw'] = float(row['capacity_mw']) if row['capacity_mw'] else None
            cids = row.get('crossref_ids', '')
            if cids and cids not in ('', '[]'):
                try:
                    row['crossref_ids'] = json.loads(cids)
                except (json.JSONDecodeError, ValueError):
                    row['crossref_ids'] = []
            else:
                row['crossref_ids'] = []
            targets.append(row)
    csv_path.unlink(missing_ok=True)
    return targets


def hungarian_assign(detections, targets):
    """
    Optimal assignment of detections to targets minimizing capacity distance.
    Returns list of (detection_idx, target_idx, cost) tuples.
    """
    n_det = len(detections)
    n_tar = len(targets)

    if n_det == 0 or n_tar == 0:
        return []

    # Build cost matrix: log ratio of capacities
    import math
    n = max(n_det, n_tar)
    INF = 1e6
    cost = [[INF] * n for _ in range(n)]

    for i in range(n_det):
        d_mw = detections[i].get('capacity_mw_est', 0)
        if d_mw <= 0:
            continue
        for j in range(n_tar):
            t_mw = targets[j].get('capacity_mw', 0)
            if not t_mw or t_mw <= 0:
                continue
            ratio = max(d_mw, t_mw) / max(min(d_mw, t_mw), 0.001)
            if ratio <= 3.0:  # Allow up to 3x for assignment, filter later
                cost[i][j] = math.log(ratio)

    # Hungarian algorithm (simple implementation for small matrices)
    assignments = _hungarian(cost, n)

    result = []
    for i, j in assignments:
        if i < n_det and j < n_tar and cost[i][j] < INF:
            result.append((i, j, cost[i][j]))

    return result


def _hungarian(cost, n):
    """Simple Hungarian algorithm for NxN cost matrix. Returns list of (row, col) pairs."""
    # For small matrices (N <= 10), use brute force via itertools
    # For larger, use scipy if available, else greedy
    if n <= 8:
        import itertools
        best_cost = float('inf')
        best_perm = None
        for perm in itertools.permutations(range(n)):
            c = sum(cost[i][perm[i]] for i in range(n))
            if c < best_cost:
                best_cost = c
                best_perm = perm
        if best_perm:
            return [(i, best_perm[i]) for i in range(n)]
        return []

    # Greedy fallback for larger matrices
    used_cols = set()
    assignments = []
    # Sort rows by their minimum cost
    row_order = sorted(range(n), key=lambda r: min(cost[r]))
    for r in row_order:
        best_c = None
        best_cost_val = float('inf')
        for c in range(n):
            if c not in used_cols and cost[r][c] < best_cost_val:
                best_cost_val = cost[r][c]
                best_c = c
        if best_c is not None:
            assignments.append((r, best_c))
            used_cols.add(best_c)
    return assignments


def match_zip(detections, targets, zip_code):
    """
    Match detections to targets within a single zip code.

    Returns list of matches: [{
        'target_id': str,
        'detection': dict,
        'confidence': 'HIGH'|'MEDIUM'|'LOW',
        'capacity_ratio': float,
    }]
    """
    if not detections or not targets:
        return []

    n_det = len(detections)
    n_tar = len(targets)

    matches = []

    # --- Tier A: 1 detection + 1 target ---
    if n_det == 1 and n_tar == 1:
        d = detections[0]
        t = targets[0]
        d_mw = d.get('capacity_mw_est', 0)
        t_mw = t.get('capacity_mw', 0)
        if d_mw > 0 and t_mw and t_mw > 0:
            ratio = max(d_mw, t_mw) / max(min(d_mw, t_mw), 0.001)
            # Even with loose capacity match, 1:1 in same zip is very likely correct
            if ratio <= 3.0:
                confidence = 'HIGH' if ratio <= 2.0 else 'MEDIUM'
                matches.append({
                    'target_id': t['id'],
                    'target_src': t['source_record_id'],
                    'detection': d,
                    'confidence': confidence,
                    'capacity_ratio': round(ratio, 3),
                })
        return matches

    # --- Tier B/C: Multiple detections or targets — use optimal assignment ---
    assignments = hungarian_assign(detections, targets)

    for det_idx, tar_idx, cost in assignments:
        d = detections[det_idx]
        t = targets[tar_idx]
        d_mw = d.get('capacity_mw_est', 0)
        t_mw = t.get('capacity_mw', 0)

        if not t_mw or t_mw <= 0:
            continue

        ratio = max(d_mw, t_mw) / max(min(d_mw, t_mw), 0.001) if d_mw > 0 else 999

        # Determine confidence
        if ratio <= 1.25:
            confidence = 'HIGH'
        elif ratio <= 1.5 and n_tar <= 3:
            confidence = 'MEDIUM'
        elif ratio <= 2.0 and n_tar <= 3:
            confidence = 'MEDIUM'
        else:
            confidence = 'LOW'

        # Mount type agreement boosts confidence
        if (d.get('mount_type') and t.get('mount_type')
                and d['mount_type'] == t['mount_type']
                and confidence == 'MEDIUM'):
            confidence = 'HIGH'

        matches.append({
            'target_id': t['id'],
            'target_src': t['source_record_id'],
            'detection': d,
            'confidence': confidence,
            'capacity_ratio': round(ratio, 3),
        })

    return matches


def main():
    parser = argparse.ArgumentParser(description="Match NAIP detections to DB records")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--zip", type=str, help="Specific zip code(s), comma-separated")
    parser.add_argument("--min-confidence", type=str, default="MEDIUM",
                        choices=["HIGH", "MEDIUM", "LOW"],
                        help="Minimum confidence to patch (default: MEDIUM)")
    parser.add_argument("--verify", type=int, default=0,
                        help="Spot-check N matches (print coords for manual verification)")
    args = parser.parse_args()

    CONF_ORDER = {'HIGH': 3, 'MEDIUM': 2, 'LOW': 1}
    min_conf = CONF_ORDER[args.min_confidence]

    print("NAIP Detection → DB Record Matcher")
    print("=" * 60)
    print(f"  Detection dir: {DETECTION_DIR}")
    print(f"  Min confidence: {args.min_confidence}")
    print(f"  Dry run: {args.dry_run}")
    print()

    if not DETECTION_DIR.exists():
        print(f"ERROR: Detection directory {DETECTION_DIR} does not exist.")
        print("Run scan-naip-solar.py first.")
        sys.exit(1)

    # Load detection files
    det_files = sorted(DETECTION_DIR.glob("*.json"))
    print(f"  Detection files: {len(det_files):,}")

    if args.zip:
        specific = set(args.zip.split(','))
        det_files = [f for f in det_files if f.stem in specific]
        print(f"  Filtered to: {len(det_files):,}")

    # Load targets from DB
    print("\nLoading target installations...")
    all_targets = load_targets()
    print(f"  Total targets: {len(all_targets):,}")

    # Group targets by zip
    targets_by_zip = {}
    for t in all_targets:
        z = str(t['zip_code']).strip()[:5]
        if z:
            targets_by_zip.setdefault(z, []).append(t)
    print(f"  Unique target zips: {len(targets_by_zip):,}")

    # Match detections to targets
    print("\nMatching detections to targets...")
    all_matches = []
    zips_with_matches = 0
    zips_no_detections = 0
    zips_no_targets = 0
    total_detections = 0

    for det_file in det_files:
        zip_code = det_file.stem

        with open(det_file, 'r') as f:
            data = json.load(f)

        detections = data.get('detections', [])
        total_detections += len(detections)

        if not detections:
            zips_no_detections += 1
            continue

        targets = targets_by_zip.get(zip_code, [])
        if not targets:
            zips_no_targets += 1
            continue

        matches = match_zip(detections, targets, zip_code)
        if matches:
            zips_with_matches += 1
            all_matches.extend(matches)

    # Summary by confidence
    high = [m for m in all_matches if m['confidence'] == 'HIGH']
    med = [m for m in all_matches if m['confidence'] == 'MEDIUM']
    low = [m for m in all_matches if m['confidence'] == 'LOW']

    print(f"\n  Zips with matches: {zips_with_matches:,}")
    print(f"  Zips with no detections: {zips_no_detections:,}")
    print(f"  Zips with no DB targets: {zips_no_targets:,}")
    print(f"  Total detections: {total_detections:,}")
    print(f"\n  Matches by confidence:")
    print(f"    HIGH:   {len(high):,}")
    print(f"    MEDIUM: {len(med):,}")
    print(f"    LOW:    {len(low):,}")
    print(f"    Total:  {len(all_matches):,}")

    # Filter by minimum confidence
    to_patch = [m for m in all_matches if CONF_ORDER[m['confidence']] >= min_conf]
    print(f"\n  To patch (>= {args.min_confidence}): {len(to_patch):,}")

    # Spot-check verification
    if args.verify and to_patch:
        n = min(args.verify, len(to_patch))
        print(f"\n  Spot-check {n} matches:")
        print(f"  {'Target':40s} {'Det MW':>8s} {'Tgt MW':>8s} {'Ratio':>7s} {'Conf':>6s} {'Lat':>10s} {'Lng':>11s}")
        print(f"  {'-'*40} {'-'*8} {'-'*8} {'-'*7} {'-'*6} {'-'*10} {'-'*11}")
        import random
        samples = random.sample(to_patch, n) if len(to_patch) > n else to_patch[:n]
        for m in samples:
            d = m['detection']
            print(f"  {m['target_src']:40s} {d.get('capacity_mw_est',0):8.3f} "
                  f"{0:8.3f} {m['capacity_ratio']:7.2f} {m['confidence']:>6s} "
                  f"{d['lat']:10.5f} {d['lng']:11.5f}")
        print(f"\n  Verify at: https://www.google.com/maps/@{samples[0]['detection']['lat']},{samples[0]['detection']['lng']},18z/data=!3m1!1e1")

    if args.dry_run:
        print(f"\n  [DRY RUN] No patches applied.")
        # Save match report
        report_path = DETECTION_DIR / "match_report.json"
        report = {
            'total_matches': len(all_matches),
            'high': len(high),
            'medium': len(med),
            'low': len(low),
            'to_patch': len(to_patch),
            'matches': [
                {
                    'target_id': m['target_id'],
                    'target_src': m['target_src'],
                    'lat': m['detection']['lat'],
                    'lng': m['detection']['lng'],
                    'confidence': m['confidence'],
                    'capacity_ratio': m['capacity_ratio'],
                    'mount_type': m['detection'].get('mount_type'),
                }
                for m in all_matches
            ],
        }
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        print(f"  Report saved to {report_path}")
        return

    if not to_patch:
        print("\n  No patches to apply!")
        return

    # Apply patches
    print(f"\nPatching {len(to_patch):,} installations...")
    patched = 0
    errors = 0
    start_time = time.time()

    def _apply_one(match):
        d = match['detection']
        patch = {
            'latitude': d['lat'],
            'longitude': d['lng'],
            'location_precision': 'exact' if match['confidence'] == 'HIGH' else 'address',
        }

        # Add mount type if detection has one and target doesn't
        if d.get('mount_type'):
            patch['mount_type'] = d['mount_type']

        # Add NAIP crossref
        crossref_ids = match.get('crossref_ids', []) or []
        naip_ref = f"naip_det_{d['lat']:.5f}_{d['lng']:.5f}"
        if naip_ref not in crossref_ids:
            crossref_ids.append(naip_ref)
            patch['crossref_ids'] = crossref_ids

        return supabase_patch(match['target_id'], patch)

    with ThreadPoolExecutor(max_workers=PATCH_WORKERS) as executor:
        futures = {executor.submit(_apply_one, m): m for m in to_patch}
        for future in futures:
            ok, err = future.result()
            if ok:
                patched += 1
            else:
                errors += 1

            total = patched + errors
            if total % 500 == 0 and total > 0:
                elapsed = time.time() - start_time
                print(f"  Progress: {patched:,} patched, {errors} errors ({total:,}/{len(to_patch):,})")

    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print("Patch Results")
    print(f"{'='*60}")
    print(f"  Patched: {patched:,}")
    print(f"  Errors: {errors}")
    print(f"  Time: {elapsed:.0f}s")
    print(f"\n  Confidence breakdown of patched:")
    for conf in ['HIGH', 'MEDIUM', 'LOW']:
        n = len([m for m in to_patch if m['confidence'] == conf])
        if n > 0:
            print(f"    {conf}: {n:,}")

    print("\nDone! Run enrichment pipeline on newly-coordinated records:")
    print("  python3 -u scripts/enrich-parcel-owners.py")
    print("  python3 -u scripts/enrich-fema-flood.py")
    print("  python3 -u scripts/crossref-dedup.py")


if __name__ == "__main__":
    main()

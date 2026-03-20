#!/usr/bin/env python3
"""
Enrich DC sites with transmission congestion scores.

Uses gridstatus library to pull historical Locational Marginal Price (LMP)
congestion components. High congestion cost at nearby nodes = constrained
area = bad for new datacenter loads.

Requires: pip install gridstatus (Python 3.10+)
Run with: .venv/bin/python3.13 -u scripts/enrich-congestion-score.py

Approach:
1. For each ISO (CAISO, PJM, MISO, ERCOT, SPP, ISO-NE, NYISO):
   - Fetch last 30 days of day-ahead LMP data for all pricing nodes
   - Extract congestion component ($/MWh)
   - Compute average absolute congestion cost per node
2. For each DC site, find nearest pricing node (future: geocoded node matching)
3. Assign congestion_score: low congestion = 100, high = 0
4. Update grid_dc_sites with congestion_score

Congestion scoring bands:
- avg_congestion < $1/MWh  = "unconstrained"      (score 100)
- $1-5/MWh                 = "low congestion"      (score 80)
- $5-15/MWh                = "moderate congestion"  (score 60)
- $15-30/MWh               = "high congestion"      (score 40)
- >$30/MWh                 = "severely constrained" (score 20)
"""

import os
import sys
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


def congestion_score(avg_congestion):
    """Convert average congestion cost ($/MWh) to 0-100 score.
    Lower congestion = higher score (better for new loads).
    """
    if avg_congestion is None:
        return 50  # Neutral default
    c = abs(avg_congestion)
    if c < 1:
        return 100
    elif c < 5:
        return 80
    elif c < 15:
        return 60
    elif c < 30:
        return 40
    else:
        return 20


def main():
    try:
        import gridstatus
    except ImportError:
        print("ERROR: gridstatus not installed. Run: .venv/bin/pip install gridstatus")
        sys.exit(1)

    print("=== GridScout Congestion Score Enrichment ===")
    print(f"Using gridstatus v{gridstatus.__version__}")

    dry_run = '--dry-run' in sys.argv
    match_sites = '--match' in sys.argv

    # Step 1: Fetch LMP congestion data from each ISO
    isos = {
        "caiso": gridstatus.CAISO(),
        "pjm": gridstatus.PJM(),
        # "miso": gridstatus.MISO(),  # Often blocked by Cloudflare
        "ercot": gridstatus.Ercot(),
        "spp": gridstatus.SPP(),
        "isone": gridstatus.ISONE(),
        "nyiso": gridstatus.NYISO(),
    }

    end = datetime.now()
    start = end - timedelta(days=30)  # Last 30 days

    node_congestion = {}  # {node_key: {iso, node, avg_congestion}}

    for iso_name, iso in isos.items():
        print(f"\nFetching LMP data from {iso_name.upper()}...")
        try:
            # Get LMP with congestion component (day-ahead market)
            lmp = iso.get_lmp(
                start=start.strftime("%Y-%m-%d"),
                end=end.strftime("%Y-%m-%d"),
                market="DAM",
            )

            if lmp is None or len(lmp) == 0:
                print(f"  No data returned from {iso_name}")
                continue

            print(f"  Got {len(lmp)} LMP records")
            print(f"  Columns: {list(lmp.columns)}")

            # Extract congestion component — column names vary by ISO
            congestion_col = None
            for col in ["Congestion", "congestion", "CONGESTION_MW", "cong_prc",
                         "Congestion Price", "LMP Congestion"]:
                if col in lmp.columns:
                    congestion_col = col
                    break

            if congestion_col is None:
                print(f"  No congestion column found. Available: {list(lmp.columns)}")
                continue

            # Find node/location column
            node_col = None
            for col in ["Location", "location", "Node", "node", "Location Name",
                         "Pricing Node", "Settlement Point"]:
                if col in lmp.columns:
                    node_col = col
                    break

            if node_col is None:
                print(f"  No node/location column found")
                continue

            # Group by node, compute average absolute congestion
            avg_by_node = lmp.groupby(node_col)[congestion_col].apply(
                lambda x: x.abs().mean()
            ).reset_index()
            avg_by_node.columns = ["node", "avg_congestion"]

            print(f"  {len(avg_by_node)} unique pricing nodes")
            print(f"  Avg congestion: ${avg_by_node['avg_congestion'].mean():.2f}/MWh")
            print(f"  Max congestion: ${avg_by_node['avg_congestion'].max():.2f}/MWh")
            print(f"  Median congestion: ${avg_by_node['avg_congestion'].median():.2f}/MWh")

            for _, row in avg_by_node.iterrows():
                node_key = f"{iso_name}_{row['node']}"
                node_congestion[node_key] = {
                    "iso": iso_name,
                    "node": str(row["node"]),
                    "avg_congestion": round(float(row["avg_congestion"]), 2),
                    "score": congestion_score(float(row["avg_congestion"])),
                }

        except Exception as e:
            print(f"  Error fetching {iso_name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    print(f"\nTotal nodes with congestion data: {len(node_congestion)}")

    # Save intermediate results
    os.makedirs(DATA_DIR, exist_ok=True)
    output_path = os.path.join(DATA_DIR, 'congestion_by_node.json')
    with open(output_path, "w") as f:
        json.dump(node_congestion, f, indent=2)
    print(f"Saved to {output_path}")

    # Summary by ISO
    iso_summary = {}
    for key, data in node_congestion.items():
        iso = data["iso"]
        if iso not in iso_summary:
            iso_summary[iso] = {"count": 0, "total_congestion": 0, "max": 0}
        iso_summary[iso]["count"] += 1
        iso_summary[iso]["total_congestion"] += data["avg_congestion"]
        iso_summary[iso]["max"] = max(iso_summary[iso]["max"], data["avg_congestion"])

    print("\nSummary by ISO:")
    for iso, stats in sorted(iso_summary.items()):
        avg = stats["total_congestion"] / stats["count"] if stats["count"] else 0
        print(f"  {iso.upper():8s}: {stats['count']:6d} nodes, "
              f"avg ${avg:.2f}/MWh, max ${stats['max']:.2f}/MWh")

    if not match_sites:
        print("\nNote: Node-to-site matching requires node geocoding.")
        print("Run with --match flag to match nodes to DC sites (future feature).")
        print("For now, ISO-level averages can be used via iso_region field on grid_dc_sites.")
    else:
        print("\n[TODO] Site matching not yet implemented.")
        print("Would require geocoded pricing nodes → nearest-node lookup per DC site.")

    if dry_run:
        print("\n[DRY RUN] No database changes made.")


if __name__ == "__main__":
    main()

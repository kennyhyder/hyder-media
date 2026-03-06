#!/usr/bin/env python3
"""
Seed grid_wecc_paths table with WECC Path Rating Catalog data (2024 edition).

Source: WECC 2024 Path Rating Catalog (55 active paths)
Target: grid_wecc_paths table

Each path has forward/reverse TTC (Total Transfer Capability) ratings in MW.
OTC (Operating Transfer Capability) is not available in the public catalog.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50


def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data, allow_nan=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                print(f"  HTTP {e.code}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                print(f"  Error: {e}, retrying in {2 ** attempt}s...")
                time.sleep(2 ** attempt)
                continue
            raise


def get_data_source_id():
    result = supabase_request('GET', 'grid_data_sources?name=eq.wecc_paths&select=id')
    if result and len(result) > 0:
        return result[0]['id']
    print("ERROR: wecc_paths data source not found in grid_data_sources. Run schema.sql first.")
    sys.exit(1)


# ─── WECC Path Rating Data (2024 Path Rating Catalog) ───
# Each tuple: (path_number, path_name, dir1_label, mw1, dir2_label, mw2, states)

WECC_PATHS = [
    (1, "Alberta-British Columbia", "E to W", 1000, "W to E", 1200, ["AB", "BC"]),
    (2, "Alberta-Saskatchewan", "E to W", 150, "W to E", 150, ["AB", "SK"]),
    (3, "Northwest-British Columbia", "N to S", 3150, "S to N", 3000, ["WA", "BC"]),
    (4, "West of Cascades-North", "E to W", 10700, "W to E", 10700, ["WA"]),
    (5, "West of Cascades-South", "E to W", 7200, "W to E", 7200, ["OR", "WA"]),
    (6, "West of Hatwai", "E to W", 4277, "W to E", None, ["WA", "ID"]),
    (8, "Montana-to-Northwest", "E to W", 2200, "W to E", 1350, ["MT", "ID"]),
    (14, "Idaho-to-Northwest", "E to W", 2400, "W to E", 1200, ["ID", "OR"]),
    (15, "Midway-Los Banos", "N to S", 3265, "S to N", 5400, ["CA"]),
    (16, "Idaho-Sierra", "N to S", 500, "S to N", 360, ["ID", "NV"]),
    (17, "Borah West", "E to W", 2557, "W to E", 1600, ["ID"]),
    (18, "Montana-Idaho", "N to S", 383, "S to N", 256, ["MT", "ID"]),
    (19, "Bridger West (Pre-Gateway)", "E to W", 2400, "W to E", 1250, ["WY", "ID"]),
    (20, "Path C (Pre-Gateway)", "N to S", 1600, "S to N", 1250, ["UT", "ID"]),
    (24, "PG&E-Sierra", "W to E", 160, "E to W", 150, ["CA", "NV"]),
    (25, "PacifiCorp/PG&E 115 kV", "N to S", 100, "S to N", 150, ["CA", "OR"]),
    (26, "Northern-Southern California", "N to S", 4000, "S to N", 3000, ["CA"]),
    (27, "IPP DC Line", "NE to SW", 2400, "SW to NE", 1400, ["UT", "CA"]),
    (28, "Intermountain-Mona 345 kV", "E to W", 1200, "W to E", 1400, ["UT"]),
    (29, "Intermountain-Gonder 230 kV", "E to W", 200, "W to E", 241, ["UT"]),
    (30, "TOT 1A", "E to W", 650, "W to E", None, ["CO"]),
    (31, "TOT 2A", "N to S", 690, "S to N", None, ["NM", "CO"]),
    (32, "Pavant-Gonder 230 kV", "E to W", 500, "W to E", 235, ["UT", "NV"]),
    (33, "Bonanza West", "E to W", 785, "W to E", None, ["UT"]),
    (35, "TOT 2C", "N to S", 600, "S to N", 580, ["UT", "NV"]),
    (36, "TOT 3", "N to S", 1843, "S to N", None, ["WY", "CO"]),
    (38, "TOT 4B", "SE to NW", 880, "NW to SE", None, ["WY"]),
    (39, "TOT 5", "W to E", 1680, "E to W", None, ["CO"]),
    (40, "TOT 7", "N to S", 890, "S to N", None, ["CO"]),
    (41, "Sylmar to SCE", "N to S", 1600, "S to N", 1600, ["CA"]),
    (42, "IID-SCE", "E to W", 750, "W to E", None, ["CA"]),
    (45, "SDG&E-CFE", "N to S", 600, "S to N", 800, ["CA"]),
    (46, "West of Colorado River (WOR)", "E to W", 11200, "W to E", 11200, ["AZ", "NV", "CA"]),
    (47, "Southern New Mexico (NM1)", "N to S", 1048, "S to N", 1048, ["NM", "AZ"]),
    (48, "Northern New Mexico (NM2)", "N to S", 2150, "S to N", 2150, ["NM", "CO"]),
    (49, "East of Colorado River (EOR)", "E to W", 10100, "W to E", None, ["AZ", "NV"]),
    (52, "Silver Peak-Control 55 kV", "E to W", 17, "W to E", 17, ["NV"]),
    (54, "Coronado-Silver King 500 kV", "N to S", 1494, "S to N", None, ["AZ"]),
    (55, "Brownlee East", "W to E", 1915, "E to W", None, ["ID", "OR"]),
    (58, "Eldorado-Mead 230 kV", "E to W", 1140, "W to E", 1140, ["NV"]),
    (59, "WALC/SCE Blythe 161 kV", "E to W", 218, "W to E", None, ["AZ", "CA"]),
    (60, "Inyo-Control 115 kV", "E to W", 56, "W to E", 56, ["CA", "NV"]),
    (61, "Lugo-Victorville 500 kV", "N to S", 2400, "S to N", 900, ["CA"]),
    (62, "Eldorado-McCullough 500 kV", "N to S", 2598, "S to N", 2598, ["NV"]),
    (65, "Pacific DC Intertie (PDCI)", "N to S", 3220, "S to N", 3100, ["OR", "CA"]),
    (66, "California-Oregon Intertie (COI)", "N to S", 4800, "S to N", 3675, ["OR", "CA"]),
    (71, "South of Allston", "N to S", 3100, "S to N", None, ["OR", "WA"]),
    (75, "Hemingway-Summer Lake", "E to W", 1500, "W to E", 550, ["ID", "OR"]),
    (76, "Alturas Project", "N to S", 300, "S to N", 300, ["CA", "OR"]),
    (77, "Crystal-Harry Allen", "E to W", 950, "W to E", 300, ["NV", "AZ"]),
    (78, "TOT 2B1", "N to S", 647, "S to N", 700, ["UT", "AZ"]),
    (79, "TOT 2B2", "N to S", 265, "S to N", 300, ["UT", "AZ"]),
    (80, "Montana Southeast", "N to S", 600, "S to N", 600, ["MT", "WY"]),
    (81, "SNTI", "N to S", 4533, "S to N", 3790, ["NV"]),
    (82, "TotBeast", "W to E", 2465, "E to W", None, ["ID", "OR"]),
    (83, "Montana Alberta Tie Line", "N to S", 325, "S to N", 300, ["MT", "AB"]),
    (84, "Harry Allen-Eldorado 500 kV", "N to S", 3496, "S to N", 1390, ["NV"]),
    (85, "Aeolus West (Post Gateway)", "E to W", 2670, "W to E", 1816, ["WY", "UT"]),
    (86, "West of John Day", "E to W", 4760, "W to E", None, ["OR"]),
    (87, "West of McNary", "E to W", 4925, "W to E", None, ["OR"]),
    (88, "West of Slatt", "E to W", 4760, "W to E", None, ["OR"]),
    (89, "SNTI+", "N to S", 6257, "S to N", 4681, ["NV"]),
]


def build_path_name(path_num, name, dir1_label, dir2_label):
    """Build descriptive path name including direction info."""
    return f"Path {path_num}: {name}"


def main():
    print("=" * 60)
    print("GridScout WECC Path Rating Seed")
    print(f"  Source: 2024 WECC Path Rating Catalog")
    print(f"  Paths: {len(WECC_PATHS)}")
    print("=" * 60)

    data_source_id = get_data_source_id()
    print(f"Data source ID: {data_source_id}")

    now = datetime.now(timezone.utc).isoformat()

    records = []
    for (path_num, name, dir1_label, mw1, dir2_label, mw2, states) in WECC_PATHS:
        source_record_id = f"wecc_path_{path_num}"
        path_name = f"Path {path_num}: {name} ({dir1_label} / {dir2_label})"

        records.append({
            'source_record_id': source_record_id,
            'path_number': path_num,
            'path_name': path_name,
            'ttc_mw_forward': mw1,
            'ttc_mw_reverse': mw2,
            'otc_mw_forward': None,
            'otc_mw_reverse': None,
            'utilization_u75': None,
            'utilization_u90': None,
            'states': states,
            'data_source_id': data_source_id,
            'created_at': now,
        })

    print(f"\nInserting {len(records)} WECC paths...")

    total_created = 0
    total_errors = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            supabase_request(
                'POST',
                'grid_wecc_paths',
                batch,
                {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
            )
            total_created += len(batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: {len(batch)} inserted")
        except Exception as e:
            print(f"  Batch error: {e}")
            # Fallback: insert one by one
            for rec in batch:
                try:
                    supabase_request(
                        'POST',
                        'grid_wecc_paths',
                        [rec],
                        {'Prefer': 'resolution=ignore-duplicates,return=minimal'}
                    )
                    total_created += 1
                except Exception as e2:
                    total_errors += 1
                    if total_errors <= 10:
                        print(f"  Record error (Path {rec['path_number']}): {e2}")

    # Update data source metadata
    supabase_request(
        'PATCH',
        'grid_data_sources?name=eq.wecc_paths',
        {
            'record_count': total_created,
            'last_import': now,
        }
    )

    print(f"\n{'=' * 60}")
    print(f"WECC Path Seeding Complete")
    print(f"  Created: {total_created}")
    print(f"  Errors: {total_errors}")
    print(f"  Total paths in catalog: {len(WECC_PATHS)}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

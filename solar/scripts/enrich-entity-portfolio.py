#!/usr/bin/env python3
"""
Entity Portfolio Analytics Enrichment Script

Computes per-entity analytics from linked installations:
- avg_project_size_kw: Average capacity across installations
- primary_equipment_brands: Top 5 equipment manufacturers
- geographic_focus: Top 3 states by installation count
- project_type_distribution: {"commercial": 0.85, "utility": 0.10, "community": 0.05}

Usage:
  python3 -u scripts/enrich-entity-portfolio.py                    # Both tables
  python3 -u scripts/enrich-entity-portfolio.py --table installers # Installers only
  python3 -u scripts/enrich-entity-portfolio.py --table owners     # Owners only
  python3 -u scripts/enrich-entity-portfolio.py --dry-run          # Preview without patching
  python3 -u scripts/enrich-entity-portfolio.py --limit 100        # Process first N
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50
WORKERS = 10


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_get(table, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def supabase_patch(table, data, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    body = json.dumps(data, allow_nan=False).encode()
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def supabase_rpc(func_name, params, retries=3):
    url = f"{SUPABASE_URL}/rest/v1/rpc/{func_name}"
    body = json.dumps(params, allow_nan=False).encode()
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{retries} after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


# ---------------------------------------------------------------------------
# Analytics computation (direct SQL via multiple REST queries per entity)
# ---------------------------------------------------------------------------

def compute_installer_analytics(entity_id):
    """Compute portfolio analytics for one installer."""
    # Get installations
    installs = supabase_get("solar_installations", {
        "installer_id": f"eq.{entity_id}",
        "select": "id,capacity_mw,state,site_type",
        "limit": "10000",
    })
    if not installs:
        return None

    # Avg project size
    capacities = [i["capacity_mw"] * 1000 for i in installs if i.get("capacity_mw")]
    avg_size = sum(capacities) / len(capacities) if capacities else None

    # Geographic focus — top 3 states
    state_counts = {}
    for i in installs:
        s = i.get("state")
        if s:
            state_counts[s] = state_counts.get(s, 0) + 1
    geo_focus = [s for s, _ in sorted(state_counts.items(), key=lambda x: -x[1])[:3]]

    # Project type distribution
    type_counts = {}
    total = len(installs)
    for i in installs:
        t = i.get("site_type", "commercial")
        type_counts[t] = type_counts.get(t, 0) + 1
    type_dist = {t: round(c / total, 3) for t, c in type_counts.items()} if total else {}

    # Equipment brands — top 5
    install_ids = [i.get("id") for i in installs[:500] if i.get("id")]
    brands = {}
    if install_ids:
        # Query equipment for this installer's installations using the installer_id FK
        # More efficient: query by installation_id in batches
        for batch_start in range(0, min(len(install_ids), 200), 50):
            batch_ids = install_ids[batch_start:batch_start+50]
            id_filter = ",".join(batch_ids)
            equip = supabase_get("solar_equipment", {
                "installation_id": f"in.({id_filter})",
                "select": "manufacturer",
                "limit": "5000",
            })
            for e in (equip or []):
                m = e.get("manufacturer")
                if m:
                    brands[m] = brands.get(m, 0) + 1
    top_brands = [b for b, _ in sorted(brands.items(), key=lambda x: -x[1])[:5]]

    return {
        "avg_project_size_kw": round(avg_size, 3) if avg_size else None,
        "primary_equipment_brands": top_brands or None,
        "geographic_focus": geo_focus or None,
        "project_type_distribution": type_dist or None,
    }


def compute_owner_analytics(entity_id):
    """Compute portfolio analytics for one site owner (owner/operator/developer)."""
    # Get installations via any FK role
    installs = []
    for fk in ["owner_id", "operator_id", "developer_id"]:
        rows = supabase_get("solar_installations", {
            fk: f"eq.{entity_id}",
            "select": "id,capacity_mw,state,site_type",
            "limit": "5000",
        })
        if rows:
            seen = {i["id"] for i in installs}
            installs.extend(r for r in rows if r["id"] not in seen)
    if not installs:
        return None

    # Avg project size
    capacities = [i["capacity_mw"] * 1000 for i in installs if i.get("capacity_mw")]
    avg_size = sum(capacities) / len(capacities) if capacities else None

    # Geographic focus — top 3 states
    state_counts = {}
    for i in installs:
        s = i.get("state")
        if s:
            state_counts[s] = state_counts.get(s, 0) + 1
    geo_focus = [s for s, _ in sorted(state_counts.items(), key=lambda x: -x[1])[:3]]

    # Project type distribution
    type_counts = {}
    total = len(installs)
    for i in installs:
        t = i.get("site_type", "commercial")
        type_counts[t] = type_counts.get(t, 0) + 1
    type_dist = {t: round(c / total, 3) for t, c in type_counts.items()} if total else {}

    # Equipment brands — top 5 (sample first 200 installations)
    install_ids = [i["id"] for i in installs[:200]]
    brands = {}
    for batch_start in range(0, len(install_ids), 50):
        batch_ids = install_ids[batch_start:batch_start+50]
        id_filter = ",".join(batch_ids)
        equip = supabase_get("solar_equipment", {
            "installation_id": f"in.({id_filter})",
            "select": "manufacturer",
            "limit": "5000",
        })
        for e in (equip or []):
            m = e.get("manufacturer")
            if m:
                brands[m] = brands.get(m, 0) + 1
    top_brands = [b for b, _ in sorted(brands.items(), key=lambda x: -x[1])[:5]]

    return {
        "avg_project_size_kw": round(avg_size, 3) if avg_size else None,
        "primary_equipment_brands": top_brands or None,
        "geographic_focus": geo_focus or None,
        "project_type_distribution": type_dist or None,
    }


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_table(table_name, fk_field, compute_fn, dry_run=False, limit=None):
    """Process all entities in a table."""
    print(f"\n{'='*60}")
    print(f"Processing {table_name}")
    print(f"{'='*60}")

    # Load entities that need analytics (no avg_project_size_kw yet)
    page = 0
    page_size = 1000
    entities = []
    while True:
        rows = supabase_get(table_name, {
            "select": "id,name",
            "avg_project_size_kw": "is.null",
            "order": "installation_count.desc.nullsfirst" if table_name == "solar_installers" else "site_count.desc.nullsfirst",
            "offset": str(page * page_size),
            "limit": str(page_size),
        })
        if not rows:
            break
        entities.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
        if limit and len(entities) >= limit:
            entities = entities[:limit]
            break

    print(f"Found {len(entities)} entities needing analytics")
    if not entities:
        return

    patched = 0
    errors = 0
    skipped = 0

    for idx, entity in enumerate(entities):
        eid = entity["id"]
        name = entity.get("name", "?")

        try:
            analytics = compute_fn(eid)
        except Exception as e:
            print(f"  [{idx+1}/{len(entities)}] ERROR computing {name}: {e}")
            errors += 1
            continue

        if not analytics:
            skipped += 1
            continue

        if dry_run:
            if idx < 10:
                print(f"  [{idx+1}] {name}: avg={analytics.get('avg_project_size_kw')} kW, "
                      f"brands={analytics.get('primary_equipment_brands')}, "
                      f"geo={analytics.get('geographic_focus')}, "
                      f"types={analytics.get('project_type_distribution')}")
            patched += 1
            continue

        # Patch entity
        patch_data = {}
        if analytics.get("avg_project_size_kw") is not None:
            patch_data["avg_project_size_kw"] = analytics["avg_project_size_kw"]
        if analytics.get("primary_equipment_brands"):
            patch_data["primary_equipment_brands"] = analytics["primary_equipment_brands"]
        if analytics.get("geographic_focus"):
            patch_data["geographic_focus"] = analytics["geographic_focus"]
        if analytics.get("project_type_distribution"):
            patch_data["project_type_distribution"] = analytics["project_type_distribution"]

        if not patch_data:
            skipped += 1
            continue

        try:
            supabase_patch(table_name, patch_data, {"id": f"eq.{eid}"})
            patched += 1
        except Exception as e:
            print(f"  [{idx+1}/{len(entities)}] ERROR patching {name}: {e}")
            errors += 1
            continue

        if (idx + 1) % 100 == 0:
            print(f"  [{idx+1}/{len(entities)}] {patched} patched, {errors} errors, {skipped} skipped")

    print(f"\nDone: {patched} patched, {errors} errors, {skipped} skipped")


def main():
    parser = argparse.ArgumentParser(description="Enrich entity portfolio analytics")
    parser.add_argument("--table", choices=["installers", "owners", "both"], default="both")
    parser.add_argument("--dry-run", action="store_true", help="Preview without patching")
    parser.add_argument("--limit", type=int, help="Process first N entities per table")
    args = parser.parse_args()

    start = time.time()

    if args.table in ("installers", "both"):
        process_table(
            "solar_installers", "installer_id",
            compute_installer_analytics,
            dry_run=args.dry_run, limit=args.limit,
        )

    if args.table in ("owners", "both"):
        process_table(
            "solar_site_owners", "owner_id",
            compute_owner_analytics,
            dry_run=args.dry_run, limit=args.limit,
        )

    elapsed = time.time() - start
    print(f"\nTotal time: {elapsed:.1f}s")


if __name__ == "__main__":
    main()

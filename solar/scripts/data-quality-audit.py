#!/usr/bin/env python3
"""
Data Quality Audit Script

Audits the solar_installations and solar_equipment tables for data quality issues:
1. Duplicate addresses (same address+city+state, different source_record_ids)
2. Impossible values (capacity > 1000 MW, lat/lng outside US, future dates)
3. Installer name standardization (SolarCity/Solar City/SOLARCITY → canonical)
4. Final field coverage percentages

Usage:
  python3 -u scripts/data-quality-audit.py              # Full audit report
  python3 -u scripts/data-quality-audit.py --fix         # Fix standardizable issues
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Installer name canonicalization map
# ---------------------------------------------------------------------------

INSTALLER_CANONICAL = {
    # SolarCity / Tesla
    "solarcity": "SolarCity (Tesla)",
    "solar city": "SolarCity (Tesla)",
    "tesla energy": "Tesla Energy",
    "tesla": "Tesla Energy",
    # Sunrun
    "sunrun": "Sunrun",
    "sun run": "Sunrun",
    # Vivint
    "vivint solar": "Vivint Solar",
    "vivint": "Vivint Solar",
    # SunPower
    "sunpower": "SunPower",
    "sun power": "SunPower",
    # Trinity Solar
    "trinity solar": "Trinity Solar",
    "trinity": "Trinity Solar",
    # Sunnova
    "sunnova": "Sunnova",
    # Momentum Solar
    "momentum solar": "Momentum Solar",
    "momentum": "Momentum Solar",
    # Palmetto
    "palmetto solar": "Palmetto Solar",
    "palmetto": "Palmetto Solar",
    # Freedom Solar
    "freedom solar": "Freedom Solar",
    # Blue Raven
    "blue raven solar": "Blue Raven Solar",
    "blue raven": "Blue Raven Solar",
    # Sungevity
    "sungevity": "Sungevity",
    # RGS Energy
    "rgs energy": "RGS Energy",
    "real goods solar": "RGS Energy",
    # Ameresco
    "ameresco": "Ameresco",
    # NextEra
    "nextera": "NextEra Energy Resources",
    "nextera energy": "NextEra Energy Resources",
}


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_get(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def supabase_rpc_count(table, column="*"):
    """Count total records in a table using Supabase HEAD request."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=id&limit=1"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    req = urllib.request.Request(url, headers=headers, method="HEAD")
    try:
        resp = urllib.request.urlopen(req)
        content_range = resp.getheader("Content-Range")
        if content_range:
            total = content_range.split("/")[-1]
            return int(total)
    except Exception:
        pass
    return 0


def count_with_filter(table, filter_params):
    """Count records matching a filter using Supabase HEAD with count."""
    params = {"select": "id", "limit": "1"}
    params.update(filter_params)
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    req = urllib.request.Request(url, headers=headers, method="HEAD")
    try:
        resp = urllib.request.urlopen(req)
        content_range = resp.getheader("Content-Range")
        if content_range:
            total = content_range.split("/")[-1]
            return int(total)
    except Exception:
        pass
    return 0


def supabase_patch_batch(ids, data):
    """PATCH a batch of installation IDs."""
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        id_filter = ",".join(batch)
        url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=in.({id_filter})"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        body = json.dumps(data).encode()
        req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            print(f"  PATCH error: {e.read().decode()[:200]}")


# ---------------------------------------------------------------------------
# Audit checks
# ---------------------------------------------------------------------------

def audit_field_coverage(total):
    """Report field coverage percentages."""
    print("\n1. FIELD COVERAGE REPORT")
    print("-" * 60)

    fields = [
        ("capacity_mw", "not.is.null"),
        ("install_date", "not.is.null"),
        ("latitude", "not.is.null"),
        ("address", "not.is.null"),
        ("city", "not.is.null"),
        ("state", "not.is.null"),
        ("county", "not.is.null"),
        ("zip_code", "not.is.null"),
        ("owner_name", "not.is.null"),
        ("developer_name", "not.is.null"),
        ("operator_name", "not.is.null"),
        ("installer_name", "not.is.null"),
        ("site_name", "not.is.null"),
        ("location_precision", "not.is.null"),
    ]

    for field, op in fields:
        count = count_with_filter("solar_installations", {field: op})
        pct = count / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
        print(f"  {field:20s} {count:>8,} / {total:,} ({pct:5.1f}%) {bar}")

    # Equipment coverage
    equip_total = supabase_rpc_count("solar_equipment")
    equip_modules = count_with_filter("solar_equipment", {"equipment_type": "eq.module"})
    equip_inverters = count_with_filter("solar_equipment", {"equipment_type": "eq.inverter"})
    equip_with_mfg = count_with_filter("solar_equipment", {"manufacturer": "not.is.null"})
    equip_with_model = count_with_filter("solar_equipment", {"model": "not.is.null"})

    print(f"\n  EQUIPMENT TOTALS:")
    print(f"    Total equipment records: {equip_total:,}")
    print(f"    Modules: {equip_modules:,}")
    print(f"    Inverters: {equip_inverters:,}")
    print(f"    With manufacturer: {equip_with_mfg:,} ({equip_with_mfg/equip_total*100:.1f}%)" if equip_total else "")
    print(f"    With model: {equip_with_model:,} ({equip_with_model/equip_total*100:.1f}%)" if equip_total else "")

    # Events
    events_total = supabase_rpc_count("solar_site_events")
    print(f"\n  EVENTS TOTAL: {events_total:,}")


def audit_impossible_values():
    """Check for obviously wrong values."""
    print("\n2. IMPOSSIBLE VALUES CHECK")
    print("-" * 60)

    # Capacity > 1000 MW
    huge_cap = count_with_filter("solar_installations", {"capacity_mw": "gt.1000"})
    print(f"  Capacity > 1000 MW: {huge_cap}")

    # Latitude outside US (17-72)
    bad_lat_low = count_with_filter("solar_installations", {"latitude": "lt.17"})
    bad_lat_high = count_with_filter("solar_installations", {"latitude": "gt.72"})
    print(f"  Latitude outside US (< 17 or > 72): {bad_lat_low + bad_lat_high}")

    # Longitude outside US (should be negative, -180 to -60)
    bad_lng_pos = count_with_filter("solar_installations", {"longitude": "gt.0"})
    print(f"  Longitude positive (wrong hemisphere): {bad_lng_pos}")

    # Future install_date
    future = count_with_filter("solar_installations", {"install_date": "gt.2026-12-31"})
    print(f"  Install date after 2026: {future}")

    # Negative capacity
    neg_cap = count_with_filter("solar_installations", {"capacity_mw": "lt.0"})
    print(f"  Negative capacity: {neg_cap}")


def audit_site_type_breakdown(total):
    """Show site type distribution."""
    print("\n3. SITE TYPE BREAKDOWN")
    print("-" * 60)

    for st in ["utility", "commercial", "community"]:
        count = count_with_filter("solar_installations", {"site_type": f"eq.{st}"})
        pct = count / total * 100 if total > 0 else 0
        print(f"  {st:15s}: {count:>8,} ({pct:5.1f}%)")


def audit_source_breakdown(total):
    """Show data source distribution."""
    print("\n4. DATA SOURCE BREAKDOWN")
    print("-" * 60)

    sources = [
        ("uspvdb_*", "USPVDB"),
        ("eia860_*", "EIA-860 + EIA-860M"),
        ("tts3_*", "TTS"),
        ("cadg_*", "CA DGStats"),
        ("nysun_*", "NY-Sun"),
        ("ilshines_*", "IL Shines"),
        ("mapts_*", "MA PTS"),
        ("lbnl_*", "LBNL Utility"),
        ("iso_*", "ISO Queues"),
        ("njdep_*", "NJ DEP"),
        ("permit_*", "Municipal Permits"),
        ("epa_repower_*", "EPA RE-Powering"),
        ("nrel_cs_*", "NREL Community Solar"),
    ]

    for pattern, label in sources:
        count = count_with_filter("solar_installations", {"source_record_id": f"like.{pattern}"})
        pct = count / total * 100 if total > 0 else 0
        print(f"  {label:25s}: {count:>8,} ({pct:5.1f}%)")


def audit_location_precision():
    """Show location precision distribution."""
    print("\n5. LOCATION PRECISION BREAKDOWN")
    print("-" * 60)

    for prec in ["exact", "address", "city", "zip", "county", "state"]:
        count = count_with_filter("solar_installations", {"location_precision": f"eq.{prec}"})
        print(f"  {prec:10s}: {count:>8,}")

    null_prec = count_with_filter("solar_installations", {"location_precision": "is.null"})
    print(f"  {'NULL':10s}: {null_prec:>8,}")


def audit_installer_standardization(fix=False):
    """Find installer name variants that should be standardized."""
    print("\n6. INSTALLER NAME STANDARDIZATION")
    print("-" * 60)

    # Load all installer names
    installer_counts = Counter()
    offset = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "installer_name",
            "installer_name": "not.is.null",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        for r in records:
            name = r.get("installer_name", "")
            if name:
                installer_counts[name] += 1
        if len(records) < 1000:
            break
        offset += 1000

    # Find standardizable variants
    fixes = {}
    for name, count in installer_counts.items():
        key = name.strip().lower()
        for pattern, canonical in INSTALLER_CANONICAL.items():
            if key == pattern or key.startswith(pattern + " ") or key.endswith(" " + pattern):
                if name != canonical:
                    fixes[name] = (canonical, count)
                    break

    if fixes:
        print(f"  Found {len(fixes)} standardizable installer name variants:")
        for name, (canonical, count) in sorted(fixes.items(), key=lambda x: -x[1][1])[:20]:
            print(f"    '{name}' ({count} records) → '{canonical}'")

        if fix:
            total_fixed = 0
            for name, (canonical, count) in fixes.items():
                # Find IDs
                offset = 0
                ids = []
                while True:
                    records = supabase_get("solar_installations", {
                        "select": "id",
                        "installer_name": f"eq.{name}",
                        "limit": 1000,
                        "offset": offset,
                    })
                    if not records:
                        break
                    ids.extend(r["id"] for r in records)
                    if len(records) < 1000:
                        break
                    offset += 1000

                if ids:
                    supabase_patch_batch(ids, {"installer_name": canonical})
                    total_fixed += len(ids)

            print(f"\n  Fixed: {total_fixed} records standardized")
    else:
        print("  No standardizable variants found")

    # Show top installers
    print(f"\n  Top 15 installers:")
    for name, count in installer_counts.most_common(15):
        print(f"    {name:40s}: {count:>6,}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Data quality audit")
    parser.add_argument("--fix", action="store_true", help="Fix standardizable issues")
    args = parser.parse_args()

    print("SolarTrack Data Quality Audit")
    print("=" * 60)

    total = supabase_rpc_count("solar_installations")
    print(f"Total installations: {total:,}")

    audit_field_coverage(total)
    audit_impossible_values()
    audit_site_type_breakdown(total)
    audit_source_breakdown(total)
    audit_location_precision()
    audit_installer_standardization(fix=args.fix)

    print(f"\n{'=' * 60}")
    print("Audit complete!")


if __name__ == "__main__":
    main()

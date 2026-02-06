#!/usr/bin/env python3
"""
Quick wins script:
1. CdTe → First Solar manufacturer inference
2. Orphan cleanup (tts_ and tts2_ prefix records from failed runs)
3. EIA-860 retirement/repower event extraction
"""

import os
import sys
import json
import urllib.request
import uuid
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)


def supabase_request(method, table, data=None, params=None, headers_extra=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if headers_extra:
        headers.update(headers_extra)

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        print(f"  Supabase error ({e.code}): {error_body}")
        return None


def cdte_first_solar_inference():
    """Update equipment records with CdTe technology to set manufacturer = First Solar."""
    print("\n" + "=" * 60)
    print("1. CdTe → First Solar Manufacturer Inference")
    print("=" * 60)

    # Find equipment with CdTe technology and no manufacturer
    params = {
        "module_technology": "like.*CdTe*",
        "manufacturer": "is.null",
        "select": "id,module_technology,installation_id",
        "limit": "1000",
    }
    records = supabase_request("GET", "solar_equipment", params=params)
    if not records:
        # Also check for empty string manufacturer
        params["manufacturer"] = "eq."
        records = supabase_request("GET", "solar_equipment", params=params)

    if not records:
        print("  No CdTe records with missing manufacturer found.")
        # Try a broader search - check what CdTe records we have
        params2 = {
            "module_technology": "like.*CdTe*",
            "select": "id,manufacturer,module_technology",
            "limit": "10",
        }
        sample = supabase_request("GET", "solar_equipment", params=params2)
        if sample:
            print(f"  Found {len(sample)} CdTe records, but they already have manufacturers:")
            for r in sample[:3]:
                print(f"    tech={r.get('module_technology')}, mfr={r.get('manufacturer')}")
        else:
            print("  No CdTe equipment records found at all.")

        # Also check installations with CdTe technology
        params3 = {
            "technology_primary": "like.*CdTe*",
            "select": "id,technology_primary,source_record_id",
            "limit": "10",
        }
        inst_sample = supabase_request("GET", "solar_installations", params=params3)
        if inst_sample:
            print(f"\n  Found installations with CdTe technology_primary:")
            for r in inst_sample[:5]:
                print(f"    {r.get('source_record_id')}: {r.get('technology_primary')}")

            # For these installations, check if they have equipment records
            # If not, create equipment records with First Solar
            created = 0
            for inst in inst_sample:
                # Check for existing equipment
                eq_params = {
                    "installation_id": f"eq.{inst['id']}",
                    "equipment_type": "eq.module",
                    "select": "id",
                    "limit": "1",
                }
                existing = supabase_request("GET", "solar_equipment", params=eq_params)
                if not existing:
                    # Create a module equipment record
                    eq = {
                        "id": str(uuid.uuid4()),
                        "installation_id": inst["id"],
                        "equipment_type": "module",
                        "manufacturer": "First Solar",
                        "module_technology": inst.get("technology_primary", "CdTe"),
                        "equipment_status": "active",
                    }
                    res = supabase_request("POST", "solar_equipment", eq)
                    if res is not None:
                        created += 1

            print(f"  Created {created} First Solar equipment records for CdTe installations")
        return

    count = len(records)
    print(f"  Found {count} CdTe equipment records with missing manufacturer")

    # Batch update
    updated = 0
    for rec in records:
        res = supabase_request(
            "PATCH",
            "solar_equipment",
            {"manufacturer": "First Solar"},
            params={"id": f"eq.{rec['id']}"},
        )
        if res is not None:
            updated += 1

    print(f"  Updated {updated} records to manufacturer='First Solar'")


def cdte_inference_from_installations():
    """Find all installations with CdTe/thin-film technology and ensure they have First Solar equipment."""
    print("\n  Checking all CdTe/thin-film installations...")

    # Search for various CdTe patterns
    patterns = ["like.*CdTe*", "like.*thin.film*", "like.*Thin.Film*"]
    all_installations = []

    for pattern in patterns:
        params = {
            "technology_primary": pattern,
            "select": "id,technology_primary,source_record_id",
            "limit": "5000",
        }
        results = supabase_request("GET", "solar_installations", params=params)
        if results:
            all_installations.extend(results)

    # Dedupe
    seen = set()
    unique = []
    for inst in all_installations:
        if inst["id"] not in seen:
            seen.add(inst["id"])
            unique.append(inst)

    print(f"  Found {len(unique)} installations with CdTe/thin-film technology")

    if not unique:
        return

    # For each, check if equipment has manufacturer set
    updated = 0
    created = 0
    for inst in unique:
        eq_params = {
            "installation_id": f"eq.{inst['id']}",
            "equipment_type": "eq.module",
            "select": "id,manufacturer",
            "limit": "5",
        }
        equipment = supabase_request("GET", "solar_equipment", params=eq_params)

        if equipment:
            # Update any without manufacturer
            for eq in equipment:
                if not eq.get("manufacturer"):
                    supabase_request(
                        "PATCH",
                        "solar_equipment",
                        {"manufacturer": "First Solar"},
                        params={"id": f"eq.{eq['id']}"},
                    )
                    updated += 1
        else:
            # No equipment record - create one
            eq = {
                "id": str(uuid.uuid4()),
                "installation_id": inst["id"],
                "equipment_type": "module",
                "manufacturer": "First Solar",
                "module_technology": inst.get("technology_primary", "CdTe"),
                "equipment_status": "active",
            }
            res = supabase_request("POST", "solar_equipment", eq)
            if res is not None:
                created += 1

    print(f"  Updated {updated} equipment records, created {created} new records with manufacturer='First Solar'")


def orphan_cleanup():
    """Delete orphaned records from failed tts_ and tts2_ ingestion runs."""
    print("\n" + "=" * 60)
    print("2. Orphan Cleanup (tts_ and tts2_ prefix records)")
    print("=" * 60)

    for prefix in ["tts_", "tts2_"]:
        # Count installations with this prefix
        params = {
            "source_record_id": f"like.{prefix}*",
            "select": "id",
            "limit": "5000",
        }
        # Make sure we don't match tts3_ when checking tts_
        if prefix == "tts_":
            # tts_ but NOT tts2_ or tts3_
            records = supabase_request("GET", "solar_installations", params=params)
            if records:
                # Filter out tts2_ and tts3_ in Python
                records = [r for r in records if r.get("source_record_id", "").startswith("tts_")
                           and not r.get("source_record_id", "").startswith("tts2_")
                           and not r.get("source_record_id", "").startswith("tts3_")]
        else:
            records = supabase_request("GET", "solar_installations", params=params)
            if records:
                records = [r for r in records if r.get("source_record_id", "").startswith("tts2_")]

        if not records:
            print(f"  No orphaned {prefix}* records found")
            continue

        count = len(records)
        print(f"  Found {count} orphaned {prefix}* installation records")

        # Delete equipment first (foreign key constraint)
        deleted_eq = 0
        deleted_inst = 0
        for rec in records:
            # Delete equipment
            res = supabase_request(
                "DELETE",
                "solar_equipment",
                params={"installation_id": f"eq.{rec['id']}"},
                headers_extra={"Prefer": "return=representation"},
            )
            if res:
                deleted_eq += len(res)

            # Delete installation
            res = supabase_request(
                "DELETE",
                "solar_installations",
                params={"id": f"eq.{rec['id']}"},
            )
            if res is not None:
                deleted_inst += 1

        print(f"  Deleted {deleted_inst} installations and {deleted_eq} equipment records with {prefix}* prefix")


def eia860_retirement_events():
    """Extract retirement/repower events from EIA-860 data already in the DB."""
    print("\n" + "=" * 60)
    print("3. EIA-860 Retirement/Repower Events")
    print("=" * 60)

    # Check if site_events table exists and has data
    params = {
        "select": "id",
        "limit": "1",
    }
    existing = supabase_request("GET", "solar_site_events", params=params)
    if existing is None:
        print("  solar_site_events table may not exist. Skipping.")
        return

    # Find EIA-860 installations with retirement info
    # These would have status fields in the data
    # First, let's check what EIA-860 records look like
    params = {
        "source_record_id": "like.eia860_*",
        "select": "id,name,capacity_mw,state,commission_date,decommission_date,status,source_record_id",
        "limit": "20",
        "decommission_date": "not.is.null",
    }
    retired = supabase_request("GET", "solar_installations", params=params)

    if not retired:
        # Try checking for status = retired
        params2 = {
            "source_record_id": "like.eia860_*",
            "status": "eq.retired",
            "select": "id,name,capacity_mw,state,commission_date,decommission_date,status,source_record_id",
            "limit": "100",
        }
        retired = supabase_request("GET", "solar_installations", params=params2)

    if not retired:
        print("  No retired EIA-860 installations found in DB.")
        print("  Note: The EIA-860 retired generators are in a separate Excel tab.")
        print("  Would need to parse the Retired sheet from 3_3_Solar to create events.")

        # Check what statuses exist for EIA records
        params3 = {
            "source_record_id": "like.eia860_*",
            "select": "status",
            "limit": "5000",
        }
        all_eia = supabase_request("GET", "solar_installations", params=params3)
        if all_eia:
            statuses = {}
            for r in all_eia:
                s = r.get("status", "null")
                statuses[s] = statuses.get(s, 0) + 1
            print(f"  EIA-860 installation statuses: {statuses}")
        return

    print(f"  Found {len(retired)} retired EIA-860 installations")

    # Create decommission events for each
    created = 0
    for inst in retired:
        event = {
            "id": str(uuid.uuid4()),
            "installation_id": inst["id"],
            "event_type": "decommission",
            "event_date": inst.get("decommission_date"),
            "description": f"Generator retired per EIA-860 data",
            "data_source": "eia860",
        }
        # Remove None values
        event = {k: v for k, v in event.items() if v is not None}

        res = supabase_request("POST", "solar_site_events", event,
                               headers_extra={"Prefer": "resolution=ignore-duplicates"})
        if res is not None:
            created += 1

    print(f"  Created {created} decommission events")


def main():
    print("Solar Quick Wins Script")
    print("=" * 60)

    # 1. CdTe → First Solar
    cdte_first_solar_inference()
    cdte_inference_from_installations()

    # 2. Orphan cleanup
    orphan_cleanup()

    # 3. EIA-860 events
    eia860_retirement_events()

    print("\n" + "=" * 60)
    print("Quick wins complete!")


if __name__ == "__main__":
    main()

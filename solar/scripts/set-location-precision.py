#!/usr/bin/env python3
"""
Set location_precision flags for all solar installations.

Precision levels:
  - 'exact'   : Precise lat/lon from source data (USPVDB, EIA-860, NY-Sun)
  - 'address' : Full street address available (EIA-860)
  - 'city'    : City-level precision (TTS, CA DGStats, MA PTS with city)
  - 'zip'     : Zip code only (IL Shines, records with only zip)
  - 'county'  : County-level only
  - 'state'   : State-level only

Also reverts zip centroid coordinates that were misleadingly set by geocode-zips.py.
Records that had genuine lat/lon from their source are preserved.

Note: EIA-860M records (prefix 'eia860m_') are automatically covered by Step 2's
'eia860_*' LIKE pattern since '_' is a SQL wildcard matching any single character.
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from dotenv import load_dotenv

# Load environment
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '..', '.env.local'))

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

BATCH_SIZE = 50


def supabase_request(method, table, data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        res = urllib.request.urlopen(req)
        if res.status in (200, 201):
            text = res.read().decode()
            return json.loads(text) if text else []
        return []
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  Supabase error ({e.code}): {err}")
        return None


def supabase_get(table, params):
    """GET request with response body."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items())

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  GET error ({e.code}): {e.read().decode()}")
        return []


def update_precision_batch(ids, precision):
    """Update location_precision for a batch of installation IDs."""
    for i in range(0, len(ids), BATCH_SIZE):
        batch = ids[i:i + BATCH_SIZE]
        id_list = ",".join(batch)
        url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=in.({id_list})"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        body = json.dumps({"location_precision": precision}).encode()
        req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            print(f"  Error updating batch: {e.read().decode()}")


def revert_and_flag_zip_centroids(ids):
    """Revert lat/lon to null and set precision to appropriate level for geocoded records."""
    for i in range(0, len(ids), BATCH_SIZE):
        batch = ids[i:i + BATCH_SIZE]
        id_list = ",".join(batch)
        url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=in.({id_list})"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        body = json.dumps({
            "latitude": None,
            "longitude": None,
        }).encode()
        req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            print(f"  Error reverting batch: {e.read().decode()}")


def main():
    print("Location Precision Flag Script")
    print("=" * 60)

    # ================================================================
    # Step 1: Flag USPVDB records as 'exact' (precise lat/lon from source)
    # ================================================================
    print("\n1. USPVDB records → 'exact' (precise coordinates from USGS)")
    offset = 0
    uspvdb_count = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id",
            "source_record_id": "like.uspvdb_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        ids = [r["id"] for r in records]
        update_precision_batch(ids, "exact")
        uspvdb_count += len(ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Flagged: {uspvdb_count}")

    # ================================================================
    # Step 2: Flag EIA-860 records
    # Records with lat/lon AND address → 'exact'
    # Records with address but no original lat/lon → 'address'
    # ================================================================
    print("\n2. EIA-860 records → 'exact' (have address + coordinates from Plant schedule)")
    offset = 0
    eia_exact = 0
    eia_address = 0
    eia_city = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude,address,city,zip_code",
            "source_record_id": "like.eia860_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        exact_ids = []
        address_ids = []
        city_ids = []
        for r in records:
            has_coords = r.get("latitude") and r.get("longitude")
            has_address = bool(r.get("address"))
            has_city = bool(r.get("city"))

            if has_coords:
                exact_ids.append(r["id"])
            elif has_address:
                address_ids.append(r["id"])
            elif has_city:
                city_ids.append(r["id"])

        if exact_ids:
            update_precision_batch(exact_ids, "exact")
            eia_exact += len(exact_ids)
        if address_ids:
            update_precision_batch(address_ids, "address")
            eia_address += len(address_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            eia_city += len(city_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Exact (coords): {eia_exact}")
    print(f"  Address only: {eia_address}")
    print(f"  City only: {eia_city}")

    # ================================================================
    # Step 3: Flag NY-Sun records as 'exact' (have lat/lon from source)
    # ================================================================
    print("\n3. NY-Sun records → 'exact' (have coordinates from source)")
    offset = 0
    nysun_exact = 0
    nysun_city = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude",
            "source_record_id": "like.nysun_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        exact_ids = []
        city_ids = []
        for r in records:
            if r.get("latitude") and r.get("longitude"):
                exact_ids.append(r["id"])
            else:
                city_ids.append(r["id"])

        if exact_ids:
            update_precision_batch(exact_ids, "exact")
            nysun_exact += len(exact_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            nysun_city += len(city_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Exact (coords): {nysun_exact}")
    print(f"  City (no coords): {nysun_city}")

    # ================================================================
    # Step 4: TTS records - revert zip centroids, flag as 'city' or 'zip'
    # ================================================================
    print("\n4. TTS records → revert zip centroids, flag 'city' or 'zip'")
    offset = 0
    tts_city = 0
    tts_zip = 0
    tts_reverted = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude,city,zip_code",
            "source_record_id": "like.tts3_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        revert_ids = []
        city_ids = []
        zip_ids = []
        for r in records:
            # TTS never has real lat/lon - any coordinates are from geocode-zips.py
            if r.get("latitude") and r.get("longitude"):
                revert_ids.append(r["id"])

            if r.get("city"):
                city_ids.append(r["id"])
            elif r.get("zip_code"):
                zip_ids.append(r["id"])

        if revert_ids:
            revert_and_flag_zip_centroids(revert_ids)
            tts_reverted += len(revert_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            tts_city += len(city_ids)
        if zip_ids:
            update_precision_batch(zip_ids, "zip")
            tts_zip += len(zip_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Zip centroids reverted: {tts_reverted}")
    print(f"  Flagged 'city': {tts_city}")
    print(f"  Flagged 'zip': {tts_zip}")

    # ================================================================
    # Step 5: CA DGStats - revert zip centroids, flag as 'city' or 'zip'
    # ================================================================
    print("\n5. CA DGStats → revert zip centroids, flag 'city' or 'county'")
    offset = 0
    ca_city = 0
    ca_county = 0
    ca_zip = 0
    ca_reverted = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude,city,county,zip_code",
            "source_record_id": "like.cadg_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        revert_ids = []
        city_ids = []
        county_ids = []
        zip_ids = []
        for r in records:
            if r.get("latitude") and r.get("longitude"):
                revert_ids.append(r["id"])

            if r.get("city"):
                city_ids.append(r["id"])
            elif r.get("county"):
                county_ids.append(r["id"])
            elif r.get("zip_code"):
                zip_ids.append(r["id"])

        if revert_ids:
            revert_and_flag_zip_centroids(revert_ids)
            ca_reverted += len(revert_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            ca_city += len(city_ids)
        if county_ids:
            update_precision_batch(county_ids, "county")
            ca_county += len(county_ids)
        if zip_ids:
            update_precision_batch(zip_ids, "zip")
            ca_zip += len(zip_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Zip centroids reverted: {ca_reverted}")
    print(f"  Flagged 'city': {ca_city}")
    print(f"  Flagged 'county': {ca_county}")
    print(f"  Flagged 'zip': {ca_zip}")

    # ================================================================
    # Step 6: IL Shines - revert zip centroids, flag as 'zip'
    # ================================================================
    print("\n6. IL Shines → revert zip centroids, flag 'zip'")
    offset = 0
    il_zip = 0
    il_reverted = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude",
            "source_record_id": "like.ilshines_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        revert_ids = [r["id"] for r in records if r.get("latitude") and r.get("longitude")]
        all_ids = [r["id"] for r in records]

        if revert_ids:
            revert_and_flag_zip_centroids(revert_ids)
            il_reverted += len(revert_ids)

        update_precision_batch(all_ids, "zip")
        il_zip += len(all_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Zip centroids reverted: {il_reverted}")
    print(f"  Flagged 'zip': {il_zip}")

    # ================================================================
    # Step 7: MA PTS - revert zip centroids, flag as 'city'
    # ================================================================
    print("\n7. MA PTS → revert zip centroids, flag 'city' or 'zip'")
    offset = 0
    ma_city = 0
    ma_zip = 0
    ma_reverted = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude,city",
            "source_record_id": "like.mapts_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        revert_ids = [r["id"] for r in records if r.get("latitude") and r.get("longitude")]
        city_ids = [r["id"] for r in records if r.get("city")]
        zip_ids = [r["id"] for r in records if not r.get("city")]

        if revert_ids:
            revert_and_flag_zip_centroids(revert_ids)
            ma_reverted += len(revert_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            ma_city += len(city_ids)
        if zip_ids:
            update_precision_batch(zip_ids, "zip")
            ma_zip += len(zip_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Zip centroids reverted: {ma_reverted}")
    print(f"  Flagged 'city': {ma_city}")
    print(f"  Flagged 'zip': {ma_zip}")

    # ================================================================
    # Step 8: LBNL Utility-Scale - all have precise coordinates
    # ================================================================
    print("\n8. LBNL Utility-Scale → 'exact' (precise coordinates from source)")
    offset = 0
    lbnl_count = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id",
            "source_record_id": "like.lbnl_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        ids = [r["id"] for r in records]
        update_precision_batch(ids, "exact")
        lbnl_count += len(ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Flagged: {lbnl_count}")

    # ================================================================
    # Step 9: ISO Interconnection Queues - county-level only
    # ================================================================
    print("\n9. ISO Queues → 'county' (have county, no coordinates)")
    offset = 0
    iso_county = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id",
            "source_record_id": "like.iso_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        ids = [r["id"] for r in records]
        update_precision_batch(ids, "county")
        iso_county += len(ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Flagged: {iso_county}")

    # ================================================================
    # Step 10: NJ DEP records - all have coordinates → 'exact'
    # ================================================================
    print("\n10. NJ DEP records → 'exact' (all have coordinates from ArcGIS)")
    offset = 0
    njdep_count = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id",
            "source_record_id": "like.njdep_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        ids = [r["id"] for r in records]
        update_precision_batch(ids, "exact")
        njdep_count += len(ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Flagged: {njdep_count}")

    # ================================================================
    # Step 11: Municipal permit records - classify by available data
    # ================================================================
    print("\n11. Municipal permit records → classify by data quality")
    offset = 0
    permit_exact = 0
    permit_address = 0
    permit_city = 0
    permit_zip = 0
    permit_state = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,latitude,longitude,address,city,zip_code",
            "source_record_id": "like.permit_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break

        exact_ids = []
        address_ids = []
        city_ids = []
        zip_ids = []
        state_ids = []
        for r in records:
            has_coords = r.get("latitude") and r.get("longitude")
            has_address = bool(r.get("address"))
            has_city = bool(r.get("city"))
            has_zip = bool(r.get("zip_code"))

            if has_coords:
                exact_ids.append(r["id"])
            elif has_address:
                address_ids.append(r["id"])
            elif has_city:
                city_ids.append(r["id"])
            elif has_zip:
                zip_ids.append(r["id"])
            else:
                state_ids.append(r["id"])

        if exact_ids:
            update_precision_batch(exact_ids, "exact")
            permit_exact += len(exact_ids)
        if address_ids:
            update_precision_batch(address_ids, "address")
            permit_address += len(address_ids)
        if city_ids:
            update_precision_batch(city_ids, "city")
            permit_city += len(city_ids)
        if zip_ids:
            update_precision_batch(zip_ids, "zip")
            permit_zip += len(zip_ids)
        if state_ids:
            update_precision_batch(state_ids, "state")
            permit_state += len(state_ids)

        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Exact (coords): {permit_exact}")
    print(f"  Address only: {permit_address}")
    print(f"  City only: {permit_city}")
    print(f"  Zip only: {permit_zip}")
    print(f"  State only: {permit_state}")

    # ================================================================
    # Step 12: NREL Community Solar - all have city, no coordinates
    # ================================================================
    print("\n12. NREL Community Solar → 'city' (have city, no coordinates)")
    offset = 0
    nrel_city = 0
    nrel_state = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,city",
            "source_record_id": "like.nrel_cs_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        city_ids = [r["id"] for r in records if r.get("city")]
        state_ids = [r["id"] for r in records if not r.get("city")]
        if city_ids:
            update_precision_batch(city_ids, "city")
            nrel_city += len(city_ids)
        if state_ids:
            update_precision_batch(state_ids, "state")
            nrel_state += len(state_ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  City: {nrel_city}")
    print(f"  State: {nrel_state}")

    # ================================================================
    # Step 13: Virginia Cooper Center - most have address
    # ================================================================
    print("\n13. Virginia Cooper Center → 'address' or 'state'")
    offset = 0
    va_address = 0
    va_state = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,address",
            "source_record_id": "like.vacooper_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        addr_ids = [r["id"] for r in records if r.get("address")]
        state_ids = [r["id"] for r in records if not r.get("address")]
        if addr_ids:
            update_precision_batch(addr_ids, "address")
            va_address += len(addr_ids)
        if state_ids:
            update_precision_batch(state_ids, "state")
            va_state += len(state_ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  Address: {va_address}")
    print(f"  State: {va_state}")

    # ================================================================
    # Step 14: EPA RE-Powering - all have city
    # ================================================================
    print("\n14. EPA RE-Powering → 'city' (have city, no coordinates)")
    offset = 0
    epa_city = 0
    epa_state = 0
    while True:
        records = supabase_get("solar_installations", {
            "select": "id,city",
            "source_record_id": "like.epa_re_*",
            "limit": 1000,
            "offset": offset,
        })
        if not records:
            break
        city_ids = [r["id"] for r in records if r.get("city")]
        state_ids = [r["id"] for r in records if not r.get("city")]
        if city_ids:
            update_precision_batch(city_ids, "city")
            epa_city += len(city_ids)
        if state_ids:
            update_precision_batch(state_ids, "state")
            epa_state += len(state_ids)
        offset += 1000
        if len(records) < 1000:
            break
    print(f"  City: {epa_city}")
    print(f"  State: {epa_state}")

    # ================================================================
    # Summary
    # ================================================================
    total_reverted = tts_reverted + ca_reverted + il_reverted + ma_reverted
    print("\n" + "=" * 60)
    print("Location Precision Summary")
    print("=" * 60)
    print(f"  Exact (real coordinates): {uspvdb_count + eia_exact + nysun_exact + lbnl_count + njdep_count + permit_exact}")
    print(f"  Address (geocodable): {eia_address + permit_address + va_address}")
    print(f"  City-level: {eia_city + nysun_city + tts_city + ca_city + ma_city + permit_city + nrel_city + epa_city}")
    print(f"  Zip-level: {tts_zip + ca_zip + il_zip + ma_zip + permit_zip}")
    print(f"  County-level: {ca_county + iso_county}")
    print(f"  State-level: {permit_state + nrel_state + va_state + epa_state}")
    print(f"  Zip centroids reverted: {total_reverted}")
    print("\nDone!")


if __name__ == "__main__":
    main()

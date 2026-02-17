#!/usr/bin/env python3
"""Link unlinked owner_name records to solar_site_owners entity table.

Finds installations where owner_name IS NOT NULL but owner_id IS NULL,
then links them to existing solar_site_owners (or creates new entities).
"""

import json
import time
import urllib.request
import urllib.parse
import urllib.error

SUPABASE_URL = "https://ilbovwnhrowvxjdkvrln.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsYm92d25ocm93dnhqZGt2cmxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUyNTMxMiwiZXhwIjoyMDg0MTAxMzEyfQ.WYevLOEB9dKfZCbST9yZPW3P-UP_9AwyJUNHeU5kgc4"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def supabase_request(url, method="GET", data=None, extra_headers=None, retries=3):
    """Make a Supabase REST API request with retry logic."""
    hdrs = dict(HEADERS)
    if extra_headers:
        hdrs.update(extra_headers)

    for attempt in range(retries):
        try:
            body = json.dumps(data).encode() if data else None
            req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
            resp = urllib.request.urlopen(req, timeout=60)
            resp_body = resp.read().decode()
            content_range = resp.headers.get("Content-Range")
            if resp_body:
                return json.loads(resp_body), content_range
            return [], content_range
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"  Retry {attempt+1}/{retries} after error: {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def fetch_unlinked_installations():
    """Fetch all installations where owner_name IS NOT NULL and owner_id IS NULL."""
    all_records = []
    offset = 0
    page_size = 1000

    while True:
        url = (
            f"{SUPABASE_URL}/rest/v1/solar_installations"
            f"?owner_name=not.is.null&owner_id=is.null"
            f"&select=id,owner_name"
            f"&order=id"
            f"&offset={offset}&limit={page_size}"
        )
        records, _ = supabase_request(url)
        all_records.extend(records)
        if len(records) < page_size:
            break
        offset += page_size
        print(f"  Fetched {len(all_records)} so far...")

    return all_records


def fetch_existing_owners(normalized_names):
    """Fetch existing solar_site_owners by normalized_name in batches."""
    owner_map = {}  # normalized_name -> id
    batch_size = 30

    for i in range(0, len(normalized_names), batch_size):
        batch = normalized_names[i:i + batch_size]
        encoded_names = ",".join(urllib.parse.quote(n, safe=".*()") for n in batch)
        url = (
            f"{SUPABASE_URL}/rest/v1/solar_site_owners"
            f"?normalized_name=in.({encoded_names})"
            f"&select=id,normalized_name"
            f"&limit=1000"
        )
        try:
            records, _ = supabase_request(url)
            for r in records:
                owner_map[r["normalized_name"]] = r["id"]
        except Exception as e:
            print(f"  WARNING: batch lookup failed: {e}")
        time.sleep(0.05)

    return owner_map


def create_owner_entity(name, normalized_name):
    """Create a new solar_site_owners record."""
    url = f"{SUPABASE_URL}/rest/v1/solar_site_owners?select=id,normalized_name"
    data = {
        "name": name,
        "normalized_name": normalized_name,
        "entity_type": "owner",
    }
    records, _ = supabase_request(
        url, method="POST", data=data,
        extra_headers={"Prefer": "return=representation"}
    )
    if records and len(records) > 0:
        return records[0]["id"]
    return None


def patch_installation_owner_id(installation_id, owner_id):
    """Patch an installation's owner_id."""
    encoded_id = urllib.parse.quote(str(installation_id), safe="")
    url = f"{SUPABASE_URL}/rest/v1/solar_installations?id=eq.{encoded_id}"
    data = {"owner_id": owner_id}
    supabase_request(url, method="PATCH", data=data)


def main():
    print("=" * 60)
    print("Link Unlinked Owner Records to solar_site_owners")
    print("=" * 60)

    # Step 1: Fetch unlinked installations (all states)
    print("\n[1/4] Fetching unlinked installations (owner_name NOT NULL, owner_id IS NULL)...")
    installations = fetch_unlinked_installations()
    print(f"  Found {len(installations)} unlinked records")

    if not installations:
        print("  Nothing to do!")
        return

    # Step 2: Get unique owner names
    unique_names = {}
    for inst in installations:
        normalized = inst["owner_name"].lower().strip()
        if normalized not in unique_names:
            unique_names[normalized] = inst["owner_name"]

    print(f"\n[2/4] Found {len(unique_names)} unique owner names")

    # Step 3: Check which already exist in solar_site_owners
    print("\n[3/4] Checking existing entities in solar_site_owners...")
    normalized_list = list(unique_names.keys())
    owner_map = fetch_existing_owners(normalized_list)
    existing_count = len(owner_map)
    missing_count = len(unique_names) - existing_count
    print(f"  {existing_count} already exist, {missing_count} need to be created")

    # Step 4: Link installations
    print(f"\n[4/4] Linking {len(installations)} installations...")
    stats = {"linked": 0, "created": 0, "errors": 0}

    for i, inst in enumerate(installations):
        inst_id = inst["id"]
        owner_name = inst["owner_name"]
        normalized = owner_name.lower().strip()

        # Resolve owner_id
        owner_id = owner_map.get(normalized)
        if not owner_id:
            try:
                owner_id = create_owner_entity(owner_name, normalized)
                if owner_id:
                    owner_map[normalized] = owner_id
                    stats["created"] += 1
                else:
                    stats["errors"] += 1
                    print(f"  ERROR: Failed to create entity for '{owner_name}'")
                    continue
            except Exception as e:
                stats["errors"] += 1
                print(f"  ERROR creating entity for '{owner_name}': {e}")
                continue
            time.sleep(0.03)

        # Patch installation
        try:
            patch_installation_owner_id(inst_id, owner_id)
            stats["linked"] += 1
        except Exception as e:
            stats["errors"] += 1
            print(f"  ERROR patching installation {inst_id}: {e}")

        if (i + 1) % 50 == 0:
            print(f"  Progress: {i+1}/{len(installations)} ({stats['linked']} linked, {stats['created']} created, {stats['errors']} errors)")

        time.sleep(0.03)

    # Summary
    print("\n" + "=" * 60)
    print("RESULTS:")
    print(f"  Installations linked:    {stats['linked']}")
    print(f"  New entities created:    {stats['created']}")
    print(f"  Errors:                  {stats['errors']}")
    print("=" * 60)

    # Verify
    print("\nVerifying remaining unlinked...")
    url = (
        f"{SUPABASE_URL}/rest/v1/solar_installations"
        f"?owner_name=not.is.null&owner_id=is.null"
        f"&select=id"
        f"&limit=1"
    )
    records, _ = supabase_request(url, extra_headers={"Prefer": "count=exact"})
    remaining = len(records)
    print(f"  Remaining unlinked: {remaining}")


if __name__ == "__main__":
    main()

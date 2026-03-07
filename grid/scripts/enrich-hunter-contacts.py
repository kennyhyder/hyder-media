#!/usr/bin/env python3
"""
Enrich grid_ixp_facilities and grid_datacenters with contact emails from Hunter.io.
Uses domain search to find email addresses for facilities that have websites.

Requires HUNTER_API_KEY in .env.local (free tier: 25 searches/month, paid: 500+/month).
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
HUNTER_API_KEY = os.environ.get('HUNTER_API_KEY')

if not HUNTER_API_KEY:
    print("ERROR: HUNTER_API_KEY not set in .env.local")
    print("Get a free key at https://hunter.io/api-keys")
    sys.exit(1)


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
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def extract_domain(url):
    """Extract domain from URL, stripping www. prefix."""
    if not url:
        return None
    url = url.strip().lower()
    # Remove protocol
    for prefix in ['https://', 'http://']:
        if url.startswith(prefix):
            url = url[len(prefix):]
            break
    # Remove path
    url = url.split('/')[0]
    # Remove www.
    if url.startswith('www.'):
        url = url[4:]
    # Skip if it's an IP address or too short
    if not url or '.' not in url or len(url) < 4:
        return None
    return url


def hunter_domain_search(domain):
    """Search Hunter.io for emails at a domain."""
    url = f"https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}&limit=5"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'GridScout/1.0')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data.get('data', {})
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print("  Rate limited — waiting 60s...")
            time.sleep(60)
            return hunter_domain_search(domain)  # retry once
        error_body = e.read().decode() if e.fp else ''
        print(f"  Hunter API error {e.code}: {error_body[:200]}")
        return None
    except Exception as e:
        print(f"  Hunter error: {e}")
        return None


def main():
    print("=" * 60)
    print("GridScout: Hunter.io Contact Enrichment")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    limit = None
    for arg in sys.argv:
        if arg.startswith('--limit='):
            limit = int(arg.split('=')[1])

    # Step 1: Load IXP facilities with websites but missing sales_email
    print("\nLoading IXP facilities with websites...")
    ixps = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_ixp_facilities?select=id,name,website,sales_email&website=not.is.null&sales_email=is.null&limit=1000&offset={offset}')
        if not batch:
            break
        ixps.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(ixps)} IXPs with website but no sales_email")

    # Step 2: Load datacenters with websites but missing sales_email
    print("Loading datacenters with websites...")
    dcs = []
    offset = 0
    while True:
        batch = supabase_request('GET',
            f'grid_datacenters?select=id,name,website,sales_email&website=not.is.null&sales_email=is.null&limit=1000&offset={offset}')
        if not batch:
            break
        dcs.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(dcs)} datacenters with website but no sales_email")

    # Combine and deduplicate by domain
    all_facilities = []
    seen_domains = set()
    for ixp in ixps:
        domain = extract_domain(ixp.get('website'))
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            all_facilities.append(('ixp', ixp, domain))
    for dc in dcs:
        domain = extract_domain(dc.get('website'))
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            all_facilities.append(('dc', dc, domain))

    print(f"\n{len(all_facilities)} unique domains to search")
    if limit:
        all_facilities = all_facilities[:limit]
        print(f"  Limited to {limit}")

    # Step 3: Search Hunter.io for each domain
    ixp_patched = 0
    dc_patched = 0
    errors = 0
    api_calls = 0

    for i, (ftype, facility, domain) in enumerate(all_facilities):
        if i > 0 and i % 10 == 0:
            print(f"  Progress: {i}/{len(all_facilities)} ({api_calls} API calls, {ixp_patched + dc_patched} patched)")

        result = hunter_domain_search(domain)
        api_calls += 1
        if not result:
            errors += 1
            continue

        emails = result.get('emails', [])
        if not emails:
            continue

        # Prefer department-based ordering: sales > management > executive > general
        dept_priority = {'sales': 0, 'management': 1, 'executive': 2, 'communication': 3}
        emails.sort(key=lambda e: dept_priority.get(e.get('department', ''), 99))

        best_email = emails[0].get('value')
        if not best_email:
            continue

        # Find phone from emails if available
        best_phone = None
        for email in emails:
            if email.get('phone_number'):
                best_phone = email['phone_number']
                break

        patch = {'sales_email': best_email}
        if best_phone:
            patch['sales_phone'] = best_phone

        table = 'grid_ixp_facilities' if ftype == 'ixp' else 'grid_datacenters'

        if not dry_run:
            try:
                supabase_request('PATCH', f'{table}?id=eq.{facility["id"]}', patch)
                if ftype == 'ixp':
                    ixp_patched += 1
                else:
                    dc_patched += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error patching {facility['id']}: {e}")
        else:
            if ftype == 'ixp':
                ixp_patched += 1
            else:
                dc_patched += 1
            if ixp_patched + dc_patched <= 5:
                print(f"  [DRY] {facility.get('name', '?')}: {best_email}")

        # Rate limit: Hunter free tier is ~10 req/sec
        time.sleep(0.5)

    print(f"\n{'=' * 60}")
    print(f"Hunter.io Contact Enrichment Complete")
    print(f"  API calls:      {api_calls}")
    print(f"  IXPs patched:   {ixp_patched}")
    print(f"  DCs patched:    {dc_patched}")
    print(f"  Errors:         {errors}")
    if dry_run:
        print("  [DRY RUN — no changes made]")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()

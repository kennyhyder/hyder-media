#!/usr/bin/env python3
"""
Proprietary Permit Portal Scraper (Playwright)

Scrapes solar building permit data from Accela Citizen Access and Tyler EnerGov
portals that don't expose standard JSON APIs. Uses headless Chromium.

Supported platforms:
  - Accela Citizen Access (ASP.NET postback-based portals)
  - Tyler EnerGov (Angular SPA portals)

Usage:
  python3 -u scripts/scrape-permit-portals.py                     # All portals
  python3 -u scripts/scrape-permit-portals.py --portal atlanta     # Single portal
  python3 -u scripts/scrape-permit-portals.py --portal atlanta,okc # Multiple
  python3 -u scripts/scrape-permit-portals.py --platform accela    # All Accela
  python3 -u scripts/scrape-permit-portals.py --platform tyler     # All Tyler
  python3 -u scripts/scrape-permit-portals.py --dry-run            # Count only
  python3 -u scripts/scrape-permit-portals.py --list               # Show portals
  python3 -u scripts/scrape-permit-portals.py --test atlanta       # Test one portal

Dependencies:
  pip install playwright && python3 -m playwright install chromium
"""

import os
import sys
import json
import re
import argparse
import time
import urllib.request
import urllib.parse
from pathlib import Path

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

# ---------------------------------------------------------------------------
# Portal configurations
# ---------------------------------------------------------------------------

PORTALS = {
    # =========================================================================
    # ACCELA CITIZEN ACCESS portals (ASP.NET)
    # All tested Feb 12, 2026 — returned 0 results (require login or lack public search)
    # REMOVED: Atlanta, Indianapolis, Fort Wayne, OKC, Wichita, St. Louis County, Lincoln, Cheyenne
    # =========================================================================

    # =========================================================================
    # TYLER ENERGOV portals (Angular SPA)
    # =========================================================================
    "wake_county": {
        "platform": "tyler",
        "name": "Wake County, NC",
        "state": "NC",
        "county": "WAKE",
        "base_url": "https://wakecountync-energovpub.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_wake",
    },
    # REMOVED: Grand Forks ND — returns 404 "File or directory not found"
    # REMOVED: Hartford CT — DNS NXDOMAIN, domain does not exist
    "reading": {
        "platform": "tyler",
        "name": "Reading, PA",
        "state": "PA",
        "county": "BERKS",
        "base_url": "https://readingpa-energovweb.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_reading",
    },
    "solon": {
        "platform": "tyler",
        "name": "Solon, OH",
        "state": "OH",
        "county": "CUYAHOGA",
        "base_url": "https://solonoh-energovpub.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_solon",
    },
    # REMOVED: Denton County TX — 0 results (search returned nothing)

    # =========================================================================
    # Tyler EnerGov - Gap State Portals (discovered Feb 12, 2026)
    # Tested all 15 portals. Kept only those with 10+ solar results.
    # REMOVED (0-9 results): atlanta_tyler (DEAD), columbus_ga (1), clayton_county (bogus),
    #   mobile_al (3), nampa_id (0), lawrence_ks (0), maricopa_county (1), cedar_rapids (1),
    #   gresham_or (6), albany_ny (9), houston_county_ga (0), beaufort_county_sc (1)
    # =========================================================================
    "paducah_ky": {
        "platform": "tyler",
        "name": "Paducah, KY",
        "state": "KY",
        "county": "MCCRACKEN",
        "base_url": "https://paducahky-energovweb.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_paducahky",
    },
    "santa_fe": {
        "platform": "tyler",
        "name": "Santa Fe, NM",
        "state": "NM",
        "county": "SANTA FE",
        "base_url": "https://santafenm-energovpub.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_santafe",
    },
    "lewiston_me": {
        "platform": "tyler",
        "name": "Lewiston, ME",
        "state": "ME",
        "county": "ANDROSCOGGIN",
        "base_url": "https://cityoflewistonme-energovweb.tylerhost.net/apps/SelfService",
        "search_keywords": ["solar"],
        "prefix": "permit_lewistonme",
    },
}


# ---------------------------------------------------------------------------
# Supabase helpers (same as ingest-permits.py)
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


def supabase_post(table, records):
    """POST batch of records with ignore-duplicates."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    try:
        body = json.dumps(records, allow_nan=False).encode()
    except ValueError:
        import math
        for r in records:
            for k, v in list(r.items()):
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    r[k] = None
        body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True, None
    except Exception as e:
        err_body = ""
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                pass
        return False, f"{e} | {err_body}" if err_body else str(e)


def get_existing_source_ids(prefix):
    """Get existing source_record_ids with given prefix."""
    existing = set()
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "source_record_id",
            "source_record_id": f"like.{prefix}_*",
            "offset": offset,
            "limit": 1000,
        })
        if not batch:
            break
        for r in batch:
            existing.add(r["source_record_id"])
        offset += len(batch)
        if len(batch) < 1000:
            break
    return existing


def get_data_source_id(name):
    """Get or create data source ID."""
    rows = supabase_get("solar_data_sources", {"name": f"eq.{name}", "select": "id"})
    if rows:
        return rows[0]["id"]
    url = f"{SUPABASE_URL}/rest/v1/solar_data_sources"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    body = json.dumps({"name": name, "url": "Proprietary permit portal (Playwright scrape)"}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data[0]["id"] if isinstance(data, list) else data["id"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SOLAR_FALSE_POSITIVES = re.compile(
    r'solar\s+screen|solar\s+shade|solar\s+tube|solar\s+film|solar\s+water\s+heat',
    re.IGNORECASE
)


def is_solar_false_positive(desc):
    if not desc:
        return False
    return bool(SOLAR_FALSE_POSITIVES.search(desc))


def parse_capacity_kw(desc):
    """Extract kW capacity from free-text description."""
    if not desc:
        return None
    m = re.search(r'([\d]+\.?\d*)\s*kw', desc, re.IGNORECASE)
    if m:
        try:
            val = float(m.group(1))
            if 0.1 <= val <= 100000:
                return val
        except ValueError:
            pass
    return None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_date(val):
    """Extract YYYY-MM-DD from various date formats."""
    if not val:
        return None
    s = str(val).strip()
    # MM/DD/YYYY
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    # YYYY-MM-DD
    if re.match(r'^\d{4}-\d{2}-\d{2}', s):
        return s[:10]
    return None


def make_installation(source_id, config, **fields):
    """Build installation record."""
    capacity_kw = fields.get("capacity_kw")
    return {
        "source_record_id": source_id,
        "site_name": fields.get("site_name"),
        "site_type": fields.get("site_type", "commercial"),
        "address": fields.get("address"),
        "city": fields.get("city"),
        "state": config["state"],
        "zip_code": fields.get("zip_code"),
        "county": fields.get("county", config.get("county")),
        "latitude": fields.get("latitude"),
        "longitude": fields.get("longitude"),
        "capacity_dc_kw": capacity_kw,
        "capacity_mw": round(capacity_kw / 1000, 3) if capacity_kw else None,
        "install_date": fields.get("install_date"),
        "site_status": fields.get("site_status", "active"),
        "installer_name": fields.get("installer_name"),
        "owner_name": fields.get("owner_name"),
        "developer_name": fields.get("developer_name"),
        "operator_name": fields.get("operator_name"),
        "total_cost": fields.get("total_cost"),
        "data_source_id": fields.get("data_source_id"),
        "has_battery_storage": fields.get("has_battery_storage", False),
    }


def parse_equipment_from_description(desc):
    """Extract panel/inverter manufacturer+model from permit description text."""
    equipment = []
    if not desc:
        return equipment

    # Panel patterns: "20 Silfab SIL-430-QD panels", "LG LG400N2W-A5", etc.
    panel_pattern = re.compile(
        r'(\d+)\s*(?:x\s*)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]*)?)\s+'
        r'([A-Z0-9][\w\-\.]+)\s*(?:panel|module)',
        re.IGNORECASE
    )
    m = panel_pattern.search(desc)
    if m:
        equipment.append({
            "equipment_type": "module",
            "manufacturer": m.group(2).strip(),
            "model": m.group(3).strip(),
            "quantity": int(m.group(1)),
        })

    # Inverter patterns: "Enphase IQ8PLUS-72-2-US", "SolarEdge SE7600H"
    inv_pattern = re.compile(
        r'(Enphase|SolarEdge|SMA|Fronius|ABB|Generac|Tesla|Huawei|GoodWe|Delta|Sungrow)\s+'
        r'([A-Z0-9][\w\-\.]+)',
        re.IGNORECASE
    )
    m = inv_pattern.search(desc)
    if m:
        equipment.append({
            "equipment_type": "inverter",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })

    # Racking: "Unirac NXT" or "IronRidge XR100"
    rack_pattern = re.compile(
        r'(Unirac|IronRidge|SnapNrack|Quick\s*Mount|Pegasus|Everest|K2)\s+'
        r'([A-Z0-9][\w\-\.]+)',
        re.IGNORECASE
    )
    m = rack_pattern.search(desc)
    if m:
        equipment.append({
            "equipment_type": "racking",
            "manufacturer": m.group(1).strip(),
            "model": m.group(2).strip(),
        })

    return equipment


# ---------------------------------------------------------------------------
# Accela Citizen Access scraper
# ---------------------------------------------------------------------------

async def scrape_accela(page, config):
    """Scrape an Accela Citizen Access portal using Playwright.

    Strategy:
    1. Navigate to home page
    2. Try module-specific search page (Permitting/Building)
    3. If that fails, use global search bar on home page
    4. Parse result table + paginate
    """
    base_url = config["base_url"]
    module = config.get("module", "Building")
    keywords = config.get("search_keywords", ["solar"])
    results = []

    print(f"    Navigating to {base_url}...")

    # Step 1: Load home page
    try:
        await page.goto(f"{base_url}/Default.aspx", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)
    except Exception as e:
        print(f"    Error loading home page: {e}")
        return results

    # Dismiss any popups/cookie banners
    for dismiss_sel in ["button:has-text('Accept')", "button:has-text('OK')", ".close-btn", "#btnAccept"]:
        try:
            btn = await page.query_selector(dismiss_sel)
            if btn and await btn.is_visible():
                await btn.click()
                await page.wait_for_timeout(500)
        except Exception:
            pass

    for keyword in keywords:
        print(f"    Searching for '{keyword}'...")

        found_results = False

        # Strategy A: Navigate directly to module search page via URL
        # Accela search pages are at: {base}/Cap/CapHome.aspx?module={ModuleName}
        try:
            # Try multiple module name variants
            module_names = [module, "Permits", "Permitting", "Building", "Permits and Contractors"]
            search_page_loaded = False

            # Keyword input selectors for Accela search forms
            keyword_selectors = [
                "input[id*='txtGSKeyword']",
                "input[id*='txtKeyword']",
                "input[id*='WorkDesc']",
                "input[id*='Description']",
                "textarea[id*='Description']",
            ]

            for mod_name in module_names:
                encoded_mod = urllib.parse.quote(mod_name)
                search_url = f"{base_url}/Cap/CapHome.aspx?module={encoded_mod}&TabName={encoded_mod}"
                print(f"    Trying module search: {mod_name}...")
                await page.goto(search_url, wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(3000)

                # Check if we got a real search page (not error)
                page_content = await page.content()
                if "error has occurred" in page_content.lower() or "page not found" in page_content.lower():
                    continue

                for sel in keyword_selectors:
                    el = await page.query_selector(sel)
                    if el and await el.is_visible():
                        search_page_loaded = True
                        await el.fill(keyword)
                        print(f"    Filled keyword in: {sel}")
                        break

                if search_page_loaded:
                    break

            # If URL-based navigation didn't find a search form, try clicking links
            if not search_page_loaded:
                print(f"    URL-based module search didn't find form, trying link navigation...")
                await page.goto(f"{base_url}/Default.aspx", wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(2000)

                # Try clicking "Search Cases" or "Search Permits" links
                search_case_selectors = [
                    "a:has-text('Search Cases')",
                    "a:has-text('Search Permits')",
                    "a:has-text('Search Records')",
                    "a:has-text('Search Applications')",
                    "a:has-text('Advanced Search')",
                    "a[href*='CapHome']",
                ]

                for sel in search_case_selectors:
                    links = await page.query_selector_all(sel)
                    for link in links:
                        if await link.is_visible():
                            link_text = (await link.inner_text()).strip()
                            print(f"    Clicking '{link_text}'...")
                            await link.click()
                            await page.wait_for_timeout(3000)

                            # Check if search form appeared
                            for ksel in keyword_selectors:
                                el = await page.query_selector(ksel)
                                if el and await el.is_visible():
                                    search_page_loaded = True
                                    await el.fill(keyword)
                                    print(f"    Filled keyword in: {ksel}")
                                    break
                            if search_page_loaded:
                                break
                    if search_page_loaded:
                        break

                # If still not loaded, try the Accela-specific "Reports" approach
                if not search_page_loaded:
                    print(f"    No search form found via any method")

            if search_page_loaded:
                # Click module search button
                search_btn_selectors = [
                    "a[id*='btnNewSearch']",
                    "input[id*='btnSearch']",
                    "button[id*='Search']",
                    "a[id*='Submit']",
                    "#ctl00_PlaceHolderMain_btnNewSearch",
                    "input[type='submit'][value*='Search']",
                    "a.ACA_LgButton:has-text('Search')",
                    "a.ACA_LgButton",
                ]
                for sel in search_btn_selectors:
                    btn = await page.query_selector(sel)
                    if btn:
                        try:
                            await btn.click(timeout=10000)
                            print(f"    Clicked search button: {sel}")
                            await page.wait_for_timeout(5000)
                            found_results = True
                            break
                        except Exception:
                            continue

        except Exception as e:
            print(f"    Module search failed: {e}")

        # Strategy B: If module search didn't work, use global search bar
        if not found_results:
            try:
                print(f"    Trying global search bar...")
                await page.goto(f"{base_url}/Default.aspx", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(2000)

                # Global search input — the text box in the header area
                global_selectors = [
                    "input[id*='txtSearchCondition']",
                    "input[id*='txtGSKeyword']",
                    "input[name*='SearchCondition']",
                    "input.ACA_Search_Input",
                    "#txtSearchCondition",
                ]
                search_input = None
                for sel in global_selectors:
                    search_input = await page.query_selector(sel)
                    if search_input:
                        break

                if search_input:
                    await search_input.fill(keyword)
                    await page.wait_for_timeout(500)

                    # Click the search icon button next to the input
                    search_icon_selectors = [
                        "img[id*='imgSearch']",
                        "a[id*='lnkSearch']",
                        "img[id*='imgGlobalSearch']",
                        "#imgSearch",
                        "#lnkGlobalSearch",
                        "a[onclick*='globalSearch']",
                        "img[onclick*='globalSearch']",
                        "a[onclick*='Search']",
                    ]
                    for sel in search_icon_selectors:
                        btn = await page.query_selector(sel)
                        if btn:
                            try:
                                await btn.click(timeout=10000)
                                print(f"    Clicked global search: {sel}")
                                await page.wait_for_timeout(5000)
                                found_results = True
                                break
                            except Exception:
                                continue

                    # If icon selectors didn't work, try pressing Enter
                    if not found_results:
                        print(f"    Pressing Enter on search input...")
                        await search_input.press("Enter")
                        await page.wait_for_timeout(5000)
                        found_results = True
                else:
                    print(f"    No global search input found")
                    continue

            except Exception as e:
                print(f"    Global search failed: {e}")
                continue

        # Strategy C: If global search returned "no results" with module links,
        # click "Search Records/Applications" or "Permitting" to use module search
        if found_results:
            page_content = await page.content()
            if "returned no results" in page_content.lower():
                print(f"    Global search returned no results, trying module search...")
                # Look for module-specific search links on the "no results" page
                module_links = [
                    "a:has-text('Search Records')",
                    "a:has-text('Permitting')",
                    "a:has-text('Building')",
                    "a[href*='CapHome']",
                ]
                for sel in module_links:
                    link = await page.query_selector(sel)
                    if link and await link.is_visible():
                        print(f"    Clicking module link: {sel}")
                        await link.click()
                        await page.wait_for_timeout(3000)

                        # Now on the module search page, fill keyword and submit
                        keyword_fields = [
                            "input[id*='txtGSKeyword']",
                            "input[id*='txtKeyword']",
                            "input[id*='WorkDesc']",
                            "input[id*='Description']",
                            "textarea[id*='Description']",
                        ]
                        for ksel in keyword_fields:
                            el = await page.query_selector(ksel)
                            if el and await el.is_visible():
                                await el.fill(keyword)
                                print(f"    Filled module search: {ksel}")
                                # Click submit
                                submit_sels = [
                                    "a[id*='btnNewSearch']",
                                    "input[id*='btnSearch']",
                                    "button[id*='Search']",
                                    "#ctl00_PlaceHolderMain_btnNewSearch",
                                    "a.ACA_LgButton",
                                ]
                                for ssel in submit_sels:
                                    sbtn = await page.query_selector(ssel)
                                    if sbtn:
                                        try:
                                            await sbtn.click(timeout=10000)
                                            print(f"    Clicked submit: {ssel}")
                                            await page.wait_for_timeout(5000)
                                            break
                                        except Exception:
                                            continue
                                break
                        break

        if not found_results:
            print(f"    Could not execute search on {config['name']}")
            continue

        # Step 3: Parse results table
        try:
            records = await parse_accela_results(page, config)
            print(f"    Found {len(records)} results for '{keyword}'")
            results.extend(records)
        except Exception as e:
            print(f"    Error parsing results: {e}")

        # Handle pagination
        page_num = 1
        while True:
            try:
                next_link = await page.query_selector(
                    "a[id*='Next'], a[class*='aca_pagination_next'], "
                    "a:has-text('Next'), td.aca_pagination_td a[href*='Page$Next']"
                )
                if not next_link:
                    break

                page_num += 1
                print(f"    Page {page_num}...")
                await next_link.click()
                await page.wait_for_timeout(3000)

                page_records = await parse_accela_results(page, config)
                if not page_records:
                    break
                results.extend(page_records)

                if page_num >= 50:
                    print(f"    Hit page limit (50)")
                    break

            except Exception as e:
                print(f"    Pagination error: {e}")
                break

    return results


async def parse_accela_results(page, config):
    """Parse the Accela results table into permit records."""
    records = []

    # Accela results are in a GridView table
    rows = await page.query_selector_all(
        "table[id*='GridView'] tr, "
        "table[id*='gdvPermitList'] tr, "
        "div.ACA_Grid_Row, "
        "table[class*='ACA_Grid_OverAll'] tbody tr"
    )

    for row in rows:
        # Skip header row
        header = await row.query_selector("th")
        if header:
            continue

        cells = await row.query_selector_all("td")
        if len(cells) < 3:
            continue

        # Extract text from cells
        cell_texts = []
        for cell in cells:
            text = (await cell.inner_text()).strip()
            cell_texts.append(text)

        # Try to identify fields based on common Accela column patterns
        # Typical columns: Record #, Record Type, Description, Address, Date, Status
        record = {}
        for i, text in enumerate(cell_texts):
            if not text:
                continue
            # Record number (permit ID): typically alphanumeric with dashes
            if re.match(r'^[A-Z]{2,4}[\-\d]+', text) and not record.get("permit_id"):
                record["permit_id"] = text
            # Date: MM/DD/YYYY
            elif re.match(r'^\d{1,2}/\d{1,2}/\d{4}$', text) and not record.get("date"):
                record["date"] = text
            # Address: has a number then street name
            elif re.match(r'^\d+\s+[A-Z]', text, re.IGNORECASE) and not record.get("address"):
                record["address"] = text
            # Description containing solar
            elif "solar" in text.lower() and not record.get("description"):
                record["description"] = text

        # Also try to get the detail link for more info
        detail_link = await row.query_selector("a[href*='CapDetail'], a[id*='lnkPermitNumber']")
        if detail_link:
            record["detail_href"] = await detail_link.get_attribute("href")
            if not record.get("permit_id"):
                record["permit_id"] = (await detail_link.inner_text()).strip()

        if record.get("permit_id"):
            records.append(record)

    return records


async def scrape_accela_detail(page, detail_url, config):
    """Scrape a single permit detail page for additional fields."""
    try:
        base = config["base_url"]
        if not detail_url.startswith("http"):
            detail_url = f"{base}/{detail_url.lstrip('/')}"

        await page.goto(detail_url, wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        details = {}

        # Look for common detail fields
        field_selectors = {
            "description": "[id*='Description'], [id*='WorkDesc']",
            "applicant": "[id*='Applicant'], [id*='ContactName']",
            "contractor": "[id*='Contractor'], [id*='LicensedProfessional']",
            "owner": "[id*='Owner'], [id*='PropertyOwner']",
            "address": "[id*='Address'], [id*='Location']",
            "valuation": "[id*='Valuation'], [id*='EstCost'], [id*='JobValue']",
            "status": "[id*='Status'], [id*='RecordStatus']",
        }

        for key, selector in field_selectors.items():
            el = await page.query_selector(selector)
            if el:
                text = (await el.inner_text()).strip()
                if text:
                    details[key] = text

        return details

    except Exception as e:
        return {}


# ---------------------------------------------------------------------------
# Tyler EnerGov scraper
# ---------------------------------------------------------------------------

async def scrape_tyler(page, config):
    """Scrape a Tyler EnerGov Self-Service portal using Playwright.

    Tyler EnerGov is an AngularJS SPA with these key pages:
    - Home: Landing page with "I want to..." selector
    - Apply: Application assistant for NEW permits (not what we want)
    - Search: Search EXISTING permits (what we want)

    Navigation: Home | Apply | Non-Emergency Requests | Today's Inspections | Map | Report | Search | ...
    """
    base_url = config["base_url"]
    keywords = config.get("search_keywords", ["solar"])
    results = []

    print(f"    Navigating to {base_url}...")

    try:
        await page.goto(base_url, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(5000)  # Wait for Angular to bootstrap
    except Exception as e:
        print(f"    Error loading page: {e}")
        return results

    # Dismiss cookie banners / popups
    for dismiss_sel in ["button:has-text('Accept')", "button:has-text('OK')", ".close-btn"]:
        try:
            btn = await page.query_selector(dismiss_sel)
            if btn and await btn.is_visible():
                await btn.click()
                await page.wait_for_timeout(500)
        except Exception:
            pass

    # Check if we're on the EnerGov SelfService app or a redirect
    page_content = await page.content()
    if "selfservice" not in page_content.lower() and "energov" not in page_content.lower():
        print(f"    Page does not appear to be EnerGov SelfService (possible redirect)")
        # Try adding #/search to the URL directly
        await page.goto(f"{base_url}#/search", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)

    for keyword in keywords:
        print(f"    Searching for '{keyword}'...")

        try:
            # Tyler EnerGov URL-based search pattern (discovered from portal URLs):
            # {base_url}#/search?m=1&fm=1&ps={pageSize}&pn={pageNum}&em={exactMatch}&st={searchTerm}
            # Parameters:
            #   st = search term
            #   ps = page size (10, 25, 50, 100)
            #   pn = page number (1-indexed)
            #   em = exact match (true/false)
            #   m = module (1 = permits)
            #   fm = filter mode (1 = all)

            page_size = 100  # Request max results per page
            encoded_kw = urllib.parse.quote(keyword)
            search_url = f"{base_url}#/search?m=1&fm=1&ps={page_size}&pn=1&em=false&st={encoded_kw}"

            print(f"    Navigating directly to search hash route...")
            await page.goto(search_url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(5000)  # Wait for Angular to render results

            # If URL-based search didn't load results, fallback to form-based search
            page_content = await page.content()
            has_results = "permit" in page_content.lower() and (
                await page.query_selector("a[href*='#/permit/'], a[href*='#/record/']")
            )

            if not has_results:
                # Fallback: navigate to search page and fill form
                print(f"    URL search didn't load results, trying form-based search...")
                await page.goto(f"{base_url}#/search", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(3000)

                # Find and fill search input
                search_input_selectors = [
                    "input[placeholder*='Search']",
                    "input[placeholder*='search']",
                    "input[type='search']",
                    "input[ng-model*='search']",
                    "input[ng-model*='keyword']",
                    "input.form-control[type='text']",
                ]

                search_input = None
                for sel in search_input_selectors:
                    inp = await page.query_selector(sel)
                    if inp and await inp.is_visible():
                        search_input = inp
                        print(f"    Found search input: {sel}")
                        break

                if search_input:
                    await search_input.fill(keyword)
                    await page.wait_for_timeout(500)

                    # Uncheck "Exact Phrase" checkbox if present
                    try:
                        exact_phrase = await page.query_selector(
                            "input[type='checkbox'][ng-model*='exact'], "
                            "input[type='checkbox'][data-ng-model*='exact'], "
                            "input#exactMatch"
                        )
                        if exact_phrase and await exact_phrase.is_checked():
                            await exact_phrase.uncheck()
                            print(f"    Unchecked 'Exact Phrase'")
                            await page.wait_for_timeout(500)
                    except Exception:
                        pass

                    # Click search button or press Enter
                    search_btn_selectors = [
                        "button[type='submit']",
                        "button:has-text('Search'):not([href])",
                        "button.btn-primary:has-text('Search')",
                        "input[type='submit']",
                    ]

                    clicked_btn = False
                    for sel in search_btn_selectors:
                        btn = await page.query_selector(sel)
                        if btn and await btn.is_visible():
                            try:
                                parent_btn = await btn.evaluate_handle("el => el.closest('button') || el")
                                await parent_btn.as_element().click(timeout=10000)
                                clicked_btn = True
                                print(f"    Clicked search button: {sel}")
                                break
                            except Exception:
                                continue

                    if not clicked_btn:
                        await search_input.press("Enter")

                    await page.wait_for_timeout(5000)
                else:
                    print(f"    No search input found on search page")
                    try:
                        await page.screenshot(path=f"/tmp/scrape_tyler_{config['prefix']}_nosearch.png")
                    except Exception:
                        pass
                    continue

            # Parse first page of results
            records = await parse_tyler_results(page, config)
            print(f"    Found {len(records)} results for '{keyword}'")
            results.extend(records)

            # Track seen permit IDs for dedup
            seen_permit_ids = set()
            for r in records:
                if r.get("permit_id"):
                    seen_permit_ids.add(r["permit_id"])

            # Click-based pagination: Tyler EnerGov SPA ignores URL pn= parameter.
            # Must click the actual #link-NextPage button to advance pages.
            # Pagination: <ul id="paginationList"> with <a id="link-NextPage">
            # Parent <li> gets class="disabled" on last page.
            page_num = 1
            while records:  # Only paginate if we got results
                # Check if Next button exists and is not disabled
                next_disabled = await page.evaluate(
                    "(() => { const btn = document.getElementById('link-NextPage');"
                    " if (!btn) return true;"
                    " const li = btn.parentElement;"
                    " return li && li.classList.contains('disabled'); })()"
                )

                if next_disabled:
                    break

                page_num += 1
                try:
                    await page.click('#link-NextPage')
                    await page.wait_for_timeout(3000)
                except Exception as click_err:
                    print(f"    Pagination click failed on page {page_num}: {click_err}")
                    break

                page_records = await parse_tyler_results(page, config)
                if not page_records:
                    break

                # Check for pagination loop (safety net)
                new_ids = set()
                for r in page_records:
                    pid = r.get("permit_id")
                    if pid and pid not in seen_permit_ids:
                        new_ids.add(pid)

                if not new_ids:
                    print(f"    Page {page_num}: all duplicates — stopping")
                    break

                # Show page range from startAndEndCount element
                try:
                    range_text = await page.text_content('#startAndEndCount')
                    range_text = range_text.strip() if range_text else ""
                except Exception:
                    range_text = ""

                print(f"    Page {page_num}: {len(new_ids)} new results ({range_text})")
                for pid in new_ids:
                    seen_permit_ids.add(pid)
                results.extend([r for r in page_records if r.get("permit_id") in new_ids])

                if page_num >= 200:
                    print(f"    Hit page limit (200)")
                    break

        except Exception as e:
            print(f"    Error during Tyler search: {e}")

    return results


async def parse_tyler_results(page, config):
    """Parse Tyler EnerGov search results.

    Tyler EnerGov "Public Information" search results layout:
    - Each permit is a block with label-value pairs
    - Permit Number is a linked <a> tag
    - Fields: Permit Number, Type, Project Name, Status, Main Parcel, Address, Description
    - Date fields: Applied Date, Issued Date, Expiration Date, Finalized Date
    - Each record has a "Previous | Next | Top | Paging Options" navigation line
    """
    records = []

    # Strategy 1: Find all permit number links — each represents one result
    # Tyler format: "Permit Number <a href='#/...'>396584RB</a>"
    permit_links = await page.query_selector_all("a[href*='#/permit/'], a[href*='#/record/']")

    if permit_links:
        print(f"    Found {len(permit_links)} permit links via href pattern")

    # If no permit links found via href, try broader text-based detection
    if not permit_links:
        # Try finding elements that look like permit numbers
        all_links = await page.query_selector_all("a")
        permit_links = []
        for link in all_links:
            try:
                text = (await link.inner_text()).strip()
                href = await link.get_attribute("href") or ""
                # Permit numbers are typically alphanumeric 5+ chars
                if text and re.match(r'^[A-Z0-9\-]{5,}$', text) and "paging" not in href.lower():
                    permit_links.append(link)
            except Exception:
                continue
        if permit_links:
            print(f"    Found {len(permit_links)} permit links via text pattern")

    if not permit_links:
        # Fallback: parse entire page text for structured data
        page_text = await page.inner_text("body")
        return parse_tyler_text_fallback(page_text, config)

    # For each permit link, extract the surrounding record block
    for link in permit_links:
        try:
            permit_id = (await link.inner_text()).strip()
            if not permit_id or len(permit_id) < 3:
                continue

            record = {"permit_id": permit_id}

            # Get the parent container — walk up to find the record block
            # In Tyler, the entire record block is typically a <div> or direct sibling elements
            # Get the surrounding text by evaluating from the link's parent context
            try:
                block_text = await link.evaluate("""
                    el => {
                        // Walk up to find a container that has address/description
                        let node = el.parentElement;
                        for (let i = 0; i < 5; i++) {
                            if (!node || !node.parentElement) break;
                            let text = node.innerText || '';
                            if (text.includes('Address') && text.includes('Description')) {
                                return text;
                            }
                            node = node.parentElement;
                        }
                        // Fallback: get text from sibling elements
                        let parent = el.parentElement;
                        if (parent) return parent.innerText || '';
                        return '';
                    }
                """)
            except Exception:
                block_text = ""

            if not block_text:
                # Try getting text of surrounding container
                try:
                    parent = await link.evaluate_handle("el => el.closest('div') || el.parentElement")
                    block_text = await parent.as_element().inner_text() if parent else ""
                except Exception:
                    block_text = ""

            # Parse fields from the block text
            if block_text:
                # Address: "Address 1312 LINDEN ST READING PA"
                addr_match = re.search(r'Address\s+(.+?)(?:\n|$)', block_text, re.IGNORECASE)
                if addr_match:
                    record["address"] = addr_match.group(1).strip()

                # Description
                desc_match = re.search(r'Description\s+(.+?)(?:\n|$)', block_text, re.IGNORECASE)
                if desc_match:
                    record["description"] = desc_match.group(1).strip()

                # Applied Date or Issued Date
                date_match = re.search(r'(?:Applied|Issued)\s+Date\s+(\d{1,2}/\d{1,2}/\d{4})', block_text)
                if date_match:
                    record["date"] = date_match.group(1)

                # Status
                status_match = re.search(r'Status\s+(\w+)', block_text)
                if status_match:
                    record["status"] = status_match.group(1).strip()

                # Type
                type_match = re.search(r'Type\s+(.+?)(?:\n|$)', block_text)
                if type_match:
                    record["permit_type"] = type_match.group(1).strip()

            records.append(record)

        except Exception as e:
            continue

    return records


def parse_tyler_text_fallback(page_text, config):
    """Fallback: parse Tyler results from raw page text when DOM selectors fail."""
    records = []

    # Split into blocks by "Permit Number" pattern
    blocks = re.split(r'(?=Permit\s+Number\s+)', page_text)

    for block in blocks:
        if not block.strip():
            continue

        record = {}

        # Permit Number
        perm_match = re.search(r'Permit\s+Number\s+([A-Z0-9\-]+)', block)
        if perm_match:
            record["permit_id"] = perm_match.group(1).strip()
        else:
            continue

        # Address
        addr_match = re.search(r'Address\s+(.+?)(?:\n|$)', block)
        if addr_match:
            record["address"] = addr_match.group(1).strip()

        # Description
        desc_match = re.search(r'Description\s+(.+?)(?:\n|$)', block)
        if desc_match:
            record["description"] = desc_match.group(1).strip()

        # Date
        date_match = re.search(r'(?:Applied|Issued)\s+Date\s+(\d{1,2}/\d{1,2}/\d{4})', block)
        if date_match:
            record["date"] = date_match.group(1)

        # Status
        status_match = re.search(r'Status\s+(\w[\w\s]*\w)', block)
        if status_match:
            record["status"] = status_match.group(1).strip()

        if record.get("permit_id"):
            records.append(record)

    return records


# ---------------------------------------------------------------------------
# Transform scraped records to installation records
# ---------------------------------------------------------------------------

def transform_scraped_record(record, data_source_id, config):
    """Transform a scraped permit record into a solar_installations record."""
    permit_id = record.get("permit_id", "")
    if not permit_id:
        return None, None, None

    # Clean permit ID for use in source_record_id
    clean_id = re.sub(r'[^a-zA-Z0-9\-_]', '_', permit_id)
    source_id = f"{config['prefix']}_{clean_id}"

    desc = record.get("description", "")
    if is_solar_false_positive(desc):
        return None, None, None

    capacity_kw = parse_capacity_kw(desc)
    address = record.get("address", "")

    # Try to extract city from address or use config
    city = record.get("city", config["name"].split(",")[0].strip())

    # Parse zip from address
    zip_code = None
    zip_match = re.search(r'\b(\d{5})(?:\-\d{4})?\b', address)
    if zip_match:
        zip_code = zip_match.group(1)

    inst = make_installation(
        source_id, config,
        address=address,
        city=city,
        zip_code=zip_code,
        capacity_kw=capacity_kw,
        install_date=safe_date(record.get("date")),
        installer_name=record.get("contractor") or record.get("applicant"),
        owner_name=record.get("owner"),
        total_cost=safe_float(record.get("valuation")),
        data_source_id=data_source_id,
    )

    equipment = parse_equipment_from_description(desc)
    return source_id, inst, equipment if equipment else None


# ---------------------------------------------------------------------------
# Main ingestion loop
# ---------------------------------------------------------------------------

async def scrape_portal(portal_key, config, dry_run=False, test_mode=False):
    """Scrape a single portal."""
    from playwright.async_api import async_playwright

    print(f"\n{'=' * 60}")
    print(f"Scraping {config['name']} ({config['platform']})")
    print(f"{'=' * 60}")
    print(f"  URL: {config['base_url']}")
    print(f"  Prefix: {config['prefix']}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()

        # Set longer default timeout
        page.set_default_timeout(30000)

        try:
            if config["platform"] == "accela":
                raw_records = await scrape_accela(page, config)
            elif config["platform"] == "tyler":
                raw_records = await scrape_tyler(page, config)
            else:
                print(f"  Unknown platform: {config['platform']}")
                return 0, 0
        except Exception as e:
            print(f"  ERROR scraping: {e}")
            screenshot_path = f"/tmp/scrape_{portal_key}_error.png"
            try:
                await page.screenshot(path=screenshot_path)
                print(f"  Screenshot saved: {screenshot_path}")
            except Exception:
                pass
            await browser.close()
            return 0, 0

        # Always save a screenshot in test mode
        if test_mode:
            screenshot_path = f"/tmp/scrape_{portal_key}_results.png"
            try:
                await page.screenshot(path=screenshot_path, full_page=True)
                print(f"  Screenshot saved: {screenshot_path}")
            except Exception:
                pass

            # Print page URL for debugging
            print(f"  Current URL: {page.url}")

            # Optionally scrape detail pages for first few results
            for i, rec in enumerate(raw_records[:3]):
                if rec.get("detail_href"):
                    print(f"  Fetching detail for {rec.get('permit_id', 'unknown')}...")
                    if config["platform"] == "accela":
                        details = await scrape_accela_detail(page, rec["detail_href"], config)
                    else:
                        details = {}
                    rec.update(details)

        await browser.close()

    print(f"  Scraped: {len(raw_records)} records")
    if not raw_records:
        print("  No records found!")
        return 0, 0

    # Show sample records
    for rec in raw_records[:5]:
        print(f"    {rec.get('permit_id', 'N/A')} | {rec.get('address', 'N/A')} | {rec.get('date', 'N/A')}")

    if test_mode:
        print(f"\n  [TEST MODE] Found {len(raw_records)} records. Not ingesting.")
        return len(raw_records), 0

    # Get data source ID
    ds_name = f"municipal_permits_{portal_key}"
    if not dry_run:
        data_source_id = get_data_source_id(ds_name)
    else:
        data_source_id = "dry-run"

    # Get existing IDs
    if not dry_run:
        existing_ids = get_existing_source_ids(config["prefix"])
        print(f"  Existing records: {len(existing_ids)}")
    else:
        existing_ids = set()

    # Transform records
    installations = []
    equipment_batches = []
    skipped_dup = 0
    skipped_invalid = 0
    seen_ids = set()

    for raw in raw_records:
        source_id, inst, equip = transform_scraped_record(raw, data_source_id, config)
        if not source_id or not inst:
            skipped_invalid += 1
            continue
        if source_id in existing_ids or source_id in seen_ids:
            skipped_dup += 1
            continue
        seen_ids.add(source_id)
        installations.append(inst)
        if equip:
            equipment_batches.append((source_id, equip))

    print(f"  Transformed: {len(installations)}")
    print(f"  Skipped (duplicate): {skipped_dup}")
    print(f"  Skipped (invalid/filtered): {skipped_invalid}")

    if dry_run:
        print(f"\n  [DRY RUN] Would ingest {len(installations)} records")
        return len(installations), 0

    if not installations:
        print("  No new records to ingest.")
        return 0, 0

    # Batch insert
    print(f"\n  Inserting {len(installations)} records...")
    created = 0
    errors = 0
    for i in range(0, len(installations), BATCH_SIZE):
        batch = installations[i:i + BATCH_SIZE]
        ok, err = supabase_post("solar_installations", batch)
        if ok:
            created += len(batch)
        else:
            errors += len(batch)
            if errors <= 500:
                print(f"    Batch error at {i}: {err}")

    print(f"  Created: {created}")
    print(f"  Errors: {errors}")

    # Insert equipment
    if equipment_batches and created > 0:
        print(f"\n  Inserting equipment for {len(equipment_batches)} installations...")
        eq_created = 0
        for source_id, equip_list in equipment_batches:
            rows = supabase_get("solar_installations", {
                "select": "id",
                "source_record_id": f"eq.{source_id}",
                "limit": 1,
            })
            if not rows:
                continue
            inst_id = rows[0]["id"]
            for eq in equip_list:
                eq_record = {
                    "installation_id": inst_id,
                    "equipment_type": eq.get("equipment_type"),
                    "manufacturer": eq.get("manufacturer"),
                    "model": eq.get("model"),
                    "quantity": eq.get("quantity", 1),
                    "data_source_id": data_source_id,
                }
                ok, _ = supabase_post("solar_equipment", [eq_record])
                if ok:
                    eq_created += 1
        print(f"  Equipment created: {eq_created}")

    return created, errors


def main():
    import asyncio

    parser = argparse.ArgumentParser(description="Proprietary permit portal scraper")
    parser.add_argument("--dry-run", action="store_true", help="Count without ingesting")
    parser.add_argument("--portal", type=str, help="Portal key(s), comma-separated")
    parser.add_argument("--platform", type=str, choices=["accela", "tyler"], help="Platform type filter")
    parser.add_argument("--list", action="store_true", help="List available portals")
    parser.add_argument("--test", type=str, help="Test single portal (saves screenshots)")

    args = parser.parse_args()

    if args.list:
        print("Available portals:")
        for platform in ["accela", "tyler"]:
            plist = {k: v for k, v in PORTALS.items() if v["platform"] == platform}
            if plist:
                print(f"\n  {platform.upper()}:")
                for key, cfg in sorted(plist.items()):
                    print(f"    {key:20s} {cfg['name']:30s} ({cfg['state']})")
        return

    if args.test:
        portal_key = args.test
        if portal_key not in PORTALS:
            print(f"Error: Unknown portal '{portal_key}'. Use --list.")
            sys.exit(1)
        config = PORTALS[portal_key]
        asyncio.run(scrape_portal(portal_key, config, dry_run=True, test_mode=True))
        return

    print("Proprietary Permit Portal Scraper")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    if args.portal:
        keys = [k.strip() for k in args.portal.split(",")]
        portals_to_process = {}
        for k in keys:
            if k not in PORTALS:
                print(f"  Error: Unknown portal '{k}'. Use --list.")
                sys.exit(1)
            portals_to_process[k] = PORTALS[k]
    elif args.platform:
        portals_to_process = {k: v for k, v in PORTALS.items() if v["platform"] == args.platform}
    else:
        portals_to_process = PORTALS

    print(f"  Portals ({len(portals_to_process)}): {', '.join(c['name'] for c in portals_to_process.values())}")

    total_created = 0
    total_errors = 0

    for key, config in portals_to_process.items():
        created, errors = asyncio.run(scrape_portal(key, config, args.dry_run))
        total_created += created
        total_errors += errors

    print(f"\n{'=' * 60}")
    print(f"Summary")
    print(f"{'=' * 60}")
    print(f"  Total created: {total_created}")
    print(f"  Total errors: {total_errors}")
    print(f"\nDone!")


if __name__ == "__main__":
    main()

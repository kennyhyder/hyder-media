#!/usr/bin/env python3
"""
Scrape contact information (email, phone) from IXP facility and datacenter websites.

Fetches HTML from websites already stored in the database, extracts email addresses
and phone numbers via regex, and updates sales_email / sales_phone fields.

No external dependencies — uses only Python stdlib (urllib, re, html.parser).

Usage:
    python3 -u scripts/scrape-website-contacts.py                  # Both tables
    python3 -u scripts/scrape-website-contacts.py --table ixp      # IXP facilities only
    python3 -u scripts/scrape-website-contacts.py --table dc       # Datacenters only
    python3 -u scripts/scrape-website-contacts.py --dry-run        # Preview without updating
    python3 -u scripts/scrape-website-contacts.py --limit 50       # Process first N records
    python3 -u scripts/scrape-website-contacts.py --verbose        # Show all found contacts
"""

import os
import sys
import json
import re
import time
import ssl
import argparse
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

BATCH_SIZE = 50
REQUEST_DELAY = 1.0  # seconds between website fetches

# ─── Supabase helpers ───────────────────────────────────────────────────────

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


def supabase_get_all(path):
    """Paginate through all records."""
    results = []
    offset = 0
    page_size = 1000
    while True:
        sep = '&' if '?' in path else '?'
        page_path = f"{path}{sep}offset={offset}&limit={page_size}"
        headers = {'Prefer': 'count=exact', 'Range-Unit': 'items'}
        batch = supabase_request('GET', page_path, headers_extra=headers)
        if not batch:
            break
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


# ─── Email / Phone skip lists ──────────────────────────────────────────────

SKIP_EMAIL_PREFIXES = {
    'noreply', 'no-reply', 'donotreply', 'do-not-reply',
    'abuse', 'hostmaster', 'postmaster', 'webmaster',
    'mailer-daemon', 'daemon', 'root', 'admin',
    'unsubscribe', 'bounce', 'returns', 'devnull',
    'null', 'nobody', 'system', 'auto', 'automated',
    'notification', 'notifications', 'alert', 'alerts',
    'example', 'test', 'spam', 'junk',
    'privacy', 'legal', 'compliance', 'dmca',
    'dmarc-reports', 'dmarc', 'feedback-report',
}

# Emails containing these substrings are likely false positives
SKIP_EMAIL_DOMAINS = {
    'example.com', 'example.org', 'example.net',
    'test.com', 'localhost', 'sentry.io',
    'doe.com', 'domain.com', 'email.com',
    'yourcompany.com', 'company.com', 'yourdomain.com',
    'schema.org', 'w3.org', 'wix.com',
    'lewispr.com',  # PR firm, not actual sales contacts
    'newsletters.nasa.gov',
    'wordpress.com', 'wordpress.org', 'gravatar.com',
    'cloudflare.com', 'googleapis.com', 'google.com',
    'facebook.com', 'twitter.com', 'instagram.com',
    'linkedin.com', 'github.com', 'youtube.com',
}

# Prefer these email prefixes (ranked: lower index = higher priority)
PREFERRED_EMAIL_PREFIXES = [
    'sales', 'contact', 'info', 'hello', 'inquiries', 'inquiry',
    'colocation', 'colo', 'datacenter', 'peering',
    'business', 'support', 'helpdesk', 'help',
    'general', 'office', 'reception',
]

# Common false positive phone patterns to skip
SKIP_PHONE_PATTERNS = {
    '0000000000', '1111111111', '1234567890',
    '8005551212', '5551212',
}

# ─── Contact page URL patterns ─────────────────────────────────────────────

CONTACT_PATHS = [
    '/contact', '/contact-us', '/contact.html', '/contact-us.html',
    '/about', '/about-us', '/about.html', '/about-us.html',
    '/company/contact', '/company/about',
    '/get-in-touch', '/reach-us',
    '/colocation', '/colocation/contact',
    '/data-center', '/data-centers',
]

# ─── HTML link extractor ───────────────────────────────────────────────────

class LinkExtractor(HTMLParser):
    """Extract href values from <a> tags and all visible text."""

    def __init__(self):
        super().__init__()
        self.hrefs = []
        self.texts = []
        self._in_script = False
        self._in_style = False

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self._in_script = True
        elif tag == 'style':
            self._in_style = True
        elif tag == 'a':
            for name, value in attrs:
                if name == 'href' and value:
                    self.hrefs.append(value)

    def handle_endtag(self, tag):
        if tag == 'script':
            self._in_script = False
        elif tag == 'style':
            self._in_style = False

    def handle_data(self, data):
        if not self._in_script and not self._in_style:
            self.texts.append(data)

    def error(self, message):
        pass


# ─── Website fetcher ───────────────────────────────────────────────────────

# Lenient SSL context for sites with bad certificates
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)


def normalize_url(url):
    """Ensure URL has scheme and is well-formed."""
    url = url.strip()
    if not url:
        return None
    # Remove trailing slashes for consistency
    if url.startswith('//'):
        url = 'https:' + url
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url


def fetch_page(url, timeout=15):
    """Fetch a single URL, return HTML text or None on failure."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        })
        # Try with SSL verification first
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                # Only process HTML responses
                content_type = resp.headers.get('Content-Type', '')
                if 'html' not in content_type.lower() and 'text' not in content_type.lower():
                    return None
                data = resp.read(500_000)  # Max 500KB
                # Try to detect encoding
                encoding = 'utf-8'
                ct = resp.headers.get('Content-Type', '')
                if 'charset=' in ct:
                    encoding = ct.split('charset=')[-1].split(';')[0].strip()
                try:
                    return data.decode(encoding, errors='replace')
                except (LookupError, UnicodeDecodeError):
                    return data.decode('utf-8', errors='replace')
        except ssl.SSLError:
            # Retry with lenient SSL
            with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx) as resp:
                content_type = resp.headers.get('Content-Type', '')
                if 'html' not in content_type.lower() and 'text' not in content_type.lower():
                    return None
                data = resp.read(500_000)
                try:
                    return data.decode('utf-8', errors='replace')
                except UnicodeDecodeError:
                    return data.decode('latin-1', errors='replace')
    except urllib.error.HTTPError as e:
        if e.code in (403, 401, 406):
            return None  # Access denied, skip silently
        return None
    except Exception:
        return None


# ─── Email extraction ──────────────────────────────────────────────────────

# Match email-like patterns
EMAIL_RE = re.compile(
    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
    re.IGNORECASE
)

# Match mailto: links specifically
MAILTO_RE = re.compile(
    r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE
)


def extract_emails(html_text, hrefs):
    """Extract valid email addresses from HTML content and links."""
    emails = set()

    # From mailto: links (highest confidence)
    for href in hrefs:
        # URL-decode first to handle %20 and other encoded chars
        decoded_href = urllib.parse.unquote(href).strip()
        m = MAILTO_RE.match(decoded_href)
        if m:
            emails.add(m.group(1).strip().lower())

    # From mailto: in raw HTML (catches JS-generated links too)
    for m in MAILTO_RE.finditer(html_text):
        email = urllib.parse.unquote(m.group(1)).strip().lower()
        emails.add(email)

    # From visible text patterns
    for m in EMAIL_RE.finditer(html_text):
        email = m.group(0).lower()
        # Skip if it looks like a file path or CSS/JS artifact
        if any(email.endswith(ext) for ext in ['.png', '.jpg', '.gif', '.svg', '.css', '.js', '.webp']):
            continue
        emails.add(email)

    # Filter out junk
    filtered = []
    for email in emails:
        local, _, domain = email.partition('@')
        if not domain:
            continue
        # Skip known bad prefixes
        if local in SKIP_EMAIL_PREFIXES:
            continue
        # Skip known bad domains
        if domain in SKIP_EMAIL_DOMAINS:
            continue
        # Skip very long emails (likely garbage)
        if len(email) > 80:
            continue
        # Skip emails with too many dots in local part (likely version strings)
        if local.count('.') > 3:
            continue
        filtered.append(email)

    return filtered


def pick_best_email(emails):
    """Pick the best email from a list, preferring sales/contact/info."""
    if not emails:
        return None

    # Score each email
    scored = []
    for email in emails:
        local = email.split('@')[0].lower()
        score = 100  # default score
        for i, prefix in enumerate(PREFERRED_EMAIL_PREFIXES):
            if local == prefix or local.startswith(prefix + '.') or local.startswith(prefix + '-'):
                score = i  # lower = better
                break
        scored.append((score, email))

    scored.sort(key=lambda x: x[0])
    return scored[0][1]


# ─── Phone extraction ──────────────────────────────────────────────────────

# tel: link pattern
TEL_RE = re.compile(r'tel:([+\d\s\-().]+)', re.IGNORECASE)

# US phone patterns in text (10-digit with optional +1 country code)
# Matches: (555) 123-4567, 555-123-4567, 555.123.4567, +1-555-123-4567, 1.555.123.4567
US_PHONE_RE = re.compile(
    r'(?<!\d)'                        # Not preceded by digit
    r'(?:\+?1[\s.\-]?)?'             # Optional +1 country code
    r'(?:'
    r'\(\d{3}\)[\s.\-]?\d{3}[\s.\-]?\d{4}'  # (555) 123-4567
    r'|'
    r'\d{3}[\s.\-]\d{3}[\s.\-]\d{4}'        # 555-123-4567 or 555.123.4567
    r')'
    r'(?!\d)',                        # Not followed by digit
    re.IGNORECASE
)


def normalize_phone(phone_str):
    """Normalize a phone string to digits only, return 10-digit US number or None."""
    digits = re.sub(r'\D', '', phone_str)
    # Strip leading 1 for US country code
    if len(digits) == 11 and digits.startswith('1'):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    # Skip known false positives
    if digits in SKIP_PHONE_PATTERNS:
        return None
    # Skip toll-free 800 numbers (less useful for sales contact)
    # Actually, keep toll-free — many DCs use 800 numbers for sales
    return digits


def format_phone(digits):
    """Format 10 digits as (XXX) XXX-XXXX."""
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def extract_phones(html_text, hrefs):
    """Extract valid US phone numbers from HTML content and links."""
    phones = set()

    # From tel: links
    for href in hrefs:
        m = TEL_RE.match(href)
        if m:
            norm = normalize_phone(m.group(1))
            if norm:
                phones.add(norm)

    # From tel: in raw HTML
    for m in TEL_RE.finditer(html_text):
        norm = normalize_phone(m.group(1))
        if norm:
            phones.add(norm)

    # From visible text
    for m in US_PHONE_RE.finditer(html_text):
        norm = normalize_phone(m.group(0))
        if norm:
            phones.add(norm)

    return list(phones)


def pick_best_phone(phones):
    """Pick the best phone — prefer non-800 numbers (more likely direct sales)."""
    if not phones:
        return None
    # Sort: non-toll-free first
    def sort_key(p):
        if p.startswith('800') or p.startswith('888') or p.startswith('877') or p.startswith('866'):
            return 1
        return 0
    phones.sort(key=sort_key)
    return phones[0]


# ─── Main scraping logic ──────────────────────────────────────────────────

def scrape_contacts(url, verbose=False):
    """Scrape a website for email and phone contacts.

    Returns (best_email, best_phone, all_emails, all_phones).
    """
    base_url = normalize_url(url)
    if not base_url:
        return None, None, [], []

    all_emails = []
    all_phones = []
    pages_tried = 0

    # Parse base URL for constructing subpages
    parsed = urllib.parse.urlparse(base_url)
    base_origin = f"{parsed.scheme}://{parsed.netloc}"

    # Phase 1: Try the homepage
    html = fetch_page(base_url)
    pages_tried += 1
    if html:
        parser = LinkExtractor()
        try:
            parser.feed(html)
        except Exception:
            pass
        all_emails.extend(extract_emails(html, parser.hrefs))
        all_phones.extend(extract_phones(html, parser.hrefs))

    # Phase 2: If missing email or phone, try contact/about pages
    if not all_emails or not all_phones:
        for subpath in CONTACT_PATHS:
            contact_url = base_origin + subpath
            time.sleep(0.3)  # Brief delay between subpages
            html = fetch_page(contact_url, timeout=10)
            pages_tried += 1
            if html:
                parser = LinkExtractor()
                try:
                    parser.feed(html)
                except Exception:
                    pass
                new_emails = extract_emails(html, parser.hrefs)
                new_phones = extract_phones(html, parser.hrefs)
                all_emails.extend(new_emails)
                all_phones.extend(new_phones)
                # If we found both, stop early
                if all_emails and all_phones:
                    break
            # Stop after trying 6 subpages max to stay polite
            if pages_tried >= 7:
                break

    # Deduplicate
    all_emails = list(dict.fromkeys(all_emails))  # preserve order, remove dupes
    all_phones = list(dict.fromkeys(all_phones))

    best_email = pick_best_email(all_emails)
    best_phone = pick_best_phone(all_phones)

    if verbose and (all_emails or all_phones):
        print(f"    Emails found: {all_emails}")
        print(f"    Phones found: {[format_phone(p) for p in all_phones]}")
        if best_email:
            print(f"    Best email: {best_email}")
        if best_phone:
            print(f"    Best phone: {format_phone(best_phone)}")

    return best_email, best_phone, all_emails, all_phones


# ─── Database operations ───────────────────────────────────────────────────

def load_records(table, limit=None):
    """Load records with website but missing sales_email or sales_phone."""
    if table == 'ixp':
        tbl = 'grid_ixp_facilities'
        cols = 'id,name,website,sales_email,sales_phone'
    else:
        tbl = 'grid_datacenters'
        cols = 'id,name,website,sales_email,sales_phone'

    # Records that have website AND are missing email or phone
    path = (
        f"{tbl}?select={cols}"
        f"&website=not.is.null"
        f"&or=(sales_email.is.null,sales_phone.is.null)"
        f"&order=id"
    )
    if limit:
        path += f"&limit={limit}"
        return supabase_request('GET', path) or []
    else:
        return supabase_get_all(path)


def patch_record(table, record_id, updates, dry_run=False):
    """Update a record with found contacts."""
    if table == 'ixp':
        tbl = 'grid_ixp_facilities'
    else:
        tbl = 'grid_datacenters'

    if dry_run:
        return True

    path = f"{tbl}?id=eq.{record_id}"
    try:
        supabase_request('PATCH', path, data=updates)
        return True
    except Exception as e:
        print(f"    PATCH error: {e}")
        return False


# ─── Main ──────────────────────────────────────────────────────────────────

def process_table(table_key, table_label, limit=None, dry_run=False, verbose=False):
    """Process one table (ixp or dc)."""
    print(f"\n{'='*70}")
    print(f"Processing: {table_label}")
    print(f"{'='*70}")

    records = load_records(table_key, limit)
    total = len(records)
    print(f"Loaded {total} records with website but missing email or phone\n")

    if total == 0:
        return 0, 0, 0

    stats = {
        'processed': 0,
        'email_found': 0,
        'phone_found': 0,
        'both_found': 0,
        'neither_found': 0,
        'errors': 0,
        'skipped_has_both': 0,
        'patched': 0,
    }

    for i, rec in enumerate(records):
        rec_id = rec['id']
        name = rec.get('name', 'Unknown')
        website = rec.get('website', '')
        existing_email = rec.get('sales_email')
        existing_phone = rec.get('sales_phone')

        # Skip if somehow both are filled (shouldn't happen with our query)
        if existing_email and existing_phone:
            stats['skipped_has_both'] += 1
            continue

        stats['processed'] += 1
        pct = (i + 1) / total * 100
        print(f"[{i+1}/{total} {pct:.0f}%] {name[:50]} — {website[:60]}")

        try:
            best_email, best_phone, all_emails, all_phones = scrape_contacts(
                website, verbose=verbose
            )
        except Exception as e:
            print(f"    ERROR: {e}")
            stats['errors'] += 1
            time.sleep(REQUEST_DELAY)
            continue

        # Build update payload (only fill missing fields)
        updates = {}
        if not existing_email and best_email:
            updates['sales_email'] = best_email
            stats['email_found'] += 1
        if not existing_phone and best_phone:
            updates['sales_phone'] = format_phone(best_phone)
            stats['phone_found'] += 1

        if best_email and best_phone:
            stats['both_found'] += 1
        elif not best_email and not best_phone:
            stats['neither_found'] += 1
            if verbose:
                print(f"    No contacts found")

        if updates:
            action = "WOULD PATCH" if dry_run else "PATCH"
            print(f"    {action}: {updates}")
            ok = patch_record(table_key, rec_id, updates, dry_run=dry_run)
            if ok:
                stats['patched'] += 1

        # Rate limit
        time.sleep(REQUEST_DELAY)

    # Summary
    print(f"\n--- {table_label} Summary ---")
    print(f"  Processed:     {stats['processed']}")
    print(f"  Emails found:  {stats['email_found']}")
    print(f"  Phones found:  {stats['phone_found']}")
    print(f"  Both found:    {stats['both_found']}")
    print(f"  Neither found: {stats['neither_found']}")
    print(f"  Patched:       {stats['patched']}")
    print(f"  Errors:        {stats['errors']}")

    return stats['email_found'], stats['phone_found'], stats['patched']


def main():
    parser = argparse.ArgumentParser(description='Scrape website contacts for IXP/DC records')
    parser.add_argument('--table', choices=['ixp', 'dc', 'both'], default='both',
                        help='Which table to process (default: both)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview without updating database')
    parser.add_argument('--limit', type=int, default=None,
                        help='Max records to process per table')
    parser.add_argument('--verbose', action='store_true',
                        help='Show all found contacts per record')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in grid/.env.local")
        sys.exit(1)

    print("GridScout Contact Scraper")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"  Table: {args.table}")
    if args.limit:
        print(f"  Limit: {args.limit} per table")
    print(f"  Rate limit: {REQUEST_DELAY}s between requests")
    print(f"  Contact subpages: {len(CONTACT_PATHS)} paths")

    total_emails = 0
    total_phones = 0
    total_patched = 0

    if args.table in ('ixp', 'both'):
        e, p, pat = process_table('ixp', 'IXP Facilities', args.limit, args.dry_run, args.verbose)
        total_emails += e
        total_phones += p
        total_patched += pat

    if args.table in ('dc', 'both'):
        e, p, pat = process_table('dc', 'Datacenters', args.limit, args.dry_run, args.verbose)
        total_emails += e
        total_phones += p
        total_patched += pat

    print(f"\n{'='*70}")
    print(f"GRAND TOTAL")
    print(f"{'='*70}")
    print(f"  Emails found:  {total_emails}")
    print(f"  Phones found:  {total_phones}")
    print(f"  Records patched: {total_patched}")
    if args.dry_run:
        print(f"\n  (DRY RUN — no database changes made)")


if __name__ == '__main__':
    main()

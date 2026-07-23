#!/usr/bin/env python3
"""
National bail-bonds directory — static site generator (Track 2 staging build).

Structure:
  bailbonds/index.html                    — national index (51 states/DC)
  bailbonds/<state>/index.html            — state page
  bailbonds/<state>/<county>/index.html   — county page (~3,144)
  bailbonds/sitemap.xml                   — full URL set (domain configurable)

Optimization layer (built-in on every page):
  - Unique <title> + meta description + Open Graph tags
  - JSON-LD: BreadcrumbList + FAQPage (mirrors the visible FAQ)
  - State-aware FAQ block (premium/cost, jail lookup, timing, affordability)
  - Internal-link mesh: largest counties in-state + alphabetical neighbors
  - Licensed-agent listings from official rosters (bailbonds/data/agents/*.json)
    with source attribution and license numbers

Content is STATE-AWARE (legal / impaired / none) — see states.json. Texas
keeps its richer template (county boards, verified jails, §1704.163 attorney
bonds — TX law, never rendered elsewhere).

STAGING: every page carries noindex until the permanent domain. Set DOMAIN
below at transfer time and drop the noindex flag via INDEXABLE.

Run: python3 scripts/build-bailbonds.py
"""

import glob
import html as html_mod
import json
import os
import shutil

ROOT = os.path.join(os.path.dirname(__file__), '..', 'bailbonds')
DATA = os.path.join(ROOT, 'data')

DOMAIN = 'https://hyder.me/bailbonds'   # swap at domain-transfer time
BASE = '/bailbonds'                      # URL prefix; set to '' after domain transfer
INDEXABLE = False                        # flip to True at transfer time

counties = json.load(open(os.path.join(DATA, 'counties.json')))
states = {s['abbr']: s for s in json.load(open(os.path.join(DATA, 'states.json')))}

def load_keyed(fname):
    path = os.path.join(DATA, fname)
    if not os.path.exists(path):
        return {}
    return {j['county']: j for j in json.load(open(path))}

tx_jails = load_keyed('jails.json')
tx_boards = load_keyed('boards.json')

def load_geo(fname):
    path = os.path.join(DATA, 'geo', fname)
    return json.load(open(path)) if os.path.exists(path) else {}

county_centroids = load_geo('county-centroids.json')   # FIPS -> [lat,lng]
city_centroids = load_geo('city-centroids.json')       # "ST:city" -> [lat,lng]
agent_geo = load_geo('agents-geo.json')                # "ST:idx" -> [lat,lng]
jail_coords = load_geo('jail-coords.json')             # TX county -> [lat,lng]

def agent_coords(a):
    g = agent_geo.get(a.get('geo_id') or '')
    if g:
        return g, 'exact'
    if a.get('city'):
        c = city_centroids.get(f"{a['state']}:{str(a['city']).lower().strip()}")
        if c:
            return c, 'city'
    return None, None

# ---- Licensed-agent rosters: data/agents/*.json → indexed by state / (state, county)
def norm_county(name):
    """'Orleans Parish' / 'Orleans' / 'orleans county' → 'orleans' so roster
    county names match county-page names regardless of suffix style."""
    n = str(name).lower().strip()
    for suffix in (' county', ' parish', ' borough', ' census area', ' municipality', ' city and borough'):
        if n.endswith(suffix):
            n = n[: -len(suffix)]
    return n

def display_name(n):
    n = str(n or '').strip()
    return n.title() if n.isupper() else n

def agent_slug(a, taken):
    import re as _re, unicodedata as _ud
    base = _ud.normalize('NFKD', str(a['name'])).encode('ascii', 'ignore').decode()
    base = _re.sub(r'[^a-z0-9]+', '-', base.lower()).strip('-')[:60] or 'agent'
    lic = _re.sub(r'[^a-z0-9]+', '-', str(a.get('license') or '').lower()).strip('-')
    slug = f"{base}-{lic}" if lic else base
    n, s2 = 2, slug
    while s2 in taken:
        s2 = f"{slug}-{n}"; n += 1
    taken.add(s2)
    return s2

agents_by_state = {}
agents_by_county = {}
for path in sorted(glob.glob(os.path.join(DATA, 'agents', '*.json'))):
    _fstate = os.path.basename(path)[:-5].upper()
    for _i, a in enumerate(json.load(open(path))):
        a['geo_id'] = f'{_fstate}:{_i}'
        st = a.get('state')
        if not st or not a.get('name'):
            continue
        agents_by_state.setdefault(st, []).append(a)
        if a.get('county'):
            agents_by_county.setdefault((st, norm_county(a['county'])), []).append(a)

for _st, _rows in agents_by_state.items():
    _taken = set()
    for _a in _rows:
        _a['slug'] = agent_slug(_a, _taken)

def esc(s):
    return html_mod.escape(str(s), quote=False) if s else ''

CSS = """
:root { --ink:#1a2333; --muted:#5b6779; --accent:#1d5fbf; --bg:#f7f8fa; --card:#ffffff; --line:#e3e7ee; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--ink); line-height:1.65; }
.wrap { max-width:960px; margin:0 auto; padding:32px 20px 64px; }
header.site { border-bottom:1px solid var(--line); background:var(--card); }
header.site .wrap { padding:18px 20px; display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
.brand { font-weight:800; font-size:1.15rem; color:var(--ink); text-decoration:none; }
.brand span { color:var(--accent); }
.tagline { color:var(--muted); font-size:.85rem; }
h1 { font-size:1.7rem; margin:18px 0 6px; }
h2 { font-size:1.2rem; margin:28px 0 10px; }
h3 { font-size:1rem; margin:16px 0 6px; }
p { margin-bottom:12px; }
.sub { color:var(--muted); }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:22px 24px; margin:16px 0; }
.facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin:16px 0; }
.fact { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.fact .k { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.fact .v { font-size:1.2rem; font-weight:700; margin-top:2px; }
.fact .v.small { font-size:.92rem; }
.badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.75rem; font-weight:600; background:#e8f0fd; color:var(--accent); }
.badge.warn { background:#fdf0e8; color:#b45816; }
.badge.off { background:#f2e8ee; color:#9c2f5f; }
ul { margin:0 0 12px 22px; }
li { margin-bottom:6px; }
a { color:var(--accent); }
.county-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:10px; margin-top:18px; }
.county-grid a { display:block; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 14px; text-decoration:none; color:var(--ink); font-size:.92rem; }
.county-grid a:hover { border-color:var(--accent); }
.county-grid .pop { color:var(--muted); font-size:.78rem; }
.agent-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; margin-top:14px; }
.agent { display:block; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px 14px; font-size:.88rem; color:var(--ink); text-decoration:none; }
.agent:hover { border-color:var(--accent); }
.agent .an { font-weight:700; }
.agent .ad, .agent .lic { color:var(--muted); font-size:.82rem; }
.agent .ph { margin-top:4px; }
.faq details { border-bottom:1px solid var(--line); padding:10px 0; }
.faq details:last-child { border-bottom:none; }
.faq summary { font-weight:600; cursor:pointer; }
.faq details p { margin:8px 0 2px; color:var(--muted); }
.linkrow { display:flex; flex-wrap:wrap; gap:8px 16px; font-size:.88rem; margin-top:8px; }
.notice { background:#fff8e8; border:1px solid #eeddb0; border-radius:8px; padding:10px 14px; font-size:.85rem; color:#6b5b1e; margin:14px 0; }
.src { font-size:.78rem; color:var(--muted); margin-top:10px; }
footer { border-top:1px solid var(--line); margin-top:40px; padding-top:18px; font-size:.82rem; color:var(--muted); }
.crumb { font-size:.85rem; margin-top:14px; }
"""

def status_badge(st):
    return {
        'legal': '<span class="badge">Commercial bail operates</span>',
        'impaired': '<span class="badge warn">Limited bail market</span>',
        'none': '<span class="badge off">No commercial bail</span>',
    }[st['status']]

def page(title, description, body, depth=0, jsonld=None, canonical_path='', leaflet=False, tail_script=''):
    robots = '' if INDEXABLE else '<meta name="robots" content="noindex, nofollow">\n'
    canonical = f'<link rel="canonical" href="{DOMAIN}{canonical_path}">\n' if INDEXABLE else ''
    ld = ''
    if jsonld:
        ld = ''.join(f'<script type="application/ld+json">{json.dumps(j, separators=(",", ":"))}</script>\n' for j in jsonld)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
{robots}{canonical}<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:type" content="website">
{ld}<style>{CSS}</style>
{f'<link rel="stylesheet" href="{BASE}/assets/leaflet/leaflet.css"><script src="{BASE}/assets/leaflet/leaflet.js"></script>' if leaflet else ''}
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brand" href="{BASE}/">Bail <span>Bonds</span> Directory</a>
  <span class="tagline">Bail &amp; jail release information for every U.S. county</span>
</div></header>
<div class="wrap">
{body}
<footer>
  <p>Informational resource only — not legal advice. Bail amounts and procedures vary by state,
  county, and case. Data sources: U.S. Census Bureau (2023 population estimates), state statutes,
  state insurance regulators and licensing boards, county bail bond boards and sheriff records.</p>
  <p>Agent listings come from official state and county license rosters — verify current license
  status with the licensing authority before doing business.</p>
  <p>Staging build — not yet published to its permanent domain.</p>
</footer>
</div>
{tail_script}
</body>
</html>"""

# ---------- Maps ----------

def map_block(center, zoom, markers, height=380):
    """markers: [{lat, lng, label(html), kind('agent'|'jail'|'office')}]"""
    return (f'<div class="card"><h2>Map</h2><div id="bbmap" style="height:{height}px;border-radius:8px;"></div>'
            f'<p class="src">Map data © OpenStreetMap contributors. Pins marked "approximate" are placed at the city center.</p></div>'), f"""
<script>
(function() {{
  if (typeof L === 'undefined') return;
  L.Icon.Default.imagePath = '{BASE}/assets/leaflet/images/';
  var m = L.map('bbmap', {{scrollWheelZoom: false}}).setView([{center[0]}, {center[1]}], {zoom});
  L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png',
    {{attribution: '© OpenStreetMap contributors', maxZoom: 19}}).addTo(m);
  var pts = {json.dumps(markers, separators=(',', ':'))};
  pts.forEach(function(p) {{
    var mk = L.marker([p.lat, p.lng]).addTo(m);
    if (p.label) mk.bindPopup(p.label);
  }});
  if (pts.length > 1) {{
    m.fitBounds(pts.map(function(p) {{ return [p.lat, p.lng]; }}), {{padding: [30, 30], maxZoom: 13}});
  }}
}})();
</script>"""

# ---------- FAQ (visible block + JSON-LD pairs) ----------

def county_faqs(c, st):
    display, name = c['display'], st['name']
    prem = st.get('premium') or '10%'
    jail = tx_jails.get(c['name']) if st['abbr'] == 'TX' else None
    faqs = []
    if st['status'] == 'none':
        faqs.append((f"Do I need a bail bondsman in {display}?",
            f"No — {name} does not permit commercial bail bondsmen. {st.get('note') or ''} "
            f"Release is handled through the court: recognizance, deposit bond paid directly to the court, or supervised release."))
        faqs.append((f"How do I get someone out of jail in {display}?",
            "Contact the court or pretrial services office handling the case. Where a deposit bond applies, "
            "it is paid directly to the court clerk and is largely refundable when the case concludes."))
    else:
        faqs.append((f"How much does a bail bond cost in {display}?",
            f"Bail bond premiums in {name} typically run {prem} of the total bail amount — the fee a licensed "
            f"bail agent charges to post the full bond. It is not refundable. On a $10,000 bond, expect roughly "
            f"${int(prem.split('-')[0].split('%')[0].replace('$','') or 10) * 100:,} or more depending on the rate."))
        faqs.append((f"How long does it take to get released from jail in {display}?",
            "Once a bond is posted, release typically takes 2–12 hours depending on the facility's booking volume. "
            "Bail must first be set by a judge or bail schedule, which usually happens within 24–48 hours of arrest."))
        faqs.append((f"What if I can't afford the bail bond premium?",
            "Many bail agents offer payment plans, and some accept collateral (property, vehicles) in place of full "
            "cash payment. Courts may also lower bail at a hearing — a defense attorney can request it."))
    if jail:
        q = f"How do I find out if someone is in jail in {display}?"
        a = f"Check the {jail['facility']} — {jail.get('address', '')}, {jail.get('city', '')}"
        if jail.get('phone'):
            a += f", phone {jail['phone']}"
        a += ". An online inmate search is available." if jail.get('inmate_search_url') else "."
        faqs.append((q, a))
    elif st['status'] != 'none':
        faqs.append((f"How do I find out if someone is in jail in {display}?",
            f"Contact the {display} sheriff's office or check its online inmate roster if one is published. "
            "You'll need the person's full legal name and, ideally, date of birth."))
    if st['abbr'] == 'TX':
        faqs.append(("What is an attorney bond in Texas?",
            "Under Texas Occupations Code §1704.163, a licensed Texas attorney can post bail for a client they "
            "represent in the criminal case — in any Texas county — without being a licensed bondsman. One retainer "
            "can cover both the jail release and the criminal defense."))
    return faqs

def faq_block(faqs):
    items = ''.join(
        f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faqs)
    return f'<div class="card faq"><h2>Frequently Asked Questions</h2>{items}</div>'

def faq_jsonld(faqs):
    return {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{
            "@type": "Question", "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": a},
        } for q, a in faqs],
    }

def breadcrumb_jsonld(items):
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{
            "@type": "ListItem", "position": i + 1, "name": n,
            **({"item": DOMAIN + u} if u else {}),
        } for i, (n, u) in enumerate(items)],
    }

# ---------- Shared content blocks ----------

def how_bail_works(st):
    if st['abbr'] == 'TX':
        return """
<div class="card">
  <h2>How Bail Works in Texas</h2>
  <p>After an arrest in Texas, a magistrate must set bail promptly — the law requires a magistrate
  hearing within 48 hours of arrest (Tex. Code Crim. Proc. art. 15.17). Once bail is set, there are
  four ways to secure release:</p>
  <ul>
    <li><strong>Surety bond</strong> — a licensed bail bond company posts the full bond for a
    non-refundable premium, typically 10&ndash;15% of the bail amount.</li>
    <li><strong>Cash bond</strong> — the full bail amount is paid directly to the county,
    refundable when the case concludes and all appearances are made.</li>
    <li><strong>Personal recognizance (PR) bond</strong> — release without payment, at the
    court's discretion. Texas law (SB 6, 2021; SB 9, 2025) restricts PR bonds for many offenses.</li>
    <li><strong>Attorney bond</strong> — under Tex. Occ. Code &sect;1704.163, a licensed Texas
    attorney may post bail for a client they represent in the criminal case, in any Texas county.
    One retainer can cover both the release and the defense.</li>
  </ul>
</div>"""
    if st['status'] == 'none':
        note = f"<p><strong>{esc(st['note'])}</strong></p>" if st.get('note') else ''
        return f"""
<div class="card">
  <h2>How Release Works in {st['name']}</h2>
  {note}
  <p>{st['name']} does not permit commercial bail bondsmen. Release from custody after an arrest
  typically happens one of these ways:</p>
  <ul>
    <li><strong>Release on recognizance</strong> — a written promise to appear, no payment required.</li>
    <li><strong>Deposit or cash bond to the court</strong> — where money bond exists, it is paid
    directly to the court (often a 10% deposit), and is refundable at case disposition.</li>
    <li><strong>Supervised or conditional release</strong> — pretrial services supervision,
    check-ins, or other non-monetary conditions.</li>
  </ul>
  <p class="sub">Because no bail bond companies operate here, be wary of anyone offering paid
  bail services in {st['name']}.</p>
</div>"""
    reg = f"<li><strong>Licensing:</strong> bail agents are regulated by the {esc(st['regulator'])}.</li>" if st.get('regulator') else ''
    prem = st.get('premium') or '10%'
    note = f"<p><strong>{esc(st['note'])}</strong></p>" if st.get('note') else ''
    return f"""
<div class="card">
  <h2>How Bail Works in {st['name']}</h2>
  {note}
  <p>After bail is set by a judge or bail schedule, there are three common ways to secure release:</p>
  <ul>
    <li><strong>Surety bond</strong> — a licensed bail bond agent posts the full bond for a
    non-refundable premium, typically {esc(prem)} of the bail amount.</li>
    <li><strong>Cash bond</strong> — the full bail amount paid directly to the court, refundable
    when the case concludes and all appearances are made.</li>
    <li><strong>Release on recognizance</strong> — release without payment at the court's
    discretion, sometimes with pretrial supervision.</li>
    {reg}
  </ul>
</div>"""

def agent_cards(agent_list, limit=None, more_href=None):
    shown = agent_list[:limit] if limit else agent_list
    cards = []
    for a in shown:
        url = f"{BASE}/{a['state'].lower()}/agent/{a['slug']}/"
        addr = ', '.join(filter(None, [a.get('address'), a.get('city'), a.get('zip')]))
        lic = f"<div class='lic'>License: {esc(a['license'])}</div>" if a.get('license') else ''
        agency = f"<div class='ad'>{esc(display_name(a['agency']))}</div>" if a.get('agency') and a.get('agency') != a.get('name') else ''
        cards.append(f"""<a class="agent" href="{url}">
  <div class="an">{esc(display_name(a['name']))}</div>{agency}
  <div class="ad">{esc(addr)}</div>
  {f"<div class='ph'>☎ {esc(a['phone'])}</div>" if a.get('phone') else ''}
  {f"<div class='ad'>✉ {esc(a['email'])}</div>" if a.get('email') else ''}
  {lic}
</a>""")
    more = (f"<p class='sub'><a href='{more_href}'>View all {len(agent_list)} licensed agents →</a></p>"
            if limit and len(agent_list) > limit and more_href else
            (f"<p class='sub'>+ {len(agent_list) - len(shown)} more licensed agents on record.</p>" if limit and len(agent_list) > limit else ''))
    srcs = sorted({a.get('source_url') for a in shown if a.get('source_url')})
    src_note = f"<p class='src'>Source: official license roster{'s' if len(srcs) > 1 else ''} — " + \
               ' · '.join(f"<a href='{s}' rel='nofollow'>{s.split('/')[2]}</a>" for s in srcs[:3]) + '</p>' if srcs else ''
    return f'<div class="agent-list">{"".join(cards)}</div>{more}{src_note}'

def tx_board_links(county_name):
    b = tx_boards.get(county_name)
    if not b:
        return ''
    links = []
    if b.get('board_url'):
        links.append(f'<a href="{b["board_url"]}" rel="nofollow">{county_name} County Bail Bond Board</a>')
    if b.get('roster_url'):
        links.append(f'<a href="{b["roster_url"]}" rel="nofollow">Licensed bondsmen roster</a>')
    return f'<p>Official resources: {" · ".join(links)}</p>' if links else ''

def related_links(c, st, st_counties):
    """Internal-link mesh: top-population counties in state + alphabetical neighbors."""
    others = [x for x in st_counties if x['slug'] != c['slug']]
    top = sorted(others, key=lambda x: -x['population'])[:5]
    idx = next(i for i, x in enumerate(st_counties) if x['slug'] == c['slug'])
    neighbors = [st_counties[i] for i in (idx - 1, idx + 1) if 0 <= i < len(st_counties) and st_counties[i]['slug'] != c['slug']]
    seen, links = {c['slug']}, []
    sb = f"{BASE}/{st['abbr'].lower()}"
    for x in top + neighbors:
        if x['slug'] not in seen:
            seen.add(x['slug'])
            links.append(f'<a href="{sb}/{x["slug"]}/">{esc(x["display"])}</a>')
    return f"""
<div class="card">
  <h2>Bail Bonds Elsewhere in {st['name']}</h2>
  <div class="linkrow">{''.join(links)} <a href="{sb}/">All {st['name']} counties →</a></div>
</div>"""

# ---------- Pages ----------

def county_page(c, st, st_counties):
    display = c['display']
    short = c['name']
    is_tx = st['abbr'] == 'TX'

    if is_tx:
        if c.get('has_bail_board'):
            reg_badge = '<span class="badge">County Bail Bond Board</span>'
            reg_text = (f"{display} has a bail bond board under Texas Occupations Code Chapter 1704 — "
                        "bail bond companies must hold a license issued by the county board, which "
                        "publishes the roster of approved sureties.")
        else:
            reg_badge = '<span class="badge" style="background:#eef1f5;color:var(--muted)">Sheriff-regulated county</span>'
            reg_text = (f"{display} does not operate a bail bond board (required only above 110,000 "
                        "population). Bondsmen here operate with the approval of the county sheriff.")
        reg_card = f"""
<div class="card">
  <h2>Bail Bond Licensing in {display}</h2>
  <p>{reg_text}</p>
  {tx_board_links(short)}
</div>"""
    elif st['status'] == 'none':
        reg_badge = status_badge(st)
        reg_card = ''
    else:
        reg_badge = status_badge(st)
        reg_card = (f"""
<div class="card">
  <h2>Bail Bond Licensing</h2>
  <p>Bail bond agents serving {display} are licensed statewide by the {esc(st['regulator'])}.</p>
</div>""" if st.get('regulator') else '')

    jail_card = ''
    if is_tx:
        jail = tx_jails.get(short)
        if jail and jail.get('facility'):
            rows = ''.join(f"<li><strong>{k}:</strong> {esc(v)}</li>" for k, v in [
                ('Facility', jail.get('facility')),
                ('Address', ', '.join(filter(None, [jail.get('address'), jail.get('city'), jail.get('zip')]))),
                ('Phone', jail.get('phone')),
            ] if v)
            link = (f'<p><a href="{jail["inmate_search_url"]}" rel="nofollow">Inmate search / jail roster</a></p>'
                    if jail.get('inmate_search_url') else '')
            jail_card = f'<div class="card"><h2>{display} Jail</h2><ul>{rows}</ul>{link}</div>'

    attorney_card = f"""
<div class="card">
  <h2>Attorney Bonds — An Alternative to a Bondsman</h2>
  <p>Texas is one of the few states where a licensed attorney can post bail directly for a client
  they represent (Tex. Occ. Code &sect;1704.163) — in {display} and every other Texas county.
  Instead of paying a bondsman a non-refundable 10&ndash;15% premium <em>and</em> separately hiring
  a defense lawyer, one call can handle both the jail release and the defense.</p>
  <p class="notice">Featured attorney-bond placement — reserved.</p>
</div>""" if is_tx else ''

    agents_card = ''
    if st['status'] in ('legal', 'impaired'):
        county_agents = agents_by_county.get((st['abbr'], norm_county(short)), [])
        if county_agents:
            agents_card = f"""
<div class="card">
  <h2>Licensed Bail Agents in {display}</h2>
  <p class="sub">{len(county_agents)} licensed bail bond compan{'ies' if len(county_agents) != 1 else 'y'} on the official roster.</p>
  <p class="notice">Featured placement — reserved.</p>
  {agent_cards(county_agents)}
</div>"""
        else:
            agents_card = f"""
<div class="card">
  <h2>Licensed Bail Agents in {display}</h2>
  <p class="sub">County-level roster integration in progress — see
  <a href="{BASE}/{st['abbr'].lower()}/agents/">all licensed agents in {st['name']}</a>.</p>
  <p class="notice">Featured placement — reserved.</p>
</div>"""

    # Map: county centroid center; exact agent pins; city-grouped approximate pins; jail pin
    map_html, map_js = '', ''
    center = county_centroids.get(c['fips'])
    if center:
        markers = []
        county_agents_all = agents_by_county.get((st['abbr'], norm_county(short)), [])
        city_groups = {}
        for a in county_agents_all:
            coords, kind = agent_coords(a)
            if not coords:
                continue
            label = (f"<strong><a href='{BASE}/{a['state'].lower()}/agent/{a['slug']}/'>{esc(display_name(a['name']))}</a></strong>"
                     + (f"<br>☎ {esc(a['phone'])}" if a.get('phone') else ''))
            if kind == 'exact':
                markers.append({'lat': coords[0], 'lng': coords[1], 'label': label})
            else:
                city_groups.setdefault((coords[0], coords[1], a.get('city')), []).append(label)
        for (la, ln, cityname), labels in city_groups.items():
            head = f"<strong>{len(labels)} agent{'s' if len(labels) != 1 else ''} in {esc(cityname)}</strong> <em>(approximate)</em><br>"
            markers.append({'lat': la, 'lng': ln, 'label': head + '<br>'.join(labels[:8])})
        if is_tx and jail_coords.get(short):
            jc = jail_coords[short]
            jl = tx_jails.get(short, {})
            markers.append({'lat': jc[0], 'lng': jc[1],
                            'label': f"<strong>{esc(jl.get('facility', short + ' County Jail'))}</strong><br>County jail"})
        map_html, map_js = map_block(center, 9, markers)

    faqs = county_faqs(c, st)
    crumb_ld = breadcrumb_jsonld([
        ('All states', '/index.html'), (st['name'], f'/{st["abbr"].lower()}/index.html'),
        (display, f'/{st["abbr"].lower()}/{c["slug"]}/index.html'),
    ])

    body = f"""
<div class="crumb"><a href="{BASE}/">All states</a> › <a href="{BASE}/{st['abbr'].lower()}/">{st['name']}</a> › {display}</div>
<h1>Bail Bonds in {display}, {st['name']}</h1>
<p class="sub">Jail release information, the bail process, and licensed bail agents for {display}.</p>
<div class="facts">
  <div class="fact"><div class="k">Population (2023)</div><div class="v">{c['population']:,}</div></div>
  <div class="fact"><div class="k">Bail Framework</div><div class="v small">{reg_badge}</div></div>
  <div class="fact"><div class="k">Typical Premium</div><div class="v small">{esc(st.get('premium') or ('—' if st['status'] == 'none' else '10%'))}</div></div>
</div>
{map_html}
{reg_card}
{jail_card}
{how_bail_works(st)}
{attorney_card}
{agents_card}
{faq_block(faqs)}
{related_links(c, st, st_counties)}
"""
    title_kw = 'Bail Bonds' if st['status'] != 'none' else 'Jail Release'
    desc = (f"{title_kw} in {display}, {st['name']}: how bail works, "
            f"{'typical premium ' + (st.get('premium') or '10%') + ', ' if st['status'] != 'none' else 'court release process, '}"
            f"jail information, and licensed bail agents from official rosters.")
    return page(
        f"{title_kw} in {display}, {st['abbr']} — Cost, Process & Licensed Agents",
        desc, body, depth=2,
        jsonld=[crumb_ld, faq_jsonld(faqs)],
        canonical_path=f'/{st["abbr"].lower()}/{c["slug"]}/',
        leaflet=bool(map_html), tail_script=map_js,
    )

def state_page(st, st_counties):
    tiles = ''.join(
        f'<a href="{BASE}/{st["abbr"].lower()}/{c["slug"]}/">{esc(c["display"])}'
        f'<div class="pop">{c["population"]:,} residents</div></a>'
        for c in st_counties)
    n = len(st_counties)
    unit = {'LA': 'parishes', 'AK': 'boroughs & census areas'}.get(st['abbr'], 'counties')
    st_agents = agents_by_state.get(st['abbr'], [])
    agents_card = ''
    if st_agents and st['status'] in ('legal', 'impaired'):
        agents_url = f"{BASE}/{st['abbr'].lower()}/agents/"
        agents_card = f"""
<div class="card">
  <h2>Licensed Bail Agents in {st['name']}</h2>
  <p class="sub">{len(st_agents)} licensed agents/agencies on official rosters —
  <a href="{agents_url}">view the complete {st['name']} roster</a>.</p>
  {agent_cards(sorted(st_agents, key=lambda a: (a.get('city') or '', a['name'])), limit=24, more_href=agents_url)}
</div>"""
    facts = f"""
<div class="facts">
  <div class="fact"><div class="k">Counties</div><div class="v">{n}</div></div>
  <div class="fact"><div class="k">Framework</div><div class="v small">{status_badge(st)}</div></div>
  <div class="fact"><div class="k">Typical Premium</div><div class="v small">{esc(st.get('premium') or '—')}</div></div>
  <div class="fact"><div class="k">Regulator</div><div class="v small">{esc(st.get('regulator') or 'Court system')}</div></div>
</div>"""
    body = f"""
<div class="crumb"><a href="{BASE}/">All states</a> › {st['name']}</div>
<h1>Bail Bonds in {st['name']}</h1>
{facts}
{how_bail_works(st)}
{agents_card}
<h2>All {st['name']} {unit.title()}</h2>
<div class="county-grid">{tiles}</div>
"""
    desc = (f"How bail works in {st['name']}: {st.get('premium') or 'court-set'} premiums, "
            f"licensing by {st.get('regulator') or 'the courts'}, and bail information for all {n} {unit}."
            if st['status'] != 'none' else
            f"{st['name']} has no commercial bail — how court release works, plus jail information for all {n} {unit}.")
    return page(f"Bail Bonds in {st['name']} — Laws, Costs & Every County", desc, body, depth=1,
                jsonld=[breadcrumb_jsonld([('All states', '/index.html'), (st['name'], f'/{st["abbr"].lower()}/index.html')])],
                canonical_path=f'/{st["abbr"].lower()}/')

def national_index(by_state):
    legal_n = sum(1 for s in states.values() if s['status'] == 'legal')
    total_agents = sum(len(v) for v in agents_by_state.values())
    agents_line = f" Includes {total_agents:,} licensed bail agents from official state and county rosters." if total_agents else ''
    tiles = ''.join(
        f'<a href="{BASE}/{s["abbr"].lower()}/">{s["name"]}'
        f'<div class="pop">{len(by_state.get(s["abbr"], []))} counties · '
        f'{ {"legal": "commercial bail", "impaired": "limited market", "none": "no commercial bail"}[s["status"]] }</div></a>'
        for s in sorted(states.values(), key=lambda x: x['name']))
    body = f"""
<h1>Bail Bonds in Every U.S. County</h1>
<p class="sub">Bail process, costs, jail information, and licensed bail agents for all 3,100+ U.S.
counties. Commercial bail operates in {legal_n} states; the rest use court-deposit or recognizance
systems — each state page explains exactly how release works there.{agents_line}</p>
<h2>Choose a State</h2>
<div class="county-grid">{tiles}</div>
"""
    return page("Bail Bonds Directory — Costs, Laws & Licensed Agents in Every U.S. County",
                "How bail works in every U.S. state and county: premiums, licensing, jail lookups, "
                "and licensed bail agents from official rosters.", body, depth=0,
                canonical_path='/')

def state_agents_page(st, st_agents):
    sb = f"{BASE}/{st['abbr'].lower()}"
    groups = {}
    for a in st_agents:
        groups.setdefault(a.get('county') or 'Statewide / county not specified', []).append(a)
    sections = []
    for county in sorted(groups, key=lambda c: (c.startswith('Statewide'), c)):
        rows = sorted(groups[county], key=lambda a: str(a['name']))
        sections.append(f"<h2 id=\"{norm_county(county).replace(' ', '-')}\">{esc(county)} ({len(rows)})</h2>" + agent_cards(rows))
    body = f"""
<div class="crumb"><a href="{BASE}/">All states</a> › <a href="{sb}/">{st['name']}</a> › All licensed agents</div>
<h1>Every Licensed Bail Agent in {st['name']}</h1>
<p class="sub">{len(st_agents)} licensed bail agents and agencies from official state and county
rosters, grouped by county. Click any listing for the full profile.</p>
<div class="card" style="position:sticky;top:0;z-index:5;">
  <input type="search" id="agent-filter" placeholder="Search {len(st_agents)} agents by name, agency, or city…"
    style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:.95rem;">
</div>
{''.join(sections)}
"""
    search_js = """
<script>
(function() {
  var input = document.getElementById('agent-filter');
  if (!input) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.agent'));
  var heads = Array.prototype.slice.call(document.querySelectorAll('h2[id]'));
  input.addEventListener('input', function() {
    var q = input.value.toLowerCase().trim();
    cards.forEach(function(c) {
      c.style.display = (!q || c.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
    });
    heads.forEach(function(h) {
      var el = h.nextElementSibling, any = false;
      while (el && el.tagName !== 'H2') {
        Array.prototype.forEach.call(el.querySelectorAll ? el.querySelectorAll('.agent') : [], function(c) {
          if (c.style.display !== 'none') any = true;
        });
        el = el.nextElementSibling;
      }
      h.style.display = (!q || any) ? '' : 'none';
    });
  });
})();
</script>"""
    return page(f"All {len(st_agents)} Licensed Bail Agents in {st['name']} — Complete Roster",
                f"The complete roster of {len(st_agents)} licensed bail bond agents in {st['name']}, "
                f"from official license records, grouped by county.", body, depth=1,
                jsonld=[breadcrumb_jsonld([('All states', '/'), (st['name'], f"/{st['abbr'].lower()}/"),
                                          ('All licensed agents', f"/{st['abbr'].lower()}/agents/")])],
                canonical_path=f"/{st['abbr'].lower()}/agents/", tail_script=search_js)

def agent_page(a, st):
    sb = f"{BASE}/{st['abbr'].lower()}"
    name = display_name(a['name'])
    agency = display_name(a.get('agency')) if a.get('agency') and a.get('agency') != a.get('name') else None
    county = a.get('county')
    county_row = None
    if county:
        target = norm_county(county)
        county_row = next((c for c in counties if c['state'] == st['abbr'] and norm_county(c['name']) == target), None)
    county_link = (f'<a href="{sb}/{county_row["slug"]}/">{esc(county_row["display"])}, {st["abbr"]}</a>'
                   if county_row else (esc(county) if county else f"{st['name']} (statewide)"))
    addr = ', '.join(filter(None, [a.get('address'), a.get('city'), a.get('zip')]))
    src = a.get('source_url') or ''
    src_host = src.split('/')[2] if src.startswith('http') else src
    lic_disp = esc(a.get('license'))
    if a.get('expiration'):
        lic_disp = f"{lic_disp} (expires {esc(a['expiration'])})" if lic_disp else f"expires {esc(a['expiration'])}"
    phone_html = (f'<a href="tel:{esc(str(a["phone"]).strip())}">{esc(a["phone"])}</a>'
                  if a.get('phone') else None)
    email_html = (f'<a href="mailto:{esc(a["email"])}">{esc(a["email"])}</a>'
                  if a.get('email') else None)
    facts = ''.join(f'<li><strong>{k}:</strong> {v}</li>' for k, v in [
        ('Agency', esc(agency) if agency else None),
        ('Address', esc(addr) if addr else None),
        ('Phone', phone_html),
        ('Email', email_html),
        ('License', lic_disp),
        ('Surety', esc(a.get('surety'))),
        ('Serves', county_link),
    ] if v)
    coords, coord_kind = agent_coords(a)
    map_html, map_js = '', ''
    if coords:
        approx = ' <em>(approximate — city center)</em>' if coord_kind == 'city' else ''
        map_html, map_js = map_block(coords, 13, [{'lat': coords[0], 'lng': coords[1],
            'label': f'<strong>{esc(name)}</strong>{approx}'}], height=300)
    ld = {
        '@context': 'https://schema.org', '@type': 'LocalBusiness',
        'name': name, 'url': f"{DOMAIN}/{st['abbr'].lower()}/agent/{a['slug']}/",
        'additionalType': 'https://en.wikipedia.org/wiki/Bail_bondsman',
    }
    if a.get('phone'): ld['telephone'] = a['phone']
    if addr: ld['address'] = {'@type': 'PostalAddress', 'streetAddress': a.get('address') or '',
                              'addressLocality': a.get('city') or '', 'postalCode': a.get('zip') or '',
                              'addressRegion': st['abbr']}
    body = f"""
<div class="crumb"><a href="{BASE}/">All states</a> › <a href="{sb}/">{st['name']}</a> › <a href="{sb}/agents/">Agents</a> › {esc(name)}</div>
<h1>{esc(name)}</h1>
<p class="sub">Licensed bail bond {'agency' if agency is None and a.get('agency') else 'agent'} in {st['name']} — from the official license roster.</p>
<div class="card">
  <h2>Contact & License</h2>
  <ul>{facts}</ul>
  <p class="src">Source: official roster — <a href="{src}" rel="nofollow">{esc(src_host)}</a>.
  License status can change; verify with the licensing authority before doing business.</p>
</div>
{map_html}
{how_bail_works(st)}
<div class="card">
  <h2>More in {st['name']}</h2>
  <div class="linkrow">
    <a href="{sb}/agents/">All licensed {st['name']} agents</a>
    {f'<a href="{sb}/{county_row["slug"]}/">Bail bonds in {esc(county_row["display"])}</a>' if county_row else ''}
    <a href="{sb}/">{st['name']} counties</a>
  </div>
</div>
"""
    if coords and coord_kind == 'exact':
        ld['geo'] = {'@type': 'GeoCoordinates', 'latitude': coords[0], 'longitude': coords[1]}
    loc = f" in {county_row['display']}" if county_row else f" in {st['name']}"
    return page(f"{name} — Licensed Bail Bond Agent{loc}",
                f"{name}: licensed bail bond agent{loc}. Contact details, license number, and "
                f"official-roster verification.", body, depth=3, jsonld=[ld],
                canonical_path=f"/{st['abbr'].lower()}/agent/{a['slug']}/",
                leaflet=bool(map_html), tail_script=map_js)

# ---------- Build ----------

by_state = {}
for c in counties:
    by_state.setdefault(c['state'], []).append(c)

for entry in os.listdir(ROOT):
    p = os.path.join(ROOT, entry)
    if os.path.isdir(p) and entry not in ('data', 'assets'):
        shutil.rmtree(p)

urls = ['/']
total = 0
for abbr, st_counties in by_state.items():
    st = states[abbr]
    st_counties.sort(key=lambda c: c['name'])
    sdir = os.path.join(ROOT, abbr.lower())
    os.makedirs(sdir, exist_ok=True)
    open(os.path.join(sdir, 'index.html'), 'w').write(state_page(st, st_counties))
    urls.append(f'/{abbr.lower()}/')
    st_agents = agents_by_state.get(abbr, [])
    if st_agents and st['status'] in ('legal', 'impaired'):
        adir = os.path.join(sdir, 'agents')
        os.makedirs(adir, exist_ok=True)
        open(os.path.join(adir, 'index.html'), 'w').write(state_agents_page(st, st_agents))
        urls.append(f'/{abbr.lower()}/agents/')
        for a in st_agents:
            pdir = os.path.join(sdir, 'agent', a['slug'])
            os.makedirs(pdir, exist_ok=True)
            open(os.path.join(pdir, 'index.html'), 'w').write(agent_page(a, st))
            urls.append(f'/{abbr.lower()}/agent/{a["slug"]}/')
    for c in st_counties:
        d = os.path.join(sdir, c['slug'])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'index.html'), 'w').write(county_page(c, st, st_counties))
        urls.append(f'/{abbr.lower()}/{c["slug"]}/')
        total += 1
open(os.path.join(ROOT, 'index.html'), 'w').write(national_index(by_state))

# sitemap (useful post-transfer; harmless in staging)
sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
sitemap += ''.join(f'  <url><loc>{DOMAIN}{u}</loc></url>\n' for u in urls)
sitemap += '</urlset>\n'
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write(sitemap)

n_county_rosters = len(agents_by_county)
print(f"built {total} county pages across {len(by_state)} states + national index + sitemap "
      f"({len(urls)} URLs) | agents: {sum(len(v) for v in agents_by_state.values())} across "
      f"{len(agents_by_state)} states ({n_county_rosters} county-level rosters) | "
      f"TX jails: {len(tx_jails)}, TX boards: {len(tx_boards)}")

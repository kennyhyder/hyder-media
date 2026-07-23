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

# ---- Licensed-agent rosters: data/agents/*.json → indexed by state / (state, county)
agents_by_state = {}
agents_by_county = {}
for path in sorted(glob.glob(os.path.join(DATA, 'agents', '*.json'))):
    for a in json.load(open(path)):
        st = a.get('state')
        if not st or not a.get('name'):
            continue
        agents_by_state.setdefault(st, []).append(a)
        if a.get('county'):
            agents_by_county.setdefault((st, a['county']), []).append(a)

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
.agent { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px 14px; font-size:.88rem; }
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

def page(title, description, body, depth=0, jsonld=None, canonical_path=''):
    root = '../' * depth
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
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brand" href="{root}index.html">Bail <span>Bonds</span> Directory</a>
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
</body>
</html>"""

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

def agent_cards(agent_list, limit=None):
    shown = agent_list[:limit] if limit else agent_list
    cards = []
    for a in shown:
        addr = ', '.join(filter(None, [a.get('address'), a.get('city'), a.get('zip')]))
        lic = f"<div class='lic'>License: {esc(a['license'])}</div>" if a.get('license') else ''
        agency = f"<div class='ad'>{esc(a['agency'])}</div>" if a.get('agency') and a.get('agency') != a.get('name') else ''
        cards.append(f"""<div class="agent">
  <div class="an">{esc(a['name'])}</div>{agency}
  <div class="ad">{esc(addr)}</div>
  {f"<div class='ph'>{esc(a['phone'])}</div>" if a.get('phone') else ''}
  {lic}
</div>""")
    more = f"<p class='sub'>+ {len(agent_list) - len(shown)} more licensed agents on record.</p>" if limit and len(agent_list) > limit else ''
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
    for x in top + neighbors:
        if x['slug'] not in seen:
            seen.add(x['slug'])
            links.append(f'<a href="../{x["slug"]}/index.html">{esc(x["display"])}</a>')
    return f"""
<div class="card">
  <h2>Bail Bonds Elsewhere in {st['name']}</h2>
  <div class="linkrow">{''.join(links)} <a href="../index.html">All {st['name']} counties →</a></div>
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
        county_agents = agents_by_county.get((st['abbr'], short), [])
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
  <p class="sub">County-level roster integration in progress — see the
  <a href="../index.html">{st['name']} state page</a> for statewide licensed agents.</p>
  <p class="notice">Featured placement — reserved.</p>
</div>"""

    faqs = county_faqs(c, st)
    crumb_ld = breadcrumb_jsonld([
        ('All states', '/index.html'), (st['name'], f'/{st["abbr"].lower()}/index.html'),
        (display, f'/{st["abbr"].lower()}/{c["slug"]}/index.html'),
    ])

    body = f"""
<div class="crumb"><a href="../../index.html">All states</a> › <a href="../index.html">{st['name']}</a> › {display}</div>
<h1>Bail Bonds in {display}, {st['name']}</h1>
<p class="sub">Jail release information, the bail process, and licensed bail agents for {display}.</p>
<div class="facts">
  <div class="fact"><div class="k">Population (2023)</div><div class="v">{c['population']:,}</div></div>
  <div class="fact"><div class="k">Bail Framework</div><div class="v small">{reg_badge}</div></div>
  <div class="fact"><div class="k">Typical Premium</div><div class="v small">{esc(st.get('premium') or ('—' if st['status'] == 'none' else '10%'))}</div></div>
</div>
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
    )

def state_page(st, st_counties):
    tiles = ''.join(
        f'<a href="{c["slug"]}/index.html">{esc(c["display"])}'
        f'<div class="pop">{c["population"]:,} residents</div></a>'
        for c in st_counties)
    n = len(st_counties)
    unit = {'LA': 'parishes', 'AK': 'boroughs & census areas'}.get(st['abbr'], 'counties')
    st_agents = agents_by_state.get(st['abbr'], [])
    agents_card = ''
    if st_agents and st['status'] in ('legal', 'impaired'):
        agents_card = f"""
<div class="card">
  <h2>Licensed Bail Agents in {st['name']}</h2>
  <p class="sub">{len(st_agents)} licensed agents/agencies on official rosters.</p>
  {agent_cards(sorted(st_agents, key=lambda a: (a.get('city') or '', a['name'])), limit=60)}
</div>"""
    facts = f"""
<div class="facts">
  <div class="fact"><div class="k">Counties</div><div class="v">{n}</div></div>
  <div class="fact"><div class="k">Framework</div><div class="v small">{status_badge(st)}</div></div>
  <div class="fact"><div class="k">Typical Premium</div><div class="v small">{esc(st.get('premium') or '—')}</div></div>
  <div class="fact"><div class="k">Regulator</div><div class="v small">{esc(st.get('regulator') or 'Court system')}</div></div>
</div>"""
    body = f"""
<div class="crumb"><a href="../index.html">All states</a> › {st['name']}</div>
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
        f'<a href="{s["abbr"].lower()}/index.html">{s["name"]}'
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

# ---------- Build ----------

by_state = {}
for c in counties:
    by_state.setdefault(c['state'], []).append(c)

for entry in os.listdir(ROOT):
    p = os.path.join(ROOT, entry)
    if os.path.isdir(p) and entry != 'data':
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

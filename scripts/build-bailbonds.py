#!/usr/bin/env python3
"""
National bail-bonds directory — static site generator (Track 2 staging build).

Structure:
  bailbonds/index.html                    — national index (51 states/DC)
  bailbonds/<state>/index.html            — state page (e.g. /bailbonds/tx/)
  bailbonds/<state>/<county>/index.html   — county page (~3,144 total)

Content is STATE-AWARE:
  - "legal"    — commercial bail operates: bond types, regulator, agents slot
  - "impaired" — legal but reform-restricted (NY, NM)
  - "none"     — no commercial bail (IL, KY, WI, OR, NE, MA, ME, NJ, DC):
                 pages describe court-deposit / PR release, no agents card
  - Texas keeps its richer template: county bail-bond boards, verified jail
    data, and the §1704.163 attorney-bond card (attorney bonds are TX law —
    never rendered for other states).

STAGING: every page carries noindex until the property moves to its permanent
domain. Neutral brand, fully self-contained pages, portable by design.

Run: python3 scripts/build-bailbonds.py   (reads bailbonds/data/*.json)
"""

import json
import os
import re
import shutil
import unicodedata

ROOT = os.path.join(os.path.dirname(__file__), '..', 'bailbonds')
DATA = os.path.join(ROOT, 'data')

counties = json.load(open(os.path.join(DATA, 'counties.json')))
states = {s['abbr']: s for s in json.load(open(os.path.join(DATA, 'states.json')))}

def load_keyed(fname):
    path = os.path.join(DATA, fname)
    if not os.path.exists(path):
        return {}
    return {j['county']: j for j in json.load(open(path))}

# Verified detail data — currently Texas-only; applied only when state == TX
tx_jails = load_keyed('jails.json')
tx_boards = load_keyed('boards.json')

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
p { margin-bottom:12px; }
.sub { color:var(--muted); }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:22px 24px; margin:16px 0; }
.facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin:16px 0; }
.fact { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.fact .k { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.fact .v { font-size:1.2rem; font-weight:700; margin-top:2px; }
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
.notice { background:#fff8e8; border:1px solid #eeddb0; border-radius:8px; padding:10px 14px; font-size:.85rem; color:#6b5b1e; margin:14px 0; }
footer { border-top:1px solid var(--line); margin-top:40px; padding-top:18px; font-size:.82rem; color:var(--muted); }
.crumb { font-size:.85rem; margin-top:14px; }
"""

def status_badge(st):
    return {
        'legal': '<span class="badge">Commercial bail operates</span>',
        'impaired': '<span class="badge warn">Limited bail market</span>',
        'none': '<span class="badge off">No commercial bail</span>',
    }[st['status']]

def page(title, body, depth=0):
    root = '../' * depth
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>{title}</title>
<style>{CSS}</style>
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
  county, and case. Data sources: U.S. Census Bureau (2023 population estimates), state statutes
  and insurance regulators, county records.</p>
  <p>Staging build — not yet published to its permanent domain.</p>
</footer>
</div>
</body>
</html>"""

# ---------- Shared content blocks ----------

def how_bail_works(st):
    """State-aware release-process card."""
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
        note = f"<p><strong>{st['note']}</strong></p>" if st.get('note') else ''
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
    # legal / impaired
    reg = f"<li><strong>Licensing:</strong> bail agents are regulated by the {st['regulator']}.</li>" if st.get('regulator') else ''
    prem = st.get('premium') or '10%'
    impaired_note = f"<p><strong>{st['note']}</strong></p>" if st.get('note') else ''
    return f"""
<div class="card">
  <h2>How Bail Works in {st['name']}</h2>
  {impaired_note}
  <p>After bail is set by a judge or bail schedule, there are three common ways to secure release:</p>
  <ul>
    <li><strong>Surety bond</strong> — a licensed bail bond agent posts the full bond for a
    non-refundable premium, typically {prem} of the bail amount.</li>
    <li><strong>Cash bond</strong> — the full bail amount paid directly to the court, refundable
    when the case concludes and all appearances are made.</li>
    <li><strong>Release on recognizance</strong> — release without payment at the court's
    discretion, sometimes with pretrial supervision.</li>
    {reg}
  </ul>
</div>"""

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

# ---------- Pages ----------

def county_page(c, st):
    display = c['display']           # e.g. "Harris County", "Orleans Parish", "Richmond city"
    short = c['name']                # e.g. "Harris", "Orleans Parish"
    is_tx = st['abbr'] == 'TX'

    # Regulation card
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
  <p>Bail bond agents serving {display} are licensed statewide by the {st['regulator']}.</p>
</div>""" if st.get('regulator') else '')

    # Jail card (verified TX data only, for now)
    jail_card = ''
    if is_tx:
        jail = tx_jails.get(short)
        if jail and jail.get('facility'):
            rows = ''.join(f"<li><strong>{k}:</strong> {v}</li>" for k, v in [
                ('Facility', jail.get('facility')),
                ('Address', ', '.join(filter(None, [jail.get('address'), jail.get('city'), jail.get('zip')]))),
                ('Phone', jail.get('phone')),
            ] if v)
            link = (f'<p><a href="{jail["inmate_search_url"]}" rel="nofollow">Inmate search / jail roster</a></p>'
                    if jail.get('inmate_search_url') else '')
            jail_card = f'<div class="card"><h2>{display} Jail</h2><ul>{rows}</ul>{link}</div>'

    # Attorney-bond card — Texas law only
    attorney_card = f"""
<div class="card">
  <h2>Attorney Bonds — An Alternative to a Bondsman</h2>
  <p>Texas is one of the few states where a licensed attorney can post bail directly for a client
  they represent (Tex. Occ. Code &sect;1704.163) — in {display} and every other Texas county.
  Instead of paying a bondsman a non-refundable 10&ndash;15% premium <em>and</em> separately hiring
  a defense lawyer, one call can handle both the jail release and the defense.</p>
  <p class="notice">Featured attorney-bond placement — reserved.</p>
</div>""" if is_tx else ''

    # Agents card — only where commercial bail exists
    agents_card = f"""
<div class="card">
  <h2>Licensed Bail Agents in {display}</h2>
  <p class="sub">Agent directory launching soon.</p>
  <p class="notice">Featured placement — reserved.</p>
</div>""" if st['status'] in ('legal', 'impaired') else ''

    body = f"""
<div class="crumb"><a href="../../index.html">All states</a> › <a href="../index.html">{st['name']}</a> › {display}</div>
<h1>Bail Bonds in {display}, {st['name']}</h1>
<p class="sub">Jail release information and the bail process for {display}.</p>
<div class="facts">
  <div class="fact"><div class="k">Population (2023)</div><div class="v">{c['population']:,}</div></div>
  <div class="fact"><div class="k">Bail Framework</div><div class="v" style="font-size:.95rem;">{reg_badge}</div></div>
  <div class="fact"><div class="k">FIPS</div><div class="v">{c['fips']}</div></div>
</div>
{reg_card}
{jail_card}
{how_bail_works(st)}
{attorney_card}
{agents_card}
"""
    title_kw = 'Bail Bonds' if st['status'] != 'none' else 'Jail Release'
    return page(f"{title_kw} in {display}, {st['abbr']} — Bail & Jail Release Info", body, depth=2)

def state_page(st, st_counties):
    tiles = ''.join(
        f'<a href="{c["slug"]}/index.html">{c["display"]}'
        f'<div class="pop">{c["population"]:,} residents</div></a>'
        for c in st_counties)
    n = len(st_counties)
    unit = {'LA': 'parishes', 'AK': 'boroughs & census areas'}.get(st['abbr'], 'counties')
    body = f"""
<div class="crumb"><a href="../index.html">All states</a> › {st['name']}</div>
<h1>Bail Bonds in {st['name']}</h1>
<p class="sub">{status_badge(st)} &nbsp; {n} {unit}</p>
{how_bail_works(st)}
<h2>All {st['name']} {unit.title()}</h2>
<div class="county-grid">{tiles}</div>
"""
    return page(f"Bail Bonds in {st['name']} — Every County", body, depth=1)

def national_index(by_state):
    legal_n = sum(1 for s in states.values() if s['status'] == 'legal')
    tiles = ''.join(
        f'<a href="{s["abbr"].lower()}/index.html">{s["name"]}'
        f'<div class="pop">{len(by_state.get(s["abbr"], []))} counties · '
        f'{ {"legal": "commercial bail", "impaired": "limited market", "none": "no commercial bail"}[s["status"]] }</div></a>'
        for s in sorted(states.values(), key=lambda x: x['name']))
    body = f"""
<h1>Bail Bonds in Every U.S. County</h1>
<p class="sub">Bail process, jail information, and licensed bail agents for all 3,100+ U.S. counties.
Commercial bail operates in {legal_n} states; the rest use court-deposit or recognizance systems —
each state page explains how release works there.</p>
<h2>Choose a State</h2>
<div class="county-grid">{tiles}</div>
"""
    return page("Bail Bonds Directory — Every County in America", body, depth=0)

# ---------- Build ----------

by_state = {}
for c in counties:
    by_state.setdefault(c['state'], []).append(c)

# wipe generated state dirs (keep data/)
for entry in os.listdir(ROOT):
    p = os.path.join(ROOT, entry)
    if os.path.isdir(p) and entry != 'data':
        shutil.rmtree(p)

total = 0
for abbr, st_counties in by_state.items():
    st = states[abbr]
    st_counties.sort(key=lambda c: c['name'])
    sdir = os.path.join(ROOT, abbr.lower())
    os.makedirs(sdir, exist_ok=True)
    open(os.path.join(sdir, 'index.html'), 'w').write(state_page(st, st_counties))
    for c in st_counties:
        d = os.path.join(sdir, c['slug'])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'index.html'), 'w').write(county_page(c, st))
        total += 1
open(os.path.join(ROOT, 'index.html'), 'w').write(national_index(by_state))
print(f"built {total} county pages across {len(by_state)} states + national index "
      f"(TX jail data: {len(tx_jails)}, TX boards: {len(tx_boards)})")

#!/usr/bin/env python3
"""
Texas bail-bonds directory — static site generator (Track 2 staging build).

Reads bailbonds/data/*.json and generates:
  bailbonds/index.html               — county index
  bailbonds/tx/<county-slug>/index.html  — one page per county (254)

STAGING: every page carries <meta name="robots" content="noindex, nofollow">
until the property moves to its permanent premium domain. The design is
deliberately neutral/unbranded and fully self-contained (inline CSS, no
external assets) so the whole tree can be lifted onto any domain unchanged.

Run: python3 scripts/build-bailbonds.py
"""

import json
import os
import shutil

ROOT = os.path.join(os.path.dirname(__file__), '..', 'bailbonds')
DATA = os.path.join(ROOT, 'data')

counties = json.load(open(os.path.join(DATA, 'counties.json')))
jails = {}
jails_path = os.path.join(DATA, 'jails.json')
if os.path.exists(jails_path):
    for j in json.load(open(jails_path)):
        jails[j['county']] = j

boards = {}
boards_path = os.path.join(DATA, 'boards.json')
if os.path.exists(boards_path):
    for b in json.load(open(boards_path)):
        boards[b['county']] = b

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

HOW_BAIL_WORKS = """
<div class="card">
  <h2>How Bail Works in Texas</h2>
  <p>After an arrest in Texas, a magistrate must set bail promptly — the law requires a
  magistrate hearing within 48 hours (Tex. Code Crim. Proc. art. 15.17). Once bail is set,
  there are four ways to secure release:</p>
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
</div>
"""

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
  <a class="brand" href="{root}index.html">Texas <span>Bail Bonds</span> Directory</a>
  <span class="tagline">County-by-county bail &amp; jail release information</span>
</div></header>
<div class="wrap">
{body}
<footer>
  <p>Informational resource only — not legal advice. Bail amounts and procedures vary by county
  and case. Data sources: U.S. Census Bureau (2023 population estimates), Texas Occupations Code
  Ch. 1704, county bail bond boards.</p>
  <p>Staging build — not yet published to its permanent domain.</p>
</footer>
</div>
</body>
</html>"""

def board_links(c):
    b = boards.get(c['name'])
    if not b:
        return ''
    links = []
    if b.get('board_url'):
        links.append(f'<a href="{b["board_url"]}" rel="nofollow">{c["name"]} County Bail Bond Board</a>')
    if b.get('roster_url'):
        links.append(f'<a href="{b["roster_url"]}" rel="nofollow">Licensed bondsmen roster</a>')
    return f'<p>Official resources: {" · ".join(links)}</p>' if links else ''

def county_page(c):
    jail = jails.get(c['name'])
    board_badge = ('<span class="badge">County Bail Bond Board</span>' if c['has_bail_board']
                   else '<span class="badge" style="background:#eef1f5;color:var(--muted)">Sheriff-regulated county</span>')
    board_text = (
        f"{c['name']} County has a bail bond board under Texas Occupations Code Chapter 1704 — "
        "bail bond companies must hold a license issued by the county board, which publishes the "
        "roster of approved sureties."
        if c['has_bail_board'] else
        f"{c['name']} County does not operate a bail bond board (required only above 110,000 "
        "population). Bondsmen here operate with the approval of the county sheriff."
    )
    jail_block = ''
    if jail and jail.get('facility'):
        rows = ''.join(f"<li><strong>{k}:</strong> {v}</li>" for k, v in [
            ('Facility', jail.get('facility')),
            ('Address', ', '.join(filter(None, [jail.get('address'), jail.get('city'), jail.get('zip')]))),
            ('Phone', jail.get('phone')),
        ] if v)
        link = (f'<p><a href="{jail["inmate_search_url"]}" rel="nofollow">Inmate search / jail roster</a></p>'
                if jail.get('inmate_search_url') else '')
        jail_block = f'<div class="card"><h2>{c["name"]} County Jail</h2><ul>{rows}</ul>{link}</div>'

    body = f"""
<div class="crumb"><a href="../../index.html">All Texas counties</a> › {c['name']} County</div>
<h1>Bail Bonds in {c['name']} County, Texas</h1>
<p class="sub">Jail release information, bail process, and licensed bail agents for {c['name']} County.</p>
<div class="facts">
  <div class="fact"><div class="k">Population (2023)</div><div class="v">{c['population']:,}</div></div>
  <div class="fact"><div class="k">Regulation</div><div class="v" style="font-size:.95rem;">{board_badge}</div></div>
  <div class="fact"><div class="k">County FIPS</div><div class="v">{c['fips']}</div></div>
</div>
<div class="card">
  <h2>Bail Bond Licensing in {c['name']} County</h2>
  <p>{board_text}</p>
  {board_links(c)}
</div>
{jail_block}
{HOW_BAIL_WORKS}
<div class="card">
  <h2>Attorney Bonds — An Alternative to a Bondsman</h2>
  <p>Texas is one of the few states where a licensed attorney can post bail directly for a client
  they represent (Tex. Occ. Code &sect;1704.163) — in {c['name']} County and every other Texas
  county. Instead of paying a bondsman a non-refundable 10&ndash;15% premium <em>and</em> separately
  hiring a defense lawyer, one call can handle both the jail release and the defense.</p>
  <p class="notice">Featured attorney-bond placement — reserved.</p>
</div>
<div class="card">
  <h2>Licensed Bail Agents in {c['name']} County</h2>
  <p class="sub">Agent directory launching soon.</p>
</div>
"""
    return page(f"Bail Bonds in {c['name']} County, TX — Jail Release & Bail Agents", body, depth=2)

def index_page():
    biggest = sorted(counties, key=lambda x: -x['population'])[:12]
    tiles = ''.join(
        f'<a href="tx/{c["slug"]}/index.html">{c["name"]} County'
        f'<div class="pop">{c["population"]:,} residents</div></a>'
        for c in counties)
    body = f"""
<h1>Texas Bail Bonds — Every County</h1>
<p class="sub">Bail process, jail information, and licensed bail agents for all 254 Texas counties.
{sum(1 for c in counties if c['has_bail_board'])} counties operate bail bond boards; the rest are
sheriff-regulated.</p>
{HOW_BAIL_WORKS}
<h2>All 254 Counties</h2>
<div class="county-grid">{tiles}</div>
"""
    return page("Texas Bail Bonds Directory — All 254 Counties", body, depth=0)

# ---- build ----
tx_dir = os.path.join(ROOT, 'tx')
if os.path.exists(tx_dir):
    shutil.rmtree(tx_dir)
for c in counties:
    d = os.path.join(tx_dir, c['slug'])
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(county_page(c))
open(os.path.join(ROOT, 'index.html'), 'w').write(index_page())
print(f"built {len(counties)} county pages + index (jail data for {len(jails)} counties)")

#!/usr/bin/env python3
"""Build polished PDFs of the playbook (intro + full) using Python markdown + Chrome headless.

Why this pipeline:
- No LaTeX dependency (basictex is ~100MB; not worth it)
- No weasyprint dependency (requires Pango/GTK system libs)
- Pure python-markdown + Chrome handles every feature we need

Output:
  /tmp/playbook-intro-v1.pdf   ~5 pages, lead magnet
  /tmp/playbook-full-v1.pdf    ~40 pages, paid product

Run:
  python3 docs/playbook/publish/build-pdf.py
"""
import markdown
import subprocess
import os
import re
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent  # docs/playbook
OUT = Path("/tmp")
CSS_PATH = ROOT / "publish" / "playbook.css"
TODAY = datetime.date.today().strftime("%B %Y")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

with open(CSS_PATH) as f:
    CSS = f.read()


def md_to_html(md_path: Path, title: str, subtitle: str, byline: str) -> str:
    """Convert markdown to a standalone HTML page with playbook styling."""
    with open(md_path) as f:
        md_text = f.read()

    # Strip the H1 since we render our own cover page
    md_text = re.sub(r"^# .+?\n+", "", md_text, count=1, flags=re.MULTILINE)

    body = markdown.markdown(
        md_text,
        extensions=["fenced_code", "tables", "toc", "footnotes", "attr_list"],
        extension_configs={"toc": {"toc_depth": "2-3", "permalink": False}},
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
{CSS}

/* Cover page */
.cover {{
  page-break-after: always;
  height: 9in;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.5in 1in 1in;
}}
.cover__eyebrow {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10pt;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: var(--muted);
}}
.cover__title {{
  font-size: 44pt;
  line-height: 1.05;
  letter-spacing: -0.025em;
  font-weight: 800;
  color: var(--ink);
  margin: 0.5in 0;
}}
.cover__subtitle {{
  font-style: italic;
  font-size: 14pt;
  color: var(--muted);
  margin-bottom: 1in;
  max-width: 5in;
}}
.cover__byline {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10pt;
  color: var(--ink);
  letter-spacing: 1px;
}}
.cover__rule {{
  height: 6px;
  width: 80px;
  background: var(--emerald);
  margin: 1in 0;
}}
.cover__brand {{
  font-family: "JetBrains Mono", monospace;
  font-size: 9pt;
  letter-spacing: 3px;
  color: var(--muted);
  text-transform: uppercase;
}}
</style>
</head>
<body>
<div class="cover">
  <div>
    <div class="cover__eyebrow">HYDER MEDIA · PLAYBOOK</div>
    <div class="cover__rule"></div>
    <h1 class="cover__title">{title}</h1>
    <div class="cover__subtitle">{subtitle}</div>
  </div>
  <div>
    <div class="cover__byline">{byline}</div>
    <div class="cover__brand" style="margin-top: 8px;">{TODAY} · v1.0</div>
  </div>
</div>

{body}

<p style="margin-top:3em; padding-top:1em; border-top:1px solid #ddd; font-family:'JetBrains Mono',monospace; font-size:9pt; color:#666;">
Copyright © 2026 Kenny Hyder · Hyder Media · <a href="https://hyder.me">hyder.me</a><br>
This playbook is published by Hyder Media. Personal-use license within one organization. For distribution rights, email kenny@hyder.me.
</p>
</body>
</html>
"""


def html_to_pdf(html_path: Path, pdf_path: Path):
    """Use Chrome headless to render HTML to PDF."""
    print(f"  → printing {pdf_path.name}")
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer",
            "--virtual-time-budget=5000",
            f"file://{html_path.resolve()}",
        ],
        check=True,
        capture_output=True,
    )


def build_full():
    """Build the full $79-tier playbook PDF."""
    print("Building full playbook PDF...")
    html = md_to_html(
        ROOT / "00-playbook.md",
        title="The Modern AI-Discoverable<br>SaaS Launch Playbook",
        subtitle="Every optimization, defensive pattern, and launch tactic for shipping a SaaS that ranks across Google AI Overview, Perplexity, ChatGPT, and Claude.",
        byline="Kenny Hyder · Hyder Media",
    )
    html_tmp = OUT / "playbook-full.html"
    html_tmp.write_text(html)
    pdf = OUT / "playbook-full-v1.pdf"
    html_to_pdf(html_tmp, pdf)
    size_kb = pdf.stat().st_size // 1024
    print(f"  ✓ {pdf} ({size_kb} KB)")


def build_intro():
    """Build the free 5-page intro PDF from a curated subset of the playbook."""
    print("Building intro playbook PDF...")
    # Curate the intro from the full playbook
    with open(ROOT / "00-playbook.md") as f:
        full = f.read()

    # Sections to include in the intro:
    # - Foreword
    # - §1 The 5-layer model
    # - One excerpt from §8 (the three most-relatable patterns: 8.1, 8.3, 8.5)
    # - §11 Closing thoughts
    # - CTA to the full playbook
    def extract(start_marker, end_marker):
        m = re.search(f"({re.escape(start_marker)}.*?)(?={re.escape(end_marker)})", full, re.DOTALL)
        return m.group(1) if m else ""

    foreword = extract("## Foreword:", "## §0.")
    layer_model = extract("## §1. The 5-layer model", "## §2.")
    pattern_intro = (
        "## A taste of §8 — defensive patterns\n\n"
        "The full playbook has 12 named defensive patterns from real production bugs. Each one is organized by symptom so you can grep the playbook when something breaks in your codebase. Three of the most-painful:\n\n"
    )
    p_8_1 = extract("### 8.1 The Stripe newline bug", "### 8.2")
    p_8_3 = extract("### 8.3 The gtag race condition", "### 8.4")
    p_8_5 = extract("### 8.5 The slug collision 404", "### 8.6")
    closing = extract("## §11. Closing thoughts", "*Kenny Hyder")

    cta = """

---

## Get the full playbook

This is 5 pages of a 100+ page playbook. The full version covers:

- **§0 Pre-flight** — domain, DNS, GA4, Search Console, Bing WMT, SPF/DKIM/DMARC
- **Layers 1-5** — Wikidata, JSON-LD, OpenAPI, security headers, GA4 events, distribution
- **§8** — all 12 named defensive patterns (you've seen 3)
- **§9** — pre-launch + weekly + recovery checklists
- **Templates** — llms.txt, JSON-LD generator, reference CSP, journalist pitches
- **Claude skill** — apply the playbook to any project automatically
- **12 months of free updates**

Available at [hyder.me/playbook](https://hyder.me/playbook) for $79. 7-day refund.

If you'd rather have Kenny apply the playbook to your project directly, the done-for-you launch engagement is at [hyder.me/contact?topic=playbook-dfy](https://hyder.me/contact?topic=playbook-dfy).
"""

    md = "# The Modern AI-Discoverable SaaS Launch Playbook (Intro)\n\n" + foreword + layer_model + pattern_intro + p_8_1 + p_8_3 + p_8_5 + closing + cta

    tmp_md = OUT / "playbook-intro.md"
    tmp_md.write_text(md)

    html = md_to_html(
        tmp_md,
        title="The Modern AI-Discoverable<br>SaaS Launch Playbook<br><span style='font-size:0.5em; color:#666; letter-spacing:4px; font-family:monospace;'>(INTRO)</span>",
        subtitle="The condensed intro — five pages on the 5-layer model + three named defensive patterns. The full 100+ page playbook is at hyder.me/playbook.",
        byline="Kenny Hyder · Hyder Media",
    )
    html_tmp = OUT / "playbook-intro.html"
    html_tmp.write_text(html)
    pdf = OUT / "playbook-intro-v1.pdf"
    html_to_pdf(html_tmp, pdf)
    size_kb = pdf.stat().st_size // 1024
    print(f"  ✓ {pdf} ({size_kb} KB)")


if __name__ == "__main__":
    if not Path(CHROME).exists():
        print(f"ERROR: Chrome not found at {CHROME}")
        sys.exit(1)
    build_intro()
    build_full()
    print("\nDone. Open:")
    print("  open /tmp/playbook-intro-v1.pdf")
    print("  open /tmp/playbook-full-v1.pdf")

# PDF export recipe

Two paths — quick (pandoc) and polished (custom HTML → Chrome headless).

## Quick path: pandoc → PDF (5 min, looks utilitarian)

```bash
brew install pandoc basictex

cd docs/playbook

pandoc 00-playbook.md -o playbook.pdf \
  --pdf-engine=xelatex \
  --variable=geometry:margin=1in \
  --variable=fontsize:11pt \
  --variable=mainfont:"Charter" \
  --variable=monofont:"JetBrains Mono" \
  --variable=linkcolor:RoyalBlue \
  --variable=urlcolor:RoyalBlue \
  --variable=colorlinks:true \
  --toc \
  --toc-depth=2 \
  --metadata title="The Modern AI-Discoverable SaaS Launch Playbook" \
  --metadata author="Kenny Hyder · Hyder Media" \
  --metadata date="$(date '+%B %Y')"
```

Output: ~30-page PDF with clickable TOC. Adequate for distribution, not pretty.

## Polished path: HTML → headless Chrome (20 min, looks like a published whitepaper)

Render the markdown to a custom-styled HTML template, then use headless Chrome to print to PDF. This gives you full control over typography, branded headers/footers, and code-block styling.

```bash
# Convert MD to HTML with proper code-fence rendering
brew install pandoc
pandoc 00-playbook.md -o /tmp/playbook.html \
  --standalone \
  --css="$(pwd)/publish/playbook.css" \
  --highlight-style=tango \
  --toc --toc-depth=2 \
  --metadata title="The Modern AI-Discoverable SaaS Launch Playbook" \
  --metadata author="Kenny Hyder · Hyder Media"

# Then Chrome headless to print
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu \
  --print-to-pdf=/tmp/playbook.pdf \
  --print-to-pdf-no-header \
  --no-pdf-header-footer \
  --virtual-time-budget=5000 \
  "file:///tmp/playbook.html"

open /tmp/playbook.pdf
```

The custom CSS lives at `publish/playbook.css` — see that file for branded styling.

## What to do with the PDF

- **Gate it as a lead magnet** on hyder.me. "Get the playbook — drop your email." Pipes leads into your CRM. Tier this if it's drawing strong interest (free PDF / paid 1:1 consultation upsell).
- **Distribute on Gumroad** at $0 — Gumroad's free distribution doubles as discovery via their browse.
- **Submit to product / startup directories** that accept whitepapers: IndieHackers, Hacker Noon (republishing community), SaaSwithRevenue.
- **Email to your existing client list** as a "thanks for being a client; here's the playbook we used on the latest launch" gesture.

## Update cadence

Re-export the PDF every time the source `00-playbook.md` changes meaningfully (new section, new pattern, fix). Old PDFs in the wild don't auto-update, so version the filename (`playbook-v1.0.pdf`, `playbook-v1.1.pdf`).

If you change something that contradicts a previous version (e.g., a pattern recommendation reverses), add a changelog at the top of the playbook.

## Alternative: keep it markdown-first, skip PDF entirely

PDFs are a 2010 distribution format. If you publish on hyder.me with proper JSON-LD (see `publish/website.md`), the markdown source is what AI tools index. The PDF is for humans who want to print or pass around in Slack — important but secondary.

You can also publish the markdown to your GitHub docs repo (sportsbookish-docs) and link directly to the file. GitHub renders markdown beautifully and the URL is stable.

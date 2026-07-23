# PageWheel Launch Campaign — 2026-07-22

**Import file:** `pagewheel-campaign-import-2026-07-22.csv` (Google Ads Editor → Account → Import)
**Generator:** `build-pagewheel-campaign-2026-07-22.py` (edit + re-run to regenerate)
**Landing page:** https://experience.digistore24.com/pagewheel-ai-page-builder
**Account:** Digistore24 246-624-6400 · Campaign uploads **PAUSED** — enable to launch.

## Strategy summary

PageWheel is a $47/mo product with a 7-day free trial — a fundamentally lower-value
conversion than a DS24 vendor signup, with no established CVR/CAC/LTV benchmarks. So the
launch design is: **one campaign, Manual CPC, low-CPC keyword clusters only, $500/day
ceiling, paused-upload for review.** Expensive head terms (generic "website builder"
$4.40–$20.70 top-of-page, "email marketing" $10+, GoHighLevel alternatives $10.84+) are
deliberately excluded until we have conversion history.

### Why these clusters (from the 50K-keyword PageWheel research, Google KP data on 32.6K)

| Ad group | Max CPC | Median low top-of-page | Monthly volume (core terms) | Fit |
|---|---|---|---|---|
| Ebook Creator | $2.50 | $1.26–$2.58 | ~4,200 | LP sells AI-created ebooks/digital products — cheapest real-volume cluster |
| Digital Product Creator | $2.50 | ~$1.85 | ~100 (tiny but hyper-relevant) | Exact product promise |
| One Page Website | $3.00 | $3.01–$5.78 | ~3,400 | PageWheel = hosted one-page sites |
| Lead Magnet Pages | $3.50 | $3.40–$5.20, mostly LOW comp | ~600 | Creator audience, low competition |
| Sales Page & Funnel Builder | $4.00 | $3.66–$5.64 | ~4,600 | Core LP positioning |
| AI Page Builder | $4.00 | $4.12–$7.45 | ~2,400 | PageWheel's positioning sweet spot; bid below top-of-page, harvest cheap clicks |
| Landing Page Builder | $4.00 | $5.79–$8.42 | ~5,500 | Bid deliberately below low-TOP; accept lower positions; "free …" capped at $3.00 |

Weighted max CPC ≈ $3.30 → expected actual CPC ≈ $2.30–$2.80 (actuals typically run
60–80% of max on manual).

### The $500/day question

$500/day is right — and there is **no CPC×budget case for going higher at launch,
because budget is not the binding constraint; bid caps are.** Targeted clusters total
roughly 20–25K searches/mo; with phrase expansion and the account's ~7% CTR norm, that's
~100–160 clicks/day ≈ **$250–$400/day of actual spend at our bids**. The campaign will
likely underspend $500/day for the first 1–2 weeks. Raising the budget adds zero
learning; if we want more spend later, we raise bids or add clusters (that's the lever).
$500/day functions as a safety ceiling, not a target.

### Test economics (provisional — no established KPIs)

Research LTV model: blended ≈ **$384** (60/40 $27/$47 mix, 8–12 mo retention).
Break-even at 30% trial→paid: **trial CPA ≤ ~$115**. At $2.50 CPC that requires
≥ 2.2% click→trial. For reference, DS24's free vendor signup runs ~19% click→signup;
a $0-today trial should land well above 2.2%.

Provisional guardrails (proposed until real data exists):
- **Target:** blended trial CPA ≤ $75 (→ CAC ≈ $250 at 30% trial→paid, ~1.5× LTV:CAC)
- **Prune:** any ad group > $500 spend with 0 trials → pause/re-bid; any keyword > $150
  with 0 trials → bid down 30% or pause
- **Cadence:** search-terms review 2×/week for first 2 weeks; add negatives aggressively
- **Kill/re-scope check:** at $5K cumulative spend, if blended trial CPA > $150, restructure

## Structure

**Campaign:** `PageWheel | Nonbrand | AI Pages | US` — Search, Google search only (no
partners), US, en, Manual CPC, eCPC disabled, broad-match-keywords off, $500/day.
7 ad groups, 64 keywords (phrase-dominant + exact on head terms, matching account
convention), 1 RSA per ad group (15 headlines, H1 pinned pos-1, 4 descriptions,
paths `pagewheel/free-trial`), 51 campaign negatives, 6 campaign-level callouts +
1 structured snippet (campaign-level assets override the DS24 account-level callouts/
snippets, which are wrong for PageWheel — e.g. "Global Affiliate Network").

**Cross-campaign separation** (both products live in one account; only one ad per
account can serve per query): campaign negatives block DS24's active themes
(`sell digital products`, `sell ebooks`, `sell online courses`, `digistore`, etc.) so the
test data stays clean. Competitor tool brands (ClickFunnels, Leadpages, Kajabi, Kartra,
GoHighLevel, systeme.io…) are also negatived — they're reserved for a **phase-2**
`PageWheel | Competitors | US` campaign once trial CVR is known (their CPCs run $5–$11,
too rich for a blind test, but "ClickFunnels alternative at 1/6th the price" is the
single best angle this product has — queue it up after ~2–3 weeks of data).

## UTM map (matches account convention: suffix `utm_content={_adgroup}`)

All ads → `.../pagewheel-ai-page-builder?utm_source=google&utm_medium=cpc&utm_campaign=pagewheel`

| Ad group | utm_content |
|---|---|
| AI Page Builder | ai-page-builder |
| Sales Page & Funnel Builder | sales-page-funnels |
| Ebook Creator | ebook-creator |
| Landing Page Builder | landing-page-builder |
| Lead Magnet Pages | lead-magnet-pages |
| One Page Website | one-page-website |
| Digital Product Creator | digital-product-creator |

## Pre-launch checklist (things the CSV cannot do)

1. **Create a "PageWheel Trial Start" conversion action** (tag or GA4 import on the
   trial-signup confirmation) *before* enabling. Without it, nothing meaningful is
   measured and Google reporting attributes DS24 vendor-signup goals to this campaign.
2. **Campaign-level conversion-goal override** (UI only): set the PageWheel campaign to
   use ONLY the PageWheel trial goal; confirm DS24 campaigns don't pick up PageWheel
   conversions in their goals.
3. **Sitelinks:** account-level DS24 sitelinks (digistore24.com features/affiliate pages)
   will serve unless campaign-level PageWheel sitelinks are added in the UI. If PageWheel
   has distinct URLs (pricing/features/examples), add 4; otherwise accept the gap —
   callouts/snippet are already overridden in the CSV.
4. Confirm the LP passes UTM params through to signup for downstream trial→paid tracking.
5. After import preview, sanity-check the Editor didn't flag ad text or negative
   conflicts, then push, then enable the campaign.

## Data sources
- Account export: `Digistore24 Us++10_Campaigns+25_Ad groups+2026-07-22.csv`
- Live 90d performance (api/digistore/performance): non-brand US CPC $4.58–$7.36,
  CPA $24–$30 (Sell Online/Digital Products), BR $1.79 CPC
- Keyword research: `pagewheel-keywords-combined.json` (50K kws, 32,576 with Google KP data)
- Product/competitor research: `pagewheel-research.json` (2026-05-27)
- LP copy pulled live 2026-07-22

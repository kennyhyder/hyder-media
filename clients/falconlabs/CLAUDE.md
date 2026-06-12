# Falcon Labs Competitive Intelligence Suite

**Location:** `/clients/falconlabs/`
**URL:** https://hyder.me/clients/falconlabs
**Password:** THANKYOU (sessionStorage key: `falconlabs_ci_auth`)
**Client site:** https://falconlabs.com (Framer)
**Status:** Pre-sales research suite — built June 11, 2026 ahead of Kenny's meeting with Eugene Levin (President of Semrush, now running Falcon Labs; referred by Nick Eubanks, CMO of Digistore24).

## What Falcon Labs Is

Post-purchase monetization platform: AI-curated partner-brand offers on e-commerce
thank-you/order-confirmation pages. Pure rev-share model ($0.35–$0.45/transaction to
merchant, free install). Shopify app "Falcon Post Purchase Offers" (`apps.shopify.com/falcon-cross-sell`,
launched Sept 2025, 5.0★). Also integrates Wix. Co-founder: Or Shahar.
Young domain — **no SimilarWeb history**, so this suite was built from primary research
(Keyword Planner API + live site teardowns) instead of SimilarWeb exports.

## Competitor Set (6)

| Brand | Domain | Color | Weight class |
|-------|--------|-------|-------------|
| Rokt | rokt.com | #ec4899 | Enterprise category king (33K clients, 10B+ transactions/yr) |
| AfterSell | aftersell.com | #3b82f6 | Rokt's Shopify arm (40K brands) — most aggressive search marketer |
| Uptick | uptick.com | #22c55e | Closest direct comp (thank-you-page offer network, ~$0.35/order) |
| Disco | disconetwork.com | #f59e0b | DTC peer-brand cross-sell network (DiscoFeed), a16z-backed |
| Fluent / AdFlow | fluentco.com | #8b5cf6 | Public adtech (FLNT), Rebuy Ads partnership |
| MomentScience | momentscience.com | #14b8a6 | fka AdsPostX — perks/loyalty angle |

Adjacent (monitor, different model): ReConvert, Zipify OCU, Honeycomb, Carro, Paylode.

## Pages

| Page | File | Notes |
|------|------|-------|
| Password | `password.html` | Falcon wordmark hero card |
| Summary | `competitive-intel-summary.html` | Narrative + competitor table + strategic findings |
| Keyword Tool | `keyword-tool.html` | 514-kw table w/ KP volume/bids/competition, group cards, CSV export |
| Competitor Ads | `competitor-ads.html` | Profiles + Google Ads Transparency + Meta Ad Library links |
| Landing Pages | `landing-page-analysis.html` | Tabbed teardowns (exact H1/CTA/claims/proof) + category patterns |
| Projections | `projection-tool.html` | Merchant-acquisition calculator w/ rev-share compounding model |

## Branding (matches falconlabs.com)

- Coral accent `#fe6f50`, hover `#f94b25`, gold `#ffc800`, dark bg `#0a0915`
- Font: **Switzer** via Fontshare CDN
- Logo assets in `assets/`: `falcon-touch-icon.png` (nav, 180px F icon), `falcon-og.png`
  (wordmark, password page), `falcon-icon.png` (favicon) — pulled from framerusercontent CDN
- Layout/architecture cloned from the Digistore24/PageWheel CI suite pattern

## Data

- `data/keywords-combined.json` — 514 keywords: category, intent, brand_group XOR
  short_tail_group (DG24 mutual-exclusion convention), KP volume / low_bid / high_bid /
  competition. Generated June 2026.
- `data/keyword-seed.json` — 110 seed keywords by category (input)
- `data/kp-raw.json` — raw KP API responses (110 exact + 579 related ideas)
- Regenerate: re-run seeds through `POST https://hyder.me/api/google-ads/keywords`
  (batch 15, 1.5s delay, `exactOnly: false` to harvest related ideas)

## Keyword data caveats

- "uptick" (5,400/mo) is an ambiguous common word — don't take brand volume at face value
- "rokt" volume (12,100/mo) includes ETF/careers intent ("rokt etf" 880, "rokt glassdoor" 390)
- Projection tool conquest group already excludes the ambiguous portion

## Key strategic angles (for the pitch)

1. Category terms are LOW competition — giants sell outbound, SERP is open
2. Conquesting = volume play; AfterSell's /uptick-alternatives pages prove comparison demand
3. Every competitor hides pricing; Falcon's free/rev-share model can be said in ad copy
4. Falcon is self-serve (1-click Shopify install) vs demo-gated competitors — activation advantage
5. Two-sided: merchant side first (cheap, high-intent), advertiser side later (expensive CPCs)

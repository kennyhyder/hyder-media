# Vita Brevis Fine Art Client Project

**Location:** `/clients/vita-brevis/`
**URL:** https://hyder.me/clients/vita-brevis/
**Password:** VITABREVIS (sessionStorage key: `vita_brevis_dashboard_auth`)
**Client website:** https://www.vitabrevisfineart.com (Squarespace)

## Overview

Vita Brevis Fine Art is an online fine art gallery. Hyder Media does NOT manage their ad spend — this folder exists for two purposes:

1. **Reporting dashboard** (`reporting.html`) — read-only live performance dashboard pulling Google Ads + Meta Ads APIs so the client can see cross-platform results.
2. **Squarespace asset:** `instagram-reviews.html` — a self-contained HTML/CSS snippet that gets pasted into a Code Block on their `/rave-reviews` Squarespace page. Renders 12 IG-styled cards with screenshots, captions, handles, links to live posts.

## Ad Accounts

| Platform | Account | Notes |
|----------|---------|-------|
| Google Ads | 327-808-5194 (`3278085194`) | Direct access, NOT via MCC |
| Meta Ads | act_910982119354033 | One of three accounts |
| Meta Ads | act_1187662444921041 | Two of three |
| Meta Ads | act_1088960198165753 | Three of three |

Meta access is via the shared `meta_ads_connections` OAuth token under kenny@hyder.me's Business Portfolio. Kenny has direct access to all 3 accounts.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Redirect to password.html |
| `password.html` | Password gate (warm/gold styled, serif) |
| `reporting.html` | 6-tab live ads dashboard (Overview, Google Ads, Search Terms, Keywords, Meta Ads, Meta Creative) |
| `instagram-reviews.html` | Squarespace Code Block snippet — preview locally, copy snippet between START/END comments into a Code Block on /rave-reviews |

## Reporting Dashboard

### Tabs (hash-routed)
- `#overview` — Combined Google + Meta KPIs, stacked spend bar chart, channel doughnut
- `#google` — Google summary stats, campaigns table, RSA creative cards with per-asset performance
- `#search-terms` — Top search terms with sortable metrics
- `#keywords` — All active targeted keywords with QS, match type filter, search filter
- `#meta` — Meta combined KPIs, per-account breakdown cards, campaigns table (all 3 accounts merged)
- `#meta-creative` — Meta ad cards with image preview, copy, per-ad metrics. Account filter.

### Date Range
30d default (vs digistore24 which uses 7d) — gallery sales cycles tend to be longer. Options: 7d/30d/90d/6mo/12mo. Trend granularity auto-switches: daily ≤45d, monthly otherwise.

### Demo Data Fallback
Both Google + Meta have demo data generators. Badge shows: LIVE / PARTIAL / DEMO. If only one platform succeeds, the other shows demo data with PARTIAL badge.

## API Endpoints

All under `/api/vita-brevis/`. Vercel timeout: 30s (set in `vercel.json`).

| Endpoint | Purpose |
|----------|---------|
| `google-performance.js` | Google summary/campaign/daily/monthly breakdowns (`?breakdown=`) |
| `google-ads.js` | RSA creative + per-asset performance labels (BEST/GOOD/LEARNING/LOW) |
| `google-search-terms.js` | User queries that triggered Google ads, aggregated |
| `google-keywords.js` | All active targeted keywords with QS |
| `meta-performance.js` | Aggregates 3 Meta accounts. `?breakdown=summary` returns both `summary` (totals) and `byAccount` (per-account array). Also supports `campaign`, `daily`, `monthly`. |
| `meta-ads.js` | Active Meta ads across all 3 accounts with creative + per-ad metrics |

### Conventions
- Google endpoints inline OAuth refresh + GAQL search (matches digistore24 pattern — no shared helpers since Vercel functions deploy independently).
- Meta endpoints use shared `meta_ads_connections` OAuth row (one row, all 3 accounts under same token).
- All endpoints return `{ status, ... }` where status ∈ `success | partial | error | not_configured`.
- All accept `?days=N` (default 30 for Google, varies for Meta), `?breakdown=` where applicable.

## Instagram Reviews Snippet

Self-contained HTML in `instagram-reviews.html` between the `VITA BREVIS IG REVIEWS START` / `END` comments. Inside that block:
- Inline `<style>` scoped via `.vb-` prefix (no Squarespace CSS conflicts)
- A `<section>` with grid container
- A `<script>` with a `POSTS` array (12 entries) — edit this array to update posts

Each post has: `url` (live IG link), `image` (direct image URL or empty), `handle` (IG username without @), `quote` (caption excerpt). Cards have hover lift, square image, italic serif quote, gold accent handle.

To deploy: open `instagram-reviews.html` locally to preview → edit POSTS array → copy the START-to-END block → paste into a Squarespace Code Block on the `/rave-reviews` page.

## Design System

Warm/gold color palette matching the gallery brand:
- `--bg-primary: #1a1410` (deep warm dark)
- `--bg-secondary: #2a201a`
- `--accent: #c9a36a` (warm gold)
- `--text-primary: #f5ede0` (cream)
- Serif headings (Georgia), sans body
- Different from digistore24 (blue) and other clients

## Things to Know

- Client doesn't track conversions reliably — focus stats on Spend / Impressions / Clicks / CTR / Reach (Meta) instead of CPA / ROAS
- 3 Meta accounts is unusual — likely historical fragmentation. Dashboard shows per-account breakdown so client can see the split.
- They use Squarespace, not a custom site — any "deploy to vitabrevisfineart.com" requires manual paste in their editor.

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
| TikTok Ads | BC `7094682853576916994` | Single advertiser within the BC. Auth via shared `tiktok_ads_connections` row keyed by core_user_id. |

Meta access is via the shared `meta_ads_connections` OAuth token under kenny@hyder.me's Business Portfolio. Kenny has direct access to all 3 accounts.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Redirect to password.html |
| `password.html` | Password gate (warm/gold styled, serif) |
| `reporting.html` | 6-tab live ads dashboard (Overview, Google Ads, Search Terms, Keywords, Meta Ads, Meta Creative) |
| `instagram-reviews.html` | Squarespace Code Block snippet — preview locally, copy snippet between START/END comments into a Code Block on /rave-reviews |
| `seo-audit.md` | Standalone SEO/local-visibility audit (2026-04-30). Diagnoses why they don't appear in Map Pack and rank low for "colorado springs photography studio". Prioritized punch-list + drop-in `LocalBusiness` JSON-LD. Re-run when major changes ship. |

## Reporting Dashboard

### Tabs (hash-routed)
- `#overview` — Combined Google + Meta KPIs, stacked spend bar chart, channel doughnut
- `#google` — Google summary stats, campaigns table, RSA creative cards with per-asset performance
- `#search-terms` — Top search terms with sortable metrics
- `#keywords` — All active targeted keywords with QS, match type filter, search filter
- `#meta` — Meta combined KPIs, per-account breakdown cards, campaigns table (all 3 accounts merged)
- `#meta-creative` — Meta ad cards with image preview, copy, per-ad metrics. Account filter.
- `#tiktok` — TikTok summary (spend/impr/reach/freq/clicks/CTR/CPM/conv) + Video Performance section (plays, 2s, 25/50/75/100% watched) + Engagement section (profile visits, follows, likes, comments, shares) + campaigns table. Auth banner if not connected.
- `#tiktok-creative` — TikTok ad cards (9:16 portrait aspect-ratio thumbnails for video covers/posters), ad text, CTA, per-ad metrics including video plays + 100% watched. Campaign filter.
- `#gsc` — Google Search Console: clicks/impr/CTR/avg-position summary, queries table (filterable + sortable), pages table, daily trend chart, device breakdown, sitemap status. Re-auth banner appears if `webmasters.readonly` scope is missing.

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
| `gsc-performance.js` | GSC Search Analytics — `?breakdown=summary\|query\|page\|date\|device\|country`. Property: `sc-domain:vitabrevisfineart.com`. Returns `status: 'needs_reauth'` if scope missing. |
| `gsc-coverage.js` | Sitemap list + per-sitemap submitted/indexed counts + property permission level. |
| `tiktok-performance.js` | TikTok Marketing API report — `?breakdown=summary\|daily\|monthly\|campaign`. Reads first advertiser_id from `tiktok_ads_connections.advertiser_ids`. Returns rich metrics (spend/impr/clicks + reach/frequency + conversions + 6 video-watch percentiles + engagement: likes/comments/shares/follows/profile_visits). Monthly is client-aggregated from daily. |
| `tiktok-ads.js` | Active TikTok ads with creative — image_url for static, video_cover_url + preview_url for videos. 4 sequential calls: `/ad/get/` → `/file/image/ad/info/` (batched 100) → `/file/video/ad/info/` (batched 100) → ad-level metrics report. |

### TikTok OAuth (separate folder `/api/tiktok-ads/`)
- `auth.js` — redirects to `business-api.tiktok.com/portal/auth?app_id=&redirect_uri=&state=`
- `callback.js` — exchanges `auth_code` for token via `/oauth2/access_token/` (note: `auth_code` param, not `code` like Google/Meta). Stores access_token + refresh_token + advertiser_ids[] + scope[] in `tiktok_ads_connections`. Redirects back to `#tiktok` tab.
- `schema.sql` — `tiktok_ads_connections` (token bundle keyed by `tiktok_user_id`) + `tiktok_ads_cache`
- Required env vars: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`
- TikTok API authentication header: `Access-Token: <token>` (NOT `Authorization: Bearer`)
- Response envelope: `{ code, message, data, request_id }` — `code === 0` means success

### Conventions
- Google endpoints inline OAuth refresh + GAQL search (matches digistore24 pattern — no shared helpers since Vercel functions deploy independently).
- Meta endpoints use shared `meta_ads_connections` OAuth row (one row, all 3 accounts under same token).
- GSC endpoints use the same `google_ads_connections` row — requires `webmasters.readonly` scope which was added to `/api/google-ads/auth.js` on 2026-04-30. Existing auth grants need a one-time re-auth at `/api/google-ads/auth` to pick up the scope.
- TikTok endpoints use the `tiktok_ads_connections` row. CTR returned as percentage 0-100 — divided by 100 in the endpoint to match other platforms (0-1 fraction).
- All endpoints return `{ status, ... }` where status ∈ `success | partial | error | not_configured | needs_reauth`.
- All accept `?days=N` (default 30 for Google, 28 for GSC since GSC has 2-day data lag), `?breakdown=` where applicable.

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

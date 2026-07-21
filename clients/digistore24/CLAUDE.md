# Digistore24 Client Dashboard

**Location:** `/clients/digistore24/`
**URL:** https://hyder.me/clients/digistore24
**Password:** TR8FFIC (sessionStorage key: `digistore24_ci_auth`)
**Google Ads Account:** 246-624-6400 (direct access, not via MCC)

## Overview

Two-part dashboard for Digistore24 — a managed PPC client:
1. **Competitive Intelligence Suite** (6 pages) — keyword analysis, competitor ads, landing pages, projections
2. **Google Ads Reporting** (1 page) — live performance dashboard with 5 tabs

## Pages (7 total)

| Page | File | Purpose |
|------|------|---------|
| Password | `password.html` | Entry gate |
| Summary | `competitive-intel-summary.html` | CI overview and tool descriptions |
| Keyword Tool | `keyword-tool.html` | 31K keyword pivot table |
| Competitor Ads | `competitor-ads.html` | Google Ads Transparency Center links |
| Landing Pages | `landing-page-analysis.html` | LP screenshots & analysis per competitor |
| Projections | `projection-tool.html` | Traffic/spend projection calculator |
| Sample LP | `sample-landing-page.html` | Reference landing page template |
| **Reporting** | `reporting.html` | Live Google Ads reporting dashboard |

All pages share the same nav bar with links to all tools + reporting.

## Reporting Dashboard (`reporting.html`)

**Added:** April 2026
**Pattern:** Follows Auto Addiction OC dashboard pattern (`/clients/autoaddiction/`)

### 5 Tabs (hash-based routing)
- **Overview** (`#overview`) — 8 stat cards (Spend, Clicks, Impr, CTR, Avg CPC, Conversions, Conv Rate, Cost/Conv), dual-axis spend+conversions chart, CPA trend chart. Granularity auto-switches: daily for ≤45 days, monthly for longer
- **Campaigns** (`#campaigns`) — Sortable table with Spend/Impr/Clicks/CTR/Avg CPC/Conv/Conv Rate/Cost-per-Conv, CSV export, status dots
- **Ad Creative** (`#creative`) — All live (ENABLED) RSA ad cards with Google search preview, per-asset performance (BEST/GOOD/LEARNING/LOW/PENDING) on each headline/description, campaign filter, sort options (spend/conv/CTR/CPA/most BEST), label count summary pills, headline & description leaderboards. Unrated assets (UNSPECIFIED/UNKNOWN/NOT_APPLICABLE) show no badge.
- **Search Terms** (`#search-terms`) — Top 20/50/100 selector, aggregated across campaigns/ad groups, sortable table with all metrics + Conv Rate, CSV export
- **Keywords** (`#keywords`) — All active keywords with match type, quality score, campaign/ad group context, text search, match type filter (Exact/Phrase/Broad), sortable table, CSV export

### Features
- Date range selector: **7d (default)**, 30d, 90d, 6mo, 12mo
- Chart.js v4 (CDN) for charts
- Demo data fallback with amber "DEMO DATA" badge when API unavailable
- Data badge: LIVE DATA (green) / DEMO DATA (amber) / LOADING (blue)
- Refresh button for on-demand data reload

## API Endpoints

| Endpoint | File | Purpose | Timeout |
|----------|------|---------|---------|
| `/api/digistore/performance` | `api/digistore/performance.js` | Account metrics (summary, campaign, monthly, daily breakdowns) | 30s |
| `/api/digistore/ads` | `api/digistore/ads.js` | RSA ad creative + asset performance labels (direct from RSA + asset_view fallback) | 30s |
| `/api/digistore/search-terms` | `api/digistore/search-terms.js` | Search terms (user queries) aggregated w/ metrics | 30s |
| `/api/digistore/account-keywords` | `api/digistore/account-keywords.js` | All active targeted keywords w/ QS + metrics | 30s |
| `/api/digistore/keywords` | `api/digistore/keywords.js` | Competitor keyword data from SimilarWeb (pre-existing, different purpose) | default |

### Performance API (`?breakdown=` param)
- `summary` (default): Customer-level aggregate metrics for date range
- `campaign`: Campaign-level breakdown sorted by spend
- `monthly`: Campaign-level with `segments.month` for long-range trend charts
- `daily`: Customer-level per-day data for short-range trend charts (7d / 30d views)

### Ads API (`?days=` param)
- Query 1: All live RSA ads (structure only — ad_group_ad.status = ENABLED + ad_group/campaign ENABLED). Includes `asset_performance_label` directly on each headline/description (v23 feature).
- Query 2: Per-ad metrics aggregated over the date range (no segments in SELECT)
- Query 3: Asset performance labels from `ad_group_ad_asset_view` (date-segmented to match UI; used as fallback enricher via text match)
- `normalizeLabel()` collapses UNSPECIFIED/UNKNOWN/NOT_APPLICABLE to null so the UI renders no badge for unrated assets; keeps BEST/GOOD/LEARNING/LOW/PENDING
- Merged: every live ad always returned, with metrics (0 if no activity in range) + rolled-up `labelCounts`
- Returns: ads array (with `path1`/`path2` for display URL) + asset leaderboard (sorted BEST→LOW)

### Search Terms API (`?days=N&limit=N`)
- Queries `search_term_view` with date segment, aggregates rows by search_term (since terms can match across campaigns/ad groups), sorts by spend desc, returns top `limit` (default 50, max 500)
- Each term includes Spend/Impr/Clicks/CTR/CPC/Conv/ConvRate/CPA + `sources` list (campaign › ad group where it matched)

### Account Keywords API (`?days=N`)
- Queries `keyword_view` for all non-REMOVED keywords in the date range
- Returns text, match_type, status, quality_score, campaign, ad_group, full metrics including conv rate

### API Pattern
Both endpoints follow the `autoaddiction-data.js` pattern:
1. Get OAuth connection from Supabase `google_ads_connections`
2. Refresh token if expired
3. Execute GAQL queries against Google Ads API v23
4. `CUSTOMER_ID = '2466246400'`, `LOGIN_CUSTOMER_ID = '2466246400'` (direct access, not via MCC)

## Competitive Intelligence Data

### Brands Analyzed (6)
| Brand | Color | Hex | Notes |
|-------|-------|-----|-------|
| Impact | Pink | #ec4899 | Partnership automation platform |
| Awin | Blue | #3b82f6 | Global affiliate network |
| ClickBank | Green | #22c55e | Digital product marketplace |
| MaxWeb | Amber | #f59e0b | Affiliate network |
| Realize | Teal | #14b8a6 | Affiliate management |
| SamCart | Purple | #8b5cf6 | Shopping cart platform |

*All brands selected by default in the keyword tool.*

### Data Files
- `data/keywords-combined.json` — 31,164 keywords with brand data, volumes, CPCs, Google KP data
- `data/ppc-kws/` — Raw SimilarWeb exports per competitor (.xlsx)

### Import Scripts
- `scripts/import-digistore-keywords.js` — SimilarWeb Excel → keywords-combined.json
- `scripts/fetch-google-keywords.js` — Enriches with Google Keyword Planner (batch size 15)

## Design System
- Dark theme: `--bg-primary: #0f172a`, `--bg-secondary: #1e293b`, `--accent: #3b82f6`
- All CSS inline per page (no shared stylesheet except `styles.css` isn't used by these pages)
- System fonts, blue accent
- Logo filter: `filter: invert(48%) sepia(79%) saturate(2476%) hue-rotate(200deg) brightness(118%) contrast(91%)`

## Navigation
All pages include:
```html
<nav class="main-nav">
    <a href="keyword-tool.html" class="nav-brand">
        <img src="../../assets/imgs/logos/hyder-media-icon.png" alt="Hyder Media">
        Digistore24 Competitive Intel
    </a>
    <div class="nav-links">
        <a href="competitive-intel-summary.html" class="nav-link">Summary</a>
        <a href="keyword-tool.html" class="nav-link">Keyword Tool</a>
        <a href="competitor-ads.html" class="nav-link">Competitor Ads</a>
        <a href="landing-page-analysis.html" class="nav-link">Landing Pages</a>
        <a href="projection-tool.html" class="nav-link">Projections</a>
        <a href="reporting.html" class="nav-link">Reporting</a>
    </div>
</nav>
```

## Authentication Flow (sessionStorage)
1. User visits `/clients/digistore24/` → redirects to `password.html`
2. User enters password "TR8FFIC"
3. sessionStorage stores `digistore24_ci_auth = 'authenticated'`
4. Redirects to `competitive-intel-summary.html`
5. All tool pages check sessionStorage auth on load

```javascript
// On all protected pages (in <head>):
<script>
    (function() {
        const AUTH_KEY = 'digistore24_ci_auth';
        if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
            window.location.href = 'password.html';
        }
    })();
</script>
```

## Keyword Data — Deep Detail (merged from root CLAUDE.md)

**Data stats (as of 2026-02-04):**
- Total keywords: 31,164
- Keywords with Google Keyword Planner data: 26,116
- Keywords in topic groups: 9,932
- Keywords in brand groups: 7,220
- Keywords in both (should be 0): 0

**keywords-combined.json structure (full file):**
```json
{
  "total_keywords": 31164,
  "brands": ["awin", "clickbank", "impact", "maxweb", "realize", "samcart"],
  "category_counts": {
    "Affiliate/Network": 15169,
    "Other": 7054,
    "E-commerce/Cart": 3397,
    "Brand - Competitor": 2532,
    "...": "..."
  },
  "keyword_groups": {
    "topics": {
      "affiliate marketing": {
        "count": 500,
        "total_clicks": 12000,
        "total_spend": 25000,
        "sample_keywords": [
          { "keyword": "affiliate marketing programs", "clicks": 150, "brands": ["clickbank", "impact"] }
        ],
        "brands_bidding": {
          "clickbank": { "count": 200, "clicks": 5000, "spend": 12000 }
        }
      }
    },
    "brands": {
      "clickbank": {
        "count": 1783,
        "total_clicks": 45000,
        "total_spend": 98000,
        "sample_keywords": [...],
        "brands_bidding": {...}
      }
    }
  },
  "global_avg_cpc": 4.30,
  "keywords": [/* array of keyword objects */]
}
```

**Individual keyword object structure:**
```json
{
  "keyword": "affiliate marketing",
  "category": "Affiliate/Network",
  "intent": "Informational",
  "short_tail_group": "affiliate marketing",
  "brand_group": null,
  "total_clicks": 450,
  "total_spend": 1102.50,
  "volume": 12500,
  "cpc": 2.45,
  "brands": [
    {
      "name": "clickbank",
      "clicks": 450,
      "cpc": 2.45,
      "est_spend": 1102.50,
      "desktop_share": 0.65,
      "mobile_share": 0.35,
      "top_url": "clickbank.com/affiliate"
    }
  ],
  "google": {
    "annual_volume": 150000,
    "avg_monthly_searches": 12500,
    "competition": "HIGH",
    "competition_index": 85,
    "low_top_of_page_bid": 1.50,
    "high_top_of_page_bid": 4.25,
    "average_cpc": 2.87
  }
}
```

**IMPORTANT: Brand vs Topic Grouping Logic**
- Keywords are assigned to EITHER a `brand_group` OR a `short_tail_group`, never both
- Brand detection takes priority: if keyword contains a brand name → brand_group only
- If keyword does NOT contain a brand → may get short_tail_group
- Example: "impact affiliate marketing" → brand_group: "impact", short_tail_group: null

### Import script: `scripts/import-digistore-keywords.js`
Reads SimilarWeb Excel exports and generates keywords-combined.json:
1. Reads all `.xlsx` files from `data/ppc-kws/`
2. Extracts brand from filename (e.g., `Website Keywords-clickbank.com-...`)
3. Categorizes keywords, determines intent
4. Assigns brand_group OR short_tail_group (mutually exclusive)
5. Builds keyword_groups with sample_keywords and brands_bidding
6. Outputs to `keywords-combined.json`

**28 Brand Patterns Recognized:**
```javascript
const BRAND_KEYWORDS = {
    'clickbank': /clickbank/i,
    'impact': /\bimpact\b/i,
    'awin': /\bawin\b|shareasale/i,
    'samcart': /samcart/i,
    'maxweb': /maxweb/i,
    'realize': /\brealize\b/i,
    'rakuten': /rakuten/i,
    'cj': /commission\s*junction|\bcj\b/i,
    'partnerstack': /partnerstack/i,
    'refersion': /refersion/i,
    'tapfiliate': /tapfiliate/i,
    'stripe': /\bstripe\b/i,
    'paypal': /paypal/i,
    'shopify': /shopify/i,
    'woocommerce': /woocommerce/i,
    'clickfunnels': /clickfunnels/i,
    'kajabi': /kajabi/i,
    'teachable': /teachable/i,
    'thinkific': /thinkific/i,
    'gumroad': /gumroad/i,
    'digistore': /digistore/i,
    'jvzoo': /jvzoo/i,
    'warriorplus': /warriorplus|warrior\s*plus/i,
    'stan': /\bstan\s+store\b|\bstan\.store\b/i,
    'kartra': /kartra/i,
    'leadpages': /leadpages/i,
    'unbounce': /unbounce/i,
    'instapage': /instapage/i,
};
```

**16 Topic Groups:**
- affiliate marketing, affiliate network, partner program, referral program
- influencer marketing, performance marketing, ecommerce, shopping cart
- payment processing, digital products, online courses, commissions
- tracking & attribution, landing pages, conversion, integrations

### Enrichment script: `scripts/fetch-google-keywords.js`
Enriches keywords with Google Keyword Planner data via the hyder.me API:
1. Reads keywords-combined.json
2. Filters to keywords missing `google` data
3. Batches requests to `/api/google-ads/keywords` (15 at a time)
4. Merges Google data (volume, CPC, competition) into keywords
5. Saves updated file

**IMPORTANT: Batch size MUST be 15, not 100**
- Batch size 100 causes Google API 400 INVALID_ARGUMENT errors
- 1.5 second delay between batches to avoid rate limits
- Script is incremental - skips keywords that already have Google data

**API endpoint:** `https://hyder.me/api/google-ads/keywords`
- POST with `{ keywords: [...], exactOnly: true }`
- Returns `{ results: [{ keyword, avgMonthlySearches, competition, ... }] }`

### Keyword Categories (10)
- Affiliate/Network
- E-commerce/Cart
- Brand - Competitor
- Marketing/Strategy
- Review/Comparison
- Product/Digital
- Course/Education
- Sign Up/Login
- Money/Income
- Other

## Landing Page Analysis
`landing-page-analysis.html` features dynamic overview section that updates per competitor tab:

```javascript
const competitorOverviews = {
    clickbank: { title: '...', pages: '12', clicks: '34,980', ... },
    impact: { title: '...', pages: '18', clicks: '11,590', ... },
    // etc.
};

function updateOverview(tab) {
    const data = competitorOverviews[tab];
    document.getElementById('overview-title').textContent = data.title;
    // ... update other elements
}
```

## Summary Page Stats
- 31K+ keywords analyzed
- 6 competitors tracked
- 150+ landing pages reviewed
- $225K+ monthly spend estimated

## Troubleshooting

### keywords-combined.json 404 on production
1. Check if file is committed: `git status`
2. If committed but still 404, Vercel may be pointing to old deployment
3. Fix: `vercel alias <latest-deployment-url> hyder.me`

### Google Keyword Planner data missing
1. Check if keywords have `google` property: look at keywords-combined.json
2. If missing, run: `node scripts/fetch-google-keywords.js`
3. Script is incremental - only fetches for keywords without `google` data
4. Batch size must be 15 (100 causes API errors)

### Keywords appearing in wrong groups
1. Brand keywords should only be in brand_group, not short_tail_group
2. Check import script brand patterns in BRAND_KEYWORDS
3. Regenerate: `node scripts/import-digistore-keywords.js`
4. Script checks brand first - if match, sets brand_group and short_tail_group=null

### keywords-combined.json evicted locally (iCloud)
Git is the source of truth: `git checkout HEAD -- clients/digistore24/data/keywords-combined.json` or `brctl download <file>`. Always deploy from GitHub, not local.

<claude-mem-context>

</claude-mem-context>
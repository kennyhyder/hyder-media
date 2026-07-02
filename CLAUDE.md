# Hyder Media Project Context

## Project Overview
This repository contains multiple interconnected projects for Kenny Hyder's digital marketing consultancy at hyder.me.

**The full stack extends beyond this repo** — see `~/.claude/CLAUDE.md` (global stack registry, loaded every session) and Mission Control (mc.hyder.me, repo `kennyhyder/mission-control`). Notable external projects: **mission-control** (control center), **marksearch.ai** (`~/Desktop/USPTOsearch`), **tradebot** (DO droplet), **subredmonitor.com**, **automatedojo** (own repo, lives at `automatedojo/` here).

## Monorepo top-level map
| Dir | What | Live | Docs |
|---|---|---|---|
| `/` (root html) | hyder.me site + tools + /playbook + /about + /capabilities | hyder.me | this file |
| `api/` | ~19 serverless namespaces, 39 crons (sports, golfodds, seo canaries, ag2020, digistore, omicron, vita-brevis, solar, grid-legacy, _platform shared libs) | hyder.me/api/* | per-dir CLAUDE.md |
| `clients/` | Client dashboards (ag2020, digistore24, omicron, vita-brevis, falconlabs, dunham, autoaddiction, affiliati) | hyder.me/clients/* | `clients/*/CLAUDE.md` |
| `sportsbookish/` | Odds-comparison SaaS — git-linked, own Vercel project | sportsbookish.com | `sportsbookish/CLAUDE.md` |
| `grid/` | **GridCensus** (ex-GridScout) — standalone SaaS, own Supabase (`hzaqzbtyqqixmibcfuwo`), own Vercel project | gridcensus.com | `grid/CLAUDE.md` |
| `golfodds/` | Golf odds frontend; data plane for sportsbookish (crons in `api/golfodds/`) | hyder.me/golfodds | `golfodds/CLAUDE.md` |
| `automatedojo/` | AutomateDojo SaaS — **own git repo** nested here | automatedojo.com | `automatedojo/CLAUDE.md` |
| `solar/` | SolarTrack DB (Blue Water Battery) | hyder.me/solar | `solar/CLAUDE.md` |
| `tokens/` | Opportunity Framework (static, stable) | hyder.me/tokens | — |
| `decks/` | Pitch decks: framework, auto-glass, gridscout, ag2020-investor, ai-strategy | hyder.me/decks/* | — |
| `docs/`, `downloads/`, `scripts/`, `watch-faces/`, `cv/`, `moving-checklist/` | Docs, playbook bundle, data scripts, Garmin faces, expert-witness CV, misc | — | — |

## Directory Structure

### Root (`/`)
Static HTML website for hyder.me - Kenny Hyder's consulting homepage.
- **Do not modify** unless specifically asked to update the main website
- Uses Bootstrap CSS framework with dark mode support
- Google Analytics (GTM ID: G-731HHGLMJS)
- Contact form with rate limiting and spam detection

**Key Pages:**
- `index.html` - Main landing page
- `tools.html` - Marketing tools hub
- `calculator.html` - Ad Spend ROI calculator
- `matchtypes.html` / `keyword-match-generator.html` - Keyword match type tools
- `utm-builder.html` - UTM parameter builder
- `youtube-search.html` - YouTube video search tool

**Other Root Files:**
- `index-old.html` - Archived previous version of homepage
- `blank-tool-template.html` - Template for creating new tool pages
- `blog-article.html` - Blog post template
- `cards.html` - Card component reference
- `robots.txt` - SEO robots configuration
- `sitemap.xml` - Site map for search engines
- `favicon.ico` - Site favicon

### `/api` - Serverless Backend
Vercel serverless functions (Node.js)

**Contact API:** `/api/contact.js`
- Email validation, rate limiting, spam detection
- Uses nodemailer (Gmail credentials in .env.local)

**Google Ads API Suite:** `/api/google-ads/`
- `auth.js` - OAuth 2.0 initiation
- `callback.js` - OAuth callback handler (recursively fetches MCC child accounts)
- `accounts.js` - List connected accounts
- `campaigns.js` - Campaign data with metrics
- `sync.js` - Full data synchronization
- `keywords.js` - Google Keyword Planner data (batch lookup)
- `debug.js` - API diagnostics
- `debug-omicron.js` - Test Omicron MCC access to all accounts
- `debug-bur-top10.js` - Test BUR/Top10 access with different login-customer-ids
- `test-direct.js` - Minimal direct API test endpoint
- `schema.sql` - Supabase database schema (11 tables)
- `SETUP.md` - Integration setup guide

**Omicron Dashboard APIs:** `/api/google-ads/`
- `omicron-data.js` - 30-day summary metrics for all 9 accounts
- `omicron-monthly.js` - Monthly data with brand/non-brand campaign breakdown
- `omicron-conversions.js` - Conversion action breakdown per account

**AG2020 APIs:** `/api/ag2020/`
- `ag2020-spend.js` (in `/api/google-ads/`) - Google Ads historical spend data
- `cash-infusions.js` - Cash infusion tracking
- `schema.sql` - AG2020-specific database schema

**Digistore24 API:** `/api/digistore/`
- `keywords.js` - Keyword data endpoint

**Cross-pipeline shared libs:** `/api/_platform/` (added 2026-06-03)
- `odds.js` — americanToDecimal, decimalToImplied, americanToProb, devigProbs, devigToSum, devigOutcomes
- `constants.js` — STALE_THRESHOLD_MS (30 min), isStaleQuote()
- `names.js` — normalizeName (ASCII default — DB-keying convention), normalizeNameUnicode (NFD-stripped, for matching external sources like Polymarket)
- **Rule:** Before copy-pasting odds math / constants / normalization between sports/ and golfodds/, add it here. Sports + golf had drifted into 3 independent copies of americanToDecimal and 5 of normalizeName before extraction. See `memory/api-platform-shared-libs.md`.

**Three-canary observability:** `/api/seo/` (full system live 2026-06-03)
- `cron-route-canary.js` (every 15 min) — every critical URL returns 200; alerts on 2nd-consecutive 4xx/5xx
- `cron-data-freshness.js` (every 15 min) — every critical ingest table has had a write in the last cron-cycle×3; alerts on 2nd-consecutive stale
- `cron-coverage-check.js` (hourly) — every scheduled cron URL is deployed (not 404/5xx) + every critical Postgres table exists; alerts on 2nd-consecutive same-kind drift
- All three persist to `sb_route_health`, `sb_data_freshness_log`, `sb_coverage_log`. All alert via Resend to kenny@hyder.me. The trio caught a real bug on first deploy: `cron-data-freshness` was scheduled in vercel.json but the schedule entry never made it into the commit — the coverage canary surfaced it within an hour.

**Current Issue:** Google Ads API returns 501 UNIMPLEMENTED error. See FOLLOWUP-NOTES.md for investigation status.
- **Blocked since:** January 27, 2026
- **What works:** OAuth flow, developer token (Basic Access), Google Cloud setup
- **Next steps:** Check OAuth consent screen mode, data access settings, API Explorer testing

### `/tokens` - Token Opportunity Framework (Next.js)
Static Next.js export analyzing 150+ companies from Ribbit Capital Token Letter.
- **URL:** https://hyder.me/tokens
- 19 detailed capex/business-plan pages (capex-1 through capex-19)
- Uses Tailwind CSS, React Server Components
- Static export deployed to Vercel with `basePath: '/tokens'`
- Source files are in a separate build process; only built output in this directory

**Known Capex Opportunities:**
| # | Company | Industry |
|---|---------|----------|
| 1 | CalibrateNet | Auto Glass/ADAS Calibration |
| 2 | PowerReady | Backup Power Installation |
| 3 | TowerTrack | Wireless Infrastructure |
| 4 | ChargeScore | EV Charging Reliability |
| 5-19 | Various | Various sectors |

Each page includes: Executive Summary, Full Plan, Financials tabs with market sizing, seed ask, TAM, CAGR, and LTV:CAC ratios.

### `/clients` - Client Portal
Authenticated dashboards for individual clients.

**Login System:** `/clients/index.html`
- Supabase authentication
- Routes users to client-specific dashboards

**Digistore24 Competitive Intel Suite:** `/clients/digistore24/`
- Password-protected tool suite (password: TR8FFIC)
- PPC strategy and competitive intelligence
- See detailed breakdown below

**Omicron Google Ads Dashboard:** `/clients/omicron/`
- Password-protected multi-account dashboard (password: LIEHAO)
- 9 Google Ads accounts across Usenet portfolio
- Powered by Google Ads API (live data when connected)
- See detailed breakdown below

**Auto Glass 2020 Financial Dashboard:** `/clients/ag2020/`
- Password-protected financial dashboard (password: AG2020FLOW)
- Cash flow analysis, payroll, debt tracking, forecasting
- Built with Next.js static export
- See detailed breakdown below

**Vita Brevis Fine Art Dashboard:** `/clients/vita-brevis/`
- Password-protected ad reporting dashboard (password: VITABREVIS)
- Cross-platform Google Ads (327-808-5194) + Meta Ads (3 accounts) reporting
- Hyder does NOT manage their spend — read-only reporting only
- Also includes `instagram-reviews.html` Squarespace Code Block snippet for /rave-reviews page
- See `/clients/vita-brevis/CLAUDE.md`

### `/assets` - Static Assets
```
/assets/
├── css/
│   ├── bootstrap.min.css     # Bootstrap 5 framework
│   ├── style.css             # Custom styles (CSS variables, dark mode)
│   └── responsive.css        # Breakpoints: 576, 768, 992, 1200, 1400px
├── js/
│   ├── bootstrap.bundle.min.js  # Bootstrap JavaScript
│   ├── script.js             # Site navigation, dark mode toggle, contact form
│   └── calculator.js         # Ad Spend ROI calculator logic
└── imgs/
    ├── logos/
    │   ├── hyder-media-logo.png   # Full logo
    │   ├── hyder-media-icon.png   # Icon only
    │   └── favicon.png            # Favicon
    ├── bgs-thumbs/
    │   ├── hero-bg.png            # Light mode hero
    │   └── hero-bg-dark.png       # Dark mode hero
    ├── services/service-01.png through service-06.png
    ├── card/post-card-thumb-01.png, -02.png
    └── kenny-hyder.jpg            # Profile photo
```

**CSS Design System:**
- CSS variables for theming: `--brown`, `--dark-brown`, `--white`, etc.
- Dark mode via `.dark-mode` class on `<html>`, saved to localStorage
- Fonts: System fonts (no external font CDNs)

### `/docs` - Documentation
```
/docs/
├── google-ads-api-design-documentation.html  # API integration design doc
├── solarscore-pitch-deck.html                # SolarScore product pitch
└── solar-database-project/                   # Separate initiative
    ├── PROJECT_INSTRUCTIONS.md
    ├── CONSTITUTION.md
    ├── CLAUDE_INSTRUCTIONS.md
    ├── AGENTS.md
    ├── RALPH_WIGGUM_SETUP.md
    └── specs/
        ├── 001-database-schema/spec.md
        ├── 002-data-ingestion/spec.md
        ├── 003-api-endpoints/spec.md
        ├── 004-web-interface/spec.md
        └── 005-deployment/spec.md
```

### `/decks` - Pitch Presentations
Full-screen HTML slide decks with custom navigation (prev/next buttons, progress bar, keyboard support).

- **`/decks/framework/index.html`** - "Distribution Control in the Age of AI"
  - Token systems framework pitch (~20 slides)
  - Orange/brown color scheme, PT Sans + Roboto Mono fonts
  - Topics: Token types, market catalysts, architecture patterns

- **`/decks/auto-glass/index.html`** - "Auto Glass & ADAS Calibration Opportunity"
  - CalibrateNet investor pitch (~20 slides)
  - Blue gradient color scheme
  - ADAS calibration market sizing and network model

### `/scripts` - Data Processing Scripts
- `import-digistore-keywords.js` - Transform SimilarWeb Excel exports → keywords-combined.json
- `fetch-google-keywords.js` - Enrich keywords with Google Keyword Planner data

### Other Root Files
- `CLAUDE.md` - This project context file
- `AGENTS.md` - Agent workflow instructions (bd/beads issue tracking)
- `FOLLOWUP-NOTES.md` - Google Ads API investigation notes

---

## Digistore24 Competitive Intelligence Suite

**Location:** `/clients/digistore24/`
**URL:** https://hyder.me/clients/digistore24
**Status:** Active / Complete

### Authentication Flow
1. User visits `/clients/digistore24/` → redirects to `password.html`
2. User enters password "TR8FFIC"
3. sessionStorage stores `digistore24_ci_auth = 'authenticated'`
4. Redirects to `competitive-intel-summary.html`
5. All tool pages check sessionStorage auth on load

**Auth implementation:**
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

### Tool Pages (6 total)

| Page | File | Purpose |
|------|------|---------|
| **Password** | `password.html` | Entry point, password gate |
| **Summary** | `competitive-intel-summary.html` | Overview page explaining analysis context and tool suite |
| **Keyword Tool** | `keyword-tool.html` | Interactive 31K keyword pivot table |
| **Competitor Ads** | `competitor-ads.html` | Google Ads Transparency Center links |
| **Landing Pages** | `landing-page-analysis.html` | LP screenshots & analysis per competitor |
| **Projections** | `projection-tool.html` | Traffic/spend projection calculator |
| **Sample LP** | `sample-landing-page.html` | Reference landing page template |

### Navigation Structure
All tool pages share standardized navigation:
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
    </div>
</nav>
```

**Logo styling (blue accent to match brand text):**
```css
.nav-brand img {
    height: 32px;
    width: auto;
    filter: invert(48%) sepia(79%) saturate(2476%) hue-rotate(200deg) brightness(118%) contrast(91%);
}
```

### Brands Analyzed (6 total)

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

**Location:** `/clients/digistore24/data/`

| File | Contents |
|------|----------|
| `keywords-combined.json` | 31,164 keywords with brand data, volumes, CPCs, Google data |
| `ppc-kws/` | Raw SimilarWeb exports per competitor (Excel .xlsx files) |

**Current Data Stats (as of 2026-02-04):**
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

### Data Import Scripts

**Location:** `/scripts/`

#### 1. Import Digistore Keywords (`import-digistore-keywords.js`)

Reads SimilarWeb Excel exports and generates keywords-combined.json.

```bash
node scripts/import-digistore-keywords.js
```

**What it does:**
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

#### 2. Fetch Google Keywords (`fetch-google-keywords.js`)

Enriches keywords with Google Keyword Planner data via the hyder.me API.

```bash
node scripts/fetch-google-keywords.js
```

**What it does:**
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

### Landing Page Analysis
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

### Summary Page Stats
- 31K+ keywords analyzed
- 6 competitors tracked
- 150+ landing pages reviewed
- $225K+ monthly spend estimated

---

## Omicron Google Ads Dashboard

**Location:** `/clients/omicron/`
**URL:** https://hyder.me/clients/omicron
**Status:** Active / In Development

### Authentication Flow
1. User visits `/clients/omicron/` → redirects to `password.html`
2. User enters password "LIEHAO"
3. sessionStorage stores `omicron_dashboard_auth = 'authenticated'`
4. Redirects to `summary.html`
5. All tool pages check sessionStorage auth on load

**Auth implementation:**
```javascript
// On all protected pages (in <head>):
<script>
    (function() {
        const AUTH_KEY = 'omicron_dashboard_auth';
        if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
            window.location.href = 'password.html';
        }
    })();
</script>
```

### Pages

| Page | File | Purpose |
|------|------|---------|
| **Password** | `password.html` | Entry point, password gate |
| **Summary** | `summary.html` | Overview page with account structure and API status |
| **Dashboard** | `dashboard.html` | Multi-account comparison with charts and filters |
| **Legacy** | `legacy-dashboard.html` | Original CSV-based view (BUR + Top10 only) |

### Account Structure (9 accounts)

All accounts accessible via **single OAuth connection**:

| Account | Customer ID | Color | Access Path |
|---------|-------------|-------|-------------|
| BUR | 441-339-0727 | #3b82f6 (Blue) | Via MCC 673-698-8718 |
| Top10usenet | 147-846-7425 | #ec4899 (Pink) | Direct user access |
| **Omicron MCC** | 808-695-7043 | -- | User access (contains 7 children) |
| └─ Eweka | 707-911-8680 | #22c55e (Green) | Child of Omicron MCC |
| └─ Easynews | 538-066-1321 | #f59e0b (Amber) | Child of Omicron MCC |
| └─ Newshosting | 756-634-1629 | #8b5cf6 (Purple) | Child of Omicron MCC |
| └─ UsenetServer | 397-230-3325 | #14b8a6 (Teal) | Child of Omicron MCC |
| └─ Tweak | 114-658-1474 | #ef4444 (Red) | Child of Omicron MCC |
| └─ Pure | 172-134-6287 | #6366f1 (Indigo) | Child of Omicron MCC |
| └─ Sunny | 890-868-9985 | #eab308 (Yellow) | Child of Omicron MCC |

### Data Strategy
- Dashboard currently shows **demo data** (randomly generated)
- Will display live data once Google Ads API 501 error is resolved
- Plan: Daily sync to Supabase, dashboard reads from cache
- Manual refresh button for on-demand updates

### File Structure
```
/clients/omicron/
├── index.html              # Redirect to password.html
├── password.html           # Password protection gate
├── summary.html            # Overview with API status
├── dashboard.html          # Multi-account comparison
├── legacy-dashboard.html   # Original CSV-based view
├── styles.css              # Shared styles (Digistore24 design system)
├── app.js                  # Legacy dashboard logic
├── topten_all_basic.csv    # Legacy Top10 data
├── bur_all_basic.csv       # Legacy BUR data
├── package.json            # Dependencies
└── vercel.json             # Deployment config
```

### Google Ads API Integration
- OAuth flow works, tokens stored in Supabase
- `callback.js` updated to recursively fetch MCC child accounts
- Dashboard pulls live metrics from all 10 accounts

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/google-ads/omicron-data` | 30-day summary metrics for all accounts |
| `/api/google-ads/omicron-monthly` | Monthly data with brand/non-brand breakdown |
| `/api/google-ads/omicron-conversions` | Conversion action breakdown per account |

### Brand vs Non-Brand Classification

**Location:** `/api/google-ads/omicron-monthly.js`

The API classifies campaigns as brand or non-brand based on campaign name patterns:

```javascript
// Non-brand patterns (checked FIRST - take priority)
const NON_BRAND_PATTERNS = [
    'non-brand', 'nonbrand', 'non brand',
    'generic', 'competitor', 'discovery', 'dsa', 'prospecting'
];

// Brand patterns
const BRAND_PATTERNS = [
    'eweka', 'easynews', 'newshosting', 'usenetserver',
    'tweaknews', 'pure usenet', 'sunny usenet',
    'bestusenetreviews', 'bur', 'top10usenet', 'privado'
];
```

**Important:** Campaigns with "Non-Brand" in the name are classified as non-brand even if they contain brand terms.

### Dashboard Tabs (Linkable)

Tabs support direct linking via URL hash:
- `dashboard.html#overview` - Overview
- `dashboard.html#review` - Review Sites
- `dashboard.html#owned` - Owned Sites
- `dashboard.html#conversions` - SKU / Brand
- `dashboard.html#accounts` - Account Details

### Known Issues
1. Google Ads API 501 UNIMPLEMENTED may occur - see FOLLOWUP-NOTES.md
2. If accounts show "Error", try reconnecting OAuth via Summary page

---

## Auto Glass 2020 — Tech-Enabled Financial + Attribution Platform

**Location:** `/clients/ag2020/`
**URL:** https://hyder.me/clients/ag2020
**Status:** Production. Multi-user, live data, automated ingest.

Built out from a static financial dashboard into a complete attribution + ops
platform. Replaced shared-password gate with Supabase Auth + per-user
permissions. Added end-to-end attribution, halo-lift analysis, autodialer,
ad-spend ingest, and an investor pitch deck. **Companion memory:**
[[ag2020-platform-state]] and [[ag2020-pending-items]].

### Authentication (Supabase email/password + magic link)
- **Login page:** `/clients/ag2020/login.html` — both password sign-in AND magic-link tabs
- **Auth check:** React `AuthGate` wraps the dashboard; static pages
  (court-presentation, cashflow, 404) use `auth-check.js`
- **Old `password.html`** now 302-redirects to `login.html` (preserves `?next=`)
- **Supabase project:** `ilbovwnhrowvxjdkvrln` (shared with Omicron, AutomateDojo,
  SportsBookISH, Vita Brevis, etc.)
- **User table:** `ag2020_users` (user_id, email, role, allowed_tabs jsonb,
  display_name). Schema in `/clients/ag2020/supabase/ag2020_users.sql`.
- **Role helper:** `is_ag2020_admin(uuid)` SQL function (SECURITY DEFINER, used by RLS)
- **Admins seeded:** `kenny@hyder.me` + `cash@autoglass2020.com`
- **Sign-up flow** sets `raw_user_meta_data.product = 'ag2020'` so the
  shared-project triggers `9dm_handle_new_user` + `sb_handle_new_user`
  (AutomateDojo + SportsBookISH) skip — keeps users isolated per product.

### Tab structure (per-user gating)
| Tab | Default audience | Notes |
|-----|---|---|
| Dashboard | All | Wins-showcase landing: Halo Lift hero + revenue trend + attribution split + admin-only financial card (gated by role) |
| Forecast | All | Revenue/expense projections |
| Performance | All | Google + Meta live performance with halo-adjusted ROAS |
| Attribution | All | Halo Lift card + revenue-by-source breakdown + recent linked journeys |
| Leads & Calls | All | AC contacts (live) + Vonage call logs (merged from 2 tables) + autodial follow-up timeline |
| Call Triage | All | Vonage call queue |
| Rebates | All | Outstanding rebate AR |
| Overhead | Admin | Fixed + variable expenses |
| Payroll | Admin | Employee wages |
| Debt | Admin | Outstanding debts + schedule |
| Bank Statements | Admin | Raw transaction history |
| Bankruptcy | Admin | Chapter 11 analysis, creditor distributions |
| Admin | Admin only | Invite / promote / delete users + per-tab visibility checkboxes |

Admins see everything by default. Members see the team-safe set. Per-user
`allowed_tabs` array overrides the role default when populated.

### Attribution Platform (`ag2020_*` tables in Supabase)
- `ag2020_lead_journey` — one row per unique customer (phone+email join key).
  `first_touch_source`, `first_touch_channel`, `ac_contact_id`,
  `revenue_total`, `crm_job_ids[]`, `journey_state`
- `ag2020_lead_touchpoints` — every customer interaction (form submit, AC
  webhook, call inbound/outbound, voicemail, SMS, autodial attempt)
- `ag2020_crm_jobs` — GlassBiller invoices joined to journeys
- `ag2020_ad_spend_daily` — Google + Meta daily spend per platform/campaign
- `ag2020_autodial_attempts` — every speed-to-lead autodial fired
- Older legacy: `ag2020_missed_call_followups`, `ag2020_call_logs`, etc.

**Source map** lives in `/api/ag2020/_attribution-lib.js`. Maps AC tag ids +
lowercased names → `(source, channel)`. Covers Meta (2462/2463/2465/2486/9),
Google (2449/2461/2467/2471/2472/2473/2474/2454), Organic (2450/2451/2452),
Referral (2484). Active "FB Leads D - Revised" = tag 2463. **Brand
detection priority is correct** — don't reintroduce the old tag-name regex.

**RPC functions** (in `/api/ag2020/attribution-functions.sql`):
- `ag2020_link_crm_jobs_to_journeys(tenant)` — bulk-link by phone then email
- `ag2020_rollup_journey_financials(tenant)` — recompute per-journey revenue/cogs/margin
- `ag2020_revenue_by_source_window(tenant, start, end)` — date-windowed source
  breakdown (powers Attribution tab + halo-lift overlay on Meta/Google ROAS)

### Halo Lift Analysis (the proudest stat)
**$2.81 of unattributed revenue per $1 ad spend, p<0.00001, t=6.83, 95% CI [$2.00, $3.62]**

After controlling for linear time trend + 11 month dummies (seasonality), the
deseasonalized regression on 117 weekly buckets across 28 months of ad spend
+ 6 years of GlassBiller revenue shows a statistically rock-solid halo
coefficient. Endpoint at `/api/ag2020/halo-lift` returns both simple OLS and
controlled regression results. Coefficient is exposed via
`/api/ag2020/_halo-coefficient.js` (env-overridable via
`AG2020_HALO_PER_DOLLAR`). Applied to:
- Halo Lift card on Attribution tab (headline)
- Meta + Google ROAS cards on Performance tab (halo-adjusted as primary number, direct as secondary)
- Investor pitch deck slide 9

Per-platform halo allocation = `spend × $2.81` (the per-platform share of the
system halo, mathematically equal regardless of split).

### Data Sources + Ingestion Pipelines
| Source | Method | Frequency | Where |
|---|---|---|---|
| Google Ads (3 accounts) | Cron via Google Ads API v23 | Daily 8am UTC | `/api/ag2020/cron-ad-spend-daily.js` |
| Meta Ads | Same cron | Daily 8am UTC | Same |
| GlassBiller (jobs) | Email → Zapier → webhook | Daily (per setup) | `/api/ag2020/glassbiller-email-ingest.js` |
| ActiveCampaign (leads) | Webhook on `contact_tag_added` | Real-time | `/api/ag2020/journey-ingest.js` |
| ActiveCampaign (queries) | Direct API via `/api/ag2020/leads.js` | On-demand | Tab read |
| Vonage calls | CSV upload (Company Report format has phones; old All-Calls doesn't) | Manual | `/api/ag2020/call-log-upload.js` + touchpoint backfill |
| Vonage missed-call → autodial | `call-event-webhook.js` → autodialer | Real-time | `/api/ag2020/autodial.js` + sibling files |
| SMS inbound | Twilio Studio Flow → webhook | Real-time | `/api/ag2020/sms-ingest.js` |

**Google Ads accounts (all 3 wired)**:
- `376-274-0423` AG2020 Live (new May 2026, primary going forward)
- `505-336-5860` AG2020 Historical (recent — superseded by Live)
- `439-961-4856` AG2020 Historical (older — disabled long ago)

**Vonage caveat**: VBC account #400386 is below the 50-extension threshold
Vonage requires for direct API access. CSV exports are the only path. Newer
"Company Report" CSVs include phone numbers; older "All Calls" don't.
`/api/ag2020/calls.js` merges from both tables (`ag2020_call_logs` +
`ag2020_lead_touchpoints` where touchpoint_type ∈ call_*) and dedupes.

### Autodialer / Speed-to-Lead
End-to-end live: form submit OR missed call → Twilio Voice API calls customer
→ on answer, bridges to rep line (623-***-****). HMAC-signed callback URLs.
Business-hours-aware (Mon-Sat 7a-6p AZ). 6h dedupe per phone. Per the May 2026
backfill: ~158 form-submit autodials/mo + ~10 missed-call autodials/mo
firing. Outcomes split: ~15% bridged, ~30% voicemail, ~5% no answer,
~40% failed (typical for cold leads).

Files: `/api/ag2020/_autodial-lib.js`, `autodial.js`, `autodial-twiml.js`,
`autodial-status.js`, `autodial-cron.js`. Env: `AG2020_AUTODIAL_TWILIO_ACCOUNT_SID`,
`AG2020_AUTODIAL_TWILIO_AUTH_TOKEN`, `AG2020_AUTODIAL_FROM_NUMBER`,
`AG2020_AUTODIAL_BRIDGE_CALLER_ID`, `AG2020_REP_INBOUND_NUMBER`,
`AG2020_AUTODIAL_TAGS`, `AG2020_AUTODIAL_SECRET`.

### Key API Endpoints (all under `/api/ag2020/`)
| Endpoint | Purpose |
|---|---|
| `halo-lift` | Pearson/OLS/Welch's t + multi-regression with trend+seasonality controls |
| `attribution-summary` | Windowed revenue by source for Attribution tab |
| `leads` | AC contacts breakdown (summary/daily/tags/lists/recent) — tags & lists read from journey table (AC pagination would timeout) |
| `calls` | Merged Vonage data from `ag2020_call_logs` + `ag2020_lead_touchpoints` |
| `followups` | Missed-call follow-up timeline (UNION of legacy SMS pipeline + autodial pipeline) |
| `users/invite` | Admin invites a user (Supabase admin invite → Gmail fallback if trigger fails) |
| `users/delete` | Admin removes a user (deletes ag2020_users + auth.users) |
| `glassbiller-email-ingest` | Receives daily GB report via webhook, parses XLSX, upserts jobs, links, rolls up |
| `sms-ingest` | Inbound SMS from Twilio Studio Flows |
| `journey-ingest` | AC contact_tag_added webhook |
| `cron-ad-spend-daily` | Daily Google + Meta spend ingest (accepts `?start=&end=` for backfill) |
| `autodial` | Speed-to-lead trigger (form-submit / missed-call) |
| `cash-infusions` | Owner cash-infusion tracking |
| `rebates` | Outstanding rebate AR |

Cron from `vercel.json`: `/api/ag2020/autodial-cron` (every 15min, drains
business-hours-deferred attempts), `/api/ag2020/cron-ad-spend-daily` (daily 8a UTC).

### Investor Pitch Deck (`/decks/ag2020-investor/`)
23-slide HTML deck + PDF export. Mobile-responsive at <700px (slides stack
vertically, type scales). Structure:
- **Vendor framing**: Kenny is independent technology vendor (TechCo), NOT a
  co-founder. NO joint legal liability with Cash. License agreement +
  ongoing royalty + optional minority equity sale.
- **Cash + Investor own OpsCo**: Cash 25-30% operator equity + W-2 role,
  investor 55-65% control stake.
- **The ask**: $4-5M growth raise (acquisitions + working capital + marketing
  acceleration + $500-750K tech vendor fee). Bankruptcy is OpsCo's obligation
  to service from operating cash flow, NOT part of the raise. Optional
  accelerator (+$1.2-1.5M) for clean balance sheet.
- **Returns**: 3-5× MOIC over 4 years (base/target/upside scenarios).
- **Kenny's payout**: $500-750K upfront (guaranteed) + $96K-450K/yr royalty
  scaling with system + ~$5-12M TechCo exit value. Independent of Cash's
  performance.
- **Slide 22**: CalibrateNet ($5M seed @ $20M post) framed as optional adjacent
  investment opportunity. ADAS calibration network, Kenny owns the IP.

Stance is locked at [[ag2020-investor-deck-stance]] — don't backslide into
co-founder framing in any revision.

### Source File Structure (all source gitignored, only build output deploys)
```
/clients/ag2020/
├── src/
│   ├── app/page.tsx                 # Main dashboard SPA (Next.js 14 static)
│   ├── lib/auth.ts                  # Supabase client + TAB_CATALOG + resolveAllowedTabs
│   ├── lib/data.ts                  # Embedded financial data (revenue, overhead, payroll, debt)
│   ├── lib/bankTransactions.ts      # Bank statement transaction data
│   ├── lib/bankruptcyData.ts        # Bankruptcy analysis data
│   ├── components/auth/AuthGate.tsx # useAuth() context wrapper
│   ├── components/tabs/
│   │   ├── DashboardTab.tsx         # Wins-showcase landing
│   │   ├── PerformanceTab.tsx       # Google + Meta ROAS (halo-adjusted)
│   │   ├── AttributionTab.tsx       # HaloLiftCard + revenue-by-source
│   │   ├── HaloLiftCard.tsx         # Halo-lift hero (deseasonalized stats)
│   │   ├── LeadsCallsTab.tsx        # AC leads + Vonage calls + followups
│   │   ├── CallTriageTab.tsx        # Call queue
│   │   ├── RebatesTab.tsx           # Rebate AR
│   │   └── AdminTab.tsx             # User management (admin-only)
├── public/login.html                # New login page (password + magic-link tabs)
├── public/auth-check.js             # Supabase session check for static pages
├── supabase/ag2020_users.sql        # User table + RLS + is_ag2020_admin()
├── supabase/grant-cash-admin.sql    # Post-signup admin grant for Cash
├── scripts/                         # Local CLI scripts (all gitignored)
│   ├── seed-admins.js               # Create initial admin users
│   ├── ingest-glassbiller-xlsx.js   # Manual XLSX ingest (CLI version of webhook)
│   ├── backfill-meta-source-from-ac.js   # AC tag → journey source backfill
│   ├── backfill-unknown-source-via-ac-phone.js
│   ├── backfill-ad-spend-historical.js   # Historical Google + Meta spend
│   ├── compute-halo-lift.js              # Local halo-lift compute (matches API)
│   ├── compute-halo-lift-controlled.js   # Multi-regression with controls
│   ├── link-jobs-clientside.js           # Bulk job-journey linker
│   └── diagnose-unknown-bucket.js        # Diagnose unclassified journeys
├── scripts/post-build.js            # Injects Supabase auth into static HTML
├── data/                            # Source files (CSVs, PDFs — gitignored)
├── package.json                     # next, react, recharts, xlsx, @supabase/supabase-js
└── next.config.js                   # basePath: '/clients/ag2020'

# Built output (committed + deployed):
├── index.html, login.html, auth-check.js, password.html, cashflow.html
├── court-presentation.html, 404.html, _next/, logo.webp
```

### Rebuild + Deploy
```bash
cd /Users/kennyhyder/Desktop/hyder-media/clients/ag2020
npm install   # (only if package.json changed)
npm run build # next build + post-build (auth injection)
# Then: git add the build output + push. Vercel auto-deploys.
```

The post-build script reads from `out/` and writes to the parent
`clients/ag2020/` directory. Source `src/` is gitignored; only the build
output ships.

**Important env vars** (all in Vercel):
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` (currently stale —
regenerate from Supabase Settings → API),
`AG2020_AUTODIAL_SECRET`, `AG2020_ACTIVECAMPAIGN_URL`,
`AG2020_ACTIVECAMPAIGN_KEY`, `AG2020_TWILIO_ACCOUNT_SID`,
`AG2020_TWILIO_AUTH_TOKEN`, `AG2020_TWILIO_FROM_NUMBER`,
`AG2020_AC_MISSED_CALL_TAG_ID`, `GOOGLE_ADS_*`, `META_APP_ID`, `META_APP_SECRET`,
`EMAIL_USER`, `EMAIL_PASS` (Gmail SMTP), `AG2020_HALO_PER_DOLLAR` (optional override; default $2.81).

### Shared-project auth.users triggers (CRITICAL)
The shared Supabase project has triggers on `auth.users` from AutomateDojo
(`9dm_handle_new_user`) and SportsBookISH (`sb_handle_new_user`) that
auto-insert rows into product-specific tables. Without scoping, every signup
fired every trigger, breaking AG2020 signups when those inserts failed.

**Fixed by**: both triggers now check `raw_user_meta_data->>'product'` and
skip if it doesn't match their product (or null for back-compat). AG2020
signup flow passes `data: { product: 'ag2020' }` so triggers skip cleanly.

When adding new products to this shared Supabase project, do the same:
- Login flow passes `data: { product: '<name>' }`
- If you add a new `auth.users` trigger, gate it on
  `raw_user_meta_data->>'product' = '<name>'`

### Original Deployment
The old `auto-glass-cash-flow` repo's Vercel deployment remains as a backup
URL. This work supersedes it but doesn't touch it.

---

## Configuration Files

### Environment Variables
**Local (`.env.local`):**
```
EMAIL_USER=kenny@hyder.me
EMAIL_PASS=[app password]
ADMIN_EMAIL=kenny@hyder.me
```

**Vercel:**
- GOOGLE_ADS_CLIENT_ID
- GOOGLE_ADS_CLIENT_SECRET
- GOOGLE_ADS_DEVELOPER_TOKEN
- GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC: 673-698-8718)
- SUPABASE_URL
- SUPABASE_SERVICE_KEY

### `vercel.json`
Function timeout configurations:
| Function | Timeout |
|----------|---------|
| `api/contact.js` | 10s |
| `api/google-ads/auth.js` | 10s |
| `api/google-ads/callback.js` | 30s |
| `api/google-ads/accounts.js` | 30s |
| `api/google-ads/campaigns.js` | 30s |
| `api/google-ads/debug.js` | 30s |
| `api/google-ads/sync.js` | 60s |
| `api/google-ads/keywords.js` | 60s |
| `api/google-ads/ag2020-spend.js` | 60s |

**Note:** Omicron endpoints (omicron-data, omicron-monthly, omicron-conversions) and debug endpoints (debug-omicron, debug-bur-top10) are NOT in vercel.json - they use the default 10s timeout.

## Technology Stack
- **Frontend:** HTML5, CSS3, Bootstrap 5, Tailwind CSS (tokens, ag2020)
- **Framework:** Next.js 14 (tokens, ag2020 static exports)
- **Backend:** Vercel Serverless Functions (Node.js, ES modules)
- **Database:** Supabase (PostgreSQL) - project: ilbovwnhrowvxjdkvrln.supabase.co
- **Auth:** Supabase Auth (main client portal), sessionStorage (all client dashboards)
- **APIs:** Google Ads API v23, Google OAuth 2.0, Google Keyword Planner
- **Email:** Nodemailer (Gmail)
- **Charts:** Recharts (ag2020), Chart.js (referenced in some pages)

### Root Dependencies (`package.json`)
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "nodemailer": "^6.9.7"
  },
  "devDependencies": {
    "dotenv": "^17.2.3",
    "xlsx": "^0.18.5"
  }
}
```

## Git Workflow
- Main branch: `main`
- **Deploys automatically to Vercel on push to GitHub** - DO NOT use `vercel --prod` from local
- GitHub repo: `kennyhyder/hyder-media`

### Deployment Process
1. Make changes locally
2. `git add <files>` - stage changes
3. `git commit -m "message"` - commit
4. `git push origin main` - push to GitHub
5. Vercel auto-deploys from GitHub (no manual steps needed)

**If production doesn't update after push:**
- Check Vercel dashboard for deployment status
- May need to manually alias: `vercel alias <deployment-url> hyder.me`

### iCloud File Eviction Issue

**Problem:** Desktop folder syncs to iCloud Drive. Large files (like keywords-combined.json) get "evicted" - replaced with `.icloud` placeholder files when iCloud needs space.

**Solution:**
- Git is the source of truth - all data files are committed
- Deploy from GitHub (auto-deploy), not local machine
- If local files are evicted, restore from git:
  ```bash
  git checkout HEAD -- clients/digistore24/data/keywords-combined.json
  ```
- Or force iCloud to download: `brctl download <file>`

**Never rely on local copies of data files persisting!**

## Commands Reference
```bash
# Local development
npm install
vercel dev

# Regenerate keyword data from Excel sources
node scripts/import-digistore-keywords.js

# Fetch Google Keyword Planner data (incremental, batch size 15)
node scripts/fetch-google-keywords.js

# Rebuild AG2020 dashboard after source changes
cd clients/ag2020 && npm install && npm run build

# Restore evicted iCloud files from git
git checkout HEAD -- <file-path>

# Force iCloud to download evicted file
brctl download <file-path>

# Deploy (just push to GitHub - auto-deploys)
git push origin main

# If needed, manually alias deployment
vercel alias <deployment-url> hyder.me
```

## Important Notes
1. **Don't modify root files** without explicit request - they're the live hyder.me site
2. **Supabase project:** ilbovwnhrowvxjdkvrln.supabase.co
3. **Google Ads MCC:** 673-698-8718
4. **Developer Token:** Basic Access approved
5. **Google Ads API version:** v23 (all endpoints use `/v23/`)
6. **Digistore24 password:** TR8FFIC (sessionStorage-based auth)
7. **Omicron password:** LIEHAO (sessionStorage-based auth)
8. **AG2020 password:** AG2020FLOW (sessionStorage-based auth)
9. **Google Cloud Project #:** 132234777258
10. **Vercel plan:** Pro (team: kennys-projects-93847471)

### Supabase Database Tables
The schema (`/api/google-ads/schema.sql`) defines 11 tables:
- `google_ads_connections` - OAuth tokens and connection info
- `google_ads_customers` - Customer account metadata
- `google_ads_campaigns` - Campaign data with metrics
- `google_ads_ad_groups` - Ad group data with metrics
- `google_ads_keywords` - Keyword data with quality scores
- `google_ads_search_terms` - Search term reports
- `google_ads_sync_log` - Sync operation tracking
- Additional AG2020-specific tables (`/api/ag2020/schema.sql`)

---

## Reusable Patterns Library

Patterns and gotchas worth pulling into any new project in this monorepo. Cross-references to the relevant source files + memory notes.

### Vercel serverless + ESM
- **Vercel auto-compiles `api/**/*.js` ESM → CJS** when `package.json` lacks `"type": "module"` (deploy log shows: `Compiling "X.js" from ESM to CommonJS`). Constructs that don't survive: `import.meta.url`, top-level `await`, dynamic ESM-only imports.
  - Symptom: `FUNCTION_INVOCATION_FAILED` with no JSON body. Vercel `logs` won't show the underlying error.
  - Fix: avoid `import.meta.url`; either embed file contents inline or hardcode paths. See `api/data/sync-huggingface.js` for a worked example (README upload removed after this bit us in May 2026).
- **All `api/**/*.js` should be self-contained for serverless cold start.** Don't import from `../lib/` outside `api/`.
- **CRON_SECRET pattern**: every cron handler accepts `Authorization: Bearer ${CRON_SECRET}`. Test locally with `curl -H "Authorization: Bearer $(grep ^CRON_SECRET= .env.local | cut -d= -f2)" https://hyder.me/api/...`.

### Supabase + Postgres performance
- **Pooler ports matter for index ops.** Port `6543` (transaction mode) wraps everything in a transaction, so `CREATE INDEX CONCURRENTLY` fails with "cannot run inside a transaction block". Use port `5432` (session mode) for DDL. Region = `us-west-2`, not us-west-1.
- **High-volume tables: avoid `count('exact')`.** Past ~1M rows the count query times out (>10s) under serverless 10s limit, returns null, coalesces to 0, fires false alerts. Switch to latest-row recency check: `select fetched_at order by fetched_at desc limit 1` (O(1) with a `fetched_at DESC` index). See `api/seo/cron-health-check.js` for pattern.
- **Add a `fetched_at DESC` index on any quote/log table** that grows by >100k rows/day. Without it, even "find latest row" is a seq scan.
- **Service-role key naming**: in `api/*.js` serverless functions use `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. The `NEXT_PUBLIC_*` prefix is only for client-side Next.js bundles — won't be available server-side in API routes.

### Stripe gotchas
- **`echo` adds trailing newlines** when piped to `vercel env add`. The `\n` ends up baked into `STRIPE_SECRET_KEY`, the SDK puts it into the Authorization header, request never reaches Stripe, error reads as "connection error, retried 2 times" (sounds network — is local). Always `.trim()` defensively when reading Stripe env vars; use `printf %s` not `echo` to set them. Documented in [[stripe-env-trailing-newline]].
- **Customer Portal CSP**: `form-action` must include `https://billing.stripe.com`. Browsers check `form-action` against the final redirect destination, not just the immediate POST target.
- **Stripe v22 moved subscription period dates** to `subscription.items[0]` (was on `subscription` directly). Webhook handlers need `periodOf(sub)` helpers.
- **Webhook race with checkout success URL**: pass tier as a URL param to `success_url` rather than waiting for the webhook to update DB, so `purchase` GA4 events have correct value instantly.

### SEO + freshness ("quality deserves freshness")
- Reusable `<LastUpdated iso={...} variant="header|inline|footer" />` component lives in `sportsbookish/components/LastUpdated.tsx`. Renders `<time datetime="...">` + relative time ("3 min ago"). Helper `datasetFreshnessLd()` emits `Dataset` JSON-LD with `dateModified`.
- Apply across all page surfaces that change (event detail, league hub, player profile, team profile, leaderboards, movers, etc). For tournament/event lists: sort `next event first chronologically` (open events ASC, closed DESC).
- Pages with `export const dynamic = "force-dynamic"` can honestly use render time as the freshness signal — Vercel cron + dynamic rendering means "now" is genuinely fresh.

### GA4 conversion events
- **Don't trust `window.gtag` from useEffect** — it's race-y with `@next/third-parties/google`. Push to `window.dataLayer` directly:
  ```js
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "purchase", value: 19, currency: "USD" });
  ```
- For SaaS funnels track: `sign_up` (post-magic-link), `begin_checkout` (Stripe checkout creation), `purchase` (success_url landing with tier param).

### AI / LLM discoverability
- Standard package per site: `llms.txt`, `JSON-LD WebApplication`, `JSON-LD Dataset` with `dateModified`, `OpenAPI spec` at `/api/openapi.json`, `Hugging Face dataset mirror` (cron pushes daily CSV — see `api/data/sync-huggingface.js`), IndexNow ping on publish, Wikidata entity with P-claims.
- HF push via `@huggingface/hub` `uploadFiles({ repo: { type: "dataset", name: "..." }, accessToken: process.env.HF_TOKEN, files: [...] })`. Don't bundle README in the cron — push schema docs manually.
- Wikidata entity edits via MediaWiki API (`wbeditentity`, `wbcreateclaim`) with bot password. New accounts can't create new batches in QuickStatements — use direct API or run via Firefox (third-party cookie issue in Chrome).

### Sportsbook futures data vendor gap
- The Odds API ($30/mo) only exposes ~14 futures `sport_key`s (championship/winner). MVP, win-totals, awards, division winners are NOT in the feed at any tier. Books DO publish these prices on their own sites; **don't claim books "don't publish"** in user copy.
- `NoBooksDataNote` component pattern (in `sportsbookish/components/sports/`): for missing market types, render a tier-aware CTA — non-Elite → `/pricing` upsell, Elite → `mailto:` to capture demand signals. See [[sportsbookish-futures-data-vendor]].

### Health-check pattern (any project)
- Daily cron pings: sitemap reachability + URL count, HF dataset `lastModified` age, latest-quote recency per table, slug coverage %.
- Use Resend `alerts@<domain>` for email when checks fail. Only alert when something is meaningfully broken — false alarms erode trust.
- See `api/seo/cron-health-check.js` for the full pattern.

### Pre-deploy verification (sportsbookish has this baked into CLAUDE.md)
- TypeScript: `npx tsc --noEmit`
- Build: `npm run build`
- Post-deploy security headers, W3C validation, WAVE accessibility
- See `sportsbookish/CLAUDE.md` for full curl commands

### Speed-to-lead autodialer (outbound auto-callback + bridge)
- **What:** Trigger fires → Twilio calls the **customer** → on answer, bridges them to a sales rep line. Source-agnostic engine — same code handles CRM form-submit webhooks, missed-call webhooks, manual triggers. Reference implementation: `clients/ag2020/CLAUDE.md` + `/api/ag2020/_autodial-lib.js` + 4 sibling `autodial-*.js`. Live since 2026-05-22 for forms + voicemail-leaver missed calls.
- **File pattern (per client, ~600 LOC total) in `/api/<client>/`:**
  - `_autodial-lib.js` — shared: phone normalize, HMAC callback tokens, business-hours math, `placeCall()`. Underscore-prefixed so Vercel doesn't route it.
  - `autodial.js` — `POST` trigger receiver + `GET` recent attempts. Source-aware gating, 6h dedupe, business-hours deferral, row insert, calls lib `placeCall`.
  - `autodial-twiml.js` — TwiML returned to Twilio on customer answer. AMD voicemail guard; on human → hold message + `<Dial>` bridge with rep whisper TwiML.
  - `autodial-status.js` — Twilio StatusCallback (customer leg) + `<Dial>` action callback (bridge leg). Updates the attempt row.
  - `autodial-cron.js` — Vercel `*/15` cron that drains `deferred` (off-hours) attempts when the business reopens.
- **Table `<client>_autodial_attempts`** — one row per attempt with full `trigger_payload` JSONB for audit. Status state machine: `deferred → dialing → (customer_answered | machine | no_answer | failed) → (bridged →) completed | rep_no_answer`, plus `skipped_duplicate` and `skipped_form`. Indexes: `(created_at DESC)`, `(customer_number, created_at DESC)`, partial `(dial_after) WHERE status='deferred'`.
- **ActiveCampaign trigger gotchas (the AG2020 build hit all of these):**
  - `subscribe` is **not** a reliable form-submit trigger — only fires when the form subscribes contacts to a list. Many integrations don't.
  - `contact_add` is **NOT** a valid AC event name — `GET /api/3/webhook/events` returns the canonical list (~42 events). Don't trust intuition; check.
  - The reliable form-submit signal is usually a unifying "new lead" tag + `contact_tag_added` event, filtered by tag id/name. AG2020's tag is `NEW LEAD ALERT` (id 2487).
  - **AC API cannot create automations** (UI-only), but it CAN create account-level webhooks (`POST /api/3/webhooks` with `events`, `sources`, `url`).
  - AC webhook payloads have varied shapes — handle scalar `tag` vs `tag[id]`/`tag[name]` vs nested `tag.id`/`tag.name`. Defensive extraction.
- **Fail-closed gating** on CRM webhooks: log the full payload to a `skipped_*` row and do NOT dial when the trigger can't be tied to an allowlist entry. Otherwise the first novel payload shape silently autodials everyone in the CRM.
- **Dedupe gotcha (production-breaking if missed):** dedupe must exclude `failed`, `skipped_duplicate`, AND `skipped_form` (every `skipped_*` status). A skipped row is not a dial. A non-trigger tag webhook lands as `skipped_form` and would otherwise block the real trigger tag webhook that fires moments later. See AG2020 commit `97999f2f`.
- **Twilio call/bridge pattern:**
  - `MachineDetection=Enable` + check `AnsweredBy` in the TwiML — never bridge a rep to a voicemail recording.
  - `answerOnBridge="true"` on `<Dial>` so the customer hears ringback during rep ring, not dead air.
  - **Customer-facing From vs bridge `<Dial callerId>` MUST be different numbers.** Dialing the rep line showing the rep line's own number as caller ID (From == To) is pathological. Use an owned Twilio number for the bridge caller ID.
  - HMAC token on Twilio callback URLs (TwiML + StatusCallback) so they can't be replayed/forged externally.
- **"Callback from the number they dialed":** requires that number to be Twilio-usable — either owned in the account, or **verified as an outgoing caller ID** via `POST /Accounts/{SID}/OutgoingCallerIds.json` (Twilio places a verification call with a 6-digit `validation_code`; someone at the number enters it). Verified caller IDs get lower STIR/SHAKEN attestation than owned numbers (more spam-flag risk) — accept the tradeoff for recognition and pair with branded calling.
- **Branded calling:** Twilio's own Branded Calling **requires owned Twilio numbers** (verified caller IDs aren't eligible) and currently covers only T-Mobile + Verizon (US Public Beta, no AT&T). For verified-caller-ID setups, use **First Orion INFORM** — works with the existing number wherever it's hosted, all 4 major US carriers + iPhone+Android, free business-number registration tier (paid plans from $31/mo at 250 calls for logo + call reason).
- **Per-client env vars:** dedicated Twilio account creds (`*_AUTODIAL_TWILIO_ACCOUNT_SID/AUTH_TOKEN` — don't co-mingle with other clients' Twilio accounts); `*_AUTODIAL_FROM_NUMBER` (customer-facing); `*_AUTODIAL_BRIDGE_CALLER_ID` (owned, distinct); `*_REP_INBOUND_NUMBER`; trigger allowlist (`*_AUTODIAL_TAGS` for AC tag triggering); webhook `*_AUTODIAL_SECRET`. Use `printf %s` (not `echo`) when adding any of these via `vercel env add` — see Stripe gotcha above for why.
- **Business hours:** Mon–Sat 7am–6pm local (Arizona = fixed UTC-7, no DST math). Off-hours triggers insert `status=deferred` with `dial_after = nextBusinessOpen()`; the `*/15` cron picks them up at open.
- **Trigger sources (live at AG2020):** (1) form submits via AC `contact_tag_added` webhook → autodial; (2) missed calls via existing `call-event-webhook.js` (voicemail-to-email pipeline) → autodial; (3) Phase 2 = CallRail webhook for pure-hangup missed calls → autodial (no code change needed, engine is source-agnostic).

---

## The Playbook Product (May 2026 launch)

Vendor-agnostic SaaS launch playbook, productized after building SportsBookISH. Designed so it can be applied to ANY future client/project here.

### Three-tier model
1. **Free intro PDF (5pg)** — lead magnet. Email signup → drip series.
2. **$79 full bundle** — PDF + templates + Claude Code skill. Bundle ready as `downloads/playbook-bundle-v1.zip`. Awaiting Lemon Squeezy product creation.
3. **$2.5k-$5k DFY engagement** — Kenny implements the playbook for a client.

### Live assets
- **Landing page**: `https://hyder.me/playbook` (`playbook.html` in root). Full Bootstrap theme matching hyder.me, JSON-LD schemas (Product, FAQPage, BreadcrumbList), GA4 conversion events.
- **Free intro endpoint**: `POST /api/playbook-intro` — captures email, sends intro PDF via Gmail SMTP. Defensive `.trim()` on env reads (dogfoods §5.4 of the playbook itself).
- **Email drip series**: 5 emails in `docs/playbook/emails/` (intro → product → DFY pitch).
- **Bundle**: `downloads/playbook-bundle-v1.zip` — PDF + Notion templates + `.claude/agents/playbook.md` skill file.

### Pending manual work
- Lemon Squeezy product setup (2 placeholder URLs in `playbook.html` to replace once live)
- Verify drip series sender domain DNS

### Playbook topics covered (chapters)
1. Tier definition + Stripe products + webhooks
2. Supabase Auth (magic-link), tier guards, RLS
3. Cron-driven ingestion pipelines (Vercel)
4. SEO + freshness + AI discoverability stack
5. **Compliance baseline** (W3C, security headers, WAVE, robots, sitemap, OG, JSON-LD)
6. Conversion event tracking (GA4 dataLayer pattern)
7. Stripe Customer Portal + cancellation flows
8. Health-check cron + Resend alerts
9. Vercel deploy gotchas (ESM→CJS, env var trim, region pinning)
10. Cross-platform reporting (Google + Meta + others)
11. Wikidata + Hugging Face + IndexNow for AI discoverability

### When applying to a new project
- Start from `docs/playbook/templates/` (Stripe setup script, schema.sql skeleton, tier-guard.ts, LastUpdated component, cron-health-check.js, NoBooksDataNote-style upsell pattern)
- Compliance baseline: lives in `automatedojo/lib/compliance.ts` — apply to platform-deployed sites
- Stripe products: idempotent `scripts/setup-stripe-products.mjs` pattern works for ANY new SaaS

See memory: [[playbook-product]] for distribution status, [[sportsbookish]] for the source-of-truth implementation, [[sportsbookish-futures-data-vendor]] for the "Request data →" Elite upsell pattern.

---

## Recent Changes Log

### 2026-06-02 → 2026-06-03 (Golf-parity + platform bulletproofing — 5-stage sprint)
Multi-day audit triggered by "ALL OF GOLF IS BROKEN" incident. Five staged shipments, each verified live before moving on. Final commit: `dde2faff`.

- **Stage 1** (commit `ceaf9d2f`) — Golf `/api/golfodds/comparison.js` book-key bucketing. The `allBooks` set was tracking RAW quote keys (bovada, mybookie, lowvig, betonline, betus), each of which the UI's `bookLabel()` renders as "Other" — so the table grew 5 separate Other columns. Now tracks BUCKETED keys (regulated names + at most one "other"). Same bug class as the May `sports/events.js` fix.

- **Stage 2** (same commit) — `/api/seo/cron-data-freshness.js` ships. Every 15 min checks MAX(fetched_at) on 8 critical ingest tables (sports_quotes, sports_book_quotes, sports_polymarket_quotes, golfodds_kalshi_latest, golfodds_dg_latest, golfodds_book_latest, golfodds_polymarket_latest, sports_alerts). Alerts via Resend on 2nd consecutive stale. Schema: `sb_data_freshness_log`.

- **Stage 3** (commit `e223f286`) — Golf Polymarket pipeline (full parity with sports/*).
  - Schema: `golfodds_polymarket_quotes`, `golfodds_polymarket_latest` (trigger-maintained), `golfodds_polymarket_events_map`.
  - `/api/golfodds/cron-ingest-polymarket.js`, every 15 min, `tag_slug=golf` filter (NOT `tag=golf` — that param does NOT filter on Polymarket).
  - Reuses `_tournament_resolver.js` so sponsor-laden Polymarket titles ("PGA Tour: the Memorial Tournament presented by Workday Winner") route to canonical tournament rows.
  - `comparison.js` returns `polymarket` + `edge_vs_polymarket` per player.
  - `sportsbookish/components/OutrightTable.tsx` renders fuchsia-500 Poly column + "vs Poly" edge column.
  - Memorial Tournament 2026 verified live: 68/77 player markets ingested. Scheffler Kalshi 21.5% vs Poly 22.5%.

- **Stage 4** (commits `b3f741c5` + `a7dd2fe5`) — Extracted `/api/_platform/` with `odds.js`, `constants.js`, `names.js`. 3 copies of americanToDecimal and 5 copies of normalizeName collapsed to single source. Sports and golf had drifted; the audit caught the divergence pattern. Behavior-preserving (Scheffler edge identical pre/post). `sports/_books.js` + `sports/_lib.js` re-export shared symbols so existing callers don't change.

- **Stage 5** (commits `97fc9ef5` → `dde2faff`, 5 iterations) — `/api/seo/cron-coverage-check.js` ships. Hourly check that (1) every vercel.json `crons[].path` URL is reachable (not 404/5xx) and (2) every critical Postgres table exists. Caught a real bug on first run: `cron-data-freshness` was scheduled-but-not-committed in Stage 2's vercel.json (Edit succeeded locally but the change didn't make it into the git commit). Schedule re-added retroactively. Schema: `sb_coverage_log`. Iteration cycle: stat() didn't work (Vercel functions have isolated bundles), JSON-import of vercel.json works, URL probing of cron paths works.

**Net effect**: The hyder-media platform now runs three independent canaries that together catch every silent-failure class we've seen — route 4xx/5xx, ingest stalls, infrastructure drift. Golf has full Polymarket parity with sports. Pipeline divergence is largely fixed.

See memory: [[api-platform-shared-libs]], [[golf-polymarket-integration]], [[session-2026-06-02-platform-bulletproofing]].

### 2026-05-28 → 2026-05-29 (AutomateDojo enterprise-readiness sweep — 30 blocks)
Overnight session shipped Blocks 31-60: full B2B-SaaS trust + compliance + customer-success + sales-enablement stack on AutomateDojo. Detailed list in `automatedojo/CLAUDE.md` (Enterprise-readiness sweep section) and `automatedojo/CHANGELOG.md` (nights 1-7). Highlights:

- **Trust/compliance pages**: /sla, /price-lock, /subprocessors, /data-request (GDPR DSR), /how-we-sell, plus extended /security, /refund-policy. /llms.txt + /ai.txt for AI crawler discoverability.
- **Customer surfaces**: /client/<slug>/{cancel (retention flow), team (multi-user invites), api-tokens (read-only Bearer), integrations/webhooks (HMAC-signed outbound)}. <OnboardingChecklist> + <AnnualUpgradeCard> embedded.
- **Admin surfaces**: /admin/{customer-success, ab-experiments, nps, incidents, promo-codes, affiliates}.
- **Sales enablement**: /demo/sandbox (read-only fake dojo), /case-studies (programmatic from testimonials), /changelog.rss, public REST endpoint GET /api/v1/leads.
- **Migrations 040-052** applied to Supabase. **4 new crons** (stripe-reconcile nightly, dormant-reengagement weekly, nps-trigger daily, accrue-affiliate-commissions monthly).
- **First A/B experiment live**: `pricing_setup_fee_framing` (control vs monthly_first).
- **Reusable libs** (drop-in for SportsBookish / GolfOdds / etc): `lib/ab.ts`, `lib/api-tokens.ts`, `lib/customer-webhooks.ts`, `lib/affiliate-attribution.ts`, `lib/lead-abuse.ts`.

See memory: [[automatedojo-enterprise-readiness-may2026]] for operator summary, [[saas-enterprise-readiness-patterns]] for the cross-project pattern library.

### 2026-05-22 (SportsBookISH optimizations + Playbook product)
- **Futures markets expanded** (`api/sports/_books.js`): NCAAF + golf majors + Euro added to FUTURES_MARKETS. Fixed UCL sport_key (`soccer_uefa_champs_league` → `_winner`). `active: false` flag skips between-seasons silently; 404/INACTIVE_SPORT now skip gracefully.
- **NoBooksDataNote component** (`sportsbookish/components/sports/NoBooksDataNote.tsx`): shared by EventView + ContestantView. Non-Elite users see `→ /pricing` upsell; Elite users see `mailto:kenny@hyder.me` with subject pre-filled per market type. Captures demand signal for vendor-upgrade prioritization.
- **Health check rewrite** (`api/seo/cron-health-check.js`): switched `sports_quotes` recency from `count('exact')` (timeout on 11M-row table) to latest-row recency check. Added `idx_sports_quotes_fetched_at` + `idx_sports_book_quotes_fetched_at` Postgres indexes via session-mode pooler.
- **HuggingFace sync fixed** (`api/data/sync-huggingface.js`): removed `import.meta.url` README read that broke during Vercel's ESM→CJS compilation. Daily cron now only pushes CSV.
- **GA4 conversion events** wired up: `sign_up`, `begin_checkout`, `purchase` events fire via `window.dataLayer.push()` (not `gtag()` which races). Tier passed in Stripe `success_url` so `purchase` value is accurate even before webhook lands.
- **Stripe Customer Portal fix**: CSP `form-action` updated to include `https://billing.stripe.com` (browser checks against final redirect target, not just immediate POST target).
- **Stripe env var defensive trim**: all `STRIPE_*` env reads `.trim()`'d to defend against trailing-newline corruption from `echo`-based `vercel env add`.
- **LastUpdated freshness signal**: reusable component applied across 18 page surfaces — event detail, league hub, players/teams indexes, movers, golf tournaments, ladder/matchups/props pages. Emits `<time datetime>` + Dataset JSON-LD with `dateModified`.
- **Chronological sort**: player/athlete profiles now show next-event-first (e.g. Tom Kim's page shows this-week's CJ Cup before the future US Open).
- **Polymarket overlay** added to team/player pages alongside Kalshi + sportsbook lines (dust-filtered, no display if no Polymarket data).
- **Wikidata Q139814938** cleaned up via bot password API (`Kennyhyder@claude-q139814938`): logo uploaded to Commons, P-claims fixed, multilingual labels, bad claim marked deprecated with P2241 qualifier.
- **AI discoverability pass**: `llms.txt`, JSON-LD WebApplication, OpenAPI spec at `/api/openapi.json`, Hugging Face dataset `kennyhyder/sportsbookish-daily-odds`, GitHub docs repo, IndexNow weekly sweep.
- **The Playbook product** (`/playbook`): packaged the above as a vendor-agnostic launch playbook — free intro PDF + $79 bundle + DFY consulting tier. Email-signup endpoint `/api/playbook-intro`, 5-email drip in `docs/playbook/emails/`, bundle ZIP at `downloads/playbook-bundle-v1.zip`. Pending Lemon Squeezy product creation.

### 2026-02-05 (Auto Glass 2020 - Court Presentation)
- **Added court presentation document** (`court-presentation.html`) - standalone password-protected page
- Added Recovery Case scenario showing feasibility with owner return
- Added $50K unsecured creditor distribution at end of 2027
- Complete debt repayment plan with creditor list
- Cash infusions feature and comprehensive bankruptcy analysis tab
- Historical performance tab with year selector and drill-down charts
- Deep links preserved after password authentication

### 2026-02-04 (Auto Glass 2020 Dashboard)
- **Migrated from standalone deployment** - Moved from `auto-glass-cash-flow` repo to `hyder-media/clients/ag2020`
- Created password-protected financial dashboard with sessionStorage auth
- Configured Next.js static export with `basePath: '/clients/ag2020'`
- Created post-build script to inject auth check into generated HTML
- Source files gitignored; only built output deployed
- Original deployment at `auto-glass-cash-flow` repo remains as backup

### 2026-02-04 (Omicron Dashboard)
- **Fixed BUR non-brand data** - Non-brand patterns now take priority over brand patterns
- **Fixed Top10usenet display** - Account key now matches API response (`top10usenet` not `top10`)
- **Added linkable tabs** - Dashboard tabs now support URL hash (e.g., `dashboard.html#accounts`)
- Documented brand vs non-brand classification logic
- Added API endpoint documentation to CLAUDE.md

### 2026-02-04 (Digistore24 Keywords)
- **Fixed brand/topic grouping** - Keywords containing brand names now only appear in brand groups, not topic groups
- Expanded brand recognition to 28 brands (added CJ, Rakuten, PartnerStack, Shopify, Kajabi, etc.)
- **Restored Google Keyword Planner data** - 26,116 keywords now have volume/CPC/competition data
- Created `fetch-google-keywords.js` script for batch API requests (batch size 15, 1.5s delay)
- Fixed deployment workflow - now deploys from GitHub auto-deploy, not local `vercel --prod`
- Documented iCloud file eviction issue and recovery process
- Updated keyword-tool.html with dropdown details showing brands_bidding per group

### 2026-02-03
- **Omicron Dashboard:** Migrated project from ~/Desktop/omicron to /clients/omicron
- Created password-protected multi-account Google Ads dashboard
- Added summary.html with account structure and API status checking
- Added dashboard.html with multi-account comparison, charts, and filters
- Updated callback.js to recursively fetch MCC child accounts
- Created shared styles.css based on Digistore24 design system

### 2026-02-03 (earlier)
- Added password protection to Digistore24 competitive intel suite
- Created `password.html` entry point with sessionStorage auth
- Created `competitive-intel-summary.html` overview page
- Added Hyder Media icon logo to all tool page headers
- Made landing page overview section dynamic per competitor
- Included SamCart in default brand selection (data normalized)
- Fixed redirect paths to use absolute URLs

### Previous
- Built keyword tool with 31K keyword pivot table
- Added Google Keyword Planner data integration
- Created competitor ads and landing page analysis tools
- Implemented projection calculator

---

## Troubleshooting Guide

### Keywords-combined.json 404 on production
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

### Local files missing (iCloud eviction)
1. Don't panic - git has the data
2. Restore: `git checkout HEAD -- <file-path>`
3. Or force iCloud download: `brctl download <file>`
4. Always deploy from GitHub, not local

## Pre-deploy checklist (run before every push)

Before pushing changes that touch UI / routes / nav / data layer, run:

```bash
# 1. TypeScript
npx tsc --noEmit

# 2. Build
npm run build

# 3. Security headers (post-deploy, against live URL)
curl -sI https://sportsbookish.com | grep -iE "^(strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy):"

# 4. W3C validation (post-deploy)
curl -s https://sportsbookish.com | curl -s --data-binary @- -H "Content-Type: text/html" "https://validator.w3.org/nu/?out=json" | python3 -c "import sys,json;r=json.load(sys.stdin);print(f'errors: {len([m for m in r[\"messages\"] if m[\"type\"]==\"error\"])}, warnings: {len([m for m in r[\"messages\"] if m.get(\"subType\")==\"warning\"])}')"

# 5. WAVE accessibility (manual: load page in https://wave.webaim.org/extension/ or use https://wave.webaim.org/api/request)

# 6. Smoke-test core flows in incognito + signed-in:
#    - / (homepage)
#    - /sports/mlb (or any in-season league)
#    - /sports/mlb/event/<id> (any active game)
#    - /alerts (Pro+ only)
#    - /bets (Elite only)
#    - /admin (admin only)
#    - Pricing checkout (don't actually pay — load /pricing and click Subscribe)
```

Targets:
- Security headers: 100/100 (HSTS preload, full CSP, COOP/CORP, Permissions-Policy)
- W3C: 0 errors, 0 warnings (info-only "trailing slash on void element" notes are OK)
- WAVE: 0 errors, ≤2 alerts max
- Build: clean compile, no new console errors in dev
- Smoke tests: no broken routes, no missing data on event pages with active markets

Any regressions on these → revert or patch BEFORE merging.

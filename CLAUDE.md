# Hyder Media Project Context

## Project Overview
This repository contains multiple interconnected projects for Kenny Hyder's digital marketing consultancy at hyder.me.

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

## Auto Glass 2020 Financial Dashboard

**Location:** `/clients/ag2020/`
**URL:** https://hyder.me/clients/ag2020
**Status:** Active

### Authentication Flow
1. User visits `/clients/ag2020/` → redirects to `password.html`
2. User enters password "AG2020FLOW"
3. sessionStorage stores `ag2020_dashboard_auth = 'authenticated'`
4. Redirects to `index.html` (main dashboard)

**Auth implementation:**
```javascript
// Injected into index.html <head> during build:
<script>
(function() {
    const AUTH_KEY = 'ag2020_dashboard_auth';
    if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
        window.location.href = 'password.html';
    }
})();
</script>
```

### Technology Stack
- **Framework:** Next.js 14.1.0 with static export
- **UI:** React 18, Tailwind CSS, Recharts (^3.7.0) for charts
- **Language:** TypeScript
- **Data:** All data embedded in TypeScript files (no live API)
- **Additional deps:** xlsx (^0.18.5) for Excel processing

### Pages
| Page | File | Purpose |
|------|------|---------|
| **Dashboard** | `index.html` | Main multi-tab financial dashboard |
| **Password** | `password.html` | Password gate |
| **Court Presentation** | `court-presentation.html` | Standalone court document (password-protected, preserves deep links) |
| **Cashflow** | `cashflow.html` | Legacy cashflow view |
| **404** | `404.html` | 404 page (auth-protected) |

### Tab Navigation (7+ tabs)
All tabs use hash-based routing:

| Tab | Hash | Purpose |
|-----|------|---------|
| Dashboard | `#dashboard` | Overview metrics, revenue, gross margin |
| Overhead | `#overhead` | Fixed and variable expenses |
| Payroll | `#payroll` | Employee wages and costs |
| Debt | `#debt` | Outstanding debts and payments |
| Forecast | `#forecast` | Revenue and expense projections |
| 2025 Performance | `#2025-performance` | Year-to-date performance metrics |
| Bank Statements | `#bank-statements` | Transaction history and categorization |

### Source Data Files
```
/clients/ag2020/src/lib/
├── data.ts              # Revenue, overhead, payroll, debt data
├── bankTransactions.ts  # Bank statement transaction data
├── bankruptcyData.ts    # Bankruptcy analysis data (creditors, recovery scenarios)
└── utils.ts             # Shared formatting utilities
```

### Data Directory
`/clients/ag2020/data/` contains source files (bank statements, margin reports, legal docs):
- Cash App statements (March-November 2025)
- Bank eStatements (April, July, September 2025)
- Factor payment records (7 PDFs)
- Margin reports (CSV + JSON)
- Historical performance data (JSON)
- Google Ads spend data (JSON, Nov 2020 - Jan 2026)
- `legal/` - Amended Plan exhibits (A-E), court filings, 5-year budget proforma

### Build Process
The dashboard is built as a Next.js static export:

```bash
cd /Users/kennyhyder/Desktop/hyder-media/clients/ag2020
npm install
npm run build  # Runs next build && post-build script
```

**Build output:** Files are placed directly in `clients/ag2020/`:
- `index.html` - Main dashboard (auth check injected)
- `password.html` - Password entry page
- `_next/` - Static assets (JS, CSS chunks)
- `logo.webp` - Auto Glass 2020 logo

### File Structure
```
/clients/ag2020/
├── index.html              # Built dashboard (auth-protected)
├── password.html           # Password protection gate
├── court-presentation.html # Standalone court document (auth-protected)
├── cashflow.html           # Legacy cashflow view
├── logo.webp               # Company logo
├── _next/                  # Next.js static assets
│   └── static/
│       ├── css/            # Compiled Tailwind CSS
│       └── chunks/         # JavaScript bundles
├── 404.html                # 404 page (auth-protected)
├── data/                   # Source data files (bank statements, margins, legal)
│   ├── legal/              # Court filings, amended plan exhibits
│   ├── *.pdf               # Bank statements, factor payments
│   ├── *.csv               # Margin reports
│   └── *.json              # Historical performance, Google Ads spend
├── .gitignore              # Excludes source files
│
│ # Source files (gitignored, kept for rebuilds):
├── src/
│   ├── app/
│   │   ├── page.tsx        # Main dashboard component
│   │   └── layout.tsx      # App layout
│   └── lib/
│       ├── data.ts         # Revenue, overhead, payroll, debt data
│       ├── bankTransactions.ts  # Bank statement data
│       ├── bankruptcyData.ts    # Bankruptcy analysis data
│       └── utils.ts        # Formatting utilities
├── scripts/post-build.js   # Auth injection script
├── package.json            # Dependencies (next, react, recharts, xlsx)
├── next.config.js          # Static export config (basePath: '/clients/ag2020')
├── tailwind.config.js      # Tailwind configuration
└── tsconfig.json           # TypeScript configuration
```

### Rebuilding
To rebuild after source changes:

```bash
cd /Users/kennyhyder/Desktop/hyder-media/clients/ag2020
npm run build
```

The build process:
1. Runs `next build` to generate static files in `out/`
2. Runs `scripts/post-build.js` to inject auth check into HTML files
3. Output files are copied to `ag2020/` root (replaces previous build)

**Note:** Source files are gitignored. Only the built output is deployed.

### Original Deployment
The original `auto-glass-cash-flow` deployment remains active at its Vercel URL as a backup. This migration does not modify that repository.

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

## Recent Changes Log

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

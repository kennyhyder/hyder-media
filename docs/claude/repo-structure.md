# Repo Structure & Config Reference (hyder-media)

Detailed directory/tech/config reference moved out of root CLAUDE.md (2026-07). Root file keeps the top-level map + essentials only.

## Root (`/`)
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
- `CLAUDE.md` - Project context file
- `AGENTS.md` - Agent workflow instructions (bd/beads issue tracking)
- `FOLLOWUP-NOTES.md` - Google Ads API investigation notes

## `/api` - Serverless Backend
Vercel serverless functions (Node.js).

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
- Omicron dashboard APIs: `omicron-data.js`, `omicron-monthly.js`, `omicron-conversions.js` (see `clients/omicron/CLAUDE.md`)
- `ag2020-spend.js` - AG2020 Google Ads historical spend data

**AG2020 APIs:** `/api/ag2020/` — see `clients/ag2020/CLAUDE.md`. Includes `cash-infusions.js` (cash infusion tracking) + `schema.sql` (AG2020-specific database schema).

**Digistore24 API:** `/api/digistore/` — see `clients/digistore24/CLAUDE.md` (`keywords.js` keyword data endpoint + reporting endpoints).

**Cross-pipeline shared libs:** `/api/_platform/` — see `docs/claude/patterns-library.md`.

**Three-canary observability:** `/api/seo/` — summary in root CLAUDE.md.

**Historical issue (Jan 2026):** Google Ads API returned 501 UNIMPLEMENTED — blocked since January 27, 2026. OAuth flow, developer token (Basic Access), and Google Cloud setup all worked; investigation notes in `FOLLOWUP-NOTES.md` (check OAuth consent screen mode, data access settings, API Explorer testing). Later resolved for the client integrations now live.

## `/tokens` - Token Opportunity Framework (Next.js)
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

## `/clients` - Client Portal
Authenticated dashboards for individual clients. **Login System:** `/clients/index.html` — Supabase authentication, routes users to client-specific dashboards. Per-client docs live in `clients/<name>/CLAUDE.md`:
- **Digistore24** (`/clients/digistore24/`) — CI suite + PPC reporting, password TR8FFIC
- **Omicron** (`/clients/omicron/`) — multi-account Google Ads dashboard, 9 Usenet-portfolio accounts (auth migrated to Supabase)
- **AG2020** (`/clients/ag2020/`) — full financial + attribution platform (Supabase Auth)
- **Vita Brevis** (`/clients/vita-brevis/`) — read-only ad reporting (Google Ads 327-808-5194 + 3 Meta accounts; Hyder does NOT manage their spend), password VITABREVIS. Also `instagram-reviews.html` Squarespace Code Block snippet for /rave-reviews page.

## `/assets` - Static Assets
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

## `/docs` - Documentation
```
/docs/
├── claude/                                    # Moved-out root CLAUDE.md sections
│   ├── repo-structure.md                      # (this file)
│   ├── patterns-library.md
│   ├── changes-log.md
│   └── playbook-product.md
├── google-ads-api-design-documentation.html   # API integration design doc
├── solarscore-pitch-deck.html                 # SolarScore product pitch
├── playbook/                                  # Playbook product source (emails, templates)
└── solar-database-project/                    # Separate initiative
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

## `/decks` - Pitch Presentations
Full-screen HTML slide decks with custom navigation (prev/next buttons, progress bar, keyboard support).

- **`/decks/framework/index.html`** - "Distribution Control in the Age of AI"
  - Token systems framework pitch (~20 slides)
  - Orange/brown color scheme, PT Sans + Roboto Mono fonts
  - Topics: Token types, market catalysts, architecture patterns

- **`/decks/auto-glass/index.html`** - "Auto Glass & ADAS Calibration Opportunity"
  - CalibrateNet investor pitch (~20 slides)
  - Blue gradient color scheme
  - ADAS calibration market sizing and network model

- **`/decks/ag2020-investor/`** — AG2020 investor deck; see `clients/ag2020/CLAUDE.md`.

## `/scripts` - Data Processing Scripts
- `import-digistore-keywords.js` - Transform SimilarWeb Excel exports → keywords-combined.json
- `fetch-google-keywords.js` - Enrich keywords with Google Keyword Planner data
(Details in `clients/digistore24/CLAUDE.md`.)

## Technology Stack
- **Frontend:** HTML5, CSS3, Bootstrap 5, Tailwind CSS (tokens, ag2020)
- **Framework:** Next.js 14 (tokens, ag2020 static exports)
- **Backend:** Vercel Serverless Functions (Node.js, ES modules)
- **Database:** Supabase (PostgreSQL) - project: ilbovwnhrowvxjdkvrln.supabase.co
- **Auth:** Supabase Auth (main client portal, AG2020, Omicron), sessionStorage (other client dashboards)
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

## `vercel.json` function timeouts
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

## Supabase Database Tables (Google Ads schema)
The schema (`/api/google-ads/schema.sql`) defines 11 tables:
- `google_ads_connections` - OAuth tokens and connection info
- `google_ads_customers` - Customer account metadata
- `google_ads_campaigns` - Campaign data with metrics
- `google_ads_ad_groups` - Ad group data with metrics
- `google_ads_keywords` - Keyword data with quality scores
- `google_ads_search_terms` - Search term reports
- `google_ads_sync_log` - Sync operation tracking
- Additional AG2020-specific tables (`/api/ag2020/schema.sql`)

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

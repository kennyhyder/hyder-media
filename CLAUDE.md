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

### `/api` - Serverless Backend
Vercel serverless functions (Node.js)

**Contact API:** `/api/contact.js`
- Email validation, rate limiting, spam detection
- Uses nodemailer (Gmail credentials in .env.local)

**Google Ads API Suite:** `/api/google-ads/`
- `auth.js` - OAuth 2.0 initiation
- `callback.js` - OAuth callback handler
- `accounts.js` - List connected accounts
- `campaigns.js` - Campaign data with metrics
- `sync.js` - Full data synchronization
- `debug.js` - API diagnostics
- `schema.sql` - Supabase database schema

**Current Issue:** Google Ads API returns 501 UNIMPLEMENTED error. See FOLLOWUP-NOTES.md for investigation status.

### `/tokens` - Token Opportunity Framework (Next.js)
Static Next.js export analyzing 150+ companies from Ribbit Capital Token Letter.
- 19 detailed capex/business-plan pages (capex-1 through capex-19)
- Uses Tailwind CSS, React Server Components
- Static export deployed to Vercel

### `/clients` - Client Portal
Authenticated dashboards for individual clients.

**Login System:** `/clients/index.html`
- Supabase authentication
- Routes users to client-specific dashboards

**Digistore24 Dashboard:** `/clients/digistore24/`
- PPC strategy development
- Market research project
- Data in `/clients/digistore24/data/`

### `/assets` - Static Assets
- CSS: Bootstrap, custom styles, responsive rules
- JS: Bootstrap bundle, site scripts, calculator logic
- Images: Logos, hero backgrounds, service icons

### `/docs` - Documentation
- Solar Database Project specs (separate initiative)
- HTML presentation decks

### `/decks` - Pitch Presentations
- `/decks/framework/` - Token framework pitch
- `/decks/auto-glass/` - Auto glass opportunity deck

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
Function timeout configurations (10s-60s depending on endpoint)

## Technology Stack
- **Frontend:** HTML5, CSS3, Bootstrap, Tailwind (tokens only)
- **Framework:** Next.js 13+ (tokens only)
- **Backend:** Vercel Functions (Node.js)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth with email/password
- **APIs:** Google Ads API v18, Google OAuth 2.0
- **Email:** Nodemailer (Gmail)

## Current Projects

### Digistore24 Competitive Intelligence Suite
**Location:** `/clients/digistore24/`
**Status:** In Progress

**Data Files:** `/clients/digistore24/data/ppc-kws/`
- SimilarWeb exports for competitor analysis
- Google Keyword Planner data for volume/bid estimates
- Processed JSON: `/clients/digistore24/data/keywords-combined.json` (31,164 keywords)

**Brands Analyzed (6 total):**
- awin (blue #3b82f6)
- samcart (purple #8b5cf6) - *Note: Data may skew results, default unchecked*
- clickbank (green #22c55e)
- maxweb (amber #f59e0b)
- impact (pink #ec4899)
- realize (teal #14b8a6)

**Tool Pages:**

1. **Keyword Tool:** `/clients/digistore24/keyword-tool.html`
   Interactive analysis dashboard:
   - Pivot table with 31,164 keywords across 6 brands
   - CPC Source selector: SimilarWeb, Google High/Low/Avg Bid
   - Keyword Groups accordion (Topic Groups & Brand Groups)
   - Brand filtering with cascading stat updates
   - Est. Spend calculation: clicks × active_cpc
   - CSV export, intent filtering, category filtering

2. **Competitor Ads:** `/clients/digistore24/competitor-ads.html`
   Google Ads Transparency Center integration:
   - Direct links to each competitor's ad library
   - Brand-specific styling and descriptions

3. **Landing Page Analysis:** `/clients/digistore24/landing-page-analysis.html`
   Competitor landing page teardowns:
   - Screenshot comparisons
   - Copy analysis and CTA review
   - Tabbed interface for each competitor

4. **Sample Landing Page:** `/clients/digistore24/sample-landing-page.html`
   Reference landing page template

**Keyword Categories (10):**
- Affiliate/Network, E-commerce/Cart, Brand - Competitor
- Marketing/Strategy, Review/Comparison, Product/Digital
- Course/Education, Sign Up/Login, Money/Income, Other

### Google Ads Integration
**Status:** Blocked on 501 error
**Next Steps:** See FOLLOWUP-NOTES.md

## Git Workflow
- Main branch: `main`
- Deploys automatically to Vercel on push
- Recent commits focus on Google Ads integration and client portal

## Commands Reference
```bash
# Local development
npm install
vercel dev

# Beads (task tracking)
bd ready              # See available tasks
bd new "task name"    # Create new task
bd status             # Check task status
bd close <id>         # Complete a task

# Deploy
vercel --prod
```

## Important Notes
1. **Don't modify root files** without explicit request - they're the live hyder.me site
2. **Supabase project:** ilbovwnhrowvxjdkvrln.supabase.co
3. **Google Ads MCC:** 673-698-8718
4. **Developer Token:** Basic Access approved

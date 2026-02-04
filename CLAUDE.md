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

**Digistore24 Competitive Intel Suite:** `/clients/digistore24/`
- Password-protected tool suite (password: TR8FFIC)
- PPC strategy and competitive intelligence
- See detailed breakdown below

### `/assets` - Static Assets
- CSS: Bootstrap, custom styles, responsive rules
- JS: Bootstrap bundle, site scripts, calculator logic
- Images: Logos, hero backgrounds, service icons
- **Logo files:** `hyder-media-logo.png` (full), `hyder-media-icon.png` (icon only)

### `/docs` - Documentation
- Solar Database Project specs (separate initiative)
- HTML presentation decks

### `/decks` - Pitch Presentations
- `/decks/framework/` - Token framework pitch
- `/decks/auto-glass/` - Auto glass opportunity deck

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
| `keywords-combined.json` | 31,164 keywords with brand data, volumes, CPCs |
| `ppc-kws/` | Raw SimilarWeb exports per competitor |
| `google-keywords.json` | Google Keyword Planner volume/bid data |

**Keyword JSON structure:**
```json
{
  "keyword": "affiliate marketing",
  "volume": 12500,
  "cpc": 2.45,
  "categories": ["Affiliate/Network"],
  "primary_category": "Affiliate/Network",
  "intent": "Informational",
  "brand_group": null,
  "short_tail_group": "affiliate",
  "google": {
    "annual_volume": 150000,
    "low_top_of_page_bid": 1.50,
    "high_top_of_page_bid": 4.20,
    "competition": "HIGH"
  },
  "brands": [
    {
      "name": "clickbank",
      "clicks": 450,
      "est_spend": 1102.50,
      "desktop_share": 0.65,
      "mobile_share": 0.35,
      "top_url": "clickbank.com/affiliate"
    }
  ]
}
```

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
- **Auth:** Supabase Auth (main portal), sessionStorage (Digistore24 tools)
- **APIs:** Google Ads API v18, Google OAuth 2.0
- **Email:** Nodemailer (Gmail)

## Git Workflow
- Main branch: `main`
- Deploys automatically to Vercel on push
- Recent commits focus on Digistore24 competitive intel suite

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
5. **Digistore24 password:** TR8FFIC (sessionStorage-based auth)

---

## Recent Changes Log

### 2026-02-03
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

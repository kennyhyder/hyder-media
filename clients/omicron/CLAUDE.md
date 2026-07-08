# Omicron Google Ads Dashboard

**Location:** `/clients/omicron/`
**URL:** https://hyder.me/clients/omicron
**Status:** Active

## Authentication

**Current (2026): Supabase Auth with MFA.** `login.html` + `auth-check.js` verify an active Supabase session at AAL2 (MFA verified) against the shared project `ilbovwnhrowvxjdkvrln`; unauthenticated visitors redirect to `login.html?next=<page>`. `auth-check.js` exposes `window.omicronSupabase` + `window.omicronSignOut()`. SQL helpers in `supabase/`.

**Historical (pre-migration) sessionStorage flow** — kept for reference; `password.html` still exists:
1. User visits `/clients/omicron/` → redirects to `password.html`
2. User enters password "LIEHAO"
3. sessionStorage stores `omicron_dashboard_auth = 'authenticated'`
4. Redirects to `summary.html`
5. All tool pages check sessionStorage auth on load

```javascript
// Old sessionStorage gate (in <head> of protected pages):
<script>
    (function() {
        const AUTH_KEY = 'omicron_dashboard_auth';
        if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
            window.location.href = 'password.html';
        }
    })();
</script>
```

## Pages

| Page | File | Purpose |
|------|------|---------|
| **Login** | `login.html` | Supabase Auth entry point (current) |
| **Password** | `password.html` | Legacy sessionStorage gate |
| **Summary** | `summary.html` | Overview page with account structure and API status |
| **Dashboard** | `dashboard.html` | Multi-account comparison with charts and filters |
| **Legacy** | `legacy-dashboard.html` | Original CSV-based view (BUR + Top10 only) |

## Account Structure (9 accounts)

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

## Data Strategy
- Dashboard shows demo data (randomly generated) as fallback when the Google Ads API is unavailable
- Plan: Daily sync to Supabase, dashboard reads from cache
- Manual refresh button for on-demand updates

## File Structure
```
/clients/omicron/
├── index.html              # Redirect to entry gate
├── login.html              # Supabase Auth login (current entry point)
├── auth-check.js           # Supabase AAL2 session gate for protected pages
├── supabase/               # SQL for omicron auth/user setup
├── password.html           # Legacy password protection gate
├── summary.html            # Overview with API status
├── dashboard.html          # Multi-account comparison
├── legacy-dashboard.html   # Original CSV-based view
├── styles.css              # Shared styles (Digistore24 design system)
├── app.js                  # Legacy dashboard logic
├── topten_all_basic.csv    # Legacy Top10 data
├── bur_all_basic.csv       # Legacy BUR data
├── Omicron_PPC_Audit_2026.pdf
├── package.json            # Dependencies
└── vercel.json             # Deployment config
```

## Google Ads API Integration
- OAuth flow works, tokens stored in Supabase
- `api/google-ads/callback.js` recursively fetches MCC child accounts
- Dashboard pulls live metrics from all 10 accounts
- Google Ads API v23; MCC 673-698-8718

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/google-ads/omicron-data` | 30-day summary metrics for all accounts |
| `/api/google-ads/omicron-monthly` | Monthly data with brand/non-brand breakdown |
| `/api/google-ads/omicron-conversions` | Conversion action breakdown per account |

**Timeouts:** these endpoints (and `debug-omicron`, `debug-bur-top10`) are NOT in root `vercel.json` — they use the default 10s timeout.

## Brand vs Non-Brand Classification

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

## Dashboard Tabs (Linkable)

Tabs support direct linking via URL hash:
- `dashboard.html#overview` - Overview
- `dashboard.html#review` - Review Sites
- `dashboard.html#owned` - Owned Sites
- `dashboard.html#conversions` - SKU / Brand
- `dashboard.html#accounts` - Account Details

## Known Issues
1. Google Ads API 501 UNIMPLEMENTED may occur - see root `FOLLOWUP-NOTES.md`
2. If accounts show "Error", try reconnecting OAuth via Summary page

## History
- 2026-02-03: migrated from `~/Desktop/omicron` to `/clients/omicron`; summary + dashboard pages created; `callback.js` updated to recursively fetch MCC children; shared `styles.css` based on Digistore24 design system
- 2026-02-04: fixed BUR non-brand data (non-brand patterns take priority); fixed Top10usenet display (account key `top10usenet` not `top10`); added linkable tabs
- Later: migrated auth from sessionStorage password (LIEHAO) to Supabase email/password + MFA (AAL2)

<claude-mem-context>
# Recent Activity

### Apr 17, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #431 | 9:57 AM | 🟣 | March 2026 time tracking CSV generated with distribution constraints | ~373 |
| #430 | 9:55 AM | 🔵 | Time tracking CSV template structure analyzed | ~127 |
</claude-mem-context>

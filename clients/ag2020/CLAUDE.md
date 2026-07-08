# Auto Glass 2020 — Tech-Enabled Financial + Attribution Platform

**Location:** `/clients/ag2020/`
**URL:** https://hyder.me/clients/ag2020
**Status:** Production. Multi-user, live data, automated ingest.

Built out from a static financial dashboard into a complete attribution + ops
platform. Replaced shared-password gate with Supabase Auth + per-user
permissions. Added end-to-end attribution, halo-lift analysis, autodialer,
ad-spend ingest, and an investor pitch deck. **Companion memory:**
[[ag2020-platform-state]] and [[ag2020-pending-items]].

## Authentication (Supabase email/password + magic link)
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
- **Legacy shared password** (pre-Supabase sessionStorage era): AG2020FLOW.

## Tab structure (per-user gating)
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

## Attribution Platform (`ag2020_*` tables in Supabase)
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

## Halo Lift Analysis (the proudest stat)
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

## Data Sources + Ingestion Pipelines
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

## Autodialer / Speed-to-Lead
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

The generalized cross-client autodialer pattern (file layout, AC/Twilio
gotchas, dedupe rules, branded calling) is documented in
`docs/claude/patterns-library.md` § "Speed-to-lead autodialer".

## Key API Endpoints (all under `/api/ag2020/`)
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

Also: `/api/google-ads/ag2020-spend.js` — Google Ads historical spend data
(lives in the google-ads namespace, 60s timeout in root vercel.json).

Cron from `vercel.json`: `/api/ag2020/autodial-cron` (every 15min, drains
business-hours-deferred attempts), `/api/ag2020/cron-ad-spend-daily` (daily 8a UTC).

## Investor Pitch Deck (`/decks/ag2020-investor/`)
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

## Source File Structure (all source gitignored, only build output deploys)
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

## Rebuild + Deploy
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

## Shared-project auth.users triggers (CRITICAL)
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

## History
- **2026-02-04**: Migrated from standalone `auto-glass-cash-flow` repo to
  `hyder-media/clients/ag2020`. Password-protected financial dashboard with
  sessionStorage auth; Next.js static export with `basePath: '/clients/ag2020'`;
  post-build script injects auth check into generated HTML; source gitignored,
  only built output deployed. The old `auto-glass-cash-flow` repo's Vercel
  deployment remains as a backup URL — this work supersedes it but doesn't
  touch it.
- **2026-02-05**: Court presentation document (`court-presentation.html`) —
  standalone password-protected page. Recovery Case scenario showing
  feasibility with owner return; $50K unsecured creditor distribution at end
  of 2027; complete debt repayment plan with creditor list; cash infusions
  feature + comprehensive bankruptcy analysis tab; historical performance tab
  with year selector and drill-down charts; deep links preserved after
  password authentication.
- **May–June 2026**: Full platform build-out (Supabase Auth, attribution,
  halo lift, autodialer, ingest pipelines, investor deck) — see sections
  above and memory [[ag2020-platform-state]] / [[ag2020-pending-items]].

<claude-mem-context>
# Recent Activity

### May 12, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #463 | 2:03 PM | 🔵 | Hyder-Media Project Architecture Patterns Audit | ~614 |
</claude-mem-context>

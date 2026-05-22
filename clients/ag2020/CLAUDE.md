# Auto Glass 2020 Financial Dashboard

## Project Overview

Financial performance dashboard for Auto Glass 2020, displaying historical data from January 2020 through January 2026.

**URL:** https://hyder.me/clients/ag2020
**Password:** AG2020FLOW
**Auth Key:** `ag2020_dashboard_auth`

## Technology Stack

- **Framework:** Next.js 14.1.0 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Build:** Static export (`output: 'export'`)
- **Authentication:** sessionStorage-based password protection

## Directory Structure

```
/clients/ag2020/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main dashboard component (all 7 tabs)
│   │   ├── layout.tsx        # App layout with metadata
│   │   └── globals.css       # Global styles
│   └── lib/
│       ├── data.ts           # Business metrics, forecasts, historical data exports
│       └── bankTransactions.ts # Bank transaction data for cash infusion tracking
├── data/
│   ├── complete-historical-data.json  # Merged performance + ad spend data
│   ├── historical-performance.json    # Processed CSV data (margins + sales)
│   └── google-ads-spend.json         # Ad spend from Google Ads API
├── scripts/
│   ├── post-build.js                 # Injects auth, moves build output
│   ├── process-historical-data.js    # Processes CSV files into JSON
│   └── merge-historical-data.js      # Merges performance + ad spend
├── public/
│   ├── password.html                 # Password protection gate
│   └── logo.webp                     # Auto Glass 2020 logo
├── next.config.js                    # Static export config with basePath
├── tailwind.config.js                # Tailwind configuration
└── package.json                      # Dependencies and scripts
```

## Dashboard Tabs (7)

| Tab | ID | Description |
|-----|----|-------------|
| Dashboard | `#dashboard` | Business metrics overview with KPIs |
| Overhead | `#overhead` | Monthly fixed overhead itemization |
| Payroll | `#payroll` | Weekly payroll breakdown by employee |
| Debt | `#debt` | Outstanding debt with interest rates |
| Forecast | `#forecast` | Interactive job-driven financial forecast |
| Performance | `#performance` | **Historical performance with year selector** |
| Bank Statements | `#bank-statements` | Transaction viewer with cash infusion marking |

## Data Pipeline

### Source Data

1. **Margin Report CSV:** `ag2020-margins-jan2020_jan2026.csv`
   - Invoice numbers, dates, revenue, margin, costs
   - ~54,000+ job records

2. **Sales Report CSV:** `ag2020-sales-jan2020_jan2026.csv`
   - Invoice numbers, dates (for matching)
   - Payer/insurance company breakdown

3. **Google Ads API:** Two accounts
   - Current: `505-336-5860` (via MCC `673-698-8718`)
   - Historical: `439-961-4856` (direct access)

### Processing Scripts

```bash
# Step 1: Process CSV files into historical-performance.json
node scripts/process-historical-data.js

# Step 2: Fetch Google Ads spend (requires API connection)
# Uses /api/google-ads/ag2020-spend endpoint

# Step 3: Merge performance + ad spend
node scripts/merge-historical-data.js
```

### Data Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Margin CSV     │     │  Sales CSV      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │ process-historical- │
         │ data.js             │
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │ historical-         │
         │ performance.json    │
         └──────────┬──────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌────────┐   ┌─────────────┐   ┌────────────┐
│ Google │   │ merge-      │   │ Google Ads │
│ Ads    │──▶│ historical- │◀──│ API        │
│ Spend  │   │ data.js     │   │ /ag2020-   │
│ .json  │   └──────┬──────┘   │ spend      │
└────────┘          ▼          └────────────┘
            ┌─────────────────┐
            │ complete-       │
            │ historical-     │
            │ data.json       │
            └────────┬────────┘
                     ▼
            ┌─────────────────┐
            │ src/lib/data.ts │
            │ (imports JSON)  │
            └────────┬────────┘
                     ▼
            ┌─────────────────┐
            │ page.tsx        │
            │ (Performance    │
            │  tab display)   │
            └─────────────────┘
```

## Historical Data Summary

As of 2026-02-05:

| Metric | Value |
|--------|-------|
| Date Range | Jan 2020 - Jan 2026 |
| Total Months | 73 |
| Total Jobs | 54,752 |
| Total Revenue | $39,129,507 |
| Total Margin | $20,029,589 |
| Total Ad Spend | $1,312,549 |
| Total Net Margin | $18,717,040 |

### Yearly Breakdown

| Year | Jobs | Revenue | Margin | Ad Spend | Net Margin | ROAS |
|------|------|---------|--------|----------|------------|------|
| 2020 | 4,837 | $3.5M | $1.7M | $10K | $1.7M | 355x |
| 2021 | 7,512 | $4.6M | $2.2M | $41K | $2.1M | 113x |
| 2022 | 10,203 | $6.5M | $3.2M | $236K | $3.0M | 28x |
| 2023 | 11,298 | $7.9M | $4.0M | $346K | $3.6M | 23x |
| 2024 | 12,104 | $9.7M | $5.0M | $454K | $4.6M | 21x |
| 2025 | 7,786 | $5.9M | $3.4M | $205K | $3.2M | 29x |
| 2026* | 1,012 | $946K | $534K | $20K | $514K | 47x |

*2026 is partial (January only)

## Build & Deploy

### Local Development

```bash
cd /Users/kennyhyder/Desktop/hyder-media/clients/ag2020
npm install
npm run dev
# Visit http://localhost:3000/clients/ag2020
```

### Production Build

```bash
npm run build
# Output goes to parent directory (handled by post-build.js)
# Files: index.html, password.html, _next/, etc.
```

### Deployment

Deploy via git push (auto-deploys from GitHub):

```bash
git add .
git commit -m "Update AG2020 dashboard"
git push origin main
```

## Configuration Files

### next.config.js

```javascript
const nextConfig = {
  output: 'export',
  basePath: '/clients/ag2020',
  assetPrefix: '/clients/ag2020/',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
}
```

### tsconfig.json

Includes path alias `@/*` → `./src/*` for imports.

## Authentication Flow

1. User visits `/clients/ag2020/` → index.html loads
2. `<script>` in `<head>` checks `sessionStorage.getItem('ag2020_dashboard_auth')`
3. If not authenticated → redirect to `password.html`
4. User enters "AG2020FLOW" → sets sessionStorage → redirect to index.html
5. Dashboard loads normally

## Google Ads API Integration

### Endpoint

`POST /api/google-ads/ag2020-spend`

### Accounts Configuration

```javascript
const accounts = [
  { id: '5053365860', mcc: '6736988718' },  // Current account (via MCC)
  { id: '4399614856', mcc: '4399614856' }   // Historical account (direct)
];
```

### API Details

- API Version: v23
- Endpoint: `:search` (not `:searchStream`)
- Query: `SELECT campaign.name, segments.month, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date >= '2019-01-01'`

## Key Files Reference

### Main Dashboard Component

`src/app/page.tsx` - 1000+ lines containing:
- Tab navigation with hash-based routing
- Performance tab with year selector
- Forecast calculator with growth projections
- Bank statements with cash infusion tracking

### Data Types

`src/lib/data.ts` - Contains:
- `HistoricalMonthData` - Monthly performance metrics
- `HistoricalYearData` - Yearly aggregations
- `CompleteHistoricalData` - Full data structure
- Helper functions: `getYearMonthlyData()`, `getYearSummary()`, `getAvailableYears()`

### Historical Data JSON

`data/complete-historical-data.json` - Structure:

```json
{
  "generated": "2026-02-05T01:16:08.370Z",
  "summary": {
    "totalMonths": 73,
    "dateRange": { "start": "2020-01", "end": "2026-01" },
    "totalJobs": 54752,
    "totalRevenue": 39129507,
    "totalMargin": 20029589,
    "totalAdSpend": 1312549,
    "totalNetMargin": 18717040
  },
  "yearly": [/* HistoricalYearData[] */],
  "monthly": [/* HistoricalMonthData[] */],
  "dataSources": {
    "performance": "CSV files",
    "adSpend": "Google Ads API"
  }
}
```

## Troubleshooting

### Build fails with type error

If `historicalData` type assertion fails:
```typescript
// Use double assertion through unknown
export const historicalData: CompleteHistoricalData =
  historicalDataJson as unknown as CompleteHistoricalData;
```

### Google Ads API 501 UNIMPLEMENTED

- Check API version (should be v23, not v18)
- Use `:search` endpoint, not `:searchStream`
- Verify MCC vs direct account access

### Missing ad spend data

1. Run the API endpoint to fetch fresh data
2. Save to `data/google-ads-spend.json`
3. Run `node scripts/merge-historical-data.js`
4. Rebuild: `npm run build`

### Performance tab shows wrong year

- Check `selectedYear` state initialization (defaults to 2025)
- Verify `getAvailableYears()` returns correct years from data

## Speed-to-Lead Autodialer (live since 2026-05-22)

Outbound auto-callback engine. A lead arrives → Twilio places an outbound call
to the **customer** → on answer, plays a hold message, then `<Dial>`s the
AG2020 sales line so a rep picks up. Same engine handles form-submit leads and
voicemail-leaver missed calls today; CallRail will plug in pure-hangup missed
calls in Phase 2 with no code change.

**End-to-end verified** with a real form submission: form → tag → webhook →
call → human-answered → bridged → 64s rep connect (attempt id 10, completed).

### Data flow

```
TRIGGERS
  Web form on autoglass2020.com
    → ActiveCampaign (contact created + tagged "NEW LEAD ALERT" by an AC automation)
        → AC account webhook id=3 (event: contact_tag_added, all sources)
            → POST /api/ag2020/autodial (source=form_submit)
                                                        |
  Missed call → voicemail → email                       |
    → Zapier email parser                               |
        → POST /api/ag2020/call-event-webhook           |
            → ag2020_call_queue (triage) + SMS auto-reply
            → POST /api/ag2020/autodial (source=missed_call)
                                                        |
                                          ENGINE: /api/ag2020/autodial
                                          - fail-closed AC tag gate (allowlist)
                                          - 6h dedupe by customer_number
                                          - Mon-Sat 7am-6pm Phoenix gating
                                              ↓                    ↓
                                         (in hours)            (off hours)
                                              ↓                    ↓
                                  Twilio places outbound      defer → next 7am
                                  call to customer            (cron drains)
                                  From: AG2020 main line
                                              ↓
                                  Customer answers → AMD check
                                              ↓
                                  ┌─────────┴──────────┐
                              machine                 human
                                  ↓                    ↓
                              <Hangup/>        <Say> hold msg </Say>
                              status=machine   <Dial answerOnBridge
                                                callerId=owned#>
                                                  +14804770977 (rep line)
                                                      ↓
                                              whisper to rep:
                                              "New web lead, connecting"
                                                      ↓
                                              bridged call begins
                                                      ↓
                                              <Dial> action + StatusCallback
                                              → status=completed (+ bridge_duration)
```

### Files (/api/ag2020/)

| File | Role |
|---|---|
| `_autodial-lib.js` | Shared helpers: phone normalize, HMAC callback tokens, AZ business-hours math (fixed UTC-7, Mon-Sat), `placeCall()`, env accessors. Underscore-prefixed so Vercel doesn't route it |
| `autodial.js` | `POST` trigger receiver (form/missed-call/manual) + `GET` recent attempts. Fail-closed AC tag gate + 6h dedupe + business-hours deferral; inserts row; calls lib `placeCall` |
| `autodial-twiml.js` | TwiML returned to Twilio on customer answer. AMD voicemail guard; on human → hold message + `<Dial>` bridge to rep with whisper TwiML |
| `autodial-status.js` | Twilio StatusCallback (customer leg) + `<Dial>` action callback (bridge leg). Updates `ag2020_autodial_attempts` row; bridge action is authoritative for answered calls |
| `autodial-cron.js` | Vercel cron `*/15 * * * *`. Picks up rows in `status=deferred` whose `dial_after` has passed and dials them |
| `call-event-webhook.js` | Pre-existing missed-call intake; for `!answered` calls now also POSTs to `/api/ag2020/autodial` (the missed-call interim wiring) |
| `schema.sql` | Adds `ag2020_autodial_attempts` alongside the existing call-queue tables |
| `AUTODIAL-SETUP.md` | Original runbook — **STALE**, describes the form-id gate that was abandoned for the tag gate |
| `AUTODIAL-DEPLOY-RICK.md` | Original Rick handoff — **STALE**, describes an AC automation that wasn't built (account webhook used instead) |

### Database table — `ag2020_autodial_attempts`

Supabase project `ilbovwnhrowvxjdkvrln`. One row per dial attempt; the
`trigger_payload` JSONB column stores the full inbound webhook body for audit
and payload-shape debugging.

**Status state machine:**

| status | meaning |
|---|---|
| `deferred` | queued — arrived outside business hours, awaiting the cron |
| `dialing` | Twilio call placed, ringing the customer |
| `customer_answered` | customer picked up (AMD `human` or `unknown`) |
| `machine` | answering machine / voicemail detected — bridge skipped |
| `bridged` | rep answered, customer + rep connected (transient state) |
| `completed` | call finished cleanly (terminal) |
| `no_answer` | customer never picked up |
| `rep_no_answer` | customer answered but the bridge to the rep line didn't connect |
| `failed` | Twilio error placing or running the call |
| `skipped_duplicate` | same customer_number dialed within `DEDUPE_HOURS` (6h) |
| `skipped_form` | AC webhook for a non-trigger tag (logged with payload, never dialed) |

**Dedupe must exclude `failed`, `skipped_duplicate`, AND `skipped_form`** —
otherwise a non-trigger tag webhook blocks the real trigger that fires moments
later. See commit `97999f2f`.

### Env vars (all Vercel Production)

| Var | Value | Notes |
|---|---|---|
| `AG2020_AUTODIAL_SECRET` | 48-char hex | `?secret=` / `X-Webhook-Secret` auth for `POST /autodial`. Falls back to `AG2020_MISSED_CALL_WEBHOOK_SECRET` |
| `AG2020_AUTODIAL_TWILIO_ACCOUNT_SID` | `AC65d2…` | AG2020's OWN Twilio account — NOT the shared `AG2020_TWILIO_*` vars (those are a different / Hyder Media account, the `+1808` number) |
| `AG2020_AUTODIAL_TWILIO_AUTH_TOKEN` | (secret) | same |
| `AG2020_AUTODIAL_FROM_NUMBER` | `+14804770977` | Customer-facing caller ID. AG2020's main line, **verified as a Twilio outgoing caller ID** (not owned) — so callbacks show the number customers actually dialed |
| `AG2020_AUTODIAL_BRIDGE_CALLER_ID` | `+14803970924` | Caller ID on the `<Dial>` leg to the rep. Must be OWNED Twilio + distinct from the rep line (a line can't be dialed showing its own number as caller ID) |
| `AG2020_REP_INBOUND_NUMBER` | `+14804770977` | The sales line the bridge dials |
| `AG2020_AUTODIAL_TAGS` | `NEW LEAD ALERT,2487` | Allowlist for `contact_tag_added` triggers — matched by tag name or id, case-insensitive |
| `AG2020_AUTODIAL_FORM_IDS` | (legacy, unused) | Superseded by tag gating; harmless to leave set |
| `AG2020_PUBLIC_BASE_URL` | (default `https://hyder.me`) | Base for Twilio callback URLs |

### How the form-submit trigger actually works

The cleanest theoretical design — AC automation "Submits a form" → Webhook
action — wasn't usable: **the AC API can't build automations** (UI-only). The
fallback was an AC account webhook via the API (`POST /api/3/webhooks`).

The first attempt used the `subscribe` event with `sources=[public]`. **It
caught nothing**, because AG2020's lead forms create contacts but do NOT
subscribe them to a list — so AC fires no `subscribe`. And there is no
`contact_add` event in AC at all (verified against `GET /api/3/webhook/events`,
which returns the canonical valid event names).

The working trigger: every new lead in AG2020's account gets the
**"NEW LEAD ALERT"** tag (id `2487`), applied by an existing AC automation. The
webhook listens for `contact_tag_added` (all sources), and the endpoint gates
by tag name/id against `AG2020_AUTODIAL_TAGS`. Per-form tags (`NewGoogle-HP`,
`NewGoogle-LP`, etc.) also fire `contact_tag_added` and land as harmless
`skipped_form` rows — expect 1–2 per real lead.

**AC webhook id `3`** in account `autoglass2020.api-us1.com`:
`events=[contact_tag_added]`, `sources=[public,admin,api,system]`,
URL `https://hyder.me/api/ag2020/autodial?secret=…`.

### Caller ID — verified vs owned (the recognition vs trust tradeoff)

AG2020 customers dial `+14804770977` (main line, on **Vonage**). For the
autodial to call back FROM that same number, it had to be **verified** as an
outgoing caller ID in the AG2020 Twilio account — Twilio places a verification
call with a 6-digit code, someone at the line enters it. Done 2026-05-22.

Tradeoff: verified caller IDs get lower STIR/SHAKEN attestation than owned
numbers (more spam-flag risk). Recognition wins for callbacks to someone who
literally just dialed that number. The plan to neutralize the trust gap is
**branded calling on `+14804770977` via First Orion INFORM** (see "Branded
calling" below).

The `<Dial>` bridge leg uses `+14803970924` (an OWNED Twilio number) as
`callerId` so we're not dialing `+14804770977` showing `+14804770977` as caller
ID (From == To pathology).

### Branded calling — First Orion INFORM (planned)

Twilio's own Branded Calling **requires Twilio-owned numbers**, so it can't
brand `+14804770977` without porting (blocked by the Vonage contract until
~mid-2027). It's also still in beta and currently covers T-Mobile + Verizon
only — no AT&T. **First Orion INFORM** works with the existing setup
(verified caller ID on Vonage), covers all 4 major US carriers + iPhone +
Android, and has a free business-number registration tier. Registration is on
AG2020's side (needs AG2020's EIN); email sent to Rick 2026-05-22.

### Monitoring

```bash
# Recent attempts via the endpoint (no trigger_payload)
curl -s "https://hyder.me/api/ag2020/autodial?secret=<SECRET>&limit=20" \
  | python3 -m json.tool

# Full row data with trigger_payload (for skipped_form debugging):
# query Supabase REST directly with the service key
#   GET <SUPABASE_URL>/rest/v1/ag2020_autodial_attempts?select=*&order=created_at.desc
```

### Common operations

- **Swap the customer-facing caller ID:** change `AG2020_AUTODIAL_FROM_NUMBER`
  in Vercel + redeploy. The new number must be owned in the AG2020 Twilio
  account or verified as an outgoing caller ID there.
- **Add/remove a trigger tag:** update `AG2020_AUTODIAL_TAGS` (comma-separated
  names or numeric ids) + redeploy.
- **Pause the autodialer:** delete or disable the AC webhook (id `3`) — UI
  (Settings → Developer → Webhooks) or `DELETE /api/3/webhooks/3` via API.
- **Clear test rows:** `DELETE` against `ag2020_autodial_attempts` via
  Supabase REST with the service key.

### Open follow-ups

- **CallRail (Phase 2)** — for pure-hangup missed calls. Point its
  missed/abandoned webhook at `/api/ag2020/autodial?secret=…` with
  `source=missed_call`. Engine is ready, no code change needed.
- **First Orion INFORM registration** — AG2020 to register the brand at
  firstorion.com/inform; awaiting Rick (email sent 2026-05-22).
- **SportsBookISH number `+18084825663`** is mistakenly inside AG2020's Twilio
  account — move to Kenny's own account post-project.
- **Refresh the stale docs** `AUTODIAL-SETUP.md` and `AUTODIAL-DEPLOY-RICK.md`
  (they describe the abandoned form-id/automation approach).

## Migration History

**Original Location:** `~/Desktop/auto-glass-cash-flow/`
**Migrated To:** `/Users/kennyhyder/Desktop/hyder-media/clients/ag2020/`
**Date:** 2026-02-04

Changes during migration:
- Added static export configuration
- Added password protection (AG2020FLOW)
- Added basePath `/clients/ag2020`
- Created data processing pipeline
- Integrated Google Ads API for historical spend
- Replaced 2025-only performance tab with full historical view

## Related Documentation

- Main hyder-media CLAUDE.md: `/Users/kennyhyder/Desktop/hyder-media/CLAUDE.md`
- Google Ads API docs: `/api/google-ads/` endpoints
- Original deployment: Still active at `kennyhyder/auto-glass-cash-flow` repo


<claude-mem-context>
# Recent Activity

### Feb 5, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #28 | 11:15 AM | 🔵 | Client portal architecture revealed with three password-protected dashboards and authentication gaps | ~1168 |

### May 12, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #463 | 2:03 PM | 🔵 | Hyder-Media Project Architecture Patterns Audit | ~614 |
| #461 | " | 🔵 | Golf Odds Data Source API Research | ~418 |
</claude-mem-context>
# Recent Changes Log (hyder-media)

Historical change log moved out of root CLAUDE.md (2026-07). Newest first.

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

# SportsBookish — Product Context for AI Agents

**SportsBookish** is a SaaS that surfaces pricing edges between Kalshi (regulated event-contract exchange) and traditional sportsbooks across multiple sports. It's the productized evolution of the prototype at `hyder.me/golfodds`.

**Product home**: https://sportsbookish.com (DNS in progress) · https://sportsbookish.vercel.app (always live)
**Owner**: Kenny Hyder (kenny@hyder.me)
**Started**: 2026-05-12 (this directory created same day as the golfodds prototype was built)

## At a glance

| | |
|---|---|
| Stack | Next.js 16 (Turbopack), TypeScript, shadcn/ui (base-ui-based), Tailwind v4, Supabase Auth + Postgres, Stripe v22, Lucide, Sonner |
| Hosting | Vercel project `sportsbookish` (proj_38DXJ93VFAvooocRjDIC6HHB3ohE), team `kennys-projects-93847471` |
| Domain | `sportsbookish.com` (DNS via Cloudflare → Vercel A 76.76.21.21) |
| Database | Supabase project `ilbovwnhrowvxjdkvrln` (shared with golfodds/solar/grid; tables prefixed `sb_*`) |
| Payments | Stripe LIVE account (same one as reddit-keyword-monitor / subredmonitor); separate Products for SportsBookish |
| Email | Resend (`golfodds@hyder.me` and `noreply@hyder.me` — verify hyder.me domain in Resend before launch) |

## Pricing tiers

Source of truth: `lib/tiers.ts`. Schema mirror: `sb_subscription_tiers` (Supabase).

| Tier | Name | Price | Stripe Price | Feature flags |
|---|---|---|---|---|
| `free` | First Line | $0 | (none — no Stripe entry) | `win_only: true` |
| `pro` | Pro | $10/mo | `price_1TWUT0EI9W6dG0u9aXzidX4Z` | all markets, home_book, book_filter, props, matchups |
| `elite` | Elite | $100/yr | `price_1TWUT0EI9W6dG0u9lmIAf8TZ` | all Pro + alerts (email + SMS), custom thresholds, sub-min updates, watchlist |

Source of truth for pricing is `lib/tiers.ts` — `priceCents` + `interval`. Stripe Price IDs are LIVE-mode in the project Vercel env. Email templates + landing copy MUST match these numbers (last sync 2026-06-08 from $19/$39 → $10/$100 — drip emails were stale, fixed in same commit as the Polymarket affiliate wiring).

Product IDs are LIVE-mode and stored in Stripe under names `SportsBookish Pro` / `SportsBookish Elite`. For TEST mode, re-run `scripts/setup-stripe-products.mjs` with a `sk_test_*` key.

## File map (sportsbookish/)

```
sportsbookish/
├── app/
│   ├── page.tsx                       # Marketing landing (hero, features, pricing teaser, footer)
│   ├── pricing/page.tsx               # Public pricing page
│   ├── signup/page.tsx                # Magic-link signup; optional ?tier= for direct-to-checkout
│   ├── login/page.tsx                 # Magic-link login
│   ├── auth/callback/route.ts         # Supabase code-exchange; honors ?tier= to bounce to checkout
│   ├── dashboard/page.tsx             # Auth-required home; shows tier + golf link
│   ├── api/
│   │   ├── me/route.ts                # Returns current user + subscription + preferences
│   │   ├── auth/signout/route.ts      # POST signout
│   │   └── stripe/
│   │       ├── checkout/route.ts            # POST: create checkout session (called from PricingCards)
│   │       ├── checkout-redirect/route.ts   # GET: same, but 302s direct to Stripe (used post-signup)
│   │       └── webhook/route.ts             # Stripe → us; updates sb_subscriptions + sb_billing_history
│   └── golf/                          # Phase 2 — golf views ported from hyder.me/golfodds
├── components/
│   ├── ui/                            # shadcn/ui components (auto-generated)
│   ├── nav/MarketingNav.tsx           # Public top nav
│   └── marketing/PricingCards.tsx     # Pricing cards (calls /api/stripe/checkout)
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  # Browser-side client
│   │   ├── server.ts                  # Server-side (cookies) + service-role client
│   │   └── middleware.ts              # Session refresh + /dashboard gate
│   ├── stripe.ts                      # Stripe SDK accessor
│   ├── tiers.ts                       # Tier definitions (used by Stripe setup + UI + filtering)
│   └── tier-guard.ts                  # (Phase 2) server-side tier resolution helper
├── scripts/
│   ├── schema.sql                     # Supabase migrations for sb_* tables
│   ├── setup-stripe-products.mjs      # Idempotent: creates/finds Products + Prices, prints env vars
│   └── setup-stripe-webhook.mjs       # Idempotent: creates/updates webhook endpoint, prints secret
├── middleware.ts                      # Next.js middleware (proxy in v16) — calls supabase/middleware
├── next.config.ts                     # turbopack.root set to silence multi-lockfile warning
└── .env.local                         # See "Env vars" section below
```

## Environment variables

All required for the app to run. Production values are in Vercel project `sportsbookish` env. Local dev: `.env.local`.

| Var | Purpose | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe Supabase URL | All envs |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase anon key (RLS-enforced) | All envs |
| `SUPABASE_SERVICE_KEY` | Server-side privileged key (used by webhook) | All envs |
| `STRIPE_SECRET_KEY` | `sk_live_*` in prod, `sk_test_*` in preview/staging | Per-env |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_*` / `pk_test_*` | Per-env |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (from Stripe dashboard or `setup-stripe-webhook.mjs`) | Per-env |
| `STRIPE_PRICE_PRO` | $10/mo Price ID | Per-env (test/live differ) |
| `STRIPE_PRICE_ELITE` | $100/yr Price ID | Per-env (test/live differ) |
| `NEXT_PUBLIC_SITE_URL` | `https://sportsbookish.com` (prod) or staging URL | Per-env |
| `RESEND_API_KEY` | Transactional email | All envs |
| `VAULT_API_KEY` | Vault Network sub-affiliate API key (for /admin/affiliates dashboard) | All envs |
| `AFFILIATE_POLYMARKET_URL` | Optional override of the Polymarket affiliate URL — defaults to the Routy SPORTSBOOKISH link | All envs |

**Critical**: production uses `sk_live_*` keys — real charges. Staging should use `sk_test_*` keys.

## Database schema

All tables prefixed `sb_` to coexist with `golfodds_*`, `solar_*`, `grid_*`, etc.

### `sb_subscription_tiers`
Plan catalog. Seeded with `free` / `pro` / `elite` rows + `feature_flags` JSONB.

### `sb_subscriptions`
One row per user. Tier + Stripe linkage. Auto-created at `free` tier on signup via `sb_handle_new_user()` trigger on `auth.users`.

Columns: `user_id` (PK, FK auth.users), `tier`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `status`, `current_period_start/end`, `cancel_at_period_end`, `canceled_at`, timestamps.

**Stripe v22 gotcha**: `current_period_start`/`end` now live on `subscription.items[0]`, not on `Subscription` directly. The webhook handler has `periodOf(sub)` helper to extract.

### `sb_user_preferences`
Per-user settings for Pro+ features.

Columns: `user_id` (PK), `home_book` (e.g. `'draftkings'` — Pro+ users compare edge vs THIS book instead of book median), `excluded_books` (TEXT[] — books filtered OUT of consensus median), `alert_thresholds` (JSONB — Elite custom thresholds per market_type), `notification_channels` (TEXT[]), `sms_phone`.

### `sb_billing_history`
Invoice records from Stripe webhook (`invoice.payment_succeeded` / `payment_failed`). For user-facing receipts later.

### RLS policies
All `sb_*` tables have RLS enabled. Users can only read their own rows. The service-role client (used by webhook) bypasses RLS.

## Auth flow

1. User clicks "Start free" or "Subscribe — Pro"
2. → `/signup` (or `/signup?tier=pro`)
3. Enters email → `signInWithOtp` sends magic link via Supabase Auth (which uses default SMTP — Supabase project dashboard configures the sender)
4. Click link → `/auth/callback?code=X&tier=pro` → exchanges code → session set
5. If `?tier=` present, redirect to `/api/stripe/checkout-redirect?tier=X` which 302s to Stripe Checkout
6. Else redirect to `/dashboard`
7. Stripe webhook (`checkout.session.completed`) updates `sb_subscriptions.tier`
8. Dashboard reflects new tier on next page load

**Login flow**: `/login` is the same magic-link pattern but `shouldCreateUser: false`.

## Stripe webhook

URL: `https://sportsbookish.vercel.app/api/stripe/webhook` (or `.com` once DNS lands)
Endpoint ID: `we_1TWUaHEI9W6dG0u9FHBSrgvI`
Events: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}`

For TEST mode, run `scripts/setup-stripe-webhook.mjs` with `sk_test_*` and a different URL (e.g. `https://sportsbookish-staging.vercel.app/api/stripe/webhook`). It creates a separate test-mode endpoint with its own secret.

## Common tasks

### Add a new Stripe product/price
1. Add entry to `PLANS` in `scripts/setup-stripe-products.mjs`
2. `STRIPE_SECRET_KEY=sk_xxx node scripts/setup-stripe-products.mjs`
3. Add resulting Price ID to Vercel env + `.env.local`
4. Add tier to `lib/tiers.ts` + `sb_subscription_tiers` table

### Add a new env var
1. `vercel env add NAME production` (echo value via stdin)
2. Add to `.env.local` for dev
3. Document in this file

### Run schema migration
1. Edit `scripts/schema.sql` (idempotent — uses `CREATE TABLE IF NOT EXISTS`)
2. `PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres -f scripts/schema.sql`

### Deploy
- Local dev: `npm run dev` (http://localhost:3000)
- Manual deploy: `vercel --prod` (Pro plan, no CI yet)
- Git push: triggers Vercel Preview on any branch; only `main` → production (configure in Vercel dashboard)

## Affiliate monetisation (Vault Network)

Polymarket and other prediction-market brands are monetised through Vault Network (sub-affiliate program — see `docs/Vault Sports - Sub-Affiliate Agreement_Rate Guide (SportsBookISH).pdf`). The Polymarket entry is wired in `lib/affiliates.ts` with the Routy tracking URL; constants `POLYMARKET_AFFILIATE_URL`, `POLYMARKET_PROMO_CODE`, `POLYMARKET_PROMO_HEADLINE` are exported for reuse.

- **Affiliate URL is universal** — every Polymarket label uses it on every device.
- **Visual promo ads are iOS-only** — the $20-deposit / $50-trading-bonus offer is restricted to the Polymarket iOS app per Vault terms. `<PolymarketPromo>` (server component) detects iOS via `lib/device.ts` and renders `null` on non-iOS. Five ad sizes live under `public/affiliate-ads/polymarket/`.
- **Compliance language** — when a verb targets Kalshi or Polymarket, use *trade / predict / buy a position / combo*, never *bet / wager / stake / gamble / parlay*. Sportsbook-side language is unrestricted (FanDuel/DraftKings can be "bet" against). See `docs/Vault Affiliate Network.pdf` Sales/DFS/Sweeps/Prediction-markets language sheet.

### Vault API integration (`lib/vault.ts`)

POST-only API at `https://api.vaultnetwork.io`. Auth via `apiKey` in JSON body (not header). Two endpoints used:

- `POST /External/MyBrands` → `[{ brand, states, cpa, notes }]` — offers we're allowed to promote with state availability + CPA (split applied).
- `POST /External/DailyStats` → `[{ brand, link, region, date, registrations, ftds, qualifications, clicks, commission }]` for a date window.

Surfaces in this app:
- `GET /api/admin/vault/brands` — proxied to MyBrands. Admin-only.
- `GET /api/admin/vault/stats?days=N&brands=...` — proxied to DailyStats + per-brand rollup. Admin-only.
- `/admin/affiliates` — server-rendered dashboard. Window selector (7d/30d/90d). Renders top-line totals (clicks/regs/FTDs/qualified/commission), per-brand rollup with funnel rates + $/click, and an Active offers table from MyBrands. Server cache 10 min via `next.revalidate`.

API key handling mirrors `lib/stripe.ts` defensive-trim pattern (`vercel env add` echoes append `\n`). When `VAULT_API_KEY` is missing the page renders a setup card with the `printf %s "key" | vercel env add ...` recipe instead of crashing.

## Connection to hyder-media monorepo

`sportsbookish/` lives inside the `hyder-media` Git repo but is its own Vercel project (root directory: `sportsbookish/`). Pushing to `main` rebuilds both:
- `hyder.me` (the existing site, includes `/golfodds` legacy)
- `sportsbookish.com` (this app)

The existing `/golfodds` system (Kalshi/DataGolf ingest, cron jobs, alerts) on `hyder.me` is the **data source** for `sportsbookish.com` views (Phase 2). The cron jobs continue to run on the hyder.me project; sportsbookish fetches via the same `/api/golfodds/*` endpoints.

## Phase roadmap

- **Phase 1 ✅** (this session): Auth + subscriptions + Stripe + landing/pricing/signup/login/dashboard scaffolding
- **Phase 2** (next): Port `/golfodds` views into `sportsbookish/app/golf/*` with tier-aware data gating; `home_book` + `excluded_books` preferences UI; add `lib/tier-guard.ts`
- **Phase 3**: NBA Playoffs ingest (same Kalshi pattern, no books for V1); Movement alerts (Kalshi prob moves ≥X% in N min); SMS via Twilio for Elite
- **Phase 4**: Digital Ocean worker maintaining Kalshi WebSocket for sub-minute updates; Elite-tier custom alert thresholds UI
- **Phase 5+**: Multi-sport selector at root, additional sports (MLB, NHL, tennis, soccer), historical line movement charts, public API access tier

## Critical gotchas

1. **Stripe key is LIVE** — `sk_live_*`. Real charges happen. Switch to test mode for development by creating `sk_test_*` products + setting Preview-scope Vercel env vars.
2. **shadcn/ui base-ui doesn't ship asChild** — use `buttonVariants()` class on `<Link>` instead of `<Button asChild>`.
3. **Stripe v22 moved period dates** — `current_period_start/end` are on `Subscription.items[0]`, not the subscription. See `periodOf()` in webhook.
4. **Magic links route through Supabase project SMTP** — make sure the Supabase auth email template references `https://sportsbookish.com` (not the default Supabase URL).
5. **Resend `from` domain** — `hyder.me` must be verified in Resend to send `golfodds@hyder.me`. Verify at https://resend.com/domains. Fallback to `onboarding@resend.dev` until verified.
6. **Cookies / SSR** — using `@supabase/ssr`. The browser, server, and middleware clients are all in `lib/supabase/`. Never share clients across contexts.
7. **Middleware deprecation warning** — Next.js 16 prefers `proxy.ts` over `middleware.ts`. Functionally identical for now but will need rename eventually.
8. **`asChild` is gone** — see #2. If you copy patterns from older Next.js SaaS tutorials, this will trip you up.
9. **Tier check at request time, not creation time** — webhook updates `sb_subscriptions.tier` immediately on Stripe events. Any API that gates data should re-read the user's tier on each request.

## Where the prototype lives

The original golf prototype is at:
- UI: https://hyder.me/golfodds/ (password gate `BIRDIE`)
- Data ingest: Vercel cron in the `hyder-media` project (every 5 min Kalshi + 10 min DataGolf)
- DB tables: `golfodds_*` (separate from `sb_*`)
- Alert detector: `/api/golfodds/cron-detect-alerts` (fires email via Resend)

When Phase 2 ports views into `sportsbookish`, the data layer keeps using `golfodds_*` tables — only the auth, tier gating, and UI shell are new. Long-term we may rename tables to `sports_*` for multi-sport, but not yet.

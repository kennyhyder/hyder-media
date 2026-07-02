# SportsBookish — Product Context for AI Agents

**SportsBookish** is a production SaaS at **https://sportsbookish.com** that surfaces pricing edges between prediction markets (Kalshi, Polymarket) and traditional sportsbooks across team sports + golf. It grew out of the `hyder.me/golfodds` prototype and is now a full multi-sport odds-comparison platform with subscriptions, a public REST API, affiliate monetization, embeds, and programmatic SEO surfaces.

**Owner**: Kenny Hyder (kenny@hyder.me) · **Started**: 2026-05-12 · **Status**: LIVE, paying customers, Stripe LIVE keys

## At a glance

| | |
|---|---|
| Stack | Next.js 16 (Turbopack), TypeScript, shadcn/ui (base-ui-based), Tailwind v4, Supabase Auth + Postgres, Stripe v22, Lucide, Sonner, zod, react-query |
| Hosting | Vercel project `sportsbookish` (proj_38DXJ93VFAvooocRjDIC6HHB3ohE), team `kennys-projects-93847471` |
| Domain | `sportsbookish.com` (Cloudflare DNS → Vercel) |
| Database | Supabase project `ilbovwnhrowvxjdkvrln` (shared with golfodds/solar/grid/automatedojo; app tables prefixed `sb_*`) |
| Payments | Stripe **LIVE** account — real charges. Test mode requires separate `sk_test_*` products + Preview-scope env vars |
| Email | Resend (transactional + alerts) |
| SMS | Twilio (Elite alerts) |
| Data plane | `hyder.me/api/sports/*` + `hyder.me/api/golfodds/*` (cron ingest lives in the parent hyder-media repo) |

## Tiers + monetization

### UI tiers — source of truth `lib/tiers.ts` (schema mirror: `sb_subscription_tiers`)

| Tier | Name | Price | Notes |
|---|---|---|---|
| `free` | First Line | $0 | Win/H2H+spread+total headline markets, books median + 5 major books, watchlist, daily edge digest email |
| `pro` | Pro | **$10/mo** | All markets + all 11+ books + golf depth + DataGolf model probs, home_book, book filtering, manual email alert rules |
| `elite` | Elite | **$100/yr** | Everything in Pro + smart preset alerts, SMS delivery, custom thresholds per market type, watchlist push, sub-minute updates |

**Repriced 2026-06-08** from $19/mo / $39/mo → $10/mo / $100/yr. If you see $19/$39 anywhere (emails, landing copy, docs), it's stale — fix it. `lib/tiers.ts` `priceCents` + `interval` is authoritative; Stripe Price IDs live in Vercel env (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`).

### API tiers — independent add-on (also in `lib/tiers.ts`)

Developers subscribe to the REST API separately from the UI tier (two separate Stripe subscriptions can coexist). Gated by `sb_api_keys`, NOT `sb_subscriptions.tier`.

| Plan | Price | Quota |
|---|---|---|
| Demo (free) | $0 | 1,000 req/mo shared public key (published in /api/docs — AI-friendly) |
| `api_monthly` | $50/mo | 20,000 req/mo per key |
| `api_annual` | $500/yr | 20,000 req/mo per key |
| `enterprise` | contact | custom volume + WebSocket + historical archive |

### Affiliate monetization (Vault Network)

Prediction-market + sportsbook brands are monetized through Vault Network (sub-affiliate — see `docs/Vault Sports - Sub-Affiliate Agreement_Rate Guide (SportsBookISH).pdf`).

- `lib/vault.ts` — POST-only API at `https://api.vaultnetwork.io`, auth via `apiKey` **in the JSON body** (not header). Endpoints: `POST /External/MyBrands`, `POST /External/DailyStats`. Proxied via `GET /api/admin/vault/{brands,stats}` (admin-only) and rendered at `/admin/affiliates` (7d/30d/90d windows, per-brand rollups, 10-min server cache).
- `lib/affiliates.ts` — per-brand affiliate URLs (env-overridable: `AFFILIATE_POLYMARKET_URL`, `AFFILIATE_KALSHI_URL`, `AFFILIATE_DRAFTKINGS_URL`, etc.).
- **Polymarket visual promo ads are iOS-only** per Vault terms — `<PolymarketPromo>` detects iOS via `lib/device.ts` and renders `null` elsewhere. The affiliate *URL* itself is universal. Ad creatives in `public/affiliate-ads/polymarket/`.
- **Compliance language (MANDATORY)**: when a verb targets Kalshi or Polymarket, use *trade / predict / buy a position / combo* — never *bet / wager / stake / gamble / parlay*. Sportsbook-side language (FanDuel/DraftKings) is unrestricted. See `docs/Vault Affiliate Network.pdf` language sheet.

## App surfaces (app/)

### Public odds + edges
- `/sports` + `/sports/[league]` — league hubs (event, players/[slug], teams, [year] sub-routes)
- `/sports/arbitrage`, `/sports/middles`, `/sports/movers`, `/sports/positive-ev` — scanner pages
- `/odds/[sport]/[market]` — programmatic odds pages
- `/golf` — golf hub with `/golf/[year]`, `/golf/players/[slug]`, `/golf/tournament/{ladder,matchups,player,props}`

### Comparison + review SEO surfaces
- `/compare/[slug]` + `/compare/polymarket-vs-kalshi` — brand-vs-brand comparison pages driven by `lib/brand-profiles.ts`
- `/sportsbooks` + `/sportsbooks/[slug]` — sportsbook/exchange review pages (same registry)
- `/sportsbook-promos` — promo/affiliate offers page
- `/research/*` — long-form research articles (3 as of 2026-07)
- `/learn` + `/learn/[slug]` + `/learn/glossary` — educational content (glossary from `lib/glossary.ts`)
- `/tools/{kelly-calculator,no-vig-calculator,odds-converter,parlay-calculator}` — free calculator tools
- `/about`, `/press`, `/contact`, `/data`

### Authenticated user surfaces
- `/dashboard` — tier-aware home
- `/alerts` — alert rules (Pro: manual email rules; Elite: smart presets + SMS)
- `/bets` — bet tracking (Elite) with `lib/bet-score.ts`
- `/clv-leaderboard` — closing-line-value leaderboard
- `/watchlist` (API at `/api/watchlist`) — bookmark teams/players
- `/settings` + `/settings/api-keys` — account + API key management
- `/redeem/[code]` — invite/promo code redemption (`lib/invites.ts`)
- `/unsubscribe` — email prefs

### Embeds + public API
- `/embed/*` — embeddable widgets (`biggest-edges`, `event`)
- `/api/v1/{odds,edges,golf}` + `/api/v1/openapi.json` — public REST API, Bearer-key auth via `lib/api-auth.ts`, key CRUD at `/api/keys`
- `/api/docs` — API documentation

### Admin (`ADMIN_EMAILS` env gate, default kenny@hyder.me — `lib/admin.ts` `requireAdmin()`)
- `/admin` — hub
- `/admin/affiliates` — Vault Network revenue dashboard
- `/admin/distribute` — content distribution
- `/admin/invites` — invite code management
- `/admin/sharp-engage` — sharp-user engagement
- `/admin/users` — user management

## Key libs (lib/)

| File | Role |
|---|---|
| `tiers.ts` | UI + API tier definitions, price-ID resolution (env-trimmed) |
| `tier-guard.ts` | Server-side tier resolution — re-reads tier per request |
| `brand-profiles.ts` | **Centralized brand registry** (9 slugs: kalshi, polymarket, draftkings, fanduel, betmgm, caesars, fanatics, betrivers, circa). Feeds /compare, /sportsbooks reviews, JSON-LD Organization markup for AI overviews. Facts have `asOf` dates — re-verify before compliance-sensitive copy |
| `sports-data.ts`, `golf-data.ts`, `movements-data.ts`, `props-data.ts`, `matchup-data.ts`, `sportsbook-comparison-data.ts` | Server-side data access — fetch from the hyder.me data plane |
| `redirects.ts` | Middleware redirect lookup (see below — the 504 fix) |
| `vault.ts` | Vault Network affiliate API client |
| `affiliates.ts` | Affiliate URLs + promo constants per brand |
| `books.ts`, `kalshi.ts` | Book metadata + Kalshi helpers |
| `alert-rules.ts`, `email-templates.ts` | Alerting + transactional email |
| `api-auth.ts`, `admin.ts`, `invites.ts` | API-key auth, admin gate, invite codes |
| `seo.tsx`, `slug.ts`, `indexnow.ts`, `glossary.ts` | SEO metadata/JSON-LD, slugs, IndexNow pings, glossary |
| `analytics.ts`, `track-event.ts` | GA4 events — push to `window.dataLayer` directly, never `gtag()` (race-y) |
| `stripe.ts` | Stripe SDK accessor (defensive `.trim()` on key) |
| `supabase/` | Browser / server / middleware clients (`@supabase/ssr` — never share across contexts) |
| `device.ts` | iOS detection for Polymarket promo gating |

## Data plane (hyder-media parent repo)

This app is UI + auth + billing only. **All ingestion, cron jobs, and alert detection run on the `hyder.me` Vercel project** in the parent repo:

- `lib/golf-data.ts` + `lib/sports-data.ts` fetch from `https://hyder.me/api/golfodds/*` and `https://hyder.me/api/sports/*` (host overridable via `GOLFODDS_API_HOST` / `NEXT_PUBLIC_DATA_HOST`)
- Ingest tables (`golfodds_*`, `sports_*`) live in the shared Supabase project but are written only by the parent repo's crons (Kalshi, Polymarket, DataGolf, The Odds API)
- Shared odds math / name normalization lives at `hyder-media/api/_platform/` — don't duplicate it here
- Three canaries (`cron-route-canary`, `cron-data-freshness`, `cron-coverage-check`) in the parent repo watch the data plane
- App-owned tables are prefixed `sb_*` (subscriptions, preferences, billing, api_keys, alert rules, bets, watchlist, invites, redirects, etc. — schemas in `scripts/*.sql`)

## Middleware + redirects — the June 18 504 lesson

`middleware.ts` runs `checkRedirect()` (from `lib/redirects.ts`) FIRST, then the Supabase session refresh (`lib/supabase/middleware.ts`).

`checkRedirect` looks up `sb_url_redirects` (exact-match table) via Supabase REST on every page request. Hardening (commit `b9c362c1`, 2026-06-18):

1. **1.2s hard timeout, fail OPEN** — a slow Supabase must never stall rendering. Previously this fetch had no timeout; a slow Supabase hung the middleware on EVERY request and the gateway 504'd site-wide before the page could render.
2. **In-memory micro-cache per edge isolate** (60s TTL, 5s negative-cache on error, 4k-entry cap). The Next Data Cache does NOT apply to fetches inside middleware — without this cache every page load was a live Supabase round-trip. Negative caching matters most (most paths have no redirect row).
3. **Pattern-based "smart" fallbacks are DISABLED and forbidden** (`smartFallback` returns null). An earlier version 301'd live `/sports/<league>/<year>/<slug>` etc. URLs to their parents — catastrophic for SEO/UX. Only the DB-backed exact-match table may redirect. See memory `route-health-rules.md`.

**Next 16 deprecation**: Next prefers `proxy.ts` over `middleware.ts`. Functionally identical for now; rename eventually.

## Deploy

- **Git-linked to the hyder-media repo** (Vercel root directory: `sportsbookish/`). **Push to `main` → auto-deploys.** Do NOT run `vercel --prod` locally.
- One push rebuilds both `hyder.me` (parent) and `sportsbookish.com` (this app).
- Local dev: `npm run dev` (http://localhost:3000)
- Schema migration: edit the relevant `scripts/*-schema.sql` (idempotent), apply via psql session-mode pooler (`aws-0-us-west-2.pooler.supabase.com` — port 5432 for DDL like `CREATE INDEX CONCURRENTLY`; 6543 transaction mode fails on those)
- Stripe products/webhooks: `scripts/setup-stripe-products.mjs` + `scripts/setup-stripe-webhook.mjs` (idempotent; run with `sk_test_*` for test mode)

### Environment variables (Vercel project `sportsbookish` + `.env.local`)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase (RLS-enforced; also used by middleware redirect lookup) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Server-side privileged (webhook, admin) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **`sk_live_*` in prod — real charges** |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ELITE` | UI-tier Price IDs ($10/mo, $100/yr) |
| `STRIPE_PRICE_API_MONTHLY` / `STRIPE_PRICE_API_ANNUAL` | API add-on Price IDs ($50/mo, $500/yr) |
| `NEXT_PUBLIC_SITE_URL` | `https://sportsbookish.com` |
| `RESEND_API_KEY` / `RESEND_FROM` | Transactional email |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Elite SMS alerts |
| `VAULT_API_KEY` | Vault Network affiliate API |
| `AFFILIATE_*_URL` | Per-brand affiliate URL overrides (POLYMARKET, KALSHI, DRAFTKINGS, FANDUEL, BETMGM, CAESARS, FANATICS, BETRIVERS) |
| `ADMIN_EMAILS` | Comma-separated admin allowlist (default `kenny@hyder.me`) |
| `CRON_SECRET` | Bearer auth for cron-invoked routes |
| `GOLFODDS_API_HOST` / `NEXT_PUBLIC_DATA_HOST` | Data-plane host override (default `https://hyder.me`) |
| `SPORTSBOOKISH_API_KEY` | Internal/shared API key |
| `SB_SMART_404_FALLBACK` | Set `0` to disable smart fallback (currently a no-op anyway — see redirects) |

**Adding env vars**: use `printf %s "value" | vercel env add NAME production` — `echo` bakes a trailing `\n` into the value, which corrupts Stripe/Vault auth headers ("connection error, retried 2 times" = local header corruption, not network). All `STRIPE_*`, `VAULT_API_KEY`, and price-ID reads are defensively `.trim()`'d; do the same for any new secret.

## Pre-deploy checklist (run before every push touching UI / routes / nav / data layer)

```bash
# 1. TypeScript
npx tsc --noEmit

# 2. Build
npm run build

# 3. Security headers (post-deploy, against live URL)
curl -sI https://sportsbookish.com | grep -iE "^(strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy):"

# 4. W3C validation (post-deploy)
curl -s https://sportsbookish.com | curl -s --data-binary @- -H "Content-Type: text/html" "https://validator.w3.org/nu/?out=json" | python3 -c "import sys,json;r=json.load(sys.stdin);print(f'errors: {len([m for m in r[\"messages\"] if m[\"type\"]==\"error\"])}, warnings: {len([m for m in r[\"messages\"] if m.get(\"subType\")==\"warning\"])}')"

# 5. WAVE accessibility (manual: https://wave.webaim.org/extension/ or https://wave.webaim.org/api/request)

# 6. Smoke-test core flows in incognito + signed-in:
#    - / (homepage)
#    - /sports/mlb (or any in-season league)
#    - /sports/mlb/event/<id> (any active game)
#    - /golf (current tournament)
#    - /alerts (Pro+ only)
#    - /bets (Elite only)
#    - /admin (admin only)
#    - Pricing checkout (load /pricing, click Subscribe — do NOT complete payment: LIVE keys)
```

Targets: security headers 100/100 (HSTS preload, full CSP, COOP/CORP), W3C 0 errors 0 warnings, WAVE 0 errors ≤2 alerts, clean build, no broken routes. Regressions → revert or patch BEFORE merging.

**Route-health rules (MANDATORY)**: any middleware / redirect / route-shape change must pass live-URL smoke tests before AND after deploy. Pattern-based redirects matching live route shapes are forbidden — two catastrophic precedents (see Middleware section + memory `route-health-rules.md`).

## Known issues + gotchas

1. **Stripe key is LIVE** — real charges. Use `sk_test_*` + Preview-scope env for development.
2. **Stripe v22 moved period dates** — `current_period_start/end` live on `subscription.items[0]`, not the Subscription. Webhook uses `periodOf()` helper.
3. **shadcn/ui base-ui doesn't ship `asChild`** — use `buttonVariants()` class on `<Link>` instead of `<Button asChild>`. Older Next.js SaaS tutorial patterns will trip you here.
4. **Tier check at request time** — the webhook updates `sb_subscriptions.tier` immediately; any data-gating API must re-read tier per request (`lib/tier-guard.ts`), never cache at session creation.
5. **Cookies / SSR** — `@supabase/ssr` clients (browser/server/middleware) live in `lib/supabase/`; never share across contexts.
6. **`middleware.ts` → `proxy.ts` deprecation** — Next 16 warns; rename pending.
7. **Middleware fetches bypass the Next Data Cache** — hence the hand-rolled micro-cache in `lib/redirects.ts`. Don't remove it.
8. **Magic links route through Supabase project SMTP** — auth email template must reference `https://sportsbookish.com`, not the default Supabase URL.
9. **GA4 events**: push to `window.dataLayer` directly; `window.gtag` from useEffect races with `@next/third-parties/google`. Tier is passed in Stripe `success_url` so `purchase` value is correct before the webhook lands.
10. **Env vars + trailing newlines** — see Deploy section; `printf %s`, never `echo`.
11. **Futures data vendor gap** — The Odds API only exposes ~14 championship/winner futures keys; MVP/win-totals/awards/divisions aren't in the feed at any tier. Books DO publish them — never claim otherwise in user copy. `NoBooksDataNote` component renders tier-aware upsell/mailto instead.
12. **Brand-profile facts drift** — funding/valuation/volume numbers in `lib/brand-profiles.ts` carry `asOf` dates; re-verify before using in compliance-sensitive copy.
13. **Duplicate file artifact** — `lib/affiliates 2.ts` is an iCloud/macOS duplicate; the real module is `lib/affiliates.ts`. Safe to delete if it reappears.

## History

- **2026-05-12** — Phase 1: auth + Stripe + landing/pricing/signup/dashboard scaffold
- **2026-05-22** — Golf views ported, tier gating, futures expansion, GA4 events, LastUpdated freshness, AI discoverability (llms.txt, OpenAPI, HF dataset, Wikidata Q139814938)
- **2026-06-08** — Repriced $19/$39 → $10/mo / $100/yr; Polymarket affiliate wired (Vault Network)
- **2026-06-18** — Site-wide 504 incident fixed (commit `b9c362c1`): middleware redirect lookup got timeout + fail-open + micro-cache
- Since then: full production surface set (scanners, comparisons, reviews, tools, learn/research, embeds, public API v1, admin suite)

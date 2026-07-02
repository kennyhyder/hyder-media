# GolfOdds — Kalshi vs Sportsbook Outright Odds Analyzer

## Project Overview
**Product**: GolfOdds — surfaces pricing discrepancies between Kalshi event contracts, Polymarket, DataGolf's model, and traditional sportsbook outright markets for PGA Tour golf.
**Location**: `/Users/kennyhyder/Desktop/hyder-media/golfodds/`
**Tech Stack**: Next.js 16 (App Router), TypeScript, Tailwind v4, Supabase (shared `ilbovwnhrowvxjdkvrln` project)
**Deployment**: Vercel auto-deploy from GitHub (parent hyder-media repo)
**Live URL**: https://hyder.me/golfodds/ — password gate: **BIRDIE** (`sessionStorage` key `golfodds_auth`)

**GolfOdds is the DATA PLANE for sportsbookish.com.** The cron-driven ingestion + alert pipeline runs on the hyder-media Vercel project; sportsbookish.com renders golf pages by fetching `https://hyder.me/api/golfodds/*`. Any breakage here breaks the live golf surfaces on sportsbookish.com.

## Goal
For each (tournament, player, market_type) in {win, t5, t10, t20, t40, mc, r1lead, r2lead, r3lead, per-round Top-N}:
1. **Cross-source view** — compare Kalshi implied probability to each sportsbook's no-vig implied probability, DataGolf's model probability, and Polymarket. Flag mispricings sortable by edge.
2. **Internal-consistency view** — within Kalshi, check whether a golfer's implied probabilities across Win/T5/T10/T20 are monotonic (the `ladder` endpoint flags T10 > T20 violations).

## Data Sources

| Source | Cost | Markets | Books covered | Access |
|---|---|---|---|---|
| **Kalshi** | Free public API | Outrights (win/t5/t10/t20/mc/round leaders), H2H + 3-ball matchups, event props | (it IS the source — exchange) | `https://api.elections.kalshi.com/trade-api/v2`, no auth for reads |
| **DataGolf** | $30/mo Scratch+ | win, t5, t10, t20, make_cut, frl, matchups | DraftKings, FanDuel, Circa, BetMGM, Caesars, Pinnacle, bet365, BetOnline, Bovada, SkyBet, William Hill (11+) | `https://feeds.datagolf.com`, `?key=` query param |
| **Polymarket** | Free public API | winner, top5, top10, top20 (tournament-gated — markets open ~3-5 days before an event) | (exchange) | `https://gamma-api.polymarket.com`, `tag_slug=golf` |

**Critical caveat**: Kalshi's T5/T10/T20 markets are **inconsistently listed week-to-week**. They're reliable on majors but often missing on regular weekly PGA Tour events. The internal-consistency view will be sparse outside majors.

**Skipped**: The Odds API (only majors winner), Betfair Exchange (£299 one-time, future power-user add), RickRunGood (no API), direct sportsbook scraping (ToS-prohibited, all covered by DataGolf anyway).

## Architecture

- **Frontend**: Next.js static export, `basePath: /golfodds`, password gate via `public/password.html` + `scripts/post-build.js` (mirrors solar/ag2020 pattern). sportsbookish.com is the primary consumer now.
- **Backend**: Vercel serverless functions in `hyder-media/api/golfodds/*.js` — **full endpoint + cron docs in `/api/golfodds/CLAUDE.md`**.
- **DB**: Supabase, tables prefixed `golfodds_*`. Base schema in `scripts/schema.sql` (later tables added via SQL editor).
- **Ingestion**: **Fully cron-automated** (see below). The `scripts/*.mjs` ingesters were the manual V1 path and remain useful for local one-off backfills, but the serverless crons are authoritative.

## Automated Ingestion (7 Vercel crons, scheduled in root `vercel.json`)

| Cron | Schedule | Does |
|---|---|---|
| `/api/golfodds/cron-ingest-kalshi` | `*/5` | All Kalshi outright series (KXPGATOUR/MAKECUT/TOP5/TOP10/TOP20/R1LEAD) + H2H/3-ball matchups. Seeds tournaments/players/markets. |
| `/api/golfodds/cron-ingest-datagolf` | `*/10` | DataGolf outrights → per-book quotes (de-vigged) + DG model probs |
| `/api/golfodds/cron-ingest-matchup-books` | `*/10` | DataGolf matchup prices for matchups that have Kalshi twins |
| `/api/golfodds/cron-ingest-props` | `*/10` | Kalshi event props (winning score, win margin, cut line, hole-in-one, …) |
| `/api/golfodds/cron-ingest-polymarket` | `*/15` | Polymarket golf events (`tag_slug=golf`) matched to seeded markets |
| `/api/golfodds/cron-detect-alerts` | `*/5` | Kalshi-vs-book-median edge detection → `golfodds_alerts` + Resend email + Elite SMS |
| `/api/golfodds/cron-archive-tournaments` | hourly | Snapshots final prices to `golfodds_tournament_archive`, marks status=closed |

All crons authenticate with `Authorization: Bearer $CRON_SECRET` and log runs to `golfodds_cron_runs`. Freshness is watched by the `/api/seo/cron-data-freshness` canary (golf `*_latest` tables) — see `/api/seo/CLAUDE.md`.

There's also an on-demand `GET /api/golfodds/refresh-tournament` (CRON_SECRET-gated) that re-runs the Kalshi + DataGolf crons inline for the Elite "refresh" button on sportsbookish.com.

## Database Tables (all prefixed `golfodds_`)

Core:
| Table | Purpose |
|---|---|
| `golfodds_tournaments` | One row per event. slug + season_year, Kalshi event_ticker + DG event_id, status ∈ {upcoming, open, closed}. |
| `golfodds_players` | Canonical golfer identities. `dg_id` cross-source key, `normalized_name`, `slug`, `owgr_rank`. |
| `golfodds_player_aliases` | Name reconciliation across Kalshi/DG/books. |
| `golfodds_markets` | (tournament, player, market_type) tuple — the join key for every quote row. |
| `golfodds_kalshi_quotes` / `golfodds_book_quotes` / `golfodds_dg_model` / `golfodds_polymarket_quotes` | Append-only time series per source. |
| `golfodds_kalshi_latest` / `golfodds_book_latest` / `golfodds_dg_latest` / `golfodds_polymarket_latest` | **Trigger-maintained latest-row tables** — the read path. Replaced the slow `_v_latest_*` DISTINCT ON views that were timing out at the pooler. |
| `golfodds_polymarket_events_map` | Polymarket event slug → tournament_id mapping. |

Matchups/props/ops:
| Table | Purpose |
|---|---|
| `golfodds_matchups` + `golfodds_matchup_players` | H2H / 3-ball matchup definitions + legs. |
| `golfodds_matchup_kalshi_quotes` / `_latest`, `golfodds_matchup_book_quotes` / `_latest` | Matchup price series + latest. |
| `golfodds_props` + `golfodds_prop_outcomes` + `golfodds_prop_quotes` / `golfodds_prop_latest` | Event-style props (one question, N outcomes). |
| `golfodds_alerts` | Edge alerts fired by cron-detect-alerts. |
| `golfodds_tournament_archive` | `final_snapshot` JSONB per closed tournament. |
| `golfodds_cron_runs` | Per-run cron log (job_name, rows_inserted, errors). |
| `golfodds_data_sources` | Source registry + last_import timestamps. |

## Setup

```bash
cd /Users/kennyhyder/Desktop/hyder-media/golfodds
npm install

# Env (root .env.local / Vercel): DATAGOLF_API_KEY, SUPABASE_URL,
# SUPABASE_SERVICE_KEY, CRON_SECRET, RESEND_API_KEY, ALERT_EMAIL_TO.

# Local dev / static build
npm run dev          # http://localhost:3000/golfodds/
npm run build        # Static export → out/ → moved to golfodds/ by post-build.js

# Manual backfill (legacy scripts — crons normally handle this):
npm run ingest:kalshi
npm run ingest:datagolf

# Force a live re-ingest without waiting for the cron tick:
curl -H "Authorization: Bearer $CRON_SECRET" https://hyder.me/api/golfodds/cron-ingest-kalshi
```

## API Endpoints

See **`/api/golfodds/CLAUDE.md`** for the full inventory (comparison, tournaments, tournament-info, matchups, props, ladder, player pages, alerts, archive, refresh, 7 crons) plus gotchas. All endpoints use `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (NOT the `NEXT_PUBLIC_*` ones — documented hyder-media gotcha for serverless functions).

## Key Decisions

- **Kalshi is the central focus** — every other source is a benchmark for "what should the price be".
- **DataGolf is the only sportsbook source** — covers all 5 books the client cares about (FD, DK, Circa, BetMGM, Caesars) plus Pinnacle for a sharp anchor. Skips ToS/scraping mess.
- **All quotes are append-only time series**; reads go through the trigger-maintained `*_latest` tables.
- **Markets table is the join key** — every quote row, every dg_model row, every analysis joins through `golfodds_markets`.
- **Kalshi seeds; others match** — DataGolf/Polymarket ingesters resolve against tournaments/markets the Kalshi cron created (Polymarket never auto-creates tournaments). Sponsor-laden DG/Polymarket names route through `api/golfodds/_tournament_resolver.js`.
- **Odds math / name normalization live in `api/_platform/`** (odds.js, names.js, constants.js) — never re-copy them into the golf pipeline.
- **Best-effort weekly coverage** — Kalshi's T5/T10/T20 will be sparse outside majors. Accepted per scope decision.
- **Password gate same pattern as solar/ag2020** — sessionStorage `golfodds_auth`, password `BIRDIE`.

## Open Items (V2+)

1. **Kalshi WebSocket** — for live tournament play, subscribe to `wss://api.elections.kalshi.com/trade-api/ws/v2` `orderbook_delta` channel (crons currently poll REST every 5 min).
2. **Historical backfill** — Kalshi `/historical/markets/{ticker}/candlesticks` returns OHLC. Useful for back-testing whether Kalshi mispricings closed into tournament start.
3. **Player alias table** — `golfodds_player_aliases` exists but matching still leans on `normalized_name`; record aliases on first mismatch.

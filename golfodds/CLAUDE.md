# GolfOdds — Kalshi vs Sportsbook Outright Odds Analyzer

## Project Overview
**Product**: GolfOdds — surfaces pricing discrepancies between Kalshi event contracts and traditional sportsbook outright markets for PGA Tour golf.
**Location**: `/Users/kennyhyder/Desktop/hyder-media/golfodds/`
**Tech Stack**: Next.js 16 (App Router), TypeScript, Tailwind v4, Supabase (shared `ilbovwnhrowvxjdkvrln` project)
**Deployment**: Vercel auto-deploy from GitHub (parent hyder-media repo)
**Live URL (post-deploy)**: https://hyder.me/golfodds/ — password gate: **BIRDIE** (`sessionStorage` key `golfodds_auth`)

## Goal
For each (tournament, player, market_type) in {win, t5, t10, t20, mc}:
1. **Cross-source view** — compare Kalshi implied probability to each sportsbook's no-vig implied probability and DataGolf's model probability. Flag mispricings sortable by edge.
2. **Internal-consistency view** — within Kalshi (or within a single book), check whether a golfer's implied probabilities across Win/T5/T10/T20 are consistent. If Kalshi's T20 implies a lower finishing probability than its own T10, that's a mispricing too.

## Data Sources

| Source | Cost | Markets | Books covered | Access |
|---|---|---|---|---|
| **Kalshi** | Free public API | Outright winner, sometimes T5/T10/T20, make/miss cut | (it IS the source — exchange) | `https://api.elections.kalshi.com/trade-api/v2`, no auth for reads |
| **DataGolf** | $30/mo Scratch+ | win, t5, t10, t20, make_cut, matchups | DraftKings, FanDuel, Circa, BetMGM, Caesars, Pinnacle, bet365, BetOnline, Bovada, SkyBet, William Hill (11+) | `https://feeds.datagolf.com`, `?key=` query param |

**Critical caveat**: Kalshi's T5/T10/T20 markets are **inconsistently listed week-to-week**. They're reliable on majors but often missing on regular weekly PGA Tour events. The internal-consistency view will be sparse outside majors.

**Skipped for V1**: The Odds API (only majors winner), Betfair Exchange (£299 one-time, future power-user add), RickRunGood (no API), direct sportsbook scraping (ToS-prohibited, all covered by DataGolf anyway).

## Architecture

- **Frontend**: Next.js static export, `basePath: /golfodds`, password gate via `public/password.html` + `scripts/post-build.js` (mirrors solar/ag2020 pattern).
- **Backend**: Vercel serverless functions in `/api/golfodds/*.js` (NOT in this directory — they live in `hyder-media/api/golfodds/` per repo convention).
- **DB**: Supabase, tables prefixed `golfodds_*`. Schema in `scripts/schema.sql`.
- **Ingestion**: Standalone Node ESM scripts in `scripts/`. Idempotent. Manual runs for V1.

## Database Tables (all prefixed `golfodds_`)

| Table | Purpose |
|---|---|
| `golfodds_tournaments` | One row per event. Linked to Kalshi event_ticker + DataGolf event_id. |
| `golfodds_players` | Canonical golfer identities. `dg_id` is the cross-source key. |
| `golfodds_player_aliases` | Name reconciliation across Kalshi/DG/books. |
| `golfodds_markets` | (tournament, player, market_type) tuple. market_type ∈ {win, t5, t10, t20, mc, frl}. |
| `golfodds_kalshi_quotes` | Append-only time series of Kalshi yes_bid/yes_ask/last/volume/OI. |
| `golfodds_book_quotes` | Append-only time series of per-book American/decimal/implied/no-vig probs. |
| `golfodds_dg_model` | DataGolf's baseline + course-fit probabilities (their "fair line"). |
| `golfodds_data_sources` | Source registry + last_import timestamps. |

Views: `golfodds_v_latest_kalshi`, `golfodds_v_latest_books`, `golfodds_v_latest_dg` — most recent snapshot per market/(market+book). Frontend reads these via the comparison API.

## Setup

```bash
cd /Users/kennyhyder/Desktop/hyder-media/golfodds
npm install

# 1) Add to /Users/kennyhyder/Desktop/hyder-media/.env.local:
#    DATAGOLF_API_KEY=<your scratch+ key>
#    (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY should already be set)

# 2) Paste scripts/schema.sql into the Supabase SQL editor (project ilbovwnhrowvxjdkvrln).
#    Creates 7 tables + 3 views + seeds golfodds_data_sources.

# 3) First ingestion runs
npm run ingest:kalshi
npm run ingest:datagolf

# 4) Local dev / static build
npm run dev          # http://localhost:3000/golfodds/
npm run build        # Static export → out/ → moved to golfodds/ by post-build.js
```

## Ingestion Scripts

### `scripts/ingest-kalshi.mjs`
- Pulls all open events under series `KXPGATOUR`.
- For each event: fetches nested markets, upserts tournament/player/market rows, inserts a fresh quote snapshot.
- Classifies market_type by parsing event title / market subtitle (matches `top 5 / top 10 / top 20 / make cut`; default `win`).
- Extracts golfer name from `yes_sub_title`.
- Idempotent: tournaments/players/markets upserted on natural keys; quotes are append-only by design (time series).

### `scripts/ingest-datagolf.mjs`
- For each market type (`win`, `top_5`, `top_10`, `top_20`, `make_cut`), calls `/betting-tools/outrights?tour=pga&market=…&odds_format=american`.
- Stores one `golfodds_book_quotes` row per (market, book) and one `golfodds_dg_model` row per market with DataGolf's `baseline` / `baseline_history_fit`.
- **De-vigs per book per market**: for Top-N markets the field's probabilities should sum to N (not 1); script scales each book's raw implied probs so the field sums to the expected outcome count.
- 1.5s sleep between market calls (rate limit is 45 req/min; we're nowhere near it).

## API Endpoints (`/api/golfodds/` — in the root `api/` directory)

| Endpoint | Returns |
|---|---|
| `GET /api/golfodds/tournaments` | Most recent 50 tournaments with Kalshi+DG IDs |
| `GET /api/golfodds/comparison?tournament_id=<uuid>&market_type=win` | Per-player Kalshi/DG/book quotes + edge fields for this tournament |

Both use the `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars (NOT the `NEXT_PUBLIC_*` ones — that's the documented hyder-media gotcha for serverless functions).

## Open Decisions (V2+)

1. **Internal-consistency math** — what counts as a "mispricing" between Win and T20? Need to convert each Kalshi market to a per-golfer finishing-position survival curve and compare. Start naive: flag any player where Kalshi's T20 prob < its own T10 prob (impossible — T20 must >= T10).
2. **Player name reconciliation** — `golfodds_player_aliases` is created but unused. First time a name appears that doesn't match normalized_name, record an alias.
3. **Scheduled ingestion** — V1 is manual. V2 candidates: GitHub Actions cron, Vercel Cron (paid Pro feature, you have it), or self-pinged `/api/golfodds/sync` endpoint.
4. **Kalshi WebSocket** — for live tournament play, subscribe to `wss://api.elections.kalshi.com/trade-api/ws/v2` `orderbook_delta` channel.
5. **Historical backfill** — Kalshi `/historical/markets/{ticker}/candlesticks` returns OHLC. Useful for back-testing whether Kalshi mispricings closed into tournament start.

## Key Decisions

- **Kalshi is the central focus** — every other source is a benchmark for "what should the price be".
- **DataGolf is the only sportsbook source** — covers all 5 books the client cares about (FD, DK, Circa, BetMGM, Caesars) plus Pinnacle for a sharp anchor. Skips ToS/scraping mess.
- **All quotes are append-only time series**, not upserts. Use the `_v_latest_*` views for current state.
- **Markets table is the join key** — every quote row, every dg_model row, every analysis joins through `golfodds_markets`.
- **Best-effort weekly coverage** — Kalshi's T5/T10/T20 will be sparse outside majors. Accepted per scope decision.
- **Password gate same pattern as solar/ag2020** — sessionStorage `golfodds_auth`, password `BIRDIE`.

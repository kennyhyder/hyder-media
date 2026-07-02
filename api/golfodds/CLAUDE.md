# api/golfodds — GolfOdds Serverless Backend

Vercel serverless functions powering the golf data plane. Consumed by
https://hyder.me/golfodds/ and (primarily) sportsbookish.com's golf pages,
which fetch `https://hyder.me/api/golfodds/*`. Project-level context in
`/golfodds/CLAUDE.md`.

All DB tables are prefixed `golfodds_*` in the shared Supabase project
(`ilbovwnhrowvxjdkvrln`). Functions use `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
(never `NEXT_PUBLIC_*` — those don't exist server-side in api routes).

## Read Endpoints (public, CORS `*`, edge-cached `s-maxage=30, swr=120` unless noted)

| Endpoint | Returns |
|---|---|
| `tournaments` | Most recent 50 tournaments (slug, dates, status, Kalshi/DG ids) |
| `tournament-info?id=` | Per-tournament metadata: player count, books seen, which market_types have data per source (drives tab dimming in UI) |
| `tournament-by-slug?year=&slug=` (or `?id=` reverse-resolve) | Canonical tournament lookup for /golf/[year]/[slug] routes |
| `comparison?tournament_id=&market_type=win` | Per-player Kalshi vs DG model vs per-book no-vig vs Polymarket, with `edge_vs_books_median`, `edge_vs_best_book`, `edge_vs_dg`, `edge_vs_polymarket`, `best_book_for_bet` |
| `ladder?tournament_id=` | Per-player probability ladder across market types; flags monotonicity violations (T10 > T20 = internal Kalshi mispricing) |
| `matchups?tournament_id=&type=h2h\|3ball` | Matchup markets: 2–5 player legs, Kalshi + per-book quotes, edge vs book median |
| `props?tournament_id=` | Multi-outcome props (winning score, win margin, cut line, …) with Kalshi price per outcome |
| `players` | All golfers with slugs, OWGR-sorted (sitemap generator + indexes) |
| `player?player_id=&tournament_id=` | Every market + matchup for one player at one tournament |
| `player-by-slug?slug=` | Player + markets across all active tournaments, with `data_status` per market (powers SEO-ranked /golf/players/[slug] pages) |
| `alerts?tournament_id=&since_hours=&direction=` | Recent golf edge alerts + last 50 `golfodds_cron_runs` (ops visibility) |
| `all-alerts?since_hours=` | Golf alerts + `sports_alerts` merged into one chronological feed (feeds daily digest); re-filters phantom mid-tournament-resolved alerts |
| `archived-tournaments?year=` | Closed tournaments + `has_archive` flag |
| `tournament-archive?id=` or `?year=&slug=` | Closing `final_snapshot` JSONB for an archived tournament (cached 1h) |
| `refresh-tournament?tournament_id=` | **CRON_SECRET-gated.** Re-runs Kalshi + DataGolf crons inline via res-shim (Elite refresh button on sportsbookish.com proxies to this). ~3–10s |

## Cron Handlers (schedules in root `vercel.json`)

| Handler | Schedule | Writes |
|---|---|---|
| `cron-ingest-kalshi` | `*/5` | Kalshi outrights (series KXPGATOUR, KXPGAMAKECUT, KXPGATOP5/10/20, KXPGAR1LEAD) + matchups (KXPGAH2H, KXPGA3BALL). Seeds `golfodds_tournaments` / `_players` / `_markets`; appends `_kalshi_quotes`, `_matchup_kalshi_quotes` |
| `cron-ingest-datagolf` | `*/10` | DG `/betting-tools/outrights` per market (win/top_5/top_10/top_20/make_cut/frl) → `_book_quotes` (per-book, de-vigged via `devigToSum`) + `_dg_model` |
| `cron-ingest-matchup-books` | `*/10` | DG `/betting-tools/matchups` → `_matchup_book_quotes`, but ONLY for matchups that already have a Kalshi twin (book-only matchups have no comparison value) |
| `cron-ingest-props` | `*/10` | Kalshi event-prop series (KXPGAWINNINGSCORE, WINMARGIN, CUTLINE, HOLEINONE, BOGEYFREE, EAGLE, BIRDIES, …) → `_props` / `_prop_outcomes` / `_prop_quotes` |
| `cron-ingest-polymarket` | `*/15` | Polymarket golf events → `_polymarket_quotes` + `_polymarket_events_map`. Never auto-creates tournaments (`allowCreate: false`) |
| `cron-detect-alerts` | `*/5` | Kalshi vs book-median edges (buy ≥ +2%, sell ≤ −3%, ≥3 books) → `golfodds_alerts`, Resend email to `ALERT_EMAIL_TO`, Twilio SMS to Elite users with sms channel enabled. 30-min dedupe window |
| `cron-archive-tournaments` | hourly | Tournaments past end_date + 24h → `final_snapshot` JSONB in `_tournament_archive`, status=closed |

**Auth pattern**: every cron (and `refresh-tournament`) checks
`Authorization: Bearer ${CRON_SECRET}` (some also accept `?secret=`).
If `CRON_SECRET` is unset the check FAILS CLOSED (401) — set it locally for dev. Test:
`curl -H "Authorization: Bearer $CRON_SECRET" https://hyder.me/api/golfodds/cron-ingest-kalshi`.
Crons log to `golfodds_cron_runs`; the `/api/seo/cron-data-freshness` canary
watches the golf `*_latest` tables and alerts if ingest stalls.

## Shared Modules

- `_tournament_resolver.js` (local, underscore = not routed) — resolves sponsor-laden DataGolf/Polymarket tournament names ("the Memorial Tournament presented by Workday") to the canonical Kalshi-seeded row. Order: explicit alias → exact → normalized (sponsor patterns stripped) against open/upcoming rows → create (only if `allowCreate`). Without it, DG data lands in orphan duplicate tournament rows and the user-facing row stays empty. Add hard cases to `EXPLICIT_ALIASES`.
- `../_platform/odds.js` — `americanToDecimal`, `decimalToImplied`, `devigToSum` (datagolf), `devigProbs` (matchup-books). **Never re-copy odds math**; this lib exists because sports+golf drifted into 3–5 independent copies.
- `../_platform/names.js` — `normalizeName` (kalshi, datagolf, matchup-books), `normalizeNameUnicode` (polymarket — NFD-stripped for external-source matching).
- `../_platform/constants.js` — `STALE_THRESHOLD_MS` (30 min); `comparison.js` drops DG/book/Polymarket quotes older than this.
- `../sports/_book_classification.js` — `isRegulatedUS`, `bucketBookPriceMap`, `bucketBookEntries` used by comparison/matchups/player endpoints.

## Gotchas

- **Polymarket filter is `tag_slug=golf`, NOT `tag=golf`** — `tag=` does not filter at all on the Gamma API; you'd ingest every event on Polymarket.
- **Sponsor-name resolution**: any new ingest source that carries tournament names MUST go through `_tournament_resolver.js`. Polymarket titles also need prefix/suffix stripping first ("PGA Tour: … Winner").
- **Book-key bucketing ("5 Other columns" bug, fixed 2026-06-02)**: `comparison.js`'s `books` array must contain BUCKETED keys (regulated names + at most one `"other"`), not raw quote keys. Raw offshore keys (bovada, mybookie, lowvig, betonline, betus) each render as "Other" in the UI's `bookLabel()`, producing 5 duplicate Other columns. Same bug class as the May `sports/events.js` fix — apply the rule to any new endpoint that emits a book list.
- **Read from `*_latest` tables, not the `_v_latest_*` views** — the DISTINCT ON views time out at the Supabase pooler statement_timeout; the `_latest` tables are trigger-maintained on insert.
- **Supabase REST limits**: 1000 rows/query and ~100–200 ids per `.in()` (URL length). Use the `fetchAllIn` chunk-and-page helper; chunks run sequentially per view (parallel chunks overwhelmed the pooler).
- **Mid-tournament-resolving markets** (mc, r1lead/r2lead/r3lead, t40) settle during play; Kalshi pins to ~0.01/0.99 while stale book lines linger → phantom 70–90% "edges". `cron-detect-alerts` skips them at write time and `all-alerts` re-filters defensively at read time.
- **Kalshi seeds everything** — DataGolf/Polymarket/matchup-books only attach data to markets the Kalshi cron created. If a tournament looks empty, check the Kalshi cron first.

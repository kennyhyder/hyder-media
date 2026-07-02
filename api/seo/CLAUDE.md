# api/seo — Observability Canaries + SEO Automation

Cron-driven observability for the whole hyder-media data plane (sports +
golf + sportsbookish.com) plus SEO plumbing. All handlers authenticate with
`Authorization: Bearer ${CRON_SECRET}` (check passes if the env var is unset,
for local dev). Alerts go via **Resend → kenny@hyder.me** (from
`alerts@sportsbookish.com`). Schedules live in root `vercel.json`.

## The 7 Crons

| Handler | Schedule | Checks |
|---|---|---|
| `cron-route-canary` | `*/15` | Every critical sportsbookish.com URL returns **200**: ~35 static canaries (home, pricing, league hubs, odds/research/embed/tools pages) + live event/tournament slugs sampled from the DB at runtime so they don't bit-rot. Uses GET with `redirect: "manual"` — a 301 is a failure (this is the net for the 2026-05-31 middleware bug that silently 301'd every event page for 3 days). Logs to `sb_route_health` |
| `cron-data-freshness` | `*/15` | `MAX(fetched_at)` (via latest-row select, O(1) on the index) on every critical ingest table: `sports_quotes`, `sports_book_quotes`, `sports_polymarket_quotes`, `golfodds_kalshi_latest`, `golfodds_dg_latest`, `golfodds_book_latest`, `golfodds_polymarket_latest`, `sports_alerts`. Stale threshold ≈ cron cycle × 3–4. Golf Polymarket has a `skipUnless` gate (only checked when a tournament is open/within 5 days — Polymarket genuinely has no golf data between events). Logs to `sb_data_freshness_log` |
| `cron-coverage-check` | hourly | Infrastructure drift: (1) every `vercel.json` `crons[].path` URL is deployed — probes each URL; 404/5xx = failure, 401 = healthy-and-deployed. Imports vercel.json via JSON import because each Vercel function bundle is isolated (`fs` can't see sibling files). (2) Every critical Postgres table exists (`select('*').limit(0)`; only error code `42P01` counts as missing — RLS/timeout errors are transient). Logs to `sb_coverage_log` |
| `cron-health-check` | daily 12:00 UTC | Slower whole-system checks: sitemap reachable + URL count, HuggingFace dataset `lastModified` < 36h, latest sports quote/book-quote recency, contestant slug coverage ≥ 95% |
| `cron-sitemap-diff` | every 6h | Snapshots `/sitemap.xml` paths (in `sb_kv`); any URL that disappears gets an auto 301 registered in `sb_url_redirects` — same-day redirect instead of waiting weeks for GSC to find the 404. Fallback rules are deliberately empty: pattern rules previously matched LIVE route shapes and hijacked real pages (see route-health-rules memory) |
| `cron-indexnow-sweep` | weekly Sun 03:00 UTC | Pings IndexNow (Bing/Yandex/Naver/Seznam) with every canonical sportsbookish.com URL (static + glossary + leagues + open events + tournaments + contestants + golfers), batched 10k/call |
| `cron-keep-warm` | every minute | GETs the heaviest data-plane endpoints (golfodds comparison × every market type on the active tournament, matchups/props/ladder, sports events per league) so `s-maxage=30, swr=120` CDN cache stays hot and users never eat a 6–9s cold miss. Warms sequentially to avoid slamming the Supabase pooler |

## Tables

- `sb_route_health` — one row per route-canary run (total, failures, failure detail JSONB)
- `sb_data_freshness_log` — one row per freshness run (per-table status detail)
- `sb_coverage_log` — one row per coverage run (cron_ok / table_ok + failure arrays)
- `sb_url_redirects` — auto- and manually-registered 301s consumed by sportsbookish middleware
- `sb_kv` — key/value store (sitemap snapshot lives at key `sitemap_snapshot_paths`)

## The 2nd-Consecutive-Failure Rule (anti-spam)

The three canaries (route, freshness, coverage) never alert on a single bad
run. Each run is logged; on failure, the handler reads the **previous** log
row and only emails for failures that also appeared there (matched by
`status|url`, table name, or `kind:path/table`). One transient 502 or a
missed cron tick self-heals silently; two consecutive hits on the same check
means something is actually broken. False alarms erode trust — keep this
pattern in any new canary.

## Design Lessons (why this exists in this shape)

1. **A 200 is not "up."** Three failure classes need three independent
   canaries: a URL can 4xx/301 (route canary), a URL can 200 with data frozen
   for hours (freshness canary), and the infra powering both can drift —
   schedule typos, dropped tables (coverage canary). Each has actually
   occurred on this platform.
2. **`count('exact')` times out on big tables.** Past ~1M rows the count
   query blows the 10s serverless limit, returns null → coalesces to 0 →
   false alerts. Freshness checks use latest-row recency instead:
   `select fetched_at order by fetched_at desc limit 1` — O(1) with the
   `fetched_at DESC` index. Add that index to any table growing >100k rows/day.
3. **The coverage canary exists because of a real miss**: on 2026-06-02,
   `cron-data-freshness` shipped with its vercel.json schedule entry never
   making it into the commit — the cron silently didn't run. The coverage
   check probes every scheduled cron URL hourly so a schedule↔file mismatch
   can't hide again (it caught this exact bug on its first deploy).
4. **Probe deployed URLs, not the filesystem.** Vercel gives each function an
   isolated bundle — sibling `api/` files aren't in `/var/task`, so `stat()`
   checks are meaningless. Fetch the URL; 401 (no CRON_SECRET supplied)
   proves the function is deployed.
5. **No pattern-based redirect fallbacks.** cron-sitemap-diff's
   `FALLBACK_RULES` was emptied after pattern rules matched live route shapes
   and registered redirects that hijacked live event/tournament pages.

Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`,
`RESEND_API_KEY` (trim-read; alerts are best-effort if missing).
Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://hyder.me/api/seo/cron-coverage-check`.

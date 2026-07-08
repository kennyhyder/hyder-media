# Hyder Media Project Context

## Project Overview
This repository contains multiple interconnected projects for Kenny Hyder's digital marketing consultancy at hyder.me.

**The full stack extends beyond this repo** — see `~/.claude/CLAUDE.md` (global stack registry, loaded every session) and Mission Control (mc.hyder.me, repo `kennyhyder/mission-control`). Notable external projects: **mission-control** (control center), **marksearch.ai** (`~/Desktop/USPTOsearch`), **tradebot** (DO droplet), **subredmonitor.com**, **automatedojo** (own repo, lives at `automatedojo/` here).

## Monorepo top-level map
| Dir | What | Live | Docs |
|---|---|---|---|
| `/` (root html) | hyder.me site + tools + /playbook + /about + /capabilities | hyder.me | `docs/claude/repo-structure.md` |
| `api/` | ~19 serverless namespaces, 39 crons (sports, golfodds, seo canaries, ag2020, digistore, omicron, vita-brevis, solar, grid-legacy, _platform shared libs) | hyder.me/api/* | per-dir CLAUDE.md |
| `clients/` | Client dashboards (ag2020, digistore24, omicron, vita-brevis, falconlabs, dunham, autoaddiction, affiliati) | hyder.me/clients/* | `clients/*/CLAUDE.md` |
| `sportsbookish/` | Odds-comparison SaaS — git-linked, own Vercel project | sportsbookish.com | `sportsbookish/CLAUDE.md` |
| `grid/` | **GridCensus** (ex-GridScout) — standalone SaaS, own Supabase (`hzaqzbtyqqixmibcfuwo`), own Vercel project | gridcensus.com | `grid/CLAUDE.md` |
| `golfodds/` | Golf odds frontend; data plane for sportsbookish (crons in `api/golfodds/`) | hyder.me/golfodds | `golfodds/CLAUDE.md` |
| `automatedojo/` | AutomateDojo SaaS — **own git repo** nested here | automatedojo.com | `automatedojo/CLAUDE.md` |
| `solar/` | SolarTrack DB (Blue Water Battery) | hyder.me/solar | `solar/CLAUDE.md` |
| `tokens/` | Opportunity Framework (static, stable) | hyder.me/tokens | `docs/claude/repo-structure.md` |
| `decks/` | Pitch decks: framework, auto-glass, gridscout, ag2020-investor, ai-strategy | hyder.me/decks/* | `docs/claude/repo-structure.md` |
| `docs/`, `downloads/`, `scripts/`, `watch-faces/`, `cv/`, `moving-checklist/` | Docs, playbook bundle, data scripts, Garmin faces, expert-witness CV, misc | — | — |

## Doc index (content moved out of this file, 2026-07)
Subdirectory CLAUDE.md files auto-load when working in those dirs — per-project detail lives there:
- **Digistore24 CI suite + reporting** (auth, 31K-keyword data model, import scripts, troubleshooting) → `clients/digistore24/CLAUDE.md`
- **Omicron dashboard** (9-account structure, brand/non-brand classification, APIs, auth) → `clients/omicron/CLAUDE.md`
- **AG2020 platform** (Supabase auth, attribution, halo lift, autodialer, pipelines, investor deck, rebuild/deploy) → `clients/ag2020/CLAUDE.md`
- **Vita Brevis** → `clients/vita-brevis/CLAUDE.md`
- **Detailed directory structure** (root pages, api file listings, tokens, assets, decks, tech stack, vercel.json timeout table, commands reference) → `docs/claude/repo-structure.md`
- **Reusable Patterns Library** (Vercel ESM→CJS, Supabase/Postgres perf, Stripe gotchas, SEO freshness, GA4 events, AI discoverability, health checks, speed-to-lead autodialer, `/api/_platform/` shared libs, full pre-deploy checklist) → `docs/claude/patterns-library.md`
- **Recent Changes Log** (2026-02 → 2026-06 history) → `docs/claude/changes-log.md`
- **Playbook product** (three-tier model, live assets, chapters) → `docs/claude/playbook-product.md`

## Git workflow / deploy
- Main branch: `main`; GitHub repo: `kennyhyder/hyder-media`
- **Deploys automatically to Vercel on push to GitHub** — DO NOT use `vercel --prod` from local
- Process: edit → `git add` → `git commit` → `git push origin main` → Vercel auto-deploys
- If production doesn't update after push: check Vercel dashboard; may need `vercel alias <deployment-url> hyder.me`
- **Never use `until curl; do sleep; done` deploy-verification loops** — zombie loops caused a $425 BigQuery bill. Verify with single requests.

## iCloud file eviction gotcha
Desktop syncs to iCloud Drive; large files (e.g. `clients/digistore24/data/keywords-combined.json`) get "evicted" — replaced with `.icloud` placeholders — and `" 2"`-suffixed duplicates appear. **Git is the source of truth; all data files are committed.** Restore: `git checkout HEAD -- <file>` or force download: `brctl download <file>`. Deploy from GitHub auto-deploy, never rely on local copies persisting.

## Env / config essentials
- **Supabase project (shared):** ilbovwnhrowvxjdkvrln.supabase.co — shared by client portal, AG2020, Omicron, AutomateDojo (`9dm_*`), SportsBookISH (`sb_*`), solar (`solar_*`). GridCensus has its own (`hzaqzbtyqqixmibcfuwo`).
- **Serverless env naming:** use `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `api/*.js` (NOT `NEXT_PUBLIC_*` — that's client-side Next.js only).
- **Google Ads API:** v23 (all endpoints use `/v23/`). MCC: 673-698-8718. Developer token: Basic Access approved. Google Cloud project #: 132234777258. Keyword Planner batch size MUST be 15.
- **Vercel:** Pro plan, team `kennys-projects-93847471`. Vercel env vars: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC) / SUPABASE_URL / SUPABASE_SERVICE_KEY. Set secrets with `printf %s` (never `echo` — trailing `\n` corruption); `.trim()` env reads defensively.
- **Local `.env.local`:** EMAIL_USER=kenny@hyder.me, EMAIL_PASS=[app password], ADMIN_EMAIL=kenny@hyder.me
- **vercel.json** holds function timeouts (10–60s) + cron schedules — full table in `docs/claude/repo-structure.md`. New crons: protect with CRON_SECRET (fail-closed) + register in the freshness canary.
- **Supabase pooler:** port 5432 (session mode) for DDL like CREATE INDEX CONCURRENTLY; region us-west-2. Avoid `count('exact')` on >1M-row tables.

## Client dashboard passwords (sessionStorage gates unless noted)
- Digistore24: TR8FFIC
- Omicron: ~~LIEHAO~~ → migrated to Supabase Auth + MFA (see `clients/omicron/CLAUDE.md`)
- AG2020: ~~AG2020FLOW~~ → migrated to Supabase Auth (see `clients/ag2020/CLAUDE.md`)
- Vita Brevis: VITABREVIS
- SolarTrack: CHECKITOUT · Dunham & Jones: DUNHAMJONES · Falcon Labs: THANKYOU · GolfOdds: BIRDIE

## Three-canary observability (`/api/seo/`, live 2026-06-03)
- `cron-route-canary.js` (every 15 min) — every critical URL returns 200; alerts on 2nd-consecutive 4xx/5xx
- `cron-data-freshness.js` (every 15 min) — every critical ingest table has had a write in the last cron-cycle×3; alerts on 2nd-consecutive stale
- `cron-coverage-check.js` (hourly) — every scheduled cron URL is deployed (not 404/5xx) + every critical Postgres table exists; alerts on 2nd-consecutive same-kind drift
- All three persist to `sb_route_health`, `sb_data_freshness_log`, `sb_coverage_log` and alert via Resend to kenny@hyder.me. The trio caught a real bug on first deploy (a scheduled-but-uncommitted cron).

## Pre-deploy checklist (short)
Before pushing changes that touch UI / routes / nav / data layer: `npx tsc --noEmit` → `npm run build` → post-deploy verify security headers (target 100/100), W3C (0 errors/0 warnings), WAVE (0 errors, ≤2 alerts), smoke-test core flows incognito + signed-in. Full commands + smoke-test list: `docs/claude/patterns-library.md` § Pre-deploy verification. Any regression → revert or patch BEFORE merging.

## Important notes
1. **Don't modify root HTML files** without explicit request — they're the live hyder.me site.
2. AG2020 + solar source files are gitignored — only built output deploys; rebuild after source changes (`cd clients/ag2020 && npm run build`).
3. Cross-pipeline odds/name/constants code belongs in `/api/_platform/` — don't re-duplicate (see patterns library).
4. Deep per-repo memory: `~/.claude/projects/-Users-kennyhyder-Desktop-hyder-media/memory/MEMORY.md`.

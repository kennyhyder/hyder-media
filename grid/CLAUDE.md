# GridCensus — Datacenter Site Selection Intelligence (gridcensus.com)

## What It Is

**GridCensus** is a standalone, public SaaS that scores **164,098 candidate
datacenter locations** across the US (0–100 DC Readiness Score) on power
availability, speed-to-power, fiber, water, and hazard — built from public
infrastructure data (HIFLD, EIA, FEMA, FCC, BLS, PeeringDB, ERCOT, etc.).

- **Rebranded from GridScout → GridCensus June 2026** (see History note at bottom).
- Server-rendered **Next.js 16 App Router** (NOT a static export), TypeScript,
  Tailwind v4, Leaflet 1.9.4 (+ heat/markercluster), Supabase.
- Public — no password gate. Optional Supabase Auth accounts (claims,
  contributions, saved lists, API tokens).
- Tagline (src/lib/site.ts): "Datacenter site selection and speed-to-power intelligence".
- Contact: kenny@hyder.me. Org: Hyder Media.

## Live URLs + Deploy

- **Production**: https://gridcensus.com — own Vercel project **`gridcensus`**
  (`prj_i9YK7tmRwELHisyxKZwaVlgGHS9Q`, team `kennys-projects-93847471`), linked
  via `grid/.vercel/project.json`, root directory `grid/` in the hyder-media repo.
  Push to `main` → auto-deploys. **Never `vercel --prod` locally.**
- **Legacy**: https://hyder.me/grid/ — the old GridScout static export (build
  artifacts still sit at grid/ top level: `index.html`, `_next/`,
  `password.html`, per-route HTML dirs). Served by the root hyder-media Vercel
  project. Do not confuse these with `src/` — the app source is `grid/src/`.
- **Legacy serverless APIs**: `hyder.me/api/grid/*` (22 files in repo-root
  `/api/grid/`, timeouts in root vercel.json). Migrated equivalents live in
  `grid/src/app/api/grid/*` (19 route handlers) serving gridcensus.com
  same-origin — the CSP assumes the same-origin proxy.

## Architecture

- **next.config.ts**: server build — "ISR / dynamic routes / sitemaps need it".
  **Do NOT use `output: "standalone"`** — its node_modules copy step trips
  iCloud ENOTEMPTY on this synced Desktop dir. `turbopack.root = __dirname`
  pins the root (monorepo has its own lockfile). Full security-header +
  CSP baseline lives here too.
- **Own Supabase project**: `hzaqzbtyqqixmibcfuwo.supabase.co` (NOT the shared
  `ilbovwnhrowvxjdkvrln` project). Confirmed in `.env.local`
  (`SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL`) and pinned in the CSP
  `connect-src`.
- **Data access** (`src/lib/db.ts`, server-only, service key):
  **PostgREST aggregates are DISABLED on this project** — never use
  `.avg()/.count()` in selects. All aggregate stats come from the precomputed
  **`src/data/rollups.json`** (built by `scripts/build-rollups.mjs`); DB reads
  are only top-N lists and per-entity detail rows.
- **Auth** (`src/lib/auth.ts` + `src/middleware.ts`): Supabase Auth via
  `@supabase/ssr` chunked cookies. Middleware only refreshes tokens; route
  handlers gate via `getCurrentUser()`. Roles: `member | contributor | owner |
  enterprise | moderator | staff` with capabilities (contribute, claim,
  moderate, auto-merge at reputation ≥ 100, API use, CSV export caps
  1k/5k/100k by tier). `accountsEnabled()` degrades gracefully when
  `gc_*` tables/env are absent. Account tables prefixed **`gc_`**
  (migrations in `supabase/migrations/001–005_gc_*`).
- **Pricing** (`src/app/pricing/page.tsx`): Free $0 (public screening) /
  **Pro $249** / Enterprise custom. No Stripe — Pro + Enterprise CTAs are
  `mailto:` to kenny@hyder.me. (Mailto subjects still say "MegaWatt Site" —
  stale pre-GridCensus name, see Known issues.)
- **Demo access**: `src/lib/demoAccess.ts` + `grid_demo_tokens` /
  `grid_demo_usage` tables + `/api/grid/demo-validate`.
- Accent color: purple `#7c3aed`.

## Routes (src/app)

**Primary public pages:**
`/` (home), `/explore` (map), `/datacenter-sites`, `/datacenters`,
`/brownfield-sites`, `/rankings`, `/top-sites` (Top 100), `/companies`,
`/internet-exchanges`, `/iso`, `/substations`, `/site-types`, `/methodology`,
`/pricing`, `/api-docs`, `/preview`.

**Account/auth:** `/account`, `/(auth)/login`, `/(auth)/signup`,
`/auth/callback`, `/admin/seo`.

**API route handlers** (`src/app/api/`):
- `grid/*` — 19 data endpoints (dc-sites, dc-site, dc-stats, dc-export,
  brownfields, brownfield, ixps, county-data, county-heat, lines, line,
  corridors, corridor, substations, stats, hyperscale, map-data,
  queue-overlay, demo-validate)
- `account/*` — claim, contribute, save, signout
- `admin/seo`, `cron/gsc-pull`

**301 redirect map** (next.config.ts) folds legacy GridScout CSR routes into
the SSR redesign: `/sites→/datacenter-sites`, `/site /lines /line /corridors
/corridor /search /dashboard → /explore`, `/compare /parcels →
/datacenter-sites`, `/hyperscale→/datacenters`, `/market→/rankings`,
`/brownfield(s)→/brownfield-sites`. Don't remove — consolidates link equity.

## Database (Supabase Postgres + PostGIS, `grid_` prefix)

Core tables (record counts approximate):

| Table | Purpose |
|---|---|
| `grid_dc_sites` | **164,098 scored sites** — dc_score + 10 sub-scores, nearest substation/IXP/DC distances, ISO region, acreage |
| `grid_transmission_lines` | 52K HIFLD lines + NREL ratings + ERCOT congestion |
| `grid_substations` | 38K substations (extracted from line endpoints) |
| `grid_county_data` | 3.2K counties — FEMA NRI, BLS labor, NOAA climate, WRI water, FCC fiber, tax incentives |
| `grid_brownfield_sites` | 2K retired plants + EPA brownfields |
| `grid_ixp_facilities` | 1.4K PeeringDB IXPs/colos |
| `grid_datacenters` | 3.7K existing US datacenters |
| `grid_queue_summary` | ISO queue depth by POI |
| `grid_fiber_routes`, `grid_rail_lines`, `grid_parcels`, `grid_blm_row`, `grid_corridors`, `grid_wecc_paths`, `grid_ercot_constraints` | Enrichment layers |
| `grid_demo_tokens`, `grid_demo_usage` | Demo access system |
| `gc_*` (5 migrations) | Accounts, claims/contributions, saved lists/alerts, API tokens/reputation/activity, page overrides |

**Site types (9)** in `grid_dc_sites.site_type`: greenfield 43K, industrial
36K, substation 30K, mine 26K, federal_excess 18K, manufacturing 7.7K,
shovel_ready 2.4K, brownfield 1.4K, military_brac 26.

### DC Readiness Score (0–100)

```
DC_Score = 0.25*power + 0.20*speed_to_power + 0.15*fiber
         + 0.10*water + 0.10*hazard + 0.05*labor
         + 0.05*existing_dc + 0.05*land + 0.03*tax + 0.02*climate
```

| Sub-score | Weight | Inputs |
|---|---|---|
| Power | 25% | Substation distance, voltage, capacity |
| Speed to Power | 20% | ISO queue depth, brownfield grid bonus |
| Fiber | 15% | IXP distance, FCC BDC county fiber providers |
| Water | 10% | WRI stress score (0–5) |
| Hazard | 10% | FEMA NRI composite |
| Labor | 5% | Construction + IT employment per capita |
| Existing DC | 5% | Nearest datacenter distance |
| Land | 5% | Acreage, land type |
| Tax | 3% | State DC incentive (yes/no) |
| Climate | 2% | Cooling degree days |

Custom user weights supported via `src/lib/customScoring.ts`.

## Data Pipeline (`scripts/` — ~85 Python + Node scripts)

Phases (see `scripts/REFRESH-RUNBOOK 2.md` for refresh procedure):

1. **Infrastructure ingest**: `ingest-hifld.py` (52K lines via ArcGIS bbox
   queries, all 50 states), `enrich-dlr-capacity.py` (NREL 19GB HDF5),
   `ingest-blm-row.py`, `ingest-corridors.py`, `ingest-ercot-sced.py`,
   `seed-wecc-paths.py`, `extract-substations.py`, EIA
   substations/transmission ingests.
2. **Cross-references**: `crossref-blm-lines.py`, `crossref-corridor-lines.py`,
   `crossref-ercot-lines.py`, `crossref-brownfield-substations.py`,
   `identify-adjacent-parcels.py`.
3. **County + DC intelligence**: `ingest-fema-nri.py` (MUST run first —
   creates base county rows; all others PATCH), then BLS QCEW, NOAA climate,
   WRI water, DC incentives, `enrich-fiber-providers.py` (real FCC BDC data),
   `ingest-peeringdb.py`, `ingest-pnnl-dc.py`, `ingest-brownfields.py`,
   `ingest-iso-queues-dc.py`.
4. **Site generation + scoring**: `generate-dc-sites.py` →
   `generate-greenfield-sites.py` (order matters — greenfield uses existing
   sites as 5km exclusion zones) → mines/federal-excess/industrial/
   opportunity-zone/IRA-energy-community site generators →
   `score-dc-sites.py` (`--rescore` to re-score all; default = unscored only).
5. **Static data build**: `build-rollups.mjs` → `src/data/rollups.json`
   (all aggregate stats), `build-organizations.mjs` (company/org entities for
   `/companies` + org sitemap shards).

### Script gotchas (still true)

- **OBJECTID vs HIFLD ID**: DB `hifld_id` stores ArcGIS OBJECTID; NREL HDF5
  indexes by the separate "ID" field — `enrich-dlr-capacity.py` maps between them.
- All Python scripts: `python3 -u` for real-time output; `BATCH_SIZE = 50`
  Supabase inserts; `source_record_id UNIQUE` makes reruns idempotent.
- gridstatus ERCOT mode needs the Python 3.13 venv (`.venv/bin/python3.13`).
- NREL `SLR_A-75C.h5` is 19 GB — process locally, never serverless;
  iCloud-evictable (`brctl download` or re-fetch).
- Texas: no BLM land (excluded from ROW ingest); ERCOT is isolated (WECC
  paths don't apply); ERCOT SCED congestion is the best TX signal.
- NIETC/Section 368 shapefile downloads are unreliable — scripts fall back to
  placeholders.

## SEO Stack (autonomous loop)

- **`src/app/sitemap.ts`** — sharded sitemaps: shard 0 = static hubs/states/
  ISO/types/rankings; per-state shards for counties, site profiles, substation
  profiles; single shards for brownfields, IXPs, datacenters; org profiles
  sharded ≤50k. Index at `/sitemap-index.xml` (keep shard count in sync when
  adding entity classes). `robots.ts` explicitly allows GPTBot / PerplexityBot
  / ClaudeBot / Google-Extended etc.
- **`public/llms.txt` + `public/ai.txt`** — AI discoverability.
- **IndexNow**: key files in `public/` (`2be6d5….txt`,
  `089918….txt`) + `scripts/indexnow-ping 2.mjs`.
- **GSC loop**: daily cron `/api/cron/gsc-pull` (vercel.json, 09:00 UTC,
  `Authorization: Bearer ${CRON_SECRET}`) pulls a trailing 3-day Search
  Console window, upserts, then runs the opportunity engine
  (`src/lib/gsc/opportunities.ts`); surfaced at `/admin/seo` with per-page
  overrides (`src/lib/gsc/page-override.ts`, `gc_page_overrides`).
- **301 redirect map** from legacy CSR routes (see Routes above).
- OG images via `opengraph-image.tsx` / `src/lib/og.tsx`; entity slugs via
  `src/lib/entity-slug.ts`.

## Build & Deploy

```bash
cd /Users/kennyhyder/Desktop/hyder-media/grid
npm install
npm run dev        # local dev
npm run build      # plain `next build` — no post-build auth injection anymore
# Deploy: commit + push to main; Vercel project `gridcensus` auto-deploys
git add <files> && git commit -m "GridCensus: ..." && git push origin main
```

Env (`.env.local` + Vercel): `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (all →
`hzaqzbtyqqixmibcfuwo`), `CRON_SECRET`, GSC credentials, optional
`NEXT_PUBLIC_SITE_URL`.

## Known Issues + Gotchas

1. **Dependency advisories**: `next` is pinned at **16.1.6**, which has 4
   known advisories — **bump to 16.2.10** (`npm install next@16.2.10`, rebuild,
   smoke-test, redeploy). Run `npm audit` after.
2. **iCloud " 2"-suffixed conflict leftovers** from the June 2026 clobber
   remain in `public/` (`ai 2.txt`, `llms 2.txt`, duplicate IndexNow key),
   `scripts/` (~15 files), and `supabase/migrations/`. Cleanup needed —
   **but careful**: migrations `001–005_gc_* 2.sql`, `README 2.md`, and
   `REFRESH-RUNBOOK 2.md` exist ONLY as " 2" copies (rename, don't delete).
3. **`scripts/CLAUDE.md` is clobbered** — contains a stray claude-mem context
   dump, not real docs.
4. **Stale "MegaWatt Site" branding** in `/pricing` mailto subjects
   (pre-GridCensus working name) — replace with GridCensus.
5. **Never re-gitignore `src/`, `public/`, configs, or `src/data/`** — they
   were gitignored in the static-export era, iCloud evicted the only local
   copies (160 orphaned " 2" files), and source was recovered + permanently
   tracked in commits `43c5fda7` + `bcae3729` (June 2026). `.gitignore` has an
   explicit note about this.
6. **PostgREST aggregates disabled** — never `.avg()/.count()`; use
   `src/data/rollups.json` (rebuild via `build-rollups.mjs` after data changes).
7. **No `output: "standalone"`** — iCloud ENOTEMPTY (comment in next.config.ts).
8. **Legacy static-export artifacts** at grid/ top level (`index.html`,
   `_next/`, `password.html`, `map/`, `sites/`, …) belong to the old
   hyder.me/grid deployment — don't edit them expecting gridcensus.com changes.
9. CSP is strict (next.config.ts) — new external origins (tiles, fonts,
   analytics, Supabase) must be added there or they'll be silently blocked.

## History — GridScout Era (Mar–Jun 2026)

Originally built Mar 2026 as **GridScout**, a password-gated (GRIDSCOUT)
Next.js **static export** at hyder.me/grid targeting I Squared Capital, on the
shared `ilbovwnhrowvxjdkvrln` Supabase project, with sessionStorage auth
injected by a post-build script and 12 serverless endpoints at
`hyder.me/api/grid/*`. June 2026: rebranded to **GridCensus** (commit
`f0d70bec`), moved to its own domain, Vercel project, and Supabase project,
converted to a public server-rendered SaaS with accounts + pricing + the SEO
stack, and grew the dataset from ~40K to 164K scored sites (9 site types).
The old pitch deck remains at https://hyder.me/decks/gridscout/.

# SolarTrack - Commercial & Utility Solar Installation Database

## Project Overview

**Product**: SolarTrack - Comprehensive database of U.S. commercial and utility-scale solar installations
**Client**: Blue Water Battery (bluewaterbattery.com) - solar equipment reseller
**Location**: `/Users/kennyhyder/Desktop/hyder-media/solar/`
**Tech Stack**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (PostgreSQL + PostGIS), Leaflet maps
**Deployment**: Vercel (auto-deploy from GitHub via parent hyder-media repo)
**Live**: https://hyder.me/solar/ — password gate in `solar/password.html` (currently CHECKITOUT; verify there)

**What we're building**: Every commercial (>=25 kW) and utility-scale (>=1 MW) solar site in the U.S. — owner/developer/installer, age/size/location, all equipment (panels, inverters, racking, batteries) with specs, upgrade/repower/damage history. Target user: Blue Water Battery sourcing aging/decommissioned equipment and partnership leads. Full framing: `docs/project-protocols.md`.

**Scale (Session 37, Feb 2026)**: ~723K installations across 101 sources, ~448K equipment records, ~3.37M events. Current column-coverage stats + next steps: end of `docs/session-log.md`.

## Database facts (memorize)

- **All tables prefixed `solar_`** in the shared Supabase project `ilbovwnhrowvxjdkvrln.supabase.co` (same project as AG2020/Omicron/etc — never create unprefixed tables).
- Idempotency via `source_record_id` UNIQUE constraint on `solar_installations`; entity tables: `solar_installers` (~29K), `solar_site_owners` (~206K), `solar_manufacturers` (~2K).
- Column names: `site_type` NOT `installation_type`, `install_date` NOT `commission_date`, `mount_type` NOT `mounting_type`; `solar_data_sources.name` NOT `identifier`.
- `solar_site_events` has NO `event_subtype` or `source` column — only: id, installation_id, event_type, event_date, description, old_capacity_kw, new_capacity_kw, equipment_changed, data_source_id, created_at.
- Full schema + API endpoints + geospatial search implementation: `docs/schema-and-api.md`.

## Top operational gotchas

1. **`python3 -u` flag required** on every long-running script for real-time output (background runs show nothing otherwise).
2. **`safe_float()` everywhere** — EIA Excel has empty strings/spaces in numeric fields; bare `float()` has caused 5+ crashes.
3. **Supabase batch size = 50** for all REST inserts.
4. **`Prefer: resolution=ignore-duplicates` only works on PRIMARY KEY conflicts**, NOT unique indexes. For `source_record_id` UNIQUE INDEX, query existing IDs before inserting (pattern in `ingest-iso-spp-miso.py`) — otherwise whole batch fails on one dup.
5. **URL-encode Supabase REST params**: spaces crash without `urllib.parse.quote(str(v), safe='.*,()')`.
6. **PostgREST batch key consistency**: every dict in an insert batch must have identical keys (see `docs/session-log.md`).
7. **iCloud evicts data files** — restore with `git checkout HEAD -- solar/data/<file>` or `brctl download <file>`.
8. **lightningcss build failure** ("Cannot find lightningcss.darwin-arm64.node"): delete `node_modules`, fresh `npm install`.
9. **NOAA storms dedup**: keep only worst event per installation per year per type (hail/wind) or county matching creates millions of events.
10. **crossref-dedup.py always runs LAST** in any enrichment sequence.
11. **gridstatus needs Python >=3.10** — use the `.venv` built from `/opt/homebrew/bin/python3.13` (system Python is 3.9.6).

Full list (CEC 3-header-row CSV, CA DGStats 269 columns, IL Shines no equipment, MA PTS header row 11, TTS `--states` parallelism, etc): `docs/gotchas.md`.

## Key commands

```bash
cd /Users/kennyhyder/Desktop/hyder-media/solar

# Python deps
pip3 install python-dotenv openpyxl pyarrow

# Automated update system (staleness check + ingestion + enrichment + entity linking)
python3 -u scripts/update-all.py

# Rebuild web UI (Next.js static export + post-build auth injection), then git push to deploy
npm run build

# Data source health check (all sources, freshness/availability)
python3 -u scripts/check-data-sources.py

# Data quality audit (--fix applies installer name standardization)
python3 -u scripts/data-quality-audit.py
```

Env: `.env.local` with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. Deploy = push to GitHub (never `vercel --prod`).

Per-script invocations for the full pipeline (ingestion → enrichment → geocoding → dedup → events → satellite/NREL classification): `docs/ingestion-pipeline.md`.

## Detail index (all original CLAUDE.md content lives here)

| Doc | Contents |
|---|---|
| `docs/ingestion-pipeline.md` | Build order, Python deps, complete run-all-scripts command reference (primary ingestion, enrichment, geocoding, dedup, NOAA/CPSC events, satellite + droplet NREL classification) |
| `docs/data-sources.md` | Complete data-source registry: 7 primary sources + download URLs, enrichment sources, Feb 2026 new sources + run commands, future/researched sources, data file locations |
| `docs/gotchas.md` | Script Gotchas (Critical) — full verbatim list |
| `docs/update-schedule.md` | Regular update schedule table (monthly/quarterly/annual per source) + post-update enrichment order |
| `docs/schema-and-api.md` | All `solar_` tables, key column constraints, 12 API endpoints, geospatial (bounding box + Haversine) implementation |
| `docs/web-ui.md` | Web interface pages, key components, build process, build gotchas |
| `docs/project-protocols.md` | What We're Building / Target User (full), specs list, execution protocol, quality gates, env vars, git protocol, key decisions, decision framework |
| `docs/enrichment-history.md` | Enrichment results Feb 5-10 2026 (quick wins, ISO/NJ DEP/dedup, eGRID, GEM, LBNL, WREGIS, CPSC, NOAA, satellite tiles, health monitor, completeness assessment, NREL mount-type classification) |
| `docs/session-log.md` | Next Steps (priority order), data-gap + entity-enrichment summaries, full session-by-session log (Sessions 2-37, Feb 10-25 2026), municipal permit expansions, SEIA/parcel/FEMA/Treasury enrichment commands, final database state |

Also in `docs/` (pre-existing): `BLM_SOLAR_DLA_API.md`, `coverage-comparison-seia-ohm.md`.

<claude-mem-context>

</claude-mem-context>

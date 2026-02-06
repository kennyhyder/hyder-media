# SolarTrack - Commercial & Utility Solar Installation Database

## Project Overview

**Product**: SolarTrack - Comprehensive database of U.S. commercial and utility-scale solar installations
**Client**: Blue Water Battery (bluewaterbattery.com) - solar equipment reseller
**Location**: `/Users/kennyhyder/Desktop/hyder-media/solar/`
**Tech Stack**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (PostgreSQL + PostGIS), Leaflet maps
**Deployment**: Vercel (auto-deploy from GitHub via parent hyder-media repo)

## What We're Building

A searchable database focused on **commercial and utility-scale** solar installations with:
- Every commercial (>25 kW) and utility-scale (>1 MW) solar site in the U.S.
- Site owner, developer, and installer for each installation
- Age, size, and precise location of every site
- All equipment used: panels, inverters, racking, batteries with full specs
- Upgrade history, repowers, maintenance events, and site damage records
- Equipment manufacturer and model details for resale/replacement sourcing

### Target User

Blue Water Battery needs this data to:
- Find sites with aging equipment that needs replacement
- Identify equipment models approaching end-of-life
- Source used/refurbished equipment from decommissioned or repowered sites
- Connect with installers and developers for partnership opportunities
- Understand equipment trends and market sizing

## How This Database Was Built

### Build Order (must follow this sequence)
1. **Create Supabase tables** - Run schema SQL from `specs/001-database-schema/spec.md` (all tables prefixed `solar_`)
2. **Register data sources** - Insert rows into `solar_data_sources` with name/url
3. **Run primary ingestion scripts** (any order, all idempotent via `source_record_id` UNIQUE constraint)
4. **Run enrichment scripts** (after primary ingestion, in order listed below)
5. **Build web interface** - Next.js app with API routes

### Python Dependencies
```bash
pip3 install python-dotenv openpyxl pyarrow
```

### Running All Scripts
```bash
cd /Users/kennyhyder/Desktop/hyder-media/solar

# Primary ingestion (all idempotent - safe to re-run)
npx ts-node scripts/ingest-uspvdb.ts                    # USPVDB (TypeScript)
python3 -u scripts/ingest-eia860.py                     # EIA-860
python3 -u scripts/ingest-tts.py                        # TTS (all 27 states)
python3 -u scripts/ingest-tts.py --states CA NY AZ      # TTS (specific states, parallel OK)
python3 -u scripts/ingest-ca-dgstats.py                 # CA DGStats
python3 -u scripts/ingest-ny-sun.py                     # NY-Sun
python3 -u scripts/ingest-il-shines.py                  # IL Shines
python3 -u scripts/ingest-ma-pts.py                     # MA PTS

# Enrichment (run after primary ingestion)
python3 -u scripts/quick-wins.py                        # CdTe→First Solar, orphan cleanup
python3 -u scripts/set-location-precision.py            # Flag location quality + revert zip centroids
python3 -u scripts/enrich-eia860.py                     # Owner names + retirement events
python3 -u scripts/enrich-eia860-plant.py               # Operator names + generator events
python3 -u scripts/enrich-equipment-specs.py            # CEC module/inverter specs

# Location enrichment (run after primary enrichment)
python3 -u scripts/reverse-geocode.py                   # Nominatim reverse geocoding (~3.5hr)
python3 -u scripts/crossref-osm.py                      # OSM plant proximity matching
python3 -u scripts/crossref-tts-eia.py                  # Inherit EIA addresses for TTS/CA

# Cross-source deduplication (run after all enrichment)
python3 -u scripts/crossref-dedup.py                    # Match records across sources, fill NULLs
python3 -u scripts/crossref-dedup.py --dry-run          # Preview matches without patching
python3 -u scripts/crossref-dedup.py --phase 1          # ID-based matching only
```

## Data Sources - Complete Registry

### Primary Ingestion Sources (7 sources, all free, all ingested)

| # | Source | Script | Records | Prefix | Format | Filter | Update Freq |
|---|--------|--------|---------|--------|--------|--------|-------------|
| 1 | **USPVDB** | `ingest-uspvdb.ts` | 5,712 | `uspvdb_` | GeoJSON | >=1 MW utility | Quarterly |
| 2 | **EIA-860** | `ingest-eia860.py` | 7,613 | `eia860_` | Excel ZIP | Solar fuel_code | Annual (Sept) |
| 3 | **TTS** | `ingest-tts.py` | ~61,000 | `tts3_` | Parquet | >=25 kW | Annual |
| 4 | **CA DGStats** | `ingest-ca-dgstats.py` | 23,507 | `cadg_` | CSV ZIP | >=25 kW commercial | Monthly |
| 5 | **NY-Sun** | `ingest-ny-sun.py` | 7,653 | `nysun_` | CSV | >=25 kW non-residential | Monthly |
| 6 | **IL Shines** | `ingest-il-shines.py` | 3,434 | `ilshines_` | Excel | >=25 kW (NO equipment) | Quarterly |
| 7 | **MA PTS** | `ingest-ma-pts.py` | 4,569 | `mapts_` | Excel | >=25 kW non-residential | Quarterly |

**Subtotal (7 original sources): 113,717 installations, 347,362 equipment records**

### Download URLs

| Source | URL |
|--------|-----|
| USPVDB | `https://eerscmap.usgs.gov/uspvdb/assets/data/uspvdbGeoJSON.zip` |
| EIA-860 | `https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip` |
| TTS | `s3://oedi-data-lake/tracking-the-sun/2024/` (Parquet) |
| CA DGStats | `https://www.californiadgstats.ca.gov/downloads/` (CSV ZIP) |
| NY-Sun | `https://data.ny.gov/api/views/3x8r-34rs/rows.csv?accessType=DOWNLOAD` |
| IL Shines | Manual: `https://cleanenergy.illinois.gov/download-data.html` |
| MA PTS | Manual: `https://www.masscec.com/public-records-requests` |

### Enrichment Sources (6 sources, run after primary ingestion)

| Source | Script | Purpose | Data File |
|--------|--------|---------|-----------|
| Quick Wins | `quick-wins.py` | CdTe→First Solar, orphan cleanup | DB records only |
| Census ZCTA | `geocode-zips.py` | Zip→lat/long geocoding | `data/zcta_centroids.txt` |
| EIA-860 Owner | `enrich-eia860.py` | Owner names (Schedule 4) + retirement events | `data/eia860_2024/4___Owner_Y2024.xlsx` + `3_3_Solar_Y2024.xlsx` |
| EIA-860 Plant | `enrich-eia860-plant.py` | Operator names + generator events | `data/eia860_2024/2___Plant_Y2024.xlsx` + `3_1_Generator_Y2024.xlsx` |
| CEC Modules | `enrich-equipment-specs.py` | Panel wattage/efficiency/technology | `data/cec_specs/CEC_Modules.csv` |
| CEC Inverters | `enrich-equipment-specs.py` | Inverter capacity/voltage/specs | `data/cec_specs/CEC_Inverters.csv` |
| Nominatim | `reverse-geocode.py` | Reverse geocode coords→address | Free API (1 req/sec) |
| OSM Solar | `fetch-osm-solar.py` + `crossref-osm.py` | Name/operator enrichment | Overpass API (free) → `data/osm_solar_farms.json` |
| TTS↔EIA | `crossref-tts-eia.py` | Inherit EIA-860 addresses for TTS/CA | DB cross-reference |
| Cross-Source Dedup | `crossref-dedup.py` | Match records across 10 sources, fill NULLs bidirectionally | DB cross-reference (3 phases) |

**CEC Spec Downloads:**
- Modules: `https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Modules.csv`
- Inverters: `https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Inverters.csv`

### New Data Sources (Feb 6, 2026 - INGESTED)

| # | Source | Script | Records | Prefix | Notes |
|---|--------|--------|---------|--------|-------|
| 8 | **LBNL Utility** | `ingest-lbnl-utility.py` | 1,725 + 1,725 equip | `lbnl_` | Utility-scale with cost/developer data |
| 9 | **EIA-860M** | `ingest-eia860m.py` | 9,516 | `eia860m_` | Monthly generators (operating+planned+retired+canceled) |
| 10 | **ISO Queues** | `ingest-iso-queues.py` | 431 | `iso_` | CAISO (294) + NYISO (137). Developer names! |

**Grand Total: ~125,389 installations, ~349,087 equipment records, 10 data sources**

### Running New Scripts
```bash
python3 -u scripts/ingest-lbnl-utility.py           # LBNL utility-scale
python3 -u scripts/ingest-eia860m.py                # EIA-860M monthly
python3 -u scripts/ingest-iso-queues.py             # Auto: CAISO + NYISO
python3 -u scripts/ingest-iso-queues.py --iso caiso # Single ISO
python3 -u scripts/ingest-iso-queues.py --all       # All 7 ISOs (incl. manual)
```

### Future Sources (researched, not yet ingested)

**ISO Queues (manual download needed)**:
- PJM (Queue Scope web app), ERCOT (MIS portal login), MISO (interactive export), SPP, ISO-NE
- `gridstatus` library can programmatically access all 7 ISOs

**Additional Free**:
- CEC Equipment Full Data (updated 3x/month)
- PUDL (Public Utility Data Liberation) - pre-cleaned EIA + FERC data

**Paid (if budget allows)**:
- Ohm Analytics (9/10, equipment per site, ~$30K), PVEL (7/10, reliability data, $5-15K)
- ATTOM Data (7/10, property owner, pay-per-query), SEIA (5/10, $1K/yr)

## Data File Locations

```
solar/data/
├── uspvdb_extract/          # USPVDB GeoJSON (iCloud-evictable)
├── eia860_2024/             # EIA-860 Excel files
│   ├── 2___Plant_Y2024.xlsx
│   ├── 3_1_Generator_Y2024.xlsx
│   ├── 3_3_Solar_Y2024.xlsx
│   ├── 4___Owner_Y2024.xlsx
│   └── ...other sheets
├── tts_2024/                # TTS Parquet files by state (27 dirs)
├── ca_dgstats/              # CA DGStats CSVs (5 files: PGE x2, SCE x2, SDGE)
├── ny_sun/                  # NY-Sun CSV
├── il_shines/               # IL Shines Excel
├── ma_pts/                  # MA PTS Excel
├── cec_specs/               # CEC equipment databases
│   ├── CEC_Modules.csv      # 20,743 panel models
│   └── CEC_Inverters.csv    # 2,084 inverter models
└── zcta_centroids.txt       # Census ZCTA geocoding file (33,144 zips)
```

**WARNING**: Data files get iCloud-evicted. Restore from git: `git checkout HEAD -- solar/data/<file>`

## Script Gotchas (Critical)

- **URL encoding**: Supabase REST params with spaces crash without `urllib.parse.quote(str(v), safe='.*,()')`
- **Batch size = 50**: All scripts use BATCH_SIZE = 50 for Supabase inserts
- **`Prefer: resolution=ignore-duplicates`**: All POSTs use this for rerun safety
- **safe_float()**: EIA Excel has empty strings/spaces in numeric fields - ALWAYS use try/except. Caused 5+ crashes.
- **Column names**: `site_type` NOT `installation_type`, `install_date` NOT `commission_date`, `mount_type` NOT `mounting_type`
- **data_sources table**: `name` column NOT `identifier`
- **TTS parallel**: Accepts `--states AZ CA NY` CLI args for parallel workers (27 states total)
- **Python -u flag**: Required for background scripts to show real-time output
- **CEC CSV**: Has 3 header rows (names, units, SAM fields) - skip 2 after DictReader
- **CA DGStats**: 269 columns, up to 8 module arrays and 64 inverter arrays per site
- **IL Shines**: NO equipment data at all
- **MA PTS**: Header at row 11, data row 12. Has manufacturer but NO model numbers

## Regular Update Schedule

| Task | Frequency | Script | Download New? |
|------|-----------|--------|--------------|
| CA DGStats | Monthly | `ingest-ca-dgstats.py` | Yes - re-download ZIP |
| NY-Sun | Monthly | `ingest-ny-sun.py` | Yes - auto-downloads |
| CEC Specs | Monthly | `enrich-equipment-specs.py` | Yes - re-download CSVs |
| Geocoding | After ingestion | `geocode-zips.py` | No |
| USPVDB | Quarterly | `ingest-uspvdb.ts` | Yes - new GeoJSON |
| IL Shines | Quarterly | `ingest-il-shines.py` | Yes - manual download |
| MA PTS | Quarterly | `ingest-ma-pts.py` | Yes - manual download |
| EIA-860 | Annually (Sept) | `ingest-eia860.py` + enrichment | Yes - new ZIP |
| TTS | Annually | `ingest-tts.py` | Yes - new Parquet |

**Post-update enrichment order**: set-location-precision.py → enrich-equipment-specs.py → EIA enrichment scripts (only after annual EIA update) → reverse-geocode.py → crossref-osm.py → crossref-tts-eia.py → **crossref-dedup.py** (always run last)

## Database Schema (Supabase PostgreSQL + PostGIS)

### Tables (all prefixed `solar_`)
- `solar_installations` - Core site data (41 columns: location, capacity, dates, type, owner/developer/operator/installer, location_precision, crossref_ids)
- `solar_equipment` - Panel, inverter, racking, battery records per installation (21 columns)
- `solar_site_owners` - Owner/developer/operator entities
- `solar_installers` - Installer companies with stats
- `solar_site_events` - Upgrades, repowers, maintenance, damage records
- `solar_data_sources` - Provenance tracking

### Key Column Constraints
- `source_record_id`: UNIQUE - prevents duplicate records (prefixed: `uspvdb_`, `eia860_`, `tts3_`, `cadg_`, `nysun_`, `ilshines_`, `mapts_`)
- `installation_id`: FK to solar_installations on equipment and events
- `location`: PostGIS geometry for geospatial queries
- `location_precision`: TEXT enum ('exact', 'address', 'city', 'zip', 'county', 'state') - data quality flag
- `crossref_ids`: JSONB array of source_record_ids from other sources matching the same physical site

## API (Vercel Serverless Functions)
- `GET /api/solar/installations` - Paginated list with filters + geospatial search (near_lat/near_lng/radius_miles)
- `GET /api/solar/installation?id=X` - Single site with all equipment and events
- `GET /api/solar/equipment` - Search by manufacturer/model across all sites
- `GET /api/solar/installers` - Installer directory with portfolio stats
- `GET /api/solar/stats` - Aggregate statistics and market data
- `GET /api/solar/export` - CSV export of filtered results

### Geospatial Search Implementation
- Uses bounding box + Haversine distance calculation (no PostGIS RPC needed)
- API filters by lat/lng bounding box in Supabase, then calculates exact distances in JS
- Results include `distance_miles` field and are sorted by proximity
- Migration file exists at `supabase/migrations/20260206130000_solar_nearby_function.sql` for future PostGIS RPC upgrade

## Web Interface (Next.js + Tailwind) - BUILT

All 5 pages built and deployed as static export:

| Page | Route | File | Features |
|------|-------|------|----------|
| Dashboard | `/solar/` | `src/app/page.tsx` | Stats cards, state bar chart, site type breakdown, tech list, data sources |
| Search | `/solar/search/` | `src/app/search/page.tsx` | 12 filters (text/state/type/size/date/installer/owner + geospatial near-me), sortable table, Leaflet map toggle, CSV export, pagination, URL param support |
| Equipment | `/solar/equipment/` | `src/app/equipment/page.tsx` | 6 filters (manufacturer/model/type/state/age), sortable table, pagination, URL param deep-linking |
| Site Detail | `/solar/site/?id=X` | `src/app/site/page.tsx` | Full details, Leaflet map, equipment table with manufacturer links, events timeline, owner/installer cross-links |
| Installers | `/solar/installers/` | `src/app/installers/page.tsx` | Search by name/state, sort by count/capacity/recent, card layout with portfolio stats |

### Key Components
- **InstallationMap** (`src/components/InstallationMap.tsx`) - Leaflet map with circle markers color-coded by site type (utility=blue, commercial=green, community=purple), size by capacity, popup with details, fits bounds to markers, limited to 1000 markers for performance
- **Dynamic imports**: Map uses `next/dynamic` with `ssr: false` since Leaflet requires `window`
- **URL param support**: Search, Equipment pages read `useSearchParams()` for deep-linking from Site Detail
- **Geospatial search**: "Use Location" button gets browser geolocation, radius picker (10-200 mi), shows distance column + auto-opens map

### Build Process
```bash
cd /Users/kennyhyder/Desktop/hyder-media/solar
npm install
npm run build   # next build + post-build auth injection + move to solar/
```

Build generates static HTML at: `solar/index.html`, `solar/search/index.html`, etc.
Post-build injects sessionStorage auth check and copies `password.html`.

### Build Gotchas
- **Turbopack workspace warning**: Harmless - detects parent `package-lock.json`. Add `turbopack.root` to config to silence.
- **lightningcss native module**: If build fails with "Cannot find lightningcss.darwin-arm64.node", delete `node_modules` and `npm install` fresh
- **Leaflet TypeScript**: Map component uses `any` types for Leaflet map instance (dynamic import doesn't type well)

## Specs

Read these in order:
1. `specs/001-database-schema/spec.md` - PostgreSQL + PostGIS schema
2. `specs/002-data-ingestion/spec.md` - Download and import scripts
3. `specs/003-api-endpoints/spec.md` - REST API
4. `specs/004-web-interface/spec.md` - Search UI with map
5. `specs/005-deployment/spec.md` - Vercel deployment

## Execution Protocol

### For Each Spec:
1. Read the spec file completely
2. Create/update `IMPLEMENTATION_PLAN.md` with current status
3. Implement all acceptance criteria
4. Test using commands below
5. Commit changes with descriptive message
6. Proceed to next spec

### Commands
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run tests
npx tsc --noEmit     # Type check
```

### Quality Gates (before marking spec complete)
- `npm run build` succeeds
- `npm run lint` passes
- `npx tsc --noEmit` has no errors
- All acceptance criteria in spec are met

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://ilbovwnhrowvxjdkvrln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-key>
```

## Git Protocol

```bash
# After each significant change
git add <specific-files>
git commit -m "solar: description of what was done"

# Deploy (push to GitHub, Vercel auto-deploys)
git push origin main
```

## Key Decisions

- **Commercial focus**: Filter all data sources to commercial (>=25 kW) and utility (>=1 MW) only
- **Equipment is first-class**: Separate equipment table with full manufacturer/model/specs
- **Event tracking**: Site changes (repowers, upgrades, damage) tracked as events
- **Owner/developer separation**: Different entities can own, develop, and install
- **PostGIS required**: Geospatial queries for "sites within X miles"
- **Use existing Supabase**: Same project as hyder-media (ilbovwnhrowvxjdkvrln.supabase.co)
- **All tables prefixed `solar_`**: Prevents conflicts with other hyder-media tables
- **Idempotent scripts**: All use `source_record_id` UNIQUE + ignore-duplicates for safe reruns
- **CdTe = First Solar**: Safe inference, sole major manufacturer
- **ISO queues**: Best free source for developer/owner names (CAISO + NYISO ingested, 431 records)
- **Ohm Analytics**: Best paid option ($30K) for equipment-per-site data

## Decision Framework

When faced with a choice:
1. **Will it help Blue Water Battery find equipment sources?** -> Do it
2. **Is it required for MVP?** -> Do it now
3. **Is it nice-to-have?** -> Document for later
4. **Does it add complexity without clear value?** -> Skip it

## Enrichment Results (Feb 5-6, 2026)

- **Quick Wins**: 701 CdTe records → First Solar manufacturer
- **Retirement Events**: 471 events from EIA-860 "Retired and Canceled" sheet
- **Owner Import**: 3,808 ownership records → 1,335 matched → 227 USPVDB enriched
- **Generator Events**: 80 found, 80 created (uprates, derates, planned retirements/repowers)
- **CEC Module Matching**: COMPLETED - 49,085 / 233,068 panels enriched (21.1% match rate)
- **CEC Inverter Matching**: COMPLETED - 51,884 / 108,971 inverters enriched (47.6% match rate)
- **Location Precision**: COMPLETED (all 10 sources covered, script updated with LBNL + ISO steps)
  - Exact: 32,211 | City: 81,527 | Zip: 6,000 | County: 1,247 | 2,772 zip centroids reverted
  - Note: EIA-860M auto-covered by eia860_* LIKE pattern (SQL `_` wildcard matches `m`)
- **Nominatim Reverse Geocoding**: COMPLETED - 33,332 / 125,389 installations have addresses (26.6%)
  - 13,854 exact-location records geocoded, 15,179 still missing (re-run script to process remaining ~4.2hr)
  - 19,478 addresses from original source data + TTS-EIA cross-reference
- **CEC Matching Improvement**: Added manufacturer alias system to enrich-equipment-specs.py
  - Maps "Hanwha Q CELLS" → "Qcells North America" via canonical "qcells" alias
  - Strips /BFG suffix from model strings, collapses "Q CELLS" → "Qcells"
  - Root cause analysis: 55% of modules lack model numbers (unfixable), many SMA inverters discontinued from CEC
- **OSM Cross-Reference**: COMPLETED - 4,966/5,317 plants matched (93.4%), 2,348 operators added, 111 names improved
  - OSM data refreshed Feb 6: 9,753 solar plants from Overpass API
- **TTS↔EIA Cross-Reference**: COMPLETED - 13,173 TTS records now have addresses inherited from EIA-860
- **Stats API Fix**: Fixed 1000-row limit bug that showed AZ instead of CA as top state
- **CSV Export**: Built `/api/solar/export` endpoint with all search filters, up to 50K rows
- **Geospatial Search**: Added "Near Me" search to installations API + search page UI (bounding box + Haversine)
- **Data Source Record Counts**: Fixed stale counts in solar_data_sources table (TTS: 36,935→60,389, ISO: 294→431)

### New Data Sources - COMPLETED (Feb 6, 2026)
- **LBNL Utility-Scale**: 1,725 installations + 1,725 equipment created (50 NaN errors from missing EIA IDs)
  - **Bug fix**: city column had bogus numeric values (14.2, 12.5) — "city" pattern matched "capa**city**" in column header. Fixed with word-boundary matching, nulled out bad data.
- **EIA-860M Monthly**: 9,516 installations created, 0 errors (7,767 operating + 972 planned + 174 retired + 580 canceled + 23 PR)
- **ISO Queues**: 431 installations (CAISO 294 + NYISO 137, 0 errors). PJM URL dead (Queue Scope web app now)

### Cross-Source Deduplication - COMPLETED (Feb 6, 2026)
- **crossref-dedup.py**: Matches records across 10 data sources, fills NULL fields bidirectionally
- **Schema change**: Added `crossref_ids` JSONB column to `solar_installations` (default `'[]'`)
- **Phase 1 (ID-based)**: 15,030 matches — EIA↔EIA-860M (7,633), EIA↔LBNL (1,702), EIA↔USPVDB (5,695)
- **Phase 2 (Proximity)**: 11,907 matches — state+city+capacity (10,197), NY↔TTS coords (374), LBNL↔USPVDB coords (1,336)
- **Phase 3 (Broad)**: 4 cross-tier coord matches (tight 25% capacity tolerance)
- **Total**: 33,077 records enriched (26.4% of database), zero errors
- **Key enrichments**: 14,614 owner_name, 3,749 total_cost, 3,033 installer_name, 490 location upgrades
- **Bug fix**: First run had Phase 2a city-only fallback that created 688-link crossref explosion. Fixed to require capacity match. Phase 3 limited to cross-tier matches (federal vs state sources).
- **Crossref cap**: Max 20 crossref_ids per record (community solar projects can legitimately have many TTS sub-installations)
- **DB password**: `#FsW7iqg%EYX&G3M` via pooler at `aws-0-us-west-2.pooler.supabase.com:6543`

### Critical Gotcha: PostgREST Batch Key Consistency
**NEVER strip None values from batch records.** `{k: v for k, v in record.items() if v is not None}` causes PGRST102 "All object keys must match" errors. All objects in a batch POST must have identical keys. This broke EIA-860M, LBNL, and ISO Queues scripts initially.


<claude-mem-context>
# Recent Activity

### Feb 5, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #51 | 7:18 PM | 🔵 | Solar CLAUDE.md Updated 8 Hours After Other Documentation | ~356 |
</claude-mem-context>
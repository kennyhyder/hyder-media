# GridScout - Transmission Infrastructure Intelligence

## Project Overview

**Product**: GridScout - Database of underutilized transmission lines and transmission-ready land parcels
**Target Customer**: I Squared Capital (isquaredcapital.com) - $55B infrastructure investment firm
**Location**: `/Users/kennyhyder/Desktop/hyder-media/grid/`
**URL**: https://hyder.me/grid/ (password: GRIDSCOUT)
**Tech Stack**: Next.js 16.1.6 (App Router), TypeScript, Tailwind CSS v4, Supabase (PostgreSQL + PostGIS), Leaflet 1.9.4 maps
**Deployment**: Vercel (auto-deploy from GitHub via parent hyder-media repo)
**Accent Color**: Purple (#7c3aed)

## What We're Building

A searchable database of transmission infrastructure in the western United States, focused on identifying:
- **69-138 kV transmission lines** rated ~50-100 MW (candidates for 150 MW reconductoring/upgrade)
- **Land parcels** adjacent to those lines with identified owners
- **Pre-approved federal energy corridors** (BLM Section 368, NIETC) where permitting is streamlined
- **ERCOT congestion data** showing which Texas lines are economically constrained (high shadow prices)
- **BLM Solar Designated Leasing Areas** near identified transmission lines
- **WECC path ratings** showing western interconnection transfer limits

### Target User

I Squared Capital needs this data to:
- Identify underutilized transmission assets for infrastructure investment
- Find land with existing transmission access for renewable energy development
- Target 75 MW lines in west Texas that could be upgraded to 150 MW via reconductoring
- Evaluate transmission corridors in the Southwest (NM, AZ, NV, CO, UT)
- Understand congestion economics (which upgrades create the most value)

### Geographic Focus (8 Target States)

| State | Priority | Key Focus Areas |
|-------|----------|----------------|
| **Texas (ERCOT)** | PRIMARY | West TX / Permian Basin -- 102+ GW generation in queue, massive transmission bottleneck |
| **New Mexico** | PRIMARY | BLM lands + NIETC Southwestern Grid Connector corridor |
| **Arizona** | SECONDARY | BLM solar zones, WECC paths |
| **Nevada** | SECONDARY | BLM lands, Clark County corridor |
| **Colorado** | SECONDARY | NIETC corridor, BLM lands |
| **Utah** | SECONDARY | BLM ROW grants |
| **Wyoming** | TERTIARY | BLM ROW grants |
| **California** | TERTIARY | CAISO queue congestion analysis |

## Database Schema (Supabase PostgreSQL + PostGIS)

All tables prefixed `grid_` to avoid conflicts with `solar_` and other hyder-media tables.
Uses same Supabase project as SolarTrack: `ilbovwnhrowvxjdkvrln.supabase.co`

### Tables (8 total)

| # | Table | Purpose | Source Script | Defined In |
|---|-------|---------|---------------|------------|
| 1 | `grid_data_sources` | Provenance tracking (8 registered sources) | schema.sql seed | `schema.sql` |
| 2 | `grid_transmission_lines` | HIFLD line segments + NREL ratings + ERCOT congestion | `ingest-hifld.py` | `schema.sql` |
| 3 | `grid_blm_row` | BLM right-of-way grants for transmission | `ingest-blm-row.py` | `schema.sql` |
| 4 | `grid_corridors` | Section 368 + NIETC + BLM Solar DLA boundaries | `ingest-corridors.py` | `schema.sql` |
| 5 | `grid_parcels` | Land parcels adjacent to transmission lines | `identify-adjacent-parcels.py` | `schema.sql` |
| 6 | `grid_wecc_paths` | WECC path ratings (62 paths) | `seed-wecc-paths.py` | `schema.sql` |
| 7 | `grid_ercot_constraints` | ERCOT SCED binding constraint history | `ingest-ercot-sced.py` | `schema.sql` |
| 8 | `grid_substations` | Substations extracted from line endpoints | `extract-substations.py` | **Dynamic** (created by script via psql, NOT in schema.sql) |

### Key Columns

**grid_transmission_lines** (30+ columns):
- `hifld_id` INTEGER - HIFLD OBJECTID (NOT the same as HIFLD "ID" field -- see gotchas)
- `voltage_kv`, `capacity_mw`, `static_rating_amps` - Line ratings
- `upgrade_candidate` BOOLEAN - True when 50 <= capacity_mw <= 100
- `ercot_shadow_price`, `ercot_binding_count`, `ercot_mw_limit` - Texas congestion data
- `geom` GEOMETRY(LINESTRING, 4326) - PostGIS geometry
- `geometry_wkt` TEXT - WKT fallback for non-PostGIS queries
- `sub_1`, `sub_2` - Endpoint substation names
- `naession` - Line name from HIFLD

**grid_blm_row** (cross-reference columns added by `crossref-blm-lines.py` via ALTER TABLE):
- `nearest_line_id`, `nearest_line_distance_km`, `nearest_line_voltage_kv`
- `nearest_line_capacity_mw`, `nearest_line_owner`, `near_upgrade_candidate`

**grid_corridors** (cross-reference columns added by `crossref-corridor-lines.py` via ALTER TABLE):
- `transmission_line_count`, `upgrade_candidate_count`
- `transmission_line_ids` TEXT[], `total_capacity_mw`

**grid_substations** (created dynamically by `extract-substations.py`):
- `name` TEXT, `state` TEXT, `lat`/`lng` NUMERIC
- `max_voltage_kv`, `min_voltage_kv` NUMERIC
- `owners` TEXT[], `connected_line_count` INTEGER, `connected_line_ids` UUID[]
- UNIQUE(name, state)

### Key Relationships
- `grid_parcels.transmission_line_id` -> `grid_transmission_lines.id`
- `grid_ercot_constraints` linked via constraint_name matching to line substations
- Spatial joins: line geometry <-> parcel geometry, line geometry <-> corridor boundary
- BLM ROW -> nearest transmission line via `crossref-blm-lines.py`
- Corridors -> nearby transmission lines via `crossref-corridor-lines.py`

### Indexes
- GIST indexes on all `geom` columns for spatial queries
- B-tree indexes on state, voltage_kv, capacity_mw, upgrade_candidate, hifld_id
- Partial index: `idx_grid_tl_upgrade` WHERE `upgrade_candidate = TRUE`
- ERCOT: indexes on constraint_name, shadow_price DESC, interval_start
- Unique: `(constraint_name, interval_start)` on grid_ercot_constraints

## Scripts (10 Python + 1 Node.js)

### Primary Ingestion (4 scripts)

#### 1. `ingest-hifld.py` - HIFLD Transmission Lines
- **Source**: ArcGIS REST API at `services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0`
- **Method**: Spatial bounding box queries for each of 8 target states
- **Dedup**: `seen_hifld_ids` set prevents cross-state boundary duplicates
- **Capacity estimation**: Voltage-to-capacity lookup when NREL data unavailable:
  - 69 kV -> 72 MW, 115 kV -> 140 MW, 138 kV -> 200 MW, 161 kV -> 270 MW
  - 230 kV -> 420 MW, 345 kV -> 1,230 MW, 500 kV -> 2,600 MW, 765 kV -> 5,500 MW
- **Upgrade candidate**: `True` when 50 <= capacity_mw <= 100
- **Note**: HIFLD has no STATE field -- relies on spatial bounding box queries per state
- **Source record prefix**: `hifld_`

#### 2. `ingest-blm-row.py` - BLM ROW Grants
- **Source**: BLM NLSDB ArcGIS FeatureServer at `gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0`
- **Target states**: NM, AZ, NV, CO, UT, WY, CA (7 states -- **Texas excluded**, no BLM land)
- **Filters**: TRANSMISSION LINE + DISTRIBUTION LINE commodities, excludes TELEPHONE/TELEGRAPH
- **Fields**: blm_case_id, holder_name, commodity, product, disposition, width/length/acreage, PLSS
- **Source record prefix**: `blm_row_`

#### 3. `ingest-corridors.py` - Energy Corridors (3 types)
Single script handles all three corridor types:

| Type | Source | Format | Prefix | Fallback |
|------|--------|--------|--------|----------|
| **BLM Solar DLAs** | ArcGIS REST | FeatureServer | `blm_dla_` | None (reliable) |
| **NIETC Phase 3** | `gem.anl.gov` | Shapefile ZIP | `nietc3_` | 3 placeholder records |
| **Section 368** | `corridoreis.anl.gov` | GeoJSON | `s368_` | Shapefile -> 8 placeholders |

- NIETC and Section 368 downloads are unreliable (Cloudflare blocks, URL changes)
- Script falls back to shapefile format, then hardcoded placeholder records
- Requires `geopandas` for shapefile parsing (NIETC only)
- **Source record prefix**: `blm_dla_`, `nietc3_`, `s368_`

#### 4. `ingest-ercot-sced.py` - ERCOT Binding Constraints
- **Two modes**:
  1. **gridstatus mode** (default): Uses `gridstatus` Python library. Requires `.venv/bin/python3.13`
  2. **API mode** (`--api`): ERCOT B2C OAuth. Token URL: `ercotb2c.b2clogin.com`, client_id: `fec253ea-0d06-4272-a5e6-b478baeecd70`. Report Type ID: 12302 (SCEDBTCNP686_csv)
- **CLI**: `--date YYYY-MM-DD`, `--days N` (default 7), `--api`, `--dry-run`
- **Analytics**: Prints top 10 most-frequently-binding and highest shadow price constraints
- **Dedup**: UNIQUE(constraint_name, interval_start)
- **Env vars for API mode**: `ERCOT_CLIENT_ID`, `ERCOT_CLIENT_SECRET`, `ERCOT_SUBSCRIPTION_KEY`

#### 5. `crossref-ercot-lines.py` - ERCOT Constraint → Line Cross-Reference
- **Pre-computes** ERCOT→HIFLD station name mapping (144 ERCOT stations vs 5,243 HIFLD subs)
- **Multi-strategy matching**: exact, manual mapping table, suffix stripping (SW/SRC/SWT), prefix (40% coverage), Levenshtein (≤2 edits)
- **Manual mapping table** for compressed ERCOT abbreviations (NELRIO→NELSON RIO GRANDE, SANMIGL→SAN MIGUEL, etc.)
- **Connecting-only logic**: prefers lines where BOTH endpoints match, strict single-station fallback
- **Updates**: `ercot_shadow_price` (avg $/MW), `ercot_binding_count`, `ercot_mw_limit` on `grid_transmission_lines`
- **CLI**: `--dry-run`
- **Match rate**: ~10% (34/144 ERCOT stations mapped). Most unmapped stations use internal ERCOT codes with no HIFLD equivalent.
- **Key insight**: ERCOT uses max-8-char abbreviated codes (ASHERTON, CATARINA, BRUNI) that fundamentally differ from HIFLD descriptive names. A comprehensive ERCOT→HIFLD mapping table (not publicly available) would dramatically improve match rate.

### Enrichment (3 scripts)

#### 6. `enrich-dlr-capacity.py` - NREL Dynamic Line Ratings
- **Data file**: `data/nrel_dlr/SLR_A-75C.h5` (HDF5 format, 19 GB)
- **Requires**: `pip3 install h5py numpy`
- **Formula**: `capacity_mw = sqrt(3) * voltage_kv * slr_amps / 1000`
- **Critical gotcha**: OBJECTID vs HIFLD ID mapping
  - DB stores OBJECTID in `hifld_id` column (this is what ArcGIS returns as the feature ID)
  - NREL HDF5 indexes by the HIFLD "ID" field (different from OBJECTID)
  - Script queries ArcGIS API to map OBJECTID -> ID for each line, then looks up NREL data by ID
- **Updates**: `capacity_mw`, `static_rating_amps`, `upgrade_candidate`

#### 6. `seed-wecc-paths.py` - WECC Path Ratings
- **62 WECC paths** hardcoded from 2024 Path Rating Catalog
- Each path: path_number, path_name, dir1_label (forward), mw1, dir2_label (reverse), mw2, states
- Uses `Prefer: resolution=ignore-duplicates` for idempotent reruns
- **Source record prefix**: `wecc_path_`
- **No external download** -- data manually transcribed from WECC PDF

#### 7. `extract-substations.py` - Substation Extraction
- **Creates table dynamically** via psql (grid_substations is NOT in schema.sql)
- Extracts from SUB_1/SUB_2 fields of transmission lines
- Gets coordinates from line start/end vertices via `parse_endpoint()` function on geometry_wkt
- Aggregates: max/min voltage, owners array, connected line count + IDs
- **UNIQUE(name, state)** constraint
- **DB password hardcoded**: `#FsW7iqg%EYX&G3M`

### Cross-Reference (3 scripts)

#### 8. `crossref-blm-lines.py` - BLM ROW -> Nearest Line
- Links each BLM ROW to its nearest transmission line (10 km max distance)
- **Adds columns** to grid_blm_row via psql ALTER TABLE:
  - `nearest_line_id`, `nearest_line_distance_km`, `nearest_line_voltage_kv`
  - `nearest_line_capacity_mw`, `nearest_line_owner`, `near_upgrade_candidate`
- State-based pre-filtering + Haversine distance calculation
- **DB password hardcoded**: `#FsW7iqg%EYX&G3M`

#### 9. `crossref-corridor-lines.py` - Corridor -> Nearby Lines
- Cross-references corridors with nearby transmission lines (5 km threshold)
- **Adds columns** to grid_corridors via psql ALTER TABLE:
  - `transmission_line_count`, `upgrade_candidate_count`
  - `transmission_line_ids` TEXT[], `total_capacity_mw`
- Uses bounding box rough filter then Haversine fine filter

#### 10. `identify-adjacent-parcels.py` - Parcel Identification
- For each upgrade candidate line (50-100 MW), samples points every ~1 mile
- Queries public ArcGIS parcel endpoints to find nearby parcels
- Inserts matched parcels into `grid_parcels` table
- **6 states configured** with ArcGIS parcel endpoints:
  - TX: Travis County + statewide TNRIS
  - NV: Clark County (Las Vegas)
  - AZ: Maricopa County
  - NM: Bernalillo County (Albuquerque)
  - CA: San Diego County
  - CO: statewide
  - (UT + WY: pending -- no public parcel endpoints found)
- **CLI**: `--state TX`, `--limit 10`, `--dry-run`, `--list`
- ThreadPoolExecutor: ARCGIS_WORKERS=3, SUPABASE_WORKERS=10
- Sample interval: 1 mile. Parcel search radius: ~500m bounding box

### Build Script (Node.js)

#### 11. `post-build.js` - Auth Injection + Output Move
- Copies `password.html` from `public/` to `out/`
- Injects sessionStorage auth check into ALL HTML `<head>` tags (except password.html):
  ```javascript
  (function() {
      const AUTH_KEY = 'gridscout_auth';
      if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
          window.location.href = '/grid/password.html';
      }
  })();
  ```
- Moves build output from `out/` to grid root, removes `out/` directory

## API Endpoints (5 Vercel Serverless Functions)

All endpoints in `/Users/kennyhyder/Desktop/hyder-media/api/grid/`.

### GET `/api/grid/lines`
- **Paginated list** of transmission lines with filters
- **Filters**: `state`, `min_voltage`, `max_voltage`, `min_capacity`, `max_capacity`, `upgrade_only`, `owner`, `search`
- **Search**: Matches against naession, sub_1, sub_2 (ilike)
- **Geometry**: `with_geometry=true` includes `geometry_wkt` (for map rendering). Excludes by default.
- **Limits**: 500 max with geometry, 200 max without; default 50
- **Sort**: `voltage_kv` (default), `capacity_mw`, `length_miles`, `state`, `owner`, `created_at`
- **Response**: `{ data: [...], pagination: { limit, offset, total, totalPages } }`
- **Timeout**: 30s

### GET `/api/grid/line`
- **Single line detail** by `id` (UUID) or `hifld_id` (integer)
- Returns full `SELECT *` including `geometry_wkt`
- **Timeout**: 30s

### GET `/api/grid/stats`
- **10 parallel queries** for aggregate statistics
- Returns: `total_lines`, `total_upgrade_candidates`, `total_blm_rows`, `total_corridors`, `total_substations`, `total_wecc_paths`, `lines_by_state` (top 20), `voltage_distribution` (5 buckets), `capacity_distribution` (5 buckets), `top_owners` (top 20)
- **Voltage buckets**: 0-100, 100-230, 230-345, 345-500, 500+
- **Capacity buckets**: 0-100, 100-500, 500-1000, 1000-2000, 2000+
- **Note**: Fetches up to 50,000 rows per aggregation (in-JS grouping, not SQL GROUP BY)
- **Timeout**: 60s

### GET `/api/grid/corridors`
- **Filters**: `type` (section_368, nietc, blm_row), `state` (ilike against states column)
- Returns full records with geometry
- Sorted by corridor_type ascending
- Max 200 per page
- **Timeout**: 30s

### GET `/api/grid/substations`
- **Filters**: `state`, `min_voltage` (against max_voltage_kv), `search` (ilike against name)
- Sorted by max_voltage_kv DESC
- Max 200 per page
- **Timeout**: 30s

## Web Interface (Next.js + Tailwind)

5 pages built and deployed as static export.

| Page | Route | File | Features |
|------|-------|------|----------|
| Dashboard | `/grid/` | `src/app/page.tsx` | Stats cards (lines, upgrade candidates, BLM ROWs, corridors, substations, WECC paths), state bar chart, voltage/capacity distribution, top owners |
| Lines/Search | `/grid/search/` | `src/app/search/page.tsx` | 6 filters (state, voltage range, capacity range, upgrade only, owner search, text search), sortable table, TransmissionMap with polylines, pagination |
| Corridors | `/grid/corridors/` | `src/app/corridors/page.tsx` | Type filter (Section 368 / NIETC / BLM ROW), state filter, paginated table |
| Parcels | `/grid/parcels/` | `src/app/parcels/page.tsx` | Placeholder page with disabled filter UI (state, capacity, land type, owner search) |
| Line Detail | `/grid/line/?id=X` | `src/app/line/page.tsx` | Full detail view: all line properties, upgrade candidate badge, ERCOT congestion data, TransmissionMap showing single line geometry |

### Key Components

- **TransmissionMap** (`src/components/TransmissionMap.tsx`) - Leaflet map rendering WKT polylines. Color-coded by capacity (upgrade candidates highlighted). Uses `next/dynamic` with `ssr: false`.
- **Layout** (`src/app/layout.tsx`) - Purple accent (#7c3aed), lightning bolt SVG icon, Geist/Geist_Mono fonts. 4 nav links: Dashboard, Lines, Corridors, Parcels.

### UI Details
- **State dropdown** includes: AZ, CA, CO, ID, MT, NM, NV, OR, TX, UT, WA, WY
- **Voltage ranges**: All, 0-100, 100-230, 230-345, 345-500, 500+ kV
- **Capacity ranges**: All, 0-100, 50-100 (Upgrade), 100-500, 500-1000, 1000+ MW
- **Sort options**: Voltage (asc/desc), Capacity (asc/desc), Length (longest), State (A-Z)

### Authentication
- SessionStorage-based password gate (same pattern as SolarTrack/AG2020)
- Password: **GRIDSCOUT**
- Auth key: `gridscout_auth`
- Auth check injected into `<head>` of every HTML file by post-build.js

## Data Sources

### Primary Sources (8 registered in grid_data_sources)

| # | Source | Format | Key Data | Script |
|---|--------|--------|----------|--------|
| 1 | **HIFLD Transmission Lines** | ArcGIS REST API | Line geometry, voltage, owner, substations | `ingest-hifld.py` |
| 2 | **NREL Dynamic Line Ratings** | HDF5 (19 GB) | Per-line ampacity (amps) -> MW | `enrich-dlr-capacity.py` |
| 3 | **BLM ROW Grants** | ArcGIS FeatureServer | Federal land transmission corridor rights | `ingest-blm-row.py` |
| 4 | **Section 368 Corridors** | GeoJSON/Shapefile | 5,000 mi pre-approved energy corridors | `ingest-corridors.py` |
| 5 | **ERCOT SCED Constraints** | CSV/API | Actual MW limits, shadow prices on congested lines | `ingest-ercot-sced.py` |
| 6 | **WECC Path Ratings** | Hardcoded from PDF | MW capacity for 62 western paths | `seed-wecc-paths.py` |
| 7 | **BLM Solar DLAs** | ArcGIS FeatureServer | 31M acres pre-approved for solar | `ingest-corridors.py` |
| 8 | **NIETC Phase 3** | Shapefile ZIP | Southwestern Grid Connector corridor | `ingest-corridors.py` |

### Download URLs

| Source | URL |
|--------|-----|
| HIFLD Lines | `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0` |
| NREL DLR | `https://data.openei.org/submissions/6231` (HDF5 files) |
| BLM ROW | `https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0` |
| Section 368 | `https://corridoreis.anl.gov/maps/` (Shapefile download) |
| ERCOT SCED | `https://www.ercot.com/mp/data-products/data-product-details?id=NP6-86-CD` (requires free registration) |
| WECC Paths | `https://www.wecc.org/wecc-document/19476` (2025 PDF) |
| BLM Solar DLA | `https://gbp-blm-egis.hub.arcgis.com/datasets/1d98d82820df49e5916aeb79837b69ab` |
| NIETC Phase 3 | `https://gem.anl.gov/tool/layers/potential_nietcs_phase3_241216/versions/1/download.zip` |

### Key Formulas

**MW from NREL ampacity + HIFLD voltage:**
```
capacity_mw = voltage_kv * static_rating_amps * sqrt(3) / 1000
```

**Voltage-to-capacity approximation (when NREL data unavailable):**
| Voltage | Typical MW | Used in Script |
|---------|-----------|---------------|
| 69 kV | ~70-75 MW | 72 MW |
| 115 kV | ~120-175 MW | 140 MW |
| 138 kV | ~200-300 MW | 200 MW |
| 161 kV | ~270 MW | 270 MW |
| 230 kV | ~420 MW | 420 MW |
| 345 kV | ~1,230 MW | 1,230 MW |
| 500 kV | ~2,600 MW | 2,600 MW |
| 765 kV | ~5,500 MW | 5,500 MW |

**Upgrade candidate filter:** Lines with `capacity_mw BETWEEN 50 AND 100`

## Data File Locations

```
grid/data/
├── nrel_dlr/
│   └── SLR_A-75C.h5            # NREL DLR HDF5 (19 GB, iCloud-evictable)
└── (corridor shapefiles downloaded to temp during ingestion)
```

**WARNING**: Data files get iCloud-evicted. Restore from git: `git checkout HEAD -- grid/data/<file>`

## Build & Deploy

### Build Process
```bash
cd /Users/kennyhyder/Desktop/hyder-media/grid
npm install
npm run build   # next build + post-build auth injection + move to grid/
```

Build generates static HTML at: `grid/index.html`, `grid/search/index.html`, `grid/corridors/index.html`, `grid/parcels/index.html`, `grid/line/index.html`.

**Post-build steps** (handled by `scripts/post-build.js`):
1. Copies `password.html` from `public/` to `out/`
2. Injects sessionStorage auth check into all HTML `<head>` tags (except password.html)
3. Moves `out/` contents to grid root directory
4. Removes `out/` directory

### Build Configuration

`next.config.ts`:
```typescript
{
  output: "export",
  basePath: "/grid",
  assetPrefix: "/grid",
  trailingSlash: true,
}
```

### Deploy
```bash
git add <specific-files>
git commit -m "grid: description of what was done"
git push origin main   # Vercel auto-deploys
```

**Never use `vercel --prod` locally** -- always push to GitHub for auto-deploy.

### Vercel Function Timeouts (in `vercel.json`)
| Function | Timeout |
|----------|---------|
| `api/grid/lines.js` | 30s |
| `api/grid/line.js` | 30s |
| `api/grid/stats.js` | 60s |
| `api/grid/corridors.js` | 30s |
| `api/grid/substations.js` | 30s |

## Environment Variables

```bash
# .env.local (same Supabase project as SolarTrack)
NEXT_PUBLIC_SUPABASE_URL=https://ilbovwnhrowvxjdkvrln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-key>

# ERCOT B2C API (only needed for --api mode)
ERCOT_CLIENT_ID=<client-id>
ERCOT_CLIENT_SECRET=<client-secret>
ERCOT_SUBSCRIPTION_KEY=<subscription-key>

# Google Maps (only needed for satellite tile features)
GOOGLE_MAPS_API_KEY=<key>
```

### Direct Database Access (psql)
```bash
PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres
```

## Python Dependencies

```bash
pip3 install python-dotenv h5py numpy

# For geopandas (NIETC shapefile parsing only):
pip3 install geopandas shapely

# For gridstatus ERCOT mode (requires Python 3.10+):
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install gridstatus python-dotenv
```

## Running Scripts (Complete Run Order)

### Phase 1: Schema + Core Data
```bash
cd /Users/kennyhyder/Desktop/hyder-media/grid

# 1. Create tables (run schema.sql in Supabase SQL Editor or via psql)
# All 7 tables + 8 data source seeds

# 2. Ingest HIFLD transmission lines (8 states, spatial queries)
python3 -u scripts/ingest-hifld.py

# 3. Enrich with NREL DLR capacity ratings
python3 -u scripts/enrich-dlr-capacity.py

# 4. Ingest BLM ROW grants (7 states, no TX)
python3 -u scripts/ingest-blm-row.py

# 5. Ingest corridors (3 types: BLM Solar DLA + NIETC + Section 368)
python3 -u scripts/ingest-corridors.py
```

### Phase 2: Supplementary Data
```bash
# 6. Seed WECC paths (62 hardcoded paths, idempotent)
python3 -u scripts/seed-wecc-paths.py

# 7. Ingest ERCOT SCED constraints (default: last 7 days via gridstatus)
.venv/bin/python3.13 -u scripts/ingest-ercot-sced.py
# Or specify date range:
.venv/bin/python3.13 -u scripts/ingest-ercot-sced.py --date 2026-02-01 --days 30
# Or use ERCOT B2C API instead of gridstatus:
python3 -u scripts/ingest-ercot-sced.py --api --date 2026-02-01 --days 7

# 8. Extract substations from line endpoints (creates grid_substations table)
python3 -u scripts/extract-substations.py
```

### Phase 3: Cross-References
```bash
# 9. Link BLM ROWs to nearest transmission lines (adds columns via ALTER TABLE)
python3 -u scripts/crossref-blm-lines.py

# 10. Link corridors to nearby transmission lines (adds columns via ALTER TABLE)
python3 -u scripts/crossref-corridor-lines.py

# 11. Aggregate ERCOT constraints onto transmission lines (shadow price, binding count, MW limit)
python3 -u scripts/crossref-ercot-lines.py
python3 -u scripts/crossref-ercot-lines.py --dry-run  # Preview without updating
```

### Phase 4: Land Parcels
```bash
# 11. Identify parcels adjacent to upgrade-candidate lines
python3 -u scripts/identify-adjacent-parcels.py                  # All states
python3 -u scripts/identify-adjacent-parcels.py --state TX       # Single state
python3 -u scripts/identify-adjacent-parcels.py --limit 10       # Limit lines
python3 -u scripts/identify-adjacent-parcels.py --dry-run        # Preview
python3 -u scripts/identify-adjacent-parcels.py --list           # Show endpoints
```

### Build & Deploy
```bash
# 12. Build static site
npm run build

# 13. Deploy
git add <files>
git commit -m "grid: description"
git push origin main
```

## Script Gotchas (Critical)

- **OBJECTID vs HIFLD ID**: DB `hifld_id` stores OBJECTID (what ArcGIS returns). NREL HDF5 indexes by the separate "ID" field. `enrich-dlr-capacity.py` must query ArcGIS to map between them.
- **grid_substations NOT in schema.sql**: 8th table created dynamically by `extract-substations.py` via psql. If you re-run schema.sql, substations table won't exist until the script runs.
- **Cross-reference scripts ALTER TABLE**: `crossref-blm-lines.py` and `crossref-corridor-lines.py` add columns to existing tables via psql. Run them after the base tables are populated.
- **DB password hardcoded in scripts**: Several scripts have the Supabase pooler password inline for psql operations: `#FsW7iqg%EYX&G3M`
- **Texas has NO BLM land**: `ingest-blm-row.py` excludes TX. BLM Section 368 and Solar DLAs also don't cover TX.
- **ERCOT is isolated**: Not part of Western Interconnection. WECC paths don't apply to TX.
- **NIETC/Section 368 downloads unreliable**: Shapefile URLs change, Cloudflare blocks. Scripts fall back to placeholder records.
- **gridstatus needs Python 3.13 venv**: `ingest-ercot-sced.py` gridstatus mode requires `.venv/bin/python3.13` because gridstatus needs Python >= 3.10. System Python is 3.9.6.
- **HDF5 is 19 GB**: `SLR_A-75C.h5` must be processed locally, never in serverless functions. Gets iCloud-evicted frequently.
- **stats API fetches 50K rows**: In-JS aggregation, not SQL GROUP BY. Works but could be slow with large datasets.
- **Geometry excluded by default**: Lines API omits `geometry_wkt` unless `with_geometry=true` is passed. Map mode requests geometry separately.

## Texas-Specific Notes

- **No BLM land in Texas** -- virtually all private. BLM ROW/Section 368/DLA data doesn't apply to TX.
- **ERCOT is isolated** -- not part of Western Interconnection. WECC paths don't cover TX.
- **Best TX data sources**: HIFLD lines + ERCOT SCED constraints + county parcel data
- **West Texas export constraint** is the #1 grid bottleneck -- extremely high shadow prices
- **102+ GW** of wind, solar, and battery in ERCOT queue as of 2025

### ERCOT SCED Results (Mar 5, 2026)
- **17,813 constraint records** ingested (7 days: Feb 26 - Mar 4, 2026)
- **Source**: ERCOT NP6-86-CD report (type 12302) via gridstatus library
- **Cross-referenced** to 9 transmission lines (1,721 constraints matched, 9.7% rate)
- **34/144 ERCOT stations** mapped to HIFLD substations (12 exact, 22 fuzzy/manual)
- **110 unmapped** ERCOT stations use internal abbreviated codes with no HIFLD equivalent

**Top Congested Lines:**
| Line | Binding Count | Avg Shadow Price | Avg MW Limit |
|------|:---:|:---:|:---:|
| UNKNOWN307006 - LA PALMA | 579 | $96.21/MW | 210 MW |
| TAP310548 - KLEBURG | 334 | $45.25/MW | 209 MW |
| BLESSING - SOTEX5 | 332 | $14.90/MW | 424 MW |
| SOLSTICE - BARILLA JUNCTION | 277 | $16.47/MW | 206 MW |
| UVALDE - DOWNIE | 72 | $3.36/MW | 49 MW |

## Key Differences from SolarTrack

| Aspect | SolarTrack | GridScout |
|--------|-----------|-----------|
| Focus | Solar installations | Transmission lines + land |
| Data shape | Point data (lat/lng) | Line data (polylines) + polygons |
| Primary value | Equipment aging/replacement | Upgrade potential + land access |
| Map display | Marker clusters | Polylines with color-coding by capacity |
| Target buyer | Equipment reseller | Infrastructure investor |
| Geographic scope | All US | Western US (8 states) |
| Table prefix | `solar_` | `grid_` |
| Auth key | `solartrack_auth` | `gridscout_auth` |
| Accent color | Blue (#2563eb) | Purple (#7c3aed) |
| Password | BLUEWATER | GRIDSCOUT |

## Important Notes

1. **Same Supabase project** as SolarTrack (`ilbovwnhrowvxjdkvrln.supabase.co`) -- use `grid_` table prefix
2. **Source files gitignored** -- only built output deployed (same as SolarTrack/AG2020)
3. **Password**: GRIDSCOUT (sessionStorage auth, key: `gridscout_auth`)
4. **Vercel auto-deploys** from GitHub push to main branch
5. **FERC Form 715** has the best line rating data but is CEII-restricted (requires NDA). All our sources are free/public.
6. **NREL HDF5 files are 19 GB each** -- need to process locally, not in serverless functions
7. **Line geometry** is polylines (not points like SolarTrack) -- requires different Leaflet rendering (TransmissionMap component)
8. **All Python scripts use `python3 -u`** flag for real-time output
9. **BATCH_SIZE = 50** for all Supabase inserts (same pattern as SolarTrack)
10. **source_record_id UNIQUE** constraint prevents duplicate records on rerun (all scripts idempotent)

# GridScout - Transmission Infrastructure Intelligence

## Project Overview

**Product**: GridScout - Database of underutilized transmission lines and transmission-ready land parcels
**Target Customer**: I Squared Capital (isquaredcapital.com) - $55B infrastructure investment firm
**Location**: `/Users/kennyhyder/Desktop/hyder-media/grid/`
**Tech Stack**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (PostgreSQL + PostGIS), Leaflet maps
**Deployment**: Vercel (auto-deploy from GitHub via parent hyder-media repo)
**Password**: GRIDSCOUT (sessionStorage auth, same pattern as SolarTrack/AG2020)

## What We're Building

A searchable database of transmission infrastructure in the western United States, focused on identifying:
- **69-138 kV transmission lines** rated ~50-100 MW (candidates for 150 MW reconductoring/upgrade)
- **Land parcels** adjacent to those lines with identified owners
- **Pre-approved federal energy corridors** (BLM Section 368, NIETC) where permitting is streamlined
- **ERCOT congestion data** showing which Texas lines are economically constrained (high shadow prices)
- **BLM Solar Designated Leasing Areas** near identified transmission lines

### Target User

I Squared Capital needs this data to:
- Identify underutilized transmission assets for infrastructure investment
- Find land with existing transmission access for renewable energy development
- Target 75 MW lines in west Texas that could be upgraded to 150 MW via reconductoring
- Evaluate transmission corridors in the Southwest (NM, AZ, NV, CO, UT)
- Understand congestion economics (which upgrades create the most value)

### Geographic Focus

| State | Priority | Key Focus Areas |
|-------|----------|----------------|
| **Texas (ERCOT)** | PRIMARY | West TX / Permian Basin — 102+ GW generation in queue, massive transmission bottleneck |
| **New Mexico** | PRIMARY | BLM lands + NIETC Southwestern Grid Connector corridor |
| **Arizona** | SECONDARY | BLM solar zones, WECC paths |
| **Nevada** | SECONDARY | BLM lands, Clark County corridor |
| **Colorado** | SECONDARY | NIETC corridor, BLM lands |
| **Utah** | SECONDARY | BLM ROW grants |
| **Wyoming** | TERTIARY | BLM ROW grants |
| **California** | TERTIARY | CAISO queue congestion analysis |

## Data Sources

### Primary (All Free)

| # | Source | Format | Key Data | Records (Est.) |
|---|--------|--------|----------|----------------|
| 1 | **HIFLD Transmission Lines** | ArcGIS REST API | Line geometry, voltage (kV), owner, substations | ~84K nationwide, ~15K in target states |
| 2 | **NREL Dynamic Line Ratings** | HDF5 (19 GB) | Per-line ampacity (amps) → MW conversion | ~84K lines (indexed by HIFLD ID) |
| 3 | **BLM ROW Grants** | ArcGIS FeatureServer | Federal land transmission corridor rights | ~330 transmission ROWs in target states |
| 4 | **BLM Section 368 Corridors** | Shapefile (13.7 MB) | 5,000 mi pre-approved energy corridors | ~100 corridor segments |
| 5 | **ERCOT SCED Constraints** | CSV/XML (API) | Actual MW limits, shadow prices on congested lines | Thousands of binding events/year |
| 6 | **WECC Path Ratings** | PDF | MW capacity + utilization for western paths | ~81 numbered paths |
| 7 | **BLM Solar DLAs** | ArcGIS FeatureServer | 31M acres pre-approved for solar near transmission | Polygon boundaries |
| 8 | **NIETC Phase 3** | Shapefile | Southwestern Grid Connector corridor (CO, NM) | 3 corridor areas |
| 9 | **ISO Queue Data** | (from SolarTrack) | Where developers are trying to connect | Reuse existing data |

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
| Voltage | Typical MW (short line) | Typical MW (medium line) |
|---------|------------------------|-------------------------|
| 69 kV | ~70-75 MW | ~50-60 MW |
| 115 kV | ~120-175 MW | ~100-130 MW |
| 138 kV | ~200-300 MW | ~150-200 MW |
| 230 kV | ~420 MW | ~245 MW |
| 345 kV | ~1,230 MW | ~718 MW |

**Upgrade candidate filter:** Lines with `capacity_mw BETWEEN 50 AND 100`

## Database Schema (Supabase PostgreSQL + PostGIS)

All tables prefixed `grid_` to avoid conflicts with solar_ and other hyder-media tables.

### Planned Tables

| Table | Purpose |
|-------|---------|
| `grid_transmission_lines` | HIFLD line segments + NREL ratings + ERCOT congestion |
| `grid_blm_row` | BLM right-of-way grants for transmission |
| `grid_corridors` | Section 368 + NIETC corridor boundaries |
| `grid_parcels` | Land parcels adjacent to transmission lines |
| `grid_wecc_paths` | WECC path ratings and utilization |
| `grid_ercot_constraints` | ERCOT SCED binding constraint history |
| `grid_data_sources` | Provenance tracking (same pattern as solar) |

### Key Relationships
- `grid_parcels.transmission_line_id` → `grid_transmission_lines.id`
- `grid_ercot_constraints.hifld_id` → `grid_transmission_lines.hifld_id`
- Spatial joins: line geometry ↔ parcel geometry, line geometry ↔ corridor boundary

## Web Interface (Next.js + Tailwind)

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/grid/` | Stats overview, target states, data source status |
| Lines | `/grid/search/` | Search/filter transmission lines, Leaflet map, sortable table |
| Line Detail | `/grid/line/?id=X` | Single line: capacity, congestion, adjacent parcels, upgrade potential |
| Corridors | `/grid/corridors/` | BLM Section 368, NIETC, Solar DLAs on map |
| Parcels | `/grid/parcels/` | Land parcels with owner data, filterable by line capacity/state |

## Build Process

```bash
cd /Users/kennyhyder/Desktop/hyder-media/grid
npm install
npm run build   # next build + post-build auth injection + move to grid/
```

Build generates static HTML at: `grid/index.html`, `grid/search/index.html`, etc.
Post-build injects sessionStorage auth check and copies `password.html`.

**Same pattern as SolarTrack:**
- Source files gitignored, only built output deployed
- Auth injected into `<head>` of every HTML file (except password.html)
- `out/` contents moved to project root, then `out/` deleted

## Environment Variables

```bash
# .env.local (same Supabase project as SolarTrack)
NEXT_PUBLIC_SUPABASE_URL=https://ilbovwnhrowvxjdkvrln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-key>
```

## Git Protocol

```bash
git add <specific-files>
git commit -m "grid: description of what was done"
git push origin main   # Vercel auto-deploys
```

## Python Dependencies

```bash
pip3 install python-dotenv h5py numpy pandas geopandas shapely
# h5py for reading NREL HDF5 files
# geopandas + shapely for geospatial line/parcel intersection
```

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

## Ingestion Script Plan (Priority Order)

### Phase 1: Core Transmission Data
1. `ingest-hifld.py` — Download HIFLD lines for target states, store in `grid_transmission_lines`
2. `ingest-nrel-dlr.py` — Parse NREL HDF5, join ampacity with HIFLD IDs, calculate MW
3. `ingest-blm-row.py` — Query BLM ROW FeatureServer for transmission grants

### Phase 2: Corridors + Context
4. `ingest-section368.py` — Parse Section 368 corridor shapefile
5. `ingest-nietc.py` — Parse NIETC Phase 3 shapefile
6. `ingest-blm-solar-dla.py` — Query BLM Solar DLA FeatureServer
7. `ingest-wecc-paths.py` — Manual entry from WECC PDF (or OCR parse)

### Phase 3: Congestion + Economics
8. `ingest-ercot-sced.py` — Parse ERCOT binding constraint data (CSV)
9. Cross-reference ERCOT constraints with HIFLD line IDs

### Phase 4: Land Parcels
10. Buffer transmission lines by ROW width
11. Intersect with county parcel data (reuse `enrich-parcel-owners.py` infrastructure)
12. Identify owners of adjacent land

### Phase 5: Enrichment
13. ISO queue activity near each substation (from SolarTrack data)
14. LBNL interconnection cost data
15. BLM Solar DLA overlay (flag parcels in pre-approved areas)

## Texas-Specific Notes

- **No BLM land in Texas** — virtually all private. BLM ROW/Section 368/DLA data doesn't apply to TX.
- **ERCOT is isolated** — not part of Western Interconnection. WECC paths don't cover TX.
- **Best TX data sources**: HIFLD lines + ERCOT SCED constraints + county parcel data
- **ERCOT CREZ maps** show pre-designated renewable energy transmission corridors
- **West Texas export constraint** is the #1 grid bottleneck — extremely high shadow prices
- **102+ GW** of wind, solar, and battery in ERCOT queue as of 2025

## Important Notes

1. **Same Supabase project** as SolarTrack (ilbovwnhrowvxjdkvrln.supabase.co) — use `grid_` table prefix
2. **Source files gitignored** — only built output deployed (same as SolarTrack/AG2020)
3. **Password**: GRIDSCOUT
4. **Vercel auto-deploys** from GitHub push to main branch
5. **FERC Form 715** has the best line rating data but is CEII-restricted (requires NDA). All our sources are free/public.
6. **NREL HDF5 files are 19 GB each** — need to process locally, not in serverless functions
7. **Line geometry** is polylines (not points like SolarTrack) — requires different Leaflet rendering approach

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

# For gridstatus ISO script (requires Python 3.10+):
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install gridstatus python-dotenv
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

# Additional enrichment (run after cross-references)
python3 -u scripts/enrich-egrid.py                       # EPA eGRID operator/owner names
python3 -u scripts/enrich-lbnl-queues.py                 # LBNL Queued Up developer names
python3 -u scripts/enrich-gem.py                         # GEM owner/operator names
python3 -u scripts/backfill-source-fields.py              # Recover owner/address/operator from source files
python3 -u scripts/enrich-wregis.py                       # WREGIS owner names (western US, 10,695 matches)
python3 -u scripts/enrich-wregis.py --dry-run             # Preview WREGIS matches
python3 -u scripts/enrich-wregis.py --skip-download       # Use existing Excel file

# Cross-source deduplication (run after all enrichment)
python3 -u scripts/crossref-dedup.py                    # Match records across sources, fill NULLs
python3 -u scripts/crossref-dedup.py --dry-run          # Preview matches without patching
python3 -u scripts/crossref-dedup.py --phase 1          # ID-based matching only

# Event enrichment (run after cross-references)
python3 -u scripts/enrich-noaa-storms.py                # NOAA storm events → site damage records (downloads 11yr data)
python3 -u scripts/enrich-noaa-storms.py --skip-download # Use existing downloaded CSVs
python3 -u scripts/enrich-noaa-storms.py --dry-run      # Preview matches without creating events
python3 -u scripts/enrich-cpsc-recalls.py               # CPSC equipment recalls → recall events
python3 -u scripts/enrich-cpsc-recalls.py --dry-run     # Preview recall matches

# Data source monitoring
python3 -u scripts/check-data-sources.py                # Check all 18 data sources for freshness/availability
python3 -u scripts/check-data-sources.py --json         # Save report to data/source_health_report.json

# Satellite imagery + mount type classification (requires Google Maps API key + droplet)
python3 -u scripts/fetch-satellite-images.py --location-precision exact   # Download satellite tiles (~$85, covered by free credit)
bash scripts/deploy-nrel-to-droplet.sh setup            # One-time droplet setup (conda + NREL model)
bash scripts/deploy-nrel-to-droplet.sh sync             # Rsync images + script to droplet
bash scripts/deploy-nrel-to-droplet.sh classify         # Start classification in screen session
bash scripts/deploy-nrel-to-droplet.sh status           # Check classification progress
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
| EPA eGRID | `enrich-egrid.py` | Operator + owner names from eGRID 2023 (5,658 solar plants) | `data/egrid/egrid2023_data.xlsx` |
| LBNL Queued Up | `enrich-lbnl-queues.py` | Developer names from 50+ grid operator queues | `data/lbnl_queued_up/*.xlsx` |
| GEM Solar Tracker | `enrich-gem.py` | Owner/operator names from Global Energy Monitor (>=1MW) | `data/gem/*.geojson` |
| Source Field Backfill | `backfill-source-fields.py` | Recover owner/address/operator from original source files | CA DGStats CSVs, NY-Sun CSV, TTS Parquet |
| WREGIS Owner | `enrich-wregis.py` | Owner names from western US REC tracking (10,695 matches) | `data/wregis/wregis_active_generators.xlsx` |
| NOAA Storms | `enrich-noaa-storms.py` | Hail/wind damage events cross-referenced to installations by county | `data/noaa_storms/*.csv.gz` (auto-downloaded, 11 years) |
| CPSC Recalls | `enrich-cpsc-recalls.py` | Equipment recall events matched by manufacturer+model | Hardcoded 7 known solar recalls |
| Data Source Monitor | `check-data-sources.py` | Health check for all 18 data sources (freshness, availability) | Reads DB + checks URLs |
| PJM-GATS | `enrich-pjm-gats.py` | Owner names from PJM REC tracking (13+ states: NJ, PA, MD, DE, DC, OH, VA, IL) | `data/pjm_gats/GATSGenerators_*.xlsx` (manual export from gats.pjm-eis.com) |
| Municipal Permits | `ingest-permits.py` | Solar permits from 23 US city open data portals (4 tiers) | Socrata/OpenDataSoft APIs (no local files) |
| Census Geocoder | `forward-geocode-census.py` | Batch address→coordinate geocoding (10K/batch, free) | Census Bureau API (currently down) |
| Permit Equipment | `parse-permit-equipment.py` | Extract panel/inverter from permit descriptions | Re-queries permit APIs for descriptions |
| Data Quality Audit | `data-quality-audit.py` | Field coverage, impossible values, installer standardization | DB analysis + `--fix` flag |

**CEC Spec Downloads:**
- Modules: `https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Modules.csv`
- Inverters: `https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/CEC%20Inverters.csv`

### New Data Sources (Feb 6, 2026 - INGESTED)

| # | Source | Script | Records | Prefix | Notes |
|---|--------|--------|---------|--------|-------|
| 8 | **LBNL Utility** | `ingest-lbnl-utility.py` | 1,725 + 1,725 equip | `lbnl_` | Utility-scale with cost/developer data |
| 9 | **EIA-860M** | `ingest-eia860m.py` | 9,516 | `eia860m_` | Monthly generators (operating+planned+retired+canceled) |
| 10 | **ISO Queues** | `ingest-iso-queues.py` | 431 | `iso_` | CAISO (294) + NYISO (137) via direct Excel download |
| 11 | **ISO gridstatus** | `ingest-iso-gridstatus.py` | 768 | `iso_` | ERCOT (634) + ISO-NE (91) + NYISO (43 new). Requires `.venv` Python 3.13 |
| 12 | **NJ DEP** | `ingest-nj-dep.py` | 1,850 | `njdep_` | ArcGIS REST API: BTM (428) + Public Facilities (1,322) + Community Solar (100) |
| 13 | **SPP Queue** | `ingest-iso-spp-miso.py` | 283 | `iso_spp_` | Direct CSV download. 10 states (OK, KS, TX, NE, NM). No developer names. |
| 14 | **MISO Queue** | `ingest-iso-spp-miso.py` | 919 | `iso_miso_` | JSON API. 16+ states (IA, IL, IN, MN, MI, etc). Has TO names as operator. |
| 15 | **EPA RE-Powering** | `ingest-epa-repowering.py` | 548 | `epa_repower_` | Brownfield/landfill solar. 100% owner + developer + capacity. |
| 16 | **NREL Community Solar** | `ingest-nrel-community.py` | 3,938 | `nrel_cs_` | Sharing the Sun database. Developer (86%), utility (100%). |

**Grand Total: 289,878 installations, 354,019 equipment records, 1,636,997 events, 18 primary sources + 31 permit portals**

### Running New Scripts
```bash
python3 -u scripts/ingest-lbnl-utility.py           # LBNL utility-scale
python3 -u scripts/ingest-eia860m.py                # EIA-860M monthly
python3 -u scripts/ingest-iso-queues.py             # Auto: CAISO + NYISO
python3 -u scripts/ingest-iso-queues.py --iso caiso # Single ISO
python3 -u scripts/ingest-iso-queues.py --all       # All 7 ISOs (incl. manual)
.venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py              # All ISOs via gridstatus
.venv/bin/python3.13 -u scripts/ingest-iso-gridstatus.py --iso ercot  # Single ISO
python3 -u scripts/ingest-nj-dep.py                 # NJ DEP ArcGIS (3 layers)
python3 -u scripts/ingest-iso-spp-miso.py           # SPP CSV + MISO JSON API
python3 -u scripts/ingest-iso-spp-miso.py --iso spp # SPP only
python3 -u scripts/ingest-iso-spp-miso.py --iso miso # MISO only
python3 -u scripts/ingest-permits.py                 # Municipal permits (all 23 cities)
python3 -u scripts/ingest-permits.py --city cary     # Single city
python3 -u scripts/ingest-permits.py --city sf,la    # Multiple cities
python3 -u scripts/ingest-permits.py --tier 1        # All Tier 1 cities only
python3 -u scripts/ingest-permits.py --tier 1,2      # Tier 1 and 2
python3 -u scripts/ingest-permits.py --dry-run       # Preview without ingesting
python3 -u scripts/ingest-permits.py --list-cities   # Show available cities

# New data sources (Feb 10, 2026)
python3 -u scripts/ingest-epa-repowering.py          # EPA RE-Powering brownfield solar
python3 -u scripts/ingest-nrel-community.py           # NREL Community Solar database

# PJM-GATS enrichment (manual XLSX export required)
python3 -u scripts/enrich-pjm-gats.py               # Owner enrichment from GATS export
python3 -u scripts/enrich-pjm-gats.py --dry-run     # Preview matches
python3 -u scripts/enrich-pjm-gats.py --file /path/to.xlsx  # Use specific file

# Census geocoder (API currently down, script ready)
python3 -u scripts/forward-geocode-census.py          # Census batch geocoding (10K/batch)
python3 -u scripts/forward-geocode-census.py --dry-run # Preview without patching
python3 -u scripts/forward-geocode-census.py --limit 1000  # Process first N

# Permit equipment extraction
python3 -u scripts/parse-permit-equipment.py          # Extract equipment from permit descriptions
python3 -u scripts/parse-permit-equipment.py --dry-run # Preview without creating records

# Data quality audit
python3 -u scripts/data-quality-audit.py              # Full audit report
python3 -u scripts/data-quality-audit.py --fix         # Apply installer name standardization
```

### Future Sources (researched, not yet ingested)

**Data Download URLs (for re-downloading)**:
- **LBNL Queued Up**: `https://eta-publications.lbl.gov/sites/default/files/2025-08/lbnl_ix_queue_data_file_thru2024_v2.xlsx` (needs browser UA header)
- **GEM Solar Tracker**: `https://publicgemdata.nyc3.cdn.digitaloceanspaces.com/solar/{YYYY-MM}/solar_map_{date}.geojson` (check config at `globalenergymonitor.github.io/maps/trackers/solar/config.js` for latest URL)

**ISO Queues (remaining ISOs)**:
- **SPP**: DONE — Direct CSV download from `https://opsportal.spp.org/Studies/GenerateActiveCSV` (283 solar >= 1MW). No developer names. `ingest-iso-spp-miso.py`
- **MISO**: DONE — JSON API at `https://www.misoenergy.org/api/giqueue/getprojects` (919 non-withdrawn solar). Has TO as operator. `ingest-iso-spp-miso.py`
- **PJM**: BLOCKED — All direct download URLs return HTML (Queue Scope web app). Requires `PJM_API_KEY` (free to register at dataminer2.pjm.com) or browser automation.
- **Summary**: 6 of 7 ISOs ingested (CAISO, NYISO, ERCOT, ISO-NE, SPP, MISO). Only PJM blocked.

**REC Tracking Systems (researched)**:
- **WREGIS** — **VIABLE!** Direct Excel download: `https://www.wecc.org/sites/default/files/documents/program/2026/WREGIS%20Public%20Report%20Active%20Generators%202.4.26xlsx.xlsx` (from wecc.org/wecc-document/1136). 17,241 total generators, **15,074 solar** (CA: 13,293, NM: 718, OR: 357, NV: 168, CO: 155). Has **Organization Name** (owner/off-taker) + capacity + state + COD. No EIA ID — needs name+state+capacity matching.
- **PJM-GATS** (gats.pjm-eis.com) — **DONE!** 582K solar generators across 13+ PJM states. Manual XLSX export via built-in report (no Playwright needed). "Owner?" is Y/N flag only, NOT actual name. Capacity in Unit Name field (e.g., "13.30 kW"). MSET utility prefix codes map to owner names. `enrich-pjm-gats.py` cross-references with existing DB → 178 owner_name patches.
- **M-RETS** (app.mrets.org, now CleanCounts) — API needs auth. Public CSV download only has 174 thermal generators (zero solar). REC generator data only in web app SPA. Rebranded May 2025.
- **Conclusion**: WREGIS and PJM-GATS both done. M-RETS requires browser automation or API registration (minimal solar data anyway).

**Additional Free**:
- CEC Equipment Full Data (updated 3x/month)
- EPA RE-Powering Tracking Matrix (brownfield/landfill solar)
- NREL Community Solar Project Database
- Virginia Cooper Center Solar Database (utility-scale VA projects with developer/owner)
- FERC QF eLibrary (elibrary.ferc.gov) — Owner/operator for qualifying facilities >1MW, free but requires scraping
- NREL Open PV (openpv.nrel.gov) — 1.6M records, overlaps with TTS but may fill gaps in states we're missing
- **NJ NJCEP** — Excel files from njcleanenergy.com (migrated to cleanenergy.nj.gov, URLs broken). ~209K total NJ installs. Lower priority since NJ DEP ArcGIS already ingested and TTS covers NJ.

**Gap-Filling Research (Feb 7, 2026):**
Comprehensive research into replicating Ohm Analytics' methodology and using satellite imagery:

*How Ohm Analytics sources data ($30K/yr):* (1) Building permit scraping from thousands of municipal portals — permits require panel/inverter manufacturer+model; (2) Data partnerships — solar companies share project details for free platform access; (3) Utility/software partnerships — interconnection data from utilities and monitoring platforms.

*High-Priority Free Sources:*
- **NOAA Storm Events** — DONE (enrich-noaa-storms.py, 561K events)
- **CPSC Recalls** — DONE (enrich-cpsc-recalls.py, 3,499 events)
- **PJM GATS** (gats.pjm-eis.com) — Owner names for 13+ PJM states (NJ, PA, MD, DE, DC, OH, etc.). Web-based DevExpress grid, needs Playwright/Puppeteer for CSV export. Has ORISPL (EIA ID) for large plants.
- **Municipal Permit Portals** — Top cities with Socrata/open data APIs: Cary NC, Cambridge MA, Boston, Austin TX, NYC. Equipment-per-site data (panel/inverter manufacturer+model). This IS Ohm's core method. High effort per city.

*Researched but NOT viable:*
- **NREL Open PV** (openpv.nrel.gov) — Discontinued since 2019, data frozen. Fully superseded by TTS.
- **NYSERDA DER** (der.nyserda.ny.gov) — No equipment fields beyond what NY-Sun already provides.
- **DeepSolar-3M** (github.com/rajanieprabha/DeepSolar-3M) — Aggregate census-tract counts only, no individual installation coordinates. Not useful for cross-reference.

*Satellite Imagery Pipeline (~$50-200 total):*
- **NREL Panel-Segmentation** (github.com/NREL/Panel-Segmentation) — Open-source Faster R-CNN ResNet-50 that classifies ground-mount vs. rooftop vs. carport AND fixed-tilt vs. single-axis tracker. 77.8% mAP. This fills our 0% racking/mounting data gap.
- **NAIP Imagery** — Free 0.6m resolution aerial photography, all 48 contiguous states, via Google Earth Engine or AWS. Public domain.
- Pipeline: Extract 500m x 500m tiles per installation via GEE ($0) → Run NREL model on cloud GPU ($50-200) → Write mount_type to database.
- **Google Solar API**: Skip — $9,600 for 128K requests, rooftop-only, useless for utility-scale.
- **Google Street View**: Skip — $896, wrong viewing angle.
- **Google Static Maps**: Cheap ($256 for 128K images) but ToS may restrict ML use. NAIP preferred.
- **Global PV Dataset 2019-2022** — 20m resolution global detection (Beijing Normal University, Scientific Data 2025). Free cross-reference.

**Paid (if budget allows)**:
- SEIA Major Solar Projects List (~$1K/yr membership) — 7K+ projects with developer+owner+offtaker. Best bang for buck.
- Wiki-Solar ($100-1K+) — 25K global projects with developer, owner, EPC contractor, equipment supplier
- Ohm Analytics (~$30K/yr) — Equipment per site for distributed solar. Best commercial data. Can be substantially replicated via building permit scraping + satellite imagery (see above).
- ACP CleanPowerIQ ($10-20K/yr) — 60K+ power assets with 50+ attributes
- Enverus ($20K+/yr) — Enterprise-grade project tracking

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
├── egrid/                   # EPA eGRID 2023 (downloaded)
│   └── egrid2023_data.xlsx  # 20MB, 5,658 solar plants
├── lbnl_queued_up/          # LBNL Queued Up interconnection queues
│   └── lbnl_ix_queue_data_file_thru2024_v2.xlsx  # 13MB, 36,441 records (17,422 solar)
├── gem/                     # GEM Solar Power Tracker
│   └── gem_solar_map_2026-02-05.geojson  # 183MB, 103,940 global (8,700 US)
├── wregis/                  # WREGIS REC tracking data
│   └── wregis_active_generators.xlsx  # 17,241 generators, 15,074 solar
├── noaa_storms/             # NOAA Storm Events bulk CSVs (auto-downloaded)
│   └── StormEvents_details-ftp_v1.0_d{YYYY}_*.csv.gz  # 11 years, ~120MB total
├── iso_queues/              # ISO interconnection queue data
│   ├── caiso/               # CAISO Excel (auto-downloaded)
│   ├── nyiso/               # NYISO Excel (auto-downloaded)
│   ├── spp/spp_queue.csv    # SPP CSV (auto-downloaded, 972 rows)
│   └── miso/miso_queue.json # MISO JSON (auto-downloaded, 3,701 records)
├── satellite_images/        # Google Maps satellite tiles (640x640 PNG)
└── zcta_centroids.txt       # Census ZCTA geocoding file (33,144 zips)
```

**WARNING**: Data files get iCloud-evicted. Restore from git: `git checkout HEAD -- solar/data/<file>`

## Script Gotchas (Critical)

- **URL encoding**: Supabase REST params with spaces crash without `urllib.parse.quote(str(v), safe='.*,()')`
- **Batch size = 50**: All scripts use BATCH_SIZE = 50 for Supabase inserts
- **`Prefer: resolution=ignore-duplicates`**: Only works with PRIMARY KEY conflicts, NOT unique indexes. For `source_record_id` UNIQUE INDEX, query existing IDs before inserting (see `ingest-iso-spp-miso.py` pattern). Whole batch fails if any record has duplicate source_record_id.
- **safe_float()**: EIA Excel has empty strings/spaces in numeric fields - ALWAYS use try/except. Caused 5+ crashes.
- **Column names**: `site_type` NOT `installation_type`, `install_date` NOT `commission_date`, `mount_type` NOT `mounting_type`
- **data_sources table**: `name` column NOT `identifier`
- **TTS parallel**: Accepts `--states AZ CA NY` CLI args for parallel workers (27 states total)
- **Python -u flag**: Required for background scripts to show real-time output
- **CEC CSV**: Has 3 header rows (names, units, SAM fields) - skip 2 after DictReader
- **CA DGStats**: 269 columns, up to 8 module arrays and 64 inverter arrays per site
- **IL Shines**: NO equipment data at all
- **MA PTS**: Header at row 11, data row 12. Has manufacturer but NO model numbers
- **solar_site_events**: Has NO `event_subtype` or `source` column! Only: id, installation_id, event_type, event_date, description, old_capacity_kw, new_capacity_kw, equipment_changed, data_source_id, created_at
- **NOAA storms dedup**: Keep only worst event per installation per year per type (hail/wind), otherwise county-level matching creates millions of events

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
- `solar_site_events` - Upgrades, repowers, maintenance, damage, recall records (columns: id, installation_id, event_type, event_date, description, old_capacity_kw, new_capacity_kw, equipment_changed, data_source_id, created_at. **NO event_subtype column!**)
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
- **InstallationMap** (`src/components/InstallationMap.tsx`) - Leaflet map with ESRI World Imagery satellite tiles (default) + OpenStreetMap street view toggle. Circle markers color-coded by site type (utility=blue, commercial=green, community=purple), size by capacity, popup with details, fits bounds to markers, limited to 1000 markers for performance
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
- **ISO queues**: Best free source for developer/owner names (6 ISOs ingested, 1,199 records total)
- **gridstatus venv**: `.venv` uses Python 3.13 (`/opt/homebrew/bin/python3.13`) because gridstatus requires >=3.10. System Python is 3.9.6.
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

### ISO gridstatus Ingestion - COMPLETED (Feb 6, 2026)
- **ingest-iso-gridstatus.py**: Uses `gridstatus` Python library (v0.29.1) to fetch queue data from 4 ISOs
- **Requires**: `.venv/bin/python3.13` (gridstatus needs Python >=3.10, system Python is 3.9.6)
- **ERCOT**: 634 solar projects >= 1 MW, ALL with developer names (100% `Interconnecting Entity` coverage)
- **ISO-NE**: 91 solar projects >= 1 MW, 0 developer names (ISO-NE doesn't provide this field)
- **CAISO**: 287 found but all duplicates of existing `ingest-iso-queues.py` records (0 net new)
- **NYISO**: 143 found, 43 net new (100 duplicates of existing records)
- **Total**: 768 net new records created, 0 errors
- **Not supported**: PJM (needs API key), MISO (Cloudflare 403), SPP (column parsing bug)
- **Note**: CAISO/NYISO "errors" in output are just duplicate key violations — data integrity is fine

### NJ DEP ArcGIS Ingestion - COMPLETED (Feb 6, 2026)
- **ingest-nj-dep.py**: Queries NJDEP ArcGIS REST API for 3 solar layers
- **API**: `https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer`
- **Layer 22 (BTM >1 MW)**: 428 records with project company, address, lat/lng, third-party flag
- **Layer 17 (Public Facilities)**: 1,322 records with **installer names** (unique to this source!)
- **Layer 26 (Community Solar)**: 100 records with applicant (developer), capacity, completion year
- **Total**: 1,850 net new records, state=NJ, all with coordinates
- **Source record IDs**: `njdep_{project_num}`, `njdep_pub_{account_num}`, `njdep_cs_{record_key}`
- **Data source name**: `nj_dep`

### Cross-Source Deduplication - COMPLETED (Feb 6, 2026)
- **crossref-dedup.py**: Matches records across 10 data sources, fills NULL fields bidirectionally
- **Schema change**: Added `crossref_ids` JSONB column to `solar_installations` (default `'[]'`)
- **Phase 1 (ID-based)**: 15,030 matches — EIA↔EIA-860M (7,633), EIA↔LBNL (1,702), EIA↔USPVDB (5,695)
- **Phase 2 (Proximity)**: 11,907 matches — state+city+capacity (10,197), NY↔TTS coords (374), LBNL↔USPVDB coords (1,336)
- **Phase 3 (Broad)**: 4 cross-tier coord matches (tight 25% capacity tolerance)
- **Total**: 33,077 records enriched (26.4% of database), zero errors
- **Key enrichments**: 14,614 owner_name, 3,749 total_cost, 3,033 installer_name, 490 location upgrades
- **Re-run (Feb 7)**: +1,886 patches from 2,618 newer records (NJ DEP + ISO gridstatus). 454 developer_name, 289 owner_name, 474 address, 259 location upgrades, 162 install_date, 1,344 crossref links. 0 errors.
- **Bug fix**: First run had Phase 2a city-only fallback that created 688-link crossref explosion. Fixed to require capacity match. Phase 3 limited to cross-tier matches (federal vs state sources).
- **Crossref cap**: Max 20 crossref_ids per record (community solar projects can legitimately have many TTS sub-installations)
- **DB password**: `#FsW7iqg%EYX&G3M` via pooler at `aws-0-us-west-2.pooler.supabase.com:6543`

### Gap-Filling Enrichments - COMPLETED (Feb 6, 2026)
Direct SQL operations to maximize field coverage across all 125,389 records:
- **Zip geocoding**: 63,951 records gained lat/lon from Census ZCTA centroids (43%→94% coverage)
- **County derivation**: 28,852 records gained county via city+state lookup from existing records (60%→83%)
- **cost_per_watt**: 12,935 records calculated from total_cost / (capacity_mw * 1M) (45%→55%)
- **num_modules**: 75,261 records counted from solar_equipment module records (28%→88%)
- **num_inverters**: 77,335 records counted from solar_equipment inverter records (0%→62%)
- **location_precision**: 5,037 remaining NULL records assigned (state/city/exact) → 100% coverage
- **last_import**: All 9 data sources updated from "Never" to current timestamp
- **Census ZCTA data**: Downloaded from `census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/` (33,791 zip centroids)

### EPA eGRID Enrichment - COMPLETED (Feb 6, 2026)
- **enrich-egrid.py**: Cross-references EPA eGRID 2023 solar plants (5,658 total) with existing installations
- **Phase 1 (EIA Plant ID)**: 3 matches (most EIA records already had operator from EIA-860 enrichment)
- **Phase 2 (Coordinate proximity)**: 426 matches (2km radius + 50% capacity tolerance)
- **Total**: 429 patches applied, 0 errors — 281 operator_name fills, 427 owner_name fills
- **Key insight**: eGRID's main value is `UTLSRVNM` (utility/owner name) which differs from `OPRNAME` (operator)

### GEM Solar Power Tracker Enrichment - COMPLETED (Feb 6, 2026)
- **enrich-gem.py**: Cross-references GEM Global Solar Power Tracker GeoJSON (8,700 US projects, CC BY 4.0)
- **Data**: 183MB GeoJSON from `publicgemdata.nyc3.cdn.digitaloceanspaces.com/solar/` CDN (found via GitHub tracker map config)
- **Phase 1 (EIA Plant ID)**: 4 matches (GEM has `other-ids-(location)` with EIA IDs for 8,320 US plants)
- **Phase 2 (Coordinate proximity)**: 86 matches (2km radius + 50% capacity tolerance)
- **Total**: 90 patches applied, 0 errors — 34 owner_name fills, 64 operator_name fills
- **Key insight**: Most GEM records already matched to installations that had owner/operator from eGRID/EIA enrichment

### LBNL Queued Up Enrichment - COMPLETED (Feb 6, 2026)
- **enrich-lbnl-queues.py**: Cross-references LBNL interconnection queue data (17,422 solar projects from 50+ grid operators)
- **Data**: 13MB Excel from `eta-publications.lbl.gov` (Cloudflare-protected, needs browser UA header)
- **Phase 1 (EIA Plant ID)**: 0 matches (LBNL queue data has no EIA IDs)
- **Phase 2 (State + capacity)**: 1,166 matches (25% capacity tolerance + name/county similarity scoring)
- **Total**: 1,166 developer_name patches applied, 0 errors
- **Note**: Filtered out "Masked" developer names (ISOs redact some developer identities)

### Source Field Backfill - COMPLETED (Feb 6, 2026)
- **backfill-source-fields.py**: Recovers fields from original source data files that weren't captured during initial ingestion
- **CA DGStats `Third Party Name` → `owner_name`**: 2,530 patches (top: Sunrun 537, Everyday Energy 116, SolarCity 92)
  - Reads 5 CSV files from `data/ca_dgstats/`, matches by `cadg_{Application Id}` source_record_id
- **NY-Sun `Street Address` → `address`**: 182 patches (builds full address with city+state)
  - Only patches records that don't already have an address
- **TTS `utility_service_territory` → `operator_name`**: 6,080 patches (top: Xcel Energy 1,263, Green Mountain Power 678)
  - Reads Hive-partitioned Parquet files, matches by extracting state+system_id from `tts3_{state}_{sys_id}_{i}` pattern
  - Filters placeholder values: "-1", "-9", "0", "NA", "N/A", "Unknown", "None", "nan"
- **Total**: 8,792 patches applied, 0 errors

### Reverse Geocoding - COMPLETED (Feb 6, 2026)
- Latest run: 1,006 additional records geocoded (6 USPVDB + 1,000 NY-Sun), 990 addresses updated
- Cumulative: 34,322 / 125,389 installations have addresses (27.4%)

### WREGIS Owner Enrichment - COMPLETED (Feb 7, 2026)
- **enrich-wregis.py**: Downloads WREGIS active generators Excel, cross-references by state + capacity (20% tolerance) + name similarity
- **Data**: 15,074 solar generators from WECC (covers western US: CA, AZ, NV, OR, CO, NM, UT, WA, ID, MT, WY)
- **Matching**: Requires name word overlap (score >= 2) or very tight capacity match (5%). Originally matched 90% of candidates; tightened thresholds reduced to 23%
- **Results**: 10,695 owner_name patches applied, 0 errors
  - CA: 10,308 | AZ: 149 | NM: 177 | UT: 32 | OR: 17 | NV: 11 | CO: 1
- **Impact**: owner_name coverage jumped from 32.6% → ~41%
- **Key orgs assigned**: NextEra Energy Resources, Onyx Renewable Partners, SunRay Power, Bridge Solar Energy Holdings, Consolidated Edison Development

### CPSC Recall Enrichment - COMPLETED (Feb 7, 2026)
- **enrich-cpsc-recalls.py**: Matches 7 known CPSC solar equipment recalls against 334,645 equipment records
- **Recalls tracked**: Fronius Galvo/Symo (shock, 2,484 matches), SMA Sunny Boy 240 (fire, 500), SolarWorld MC4 (shock, 356), Schneider Conext CL-60 (shock, 71), CertainTeed roofing (fire, 58), Bosch c-Si M60 (fire, 30), GAF Timberline (fire, 0)
- **Total**: 3,499 recall events created affecting 3,111 installations, 0 errors
- **Event type**: `recall` in solar_site_events

### NOAA Storm Events Enrichment - COMPLETED (Feb 7, 2026)
- **enrich-noaa-storms.py**: Downloads NOAA bulk CSVs (2015-2025), matches hail (>=1") and wind (>=58 kts) events to installations by state+county FIPS
- **Data**: 125,623 damaging storm events across 11 years (~120MB of gzipped CSVs auto-downloaded)
- **Dedup**: Keeps only worst event per installation per year per type (hail/wind) to avoid explosion
- **Event types**: `hail`, `severe_hail` (>=2"), `high_wind` in solar_site_events
- **Total**: 561,731 site events affecting 95,804 installations (75% of database)
- **Impact**: Identifies sites with recurring storm damage — HIGH VALUE for Blue Water Battery (damage = replacement leads)

### Map Satellite Tiles - COMPLETED (Feb 7, 2026)
- Switched InstallationMap from OpenStreetMap-only to ESRI World Imagery satellite as default
- Added layer control to switch between Satellite and Street views
- Solar panels visible from satellite at zoom 15+

### Forward Geocoding Investigation - COMPLETED (Feb 7, 2026)
- Investigated 1,065 records with address but no lat/lng coordinates
- All are ISO interconnection queue records with grid infrastructure names (substations, kV lines)
- Not geocodable — these aren't real street addresses. 98.1% of actual addresses already have coordinates.

### Data Source Health Monitor - COMPLETED (Feb 7, 2026)
- **check-data-sources.py**: Comprehensive registry of all 18 data sources (11 primary + 7 enrichment)
- Checks URL availability, record counts vs expected, freshness vs update schedule, data directory status
- JSON export option for automation: `--json` saves to `data/source_health_report.json`
- Covers: USPVDB, EIA-860, TTS, CA DGStats, NY-Sun, IL Shines, MA PTS, LBNL, EIA-860M, ISO, NJ DEP, CEC, Nominatim, OSM, NOAA, WREGIS, eGRID, GEM, EPA RE-Powering, NREL Community Solar, Municipal Permits, PJM-GATS, Census Geocoder

### Data Completeness Assessment (Feb 11, 2026)
**Database totals: 289,878 installations, 354,019 equipment, 1,636,997 events (1,633,299 storm + 3,458 recall + 240 generator), 18 primary sources + 31 permit portals**

**Coverage vs total US market:**
- Utility-scale (>=1 MW): ~95-100% coverage (EIA-860 is mandatory federal census)
- Commercial (25 kW - 1 MW): ~70-75% coverage (municipal permits filled many gaps)
- Biggest remaining gaps: States without TTS or permit coverage

**Field coverage snapshot (Feb 11, 2026, post-final-dedup):**
| Field | Count | Coverage | Notes |
|-------|------:|----------|-------|
| location_precision | 289,878 | 100.0% | All records tagged (exact/address/city/zip/county/state) |
| county | 284,873 | 98.3% | Derived from city+state lookup |
| city | 272,264 | 93.9% | From source data + permits |
| zip_code | 233,037 | 80.4% | From source data + geocoding |
| install_date | 216,715 | 74.8% | COD or queue date |
| installer_name | 211,809 | 73.1% | TTS/CADG/NY-Sun/permits (standardized) |
| address | 211,930 | 73.1% | Reverse geocoding + source data + cross-reference |
| capacity_mw | 186,364 | 64.3% | Many permits lack explicit capacity |
| latitude/longitude | 137,886 | 47.6% | Source data + ZCTA centroids + dedup upgrades |
| operator_name | 105,279 | 36.3% | EIA-860 + eGRID + GEM + TTS utility + OSM + backfill |
| owner_name | 96,977 | 33.5% | EIA-860 + crossref + eGRID + GEM + WREGIS + EPA + PJM-GATS |
| mount_type | 59,870 | 20.7% | NREL satellite classification (3 batches) + source data |
| developer_name | 7,421 | 2.6% | ISO queues + LBNL + EPA + NREL Community + VA Cooper |

**Equipment coverage (354,019 total):**
| Field | Count | Coverage | Notes |
|-------|------:|----------|-------|
| manufacturer | 336,316 | 95.0% | Excellent for brand identification |
| model | 200,888 | 56.7% | Good for product matching |
| CEC specs | 90,086 | 25.4% | Modules ~20%, inverters ~36% |
| racking | 0 | 0% | No racking data in any source |

### NREL Satellite Mount Type Classification - IN PROGRESS (Feb 9, 2026)

**Pipeline**: Google Maps Static API → satellite images → NREL Panel-Segmentation model → mount_type in DB

**Scripts**:
- `fetch-satellite-images.py`: Downloads 640x640 satellite tiles for installations with exact coordinates
- `classify-mount-type.py`: Runs NREL Faster R-CNN ResNet-50 model to detect panels and classify mount type
- `deploy-nrel-to-droplet.sh`: Deploys conda env + model weights to DigitalOcean droplet (104.131.105.89)

**Droplet Setup**:
- 8 CPU, 15GB RAM, Ubuntu 25.04
- Miniconda with Python 3.10, TensorFlow 2.17.1, PyTorch 2.10.0
- NREL Panel-Segmentation models (~2.9 GB total) in conda env
- Classification runs in `screen -r nrel` session

**Image Download Progress**:
- 52,051 images downloaded (all exact-location installations covered)
- URL signing enabled — no daily quota limit
- Cost: $2/1000 requests, fully covered by $200/month free credit
- New permit records have address/city precision, not exact — no additional images to download

**Batch 1 Results (10,944 images, completed Feb 7)**:
- Processed: 8,983 (1,961 already had mount_type from source data)
- Classified: 5,865 (65.3% detection rate)
- No panels detected: 3,095 (34.4%)
- Errors: 23 (0.3%)
- Time: 380.8 min (~6.3 hours) at 0.4 img/sec
- Mount type breakdown:
  - ground_fixed: 2,470 (42.1%)
  - ground_single_axis: 1,899 (32.4%)
  - rooftop: 1,087 (18.5%)
  - carport: 409 (7.0%)

**Batch 2 (23,365 images, COMPLETED Feb 9)**: 5,865 additional mount types classified
- Same 65.3% detection rate as batch 1

**Mount Type Mapping**:
- NREL `ground-fixed` → DB `ground_fixed`
- NREL `ground-single_axis_tracker` → DB `ground_single_axis`
- NREL `rooftop-fixed` → DB `rooftop`
- NREL `carport-fixed` → DB `carport`

### SPP + MISO ISO Queue Ingestion - COMPLETED (Feb 9, 2026)
- **ingest-iso-spp-miso.py**: Direct download from ISO websites (bypasses gridstatus limitations)
- **SPP**: CSV from `https://opsportal.spp.org/Studies/GenerateActiveCSV`
  - 283 solar projects >= 1MW across 10 states (OK: 80, KS: 70, TX: 39, NE: 31, NM: 27, MO: 12, AR: 9, LA: 7, SD: 4, ND: 3, MT: 1)
  - No developer names (SPP doesn't publish). TO at POI stored as operator_name.
  - All records >= 1MW, no withdrawn status in SPP export
- **MISO**: JSON API at `https://www.misoenergy.org/api/giqueue/getprojects`
  - 2,117 solar records (after dedup), 1,198 withdrawn (skipped), 919 created
  - All have state, county, capacity, POI name. transmissionOwner stored as operator_name.
  - Status mapping: Done→active, Active→proposed, Withdrawn→skip
  - 1 duplicate projectNumber (J2987) — deduped in script
- **Total**: 1,202 new records (283 SPP + 919 MISO), 0 errors
- **PostgREST gotcha**: `Prefer: resolution=ignore-duplicates` only works with PRIMARY KEY conflicts, not UNIQUE INDEX. Script queries existing source_record_ids before inserting to handle reruns safely.
- **PJM UNBLOCKED**: Discovered public Planning API at `services.pjm.com/PJMPlanningApi/api/Queue/ExportToXls` with static API key. See `ingest-pjm-queue.py`.

### URL Signing for Google Maps Static API - COMPLETED (Feb 10, 2026)
- Added HMAC-SHA1 URL signing to `fetch-satellite-images.py` using `GOOGLE_MAPS_SIGNING_SECRET` env var
- Signed requests have NO daily quota limit (unsigned was capped at ~25K/day)
- User also increased quota in Cloud Console — both measures in place
- Satellite download completing all ~30K remaining images in single session (previously required 3 daily sessions)

### Enrichment Run - Feb 10, 2026
- **Location precision**: Re-run on all records including new SPP/MISO
- **Reverse geocoding**: Only 3 new records geocoded — remaining missing-address records are ISO queue substations (not real addresses, not geocodable)
- **Cross-source dedup**: 1,066 patches from SPP/MISO linkage (854 crossref, 150 developer, 154 location upgrades)

## Next Steps (Priority Order)

### Immediate
1. **Census batch geocoder**: Retry when API recovers (97K addresses ready in `forward-geocode-census.py`)
   - Would push lat/lng from 47.6% → ~80%
2. **Batch 3 classification completing** on droplet (4,434 remaining images, ~38% done)

### Short-term
3. **Expand permit scraper** further: Portland OR, Atlanta GA (if portals become viable)
4. **PJM-GATS Playwright automation**: Automate XLSX export for repeatable owner enrichment

### Medium-term
5. **SEIA membership** ($1K/yr): 7K+ projects with developer+owner+offtaker — best ROI paid source
6. **Forward geocode permit addresses**: Once Census API recovers, geocode ~97K permit addresses

### Data Gap Summary (Feb 11, 2026)
| Field | Current | Target | How to close |
|-------|---------|--------|-------------|
| mount_type | 20.7% | ~40%+ | Batch 3 classification completing on droplet |
| developer_name | 2.6% | ~5%+ | SEIA ($1K/yr) best option for developer names |
| owner_name | 33.5% | ~50%+ | PJM-GATS automation or SEIA |
| operator_name | 36.3% | ~50% | Municipal permit data, utility partnerships |
| address | 73.1% | ~78% | Census batch geocoder (when API recovers) |
| capacity_mw | 64.3% | ~80% | Many permits lack explicit capacity |
| latitude/longitude | 47.6% | ~80% | Census geocoder (97K addresses ready) |
| CEC specs | 25.4% | 25% | Limited by 55% of modules lacking model numbers |

### PJM-GATS Owner Enrichment - COMPLETED (Feb 10, 2026)
- **enrich-pjm-gats.py**: Cross-references PJM-GATS generator export (582,419 solar records across 13+ PJM states)
- **Data source**: Manual XLSX export from https://gats.pjm-eis.com/gats2/PublicReports/GATSGenerators (filter: Solar - Photovoltaic)
- **Key finding**: "Owner?" column is just Y/N flag, NOT actual owner name. No capacity field in export.
- **Strategy**: Parse capacity from Unit Name field (e.g., "13.30 kW"), filter >= 25 kW. MSET (metered utility) records have utility prefix in Plant Name (AEP, VP, DPL, etc.)
- **MSET utility prefixes mapped**: AEP → American Electric Power, VP → Virginia Power (Dominion Energy), DPL → Delmarva Power & Light, JC → Jersey Central P&L, PS → PSE&G, etc.
- **Qualifying records**: 1,560 (377 MSET utility + 1,183 NON commercial). States: NJ 373, DC 372, PA 311, MD 294, OH 103, VA 95
- **Matched**: 178 owner_name patches applied to existing installations via state + name similarity cross-reference
- **File**: `data/pjm_gats/GATSGenerators_20260210_161547.xlsx` (588K rows, 582K solar)

### Municipal Permit Ingestion - EXPANDED (Feb 10, 2026)
- **ingest-permits.py**: Multi-city solar permit scraper — expanded from 4 to 23 cities across 4 tiers
- **Platforms**: Socrata SODA API (22 cities), OpenDataSoft (1 city — Cary NC)
- **CLI**: `--city sf,la`, `--tier 1,2`, `--dry-run`, `--list-cities`
- **Tier 1** (solar-specific datasets, best data):
  - Cambridge MA (692 records, HAS equipment: inverter make/model, mount type, panel count)
  - Cary NC (1,963 records, installer + owner names)
  - Richmond CA (3,716 records, geocoded, subtype=SOLAR)
  - Honolulu HI (~3,355 commercial solar permits, installer names)
  - NYC (~26,202 records, filtered by permittee business name containing SOLAR, has lat/lng)
- **Tier 2** (building permits with confirmed solar filter):
  - SF (1,845), LA (1,032), Chicago (11,333), Austin (22,589), Seattle (185)
- **Tier 3** (generic permit datasets):
  - Dallas (1,940), New Orleans (25,861), San Diego County (604 commercial), Montgomery County MD (437), Mesa AZ (2,090)
- **Tier 4** (BLDS Partner Portal — standardized schema):
  - Boston (4,091), Fort Worth (266), Raleigh (277), Seattle BLDS (44), Nashville (0), New Orleans BLDS (14,027), Redmond (5), Santa Rosa (1,147)
- **Actual results**: 84,563 new records created, 177 errors (Raleigh BLDS 400 Bad Request)
- **Key features**: In-memory dedup (`seen_ids`), false positive filtering (solar screens/shades/tubes), description parsing for kW/panels/wattage
- **Cambridge rich data**: Inverter make+model, mount type (roof/ground), panel count, battery storage, system size kW — creates solar_equipment records
- **Data source name in DB**: `municipal_permits_{city_key}` (one per city)
- **Removed cities**: Cincinnati (0 solar), Roseville (sparse data), Chattanooga (SSL error), Baltimore (empty API)

### PJM Queue Ingestion - COMPLETED (Feb 11, 2026)
- **ingest-pjm-queue.py**: Downloads PJM interconnection queue via public Planning API (no registration needed)
- **API**: `POST https://services.pjm.com/PJMPlanningApi/api/Queue/ExportToXls` with static public key `E29477D0-70E0-4825-89B0-43F460BF9AB4`
- **Discovery**: PJM's Queue Scope web app uses a separate Planning API that returns Excel directly — bypasses the blocked Data Miner 2 endpoint entirely
- **All 7 ISOs now covered**: CAISO, NYISO, ERCOT, ISO-NE, SPP, MISO, PJM
- **Results**: 1,409 solar projects >= 1 MW found, 1,309 created (100 batch errors from null-capacity records)
- **States**: VA 291, PA 262, OH 233, NJ 143, IN 122, IL 88, MD 78, KY 66, NC 61, WV 31, MI 16, DE 14
- **Fields**: project_id, name, state, county, capacity (MW), status, transmission_owner (as operator_name)
- **Limitation**: Developer names NOT in public export (PJM considers them confidential)
- **Source record prefix**: `iso_pjm_`

### Virginia Cooper Center Ingestion - COMPLETED (Feb 11, 2026)
- **ingest-virginia-cooper.py**: Downloads Virginia solar/storage project database from UVA Weldon Cooper Center
- **Source**: `https://solardatabase.coopercenter.org/export_xlsx/` (direct Excel export, no auth)
- **Results**: 579 records created, 0 errors
  - 540 with developer names (93.3%!) — 186 unique developers
  - 576 with capacity (99.5%)
  - 0 with coordinates (database has no lat/lng columns, only text location descriptions)
  - Status: 420 proposed, 159 canceled
- **Has EIA cross-reference**: `eia_plant_id` and `eia_generator_id` columns for matching to existing records
- **Key developers**: Ameresco, Sun Tribe, Energix, AES, SolAmerica, New Leaf Energy, Dominion Energy
- **Source record prefix**: `vacooper_`
- **Impact**: developer_name coverage jumps significantly for Virginia — previously near-zero for VA utility-scale projects

### Municipal Permit Expansion - COMPLETED (Feb 11, 2026)
- **ingest-permits.py expanded**: Added 4 new cities with 3 new platform handlers (27 → 31 permit portals)
- **New platforms**: ArcGIS FeatureServer, CARTO SQL API, CKAN Datastore API
- **New cities (Tier 0)**:
  - Sacramento CA (ArcGIS): 16,042 records with coordinates, installer names, solar category filter, 586 with equipment
  - Philadelphia PA (CARTO): 9,220 records with owner names (`opa_owner`), equipment NLP from `approvedscopeofwork`, 1,876 equipment. Coordinates parsed from WKB hex `the_geom` (State Plane `geocode_x/y` caused numeric overflow)
  - San Jose CA (CKAN): 1,453 records with owner names and contractor names
  - Salt Lake City UT (Socrata): 799 records with embedded lat/lng in location field, installer names
- **Total new**: ~27,514 records across 4 cities
- **Philadelphia bug fix**: `geocode_x`/`geocode_y` are PA State Plane (EPSG:2272) in feet, not lat/lng. Values like 2,722,744 caused `numeric field overflow` (precision 10, scale 7). Fixed by parsing lat/lng from `the_geom` WKB hex (EPSG:4326). Also fixed NaN coordinates causing `PGRST102: Empty or invalid json` by adding range validation and `allow_nan=False` in `json.dumps`.
- **Research rejected**: Las Vegas (no solar in description field), Denver (no description field at all), Portland (no building permits dataset), Charlotte/Tampa/Indianapolis/Phoenix (Accela, no public API), Miami-Dade (portal migration in progress)

### SEIA/Ohm Coverage Comparison - COMPLETED (Feb 11, 2026)
- **docs/coverage-comparison-seia-ohm.md**: Comprehensive analysis of free data vs paid sources
- Recommendation: Buy SEIA ($1K/yr) immediately for developer_name (2.6% → ~13%) and exclusive offtaker/PPA data
- Ohm Analytics ($30K/yr) only worth it for distributed solar equipment-per-site data
- Our free pipeline has unique advantages: storm damage tracking (188K sites), recall tracking, satellite mount classification

### Critical Gotcha: PostgREST Batch Key Consistency
**NEVER strip None values from batch records.** `{k: v for k, v in record.items() if v is not None}` causes PGRST102 "All object keys must match" errors. All objects in a batch POST must have identical keys. This broke EIA-860M, LBNL, and ISO Queues scripts initially.

### Gap-Filling Session - Feb 10, 2026 (Session 2)

Executed comprehensive gap-filling plan across Phases 0-2 and 3E/3F/5B/5C.

**New scripts written:**
- `forward-geocode-census.py` — Census Bureau batch geocoder (10K addresses/request, free). Script ready but Census API down.
- `parse-permit-equipment.py` — NLP extraction of panel/inverter from permit descriptions. 1,063 equipment records created.
- `ingest-epa-repowering.py` — EPA RE-Powering brownfield/landfill solar tracker. 548 records with 100% owner+developer.
- `ingest-nrel-community.py` — NREL Sharing the Sun community solar database. 3,938 records with developer (86%).
- `data-quality-audit.py` — Full audit: field coverage, impossible values, installer standardization. `--fix` flag.

**Enrichment pipeline re-run results (on 260K records):**
- eGRID: 3,338 patches (3,335 operator, 1,349 owner)
- WREGIS: 189 owner patches
- GEM: 268 patches (255 operator, 37 owner)
- LBNL Queued Up: 175 developer patches
- Backfill source fields: 35,486 TTS operator patches
- OSM cross-reference: 41 site names, 9 operators
- CEC equipment specs: 2,474 enrichments
- CPSC recalls: 3,501 recall events
- NOAA storms: ~1.4M storm events (still completing)
- PJM-GATS: 159 owner patches
- Cross-source dedup: 9,933 patches (8,760 location upgrades, 771 operator, 136 address, 67 developer)
- County derivation: 34,624 patches from city+state lookup (84.8% → 98.1%)
- Zip geocoding: ~53K+ records updated with lat/lng from ZCTA centroids
- Location precision: Re-flagged all records including new permit_*/epa_*/nrel_cs_* prefixes
- Installer standardization: 143 variants normalized (SunPower, Tesla, Sunrun, Trinity Solar, etc.)

**Census Bureau batch geocoder (BLOCKED):**
- geocoding.census.gov completely unresponsive (TCP connection timeout)
- Script written and ready (`forward-geocode-census.py`)
- Re-run when API recovers for ~97K addresses needing coordinates

**Data files added:**
- `data/epa_repowering/repowering_tracking_matrix.xlsx` — EPA RE-Powering tracker
- `data/nrel_community_solar/community_solar_2025.xlsx` — NREL community solar database
- `data/zcta_centroids.txt` — Restored from Census Bureau (was iCloud-evicted)

### Gap-Filling Session - Feb 11, 2026 (Session 3)

Continued gap-filling plan. Phase 4 (events + specs on new records) and Phase 5A (final dedup) and Phase 7 (coverage comparison).

**Phase 4B — CPSC recalls on new equipment:**
- Re-ran `enrich-cpsc-recalls.py` on full database (351K equipment records)
- 3,501 recall events created (2 more than previous run from new EPA/NREL equipment)
- 3,113 installations affected, 0 errors

**Phase 4C — CEC spec matching on new equipment:**
- Re-ran `enrich-equipment-specs.py` on full database
- 7 new module matches (0.1% rate — most records already enriched or lack model data)
- 0 new inverter matches
- CEC specs total now 87,568 (24.9% of equipment)

**Phase 4A — NOAA storms (completed):**
- 1,424,514 storm events created affecting 188,043 installations
- Re-run in Session 4 on expanded 290K DB (see Session 4 notes)

**Phase 5A — Final crossref-dedup:**
- 55,628 match pairs across 3 phases (ID-based, proximity, broad proximity)
- 6,630 patches applied, 0 errors
- Key enrichments: 5,870 location upgrades, 822 crossref links, 119 operator, 100 address, 43 developer, 15 owner
- Fewer patches than Session 2 run (6,630 vs 9,933) because most fields already filled

**Phase 7 — SEIA/Ohm coverage comparison:**
- Wrote `docs/coverage-comparison-seia-ohm.md` — comprehensive analysis
- **SEIA ($1K/yr)**: developer_name 2.6% → ~13%, offtaker/PPA data (exclusive). **Recommended: buy immediately.**
- **Ohm Analytics ($30K/yr)**: Equipment per site from ~43% → ~90%. Only worth it if distributed solar critical.
- Our free pipeline has unique advantages: storm damage (188K sites), recall tracking, satellite mount classification

**Census geocoder still down:**
- Re-tested Feb 11 — still TCP timeout on geocoding.census.gov
- 97,420 addresses ready to geocode when API recovers

**Location precision final results (Session 3):**
- Exact: 97,119 (37.3%) | Address: 63,667 (24.4%) | City: 81,457 (31.3%) | Zip: 6,487 (2.5%) | County: 3,515 (1.4%)
- 27,852 zip centroids reverted (cleaned fake coordinates from prior ZCTA geocoding)
- Total: 252,245 records with location_precision (96.9% of 260,426)
- See Session 4 for updated 100% coverage with 289,878 records

**Completed background tasks:**
- NOAA storms: 1,424,514 events created, 188,043 installations affected, 0 errors
- geocode-zips: 71,284 records updated with ZCTA centroids (1,918 zips not found)

**Data quality fixes:**
- Mount type case normalization: Rooftop→rooftop (12,707), Ground→ground (4,354), Mixed→mixed (811)
- Recall event deduplication: 10,499 → 3,445 (deleted 7,054 duplicates from redundant script runs)
- Storm event deduplication: Deleted 561,731 old events from prior NOAA run (kept 1,424,514 from current run)

### Gap-Filling Session - Feb 11, 2026 (Session 4)

Completed Phases 4A (NOAA re-run on full 290K DB) and 5A (final dedup) from gap-filling plan.

**Enrichment pipeline re-run results (on 290K records):**
- eGRID: 2,331 patches (2,326 operator, 316 owner)
- GEM: 47 patches (12 owner, 39 operator)
- LBNL Queued Up: 82 developer patches
- WREGIS: 1 match (previous run got 10,695 — nearly all already applied)
- EIA-860 owner/plant: 0 new patches (all already applied)
- OSM cross-reference: 66 site names, 1 operator, 1 owner
- PJM-GATS: 168 owner patches
- CPSC recalls: 3,519 events (on expanded equipment set)
- CEC equipment specs: 65 inverter matches (modules saturated)
- Backfill source fields: 0 new patches (all already applied)

**NOAA storm events re-run (on 290K records):**
- Cleaned up duplicate events from prior overlapping runs via psql
- Deleted all storm events, then clean re-run with `--skip-download`
- 1,633,299 storm events created affecting 248,861 installations (85.9% of DB)
  - high_wind: 914,125 | hail: 586,532 | severe_hail: 132,642
- NOAA dedup gotcha: Script uses UUID PKs, so `ignore-duplicates` header is useless. Must delete all storm events before re-running.
- REST API DELETE returns HTTP 500 for large result sets (700K+). Use psql directly.

**Final cross-source dedup:**
- 55,013 match pairs across 3 phases
- 5,601 patches applied, 0 errors
- Key: 5,024 location upgrades, 631 crossref links, 80 operator, 42 address, 23 developer

**Location precision: 100% coverage achieved**
- Updated `set-location-precision.py` with 3 new steps: nrel_cs_* (city), vacooper_* (address), epa_re_* (city)
- Fixed 10,243 remaining NULL records via direct SQL (paging race condition with 290K records)
- Final: exact 126,633 (43.7%) | address 70,543 (24.3%) | city 76,662 (26.4%) | zip 7,748 (2.7%) | county 4,698 (1.6%) | state 3,594 (1.2%)

**Satellite pipeline status:**
- 52,051 images downloaded (all exact-precision installations)
- Batch 3 classification resuming on droplet (~4,434 remaining, ~39% done)
- Total mount_type in DB: 59,870 (20.7% of installations)


<claude-mem-context>
# Recent Activity

### Feb 5, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #51 | 7:18 PM | 🔵 | Solar CLAUDE.md Updated 8 Hours After Other Documentation | ~356 |
</claude-mem-context>
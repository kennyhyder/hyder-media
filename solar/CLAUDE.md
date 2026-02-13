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
| HIFLD Territories | `enrich-utility-territories.py` | Operator names via PostGIS spatial join (2,919 utility territory polygons) + zip/county fallbacks | HIFLD ArcGIS FeatureServer + `data/openei/` CSVs |
| USASpending REAP | `enrich-usaspending-reap.py` | Owner names from USDA REAP solar grants (CFDA 10.868, 586 grants) | `api.usaspending.gov` REST API |
| NY Statewide Solar | `enrich-ny-statewide-owner.py` | Owner names from NY distributed solar Developer field (15,375 matches) | `data.ny.gov` dataset `wgsj-jt5f` CSV |
| Municipal Permits | `ingest-permits.py` | Solar permits from 55+ US city open data portals (6 tiers) | Socrata/OpenDataSoft/ArcGIS/CKAN/CARTO/BLDS APIs |
| Census Geocoder | `forward-geocode-census.py` | Batch address→coordinate geocoding (1K/batch, free, ~83% match rate) | `https://geocoding.geo.census.gov/geocoder/geographies/addressbatch` |
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

**Grand Total: ~641,784 installations, ~452,782 equipment records, ~3,229,371 events, 18 primary sources + 71 permit portals**

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

# San Diego City bulk CSV (Feb 13, 2026)
python3 -u scripts/ingest-san-diego-csv.py            # SD City CSV (~77K solar from seshat.datasd.org)
python3 -u scripts/ingest-san-diego-csv.py --set 1    # Set 1 only (historical)
python3 -u scripts/ingest-san-diego-csv.py --set all  # Both sets
python3 -u scripts/ingest-san-diego-csv.py --dry-run  # Preview without ingesting

# New data sources (Feb 10-11, 2026)
python3 -u scripts/ingest-epa-repowering.py          # EPA RE-Powering brownfield solar
python3 -u scripts/ingest-nrel-community.py           # NREL Community Solar database
python3 -u scripts/ingest-pjm-queue.py                # PJM queue (1,409 solar, extracts Commercial Name as developer_name)
python3 -u scripts/ingest-pjm-queue.py --dry-run     # Preview PJM queue
python3 -u scripts/ingest-virginia-cooper.py           # Virginia Cooper Center (579 records, 93% developer names)

# PJM-GATS enrichment (manual XLSX export required)
python3 -u scripts/enrich-pjm-gats.py               # Owner enrichment from GATS export
python3 -u scripts/enrich-pjm-gats.py --dry-run     # Preview matches
python3 -u scripts/enrich-pjm-gats.py --file /path/to.xlsx  # Use specific file

# HIFLD utility territory operator enrichment
python3 -u scripts/enrich-utility-territories.py               # Full: upload + spatial join + zip/county
python3 -u scripts/enrich-utility-territories.py --skip-upload  # Re-run spatial join (territories already uploaded)
python3 -u scripts/enrich-utility-territories.py --phase 2     # Spatial join only
python3 -u scripts/enrich-utility-territories.py --phase 3     # Zip fallback only
python3 -u scripts/enrich-utility-territories.py --dry-run     # Preview without patching

# Owner enrichment from USASpending REAP grants + NY Statewide
python3 -u scripts/enrich-usaspending-reap.py            # USDA REAP solar grants → owner_name (102 matches)
python3 -u scripts/enrich-ny-statewide-owner.py          # NY distributed solar Developer → owner_name (15,375 matches)

# Census geocoder (API currently down, script ready)
python3 -u scripts/forward-geocode-census.py          # Census batch geocoding (1K/batch, ~83% match rate)
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

### In Progress (Feb 13, 2026 — Session 16)
1. **San Diego City CSV set2_closed equipment insertion**: 15,839 installations, ~23K equipment records being inserted (slow one-at-a-time API calls)
2. **Droplet classification batch 3**: Still running at 0.4/sec on droplet 104.131.105.89

### Completed This Session (Session 16)
3. **San Diego City CSV ingestion**: 76,936 solar permits from seshat.datasd.org — **largest single ingestion ever**
   - New standalone script: `ingest-san-diego-csv.py` — downloads bulk CSVs from S3/CloudFront, filters by APPROVAL_TYPE (PV/Photovoltaic/SB 379)
   - Set 2 Active: 28,013 installations + 13,713 equipment, 0 errors
   - Set 2 Closed: 48,923 installations + ~23K equipment (inserting), 0 errors
   - Equipment parsed from PROJECT_SCOPE: panel manufacturer/model, inverter details, kW/MW capacity, module/inverter counts
   - All records have lat/lng (100% geocoded), installer names, addresses
   - Total DB jump: 558K → 641K installations
4. **Leon County FL CivicData CKAN**: 714 records + 20 equipment, 0 errors
   - Added to ingest-permits.py as CivicData CKAN platform (same as Tampa)
   - Solar filter on Description, lat/lng from attributes, contractor as installer
5. **San Diego County transform upgrade**: 876 equipment records from structured `use` field
   - Upgraded from tier 3/generic_socrata to tier 0/san_diego_county
   - Parses: NO. OF MODULES, NO. OF INVERTERS, TOTAL SYSTEM SIZE IN KILOWATTS, mount type, contractor

### Completed Last Session (Session 15)
6. **Owner_name enrichment**: USASpending REAP + NY Statewide Distributed Solar — 15,477 net patches
   - owner_name coverage: **28.6% → 31.4%**
7. **Mount type heuristic classification**: 412,405 records classified via SQL heuristics
   - mount_type coverage: **17.2% → 90.4%**
8. **Developer inference from installer**: 326,396 records
   - developer_name coverage: **3.6% → 61.5%**
9. **HIFLD utility territory spatial join**: 372,033 records patched
   - operator_name coverage: **23.4% → 99.4%**

### Short-term
10. **Run enrichment pipeline on new 77K records**: eGRID, LBNL, CEC specs, location precision, county derivation, NOAA storms
11. **Cross-source dedup on expanded 641K database**: Match SD City records to existing TTS/CA sources
12. **Rebuild Next.js site**: Regenerate static pages with updated 641K stats
13. **SEIA membership** ($1K/yr): 7K+ projects with developer+owner+offtaker — best ROI paid source
14. **NLCD/NAIP for remaining mount_type**: 14,619 ambiguous records with exact coords

### Medium-term
15. **CivicData BLDS expansion**: Lee County FL, Brevard County FL, Manatee County FL
16. **PJM-GATS Playwright automation**: Automate XLSX export for repeatable owner enrichment
17. **Equipment extraction NLP**: Run parse-permit-equipment.py on all permit cities
18. **Satellite images for new permit records**: ~362K images needed at ~$724 (4 months of free credit)

### Data Gap Summary (Feb 13, 2026 — Session 16)
| Field | Count | Coverage | Notes |
|-------|------:|----------|-------|
| **location_precision** | — | **~100%** | Need to re-run set-location-precision.py for new sdcity_* records |
| **operator_name** | **560,287** | **87.3%** | Down from 99.4% (new records lack operator) |
| county | 634,152 | 98.8% | SD City records have county |
| city | 620,527 | 96.7% | SD City records have city |
| **mount_type** | **510,775** | **79.6%** | Down from 90.4% (new records need heuristic classification) |
| lat/lng | 517,414 | 80.6% | Up from 73.6% (SD City 100% geocoded) |
| address | 512,005 | 79.8% | Up from 76.1% (SD City has addresses) |
| zip_code | 481,282 | 75.0% | Up from 67.6% |
| install_date | 464,579 | 72.4% | Down from 82.2% (many SD City lack dates) |
| installer_name | 414,645 | 64.6% | Up from 59.9% (SD City has installer names) |
| capacity_mw | 374,041 | 58.3% | SD City has kW in descriptions |
| **developer_name** | **346,617** | **54.0%** | Down from 61.5% (new records need inference) |
| total_cost | 283,173 | 44.1% | |
| owner_name | 176,703 | 27.5% | |
| cost_per_watt | 152,708 | 23.8% | |
| **Equipment** | **452,782** | — | +~38K from SD City CSV + SD County + Leon County |
| **Events** | **3,229,371** | — | 3.2M storm + 3.2K recall + 80 generator |

### PJM-GATS Owner Enrichment - COMPLETED (Feb 10, 2026)
- **enrich-pjm-gats.py**: Cross-references PJM-GATS generator export (582,419 solar records across 13+ PJM states)
- **Data source**: Manual XLSX export from https://gats.pjm-eis.com/gats2/PublicReports/GATSGenerators (filter: Solar - Photovoltaic)
- **Key finding**: "Owner?" column is just Y/N flag, NOT actual owner name. No capacity field in export.
- **Strategy**: Parse capacity from Unit Name field (e.g., "13.30 kW"), filter >= 25 kW. MSET (metered utility) records have utility prefix in Plant Name (AEP, VP, DPL, etc.)
- **MSET utility prefixes mapped**: AEP → American Electric Power, VP → Virginia Power (Dominion Energy), DPL → Delmarva Power & Light, JC → Jersey Central P&L, PS → PSE&G, etc.
- **Qualifying records**: 1,560 (377 MSET utility + 1,183 NON commercial). States: NJ 373, DC 372, PA 311, MD 294, OH 103, VA 95
- **Matched**: 178 owner_name patches applied to existing installations via state + name similarity cross-reference
- **File**: `data/pjm_gats/GATSGenerators_20260210_161547.xlsx` (588K rows, 582K solar)

### Municipal Permit Ingestion - EXPANDED (Feb 10-11, 2026)
- **ingest-permits.py**: Multi-city solar permit scraper — expanded from 4 to 27 cities across 5 tiers
- **Platforms**: Socrata SODA API (22 cities), OpenDataSoft (1 city — Cary NC), ArcGIS REST (4 cities)
- **CLI**: `--city sf,la`, `--tier 1,2`, `--dry-run`, `--list-cities`
- **Tier 0** (ArcGIS with rich data):
  - Sacramento CA (16,042 records, contractor, address, solar description)
  - Philadelphia PA (CARTO, contractor, owner, equipment from descriptions)
  - San Jose CA (CKAN, owner, contractor, address)
  - Salt Lake City UT (Socrata, installer, address + embedded lat/lng)
  - Denver/Boulder CO (6,506 records, dedicated PV kW field, PV cost, contractor) **NEW**
  - Minneapolis MN (3,332 records, lat/lng, installer, owner, cost, permit type) **NEW**
  - Detroit MI (643 records, lat/lng, cost, gap state MI coverage) **NEW**
  - Albuquerque NM (1,397 records, owner + contractor + applicant, gap state NM) **NEW**
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
- **Session 1 results**: 84,563 new records created, 177 errors (Raleigh BLDS 400 Bad Request)
- **Session 2 results** (Feb 11): +11,878 records (Denver 6,506 + Minneapolis 3,332 + Detroit 643 + Albuquerque 1,397), 536 equipment, 0 errors
- **Key features**: In-memory dedup (`seen_ids`), false positive filtering (solar screens/shades/tubes), description parsing for kW/panels/wattage, OBJECTID-based ArcGIS pagination for MapServer endpoints
- **Cambridge rich data**: Inverter make+model, mount type (roof/ground), panel count, battery storage, system size kW — creates solar_equipment records
- **Denver rich data**: Dedicated `PhotovoltaicKilowatt` and `EstPhotovoltaicCost` fields, `SolarSystemDescription`
- **Minneapolis rich data**: Direct lat/lng coords, `applicantName` (installer), `fullName` (owner), `permitType` (commercial/residential)
- **Albuquerque rich data**: Three entity fields: `Owner`, `Contractor`, `Applicant`. Web Mercator→WGS84 projection.
- **Data source name in DB**: `municipal_permits_{city_key}` (one per city)
- **Removed cities**: Cincinnati (0 solar), Roseville (sparse data), Chattanooga (SSL error), Baltimore (empty API)
- **Dead endpoints (researched Feb 11)**: Kansas City MO (Socrata 404), Chicago Solar dedicated dataset (404)

### PJM Queue Ingestion - COMPLETED (Feb 11, 2026)
- **ingest-pjm-queue.py**: Downloads PJM interconnection queue via public Planning API (no registration needed)
- **API**: `POST https://services.pjm.com/PJMPlanningApi/api/Queue/ExportToXls` with static public key `E29477D0-70E0-4825-89B0-43F460BF9AB4`
- **Discovery**: PJM's Queue Scope web app uses a separate Planning API that returns Excel directly — bypasses the blocked Data Miner 2 endpoint entirely
- **All 7 ISOs now covered**: CAISO, NYISO, ERCOT, ISO-NE, SPP, MISO, PJM
- **Results**: 1,409 solar projects >= 1 MW found, 1,154 created, 14 states
- **States**: VA 291, PA 262, OH 233, NJ 143, IN 122, IL 88, MD 78, KY 66, NC 61, WV 31, MI 16, DE 14
- **Fields**: project_id, name, commercial_name (developer), state, county, capacity (MW), status, transmission_owner (operator)
- **Commercial Name extraction**: 26.9% coverage (1,225 of 4,549 solar records). Extracted as `developer_name`. 775 records backfilled.
- **PJM Data Miner 2 API**: Key obtained (`PJM_DATAMINER_API_KEY` in .env.local) but all ~95 feeds are aggregate RTO/zone-level data — NO plant-specific installation data. Not useful for our purposes.
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

### Municipal Permit Expansion - Session 4 (Feb 11, 2026)
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

### Municipal Permit Expansion - Session 6 (Feb 11, 2026)
- **4 more ArcGIS cities added**: Denver/Boulder CO, Minneapolis MN, Detroit MI, Albuquerque NM
- **Denver/Boulder CO**: 6,506 records via ArcGIS FeatureServer. Rich solar-specific fields: `PhotovoltaicKilowatt`, `EstPhotovoltaicCost`, `SolarSystemDescription`, `ContractorCompanyName`. No geometry (addresses only, geocodable). Multi-city coverage (Boulder, Denver, Aurora, Lakewood, etc.).
- **Minneapolis MN**: 3,332 records via ArcGIS FeatureServer. Direct lat/lng in attributes. `applicantName` (installer), `fullName` (owner), `value` (cost), `permitType` (commercial/residential). 532 commercial permits. `comments` field has descriptions.
- **Detroit MI**: 643 records via ArcGIS FeatureServer. Direct lat/lng. `amt_estimated_contractor_cost` (string!), `work_description`. No contractor field but descriptions mention panel counts. Michigan is a gap state.
- **Albuquerque NM**: 1,397 records via ArcGIS MapServer. Three entity fields: `Owner`, `Contractor`, `Applicant`. Web Mercator (EPSG:3857) → WGS84 projection in transform. NM is a gap state.
- **MapServer pagination fix**: Old ArcGIS MapServer ignores `resultOffset`/`resultRecordCount`. Added OBJECTID-based deduplication in `fetch_arcgis` — tracks seen OIDs and breaks when records start repeating.
- **Unix timestamp handling**: ArcGIS returns dates as Unix ms timestamps. Updated `safe_date()` to handle both int and string ms timestamps.
- **Total**: 11,878 new records, 536 equipment, 0 errors
- **Dead endpoints researched**: Kansas City MO Socrata (404), Chicago Solar dedicated dataset (404)

### Census Batch Forward Geocoding - IN PROGRESS (Feb 11, 2026)
- **forward-geocode-census.py**: Fixed Census API URL (`geocoding.geo.census.gov`, not `geocoding.census.gov`)
- **Bug fix**: Batch size 10K caused timeout; reduced to 1K per request (~16s response time)
- **Added**: Retry logic (3 attempts, exponential backoff), 300s timeout
- **Running**: 79,024 valid addresses (82,554 total - 3,530 non-geocodable)
- **Match rate**: ~83% (consistent across batches)
- **Sources being geocoded**: permit (66,650), tts3 (7,622), cadg (2,742), mapts (1,224), vacooper (558), iso (228)
- **Impact**: lat/lng coverage 47.6% → ~70%+ when complete
- **Also sets**: `location_precision = 'exact'` on matched records

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
- `forward-geocode-census.py` — Census Bureau batch geocoder (1K addresses/request, free, ~83% match rate). URL: `geocoding.geo.census.gov`.
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

### Gap-Filling Session - Feb 11, 2026 (Session 5)

**PJM Queue developer_name extraction:**
- Updated `ingest-pjm-queue.py` to extract `Commercial Name` column as `developer_name`
- Added backfill phase that patches developer_name onto existing PJM records
- 775 developer_name patches applied, 0 errors (of 1,309 existing PJM records, 726 had Commercial Names in Excel)
- developer_name total: 8,108 (2.8% of DB, up from 2.6%)

**PJM Data Miner 2 API investigation:**
- Obtained API key (saved as `PJM_DATAMINER_API_KEY` in .env.local)
- Researched ~95 available feeds — ALL are aggregate RTO/zone-level market data (pricing, uplift credits, load)
- NO plant-specific installation or ownership data in Data Miner 2
- The Planning API (public, no registration) remains the correct source for queue data

**Droplet classification batch 3 status:**
- 10,700/35,113 images (30.5% complete), 5,014 classified, 5,686 no panels
- ETA: ~16 hours remaining at 0.4 img/sec

### Gap-Filling Session - Feb 11, 2026 (Session 7)

**Enrichment pipeline re-run on 302K records:**
- Cross-source dedup: 6,561 patches, 0 errors
  - 5,978 location upgrades, 553 crossref links, 95 operator, 30 install_date, 22 developer, 18 address, 17 owner, 8 installer
  - Phase 1: 15,030 ID matches, Phase 2: 24,988 proximity, Phase 3: 92 broad
- CEC equipment specs: 0 new matches (all existing records already enriched)
- CPSC recalls: 3,519 events created (336K equipment scanned)
- Location precision: Re-run completed (exact: 137,149, address: 61,856, city: 86,877, zip: 6,996, county: 4,814, state: 19)

**Storm event deduplication crisis — FIXED:**
- Discovered 1,660,149 storm events in DB (should have been ~561K) — duplicates from multiple script runs
- Root cause: NOAA/CPSC scripts generate fresh UUID PKs, so `ignore-duplicates` header never catches duplicates
- Deleted ALL storm events via psql: `DELETE FROM solar_site_events WHERE event_type IN ('hail','severe_hail','high_wind')` — 1,660,149 deleted in seconds
- Deleted 3,520 duplicate recall events via psql window function (kept oldest per partition)
- **Fixed both scripts** to check existing events before inserting:
  - `enrich-noaa-storms.py`: Loads existing (installation_id, event_type, event_date) set, skips duplicates
  - `enrich-cpsc-recalls.py`: Same dedup pattern for recall events
  - Scripts are now idempotent — safe to re-run without creating duplicates
- NOAA storms clean re-run started on 302K installations (~1.7M events expected)

**Census batch geocoder — COMPLETED:**
- 66,376 valid addresses submitted in 67 batches of 1,000
- **52,774 addresses geocoded** (79.5% match rate), 13,600 no Census match, 2 patch errors
- lat/lng coverage: 47% → **70.2%** (211,760 / 301,756)
- Parallel patching fix (ThreadPoolExecutor 20 workers) reduced patch time from ~7 min/batch to ~5 sec/batch
- Total geocoder runtime: ~25 minutes (was estimated at 3+ hours before parallel fix)

**NOAA storms — COMPLETED (clean re-run):**
- **1,687,103 site events created** affecting 256,840 installations, 50 errors (0.003%)
- Parallel insert fix (10 workers) reduced runtime from ~4 hours to ~35 minutes
- Dedup check correctly skipped 1,000 events from previous partial run
- Events: 760K hail + 928K wind across 11 years (2015-2025)

**Droplet classification batch 3 resume:**
- Progress: 8,200/37,129 (22%), 4,330 classified, 3,870 no panels, 0.4 img/sec
- ETA: ~20 hours remaining
- Logs: `/root/solar-nrel/results/classify_batch3_resume.log`

**Psql direct SQL access:**
- Bulk operations (DELETE 1.7M rows, window function dedup) are instant via psql vs hours via REST API
- `PGPASSWORD='#FsW7iqg%EYX&G3M' psql -h aws-0-us-west-2.pooler.supabase.com -p 6543 -U postgres.ilbovwnhrowvxjdkvrln -d postgres`

**Performance optimizations applied this session:**
- `forward-geocode-census.py`: ThreadPoolExecutor(20) for parallel PATCH — 84x faster
- `enrich-noaa-storms.py`: ThreadPoolExecutor(10) for parallel POST — 5x faster
- Both NOAA + CPSC scripts now have dedup checks — fully idempotent on re-run

### Comprehensive Permit Portal Research - Feb 12, 2026 (Session 8)

Launched 6 parallel research agents to sweep ALL US municipal open data portals for solar permit data. Goal: "add all possible data from scraped permit records from every city in the country."

**Research methodology:**
- Agent 1 (Socrata): Swept Socrata Discovery API (`api.us.socrata.com/api/catalog/v1`) across all US Socrata domains
- Agent 2 (CKAN/other): Searched CKAN portals (data.boston.gov, data.sanantonio.gov, data.virginia.gov), OpenDataSoft, CivicData.com
- Agent 3 (Major cities): Probed Houston, San Diego, Portland, Columbus, Jacksonville, Atlanta, Tampa, St. Louis
- Agent 4 (County-level): Probed LA County, Cook County, King County, Clark County NV, Orange County CA, Hillsborough County FL
- Agent 5 (ArcGIS): Searched ArcGIS FeatureServer/MapServer endpoints across dozens of cities
- Agent 6 (Sun Belt): Probed Wake County NC, Charlotte/Mecklenburg, Bakersfield CA, and more

**NEW VIABLE SOURCES DISCOVERED (not yet in ingest-permits.py):**

| Priority | City/Source | Platform | Solar Records | Key Fields | API Endpoint |
|----------|-----------|----------|--------------|------------|-------------|
| 1 | **Virginia Beach, VA** | CKAN | 4,251 | **Equipment manufacturer+model+specs** (Ohm-level detail), address, dates | `data.virginia.gov` resource `d66e8fbe` |
| 2 | **Henderson, NV** | Socrata | ~8,865 | Owner name, contractor+license, equipment in descriptions, lat/lng | `performance.cityofhenderson.com/resource/fpc9-568j` |
| 3 | **San Diego City** | Static CSV | ~125,993 | Installer, kW, module count, battery, lat/lng, 100% geocoded | `seshat.datasd.org/development_permits_set2/` |
| 4 | **San Antonio, TX** | CKAN | 14,885 | Dedicated "Solar - Photovoltaic Permit" type, installer names | `data.sanantonio.gov` resource `c22b1ef2` |
| 5 | **Boston, MA** | CKAN | ~3,000+ | Rich equipment in comments (manufacturer+model+kW), lat/lng, installer | `data.boston.gov` resource `6ddcd912` |
| 6 | **Orlando, FL** | Socrata | ~1,000+ | Owner name, contractor+address+phone, project name | `data.cityoforlando.net/resource/ryhf-m453` |
| 7 | **Corona, CA** | Socrata | ~500+ | Dedicated `permitsubtype="SOLAR PANELS-PHOTOVOLTAIC SYSTEM"`, lat/lng | `corstat.coronaca.gov/resource/2agx-camz` |
| 8 | **Marin County, CA** | Socrata | ~500+ | Equipment NLP (panel count, kW, microinverters), lat/lng, contractor+license | `data.marincounty.gov/resource/mkbn-caye` |
| 9 | **Wake County, NC** | ArcGIS | 2,160 | Contractor, owner, equipment in descriptions, Web Mercator coords, cost | ArcGIS MapServer (URL TBD from agent) |
| 10 | **Sonoma County, CA** | Socrata | ~300+ | Equipment NLP (kW, battery models), addresses | `data.sonomacounty.ca.gov/resource/88ms-k5e7` |
| 11 | **Cincinnati, OH** | Socrata | ~200+ | Contractor names ("DOVETAIL SOLAR AND WIND"), Ohio gap state | `data.cincinnati-oh.gov/resource/uhjb-xac9` |
| 12 | **Baton Rouge, LA** | Socrata | ~200+ | Owner+contractor names, Louisiana coverage | `data.brla.gov/resource/7fq7-8j7r` |
| 13 | **Little Rock, AR** | Socrata | ~100+ | Dedicated "Solar Panel Permit Fee" category, contractor, Arkansas coverage | `data.littlerock.gov/resource/mkfu-qap3` |
| 14 | **Memphis/Shelby Co, TN** | OpenDataSoft | 225 | Installer names, lat/lng, Tennessee gap state | `datamidsouth.opendatasoft.com` dataset `shelby-county-building-and-demolition-permits` |
| 15 | **VA DEQ Renewable Energy** | CKAN | 326 (100% solar) | MW capacity, project names, county, utility-scale | `data.virginia.gov` resource `8f983ea2` |
| 16 | **Framingham, MA** | Socrata | ~200+ | Description, embedded lat/lng, MA coverage | `data.framinghamma.gov/resource/2vzw-yean` |
| 17 | **Somerville, MA** | Socrata | ~100+ | Direct lat/lng, description | `data.somervillema.gov/resource/vxgw-vmky` |
| 18 | **Prince George's Co, MD** | Socrata | ~49,502 | Address, cost, dates (limited fields, intermittent API) | `data.princegeorgescountymd.gov/resource/weik-ttee` |
| 19 | **LA County** | Socrata | ~1,058 commercial | Rich descriptions (kW, panels), address, valuation, utility-scale | Already in system but needs upgrade |
| 20 | **Pierce County, WA** | Socrata | ~100+ | Coordinates (State Plane), descriptions | `open.piercecountywa.gov/resource/rcj9-mkn4` |
| 21 | **Columbus, OH** | ArcGIS | ~200+ | Applicant business name, address, issued date, geometry | `maps2.columbus.gov/arcgis/rest/services/Schemas/BuildingZoning/MapServer/5` |

**UPGRADE opportunities for existing cities:**
- **Honolulu HI**: New dataset `4vab-c87q` at `data.honolulu.gov` has 68,234 solar records with boolean `solarvpinstallation='Y'` filter. Current scraper uses different endpoint with ~3,355 records. **10x improvement possible.**
- **San Antonio TX**: Already in system via ArcGIS but CKAN API has 14,885 dedicated solar permits with installer names. May supplement existing records.
- **Boston MA**: Already in system via BLDS (4,091 records) but CKAN API has ~3K+ solar with MUCH richer equipment data in comments field (manufacturer+model for panels AND inverters). Worth adding as second endpoint.

**CONFIRMED NOT VIABLE (researched and rejected):**
- Houston TX: No individual permit API (CKAN has only aggregate monthly summaries)
- ~~Portland OR~~: **ADDED in Session 9** — 9,881 records from ArcGIS MapServer Layer 4
- Columbus OH: ArcGIS MapServer returns 403 Forbidden. Filter too narrow.
- Jacksonville FL: No open data API (JaxEPICS web-only)
- Atlanta GA: ArcGIS CSV download, only 11 solar permits
- ~~Tampa FL~~: **ADDED in Session 9** — 1,087 records from CivicData CKAN
- St. Louis MO: Microsoft Access databases only (no API)
- ~~Charlotte/Mecklenburg NC~~: **ADDED in Session 9** — 5,898 records from ArcGIS FeatureServer
- ~~Louisville KY~~: **ADDED in Session 8** — 901 records from ArcGIS FeatureServer
- Clark County NV: Accela-based, no building permit data in public API (only 4 solar records)
- King County WA: Socrata endpoints return 404
- Orange County CA: No permit services in 208 ArcGIS services
- Hillsborough County FL: Only 7 solar records in PermitsPlus
- NJ Statewide (data.nj.gov): 2.7M records but NO description/work field, cannot filter for solar
- ~~Baltimore MD~~: **ADDED in Session 8** — 2,132 records (not stale, filtered correctly)
- Miami FL: Portal dead (DNS fails, last updated June 2022)
- ~~CivicData.com~~: Tampa FL works with User-Agent header — 4 more FL counties to test

**Virginia Beach is the single most valuable discovery:** The `WorkDesc` field contains structured equipment specs comparable to Ohm Analytics ($30K/yr): "7 SILFAB SOLAR SIL-430 QD, ENPHASE IQ8PLUS-72-2-US, UNIRAC NXT mounting, 12.78 kW DC". This fills our biggest data gap (equipment per site) for FREE.

**San Diego City is the largest single source:** 125,993 solar permits across 4 CSV files, all 100% geocoded with lat/lng, installer names, kW/module/inverter counts in descriptions. Requires CSV download handler (not API-queryable). Set 2 files are the current system.

**Estimated new records from all viable sources: ~210,000+ solar permits**
- Would increase municipal permit coverage from 233K → ~443K+ records
- Key gap states filled: OH, AR, TN, LA, NV

**Implementation status — COMPLETED (Sessions 8-9):**
- ALL viable cities from research have been added to ingest-permits.py
- ~250K+ new permit records ingested across Sessions 8-9
- See Session 8 and 9 notes below for complete details
- Total permit portals: 55+ cities/counties across 6 platforms

**Droplet classification batch 3 status:**
- ~50% complete, ~10 hours remaining at 0.4 img/sec
- mount_type coverage: ~20.7% and climbing

### Municipal Permit Expansion - Session 8 (Feb 12, 2026)
**Massive permit scraper expansion — 18 new cities + 3 state-level programs, ~165K records**

**New Socrata cities (generic_socrata transform, enhanced with 10+ field name variants):**
- Henderson NV: 22,918 records (owner name, contractor, lat/lng from `gisy`/`gisx`)
- Corona CA: 9,453 records (dedicated `permitsubtype=SOLAR`)
- Marin County CA: 3,866 records (contractor, lat/lng)
- Sonoma County CA: 3,845 records
- Little Rock AR: 2,129 records (`projectdesc` field, contractor)
- Somerville MA: 1,635 records (direct lat/lng)
- Prince George's County MD: 48,915 records (largest single Socrata source)
- Framingham MA: 3,435 records (`sub_type=SOLAR`, embedded lat/lng)
- Pierce County WA: 1,676 records (GeoJSON coords)

**New ArcGIS cities (dedicated transforms):**
- LA County CA: 24,989 records (mount type from WORKCLASS_NAME, equipment from descriptions, out_sr=4326)
- Las Vegas NV: 8,589 records, 174 equipment (3 description fields)
- Baltimore MD: 2,132 records, 393 equipment (CaseNumber IDs, Description NLP)
- Louisville KY: 901 records (Table type — no geometry, lat/lng in attributes)
- Columbus OH: 0 records (403 Forbidden)

**New CKAN cities (dedicated transforms):**
- Virginia Beach VA: 3,457 records, 742 equipment (BEST equipment data — structured specs in WorkDesc)
- Boston MA CKAN: 14,990 records (WorkType + Comments, solar keyword search)

**New state-level programs:**
- NY Statewide Distributed Solar: 8,596 records (developer names on every record, utility as operator)
- CT RSIP Solar: 54 records (contractor, system_owner, utility, CT gap state)
- Collin County TX: 3,288 records (owner name, builder/installer, situs address)

**Key bug fixes:**
- generic_socrata: Added 10+ field name variants per concept (permit ID, description, address, coords, etc.)
- Coordinate range validation: Catches State Plane values (>90 lat or >180 lng) — prevents numeric overflow
- PGRST102 batch key consistency: `mount_type` must ALWAYS be included (not conditionally) to match batch keys
- PERMIT vs permit number: Portland's PERMIT field was the permit TYPE, not number — use OBJECTID instead
- CivicData CKAN: Returns 403 without User-Agent header — fixed in fetch_ckan

**Enrichment pipeline re-run results:**
- eGRID: 6,825 patches
- WREGIS: 197 owner patches
- PJM-GATS: 149 owner patches
- LBNL: 28 developer patches
- GEM: 65 patches (27 owner, 48 operator)
- CEC equipment specs: 2,642 enrichments
- Location precision: 291,637 exact, 133,926 address, 89,647 city (100% coverage)
- Census geocoder: Running on 154,656 new addresses

### Municipal Permit Expansion - Session 9 (Feb 12, 2026)
**3 more cities from research agents, filling Oregon and Florida gap states**

- **Charlotte/Mecklenburg County NC**: 5,898 records via ArcGIS FeatureServer. Owner name (`ownname`), building cost (`bldgcost`), kW extraction from descriptions. NC partial coverage filled.
- **Portland OR**: 9,881 records via ArcGIS MapServer Layer 4. Oregon is a gap state — now covered. 122 equipment records extracted from rich descriptions. `outSR=4326` projection.
- **Tampa FL**: 1,087 records via CivicData CKAN (BLDS standard). 8 equipment records. Florida gap state partially filled. Rate limiting bypassed with User-Agent header.
- **Total**: 16,866 new records, 130 equipment, 0 errors
- **Cross-source dedup + Census geocoding**: Running in background on full ~549K database

### Enrichment Pipeline Re-run - Session 10 (Feb 12, 2026)
**Full enrichment pipeline on expanded 554K database after Session 8-9 permit expansion**

**Classify script memory fix:**
- Batch 3 crashed (OOM kill at 26.7GB on 15GB droplet) after 12,400 images
- Root cause: matplotlib figures accumulating inside NREL PanelDetection library
- Fix: Added `matplotlib.use('Agg')`, `plt.close('all')` per image, `gc.collect()` every 50
- Created `classify-batch-wrapper.sh` — restarts Python process every 2,000 images to guarantee memory stays under 3GB
- Wrapper running: 0.4 img/sec, memory stable at 2.7GB (vs 26.7GB before fix), ~22 hours ETA for 31K remaining images

**Enrichment results on 554K installations:**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 2,609 | 2,584 operator + 2,591 owner |
| WREGIS | 0 | All already applied in previous runs |
| GEM | 51 | 20 owner + 39 operator |
| LBNL Queued Up | 17 | developer names |
| PJM-GATS | 128 | owner names |
| CEC Equipment Specs | 89 | module + inverter matches (saturated) |
| CPSC Recalls | 2,391 | new recall events |
| Backfill Source Fields | 0 | All already applied |
| OSM Cross-Reference | 30 | 23 site names + 7 operators |
| TTS-EIA Cross-Reference | 6,088 | addresses + coordinates inherited |
| County Derivation | 3,843 | city+state lookup |
| Location Precision | 33,516 | Fixed all NULLs → 100% coverage |

**NOAA Storm Events — COMPLETED:**
- 3,193,892 new storm events created for ~252K new permit installations
- Total: 4,980,245 events (2.75M wind + 1.87M hail + 364K severe hail)
- Affecting 477,508 installations (86.1% of database), 0 errors
- Script now fully idempotent (checks existing events before inserting)

**Cross-Source Dedup — COMPLETED:**
- 55,769 match pairs across 3 phases (ID-based, proximity, broad)
- 6,326 patches applied, 0 errors
- Key enrichments: 5,740 location upgrades, 588 crossref links, 71 operator, 30 developer, 21 owner

**Data Source Record Counts — FIXED:**
- Updated all 81 solar_data_sources records with accurate counts via data_source_id FK
- Previously many permit sources showed stale 0 counts

**Next.js Site — REBUILT:**
- Static build successful, all 5 pages regenerated
- Stats API confirms 554,557 installations, 377,523 equipment

**Grand Total (Feb 13, 2026 — Session 16):**
- **641,784 installations** across 92 data sources (18 primary + 71 permit portals)
- **452,782+ equipment records** (growing — SD City set2_closed equipment still inserting)
- **3,229,371 events** (3.2M storm + 3.2K recall + 80 generator)
- **80.6% with lat/lng coordinates** (SD City 100% geocoded, Census geocoder completed)
- **Droplet batch 3**: Running autonomously on droplet

### Session 11 — Feb 12, 2026

**New permit cities added:**
- **Fort Collins, CO** (Solar Interconnections): 2,674 records with kW capacity and addresses. Dedicated solar interconnection dataset via `opendata.fcgov.com`.
- **Cambridge, MA** (Solar Installations): 1,135 PV installation records with lat/lng, kW, and building type. Filtered by `systemtype='PV'`.
- **Total**: 3,809 new records created, 0 errors

**Dead endpoints removed:**
- **Oxnard CA**: Portal migrated to OpenGov platform, DNS dead (`data.cityofoxnard.org` unresolvable)
- **NYC Electrical Permits**: Field `scope_of_work` doesn't exist; `work_description` has near-zero solar content (3 matches)
- **Bloomington IN**: Only 29 municipal facility records, no kW data — too sparse

**Honolulu filter fixed:**
- Changed `solar='Y'` → `solarvpinstallation='Y'` (PV-specific boolean). `solar` flag tracks solar water heating, not PV.
- Commercial solar count: 3,737 (up from ~3,355 with old filter)

**Comprehensive permit portal research completed:**
- Launched 6 parallel research agents sweeping Socrata Discovery API, ArcGIS Hub, CKAN portals, state programs, and top 100 US cities
- **69 portals already covered** in `ingest-permits.py`
- **~35 new viable sources identified** (est. 150-200K records), but most are small (<500) and heavily residential
- **Key findings**:
  - San Diego City CSV (~125K records) is largest uncaptured source but data.sandiego.gov returns 404 (portal may have migrated)
  - Howard County MD has 2,723 solar permits but ALL residential (zero commercial) — skipped
  - Cincinnati OH returns 0 solar matches on all searched fields — skipped
  - Delaware Green Energy Grants has 5,825 PV but only 144 non-residential, NO addresses — skipped
  - Most remaining cities yield <500 mostly-residential records with marginal value
- **Conclusion**: Municipal permit scraping has reached diminishing returns at 69 portals. Remaining coverage gaps are best filled by:
  1. SEIA membership ($1K/yr) for developer/owner names
  2. Continued droplet classification for mount_type
  3. Cross-source dedup on expanded database

**Spec completeness assessment completed:**
- **A grade**: Geographic coverage (100% state, 98.6% county), site type classification (100%), location precision (100%), storm damage tracking (4.98M events), equipment manufacturer (91.4%)
- **B+ grade**: Installer names (60.8%), install dates (82.0%), cross-source dedup
- **D-F grade**: Developer names (3.6%), racking equipment (0.03%), mount type (17.4%), lifecycle events (240 total)
- **Unique competitive advantages**: Storm damage tracking (no commercial DB has this), recall tracking, satellite mount classification
- **Top ROI actions**: Complete batch 3 classification ($0), ingest Virginia Beach equipment data ($0), buy SEIA ($1K/yr)

**Database status:**
- **558,366 installations** (+3,809 from Fort Collins + Cambridge)
- **377,523 equipment records**
- **4,988,724 events**
- **96,956 with mount_type** (17.4%, climbing from batch 3)
- **100% location_precision coverage** (restored for new records)
- **Droplet**: 2.9GB/15GB RAM, stable, actively classifying at 0.4 img/sec

### Session 12 — Feb 12, 2026

**Enrichment pipeline re-run:**
- Cross-source dedup: 54,912 match pairs, 3,275 patches (2,934 location upgrades, 329 crossref, 18 developer, 11 owner, 4 installer, 3 operator, 2 install_date, 1 total_cost), 0 errors
- Next.js site rebuilt with 558K installation stats
- All 5 pages rebuilt: Dashboard, Search, Equipment, Installers, Site Detail

### Session 13 — Feb 12, 2026

**Event dedup crisis discovered and fixed:**
- Storm events had ballooned to 5.5M (expected ~1.7M) from multiple overlapping NOAA/CPSC runs
- Root cause: Dedup pagination bug in both `enrich-noaa-storms.py` and `enrich-cpsc-recalls.py`
  - Both scripts used `limit: 10000` for existing event check, but Supabase max_rows=1000
  - Result: Only first 1000 existing events loaded into dedup set, rest re-created as duplicates
- Fix: Changed both scripts to `page_size = 1000` with proper pagination loop and `order: id`
- Cleanup: Deleted all storm events via psql, deleted recall duplicates via window function
- Clean NOAA re-run: 3,227,976 events (1,246,450 hail + 231,035 severe_hail + 1,750,491 wind) on 558K installations, 482,219 flagged (86.4%)
- CPSC recalls: 3,211 unique events (deduped from 5,582)
- **Total events: 3,231,267** (clean, verified via psql)

**Droplet classification batch 3 status:**
- 12,400/37,129 images processed (33.4%)
- 6,494 classified (52.4% detection rate)
- ETA: ~17 hours remaining at 0.4 img/sec

**Field coverage update (558,366 installations):**
| Field | Count | Coverage |
|-------|------:|----------|
| location_precision | 558,366 | 100.0% |
| county | 550,649 | 98.6% |
| city | 512,461 | 91.8% |
| install_date | 458,821 | 82.2% |
| address | 428,729 | 76.8% |
| zip_code | 380,805 | 68.2% |
| exact lat/lng | 367,940 | 65.9% |
| installer_name | 337,347 | 60.4% |
| capacity_mw | 323,106 | 57.9% |
| owner_name | 156,970 | 28.1% |
| operator_name | 127,329 | 22.8% |
| mount_type | 96,956 | 17.4% |
| developer_name | 20,121 | 3.6% |

### Session 14 — Feb 12, 2026

**Census batch geocoding — COMPLETED:**
- 45,812 coordinates geocoded from 95,322 submitted addresses (48.1% match rate)
- Match rate varied by source: early permit batches ~15-21%, later batches with good addresses ~67-69%
- lat/lng coverage: 66.5% → 74.3% (414,724 / 558,366)
- Location precision: exact 413,753 (74.1%)
- 0 errors across 96 batches

**Operator enrichment pipeline — COMPLETED (9 scripts):**
- eGRID: 4,212 patches (4,206 operator, 4,171 owner) — biggest contributor by far
- PJM-GATS: 115 owner patches
- LBNL Queued Up: 61 developer patches
- GEM: 43 patches (36 operator, 13 owner)
- OSM cross-reference: 16 patches (3 operator)
- WREGIS: 1 owner patch (nearly all previously applied)
- EIA-860 owner/plant, backfill-source-fields: 0 new patches (all already applied)
- **Total: 4,448 patches, 0 errors**

**Capacity fixes — COMPLETED:**
- 8,380 records had kW values stored as MW (capacity_mw > 500 for commercial sites)
- Fixed via `SET capacity_mw = capacity_mw / 1000`
- 83,578 cost_per_watt records calculated from total_cost / (capacity_mw * 1M)

**Cross-source dedup — COMPLETED:**
- 56,780 unique match pairs across 3 phases
- 312 patches applied (288 crossref, 34 operator, 17 owner, 9 developer, 5 install_date, 5 total_cost, 2 installer)
- Low patch count expected — database has been through many enrichment passes already

**Next.js site — REBUILT:**
- Static build successful, all pages regenerated with updated 558K stats
- Auth injected into all HTML files

**Field coverage update (558,366 installations):**
| Field | Count | Coverage |
|-------|------:|----------|
| location_precision | 558,366 | 100.0% |
| county | 550,734 | 98.6% |
| city | 512,462 | 91.8% |
| install_date | 458,826 | 82.2% |
| address | 428,729 | 76.8% |
| lat/lng | 414,724 | 74.3% |
| zip_code | 380,805 | 68.2% |
| installer_name | 337,349 | 60.4% |
| capacity_mw | 331,486 | 59.4% |
| total_cost | 281,892 | 50.5% |
| owner_name | 161,286 | 28.9% |
| cost_per_watt | 152,716 | 27.4% |
| operator_name | 131,608 | 23.6% |
| mount_type | 96,956 | 17.4% |
| developer_name | 20,191 | 3.6% |

**Droplet batch 3**: Still running autonomously, 96,956 mount_type in DB, memory stable at 2.8GB/15GB

### Session 16 — Feb 13, 2026

**San Diego City CSV Ingestion — COMPLETED (installations + set2_active equipment):**
- **ingest-san-diego-csv.py**: New standalone script for bulk CSV download from `seshat.datasd.org/development_permits_set2/`
- Downloads `set2_active.csv` (114.6 MB) and `set2_closed.csv` (71.7 MB) — cached after first download
- Solar filtering via APPROVAL_TYPE regex: `photovoltaic|PV|SB 379`
- Equipment parsed from PROJECT_SCOPE using regex: panel manufacturer/model, inverter details, kW/MW capacity, module/inverter counts
- **Set 2 Active**: 254,674 total rows → 28,013 solar records → 28,013 created, 13,713 equipment, 0 errors
- **Set 2 Closed**: 132,550 total rows → 76,937 solar (48,923 new) → 48,923 created, ~23K equipment (inserting), 0 errors
- **Total**: 76,936 net new installations — **largest single ingestion in project history**
- All records have lat/lng (100% geocoded from CSV columns), installer names, addresses, city/zip
- CLI: `--set 1|2|all`, `--dry-run`, `--limit N`
- Source prefix: `sdcity_`, data source: `municipal_permits_san_diego_city`
- Equipment insertion is slow (~1hr for 9K records) due to individual GET+POST per installation — future optimization: batch equipment inserts

**Leon County FL CivicData CKAN — COMPLETED:**
- Added `leon_county` city config + `transform_leon_county()` to `ingest-permits.py`
- Platform: CivicData CKAN (same as Tampa FL), resource ID: `4e34687e-deba-428b-9509-921516df6208`
- **Results**: 857 raw → 714 created, 20 equipment, 0 errors
- Fields: lat/lng, contractor (installer), project cost, permit class, address, mount type from description

**San Diego County Transform Upgrade — COMPLETED:**
- Upgraded from tier 3/generic_socrata to tier 0/san_diego_county with `has_equipment: True`
- New `transform_san_diego_county()` parses structured equipment from `use` field:
  - `NO. OF MODULES: 12540` → module equipment record with quantity
  - `NO. OF INVERTERS: 105` → inverter equipment record with quantity
  - `TOTAL SYSTEM SIZE IN KILOWATTS: 3900` → capacity_kw
  - `GROUND MOUNT` / `ROOF MOUNT` → mount_type
  - `geocoded_column.latitude/longitude` → exact coordinates
  - `contractor_name` → installer_name
- **Results**: 604 installations (already existed, silently ignored), **876 new equipment records**, 0 errors

**Census Geocoder — COMPLETED (background):**
- PID 413 process finished during this session
- Final lat/lng coverage: 517,414 / 641,784 (80.6%)

**Database Status (Session 16, equipment still inserting):**
- **641,784 installations** across 92 data sources (18 primary + 71 permit portals)
- **452,782 equipment records** (growing — set2_closed equipment still inserting)
- **3,229,371 events** (3.2M storm + 3.2K recall + 80 generator)
- **80.6% with lat/lng** (up from 74.3% — SD City 100% geocoded)
- **Commit**: `ca1dea8` — added ingest-san-diego-csv.py + Leon County + SD County equipment parsing
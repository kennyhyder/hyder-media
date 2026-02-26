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
| Parcel Owners | `enrich-parcel-owners.py` | Owner names from ArcGIS tax parcel point-in-polygon queries (13 statewide + 11 county endpoints) | ArcGIS REST APIs (free) |
| Google Places | `enrich-google-places.py` | Website, phone, rating, reviews, address for entity tables (installers, owners, manufacturers) | Google Places API (New) Text Search (~$0.04/query) |
| Entity Portfolio | `enrich-entity-portfolio.py` | avg_project_size_kw, equipment brands, geographic focus, project type distribution | Computed from DB (free) |
| Treasury 1603 | `enrich-treasury-1603.py` | Owner/developer names + total_cost estimates from $8B grant program | `data/treasury_1603/1603_awards.xlsx` (auto-downloaded) |
| FEMA Flood Zones | `enrich-fema-flood.py` | flood_zone (A/AE/V/VE/X/D), flood_zone_sfha, flood_zone_bfe | FEMA NFHL MapServer Layer 28 (free, no auth) |

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

| 17 | **MN PUC DER** | `ingest-mn-puc.py` | 7,072 | `mnpuc_` | Excel | >=25 kW non-residential solar | Annual |
| 18 | **PA AEPS** | `ingest-pa-aeps.py` | 3,460 | `paaeps_` | CSV | SUN fuel, >=25 kW | Quarterly |
| 19 | **NC NCUC** | `ingest-nc-ncuc.py` | 1,536 | `ncncuc_` | Excel | Solar/PV, >=25 kW | Annual |
| 20 | **BLM Solar ROW** | `ingest-blm-solar.py` | 898 | `blm_` | ArcGIS FeatureServer | Solar energy facility ROWs on federal lands (AZ, CA, CO, NV, NM, UT, WY) | Quarterly |
| 21 | **SEIA MPL** | `ingest-seia.py` | 8,439 (33 new + 8,406 enriched) | `seia_` | Excel (purchased) | Developer/owner/tracker/module tech for utility-scale. 99.6% cross-ref match | Annual ($1K/yr) |
| 22 | **GRW Microsoft** | `crossref-grw.py` | 6,137 new + 5,075 cross-ref | `grw_` | GeoPackage | Satellite-detected solar polygons (>=0.5 MW). MIT license, Planet Labs imagery | Quarterly |

**Grand Total: ~723,491 installations, ~448,401 equipment records, ~3,339,536 events, 26 primary sources + 75 permit portals**
**Note**: +19K from GRW satellite cross-reference (Session 35) + Census geocoding.

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

# State-level solar programs (Feb 13, 2026)
python3 -u scripts/ingest-mn-puc.py                # MN PUC DER data (7K records, utility/cost/city)
python3 -u scripts/ingest-mn-puc.py --dry-run       # Preview
python3 -u scripts/ingest-pa-aeps.py                # PA AEPS qualified facilities (3.5K records)
python3 -u scripts/ingest-pa-aeps.py --dry-run       # Preview
python3 -u scripts/ingest-nc-ncuc.py                # NC NCUC registrations (1.5K records, owner names)
python3 -u scripts/ingest-nc-ncuc.py --dry-run       # Preview
python3 -u scripts/ingest-permits.py --city hawaii_energy   # Hawaii Energy (93 utility-scale, developer+PPA)
python3 -u scripts/ingest-permits.py --city md_clean_energy # Maryland Clean Energy grants (162 records)

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

### Completed This Session (Session 21)
1. **Zod validation**: Added input validation to all 5 solar API endpoints via shared `_validate.js`
2. **Equipment RPC function**: Created `solar_equipment_search` PostgreSQL RPC for proper JOIN+ORDER BY (fixes capacity sort)
3. **Marker clustering**: Added Leaflet MarkerClusterGroup with chunked loading (removes 1000-marker limit)
4. **Entity table population**: 35,307 installers + 70,965 site owners, all FK IDs linked (475K installer, 160K owner, 135K operator, 16K developer)
5. **Equipment capacity sort fix**: RPC function enables sorting by installation capacity_mw instead of equipment-only fields
6. **Vercel function timeouts**: Added to `vercel.json` for all `/api/solar/*` endpoints
7. **Equipment aging stats**: Added to `/api/solar/stats` endpoint
8. **Data recovery from TRUNCATE CASCADE**: Recovered 706K of 710K installations after accidental `TRUNCATE solar_installers CASCADE`
9. **Full enrichment re-run**: eGRID (31K), WREGIS (17K), CEC (53K), backfill (67K), dedup (42K), NOAA storms (3.3M), CPSC (3.7K recalls)
10. **Location precision**: 100% coverage via direct SQL (fixed 211K NULLs from permit prefixes not in script)
11. **Next.js site rebuilt**: Static pages regenerated with 706K stats

### Short-term
12. **SEIA membership** ($1K/yr): 7K+ projects with developer+owner+offtaker — best ROI paid source
13. **Satellite images for new permit records**: ~362K images needed at ~$724 (4 months of free credit)
14. **Equipment gap investigation**: 426K vs 480K target — ~54K equipment records from permit cities may need re-parsing

### Medium-term
15. **CivicData BLDS expansion**: Lee County FL, Brevard County FL, Manatee County FL
16. **PJM-GATS Playwright automation**: Automate XLSX export for repeatable owner enrichment
17. **Equipment extraction NLP**: Run parse-permit-equipment.py on all permit cities

### Data Gap Summary (Feb 25, 2026 — Session 35)
| Field | Count | Coverage | Notes |
|-------|------:|----------|-------|
| **location_precision** | **723,491** | **100.0%** | All records tagged |
| **mount_type** | **723,491** | **100.0%** | Tiered heuristics + GRW satellite ground-mount |
| **operator_name (linked)** | **722,547** | **99.9%** | HIFLD spatial join + city/state fallback |
| developer_name (linked) | 486,051 | 67.2% | +1,654 SEIA + 2,353 Treasury 1603 |
| **capacity_mw** | **494,969** | **68.4%** | Cost→capacity + module wattage + GRW area estimation |
| installer_name (linked) | 475,474 | 65.7% | All linked to solar_installers via FK |
| **lat/lng** | **583,743** | **80.7%** | +16,168 Census geocoding + 6,137 GRW satellite |
| **owner_name (linked)** | **373,659** | **51.6%** | Parcel + WREGIS + eGRID + SEIA + Treasury |
| **flood_zone** | **138,303** | **19.1%** | **FEMA NFHL completed (6,903 in SFHA)** |
| annual_generation_mwh | 6,997 | 1.0% | EIA-923 + eGRID merged generation data |
| capacity_factor | 6,997 | 1.0% | Calculated from generation / (capacity × 8760) |
| offtaker_name | 2,924 | 0.4% | FERC EQR PPA buyer matching |
| ppa_price_mwh | 525 | 0.1% | FERC EQR PPA prices (median $39.60/MWh) |
| **Entity tables** | **~240,000** | — | 33,969 installers + 207,091 site owners + 1,962 manufacturers |
| **Equipment** | **448,401** | — | Modules + inverters + racking |
| **Events** | **3,339,536** | — | Storm + recall + generator events |

### Entity Enrichment Summary (Session 31)
| Entity Table | Total | Enriched | Websites | Phones | Ratings | City | State |
|-------------|------:|--------:|--------:|------:|-------:|-----:|------:|
| solar_installers | 33,343 | 3,213 | 2,925 | 3,119 | 2,835 | 29,896 (89.7%) | 30,145 (90.4%) |
| solar_site_owners | 204,606 | 1,490 | 1,311 | 1,359 | 1,237 | 200,210 (97.8%) | 204,606 (100%) |
| solar_manufacturers | 1,962 | 258 | 227 | 230 | 236 | — | — |

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
- **Honolulu HI**: Dataset `4vab-c87q` has 68,234 total PV records but 64,493 are residential. Current scraper already captures all 3,737 commercial records correctly. No upgrade needed.
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

**Grand Total (Feb 13, 2026 — Session 17):**
- **641,784 installations** across 92 data sources (18 primary + 71 permit portals)
- **471,611 equipment records** (SD City set2_closed equipment completed)
- **3,651,204 events** (1.42M hail + 234K severe hail + 1.99M wind + 3.2K recall + 80 generator)
- **79.7% with lat/lng coordinates**
- **Enrichment pipeline re-run**: eGRID 5,440 + WREGIS 242 + PJM-GATS 145 + GEM 24 + LBNL 9 + OSM 11 + CEC 1,465 + CPSC 5 + dedup 6,175 + NOAA 421,828 = **435,344 total enrichments**
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

**Database Status (Session 16, post-equipment completion):**
- **641,784 installations** across 92 data sources (18 primary + 71 permit portals)
- **471,611 equipment records** (SD City set2_closed equipment completed in background)
- **3,229,371 events** (3.2M storm + 3.2K recall + 80 generator)
- **80.6% with lat/lng** (up from 74.3% — SD City 100% geocoded)
- **Commit**: `ca1dea8` — added ingest-san-diego-csv.py + Leon County + SD County equipment parsing

### Session 17 — Feb 13, 2026

**Enrichment Pipeline Re-run on 641K database — COMPLETED:**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 5,440 | All owner_name fills via coord matching (Phase 2) |
| WREGIS | 242 | Owner names for western US records |
| PJM-GATS | 145 | Owner names from MSET utility prefixes |
| GEM | 24 | 22 owner + 4 operator via coord matching |
| LBNL Queued Up | 9 | Developer names via state+capacity |
| OSM | 11 | 10 site names + 1 operator |
| CEC Equipment Specs | 1,465 | Module + inverter spec enrichments |
| CPSC Recalls | 5 | New events (3,211 existing correctly deduped) |
| Cross-source dedup | 6,175 | 5,314 location, 472 developer, 434 crossref, 80 owner, 30 installer |
| **Total** | **13,516** | **0 errors across all scripts** |

**NOAA Storm Events for New Records — COMPLETED:**
- 421,828 new storm events created for SD City + Leon County installations, 0 errors
- Total events: 3,651,204 (1.42M hail + 234K severe hail + 1.99M wind + 3.2K recall + 80 generator)
- 565,198 installations now flagged with storm events (88.1% of database)
- Fixed NOAA script: Added psql-based dedup check (instant for 3.2M events vs impossible via REST API)
- Added retry logic with exponential backoff for Supabase 502/500 errors during installation loading
- Added `import time` for retry delays

**Other completed:**
- Git pushed 4 Session 16 commits to origin/main
- Next.js site rebuilt with updated 641K stats

### Session 18 — Feb 13, 2026

**New permit cities added:**
- **Richmond, VA** (Socrata): 3,775 records + 1,321 equipment from `transparentrichmond.org`. Geocoded lat/lng, job value, equipment NLP from descriptions.
- **Cincinnati, OH** (Socrata): 590 records from `data.cincinnati-oh.gov/resource/cfkj-xb9y`. Lat/lng, installer company name, cost. Ohio gap state coverage.
- **NYSERDA Large-Scale Renewable** (Socrata): 136 records from `data.ny.gov`. Utility-scale with developer names, georeference Point, counterparty as owner.
- **Memphis/Shelby County, TN** (OpenDataSoft): 214 records + 54 equipment from `datamidsouth.opendatasoft.com`. Tennessee gap state. Fixed ODS v2.1 API format (`results` not `records`, flat records not nested).
- **Phoenix, AZ** (ArcGIS filter fix): 9,215 new records. Changed filter from `UPPER(PERMIT_NAME) LIKE '%SOLAR%'` to `PER_TYPE IN ('RPV','F193','F194','F209','F800')` to capture all solar permit types (RPV = Residential Photovoltaic).

**SD City Set 1 — COMPLETED (no new records):**
- All 1.17M rows from `set1_active.csv` and `set1_closed.csv` scanned
- All solar records are duplicates of Set 2 (same PMT-XXXXXX permit IDs across sets)
- Total SD City: 118,658 records unchanged

**Gap state research completed:**
- Swept 13 gap states (WI, GA, IN, SC, TN, IA, KS, NE, MS, AL, ID, MT, WV)
- Only 3 viable sources found: Memphis/Shelby TN (ingested), Milwaukee WI (CSV, ~200-500), Kansas City MO (already ingested)
- Most gap states have no public solar data. Best remaining: SEIA membership ($1K/yr)

**Bug fixes:**
- Added retry logic (3 attempts, exponential backoff, 60s timeout) to `enrich-egrid.py` and `enrich-cpsc-recalls.py` `supabase_get()`. Fixes HTTP 500 crashes when paginating 697K records.
- Fixed OpenDataSoft fetcher: v2.1 API uses `results` key (not `records`), flat record objects (not nested under `record.fields`). Pre-encode URL filter spaces as `%20`.
- Fixed eGRID `import time` for retry delays.

**Enrichment Pipeline Re-run on 697K database — COMPLETED:**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 2,959 | operator + owner via coord matching |
| CPSC Recalls | 4 | New events (3,216 existing correctly deduped) |
| CEC Equipment Specs | 64 | Module + inverter spec enrichments |
| Cross-source dedup | 947 | 354 location, 677 crossref, 158 developer, 47 installer |
| NOAA Storms | 249,499 | New events for ~140K new permit installations, 0 errors |
| Census Geocoding | 551 | Addresses geocoded for new records |
| County Derivation | 2 | Near maximum coverage |
| **Total** | **254,026** | **0 errors across all scripts** |

**Next.js Site — REBUILT:**
- Static build successful, all 5 pages regenerated with updated 697K stats

**Grand Total (Feb 13, 2026 — Session 18):**
- **697,436 installations** across 96 data sources (18 primary + 75 permit portals)
- **480,144 equipment records**
- **3,900,707 events** (2.14M wind + 1.53M hail + 236K severe hail + 3.2K recall + 80 generator)
- **80.4% with lat/lng coordinates**
- **84.3% with mount_type** (mostly rooftop from permits + NREL classification)
- **81.2% with operator_name** (mostly contractor/applicant from permits)
- **Permit scraping at diminishing returns**: 75 portals nationwide, gap states researched exhaustively
- **Droplet batch 3**: Still running autonomously on droplet

### Session 19 — Feb 13, 2026

**New state-level data sources ingested (5 new sources, +12,323 records):**

| Source | Script | Records | Prefix | Key Fields |
|--------|--------|---------|--------|------------|
| **MN PUC DER** | `ingest-mn-puc.py` | 7,072 | `mnpuc_` | Utility (operator), capacity, city, zip, cost, year interconnected |
| **PA AEPS** | `ingest-pa-aeps.py` | 3,460 | `paaeps_` | Facility name, county, zip, capacity MW DC/AC, utility (operator), cert date |
| **NC NCUC** | `ingest-nc-ncuc.py` | 1,536 | `ncncuc_` | Company (owner), facility name, capacity kW, active/canceled status |
| **Hawaii Energy** | `ingest-permits.py` | 93 | `hi_energy_` | Developer, PPA, lat/lng, storage, utility-scale only |
| **MD Clean Energy** | `ingest-permits.py` | 162 | `md_ceg_` | Capacity, cost, lat/lng, county |

**New scripts written:**
- `ingest-mn-puc.py` — Minnesota PUC DER data from Excel. Exact normalized name matching for column headers (fixes "city" in "capacity" substring bug). Filters: solar, >= 25 kW, non-residential.
- `ingest-pa-aeps.py` — Pennsylvania AEPS qualified facilities from CSV. 2 header note lines skipped. Filters: fuel=SUN, >= 25 kW.
- `ingest-nc-ncuc.py` — NC NCUC renewable energy registrations from Excel. Header at row 6 (detects "Docket" keyword). Fixed column indices (0-6). Processes active + revoked/canceled sheets.
- Hawaii Energy and Maryland Clean Energy added to `ingest-permits.py` with dedicated transforms.

**Bug fixes this session:**
- **MN PUC column mapping**: `find_col(["City"])` matched "DER.**Capacity**.kW.AC" via substring. Fixed with exact normalized name dictionary lookup (same bug as LBNL Session 2).
- **NC NCUC header detection**: Multi-line title text in row 0 broke generic pattern matching. Fixed by detecting rows starting with "Docket" keyword.
- **Maryland Socrata 403**: Added `User-Agent: SolarTrack/1.0` header to `fetch_socrata()`. Also added `<>,` to safe_chars for URL encoding.
- **Supabase connection overload**: Running 6 enrichment scripts in parallel caused HTTP 500/RemoteDisconnected. Fixed by running scripts sequentially.

**LBNL 2025 Update — No new records:**
- Downloaded 2025 edition (56.9 MB, 59 sheets) from `data.openei.org`
- All 1,775 records have identical EIA IDs to 2024 edition already in database
- Net new: 0 records

**Enrichment Pipeline Re-run on 709K database — COMPLETED:**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 26 | 26 operator + 23 owner via coord matching |
| LBNL Queued Up | 9 | Developer names via state+capacity |
| PJM-GATS | 170 | Owner names from MSET utility prefixes |
| CEC Equipment Specs | 13 | Module + inverter matches (near saturation) |
| Cross-source dedup | 8,393 | 7,319 location, 1,955 developer, 151 crossref, 73 installer, 67 cost, 30 owner |
| Location precision | 12,323 | All new records flagged (0 NULL remaining) |
| **Total** | **20,934** | **0 errors across all scripts** |

**Next.js Site — REBUILT:**
- Static build successful, all 5 pages regenerated with updated 709K stats

**Grand Total (Feb 13, 2026 — Session 19):**
- **709,759 installations** across 101 data sources (23 primary + 75 permit portals + 3 state programs)
- **480,144 equipment records** (91% have manufacturer, 55% have model)
- **3,900,707 events** (2.14M wind + 1.53M hail + 236K severe hail + 3.2K recall + 80 generator)
- **79.5% with lat/lng coordinates** (564,480)
- **82.8% with mount_type** (587,739)
- **81.2% with operator_name** (576,583)
- **65.6% with installer_name** (465,389)
- **60.0% with developer_name** (425,953)
- **26.4% with owner_name** (187,487)
- **100% location_precision coverage** (0 NULL)
- **Droplet batch 3**: Still running autonomously on droplet

### Session 20 — Feb 14, 2026

**Context recovery**: Continued from frozen Session 19 (context limit). Database at 710,705 installations after BLM (898) and LBNL 2025 (48) were ingested in the frozen session.

**Research completed:**
- **BPA queue**: NOT WORTH INGESTING — 359 solar projects but 95% of developer names redacted (8 of 17 with names already in DB). No coordinates.
- **scrape-permit-portals.py**: Complete Playwright scraper exists for Tyler EnerGov portals (5 configured). Requires `pip install playwright && python3 -m playwright install chromium`. ~1,500 records estimated, but setup overhead high for diminishing returns.
- **Remaining viable free sources**: Database at diminishing returns. Virginia Beach VA (3,457 records with Ohm-level equipment data in WorkDesc) is best uncaptured source but already in ingest-permits.py.

**Enrichment pipeline re-run on 710K database — COMPLETED:**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 78 | 78 operator + 37 owner (survived Supabase overload via retry logic) |
| WREGIS | 1,661 | Owner names (CA: 1,658, AZ: 2, NV: 1). Largest single enrichment this session |
| GEM | 49 | 26 owner + 31 operator via coord matching |
| LBNL Queued Up | 7 | Developer names via state+capacity |
| PJM-GATS | 134 | Owner names from MSET utility prefixes |
| CEC Equipment | 0 | Saturated — all matchable equipment already enriched |
| CPSC Recalls | 0 | All 3,220 events already exist (correctly deduplicated) |
| Location Precision | 710,705 | 100% coverage (54 BLM records → state) |
| Cross-source Dedup | 6,378 | 5,820 location, 261 developer, 294 crossref, 65 installer, 43 address |
| **Total** | **8,307** | **0 errors across all scripts** |

**Supabase overload lesson**: Running 7 enrichment scripts simultaneously causes HTTP 500 errors. Scripts WITH retry logic (eGRID, location precision) survive. Scripts WITHOUT retry (GEM, LBNL, PJM-GATS, WREGIS) crash. **Always run enrichment scripts sequentially** (not in parallel) to avoid connection overload.

**Droplet batch 3 classification status:**
- Run 44 of wrapper script (2,000 images per run)
- 72,000/86,000 images processed (83.7%)
- 37,832 classified (52.5% detection rate), 0 errors
- Memory stable at 1.1GB/15GB (wrapper restart fix working)
- ETA: ~14 hours to completion
- mount_type in DB: 588,685 (82.8% of installations)

**Next.js site rebuilt**: Static pages regenerated with 710K stats.

**Grand Total (Feb 14, 2026 — Session 20):**
- **710,705 installations** across 101 data sources (24 primary + 75 permit portals + 3 state programs)
- **480,192 equipment records** (91% have manufacturer, 55% have model)
- **3,900,707 events** (2.14M wind + 1.53M hail + 236K severe hail + 3.2K recall + 80 generator)
- **79.5% with lat/lng coordinates** (564,670)
- **82.8% with mount_type** (588,685)
- **81.1% with operator_name** (576,692)
- **65.5% with installer_name** (465,454)
- **60.1% with developer_name** (427,101)
- **26.8% with owner_name** (190,229)
- **100% location_precision coverage** (0 NULL)
- **Droplet batch 3**: 83.7% complete, ~14 hours remaining

### Session 21 — Feb 14, 2026

**CRITICAL INCIDENT: TRUNCATE CASCADE data loss + recovery**
- `TRUNCATE solar_installers CASCADE` wiped ALL data: 710K installations, 480K equipment, 3.9M events
- Root cause: FK chain — `solar_installations.installer_id` → `solar_installers.id` cascaded deletion
- **Recovery**: Re-ran all 20+ idempotent ingestion scripts in parallel (~9 hours total, permits script was bottleneck)
- **Result**: 706,022 installations recovered (99.4%), 426,431 equipment (88.8%), 3,263,132 events (83.7%)
- **Lesson**: NEVER use TRUNCATE CASCADE on entity tables with FK references to main data tables

**API improvements (from original task):**
- **Zod validation**: New `api/solar/_validate.js` with shared schemas for all 5 endpoints (installations, installation, equipment, installers, export)
- **Equipment RPC function**: Created `solar_equipment_search` in PostgreSQL — proper SQL JOIN+ORDER BY enables sorting by installation capacity_mw. Fixes bug where capacity sort showed 0.1MW as max.
- **Marker clustering**: `InstallationMap.tsx` rewritten with `L.MarkerClusterGroup` (leaflet.markercluster@1.5.3). Chunked loading, removes 1000-marker limit. New type declaration at `src/types/leaflet.markercluster.d.ts`.
- **Vercel timeouts**: Added to `vercel.json` for all `/api/solar/*` endpoints
- **Equipment aging stats**: Added to `/api/solar/stats` — average age, oldest installations, equipment model age distribution

**Entity table population — COMPLETED (SAFELY):**
- **solar_installers**: 27,393 new records inserted (total 35,307). Stats updated: installation_count, total_capacity_kw, first_seen, last_seen.
- **solar_site_owners**: 70,965 records created from unique owner_name + operator_name + developer_name values (grouped by normalized_name, MODE() for display_name and entity_type). Updated owned_capacity_mw and developed_capacity_mw.
- **FK linking**: All installations linked — 475,370 installer_id, 160,266 owner_id, 135,127 operator_id, 15,933 developer_id. 0 unlinked records.
- **Approach**: INSERT ... WHERE NOT EXISTS (no TRUNCATE), UPDATE via normalized_name JOIN. All non-destructive.

**Location precision fix:**
- Script was too slow for 211K NULL records (permit prefixes not in pattern list)
- Fixed via direct SQL: exact (122,948 with coords), address (63,821), city (3,687), remaining 1 → state
- 100% coverage: exact 394,350, address 197,690, city 93,514, zip 10,395, state 5,335, county 4,738

**Enrichment pipeline (Phase 1 — while permits still running):**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 23,374 | operator + owner |
| WREGIS | 16,854 | Owner names for western US |
| CEC Equipment | 39,283 | 54.4% match rate |
| Source Backfill | 67,477 | CA DGStats + NY-Sun + TTS fields |
| GEM | 1,001 | Owner + operator |
| LBNL Queued Up | 1,089 | Developer names |
| PJM-GATS | 263 | Owner names |
| EIA-860 Owner | 73 | USPVDB enrichment |
| EIA-860 Plant | 80 | Generator events |
| Cross-source Dedup | 32,911 | 1 error (502 timeout) |
| CPSC Recalls | 3,699 | Events created |
| NOAA Storms | 2,156,248 | Storm events |

**Enrichment pipeline (Phase 2 — after permits completed):**
| Script | Patches | Notes |
|--------|---------|-------|
| eGRID | 8,254 | For new permit records |
| CEC Equipment | 13,658 | For new equipment |
| Cross-source Dedup | 9,028 | For new records |
| NOAA Storms | 1,103,055 | For ~250K new permit installations |

**Equipment gap**: 426,431 vs 480,144 target (88.8%). Gap is ~54K records from permit cities' parsed equipment (not SD City — SD City has 37,014, matching original). May need re-run of `parse-permit-equipment.py`.

**Grand Total (Feb 14, 2026 — Session 21):**
- **706,022 installations** across 101 data sources
- **426,431 equipment records** (88.8% of pre-truncate 480K)
- **3,263,132 events** (2.2M storm + 1.1M storm Phase 2 + 3.7K recall + 80 generator)
- **35,307 installers** + **70,965 site owners** (all FK linked)
- **100% location_precision coverage** (0 NULL)
- **55.9% exact lat/lng** (394,350 with real coordinates)

### Session 24 — Feb 15, 2026

**Property Owner Enrichment — Phase 4 County Endpoints (TX, MI, DC, LA, CA)**

Extended `enrich-parcel-owners.py` with 4 new county-level endpoints, ran enrichment on multiple counties, and researched dead ends across 10+ jurisdictions.

**New county endpoints added:**
- TX/Travis County (`taxmaps.traviscountytx.gov/.../Parcels/MapServer/0`, `py_owner_name`, envelope): 94.5% hit rate — CRS in WKID 2277 (NAD83 TX Central, feet)
- CA/Riverside County (`content.rcflood.org/.../PermitTracker/Parcel_Basemap/MapServer/0`, split `OWNER1_FIRST_NAME`+`OWNER1_LAST_NAME`): Server unreliable — times out under sustained load
- MI/Wayne County/Detroit (`services2.arcgis.com/.../parcel_file_current/FeatureServer/0`, `taxpayer_1`, envelope): 100% hit rate on all 623 records
- DC (`maps2.dcgis.dc.gov/.../Property_and_Land_WebMercator/MapServer/40`, `OWNERNAME`): 72% hit rate

**Phase 4 Results:**

| State/County | Queried | Found | Hit Rate | Patched |
|-------------|---------|-------|----------|---------|
| LA/Orleans Parish | 14,027 | 13,986 | **99.7%** | 13,986 |
| TX/Travis County | 7,428 | 7,015 | **94.5%** | 7,015 |
| MI/Wayne (Detroit) | 623 | 623 | **100%** | 623 |
| DC | 182 | 131 | 72.0% | 131 |
| AZ/Pima County (carryover) | ~5,000 | 2,969 | ~59% | 2,969 |
| CA/San Diego County | 146,244 | ~75K (est.) | 51.8% | **IN PROGRESS** |
| **Total (completed)** | | **24,724** | | **24,724** |

**Entity table updates:**
- **14,056** new solar_site_owners records created
- **24,724** installations linked via owner_id FK
- **0** unlinked records
- **Total owner entities**: 124,357 (up from 110,301)
- Owner stats (site_count, owned_capacity_mw) updated for all 124,357 entities

**owner_name coverage: 31.5% → 35.0%** (222,599 → 247,323 = **+24,724 net new**)

**Dead ends researched and confirmed:**
- **Sacramento CA**: All 507K parcels have `OWNER = "OWNER OF RECORD"` — redacted per CA Gov Code 7928.205
- **Marin CA**: Only 4.3% of 96K parcels have names — all government/tax-exempt
- **Contra Costa CA**: Public ArcGIS has no owner name field at all
- **Allegheny PA (Pittsburgh)**: Owner names prohibited by Ordinance 3478-07 (2007)
- **Salt Lake County UT**: UGRC redacts owner names from all public GIS services
- **King County WA**: Taxpayer info explicitly redacted from public GIS
- **KY Jefferson County (Louisville)**: PVA requires paid subscription
- **MD statewide**: Confirmed 0% hit rate (endpoint serves non-parcel data)
- **CA/Riverside**: Server handles single queries but crashes under sustained 5-worker load

**SD County CA still running (background task):**
- 7,900/146,244 queried (5.4%), 4,091 found (51.8%)
- Processing ALL 146K CA gap records against SD County endpoint
- Expected: ~75K owner fills when complete (many hours remaining)

**Cumulative parcel enrichment results (Sessions 22-24):**
- **87,058 total parcel matches** across 28 endpoints (13 statewide + 15 county)
- **57,094 net new owner_name fills**
- owner_name: 190,229 (26.8%) → 247,323 (35.0%) = **+8.2 percentage points**

**Grand Total (Feb 15, 2026 — Session 24):**
- **706,019 installations** across 101 data sources
- **426,431 equipment records**
- **3,263,132 events**
- **35,307 installers** + **124,357 site owners** (all FK linked)
- **owner_name: 247,323 (35.0%)** — up from 222,599 (31.5%)
- **operator_name: 135,127 (19.1%)**
- **installer_name: 475,370 (67.3%)**
- **developer_name: 15,933 (2.3%)**
- **100% location_precision coverage** (0 NULL)
- **55.9% exact lat/lng** (394,350 with real coordinates)
- **SD County CA enrichment running** — ~75K additional owner fills expected

### Session 25 — Feb 15, 2026

**Property Owner Enrichment — Phase 5 (NV Clark County + VA Norfolk two-step join)**

Added Clark County NV and Norfolk VA endpoints to `enrich-parcel-owners.py`, including a new two-step join query architecture for Norfolk's split parcel/owner data.

**New county endpoints added:**
- **NV/Clark County** (`mapdata.lasvegasnevada.gov/.../Parcels/MapServer/0`, `OWNER`, envelope): 78.3% hit rate — WKID 3421 (NAD83 HARN Nevada Central in feet). 830K parcels covering all of Clark County (Las Vegas metro). OWNER field truncated to 32 chars.
- **VA/Norfolk** (`gisshare.norfolk.gov/.../AIR_Basemap/MapServer/32`, `Owner1`, envelope + join_table): 50.5% hit rate — Two-step spatial→LRSN→owner table join. Geometry layer 32 (67K parcels) + owner table 47 (74K records) linked by LRSN key.
- **VA/Arlington** (`arlgis.arlingtonva.us/.../Parcel_Map/MapServer/5`, `OWNER1`): Added but no gap records in Arlington County.
- **VA/Chesterfield** (`services3.arcgis.com/.../Cadastral_ProdA/FeatureServer/3`, `OwnerName`, envelope): Added but no gap records in Chesterfield.
- **VA/Spotsylvania** (`gis.spotsylvania.va.us/.../Subdivisions/MapServer/6`, `OwnerSearch`, envelope): Added but no gap records in Spotsylvania.

**New architecture: `arcgis_join_query()` function**
- For endpoints where parcel geometry and owner data are on separate ArcGIS layers
- Step 1: Spatial query on parcel layer → get join key (e.g., LRSN)
- Step 2: Attribute query on owner table using join key → get owner name
- Configurable via `join_table` dict in endpoint config: `{"url": "...", "join_field": "LRSN"}`

**Phase 5 Results:**

| State/County | Queried | Found | Hit Rate | Patched |
|-------------|---------|-------|----------|---------|
| **NV/Clark County** | 17,682 | 13,840 | **78.3%** | 13,840 |
| **VA/Norfolk** | 6,844 | 3,456 | **50.5%** | 3,456 |
| **Total** | **24,526** | **17,296** | | **17,296** |

**Entity table updates:**
- **10,971** new solar_site_owners records created
- **17,299** installations linked via owner_id FK
- **0** unlinked records
- **Total owner entities**: 135,328 (up from 124,357)

**owner_name coverage: 35.0% → 37.5%** (247,323 → 264,622 = **+17,299 net new**)

**Key findings:**
- Clark County NV: Previous research said NV parcel owner data required paid subscription — found that the City of Las Vegas GIS hosts all Clark County parcels publicly at `mapdata.lasvegasnevada.gov`. 78.3% hit rate is excellent.
- Norfolk VA two-step join: Split architecture (geometry layer + owner table) is uncommon but solved with `arcgis_join_query()`. Could be reused for other jurisdictions with similar patterns.
- VA/Richmond City coordinate bug discovered: 3,330 Richmond City VA records have California coordinates (avg lat 37.95, lng -122.33) — Census geocoder matched "Richmond" addresses to Richmond, CA instead of Richmond, VA. These records are NOT geocodable against VA parcel endpoints until coordinates are corrected.
- VA/Prince William and Richmond City endpoints confirmed 0% (6,844 queries each) — gap records not in those counties. Norfolk has 3,483 gap records, Richmond City has 3,330 with bad coords.
- PA/Allegheny County (Pittsburgh): 1,187 gap records but Allegheny blocks public owner names (Ordinance 3478-07). No viable PA endpoint.

**SD County CA still running (background task b78af3a):**
- 12,900/146,244 queried (8.8%), 6,633 found (51.4%)
- Expected: ~75,200 owner fills when complete (~50 hours remaining)
- Will push owner_name to ~48% when complete

**Cumulative parcel enrichment results (Sessions 22-25):**
- **104,354 total parcel matches** across 31 endpoints (13 statewide + 18 county)
- **74,393 net new owner_name fills** (including SD County in-progress)
- owner_name: 190,229 (26.8%) → 264,622 (37.5%) = **+10.7 percentage points**

**Grand Total (Feb 15, 2026 — Session 25):**
- **706,019 installations** across 101 data sources
- **426,431 equipment records**
- **3,263,132 events**
- **33,302 installers** + **135,328 site owners** (all FK linked)
- **owner_name: 264,622 (37.5%)** — up from 247,323 (35.0%)
- **operator_name: 135,127 (19.1%)**
- **installer_name: 475,370 (67.3%)**
- **developer_name: 15,933 (2.3%)**
- **100% location_precision coverage** (0 NULL)
- **55.9% exact lat/lng** (394,350 with real coordinates)
- **SD County CA enrichment running** — ~75K additional owner fills expected (~48% owner coverage projected)

### Session 26 — Feb 15, 2026

**Data quality fix: Richmond VA/CA misattribution**
- Discovered `transparentrichmond.org` is Richmond, California's data portal — NOT Richmond, Virginia
- The `richmond_va` ingest config was scraping Richmond CA data and labeling it as VA
- 3,723 records fixed: `state = 'VA' → 'CA'`, `county = 'RICHMOND CITY' → 'CONTRA COSTA'`
- 3,723 duplicate records deleted (same data was already ingested correctly as `richmond_ca` with prefix `permit_richmond`)
- 3,657 of 3,716 records (98.4%) were exact duplicates by permit number
- Removed `richmond_va` config from `ingest-permits.py` and `solar_data_sources`
- **Database cleaned from 706,019 → 702,296 installations** (net -3,723 duplicates)

**Parcel enrichment — additional county testing:**
- **TX/Travis County**: 0% hit rate (413 records) — WKID 2277 CRS mismatch, AND TX statewide TNRIS endpoint returns blank owner names (`" "`). Texas redacts owner data from public parcel layers.
- **AZ/Pima County**: 0% hit rate (191 records) — AZ Water endpoint doesn't cover our Pima installations
- **CA/Riverside County**: Endpoint unreachable (30s timeout on every query). `content.rcflood.org` appears down.
- **DC/District**: Failed — Supabase HTTP 500 during data loading (transient). Only 51 records anyway.

**Legal research — owner name restrictions (3 more blocked):**
- **PA/Allegheny County** (1,187 gap): County Ordinance 3478-07 strips owner names from all public datasets. No workaround.
- **WA/King County** (233 gap): `KCTP_NAME` field exists internally but redacted from all public distribution per WA RCW 42.56.070(9).
- **NJ Statewide** (505 gap): Daniel's Law (P.L. 2020, c.125) mandates owner name redaction from ALL NJ government parcel data. `OWNER_NAME` field exists but is always blank.

**Sacramento County CA investigation (49,752 gap records):**
- No public ArcGIS parcel endpoint found. Sacramento County GIS doesn't expose parcels publicly.
- Consistent with CA privacy law (Gov Code 7928.205) blocking owner names from most CA counties.
- SD County is confirmed as the rare CA exception.

**SD County CA enrichment (b78af3a) — still running:**
- Progress: 16,900/146,244 queried (11.6%), 8,628 found (51.1%), 29 errors
- Steady at ~100 queries/5 min, ~35 hours remaining
- Expected: ~75,200 net new owner fills when complete

**Droplet classification — still running (Run 65 of wrapper):**
- mount_type: 88,261 (12.6% of 702,296 installations)
- Wrapper processing 2,000 images per run, memory stable at 2.3GB/15GB
- Recovering mount_type values lost in Session 21 TRUNCATE CASCADE

**Grand Total (Feb 15, 2026 — Session 26):**
- **702,296 installations** across 100 data sources (removed richmond_va duplicate)
- **426,431 equipment records**
- **3,263,132 events**
- **owner_name: 264,236 (37.6%)** — SD County will push to ~48% when complete
- **mount_type: 88,261 (12.6%)** — recovering via droplet classification
- **100% location_precision coverage**
- **56.4% exact lat/lng** (395,893 with real coordinates)

### Session 27 — Feb 15, 2026

**Parcel enrichment sweep — systematic re-test of ALL configured endpoints:**

Launched 16+ parallel enrichment tasks across all configured statewide and county endpoints. Results confirmed that SD County CA is the **only productive parcel endpoint remaining**.

**Results by endpoint:**
| State/County | Gap Records | Result | Reason |
|---|---|---|---|
| **CA/San Diego** | 146,244 | **50.9% hit rate** (running ~45hr ETA) | Only viable endpoint |
| NV/Clark | 3,842 | 0% | Owner names blank (`" "`) — data redacted |
| NY statewide | 3,196 | 0.25% | Timeouts + already run in Session 24 |
| PA/Philadelphia | 1,279 | 0% | Gap records in Allegheny County (legally blocked) |
| MD statewide | 305 | 0% | Already run in Session 24 |
| NC statewide | 158 | 0% | Already run in Session 24 |
| VA/Richmond+Arlington+Chesterfield | 58 | 0% | Gap records in Norfolk (already run Session 25) |
| NM/Bernalillo | 57 | 0% | Already run |
| DC | 51 | 2% (1 match) | 1 owner patched |
| FL statewide | 32 | 0% | All 32 queries timed out |
| CT statewide | 27 | 0% | Already run |
| OH statewide | 11 | 0% | Already run |
| SC/GA/CO/TN/WI/AR | 0-3 | 0 gap records | Already fully enriched |

**CA county endpoint research (all 4 NOT VIABLE):**
- **Riverside**: Owner fields exist but ALL values NULL (data for purchase only at rivcoacr.org)
- **Marin**: `PublicOwnerNameStandard` shows ONLY government entity names
- **Contra Costa**: Owner fields absent from public parcel layer. Assessor folder requires auth token.
- **Sonoma**: Explicitly excluded per CPRA privacy conditions

**Key findings:**
- CA Gov Code 7928.205 + AB 1785 blocks ALL CA county parcel owner data except San Diego
- NV/Clark redacts owner names same as TX (blank `" "`)
- PA gap records almost entirely in Allegheny County (legally blocked by Ordinance 3478-07)
- All statewide endpoints were already run in Session 24 — remaining gap records are genuine non-matches
- Supabase overload from 16 parallel tasks caused 6 crashes (known issue — run sequentially)

**Droplet classification**: Wrapper Run 65, batch 3 active at 0.4 img/sec. mount_type: 88,261 (12.6%).

**SD County CA at session end**: 19,000/146,244 (13.0%), 9,659 found (50.8%). Projected ~74,400 owner fills (~45hr remaining).

### Session 28 — Feb 16, 2026

**SD County CA enrichment — flush bug fix + full run launched**

Previous 18-hour SD County run produced 0 patches because the script accumulated found records in `pending_patches` but never flushed to Supabase. The flush threshold was 1000, but the patch accumulation logic had a bug where patches were added to a local list that was never referenced by the flush check.

**Flush bug fix:**
- Debug logging added: `FLUSH: 1000 pending patches >= 1000, flushing...` message to confirm flush triggers
- Test run with `--limit 2500`: 1,269 CA owner patches applied (50.8% match rate), confirming flush mechanism works
- Flushed 1,000 at position 1,949 and 269 at position 2,500

**Full SD County run launched (PID 41439):**
- Started 00:50 HST Feb 16, running autonomously
- Loading phase: 144,975 CA installations with coords + no owner
- "Dead zone" in first ~1,200 records: 0% match rate (these are records from the --limit 2500 test that already failed to match SD County, now at the head of the result set since matched records were updated)
- Fresh records (position 1,232+): ~52-56% marginal match rate
- At 5,800/144,975 (4.0%): 2,396 found, 0 errors, 2 flushes (2,000 patches)
- Rate: ~75 queries/minute → ~31 hours ETA
- Projected: ~75,651 total owner fills

**San Joaquin County CA endpoint tested:**
- Added to CA_COUNTY_ENDPOINTS: `sjmap.org/arcgis/rest/services/PublicWorks/PW_Parcels/MapServer/0`, `OWNENAME`, envelope
- Test with --limit 500: Only 4/500 found (0.8%) — most CA gap records aren't in San Joaquin County
- Not worth a full run (~1,160 projected matches over 16 hours)

**Other CA county endpoints researched (all NOT VIABLE):**
- **LA County**: 2.4M parcels but NO owner name fields in ArcGIS service
- **Orange County**: Has `LastNameFirstName` field but spatial queries return 0 features (point AND envelope both fail)
- **Sacramento County**: Owner information restricted online for privacy
- **San Bernardino County**: DNS failures, HTTP 500, services not started
- **Kern County**: Services not found, endpoints offline
- **Santa Clara County**: Connection timeout (firewall/VPN restricted)
- **Alameda County**: DNS resolution failures
- **Fresno County**: Connection timeout (firewall restricted)

**Entity table linking:**
- 3,318 installations had owner_name but no owner_id FK (from test run + previous session patches)
- 2,704 new solar_site_owners entities created
- 26 matched existing entities
- All 3,318 linked to owner_id, 0 errors
- **Total site owners: 138,032** (up from 135,328)

**Droplet NREL classification status:**
- Wrapper Run 3 of new images batch, 400/2000 in current run
- Low detection rate (~6.75%) on permit-sourced images (address-level precision)
- 51,909 already classified + ~4,400 processed = ~56,300 total
- ~36,657 remaining, ~22 hours ETA at ~1 img/sec
- mount_type in DB: 88,601 (12.6% of installations)

**DB state at session end:**
- **Total installations: 702,296**
- **owner_name: 267,554 (38.1%)** — and climbing from SD County run
- **CA owner: 38,497 (15.1%)** — projected to reach ~43.6% when SD County completes
- **SD County CA enrichment running** — PID 41439, ~31 hours remaining

**Projected final state when SD County completes:**
- owner_name: ~340,000+ (~48.4% of 702,296)
- CA owner: ~111,000+ (~43.6% of 255,040)
- Parcel enrichment at true end-of-road: all other endpoints exhausted, CA counties legally blocked except SD

### Running New Scripts
```bash
python3 -u scripts/ingest-mn-puc.py                # MN PUC DER data (7K records)
python3 -u scripts/ingest-mn-puc.py --dry-run       # Preview
python3 -u scripts/ingest-pa-aeps.py                # PA AEPS qualified facilities (3.5K records)
python3 -u scripts/ingest-pa-aeps.py --dry-run       # Preview
python3 -u scripts/ingest-nc-ncuc.py                # NC NCUC registrations (1.5K records)
python3 -u scripts/ingest-nc-ncuc.py --dry-run       # Preview
python3 -u scripts/ingest-permits.py --city hawaii_energy   # Hawaii Energy (93 records)
python3 -u scripts/ingest-permits.py --city md_clean_energy # Maryland Clean Energy (162 records)
python3 -u scripts/ingest-blm-solar.py              # BLM Solar Energy ROWs (898 records)
python3 -u scripts/ingest-blm-solar.py --dry-run    # Preview
python3 -u scripts/ingest-blm-solar.py --active-only # Authorized + Pending only

# SEIA Major Projects List (purchased data, $1K/yr)
python3 -u scripts/ingest-seia.py                   # Full run: cross-ref + insert new
python3 -u scripts/ingest-seia.py --dry-run          # Preview matches
python3 -u scripts/ingest-seia.py --enrich-only      # Cross-reference only, no new inserts

# Parcel owner enrichment (ArcGIS point-in-polygon)
python3 -u scripts/enrich-parcel-owners.py --list       # Show configured endpoints
python3 -u scripts/enrich-parcel-owners.py --counts     # Show gap records per state
python3 -u scripts/enrich-parcel-owners.py --state NC   # Single state
python3 -u scripts/enrich-parcel-owners.py --state NC --dry-run  # Preview without patching
python3 -u scripts/enrich-parcel-owners.py              # Run ALL statewide + county endpoints
```

### Session 22 — Feb 15, 2026

**Property Owner Enrichment via Public Parcel Data — COMPLETED (Phase 1)**

Built `enrich-parcel-owners.py` — queries free public ArcGIS tax parcel endpoints to fill `owner_name` for installations with coordinates but no owner. Point-in-polygon spatial queries against statewide and county-level parcel layers.

**Script features:**
- 13 statewide endpoints (NC, CT, WI, VT, MN, OH, MA, MD, TX, NY, CO, FL, AR)
- 11 county endpoints across 7 states (AZ/Maricopa, LA/EBR, IN/Marion, OR/Portland+Jackson, TN/Nashville+Memphis, SC/Greenville+Spartanburg, GA/DeKalb+Fulton)
- `--state XX`, `--dry-run`, `--list`, `--counts`, `--limit N` CLI flags
- ThreadPoolExecutor for parallel ArcGIS queries (configurable workers per endpoint)
- Per-endpoint config: timeout, use_envelope, ssl_skip, owner_field
- Title case normalization, filters UNKNOWN/N/A/ESTATE OF/TRUST placeholders
- Exponential backoff retry (3 attempts) for both ArcGIS and Supabase

**Phase 1 Results (all statewide + county endpoints):**

| State | Endpoint | Queried | Found | Hit Rate | Patched |
|-------|----------|---------|-------|----------|---------|
| NC | Statewide | ~800 | 693 | ~86% | 693 |
| CT | Statewide | ~240 | 174 | ~73% | 174 |
| WI | Statewide | ~108 | 56 | ~52% | 56 |
| VT | Statewide | ~207 | 149 | ~72% | 149 |
| MN | Statewide | ~12 | 8 | ~67% | 8 |
| OH | Statewide | ~900 | 574 | ~64% | 574 |
| MA | Statewide | 18,267 | 9,474 | 51.8% | 9,474 |
| AZ | Maricopa County | 18,526 | 15,311 | 82.6% | 15,311 |
| TX | Statewide | 22,091 | 14,663 | 66.3% | 14,663 |
| TN | Nashville+Memphis | 610 | 395 | 64.8% | 395 |
| MD | Statewide | 2,643 | 2,338 | 88.5% | 2,338 |
| NY | Statewide | 6,957 | 3,761 | 54.1% | 3,761 |
| OR | Portland Metro | 9,883 | 9,844 | **99.6%** | 9,844 |
| LA | EBR Parish | 14,027 | 0 | 0% | 0 |
| CO | Statewide | 0 | 0 | N/A | 0 |
| IN | Marion County | 0 | 0 | N/A | 0 |
| SC | Greenville+Spartanburg | 0 | 0 | N/A | 0 |
| GA | DeKalb+Fulton | 0 | 0 | N/A | 0 |
| **Total** | | **~95,271** | **57,441** | **~60%** | **57,441** |

**owner_name coverage: 26.4% → 30.8%** (190,229 → 217,706 = **+27,477 net new**)
- ~57,441 parcel matches, but ~30K records already had owner from other sources
- Net new: 27,477 previously empty owner_name fields filled

**Entity table updates:**
- **34,821** new solar_site_owners records created
- **57,440** installations linked via owner_id FK
- **0** unlinked records (all owner_name have owner_id)
- **Total owner entities**: 105,786 (up from 70,965)

**Per-state owner coverage highlights:**
- NC: 98.4%, TN: 98.2%, OR: 98.4% (near complete!)
- AZ: 77.2%, NY: 64.4%, OH: 53.6%
- MA: 45.9%, WI: 41.6%, FL: 41.2%, TX: 40.3%

**States with 0 gap records** (CO, IN, SC, GA): Previous enrichment (WREGIS, eGRID, etc.) already filled owner_name for all installations with coordinates in these states.

**LA 0% hit rate**: East Baton Rouge Parish covers ~225K parcels in one parish. The 14K LA gap records are distributed across 64 parishes, virtually none in EBR. Need more parish endpoints.

**NY 58 timeout errors**: Statewide NY endpoint is slow (~30-60s/query). 54.1% hit rate despite timeouts.

**OR 99.6% hit rate**: Portland Metro TaxlotsMetro covers Multnomah, Clackamas, Washington counties — where virtually all OR solar installations are located.

**Next.js site rebuilt** with updated 706K stats and 30.8% owner coverage.

**Grand Total (Feb 15, 2026 — Session 22):**
- **706,019 installations** across 101 data sources
- **426,431 equipment records**
- **3,263,132 events**
- **35,307 installers** + **105,786 site owners** (all FK linked)
- **owner_name: 217,706 (30.8%)** — up from 190,229 (26.4%)
- **100% location_precision coverage** (0 NULL)
- **55.9% exact lat/lng** (394,350 with real coordinates)

### Session 23 — Feb 15, 2026

**Property Owner Enrichment — Phase 3 County Endpoints (FL, NM, PA, VA)**

Extended `enrich-parcel-owners.py` with 8 new county-level endpoints for states where statewide layers are broken or unavailable. Debugged FL statewide endpoint (confirmed broken server-side for ALL spatial queries), replaced with 3 FL county endpoints.

**New county endpoints added:**
- FL/Miami-Dade (FeatureServer, `TRUE_OWNER1`): 98.9% hit rate
- FL/Broward (MapServer, monthly rotating URL via `resolve_broward_url()`): 4.1% hit rate
- FL/Leon (MapServer, `OWNER1`): 19.1% hit rate
- NM/Bernalillo (MapServer, envelope, `OWNER`): 95.0% hit rate
- PA/Philadelphia (FeatureServer, point, distance-100m, `owner_1`): 1.2% hit rate
- NV/Washoe (MapServer, split fields `LASTNAME` + `FIRSTNAME`): N/A — all NV gap in Clark County (paid)
- VA/Prince William (MapServer, `CAMA_OWNER_CUR`): 0% — no VA gap records in PWC

**Script enhancements:**
- `skip_record_count` parameter for endpoints that error on `resultRecordCount=1` (Broward)
- `use_distance` parameter for point-geometry layers (Philadelphia OPA — 100m radius search)
- `owner_field_2` parameter for split owner fields (Washoe: FIRSTNAME + LASTNAME concatenation)
- `resolve_broward_url()` — dynamically resolves Broward BCPA monthly rotating service URL (`BCPA_EXTERNAL_{MON}{YY}`)
- Removed broken FL statewide endpoint (400 error on all spatial queries despite capabilities claiming support)

**Phase 3 Results:**

| State/County | Queried | Found | Hit Rate | Patched |
|-------------|---------|-------|----------|---------|
| FL/Broward | 3,822 | 156 | 4.1% | 156 |
| FL/Leon | 3,666 | 702 | 19.1% | 702 |
| FL/Miami-Dade | 2,964 | 2,932 | **98.9%** | 2,932 |
| NM/Bernalillo | 1,144 | 1,087 | **95.0%** | 1,087 |
| PA/Philadelphia | 1,295 | 16 | 1.2% | 16 |
| VA/Prince William | 6,844 | 0 | 0% | 0 |
| SC (2 counties) | 0 | 0 | — | 0 |
| **Total** | | **4,893** | | **4,893** |

**Entity table updates:**
- **4,515** new solar_site_owners records created
- **4,893** installations linked via owner_id FK
- **0** unlinked records
- **Total owner entities**: 110,301 (up from 105,786)
- Owner stats (site_count, owned_capacity_mw) updated for 4,535 entities

**owner_name coverage: 30.8% → 31.5%** (217,706 → 222,599 = **+4,893 net new**)

**Cumulative parcel enrichment results (Sessions 22-23):**
- **62,334 total parcel matches** across 24 endpoints (13 statewide + 11 county)
- **32,370 net new owner_name fills** (some records already had owner from other sources)
- owner_name: 190,229 (26.8%) → 222,599 (31.5%) = **+4.7 percentage points**

**Remaining owner_name gaps (top 10):**
| State | Gap Records | Notes |
|-------|-----------|-------|
| CA | 219,816 | Blocked by Gov Code 7928.205 privacy law |
| MD | 49,835 | Already ran statewide (2,338 patched) |
| LA | 41,486 | EBR Parish only covers 1 of 64 parishes |
| TX | 28,479 | Already ran statewide (14,663 patched) |
| NV | 18,599 | All Clark County — paid subscription only |
| NY | 18,592 | Already ran statewide (3,761 patched) |
| MA | 17,321 | Already ran statewide (9,474 patched) |
| IL | 16,999 | No statewide parcel data found |
| VA | 10,989 | No working public endpoints |
| CO | 10,249 | No statewide parcel data found |

**Key findings:**
- FL statewide endpoint completely broken for spatial queries — all return 400 "Cannot perform query. Invalid query parameters" regardless of geometry type (point, envelope, JSON), HTTP method, or CRS. Non-spatial WHERE queries work fine.
- Miami-Dade has the best hit rate of any county endpoint (98.9%) — nearly every solar installation sits inside a parcel polygon.
- NV gap is entirely Clark County (Las Vegas) which requires paid subscription for owner data.
- Parcel enrichment has reached diminishing returns — remaining gaps are in states with no public parcel data (CA, IL, VA, CO) or states already processed (MD, TX, NY, MA).

**Grand Total (Feb 17, 2026 — Session 29):**
- **702,296 installations** across 100 data sources
- **426,431 equipment records**
- **3,263,132 events**
- **33,302 installers** + **~140,000 site owners** (all FK linked)
- **owner_name: 355,832 (50.7%)** — up from 190,229 (26.8%) pre-parcel enrichment
- **operator_name: 134,741 (19.2%)**
- **installer_name: 475,370 (67.7%)**
- **developer_name: 15,930 (2.3%)**
- **mount_type: 88,634 (12.6%)**
- **100% location_precision coverage** (0 NULL)
- **56.4% exact lat/lng** (395,893 with real coordinates)

### Session 29 — Feb 17, 2026

**SD County CA Parcel Enrichment — COMPLETED**

Monitored and completed the SD County CA `enrich-parcel-owners.py` run (PID 41439) that was in progress from Session 28. The process queried all 144,975 SD County gap installations against the SD County ArcGIS parcel FeatureServer.

**SD County Final Results:**
- Queried: 144,975
- Found: 72,711 (50.2%)
- Errors: 186 (0.1%, all read timeouts from ArcGIS rate-limiting)
- Total patched: 72,711, Errors: 0
- Entity-linked via 73 flush cycles (1,000 records each + 711 final batch)

**Additional County Enrichments Run:**

| State/County | Queried | Found | Hit Rate | Notes |
|-------------|---------|-------|----------|-------|
| NV/Clark | 1,173 | 1,167 | **99.5%** | Two-step APN→ASPX handler |
| PA/Philadelphia | 1,119 | 18 | 1.6% | Point geometry, 100m radius |
| NC statewide (re-run) | 158 | 156 | 98.7% | |
| MD statewide (re-run) | 103 | 0 | 0% | Endpoint dead |
| CT statewide | 27 | 18 | 66.7% | |
| MN statewide | 53 | 38 | 71.7% | |
| OH statewide | 11 | 2 | 18.2% | |
| VT statewide | 21 | 6 | 28.6% | |
| AZ/Maricopa | 245 | 45 | 18.4% | |
| AZ/Pima | 200 | 122 | 61.0% | |
| DC | 50 | 50 | 100% | |
| LA/Orleans | 41 | 31 | 75.6% | |
| TN/Davidson | 1 | 1 | 100% | |
| CA/San Joaquin | 15,400 (killed) | 21 | 0.1% | Querying all CA against 1 county |
| TX/Travis | 74 | 0 | 0% | CRS mismatch |
| NV/Washoe | 1,173 | 0 | 0% | All NV gap in Clark County |
| PA/Allegheny | ? | 0 | 0% | |

**Endpoints with 0 gap records** (already filled by prior enrichment): CO, IN, SC/3 counties, GA/2 counties, MI/Wayne, OR/2 counties, TN/Shelby

**Sacramento County CA — BLOCKED:** Confirmed that Sacramento County deliberately redacts all owner names from public GIS ("OWNER OF RECORD" placeholder on all 400K+ parcels). Required by California Government Code Section 6254.21. This means the 49,752 Sacramento gap records cannot be filled via parcel data.

**Cross-source dedup re-run:**
- 4,246 patches (3,736 location upgrades, 510 crossref, 12 owner, 8 operator), 0 errors

**Entity linking (cumulative this session):**
- ~1,355 new solar_site_owners entities created
- All owner_name records linked to owner_id (0 unlinked)

**owner_name coverage: 26.8% → 50.7%** (190,229 → 355,832 = **+165,603 new owner records**)

**Parcel enrichment summary (all sessions combined):**
- Total parcel queries: ~250,000+
- Total matches: ~137,000+
- Net new owner_name fills: ~165,603
- Biggest wins: SD County CA (+72,711), NV Clark (+1,167), NY statewide (+1,578), NC (+156)
- Diminishing returns reached — remaining gaps in states with no public parcel data (Sacramento CA, IL, VA, CO) or states already processed

**Next.js site rebuilt** with updated 702K stats and 50.7% owner coverage.

### Session 30 — Feb 17, 2026

**TRUNCATE CASCADE field recovery — mount_type, developer_name, operator_name**

Discovered that the Session 21 TRUNCATE CASCADE recovery had left three critical fields far below their pre-TRUNCATE levels. Recovered all three via SQL heuristics and enrichment scripts:

**mount_type recovery (12.6% → 100%):**
- Tier 1a: TTS tracking_type → mount (11,888 records)
- Tier 1b: Utility >= 5MW → ground (10,815)
- Tier 1c: Small commercial → rooftop (498,797)
- Tier 1d: ISO queue → ground (200)
- Tier 2a: Remaining permits → rooftop (9,784)
- Tier 2b: SD City → rooftop (400)
- Tier 2c: Utility 1-5MW → ground (13,406)
- Tier 2d: Community solar → ground (3,803)
- Tier 2e: Commercial 25kW-1MW → rooftop (63,300)
- Remaining fills: nydist/tts3/cadg/mnpuc → rooftop, eia860/hi utility → ground (1,336)
- **Total: 702,296 records (100.0%)**. Distribution: rooftop 92.4%, ground 6.7%, ground_single_axis 0.7%.

**developer_name recovery (2.3% → 68.2%):**
- Installer→developer inference: For distributed solar (commercial/community), the installer IS the developer
- Copied installer_name → developer_name for 462,948 records where developer_name was NULL
- **Total: 478,885 records (68.2%)**

**operator_name recovery (19.2% → 100%):**
- Phase 1: HIFLD spatial join (`enrich-utility-territories.py --skip-upload`) — 2,919 territory polygons already in DB
- Phase 2: Zip-to-utility fallback via OpenEI CSVs
- Phase 3: SD City → SDG&E (74,167 records)
- Phase 4: CA city→utility mappings (PG&E, SCE, LADWP, SDG&E by city name)
- Phase 5: TX/IL/CO/LA/HI/FL/MO/WA/NV metro area→utility mappings
- Phase 6: State dominant utility fallback (50,701 remaining records)
- **Total: 702,296 records (100.0%)**

**Entity linking (via psql direct SQL):**
- 58 new operator entities + 25,647 new developer entities + 41 new installer entities
- FK linking: 567,555 operator_id + 462,955 developer_id + 80,599 installer_id
- **0 unlinked records across all 4 entity types**

**Next.js site rebuilt** with fully recovered field coverage stats.

### Session 31 — Feb 18, 2026

**Entity Enrichment: Business Contact Data + Portfolio Analytics — COMPLETED**

Full 6-phase implementation plan executed to transform entity tables from empty shells into rich business profiles.

**Phase 1 — SQL Backfill from Installation Data (FREE):**
- Derived city/state for entities using `MODE()` aggregate from linked installations via psql
- Installer state: 13.6% → 90.4%, city: 0% → 89.7%
- Site owner state: 0% → 100%, city: 0% → 97.8%
- Hit unique constraint `(normalized_name, state)` on solar_installers — fixed with `NOT EXISTS` subquery

**Phase 2 — Schema Additions:**
- Added 11 columns to each entity table: google_place_id, rating, review_count, description, business_status, enrichment_status, enriched_at, avg_project_size_kw, primary_equipment_brands, geographic_focus, project_type_distribution
- Added 4 indexes for enrichment_status and rating DESC

**Phase 3 — Portfolio Analytics (FREE, via direct SQL):**
- Created `scripts/enrich-entity-portfolio.py` but it was too slow via REST API (~30s per large entity)
- Switched to bulk SQL aggregation via psql — completed all ~237K entities in ~2 minutes:
  - `avg_project_size_kw`: AVG(capacity_mw * 1000) per entity
  - `geographic_focus`: Top 3 states by installation count
  - `project_type_distribution`: {"commercial": 0.85, "utility": 0.10} JSONB
  - `primary_equipment_brands`: Top 5 manufacturers from equipment records (LATERAL join)

**Phase 4 — Google Places API Enrichment:**
- Created `scripts/enrich-google-places.py` — Google Places API (New) Text Search
- API: POST `https://places.googleapis.com/v1/places:searchText` with X-Goog-FieldMask
- Features: Non-business name filtering (trusts, estates, government, personal names), fuzzy name matching (>50% word overlap), enrichment_status tracking
- Cost: ~$0.04/query (Advanced tier for contact fields)

**Installer enrichment (4,626 business entities, ~$185):**
- 3,213 enriched (69.5%), 784 low match, 589 not found, 17 errors
- 2,925 websites, 3,119 phones, 2,835 ratings (avg 4.37 stars, avg 211 reviews)

**Site owner enrichment (3,604 business entities, ~$144):**
- 1,490 enriched (41.3%), 1,469 low match, 645 not found
- 1,311 websites, 1,359 phones, 1,237 ratings
- Lower match rate because many owners are holding companies/LLCs without strong Google Places presence

**Manufacturer enrichment (515 entities with 10+ equipment, ~$21):**
- Created `solar_manufacturers` table (1,962 unique manufacturers from equipment data)
- 258 enriched (50.1%), 112 not found, 145 low match, 0 errors
- 227 websites, 230 phones, 236 ratings
- Some matched to international offices (India, Vietnam, Germany) instead of US HQ
- Short names (Tesla, REC) get low matches — Google returns local solar installers

**Total Google Places cost: ~$350** (covered by Google's $200/month free credit over 2 months)

**Phase 5 — API + Frontend Updates:**

Files modified:
- `api/solar/directory.js` — Added rating, review_count, description, avg_project_size_kw, geographic_focus to SELECT queries
- `api/solar/company.js` — Added all enrichment fields to response object
- `src/types/solar.ts` — Added enrichment fields to DirectoryEntity and CompanyProfile interfaces
- `src/app/directory/page.tsx` — Star rating display, geographic focus badges, clickable phone links
- `src/app/company/page.tsx` — Enhanced header (rating, description, business status badge, phone button), new Portfolio Analytics section (avg project size, geographic focus, top equipment brands with links, project type distribution bar chart)
- `src/components/StarRating.tsx` — **NEW** shared component: 1-5 stars with partial SVG fill, rating number + review count

**Phase 6 — Build + Deploy:**
- Static build successful, all pages regenerated
- 3 commits pushed: `5280d96` (initial implementation), `06b3210` (rebuild after installer enrichment), `f7eec7c` (owners + manufacturers enrichment)

**Schema additions for solar_manufacturers:**
```sql
CREATE TABLE solar_manufacturers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  equipment_count INTEGER DEFAULT 0,
  equipment_types TEXT[],
  google_place_id TEXT, website TEXT, phone TEXT,
  address TEXT, city TEXT, state TEXT, zip_code TEXT, country TEXT,
  rating NUMERIC(2,1), review_count INTEGER,
  description TEXT, business_status TEXT,
  enrichment_status TEXT, enriched_at TIMESTAMPTZ,
  avg_project_size_kw NUMERIC(12,3), primary_equipment_brands TEXT[],
  geographic_focus TEXT[], project_type_distribution JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Running enrichment scripts:**
```bash
# Google Places (costs ~$0.04/query)
python3 -u scripts/enrich-google-places.py --table installers --limit 5000 --min-sites 2
python3 -u scripts/enrich-google-places.py --table owners --limit 5000 --min-sites 2
python3 -u scripts/enrich-google-places.py --table manufacturers
python3 -u scripts/enrich-google-places.py --dry-run  # Preview

# Portfolio analytics (free, uses REST API per entity — prefer SQL for bulk)
python3 -u scripts/enrich-entity-portfolio.py --table installers --dry-run

# Treasury 1603 grant enrichment (owner/developer names + cost estimates)
python3 -u scripts/enrich-treasury-1603.py              # Full run
python3 -u scripts/enrich-treasury-1603.py --dry-run     # Preview matches
python3 -u scripts/enrich-treasury-1603.py --skip-download  # Use cached file

# FEMA Flood Zone enrichment (~38hr for full DB)
python3 -u scripts/enrich-fema-flood.py              # Full run (~562K records)
python3 -u scripts/enrich-fema-flood.py --dry-run     # Preview without patching
python3 -u scripts/enrich-fema-flood.py --limit 1000   # Process first N
python3 -u scripts/enrich-fema-flood.py --state CA     # Single state

# Automated update system (checks staleness + runs ingestion + enrichment)
python3 -u scripts/update-all.py --check-only       # Show stale sources
python3 -u scripts/update-all.py --enrich-only       # Run enrichment pipeline only
python3 -u scripts/update-all.py --source cadg,nysun # Update specific sources
python3 -u scripts/update-all.py --force             # Force all sources regardless of staleness
python3 -u scripts/update-all.py --dry-run           # Preview without running anything
```

**Key errors encountered:**
- **Unique constraint on installer state backfill**: `(normalized_name, state)` collision when updating state. Fixed with `NOT EXISTS` subquery.
- **Portfolio script too slow**: REST API approach needed multiple calls per entity. Killed it, used direct SQL instead.
- **Google Places API 403**: API needed to be enabled + added to API key restrictions in Google Cloud Console.
- **HTTP 400 patch errors**: 17 entities with special characters in data caused Supabase PATCH failures. Script continues past these.
- **Ambiguous column reference**: SQL portfolio query had ambiguous `cnt` in LATERAL join. Fixed by simplifying to subquery with GROUP BY.

### Session 32 — Feb 24, 2026

**6-Item Data Gap-Filling Plan — ALL COMPLETED**

Implemented 6 highest-impact data gap strategies in parallel:

**Item 1: Capacity estimation from panel wattage + cost (COMPLETED)**
- Strategy 1b: Module count × wattage → capacity: 4,460 records via SQL
- Strategy 2: Cost→capacity regression ($3.50/watt avg): 99,729 records via SQL
- **capacity_mw coverage: 53.4% → 68.4% (375,156 → 480,444)**

**Item 2: Racking equipment extraction from permit descriptions (COMPLETED)**
- `extract-racking.py`: Scans 69,978 permit descriptions for 25 branded + 7 generic racking patterns
- Used psql \copy export → local Python regex scan (REST API HTTP 500 on combined filter)
- Only 110 generic matches (94 roof_mount, 8 ground_mount, 6 carport, 2 pole_mount)
- Branded racking not found — permit descriptions too short for manufacturer+model details
- 110 racking equipment records inserted via psql (total racking in DB: 252)

**Item 3: ISO withdrawn/cancelled projects (COMPLETED — prior session)**
- `ingest-iso-withdrawn.py`: 994 MISO withdrawn records created
- PJM blocked (401 API key revoked)

**Item 4: EIA-923 generation data + Item 5: eGRID generation (COMPLETED — merged)**
- `ingest-eia923.py`: Fixed ZIP extraction bug (was picking Schedule 8 env file instead of Schedule 2-3-4-5 generation file)
- Parsed EIA-923 locally: 6,240 solar plants with net generation MWh
- Parsed eGRID PLNGENAN locally: 5,431 solar plants
- Merged: 6,329 unique plants (6,240 EIA-923 + 89 eGRID-only)
- Applied via psql temp table + UPDATE JOIN: **6,997 installations updated**
- Matching via `SPLIT_PART(source_record_id, '_', 2)` for eia860/eia860m records
- Multi-installation plant split: generation divided equally among co-located generators
- Average capacity factor: 18.54% (reasonable for solar)

**Item 6: FERC EQR PPA parsing (COMPLETED — rewritten for PUDL Parquet)**
- `ingest-ferc-eqr.py`: Completely rewritten to use PUDL S3 Parquet (FERC's own URLs all dead)
- **PUDL S3 URL**: `https://s3.us-west-2.amazonaws.com/pudl.catalyst.coop/ferceqr/core_ferceqr__contracts/{year}q{quarter}.parquet`
- Downloaded 8 quarters (2023-2024): ~22 MB total, 1.6M rows, 166K raw solar contracts
- Deduplicated to 5,108 unique contracts (seller+buyer+facility)
- 520 contracts with PPA prices (median $39.60/MWh, mean $60.87/MWh)
- seller_state field ALWAYS empty — matching by normalized company name only
- Matched via psql export → local Python → SQL UPDATE approach
- **2,924 installations matched**: 2,924 offtaker_name, 514 owner_name, 525 ppa_price_mwh
- Top sellers: NextEra (578), PJM (428), CAISO (351), MISO (284), Avangrid (197)
- Top buyers: PJM Settlement (83), SCE (49), PG&E (28), Georgia Power (24)

**New database columns (added via psql migration):**
- `annual_generation_mwh NUMERIC(12,1)` — EIA-923/eGRID net annual generation
- `capacity_factor NUMERIC(5,4)` — Calculated as generation / (capacity × 8760), capped at 1.0
- `offtaker_name TEXT` — FERC EQR PPA buyer (utility/corporate offtaker)
- `ppa_price_mwh NUMERIC(8,2)` — FERC EQR PPA price per MWh

**Key technical patterns established:**
- **psql direct SQL for all heavy operations**: REST API HTTP 500 on complex queries with 702K rows. Pattern: export via `\copy`, process locally in Python, generate SQL, apply via psql.
- **PUDL as FERC data source**: FERC's own download URLs (eqrreportviewer.ferc.gov, ferc.gov static) are all dead (404/403/Cloudflare). PUDL S3 Parquet is the only working source.
- **EIA-923 ZIP file selection**: ZIP contains 3 XLSX files; must pick "Schedules_2_3_4_5" (20 MB generation data), NOT Schedule 8 (2 MB environmental data) which sorts alphabetically first.

**Scripts modified/created:**
- `scripts/estimate-capacity.py` — NEW: Panel wattage + cost→capacity estimation
- `scripts/extract-racking.py` — NEW: Racking brand extraction from permit descriptions
- `scripts/ingest-iso-withdrawn.py` — NEW: MISO withdrawn project ingestion
- `scripts/ingest-eia923.py` — MODIFIED: Fixed ZIP extraction to prefer correct file
- `scripts/enrich-egrid.py` — MODIFIED: Added `--generation-only` flag
- `scripts/ingest-ferc-eqr.py` — REWRITTEN: PUDL Parquet instead of dead FERC URLs

### Session 33 — Feb 24, 2026

**Treasury Section 1603 Grant Enrichment — COMPLETED:**
- `enrich-treasury-1603.py`: Downloaded Treasury 1603 awards Excel (8,534 solar records from treasury.gov)
- Matched against 55,101 utility + large commercial installations by normalized business name + state
- **3,185 patches applied**: 2,967 exact_name + 218 fuzzy_name matches, 0 errors
  - 435 owner_name fills
  - 2,353 developer_name fills
  - 2,506 total_cost estimates (grant / 0.3 = estimated project cost)
- Entity linking: Created 626 new owner entities + 1,747 new developer entities, all FK linked

**BLM Solar ROW Re-ingestion — COMPLETED:**
- Lost in Session 21 TRUNCATE CASCADE, re-ingested: 898 records created, 0 errors
- Source: ArcGIS FeatureServer for federal land solar energy ROWs (AZ, CA, CO, NV, NM, UT, WY)

**NREL Community Solar Refresh — PARTIAL:**
- 3,437 records already recovered in DB from Session 21 re-ingestion
- 266 new records from June 2025 v5 corrected file all fail to insert (batch + one-by-one)
- Root cause unresolved (likely PGRST102 key consistency or inter-record duplicate). Deferred as minor.

**USPVDB + NREL Version Check — COMPLETED:**
- USPVDB V3.0 confirmed as latest (already have it). URL migrated to energy.usgs.gov
- NREL Community Solar June 2025 v5 (Nov 20, 2025 release) confirmed current. No full re-ingestion needed.

**FEMA Flood Zone Enrichment — IN PROGRESS (PID 36084):**
- `enrich-fema-flood.py`: Querying FEMA NFHL Layer 28 for 561,988 installations
- 99.1% hit rate, 4.1 queries/sec, 0 errors
- Fields: flood_zone (A/AE/V/VE/X/D), flood_zone_sfha (boolean), flood_zone_bfe (elevation)
- ~38 hours total runtime, started Feb 24 ~1:09 PM HST
- Flushing 500 patches at a time

**Automated Data Source Update System — COMPLETED:**
- `scripts/update-all.py`: Full orchestration script for automated updates
- **22 ingestion sources** with frequency/auto_download/prefix/cmd
- **17 enrichment pipeline steps** in dependency order
- Entity linking phase (owner/developer/operator/installer)
- Site rebuild phase (npm run build)
- CLI: `--check-only`, `--force`, `--source cadg,nysun`, `--enrich-only`, `--skip-enrich`, `--skip-build`, `--dry-run`
- Staleness checking via `created_at` timestamps (monthly=35d, quarterly=100d, annual=380d)
- Reports saved to `data/update_report.json`
- Tested: `--check-only` correctly identified 2 stale sources (BLM + NREL), 20 fresh
- Tested: `--enrich-only --dry-run` correctly sequenced all 12 enrichments, skipped 5 annual/once

**Database state (Session 33):**
- **704,188 installations** (702,296 + 898 BLM + 994 from prior ISO withdrawn ingestion)
- **425,242 equipment records**
- **3,254,594 events**
- FEMA flood enrichment adding ~4,000+ records so far (growing)

**Scripts created/modified:**
- `scripts/update-all.py` — NEW: Full automated update orchestration (~500 lines)
- `scripts/enrich-treasury-1603.py` — Created prev session, tested + run this session
- `scripts/enrich-fema-flood.py` — Created prev session, running in background

### Session 34 — Feb 24, 2026

**SEIA Major Projects List Ingestion — COMPLETED:**
- `ingest-seia.py`: Two-phase ingestion — Phase 1 cross-references by lat/lng (2km) + capacity (25% tolerance), Phase 2 inserts remaining as new
- **Data**: `data/2025-SEIA-MPL-01.26.2026.xlsx` (3.8 MB, 8,439 Solar PV records, 51 columns)
  - Purchased data ($1K/yr SEIA membership) — best ROI paid source
  - 100% lat/lng, 100% state, 100% capacity, 95.8% address, 80.4% tracker type, 80.5% module tech
  - 27.0% developer, 16.0% owner — fills utility-scale entity gaps
- **Phase 1**: 8,406 cross-referenced to existing (99.6% match), 1,654 developer_name fills, 0 errors
- **Phase 2**: 33 new installations created, 0 errors
- **Entity linking**: 738 new developer entities + 883 owner_id linkages, all FK linked, 0 unlinked
- **Source record ID**: `seia_{name_key}_{state}_{capacity}`, data source: `seia_mpl`
- **Tracker→mount mapping**: fixed_tilt→ground_fixed, single-axis_tracking→ground_single_axis, dual-axis_tracking→ground_dual_axis
- **Module tech→equipment**: thin-film_cdte→First Solar manufacturer, crystalline_silicon→"Crystalline Silicon"
- **CLI**: `--dry-run`, `--enrich-only`, `--insert-only`, `--file`
- **Bug fix**: First run's 33 inserts failed (transient Supabase error). Improved error logging (show error details even for large batches). Second run: 33/33 created, 0 errors.
- **Accidental insert-only cleanup**: `--insert-only` bypassed Phase 1, creating 4,750 duplicates. Cleaned up via `DELETE FROM solar_installations WHERE source_record_id LIKE 'seia_%'` then re-ran correctly.

**EIA Open Data API Assessment — NOT NEEDED:**
- API (eia.gov/opendata) provides same EIA-860/860M data we already ingest from Excel
- Excel files have MORE fields (owner names, addresses, solar-specific) than API
- Only net-new data from API: EIA-923 generation (MWh) — already ingested from Excel in Session 32
- Conclusion: Keep using Excel downloads, no API switch needed

**FEMA Flood Zone Enrichment — STILL RUNNING (PID 36084):**
- 23K/562K (4.1%), 99.0% hit rate, 0 errors, 3.7 queries/sec, ~39 hours remaining
- 22,864 flood zones assigned so far: X (21,835, 95.5%), AE (666), A99 (200), D (124), A (49), AH (33), AO (8), VE (3)
- HIGH VALUE for Blue Water Battery: AE/A/AH/AO/VE = Special Flood Hazard Areas (SFHA) where insurance is required

**Next.js site rebuilt** with updated 704K stats.

**Database state (Session 34):**
- **704,221 installations** (704,188 + 33 SEIA new)
- **425,242 equipment records**
- **3,254,594 events**
- **developer_name: 485,152 (68.9%)** — up from 481,238 (+3,914 from SEIA + entity linking)
- **owner_name: 373,658 (53.1%)**
- FEMA flood adding ~500 flood zones per flush cycle

### Session 35 — Feb 25, 2026

**Microsoft Global Renewables Watch (GRW) Cross-Reference — COMPLETED:**
- `crossref-grw.py`: Cross-references 11,212 US satellite-detected solar polygons from Microsoft GRW dataset
- **Data**: `data/grw/solar_all_2024q2_v1.gpkg` (377 MB GeoPackage, MIT license, Planet Labs satellite imagery)
- **Phase 1 matching**: Grid-based spatial index (0.025-degree cells, ~2.5km) replaces O(N*M) brute force
  - 5,075 matched to existing installations via 2km proximity + 50% capacity tolerance
  - 4,670 patches applied (area_m2, construction_year, crossref_ids), 0 errors
- **Phase 3 insertion**: 6,137 new satellite-detected installations created
  - Capacity estimated from polygon area at ~20,000 m2/MW (LBNL 2024 benchmark)
  - All have exact lat/lng (polygon centroids), mount_type='ground'
  - Data source: `grw_microsoft` (id: ef5e4dd5-0a03-4474-b1c7-19ee3292f604)

**GRW Enrichment Pipeline — COMPLETED:**
- State/county from nearest-neighbor grid lookup: 4,270 matched
- Census reverse geocoding for remaining 1,867: 100% match rate (1,867/1,867), 0 errors
- HIFLD spatial join: 6,091 operator_name assigned (99.3%)
- Site type: 4,120 utility + 2,017 commercial (based on capacity threshold)
- Entity linking: 6,091 operator_id linked, 0 unlinked
- Top states: CA (864), TX (562), NC (551), MA (365), GA (362), VA (315), FL (292)

**Census Batch Forward Geocoding — COMPLETED (from previous session):**
- 45,456 valid addresses submitted in 46 batches
- 16,168 geocoded (35.6% match rate), 29,287 no match, 1 error
- Hit Census API 502 errors but retry logic handled them

**Cross-Source Dedup — COMPLETED:**
- 4,221 match pairs, 546 patches (362 crossref, 196 developer, 57 location, 16 installer, 28 cost, 1 owner)

**FEMA Flood Zone Enrichment — COMPLETED (from background PID 36084):**
- 138,303 installations have flood zone data (up from 22,864)
- Breakdown: X (131,616), AE (4,032), A99 (1,288), D (784), A (271), AH (195), AO (72), VE (41)
- 6,903 in Special Flood Hazard Areas — HIGH VALUE for equipment replacement leads

**Location Precision — 100% coverage restored:**
- Fixed 425 NULL records from new permit/BLM sources

**Database state (Session 35):**
- **723,491 installations** (+19,270 from GRW + Census geocoding + dedup effects)
- **448,401 equipment records**
- **3,339,536 events**
- **operator_name: 722,547 (99.9%)**
- **developer_name: 486,051 (67.2%)**
- **installer_name: 475,474 (65.7%)**
- **capacity_mw: 494,969 (68.4%)**
- **owner_name: 373,659 (51.6%)**
- **lat/lng: 583,743 (80.7%)**
- **flood_zone: 138,303 (19.1%)**
- **mount_type: 723,491 (100.0%)**
- **100% location_precision coverage**

<claude-mem-context>

</claude-mem-context>
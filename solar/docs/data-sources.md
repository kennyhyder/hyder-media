# SolarTrack — Data Sources Registry + Data File Locations

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

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


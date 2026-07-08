# SolarTrack — Enrichment Results (Feb 2026)

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

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


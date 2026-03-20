# Industrial Site Data Sources for GridScout Brownfield Expansion

## Research Date: March 19, 2026

## Current State
GridScout has 2,087 brownfield sites from 2 sources:
1. **EIA-860 Retired Generators** — coal/gas/oil/nuclear plants with grid connections
2. **EPA RE-Powering Tracking Matrix** — brownfield/landfill sites suitable for energy redevelopment

This document catalogs FREE data sources to expand the brownfield/industrial category with 7 additional site types.

---

## 1. FEDERAL REAL PROPERTY (FRPP) — Excess/Underutilized Federal Buildings

**PRIORITY: HIGH — Best single source for large vacant industrial/office sites**

| Attribute | Detail |
|-----------|--------|
| Source | GSA Federal Real Property Profile (FRPP) Public Dataset |
| URL | https://catalog.data.gov/dataset/fy-2024-federal-real-property-profile-frpp-public-dataset |
| Format | Excel (XLSX), downloadable from data.gov |
| Cost | FREE |
| Records | ~300,000 federal properties (all types), filterable to excess/underutilized |
| Update | Annual (FY 2016–FY 2024 available) |
| Coordinates | Yes — latitude/longitude in dataset |

**Key Fields:**
- Agency, Installation Name, Address, City, State, ZIP, Congressional District
- Latitude, Longitude
- Real Property Type (Building, Land, Structure)
- Real Property Use (Office, Warehouse, Industrial, Laboratory, etc.)
- **Utilization Status** (Utilized, Underutilized, Not Utilized, Excess, Disposed)
- Square Footage, Acreage
- Condition Assessment (Good, Adequate, Poor)
- Year Built/Acquired
- Legal Interest (Owned, Leased)

**Filtering Strategy:**
- Status = "Excess" OR "Not Utilized" OR "Underutilized"
- Use = "Office", "Warehouse", "Industrial", "Laboratory", "Data Processing Center"
- Sq ft >= 25,000 (or acreage >= 5)
- Estimated useful records: ~5,000–15,000 sites

**Access:**
```
# Direct download from data.gov (XLSX)
https://catalog.data.gov/dataset/fy-2024-federal-real-property-profile-frpp-public-dataset
```

**Also check:**
- GSA Disposal portal: https://disposal.gsa.gov — currently available excess properties
- GSA auction site: https://realestatesales.gov — properties for sale
- FRPP interactive map has "Excess View" and "Disposed View" filters

---

## 2. BRAC MILITARY BASE CLOSURES

**PRIORITY: HIGH — 424 bases across 5 rounds, massive sites with power/fiber**

| Attribute | Detail |
|-----------|--------|
| Source | EPA Federal Facilities + DoD BRAC lists |
| URL | https://www.epa.gov/fedfac/base-realignment-and-closure-brac-sites-state |
| Format | HTML (scrape) + TIGER/Line Shapefiles (Census) |
| Cost | FREE |
| Records | 424 bases/parts across 5 rounds (1988, 1991, 1993, 1995, 2005) |
| Coordinates | Via Census TIGER/Line Military Installation shapefiles |

**Data Sources (combine for full picture):**

### 2a. Census TIGER/Line Military Installations
- URL: https://catalog.data.gov/dataset/tiger-line-shapefile-2022-nation-u-s-military-installation
- Format: Shapefile with polygons
- Fields: Installation name, FIPS, area, geometry (polygon boundaries)
- Note: Includes ACTIVE bases too — cross-reference with BRAC list to filter

### 2b. USACE MIRTA (Military Installations, Ranges, Training Areas)
- URL: https://geospatial-usace.opendata.arcgis.com/datasets/fc0f38c5a19a46dbacd92f2fb823ef8c
- Format: ArcGIS FeatureServer, downloadable as CSV/GeoJSON/Shapefile
- Fields: Site name, branch, status, state, geometry
- Note: May include BRAC status markers

### 2c. EPA BRAC Sites by State
- URL: https://www.epa.gov/fedfac/base-realignment-and-closure-brac-sites-state
- Note: Page returned 404 as of March 2026. Use archived versions or EPA FedFacts.
- Alternative: Navy BRAC PMO at https://www.bracpmo.navy.mil/BRAC-Bases/
- Air Force BRAC: https://www.afcec.af.mil/Home/BRAC/

### 2d. USDOT Military Bases Dataset
- URL: https://data-usdot.opendata.arcgis.com/datasets/usdot::military-bases/about
- Format: ArcGIS FeatureServer
- Fields: Name, branch, joint base status, lat/lng, state, CLOSURE/REALIGN/BRAC status columns

**Filtering Strategy:**
- Filter to BRAC status = "closed" or "realigned"
- Cross-reference with FRPP dataset for acreage/sq ft
- Estimated useful records: ~200–300 unique closed/realigned bases

**Why these are great for DCs:**
- Heavy power infrastructure (substations, backup generation)
- Often have fiber/comm infrastructure
- Large acreage (100+ acres common)
- Industrial zoning already in place
- Some have existing secure data facilities

---

## 3. EPA FACILITY REGISTRY SERVICE (FRS) — All EPA-Regulated Industrial Sites

**PRIORITY: HIGH — Millions of facilities with NAICS codes and coordinates**

| Attribute | Detail |
|-----------|--------|
| Source | EPA Facility Registry Service via ECHO downloads |
| URL | https://www.epa.gov/frs/epa-frs-facilities-state-single-file-csv-download |
| Format | State CSV ZIP files (732 MB national file) |
| Cost | FREE |
| Records | ~2M+ facilities nationwide |
| Coordinates | Yes — latitude/longitude for all facilities |

**Download Files (per state or national):**
```
# National file (732 MB ZIP)
https://www.epa.gov/frs/epa-frs-facilities-state-single-file-csv-download

# Each state ZIP contains:
- NATIONAL_FACILITY_FILE.CSV (name, address, lat/lng, county, FIPS)
- NATIONAL_NAICS_FILE.CSV (NAICS codes per facility)
- NATIONAL_SIC_FILE.CSV (SIC codes per facility)
- NATIONAL_INTEREST_FILE.CSV (EPA program registrations)
- NATIONAL_ORGANIZATION_FILE.CSV (owner/operator names)
- NATIONAL_ALTERNATIVE_NAME_FILE.CSV
- NATIONAL_CONTACT_FILE.CSV
- NATIONAL_MAILING_ADDRESS_FILE.CSV
```

**Key NAICS Codes for DC-Suitable Industrial Sites:**
| NAICS | Industry | DC Potential |
|-------|----------|-------------|
| 31-33 | Manufacturing | HIGH — heavy power, industrial zoning |
| 4931 | Warehousing & Storage | HIGH — large floor area, loading docks |
| 5182 | Data Processing & Hosting | HIGH — defunct data centers! |
| 4451-4453 | Grocery/General Merch Stores | MEDIUM — large retail sites |
| 4521 | Department Stores | MEDIUM — dead malls |
| 6221 | General Medical/Surgical Hospitals | MEDIUM — heavy power, cooling |
| 5111 | Newspaper/Periodical Publishers | MEDIUM — large facilities |

**Filtering Strategy:**
- Join FACILITY file with NAICS file on Registry ID
- Filter to manufacturing NAICS (31-33), warehousing (493), data processing (5182)
- Cross-reference with ECHO for permit status (inactive permits = likely closed)
- Note: FRS does NOT have a "closed" status field — must infer from inactive permits

**REST API Alternative:**
- Endpoint: `https://ofmpub.epa.gov/enviro/frs_rest_services.get_facilities`
- Requires NAAS account (email nodehelpdesk@epa.gov + FRS_Support@epa.gov)
- Supports NAICS/SIC filtering, state filtering, JSON/XML output
- Rate-limited — bulk download is better for our use case

---

## 4. MSHA MINES DATABASE — Abandoned/Closed Mining Sites

**PRIORITY: MEDIUM — 275K+ mines, many with large acreage and power**

| Attribute | Detail |
|-----------|--------|
| Source | MSHA (Mine Safety & Health Administration) |
| URL | https://arlweb.msha.gov/opengovernmentdata/ogimsha.asp |
| Format | Pipe-delimited TXT (ZIP download) |
| Cost | FREE |
| Records | ~85,000 mines total, ~40,000+ abandoned |
| Update | Weekly (Fridays) |
| Coordinates | Yes — latitude (xx.xxxxxx) and longitude (xxx.xxxxxx) |

**Download URL:**
```
https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip
# Data definition: https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines_Definition_File.txt
# Address data: https://arlweb.msha.gov/OpenGovernmentData/DataSets/AddressofRecord.zip
```

**Key Fields:**
- MINE_ID (unique key)
- MINE_NAME, MINE_TYPE (Surface/Underground/Facility/Mill)
- CURRENT_MINE_STATUS (**Active, Abandoned, Abandoned and Sealed, NonProducing, Temporarily Idle**)
- CURRENT_CONTROLLER_NAME, CURRENT_OPERATOR_NAME
- STATE, COUNTY, FIPS_CNTY_CD
- LATITUDE, LONGITUDE
- PRIMARY_SIC, PRIMARY_SIC_DESC
- COMMODITY (Coal, Sand & Gravel, Crusite Stone, etc.)
- MINE_STATUS_DATE

**Also available:**
- OSMRE National Mine Map Repository: 275,000+ historical mines since 1790s
- URL: https://www.osmre.gov/programs/national-mine-map-repository

**Filtering Strategy:**
- Status = "Abandoned" or "NonProducing" or "Temporarily Idle"
- Type = "Surface" (underground mines less suitable for DC)
- Commodity = "Sand & Gravel", "Crushed Stone", "Limestone" (large open-pit sites)
- Estimated useful records: ~5,000–10,000 surface mines with large footprints

---

## 5. PNNL DATA CENTER ATLAS — Existing DC Locations (incl. potentially closed)

**PRIORITY: HIGH — Already partially ingested; expand for closed/defunct tracking**

| Attribute | Detail |
|-----------|--------|
| Source | PNNL IM3 Open Source Data Center Atlas (OpenStreetMap-derived) |
| DOI | https://doi.org/10.57931/2550666 |
| Format | GeoPackage (GPKG) + CSV |
| Cost | FREE (Open Database License) |
| Records | ~10,000+ US data centers across 3 layers |
| Coordinates | Yes — WGS84 (EPSG:4326) |

**Layers:**
- `point` — individual coordinate locations
- `building` — facilities with building tags from OSM
- `campus` — larger facility areas

**Fields:**
- Unique ID, facility name, operator
- State, county (US Census-derived)
- Surface area (sq ft)
- Latitude, longitude, geometry

**Supplemental Sources for Defunct DCs:**
- **DataCenterMap.com**: 10,575 global DCs. Exports available in CSV, GeoJSON, KMZ, SHP. No free API but Data Explorer tool allows filtered export. ~4,000 US facilities.
- **Baxtel.com**: 8,000+ global DCs. PDF data sheets per facility. No bulk API.
- **CloudScene/DataCenterHawk**: Commercial databases, not free.

**Strategy for finding DEFUNCT DCs:**
- Compare PNNL/DataCenterMap lists against current operator websites
- Cross-reference with EPA FRS NAICS 5182 (Data Processing & Hosting) facilities
- Check FRPP for federal data processing centers marked "Excess"

---

## 6. CMS HOSPITAL DATA — Closed/Converted Hospitals

**PRIORITY: MEDIUM — Heavy power, backup generators, cooling systems**

| Attribute | Detail |
|-----------|--------|
| Source | Multiple (CMS, HIFLD, UNC Sheps Center) |

### 6a. CMS Hospital General Information
- URL: https://data.cms.gov/provider-data/dataset/xubh-q36u
- Format: CSV download
- Records: ~7,000 hospitals (currently Medicare-enrolled)
- Fields: Facility name, address, city, state, ZIP, county, phone, hospital type, ownership, emergency services, bed count, overall rating
- **Limitation**: Only shows CURRENTLY ENROLLED hospitals. Does NOT track closures.
- Coordinates: Not included directly, but addresses are geocodable

### 6b. CMS Hospital Enrollments (Historical)
- URL: https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-enrollments
- May include enrollment termination dates (= closure indicator)

### 6c. UNC Sheps Center Rural Hospital Closures
- URL: https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/
- Interactive map + downloadable data
- Records: 195 rural hospital closures/conversions since 2005 (110 complete + 85 converted)
- Fields: Hospital name, city, state, closure date, type (complete/converted)
- **Best free source for CLOSED hospitals specifically**

### 6d. HIFLD Hospitals Layer
- URL: https://hifld-geoplatform.opendata.arcgis.com/datasets/geoplatform::hospitals
- Format: ArcGIS FeatureServer, downloadable CSV/GeoJSON/Shapefile
- Records: ~7,500 hospitals
- Fields: Name, address, city, state, ZIP, phone, type, beds, trauma level, NAICS, lat/lng
- Has a STATUS field (may include CLOSED)
- Already used in GridScout pipeline (HIFLD data is familiar)

**Filtering Strategy:**
- HIFLD: Filter STATUS = "CLOSED" if available
- UNC Sheps: All 195 records are closed (complete closures are DC candidates)
- CMS enrollments: Look for terminated enrollment dates
- Cross-reference: Compare HIFLD current list vs. historical CMS data to find disappeared hospitals
- Estimated useful records: ~200–500 closed hospitals with significant infrastructure

---

## 7. EPA BROWNFIELDS (EXPANDED) — CIMC/ACRES with Industrial Classification

**PRIORITY: MEDIUM — Expands beyond current EPA RE-Powering data**

| Attribute | Detail |
|-----------|--------|
| Source | EPA Cleanups in My Community (CIMC) / ACRES |
| ArcGIS | https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer/5 |
| Geodatabase | https://www.epa.gov/sites/default/files/2018-12/brownfield_gdb.zip |
| Format | ArcGIS MapServer, Geodatabase (ZIP), CSV via CIMC interface |
| Cost | FREE |
| Coordinates | Yes — latitude/longitude |
| Update | Twice monthly |

**Brownfields Layer Fields (17 fields):**
- registry_id, primary_name (Display field)
- location_address, city_name, county_name, state_code
- epa_region, postal_code
- latitude, longitude
- pgm_sys_acrnm, pgm_sys_id
- fips_code, huc_code
- facility_url

**⚠️ Legacy Service Warning:** The MapServer at `map22.epa.gov` is being retired. Check for updated endpoints at EPA Developer Central (https://developer.epa.gov/).

**Additional EPA Brownfield Sources:**
- ACRES data on FRS: https://geodata.epa.gov/arcgis/rest/services/OEI/FRS_INTERESTS/MapServer/0
- Full CIMC geodatabase download includes more fields than the MapServer layer
- CIMC web interface (https://map22.epa.gov/cimc) allows CSV export of search results

**Strategy:**
- Download brownfield geodatabase (ZIP)
- Cross-reference with FRS NAICS codes to identify former manufacturing/industrial sites
- Filter to larger sites (if acreage available in full geodatabase)
- We already have EPA RE-Powering sites — this adds the broader ACRES universe

---

## 8. HUD/USPS VACANCY DATA — Business Vacancy Rates by Census Tract

**PRIORITY: LOW-MEDIUM — Aggregate data, no individual sites, but useful for scoring**

| Attribute | Detail |
|-----------|--------|
| Source | HUD Aggregated USPS Administrative Data on Address Vacancies |
| URL | https://www.huduser.gov/portal/datasets/usps.html |
| Format | DBF files (quarterly, census tract level) |
| Cost | FREE (requires HUD USER account) |
| Records | Every census tract in US (~85,000 tracts) |
| Update | Quarterly (since Q1 2008) |

**Key Fields:**
- Census tract GEOID
- Total residential addresses, vacant residential, no-stat residential
- **Total business addresses, vacant business, no-stat business**
- Quarter/year

**Limitation:** This is AGGREGATE data — counts of vacant business addresses per tract, NOT individual vacant properties. Cannot identify specific buildings.

**Use Case for GridScout:**
- Incorporate into county_data scoring — high business vacancy rate = available sites
- Compare year-over-year to detect industrial decline in an area
- Supplement with Census CBP data for manufacturing closure detection

---

## 9. CENSUS COUNTY BUSINESS PATTERNS — Manufacturing Decline Detection

**PRIORITY: LOW-MEDIUM — Aggregate, but identifies counties losing manufacturing**

| Attribute | Detail |
|-----------|--------|
| Source | Census Bureau County Business Patterns |
| API | https://api.census.gov/data/{year}/cbp |
| Format | JSON API, CSV download |
| Cost | FREE |
| Records | Every county x NAICS combination (millions of rows) |
| Update | Annual (latest: 2023) |

**API Example:**
```
# Manufacturing establishment counts in California
https://api.census.gov/data/2023/cbp?get=ESTAB,NAICS2017_LABEL,NAME&for=county:*&in=state:06&NAICS2017=31-33

# Year-over-year comparison (run for 2018 and 2023, diff)
```

**Key Fields:**
- ESTAB (number of establishments)
- EMP (employment)
- PAYANN (annual payroll)
- Geography (county FIPS)
- NAICS code (2-6 digit)

**Strategy:**
- Pull manufacturing NAICS (31-33) establishment counts by county for 2018 vs 2023
- Counties with >20% decline = industrial vacancy hot spots
- NOT individual site locations, but useful for scoring grid_county_data
- Combine with USPS vacancy data for composite "available sites" score

---

## 10. STATE ECONOMIC DEVELOPMENT SITE DATABASES

**PRIORITY: MEDIUM — Varies wildly by state, some excellent**

No single national database exists. Each state maintains its own site selector. Key states with good free databases:

| State | URL | Platform | Notes |
|-------|-----|----------|-------|
| Georgia | https://georgia.org/site-selector | SelectGeorgia | Searchable, filterable, shovel-ready designation |
| North Carolina | https://edpnc.com/find-a-site/ | EDPNC | Interactive map, property details |
| Texas | https://texassiteselection.com/ | TxEDC | Site Search tool |
| Virginia | https://www.vedp.org/sitecenter | VEDP SiteCenter | Business-ready certified sites |
| Tennessee | https://tnecd.com/sites-buildings/ | TNECD | Available industrial sites |
| TVA Region (7 states) | https://www.tva.com/economic-development | TVA | Interactive mapping, shovel-ready sites |

**National Aggregators:**
- **SelectUSA** (trade.gov/selectusa): FDI-focused, no bulk download API
- **SiteSelector.com**: Commercial, Kroll product
- **BeyondShovelReady.com**: National comparative data, not free
- **ZoomProspector**: GIS-based tool used by many EDOs, API available ($$$)

**Strategy:**
- **TVA Region** is most promising: covers AL, GA, KY, MS, NC, TN, VA — public interactive map with site data
- Scrape individual state site selector tools for available industrial properties
- HIGH EFFORT per state, but HIGH VALUE data (size, zoning, utilities, cost)

---

## 11. DEAD MALLS / RETAIL CLOSURES

**PRIORITY: LOW — No good free database exists**

| Source | Records | Data Quality | Free? |
|--------|---------|-------------|-------|
| DeadMalls.com | ~450 | Narrative descriptions, photos, no coordinates | Yes but not structured |
| MallsInAmerica.com | ~200 | State-sorted lists | Yes but not structured |
| CoStar/LoopNet | Millions | Full CRE listings | NO ($$$) |
| ICSC (Int'l Council of Shopping Centers) | N/A | Industry stats only | Member-only |

**LoopNet/CoStar:**
- No public API
- Third-party scrapers exist (RapidAPI, Browse AI, Apify) — ToS violations
- CoStar has 8.5M commercial property records — $$$$ subscription
- Best commercial source but completely behind paywall

**Alternative Strategy:**
- Use USPS vacancy data (high business vacancy rate census tracts)
- Use Census CBP retail NAICS decline (NAICS 44-45)
- Cross-reference with EPA FRS for large retail NAICS facilities
- Community-sourced: r/deadmalls subreddit, local news scraping

**Not worth pursuing as a data source** — better to detect retail vacancy zones via USPS/CBP aggregate data.

---

## 12. DATA CENTER MAP COMMERCIAL DATABASES

**PRIORITY: LOW — Not free, limited value beyond PNNL**

| Source | Records | Format | Free? |
|--------|---------|--------|-------|
| DataCenterMap.com | 10,575 global | CSV, GeoJSON, KMZ, SHP via Data Explorer | Paid subscription |
| Baxtel.com | 8,000+ global | PDF data sheets | No bulk download |
| DataCenters.com | ~4,000 US | Web directory | No API |
| CleanView.co | US tracking | Web map | Limited free access |

**PNNL IM3 Atlas (already in GridScout) is the best free source.**

---

## IMPLEMENTATION PRIORITY MATRIX

| # | Source | Records | Effort | Value | Priority |
|---|--------|---------|--------|-------|----------|
| 1 | **FRPP Federal Property** | ~5K–15K | LOW (XLSX download) | **HIGH** — excess buildings with coords, sq ft, condition | **P0** |
| 2 | **BRAC Military Bases** | ~200–300 | MEDIUM (cross-reference 3 sources) | **HIGH** — massive sites with power/fiber | **P0** |
| 3 | **EPA FRS (Manufacturing)** | ~50K–100K | MEDIUM (732 MB download, NAICS filter) | **HIGH** — all industrial sites with coords | **P1** |
| 4 | **MSHA Mines** | ~5K–10K surface | LOW (ZIP download) | **MEDIUM** — large acreage but remote | **P1** |
| 5 | **PNNL DC Atlas** (expand) | ~10K | ALREADY DONE | **HIGH** — existing DCs | Done |
| 6 | **Hospital Closures** | ~200–500 | LOW (UNC Sheps + HIFLD) | **MEDIUM** — heavy power/cooling | **P2** |
| 7 | **EPA Brownfields** (expand) | ~3K–5K | LOW (geodatabase download) | **MEDIUM** — broader than RE-Powering | **P2** |
| 8 | **HUD/USPS Vacancy** | aggregate | LOW (DBF download) | **LOW** — scoring only, no sites | **P3** |
| 9 | **Census CBP** | aggregate | LOW (API) | **LOW** — scoring only, no sites | **P3** |
| 10 | **State EDO Sites** | ~500–2K per state | HIGH (per-state scraping) | **MEDIUM** — quality data but fragmented | **P3** |
| 11 | **Dead Malls** | ~450 | HIGH (scraping/manual) | **LOW** — no structured data | **SKIP** |
| 12 | **DC Map Commercial** | paid | N/A | **LOW** — behind paywall | **SKIP** |

---

## RECOMMENDED INGESTION ORDER

### Phase 1 — Quick Wins (1-2 days)
1. **FRPP Federal Property** — Download XLSX from data.gov, filter to excess/underutilized industrial/office sites, geocode if needed
2. **MSHA Mines** — Download ZIP, filter to abandoned/idle surface mines with coordinates
3. **UNC Sheps Hospital Closures** — Scrape 195 records from interactive map

### Phase 2 — Heavy Lift (2-3 days)
4. **BRAC Military Bases** — Combine USDOT ArcGIS + Census TIGER + Navy BRAC list, filter to closed/realigned
5. **EPA FRS Manufacturing** — Download national CSV, join with NAICS file, filter to manufacturing/warehousing/data processing

### Phase 3 — Enrichment (1-2 days)
6. **EPA Brownfields** — Download expanded geodatabase, cross-ref with FRS NAICS for former industrial classification
7. **HIFLD Hospitals** — Check STATUS field for closed facilities
8. **USPS/CBP Vacancy** — Add business vacancy rate to county_data scoring

### Schema Changes Needed
Expand `grid_brownfield_sites.site_type` to support:
```sql
-- Current: 'retired_plant', 'epa_brownfield'
-- New values:
'retired_plant'        -- EIA-860 (existing)
'epa_brownfield'       -- EPA RE-Powering (existing)
'federal_excess'       -- FRPP excess/underutilized
'military_brac'        -- BRAC closed/realigned bases
'closed_manufacturing' -- EPA FRS manufacturing with inactive permits
'abandoned_mine'       -- MSHA surface mines
'closed_hospital'      -- UNC Sheps / HIFLD closed hospitals
'industrial_brownfield'-- EPA ACRES/CIMC industrial brownfields
```

Add columns to `grid_brownfield_sites`:
```sql
ALTER TABLE grid_brownfield_sites ADD COLUMN IF NOT EXISTS
  building_sqft NUMERIC(12,0),              -- FRPP, hospital data
  condition TEXT,                            -- FRPP condition assessment
  property_owner TEXT,                       -- FRPP agency, MSHA operator
  zoning TEXT,                               -- State EDO data
  year_closed INTEGER,                       -- Retirement/closure year
  original_naics TEXT,                       -- EPA FRS industry code
  original_use_detail TEXT;                  -- More specific than former_use
```

---

## ESTIMATED TOTALS AFTER EXPANSION

| Site Type | Current | After Expansion |
|-----------|---------|-----------------|
| Retired Plants (EIA-860) | ~1,200 | ~1,200 (no change) |
| EPA RE-Powering | ~887 | ~887 (no change) |
| Federal Excess Property | 0 | ~5,000–15,000 |
| BRAC Military Bases | 0 | ~200–300 |
| Closed Manufacturing (FRS) | 0 | ~10,000–50,000 |
| Abandoned Mines (MSHA) | 0 | ~5,000–10,000 |
| Closed Hospitals | 0 | ~200–500 |
| EPA Brownfields (expanded) | 0 | ~3,000–5,000 |
| **TOTAL** | **~2,087** | **~25,000–80,000** |

This would make GridScout's brownfield/industrial category 12-38x larger than current.

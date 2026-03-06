-- GridScout Database Schema
-- All tables prefixed grid_ to avoid conflicts with solar_ and other hyder-media tables
-- Uses same Supabase project (ilbovwnhrowvxjdkvrln.supabase.co)

-- Ensure PostGIS is enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Data source tracking (same pattern as SolarTrack)
CREATE TABLE IF NOT EXISTS grid_data_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT,
  description TEXT,
  record_count INTEGER DEFAULT 0,
  last_import TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HIFLD transmission line segments + NREL DLR ratings + ERCOT congestion
CREATE TABLE IF NOT EXISTS grid_transmission_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hifld_id INTEGER,
  source_record_id TEXT NOT NULL UNIQUE,

  -- Line properties (from HIFLD)
  voltage_kv NUMERIC(8,2),
  volt_class TEXT,
  owner TEXT,
  status TEXT,
  line_type TEXT,
  sub_1 TEXT,
  sub_2 TEXT,
  naession TEXT,               -- Line name from HIFLD

  -- Calculated from NREL DLR data
  static_rating_amps NUMERIC(10,2),
  capacity_mw NUMERIC(10,2),
  upgrade_candidate BOOLEAN DEFAULT FALSE,

  -- ERCOT-specific (Texas only)
  ercot_shadow_price NUMERIC(12,2),
  ercot_binding_count INTEGER,
  ercot_mw_limit NUMERIC(10,2),

  -- Geography
  state TEXT,
  county TEXT,
  length_miles NUMERIC(10,3),

  -- PostGIS geometry for line rendering
  geom GEOMETRY(LINESTRING, 4326),
  -- Fallback WKT for non-PostGIS queries
  geometry_wkt TEXT,

  -- Metadata
  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BLM Right-of-Way grants for transmission
CREATE TABLE IF NOT EXISTS grid_blm_row (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  blm_case_id TEXT,
  holder_name TEXT,
  commodity TEXT,
  product TEXT,
  disposition TEXT,
  width_ft NUMERIC(10,2),
  length_ft NUMERIC(10,2),
  acreage NUMERIC(12,2),
  state TEXT,
  county TEXT,
  plss_description TEXT,

  -- PostGIS geometry
  geom GEOMETRY(GEOMETRY, 4326),
  geometry_wkt TEXT,

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Energy corridors (Section 368 + NIETC)
CREATE TABLE IF NOT EXISTS grid_corridors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  corridor_type TEXT NOT NULL,          -- 'section_368', 'nietc', 'blm_solar_dla'
  corridor_id TEXT,
  name TEXT,
  width_miles NUMERIC(8,2),
  states TEXT[],
  agency TEXT,
  environmental_status TEXT,
  acreage NUMERIC(12,2),

  -- PostGIS geometry (polygon)
  geom GEOMETRY(GEOMETRY, 4326),
  geometry_wkt TEXT,

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Land parcels adjacent to transmission lines
CREATE TABLE IF NOT EXISTS grid_parcels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  transmission_line_id UUID REFERENCES grid_transmission_lines(id),
  owner_name TEXT,
  parcel_id TEXT,
  acreage NUMERIC(12,2),
  address TEXT,
  city TEXT,
  state TEXT,
  county TEXT,
  zip_code TEXT,
  land_type TEXT,                        -- federal, state, private, tribal
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),

  -- Adjacent line info (denormalized)
  line_voltage_kv NUMERIC(8,2),
  line_capacity_mw NUMERIC(10,2),
  line_owner TEXT,
  distance_from_line_ft NUMERIC(10,2),

  -- Corridor membership flags
  in_section_368 BOOLEAN DEFAULT FALSE,
  in_nietc BOOLEAN DEFAULT FALSE,
  in_blm_solar_dla BOOLEAN DEFAULT FALSE,

  -- PostGIS geometry
  geom GEOMETRY(GEOMETRY, 4326),

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WECC path ratings
CREATE TABLE IF NOT EXISTS grid_wecc_paths (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  path_number INTEGER NOT NULL,
  path_name TEXT NOT NULL,
  ttc_mw_forward NUMERIC(10,2),
  ttc_mw_reverse NUMERIC(10,2),
  otc_mw_forward NUMERIC(10,2),
  otc_mw_reverse NUMERIC(10,2),
  utilization_u75 NUMERIC(5,2),
  utilization_u90 NUMERIC(5,2),
  states TEXT[],

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ERCOT binding constraint history (SCED shadow prices)
CREATE TABLE IF NOT EXISTS grid_ercot_constraints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  constraint_id TEXT,
  constraint_name TEXT NOT NULL,
  contingency_name TEXT,
  from_station TEXT,
  to_station TEXT,
  from_station_kv NUMERIC(8,2),
  to_station_kv NUMERIC(8,2),
  shadow_price NUMERIC(12,2),
  max_shadow_price NUMERIC(12,2),
  limit_mw NUMERIC(10,2),
  value_mw NUMERIC(10,2),
  violated_mw NUMERIC(10,2),
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ,

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(constraint_name, interval_start)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_grid_tl_state ON grid_transmission_lines(state);
CREATE INDEX IF NOT EXISTS idx_grid_tl_voltage ON grid_transmission_lines(voltage_kv);
CREATE INDEX IF NOT EXISTS idx_grid_tl_capacity ON grid_transmission_lines(capacity_mw);
CREATE INDEX IF NOT EXISTS idx_grid_tl_upgrade ON grid_transmission_lines(upgrade_candidate) WHERE upgrade_candidate = TRUE;
CREATE INDEX IF NOT EXISTS idx_grid_tl_hifld ON grid_transmission_lines(hifld_id);
CREATE INDEX IF NOT EXISTS idx_grid_tl_geom ON grid_transmission_lines USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_grid_blm_state ON grid_blm_row(state);
CREATE INDEX IF NOT EXISTS idx_grid_blm_geom ON grid_blm_row USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_grid_corr_type ON grid_corridors(corridor_type);
CREATE INDEX IF NOT EXISTS idx_grid_corr_geom ON grid_corridors USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_grid_parcels_line ON grid_parcels(transmission_line_id);
CREATE INDEX IF NOT EXISTS idx_grid_parcels_state ON grid_parcels(state);
CREATE INDEX IF NOT EXISTS idx_grid_parcels_geom ON grid_parcels USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_grid_ercot_constraint ON grid_ercot_constraints(constraint_name);
CREATE INDEX IF NOT EXISTS idx_grid_ercot_shadow ON grid_ercot_constraints(shadow_price DESC);
CREATE INDEX IF NOT EXISTS idx_grid_ercot_interval ON grid_ercot_constraints(interval_start);

-- ============================================================================
-- DC Site Selection Tables (Phase 2 — Datacenter Intelligence)
-- ============================================================================

-- County-level intelligence (FEMA NRI + BLS + NOAA + WRI + tax incentives)
CREATE TABLE IF NOT EXISTS grid_county_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fips_code TEXT NOT NULL UNIQUE,            -- 5-digit FIPS (state 2 + county 3)
  state TEXT NOT NULL,
  state_fips TEXT,
  county_name TEXT NOT NULL,

  -- FEMA National Risk Index
  nri_score NUMERIC(8,2),                    -- Composite risk score (0-100, lower=safer)
  nri_rating TEXT,                            -- Very Low / Relatively Low / Moderate / Relatively High / Very High
  nri_earthquake NUMERIC(8,2),
  nri_hurricane NUMERIC(8,2),
  nri_tornado NUMERIC(8,2),
  nri_flooding NUMERIC(8,2),
  nri_wildfire NUMERIC(8,2),
  nri_hail NUMERIC(8,2),
  nri_ice_storm NUMERIC(8,2),
  nri_strong_wind NUMERIC(8,2),
  nri_winter_weather NUMERIC(8,2),
  nri_heat_wave NUMERIC(8,2),
  nri_landslide NUMERIC(8,2),
  nri_lightning NUMERIC(8,2),
  nri_avalanche NUMERIC(8,2),
  nri_coastal_flooding NUMERIC(8,2),
  nri_drought NUMERIC(8,2),
  nri_tsunami NUMERIC(8,2),
  nri_volcanic NUMERIC(8,2),

  -- BLS QCEW employment data
  construction_employment INTEGER,           -- NAICS 23
  construction_wages_avg NUMERIC(10,2),
  it_employment INTEGER,                     -- NAICS 5112/5182
  it_wages_avg NUMERIC(10,2),
  total_employment INTEGER,

  -- NOAA climate normals
  cooling_degree_days NUMERIC(8,1),          -- Annual CDD (lower = better for DCs)
  heating_degree_days NUMERIC(8,1),
  mean_annual_temp_f NUMERIC(5,1),

  -- WRI Aqueduct water stress
  water_stress_score NUMERIC(5,2),           -- 0-5 (0=low stress, 5=extreme)
  water_stress_label TEXT,                   -- Low / Low-Medium / Medium-High / High / Extremely High

  -- DC tax incentives (state-level, stored per county for join convenience)
  has_dc_tax_incentive BOOLEAN DEFAULT FALSE,
  dc_incentive_type TEXT,                    -- sales_tax_exemption, property_tax_abatement, etc.
  dc_incentive_details TEXT,

  -- FCC broadband / fiber
  has_fiber BOOLEAN DEFAULT FALSE,
  fiber_provider_count INTEGER DEFAULT 0,

  -- Metadata
  population INTEGER,
  area_sq_miles NUMERIC(10,2),
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scored datacenter site candidates (core DC table)
CREATE TABLE IF NOT EXISTS grid_dc_sites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  name TEXT,
  site_type TEXT NOT NULL,                   -- 'substation', 'brownfield', 'greenfield'

  -- Location
  state TEXT NOT NULL,
  county TEXT,
  fips_code TEXT,
  address TEXT,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(11,7) NOT NULL,

  -- Power infrastructure
  nearest_substation_id UUID,
  nearest_substation_name TEXT,
  nearest_substation_distance_km NUMERIC(8,2),
  substation_voltage_kv NUMERIC(8,2),
  available_capacity_mw NUMERIC(10,2),

  -- Connectivity
  nearest_ixp_id UUID,
  nearest_ixp_name TEXT,
  nearest_ixp_distance_km NUMERIC(8,2),
  nearest_dc_id UUID,
  nearest_dc_name TEXT,
  nearest_dc_distance_km NUMERIC(8,2),

  -- Brownfield data (if site_type='brownfield')
  brownfield_id UUID,
  former_use TEXT,
  existing_capacity_mw NUMERIC(10,2),
  retirement_date DATE,
  cleanup_status TEXT,
  acreage NUMERIC(12,2),

  -- Composite DC Readiness Score (0-100)
  dc_score NUMERIC(5,1),
  score_power NUMERIC(5,1),                  -- 25% weight
  score_speed_to_power NUMERIC(5,1),         -- 20% weight
  score_fiber NUMERIC(5,1),                  -- 15% weight
  score_water NUMERIC(5,1),                  -- 10% weight
  score_hazard NUMERIC(5,1),                 -- 10% weight
  score_labor NUMERIC(5,1),                  -- 5% weight
  score_existing_dc NUMERIC(5,1),            -- 5% weight
  score_land NUMERIC(5,1),                   -- 5% weight
  score_tax NUMERIC(5,1),                    -- 3% weight
  score_climate NUMERIC(5,1),                -- 2% weight

  -- ISO queue data
  iso_region TEXT,                            -- CAISO, ERCOT, PJM, MISO, SPP, NYISO, ISO-NE
  queue_depth INTEGER,                       -- # projects in local queue
  avg_queue_wait_years NUMERIC(4,1),

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Internet Exchange Points + Colocation facilities
CREATE TABLE IF NOT EXISTS grid_ixp_facilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  peeringdb_id INTEGER,
  name TEXT NOT NULL,
  org_name TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),
  ix_count INTEGER DEFAULT 0,                -- Number of IXs at this facility
  network_count INTEGER DEFAULT 0,           -- Number of networks present
  website TEXT,
  notes TEXT,
  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Existing US datacenter locations (PNNL IM3 Atlas)
CREATE TABLE IF NOT EXISTS grid_datacenters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  name TEXT,
  operator TEXT,
  city TEXT,
  state TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),
  capacity_mw NUMERIC(10,2),
  sqft NUMERIC(12,0),
  dc_type TEXT,                              -- 'colocation', 'enterprise', 'hyperscale', 'edge'
  year_built INTEGER,
  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brownfield sites (retired power plants + EPA brownfields)
CREATE TABLE IF NOT EXISTS grid_brownfield_sites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  name TEXT,
  site_type TEXT NOT NULL,                   -- 'retired_plant', 'epa_brownfield'
  former_use TEXT,                           -- 'coal', 'gas', 'nuclear', 'oil', 'manufacturing', etc.
  state TEXT NOT NULL,
  county TEXT,
  city TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),
  acreage NUMERIC(12,2),

  -- Retired plant data (from EIA-860)
  eia_plant_id INTEGER,
  existing_capacity_mw NUMERIC(10,2),
  retirement_date DATE,
  grid_connection_voltage_kv NUMERIC(8,2),

  -- EPA brownfield data
  epa_id TEXT,
  cleanup_status TEXT,                       -- 'cleanup_complete', 'in_progress', 'not_started'
  contaminant_type TEXT,

  -- Cross-references
  nearest_substation_id UUID,
  nearest_substation_distance_km NUMERIC(8,2),

  data_source_id UUID REFERENCES grid_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ISO queue summary by substation/POI
CREATE TABLE IF NOT EXISTS grid_queue_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  iso TEXT NOT NULL,                          -- CAISO, ERCOT, PJM, MISO, SPP, NYISO, ISO-NE
  poi_name TEXT NOT NULL,                    -- Point of interconnection name
  state TEXT,
  total_projects INTEGER DEFAULT 0,
  total_capacity_mw NUMERIC(12,2),
  solar_projects INTEGER DEFAULT 0,
  wind_projects INTEGER DEFAULT 0,
  storage_projects INTEGER DEFAULT 0,
  avg_wait_years NUMERIC(4,1),
  oldest_project_year INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(iso, poi_name)
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_grid_county_fips ON grid_county_data(fips_code);
CREATE INDEX IF NOT EXISTS idx_grid_county_state ON grid_county_data(state);
CREATE INDEX IF NOT EXISTS idx_grid_county_nri ON grid_county_data(nri_score);

CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_state ON grid_dc_sites(state);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_score ON grid_dc_sites(dc_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_type ON grid_dc_sites(site_type);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_fips ON grid_dc_sites(fips_code);

CREATE INDEX IF NOT EXISTS idx_grid_ixp_state ON grid_ixp_facilities(state);
CREATE INDEX IF NOT EXISTS idx_grid_dc_state ON grid_datacenters(state);
CREATE INDEX IF NOT EXISTS idx_grid_brownfield_state ON grid_brownfield_sites(state);
CREATE INDEX IF NOT EXISTS idx_grid_brownfield_type ON grid_brownfield_sites(site_type);
CREATE INDEX IF NOT EXISTS idx_grid_queue_iso ON grid_queue_summary(iso);
CREATE INDEX IF NOT EXISTS idx_grid_queue_poi ON grid_queue_summary(poi_name);

-- Seed data sources
INSERT INTO grid_data_sources (name, url, description) VALUES
  ('hifld_transmission', 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0', 'HIFLD Electric Power Transmission Lines'),
  ('nrel_dlr', 'https://data.openei.org/submissions/6231', 'NREL Dynamic Line Ratings (HDF5)'),
  ('blm_row', 'https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0', 'BLM National Right-of-Way Grants'),
  ('section_368', 'https://corridoreis.anl.gov/maps/', 'Section 368 Energy Corridors'),
  ('ercot_sced', 'https://www.ercot.com/mp/data-products/data-product-details?id=NP6-86-CD', 'ERCOT SCED Binding Constraints'),
  ('wecc_paths', 'https://www.wecc.org/wecc-document/19476', 'WECC Path Ratings'),
  ('blm_solar_dla', 'https://gbp-blm-egis.hub.arcgis.com/datasets/1d98d82820df49e5916aeb79837b69ab', 'BLM Solar Designated Leasing Areas'),
  ('nietc_phase3', 'https://gem.anl.gov/tool/layers/potential_nietcs_phase3_241216/versions/1/download.zip', 'NIETC Phase 3 Corridors'),
  ('fema_nri', 'https://hazards.fema.gov/nri/data-resources', 'FEMA National Risk Index'),
  ('bls_qcew', 'https://data.bls.gov/cew/data/files/', 'BLS Quarterly Census of Employment and Wages'),
  ('noaa_climate', 'https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals', 'NOAA US Climate Normals'),
  ('wri_aqueduct', 'https://www.wri.org/data/aqueduct-water-risk-atlas', 'WRI Aqueduct Water Risk Atlas'),
  ('dc_tax_incentives', NULL, 'State datacenter tax incentives (manual compilation)'),
  ('peeringdb', 'https://www.peeringdb.com/api/', 'PeeringDB Internet Exchange Points'),
  ('pnnl_im3', 'https://im3data.pnnl.gov/', 'PNNL IM3 US Datacenter Atlas'),
  ('eia_retired_plants', 'https://www.eia.gov/electricity/data/eia860/', 'EIA-860 Retired Power Plants'),
  ('epa_brownfields', 'https://www.epa.gov/frs', 'EPA Facility Registry Service Brownfields'),
  ('fcc_bdc', 'https://broadbandmap.fcc.gov/data-download', 'FCC Broadband Data Collection')
ON CONFLICT (name) DO NOTHING;

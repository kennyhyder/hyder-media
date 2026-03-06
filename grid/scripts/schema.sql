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

-- Seed data sources
INSERT INTO grid_data_sources (name, url, description) VALUES
  ('hifld_transmission', 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0', 'HIFLD Electric Power Transmission Lines'),
  ('nrel_dlr', 'https://data.openei.org/submissions/6231', 'NREL Dynamic Line Ratings (HDF5)'),
  ('blm_row', 'https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_LUA_ROW/FeatureServer/0', 'BLM National Right-of-Way Grants'),
  ('section_368', 'https://corridoreis.anl.gov/maps/', 'Section 368 Energy Corridors'),
  ('ercot_sced', 'https://www.ercot.com/mp/data-products/data-product-details?id=NP6-86-CD', 'ERCOT SCED Binding Constraints'),
  ('wecc_paths', 'https://www.wecc.org/wecc-document/19476', 'WECC Path Ratings'),
  ('blm_solar_dla', 'https://gbp-blm-egis.hub.arcgis.com/datasets/1d98d82820df49e5916aeb79837b69ab', 'BLM Solar Designated Leasing Areas'),
  ('nietc_phase3', 'https://gem.anl.gov/tool/layers/potential_nietcs_phase3_241216/versions/1/download.zip', 'NIETC Phase 3 Corridors')
ON CONFLICT (name) DO NOTHING;

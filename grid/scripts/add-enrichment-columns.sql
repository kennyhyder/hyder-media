-- GridScout: Add enrichment columns for Tasks 1, 3, 4, 7, 8
-- Run via Supabase SQL Editor or psql

-- Task 1: FEMA Flood Zone
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS flood_zone TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS flood_zone_sfha BOOLEAN;

-- Task 3: Cloud Region Proximity
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_cloud_region TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_cloud_provider TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS nearest_cloud_distance_km NUMERIC(8,2);

-- Task 4: Land Acquisition Contacts
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS land_contact_type TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS land_contact_name TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS land_contact_url TEXT;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS land_contact_phone TEXT;

-- Task 7: FCC Broadband
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS fcc_fiber_providers INTEGER;
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS fcc_max_down_mbps NUMERIC(10,2);
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS fcc_max_up_mbps NUMERIC(10,2);
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS census_block_fips TEXT;

-- Task 8: WRI Water Stress (granular)
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wri_water_stress NUMERIC(6,3);
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wri_water_depletion NUMERIC(6,3);
ALTER TABLE grid_dc_sites ADD COLUMN IF NOT EXISTS wri_basin_name TEXT;

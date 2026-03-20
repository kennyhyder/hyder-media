-- GridScout: Add land pricing columns to grid_county_data
-- Source: USDA NASS Quick Stats county-level agricultural land values
-- Run via Supabase SQL Editor or psql

ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS land_price_per_acre NUMERIC(10,2);
ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS land_price_source TEXT DEFAULT 'USDA NASS';
ALTER TABLE grid_county_data ADD COLUMN IF NOT EXISTS land_price_year INTEGER;

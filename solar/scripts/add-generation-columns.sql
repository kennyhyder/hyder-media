-- Add generation/performance columns to solar_installations
-- Run this before ingest-eia923.py or enrich-egrid.py --generation-only

ALTER TABLE solar_installations
  ADD COLUMN IF NOT EXISTS annual_generation_mwh NUMERIC(12, 1),
  ADD COLUMN IF NOT EXISTS capacity_factor NUMERIC(6, 4);

-- Index for finding underperforming sites
CREATE INDEX IF NOT EXISTS idx_solar_installations_capacity_factor
  ON solar_installations (capacity_factor)
  WHERE capacity_factor IS NOT NULL;

-- Also add offtaker_name and ppa_price for FERC EQR data
ALTER TABLE solar_installations
  ADD COLUMN IF NOT EXISTS offtaker_name TEXT,
  ADD COLUMN IF NOT EXISTS ppa_price_mwh NUMERIC(10, 2);

ALTER TABLE solar_installations ADD COLUMN IF NOT EXISTS location_precision TEXT DEFAULT NULL CHECK (location_precision IN ('exact', 'address', 'city', 'zip', 'county', 'state'));

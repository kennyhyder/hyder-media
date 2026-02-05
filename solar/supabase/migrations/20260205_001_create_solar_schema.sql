-- SolarTrack Database Schema
-- Run this in Supabase SQL Editor

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Data Sources (create first - referenced by other tables)
CREATE TABLE IF NOT EXISTS solar_data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  url TEXT,
  last_import TIMESTAMPTZ,
  record_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Site Owners
CREATE TABLE IF NOT EXISTS solar_site_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT,
  entity_type TEXT,
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip_code VARCHAR(10),
  phone TEXT,
  website TEXT,
  owned_capacity_mw DECIMAL(12, 3) DEFAULT 0,
  developed_capacity_mw DECIMAL(12, 3) DEFAULT 0,
  site_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solar_owners_normalized
  ON solar_site_owners(normalized_name);

-- Installers
CREATE TABLE IF NOT EXISTS solar_installers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT,
  license_number TEXT,
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip_code VARCHAR(10),
  phone TEXT,
  website TEXT,
  installation_count INTEGER DEFAULT 0,
  total_capacity_kw DECIMAL(14, 3) DEFAULT 0,
  first_seen DATE,
  last_seen DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solar_installers_normalized
  ON solar_installers(normalized_name, state);

-- Installations (main table)
CREATE TABLE IF NOT EXISTS solar_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name TEXT,
  site_type TEXT NOT NULL DEFAULT 'commercial',
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  location GEOGRAPHY(POINT, 4326),
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip_code VARCHAR(10),
  county TEXT,
  capacity_dc_kw DECIMAL(12, 3),
  capacity_ac_kw DECIMAL(12, 3),
  capacity_mw DECIMAL(10, 3),
  mount_type TEXT,
  tracking_type TEXT,
  num_modules INTEGER,
  num_inverters INTEGER,
  has_battery_storage BOOLEAN DEFAULT FALSE,
  battery_capacity_kwh DECIMAL(12, 3),
  owner_id UUID REFERENCES solar_site_owners(id),
  owner_name TEXT,
  developer_id UUID REFERENCES solar_site_owners(id),
  developer_name TEXT,
  operator_id UUID REFERENCES solar_site_owners(id),
  operator_name TEXT,
  installer_id UUID REFERENCES solar_installers(id),
  installer_name TEXT,
  install_date DATE,
  interconnection_date DATE,
  permit_date DATE,
  decommission_date DATE,
  site_status TEXT DEFAULT 'active',
  total_cost DECIMAL(14, 2),
  cost_per_watt DECIMAL(6, 3),
  data_source_id UUID REFERENCES solar_data_sources(id),
  source_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solar_inst_state ON solar_installations(state);
CREATE INDEX IF NOT EXISTS idx_solar_inst_type ON solar_installations(site_type);
CREATE INDEX IF NOT EXISTS idx_solar_inst_status ON solar_installations(site_status);
CREATE INDEX IF NOT EXISTS idx_solar_inst_installer ON solar_installations(installer_id);
CREATE INDEX IF NOT EXISTS idx_solar_inst_owner ON solar_installations(owner_id);
CREATE INDEX IF NOT EXISTS idx_solar_inst_date ON solar_installations(install_date);
CREATE INDEX IF NOT EXISTS idx_solar_inst_size ON solar_installations(capacity_dc_kw);
CREATE INDEX IF NOT EXISTS idx_solar_inst_location ON solar_installations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_solar_inst_source ON solar_installations(data_source_id, source_record_id);

-- Equipment
CREATE TABLE IF NOT EXISTS solar_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES solar_installations(id) ON DELETE CASCADE,
  equipment_type TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  quantity INTEGER DEFAULT 1,
  module_wattage_w DECIMAL(8, 2),
  module_technology TEXT,
  module_efficiency DECIMAL(5, 2),
  inverter_capacity_kw DECIMAL(10, 3),
  inverter_type TEXT,
  battery_capacity_kwh DECIMAL(12, 3),
  battery_chemistry TEXT,
  specs JSONB DEFAULT '{}',
  install_date DATE,
  warranty_expiry DATE,
  manufacture_year INTEGER,
  equipment_status TEXT DEFAULT 'active',
  data_source_id UUID REFERENCES solar_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solar_equip_installation ON solar_equipment(installation_id);
CREATE INDEX IF NOT EXISTS idx_solar_equip_type ON solar_equipment(equipment_type);
CREATE INDEX IF NOT EXISTS idx_solar_equip_manufacturer ON solar_equipment(manufacturer);
CREATE INDEX IF NOT EXISTS idx_solar_equip_model ON solar_equipment(model);
CREATE INDEX IF NOT EXISTS idx_solar_equip_status ON solar_equipment(equipment_status);

-- Site Events
CREATE TABLE IF NOT EXISTS solar_site_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES solar_installations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date DATE,
  description TEXT,
  old_capacity_kw DECIMAL(12, 3),
  new_capacity_kw DECIMAL(12, 3),
  equipment_changed JSONB,
  data_source_id UUID REFERENCES solar_data_sources(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solar_events_installation ON solar_site_events(installation_id);
CREATE INDEX IF NOT EXISTS idx_solar_events_type ON solar_site_events(event_type);
CREATE INDEX IF NOT EXISTS idx_solar_events_date ON solar_site_events(event_date);

-- Update triggers
CREATE OR REPLACE FUNCTION solar_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solar_installations_updated_at ON solar_installations;
CREATE TRIGGER solar_installations_updated_at
  BEFORE UPDATE ON solar_installations
  FOR EACH ROW EXECUTE FUNCTION solar_update_updated_at();

DROP TRIGGER IF EXISTS solar_equipment_updated_at ON solar_equipment;
CREATE TRIGGER solar_equipment_updated_at
  BEFORE UPDATE ON solar_equipment
  FOR EACH ROW EXECUTE FUNCTION solar_update_updated_at();

DROP TRIGGER IF EXISTS solar_installers_updated_at ON solar_installers;
CREATE TRIGGER solar_installers_updated_at
  BEFORE UPDATE ON solar_installers
  FOR EACH ROW EXECUTE FUNCTION solar_update_updated_at();

DROP TRIGGER IF EXISTS solar_site_owners_updated_at ON solar_site_owners;
CREATE TRIGGER solar_site_owners_updated_at
  BEFORE UPDATE ON solar_site_owners
  FOR EACH ROW EXECUTE FUNCTION solar_update_updated_at();

-- Auto-populate location from lat/lng
CREATE OR REPLACE FUNCTION solar_update_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solar_installations_location ON solar_installations;
CREATE TRIGGER solar_installations_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON solar_installations
  FOR EACH ROW EXECUTE FUNCTION solar_update_location();

-- Auto-calculate capacity_mw from capacity_ac_kw
CREATE OR REPLACE FUNCTION solar_update_capacity_mw()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.capacity_ac_kw IS NOT NULL AND NEW.capacity_mw IS NULL THEN
    NEW.capacity_mw = NEW.capacity_ac_kw / 1000.0;
  ELSIF NEW.capacity_dc_kw IS NOT NULL AND NEW.capacity_mw IS NULL AND NEW.capacity_ac_kw IS NULL THEN
    NEW.capacity_mw = NEW.capacity_dc_kw / 1000.0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solar_installations_capacity ON solar_installations;
CREATE TRIGGER solar_installations_capacity
  BEFORE INSERT OR UPDATE OF capacity_ac_kw, capacity_dc_kw ON solar_installations
  FOR EACH ROW EXECUTE FUNCTION solar_update_capacity_mw();

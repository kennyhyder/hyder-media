# Spec 001: Database Schema

## Overview

Create the PostgreSQL database schema for storing solar installation data with geospatial support.

## Feature Requirements

1. **Installations Table**: Store individual solar installations
2. **Installers Table**: Store installer/company information
3. **Data Sources Table**: Track where data came from
4. **Geospatial Support**: Enable location-based queries

## Database Schema

### Table: installations

```sql
CREATE TABLE installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Location
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  location GEOGRAPHY(POINT, 4326),  -- PostGIS
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip_code VARCHAR(10),
  county TEXT,

  -- System Details
  system_size_kw DECIMAL(10, 3),
  module_manufacturer TEXT,
  module_model TEXT,
  inverter_manufacturer TEXT,
  inverter_model TEXT,
  mount_type TEXT,  -- 'rooftop', 'ground', 'carport'
  tracking_type TEXT,  -- 'fixed', 'single-axis', 'dual-axis'

  -- Installation Info
  installer_id UUID REFERENCES installers(id),
  installer_name TEXT,  -- Denormalized for quick access
  install_date DATE,
  interconnection_date DATE,

  -- Pricing
  total_cost DECIMAL(12, 2),
  cost_per_watt DECIMAL(6, 3),

  -- Customer Type
  customer_segment TEXT,  -- 'residential', 'commercial', 'utility'

  -- Data Provenance
  data_source_id UUID REFERENCES data_sources(id),
  source_record_id TEXT,  -- Original ID from source

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_installations_state ON installations(state);
CREATE INDEX idx_installations_installer ON installations(installer_id);
CREATE INDEX idx_installations_date ON installations(install_date);
CREATE INDEX idx_installations_size ON installations(system_size_kw);
CREATE INDEX idx_installations_location ON installations USING GIST(location);
```

### Table: installers

```sql
CREATE TABLE installers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT,  -- Lowercase, standardized
  license_number TEXT,
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip_code VARCHAR(10),
  phone TEXT,
  website TEXT,
  installation_count INTEGER DEFAULT 0,
  total_capacity_kw DECIMAL(12, 3) DEFAULT 0,
  first_seen DATE,
  last_seen DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_installers_normalized ON installers(normalized_name, state);
```

### Table: data_sources

```sql
CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  url TEXT,
  last_import TIMESTAMPTZ,
  record_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Enable PostGIS

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Update Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER installations_updated_at
  BEFORE UPDATE ON installations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER installers_updated_at
  BEFORE UPDATE ON installers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## TypeScript Types

Create `src/types/installation.ts`:

```typescript
export interface Installation {
  id: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  system_size_kw: number | null;
  module_manufacturer: string | null;
  module_model: string | null;
  inverter_manufacturer: string | null;
  inverter_model: string | null;
  mount_type: string | null;
  tracking_type: string | null;
  installer_id: string | null;
  installer_name: string | null;
  install_date: string | null;
  interconnection_date: string | null;
  total_cost: number | null;
  cost_per_watt: number | null;
  customer_segment: string | null;
  data_source_id: string | null;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Installer {
  id: string;
  name: string;
  normalized_name: string | null;
  license_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  installation_count: number;
  total_capacity_kw: number;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface DataSource {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  last_import: string | null;
  record_count: number;
  created_at: string;
}
```

## Acceptance Criteria

- [ ] PostGIS extension enabled in Supabase
- [ ] `installations` table created with all columns
- [ ] `installers` table created
- [ ] `data_sources` table created
- [ ] All indexes created
- [ ] Update trigger functional
- [ ] TypeScript types exported from `src/types/installation.ts`
- [ ] Types match database schema exactly
- [ ] Can insert a test record and query it back

## Verification

```bash
# After running migrations, verify with:
npx supabase db dump --schema public | grep -c "CREATE TABLE"
# Should output: 3 (three tables)

# Verify PostGIS:
# Run in Supabase SQL editor:
# SELECT PostGIS_Version();
```

## Completion Signal

Output `<promise>DONE</promise>` when:
1. All tables exist in Supabase
2. TypeScript types are generated
3. A test insert/query succeeds

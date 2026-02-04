# Spec 002: Data Ingestion

## Overview

Create scripts to download and import solar installation data from free public sources.

## Feature Requirements

1. **Download Scripts**: Fetch data from each source
2. **Parsing**: Handle CSV/JSON formats with varying schemas
3. **Normalization**: Map source fields to unified schema
4. **Upsert Logic**: Handle updates without duplicates
5. **Progress Tracking**: Log import progress

## Data Source Mappings

### Tracking the Sun (LBNL)

**Download URL**: https://emp.lbl.gov/tracking-the-sun/
**Format**: CSV (~500MB)
**Records**: ~4.5 million

Field mapping:
```typescript
const TRACKING_THE_SUN_MAPPING = {
  // Location
  'State': 'state',
  'Zip Code': 'zip_code',
  'County': 'county',
  'Latitude': 'latitude',
  'Longitude': 'longitude',

  // System
  'System Size (kW DC)': 'system_size_kw',
  'Module Manufacturer': 'module_manufacturer',
  'Module Model': 'module_model',
  'Inverter Manufacturer': 'inverter_manufacturer',
  'Inverter Model': 'inverter_model',
  'Array Type': 'mount_type',
  'Tracking': 'tracking_type',

  // Installation
  'Installer Name': 'installer_name',
  'Installation Date': 'install_date',
  'Interconnection Date': 'interconnection_date',

  // Pricing
  'Total Installed Price': 'total_cost',
  'Price Per Watt': 'cost_per_watt',

  // Customer
  'Customer Segment': 'customer_segment',

  // Source tracking
  'Data Provider': 'source_record_id',
};
```

### USPVDB (USGS)

**API**: https://energy.usgs.gov/uspvdb/api/
**Format**: GeoJSON
**Records**: ~5,700 (large-scale only, ≥1 MW)

Field mapping:
```typescript
const USPVDB_MAPPING = {
  'p_state': 'state',
  'p_county': 'county',
  'p_name': 'installer_name',  // Actually facility name
  'p_cap_ac': 'system_size_kw',  // Convert MW to kW
  'p_tech': 'module_manufacturer',  // Technology type
  'p_year': 'install_date',  // Year only
  'p_axis': 'tracking_type',
  // Coordinates from geometry
};
```

### California DGStats

**Download**: https://www.californiadgstats.ca.gov/downloads/
**Format**: CSV
**Records**: ~2 million

Field mapping:
```typescript
const CA_DGSTATS_MAPPING = {
  'System Size AC (kW)': 'system_size_kw',
  'PV Module Manufacturer': 'module_manufacturer',
  'PV Module Model': 'module_model',
  'Inverter Manufacturer': 'inverter_manufacturer',
  'Inverter Model': 'inverter_model',
  'Zip': 'zip_code',
  'County': 'county',
  'Installer Name': 'installer_name',
  'Application Date': 'install_date',
  'Interconnection Date': 'interconnection_date',
};
```

## Implementation

### scripts/ingest-tracking-the-sun.ts

```typescript
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { parse } from 'csv-parse';
import path from 'path';

const BATCH_SIZE = 1000;
const DATA_SOURCE_NAME = 'tracking_the_sun';

async function ingestTrackingTheSun() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // Register data source
  const { data: source } = await supabase
    .from('data_sources')
    .upsert({
      name: DATA_SOURCE_NAME,
      description: 'Lawrence Berkeley National Laboratory Tracking the Sun',
      url: 'https://emp.lbl.gov/tracking-the-sun/',
    })
    .select()
    .single();

  const filePath = path.join(__dirname, '../data/tracking-the-sun.csv');
  const parser = fs.createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true })
  );

  let batch: any[] = [];
  let total = 0;

  for await (const row of parser) {
    const installation = mapToInstallation(row, source.id);
    if (installation) {
      batch.push(installation);
    }

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(supabase, batch);
      total += batch.length;
      console.log(`Imported ${total} records...`);
      batch = [];
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await insertBatch(supabase, batch);
    total += batch.length;
  }

  // Update source record count
  await supabase
    .from('data_sources')
    .update({ record_count: total, last_import: new Date().toISOString() })
    .eq('id', source.id);

  console.log(`Complete! Imported ${total} records.`);
}

function mapToInstallation(row: any, sourceId: string) {
  // Skip invalid records
  if (!row['State'] || !row['System Size (kW DC)']) {
    return null;
  }

  return {
    state: row['State']?.substring(0, 2).toUpperCase(),
    zip_code: row['Zip Code']?.substring(0, 10),
    county: row['County'],
    latitude: parseFloat(row['Latitude']) || null,
    longitude: parseFloat(row['Longitude']) || null,
    system_size_kw: parseFloat(row['System Size (kW DC)']) || null,
    module_manufacturer: row['Module Manufacturer'] || null,
    module_model: row['Module Model'] || null,
    inverter_manufacturer: row['Inverter Manufacturer'] || null,
    inverter_model: row['Inverter Model'] || null,
    mount_type: row['Array Type'] || null,
    tracking_type: row['Tracking'] || null,
    installer_name: row['Installer Name'] || null,
    install_date: parseDate(row['Installation Date']),
    interconnection_date: parseDate(row['Interconnection Date']),
    total_cost: parseFloat(row['Total Installed Price']) || null,
    cost_per_watt: parseFloat(row['Price Per Watt']) || null,
    customer_segment: row['Customer Segment'] || null,
    data_source_id: sourceId,
    source_record_id: `tts_${row['Data Provider']}_${row['System ID'] || Math.random()}`,
  };
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
}

async function insertBatch(supabase: any, batch: any[]) {
  const { error } = await supabase
    .from('installations')
    .upsert(batch, { onConflict: 'source_record_id' });

  if (error) {
    console.error('Batch insert error:', error);
    throw error;
  }
}

ingestTrackingTheSun().catch(console.error);
```

### scripts/verify-import.ts

```typescript
import { createClient } from '@supabase/supabase-js';

async function verifyImport() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // Count total installations
  const { count: totalCount } = await supabase
    .from('installations')
    .select('*', { count: 'exact', head: true });

  console.log(`Total installations: ${totalCount}`);

  // Count by state
  const { data: byState } = await supabase
    .from('installations')
    .select('state')
    .limit(10);

  // Count by data source
  const { data: sources } = await supabase
    .from('data_sources')
    .select('name, record_count, last_import');

  console.log('\nData sources:');
  sources?.forEach(s => {
    console.log(`  ${s.name}: ${s.record_count} records (last import: ${s.last_import})`);
  });

  // Verify minimum threshold
  if (totalCount && totalCount >= 100000) {
    console.log('\n✓ Verification passed: 100,000+ records imported');
    return true;
  } else {
    console.log('\n✗ Verification failed: Less than 100,000 records');
    return false;
  }
}

verifyImport();
```

## Acceptance Criteria

- [ ] `scripts/ingest-tracking-the-sun.ts` created and functional
- [ ] Script handles missing/malformed data gracefully
- [ ] Batch insert with 1000 records per batch
- [ ] Progress logging every 1000 records
- [ ] Data source record updated with count and timestamp
- [ ] `scripts/verify-import.ts` confirms 100,000+ records
- [ ] At least one test for the mapping function

## Verification

```bash
# Download data (manual step - file is ~500MB)
curl -o data/tracking-the-sun.csv "https://emp.lbl.gov/sites/default/files/TTS_LBNL_public_file_07-Dec-2024.csv"

# Run ingestion
npx ts-node scripts/ingest-tracking-the-sun.ts

# Verify
npx ts-node scripts/verify-import.ts
```

## Completion Signal

Output `<promise>DONE</promise>` when:
1. Ingestion script runs without errors
2. verify-import.ts shows 100,000+ records
3. Data sources table shows last_import timestamp

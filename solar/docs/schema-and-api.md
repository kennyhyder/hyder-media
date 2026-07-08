# SolarTrack — Database Schema + API Endpoints

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## Database Schema (Supabase PostgreSQL + PostGIS)

### Tables (all prefixed `solar_`)
- `solar_installations` - Core site data (41 columns: location, capacity, dates, type, owner/developer/operator/installer, location_precision, crossref_ids)
- `solar_equipment` - Panel, inverter, racking, battery records per installation (21 columns)
- `solar_site_owners` - Owner/developer/operator entities
- `solar_installers` - Installer companies with stats
- `solar_site_events` - Upgrades, repowers, maintenance, damage, recall records (columns: id, installation_id, event_type, event_date, description, old_capacity_kw, new_capacity_kw, equipment_changed, data_source_id, created_at. **NO event_subtype column!**)
- `solar_data_sources` - Provenance tracking

### Key Column Constraints
- `source_record_id`: UNIQUE - prevents duplicate records (prefixed: `uspvdb_`, `eia860_`, `tts3_`, `cadg_`, `nysun_`, `ilshines_`, `mapts_`)
- `installation_id`: FK to solar_installations on equipment and events
- `location`: PostGIS geometry for geospatial queries
- `location_precision`: TEXT enum ('exact', 'address', 'city', 'zip', 'county', 'state') - data quality flag
- `crossref_ids`: JSONB array of source_record_ids from other sources matching the same physical site

## API (Vercel Serverless Functions)
- `GET /api/solar/installations` - Paginated list with filters + geospatial search (near_lat/near_lng/radius_miles)
- `GET /api/solar/installation?id=X` - Single site with all equipment and events
- `GET /api/solar/equipment` - Search by manufacturer/model across all sites
- `GET /api/solar/installers` - Installer directory with portfolio stats
- `GET /api/solar/stats` - Aggregate statistics and market data
- `GET /api/solar/export` - CSV export of filtered results

### Geospatial Search Implementation
- Uses bounding box + Haversine distance calculation (no PostGIS RPC needed)
- API filters by lat/lng bounding box in Supabase, then calculates exact distances in JS
- Results include `distance_miles` field and are sorted by proximity
- Migration file exists at `supabase/migrations/20260206130000_solar_nearby_function.sql` for future PostGIS RPC upgrade


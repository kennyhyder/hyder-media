# SolarTrack — Script Gotchas (Critical)

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## Script Gotchas (Critical)

- **URL encoding**: Supabase REST params with spaces crash without `urllib.parse.quote(str(v), safe='.*,()')`
- **Batch size = 50**: All scripts use BATCH_SIZE = 50 for Supabase inserts
- **`Prefer: resolution=ignore-duplicates`**: Only works with PRIMARY KEY conflicts, NOT unique indexes. For `source_record_id` UNIQUE INDEX, query existing IDs before inserting (see `ingest-iso-spp-miso.py` pattern). Whole batch fails if any record has duplicate source_record_id.
- **safe_float()**: EIA Excel has empty strings/spaces in numeric fields - ALWAYS use try/except. Caused 5+ crashes.
- **Column names**: `site_type` NOT `installation_type`, `install_date` NOT `commission_date`, `mount_type` NOT `mounting_type`
- **data_sources table**: `name` column NOT `identifier`
- **TTS parallel**: Accepts `--states AZ CA NY` CLI args for parallel workers (27 states total)
- **Python -u flag**: Required for background scripts to show real-time output
- **CEC CSV**: Has 3 header rows (names, units, SAM fields) - skip 2 after DictReader
- **CA DGStats**: 269 columns, up to 8 module arrays and 64 inverter arrays per site
- **IL Shines**: NO equipment data at all
- **MA PTS**: Header at row 11, data row 12. Has manufacturer but NO model numbers
- **solar_site_events**: Has NO `event_subtype` or `source` column! Only: id, installation_id, event_type, event_date, description, old_capacity_kw, new_capacity_kw, equipment_changed, data_source_id, created_at
- **NOAA storms dedup**: Keep only worst event per installation per year per type (hail/wind), otherwise county-level matching creates millions of events


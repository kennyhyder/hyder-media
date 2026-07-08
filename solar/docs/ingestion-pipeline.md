# SolarTrack — How This Database Was Built (build order, dependencies, running all scripts)

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## How This Database Was Built

### Build Order (must follow this sequence)
1. **Create Supabase tables** - Run schema SQL from `specs/001-database-schema/spec.md` (all tables prefixed `solar_`)
2. **Register data sources** - Insert rows into `solar_data_sources` with name/url
3. **Run primary ingestion scripts** (any order, all idempotent via `source_record_id` UNIQUE constraint)
4. **Run enrichment scripts** (after primary ingestion, in order listed below)
5. **Build web interface** - Next.js app with API routes

### Python Dependencies
```bash
pip3 install python-dotenv openpyxl pyarrow

# For gridstatus ISO script (requires Python 3.10+):
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install gridstatus python-dotenv
```

### Running All Scripts
```bash
cd /Users/kennyhyder/Desktop/hyder-media/solar

# Primary ingestion (all idempotent - safe to re-run)
npx ts-node scripts/ingest-uspvdb.ts                    # USPVDB (TypeScript)
python3 -u scripts/ingest-eia860.py                     # EIA-860
python3 -u scripts/ingest-tts.py                        # TTS (all 27 states)
python3 -u scripts/ingest-tts.py --states CA NY AZ      # TTS (specific states, parallel OK)
python3 -u scripts/ingest-ca-dgstats.py                 # CA DGStats
python3 -u scripts/ingest-ny-sun.py                     # NY-Sun
python3 -u scripts/ingest-il-shines.py                  # IL Shines
python3 -u scripts/ingest-ma-pts.py                     # MA PTS

# Enrichment (run after primary ingestion)
python3 -u scripts/quick-wins.py                        # CdTe→First Solar, orphan cleanup
python3 -u scripts/set-location-precision.py            # Flag location quality + revert zip centroids
python3 -u scripts/enrich-eia860.py                     # Owner names + retirement events
python3 -u scripts/enrich-eia860-plant.py               # Operator names + generator events
python3 -u scripts/enrich-equipment-specs.py            # CEC module/inverter specs

# Location enrichment (run after primary enrichment)
python3 -u scripts/reverse-geocode.py                   # Nominatim reverse geocoding (~3.5hr)
python3 -u scripts/crossref-osm.py                      # OSM plant proximity matching
python3 -u scripts/crossref-tts-eia.py                  # Inherit EIA addresses for TTS/CA

# Additional enrichment (run after cross-references)
python3 -u scripts/enrich-egrid.py                       # EPA eGRID operator/owner names
python3 -u scripts/enrich-lbnl-queues.py                 # LBNL Queued Up developer names
python3 -u scripts/enrich-gem.py                         # GEM owner/operator names
python3 -u scripts/backfill-source-fields.py              # Recover owner/address/operator from source files
python3 -u scripts/enrich-wregis.py                       # WREGIS owner names (western US, 10,695 matches)
python3 -u scripts/enrich-wregis.py --dry-run             # Preview WREGIS matches
python3 -u scripts/enrich-wregis.py --skip-download       # Use existing Excel file

# Cross-source deduplication (run after all enrichment)
python3 -u scripts/crossref-dedup.py                    # Match records across sources, fill NULLs
python3 -u scripts/crossref-dedup.py --dry-run          # Preview matches without patching
python3 -u scripts/crossref-dedup.py --phase 1          # ID-based matching only

# Event enrichment (run after cross-references)
python3 -u scripts/enrich-noaa-storms.py                # NOAA storm events → site damage records (downloads 11yr data)
python3 -u scripts/enrich-noaa-storms.py --skip-download # Use existing downloaded CSVs
python3 -u scripts/enrich-noaa-storms.py --dry-run      # Preview matches without creating events
python3 -u scripts/enrich-cpsc-recalls.py               # CPSC equipment recalls → recall events
python3 -u scripts/enrich-cpsc-recalls.py --dry-run     # Preview recall matches

# Data source monitoring
python3 -u scripts/check-data-sources.py                # Check all 18 data sources for freshness/availability
python3 -u scripts/check-data-sources.py --json         # Save report to data/source_health_report.json

# Satellite imagery + mount type classification (requires Google Maps API key + droplet)
python3 -u scripts/fetch-satellite-images.py --location-precision exact   # Download satellite tiles (~$85, covered by free credit)
bash scripts/deploy-nrel-to-droplet.sh setup            # One-time droplet setup (conda + NREL model)
bash scripts/deploy-nrel-to-droplet.sh sync             # Rsync images + script to droplet
bash scripts/deploy-nrel-to-droplet.sh classify         # Start classification in screen session
bash scripts/deploy-nrel-to-droplet.sh status           # Check classification progress
```


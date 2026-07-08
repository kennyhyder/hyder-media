# SolarTrack — Regular Update Schedule

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## Regular Update Schedule

| Task | Frequency | Script | Download New? |
|------|-----------|--------|--------------|
| CA DGStats | Monthly | `ingest-ca-dgstats.py` | Yes - re-download ZIP |
| NY-Sun | Monthly | `ingest-ny-sun.py` | Yes - auto-downloads |
| CEC Specs | Monthly | `enrich-equipment-specs.py` | Yes - re-download CSVs |
| Geocoding | After ingestion | `geocode-zips.py` | No |
| USPVDB | Quarterly | `ingest-uspvdb.ts` | Yes - new GeoJSON |
| IL Shines | Quarterly | `ingest-il-shines.py` | Yes - manual download |
| MA PTS | Quarterly | `ingest-ma-pts.py` | Yes - manual download |
| EIA-860 | Annually (Sept) | `ingest-eia860.py` + enrichment | Yes - new ZIP |
| TTS | Annually | `ingest-tts.py` | Yes - new Parquet |

**Post-update enrichment order**: set-location-precision.py → enrich-equipment-specs.py → EIA enrichment scripts (only after annual EIA update) → reverse-geocode.py → crossref-osm.py → crossref-tts-eia.py → **crossref-dedup.py** (always run last)


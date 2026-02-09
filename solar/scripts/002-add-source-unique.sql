-- Add unique constraint on source_record_id for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS idx_solar_inst_source_unique
  ON solar_installations(source_record_id)
  WHERE source_record_id IS NOT NULL;

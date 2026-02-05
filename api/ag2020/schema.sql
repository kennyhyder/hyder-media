-- AG2020 Settings Table
-- Run this in Supabase SQL Editor to create the table for storing cash infusion selections

CREATE TABLE IF NOT EXISTS ag2020_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ag2020_settings_key ON ag2020_settings(key);

-- Initial row for cash infusions (optional - will be created automatically on first save)
INSERT INTO ag2020_settings (key, value, metadata)
VALUES ('cash_infusions', '{}', '{"selectedCount": 0, "totalAmount": 0}')
ON CONFLICT (key) DO NOTHING;

-- Grant permissions (adjust role as needed)
-- GRANT SELECT, INSERT, UPDATE ON ag2020_settings TO authenticated;
-- GRANT SELECT, INSERT, UPDATE ON ag2020_settings TO anon;

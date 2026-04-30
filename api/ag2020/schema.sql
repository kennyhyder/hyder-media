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

-- ============================================================================
-- VBC Call Logs (uploaded via CSV from bc.vonage.com)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ag2020_call_logs (
    id BIGSERIAL PRIMARY KEY,
    call_hash VARCHAR(64) UNIQUE NOT NULL,       -- sha256 of key fields for dedupe
    call_time TIMESTAMP WITH TIME ZONE NOT NULL,
    direction VARCHAR(20),                        -- 'inbound' | 'outbound' | 'internal'
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    extension VARCHAR(50),
    user_name VARCHAR(200),
    duration_seconds INTEGER DEFAULT 0,
    answered BOOLEAN DEFAULT FALSE,
    status VARCHAR(50),                           -- 'answered' | 'missed' | 'voicemail' | etc.
    raw_row JSONB,                                -- original CSV row for debugging
    upload_batch UUID NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_call_logs_time ON ag2020_call_logs(call_time DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_call_logs_batch ON ag2020_call_logs(upload_batch);
CREATE INDEX IF NOT EXISTS idx_ag2020_call_logs_direction ON ag2020_call_logs(direction);

-- Upload batches audit log (one row per CSV upload)
CREATE TABLE IF NOT EXISTS ag2020_call_log_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(500),
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    error_details JSONB,
    date_range_start DATE,
    date_range_end DATE,
    column_mapping JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_call_log_uploads_created ON ag2020_call_log_uploads(created_at DESC);

-- ============================================================================
-- Missed-call follow-ups (email-triggered: VBC sends an email when a call
-- is missed, an external parser POSTs to /api/ag2020/missed-call-webhook,
-- this row records the result).
-- ============================================================================
CREATE TABLE IF NOT EXISTS ag2020_missed_call_followups (
    id BIGSERIAL PRIMARY KEY,
    caller_number VARCHAR(50),
    caller_name VARCHAR(200),
    called_at TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- ActiveCampaign outcome
    ac_contact_id VARCHAR(50),
    ac_deal_id VARCHAR(50),
    ac_status VARCHAR(50),
    ac_error TEXT,
    -- Twilio SMS outcome
    sms_sent BOOLEAN DEFAULT FALSE,
    sms_sid VARCHAR(50),
    sms_status VARCHAR(50),
    sms_error TEXT,
    sms_body TEXT,
    -- Source/raw
    source VARCHAR(50),                  -- 'zapier', 'make', 'manual', 'mailgun', etc.
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_missed_call_followups_called ON ag2020_missed_call_followups(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_missed_call_followups_caller ON ag2020_missed_call_followups(caller_number);
CREATE INDEX IF NOT EXISTS idx_ag2020_missed_call_followups_received ON ag2020_missed_call_followups(received_at DESC);

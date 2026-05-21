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

-- ============================================================================
-- Call Triage Queue: every inbound call (missed + answered) lands here.
-- Agents triage from the dashboard, deciding which AC pipeline + tags +
-- notes to apply. Submitting creates an AC deal and marks the row processed.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ag2020_call_queue (
    id BIGSERIAL PRIMARY KEY,
    call_hash VARCHAR(64) UNIQUE NOT NULL,           -- dedupe (caller+timestamp+duration)
    caller_number VARCHAR(50),
    caller_name VARCHAR(200),
    called_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Call attributes
    answered BOOLEAN NOT NULL DEFAULT FALSE,
    answered_by_extension VARCHAR(50),
    answered_by_user VARCHAR(200),
    ring_duration_seconds INTEGER,
    direction VARCHAR(20) DEFAULT 'inbound',
    -- Source/raw
    source VARCHAR(50),
    raw_payload JSONB,
    -- Auto SMS for missed calls (sent at intake time)
    auto_sms_sent BOOLEAN DEFAULT FALSE,
    auto_sms_sid VARCHAR(50),
    auto_sms_status VARCHAR(50),
    auto_sms_error TEXT,
    -- Triage outcome (set when an agent acts on the row)
    triaged_at TIMESTAMP WITH TIME ZONE,
    triaged_by VARCHAR(200),                          -- which agent did the triage (cookie name)
    triage_action VARCHAR(20),                        -- 'deal_created' | 'spam' | 'skip'
    triage_tags TEXT[],                               -- AC tag IDs applied
    triage_pipeline_id VARCHAR(50),                   -- which AC pipeline (group ID)
    triage_stage_id VARCHAR(50),                      -- which AC stage
    triage_owner_id VARCHAR(50),                      -- which AC user owns the deal
    triage_notes TEXT,
    triage_ac_contact_id VARCHAR(50),                 -- created/found AC contact
    triage_ac_deal_id VARCHAR(50),                    -- created AC deal
    triage_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_call_queue_called ON ag2020_call_queue(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_call_queue_pending ON ag2020_call_queue(triaged_at, called_at DESC) WHERE triaged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ag2020_call_queue_caller ON ag2020_call_queue(caller_number);

-- ============================================================================
-- Autodial / speed-to-lead: when a lead arrives (web form submit, or later a
-- missed call via CallRail), Twilio places an outbound call to the customer.
-- When the customer answers we bridge them to AG2020's inbound rep line.
-- One row per dial attempt; Twilio StatusCallbacks update it through the call.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ag2020_autodial_attempts (
    id BIGSERIAL PRIMARY KEY,
    customer_number VARCHAR(20) NOT NULL,
    customer_name VARCHAR(200),
    source VARCHAR(50) NOT NULL DEFAULT 'form_submit',  -- form_submit | missed_call | manual
    ac_contact_id VARCHAR(50),
    trigger_payload JSONB,
    -- Lifecycle status:
    --  deferred          queued (arrived outside business hours), awaits the cron
    --  dialing           Twilio call placed, ringing the customer
    --  customer_answered customer picked up
    --  machine           answering machine / voicemail detected, no bridge
    --  bridged           rep answered, customer + rep connected
    --  no_answer         customer never picked up
    --  rep_no_answer     customer answered but no rep picked up the inbound line
    --  failed            Twilio error placing or running the call
    --  skipped_duplicate same customer dialed too recently
    --  completed         call finished (terminal; see bridge_status for outcome)
    status VARCHAR(30) NOT NULL DEFAULT 'dialing',
    dial_after TIMESTAMP WITH TIME ZONE,                -- set for deferred rows
    -- Twilio call detail
    twilio_call_sid VARCHAR(50),
    answered_by VARCHAR(30),                            -- AMD result: human | machine_* | unknown
    customer_call_status VARCHAR(30),                   -- last StatusCallback CallStatus
    customer_call_duration INTEGER,
    bridge_status VARCHAR(30),                          -- <Dial> DialCallStatus: completed|no-answer|busy|failed
    bridge_duration INTEGER,                            -- seconds rep+customer were connected
    rep_number VARCHAR(20),
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_autodial_created ON ag2020_autodial_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_autodial_number ON ag2020_autodial_attempts(customer_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_autodial_deferred ON ag2020_autodial_attempts(dial_after) WHERE status = 'deferred';
CREATE INDEX IF NOT EXISTS idx_ag2020_autodial_sid ON ag2020_autodial_attempts(twilio_call_sid);

-- Dunham & Jones — Change History Storage
-- Run this in the Supabase SQL Editor before using the sync endpoint
-- Table: dunham_change_history

CREATE TABLE IF NOT EXISTS dunham_change_history (
    id TEXT PRIMARY KEY,                      -- change_event.resource_name (unique per event)
    change_date_time TIMESTAMPTZ NOT NULL,
    resource_type TEXT NOT NULL,
    operation TEXT NOT NULL,
    user_email TEXT,
    client_type TEXT,
    campaign_name TEXT,
    ad_group_name TEXT,
    changed_fields TEXT[],
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dunham_changes_date
    ON dunham_change_history(change_date_time DESC);

CREATE INDEX IF NOT EXISTS idx_dunham_changes_year
    ON dunham_change_history(date_trunc('year', change_date_time));

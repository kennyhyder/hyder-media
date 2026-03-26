-- Meta Ads OAuth Connections
-- Run this in Supabase SQL editor before using the Meta Ads integration

CREATE TABLE meta_ads_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_user_id TEXT NOT NULL UNIQUE,
    name TEXT,
    access_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

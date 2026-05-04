-- TikTok Ads OAuth Connections
-- Run this in Supabase SQL editor before using the TikTok Ads integration

CREATE TABLE IF NOT EXISTS tiktok_ads_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tiktok_user_id TEXT NOT NULL UNIQUE,
    name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    advertiser_ids JSONB DEFAULT '[]'::jsonb,
    scope JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cache for TikTok Ads API responses (parallels meta_ads_cache)
CREATE TABLE IF NOT EXISTS tiktok_ads_cache (
    cache_key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW()
);

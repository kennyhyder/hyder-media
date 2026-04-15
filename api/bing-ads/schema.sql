-- Bing Ads (Microsoft Advertising) — Connection Storage
-- Run this in the Supabase SQL Editor before using the OAuth flow

CREATE TABLE IF NOT EXISTS bing_ads_connections (
    id SERIAL PRIMARY KEY,
    microsoft_user_id TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ NOT NULL,
    account_id BIGINT,              -- Numeric Account ID (needed for API calls)
    account_number TEXT,            -- Display number (e.g., C449285895)
    account_name TEXT,
    customer_id BIGINT,             -- Numeric Customer ID (needed for API calls)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

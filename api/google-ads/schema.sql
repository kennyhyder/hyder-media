-- Google Ads Integration Schema for Supabase
-- Run this in your Supabase SQL Editor

-- ============================================
-- Google Ads Connected Accounts
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- OAuth tokens (encrypted in production)
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,

    -- Account info
    email TEXT,
    login_customer_id TEXT, -- MCC account ID

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    sync_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Google Ads Customer Accounts
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES google_ads_connections(id) ON DELETE CASCADE,

    customer_id TEXT NOT NULL, -- Google Ads customer ID (no dashes)
    descriptive_name TEXT,
    currency_code TEXT,
    time_zone TEXT,

    -- Account type
    is_manager BOOLEAN DEFAULT false,
    manager_customer_id TEXT, -- Parent MCC if applicable

    -- Status
    status TEXT, -- ENABLED, CANCELED, SUSPENDED, etc.
    is_syncing BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(connection_id, customer_id)
);

-- ============================================
-- Campaigns
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES google_ads_accounts(id) ON DELETE CASCADE,

    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT, -- ENABLED, PAUSED, REMOVED

    -- Campaign settings
    advertising_channel_type TEXT, -- SEARCH, DISPLAY, SHOPPING, VIDEO, etc.
    bidding_strategy_type TEXT,
    budget_amount_micros BIGINT,

    -- Targeting
    target_cpa_micros BIGINT,
    target_roas NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(account_id, campaign_id)
);

-- ============================================
-- Campaign Performance (Daily Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_campaign_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES google_ads_campaigns(id) ON DELETE CASCADE,

    date DATE NOT NULL,

    -- Core metrics
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    cost_micros BIGINT DEFAULT 0, -- Cost in micros (divide by 1,000,000)

    -- Conversions
    conversions NUMERIC DEFAULT 0,
    conversions_value NUMERIC DEFAULT 0,
    all_conversions NUMERIC DEFAULT 0,
    all_conversions_value NUMERIC DEFAULT 0,

    -- Engagement
    interactions BIGINT DEFAULT 0,
    engagements BIGINT DEFAULT 0,

    -- Video (if applicable)
    video_views BIGINT DEFAULT 0,
    video_quartile_p100_rate NUMERIC,

    -- Calculated (stored for convenience)
    ctr NUMERIC GENERATED ALWAYS AS (
        CASE WHEN impressions > 0 THEN clicks::NUMERIC / impressions ELSE 0 END
    ) STORED,
    avg_cpc_micros NUMERIC GENERATED ALWAYS AS (
        CASE WHEN clicks > 0 THEN cost_micros::NUMERIC / clicks ELSE 0 END
    ) STORED,
    cost_per_conversion NUMERIC GENERATED ALWAYS AS (
        CASE WHEN conversions > 0 THEN cost_micros::NUMERIC / 1000000 / conversions ELSE 0 END
    ) STORED,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(campaign_id, date)
);

-- ============================================
-- Ad Groups
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_ad_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES google_ads_campaigns(id) ON DELETE CASCADE,

    ad_group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT,
    type TEXT, -- SEARCH_STANDARD, DISPLAY_STANDARD, etc.

    -- Bidding
    cpc_bid_micros BIGINT,
    cpm_bid_micros BIGINT,
    target_cpa_micros BIGINT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(campaign_id, ad_group_id)
);

-- ============================================
-- Ad Group Performance (Daily Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_ad_group_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_group_id UUID REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,

    date DATE NOT NULL,

    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    cost_micros BIGINT DEFAULT 0,
    conversions NUMERIC DEFAULT 0,
    conversions_value NUMERIC DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_group_id, date)
);

-- ============================================
-- Keywords
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_group_id UUID REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,

    criterion_id TEXT NOT NULL,
    keyword_text TEXT NOT NULL,
    match_type TEXT, -- EXACT, PHRASE, BROAD
    status TEXT,

    -- Quality metrics
    quality_score INTEGER,
    creative_quality_score TEXT,
    landing_page_experience TEXT,
    expected_ctr TEXT,

    -- Bidding
    cpc_bid_micros BIGINT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(ad_group_id, criterion_id)
);

-- ============================================
-- Keyword Performance (Daily Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_keyword_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id UUID REFERENCES google_ads_keywords(id) ON DELETE CASCADE,

    date DATE NOT NULL,

    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    cost_micros BIGINT DEFAULT 0,
    conversions NUMERIC DEFAULT 0,
    conversions_value NUMERIC DEFAULT 0,

    -- Position metrics
    average_position NUMERIC, -- Deprecated but may still have data
    top_impression_percentage NUMERIC,
    absolute_top_impression_percentage NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(keyword_id, date)
);

-- ============================================
-- Search Terms
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_search_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES google_ads_accounts(id) ON DELETE CASCADE,

    search_term TEXT NOT NULL,
    campaign_id TEXT,
    ad_group_id TEXT,
    keyword_text TEXT,
    match_type TEXT,

    date DATE NOT NULL,

    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    cost_micros BIGINT DEFAULT 0,
    conversions NUMERIC DEFAULT 0,
    conversions_value NUMERIC DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Index for faster lookups
    UNIQUE(account_id, search_term, date, campaign_id, ad_group_id)
);

-- ============================================
-- Sync Log
-- ============================================
CREATE TABLE IF NOT EXISTS google_ads_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES google_ads_accounts(id) ON DELETE CASCADE,

    sync_type TEXT NOT NULL, -- FULL, INCREMENTAL, CAMPAIGNS, KEYWORDS, etc.
    status TEXT NOT NULL, -- STARTED, COMPLETED, FAILED

    records_synced INTEGER DEFAULT 0,
    date_range_start DATE,
    date_range_end DATE,

    error_message TEXT,
    duration_ms INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_date ON google_ads_campaign_metrics(date);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_campaign ON google_ads_campaign_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_group_metrics_date ON google_ads_ad_group_metrics(date);
CREATE INDEX IF NOT EXISTS idx_keyword_metrics_date ON google_ads_keyword_metrics(date);
CREATE INDEX IF NOT EXISTS idx_search_terms_date ON google_ads_search_terms(date);
CREATE INDEX IF NOT EXISTS idx_search_terms_term ON google_ads_search_terms(search_term);

-- ============================================
-- Row Level Security
-- ============================================

-- Enable RLS
ALTER TABLE google_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_ad_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_ad_group_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_keyword_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_search_terms ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only see their own data
CREATE POLICY "Users can view own connections" ON google_ads_connections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own connections" ON google_ads_connections
    FOR ALL USING (auth.uid() = user_id);

-- Accounts policy (through connection)
CREATE POLICY "Users can view own accounts" ON google_ads_accounts
    FOR SELECT USING (
        connection_id IN (
            SELECT id FROM google_ads_connections WHERE user_id = auth.uid()
        )
    );

-- Similar policies for other tables (cascade through relationships)
-- Note: For simplicity, you may want to use service key for sync operations
-- and only apply RLS for dashboard read operations

-- ============================================
-- Helper Functions
-- ============================================

-- Function to get total spend for a date range
CREATE OR REPLACE FUNCTION get_account_spend(
    p_account_id UUID,
    p_start_date DATE,
    p_end_date DATE
) RETURNS NUMERIC AS $$
    SELECT COALESCE(SUM(cost_micros), 0) / 1000000.0
    FROM google_ads_campaign_metrics m
    JOIN google_ads_campaigns c ON m.campaign_id = c.id
    WHERE c.account_id = p_account_id
    AND m.date BETWEEN p_start_date AND p_end_date;
$$ LANGUAGE SQL STABLE;

-- Function to get conversion summary
CREATE OR REPLACE FUNCTION get_conversion_summary(
    p_account_id UUID,
    p_start_date DATE,
    p_end_date DATE
) RETURNS TABLE (
    total_conversions NUMERIC,
    total_value NUMERIC,
    total_cost NUMERIC,
    cpa NUMERIC,
    roas NUMERIC
) AS $$
    SELECT
        COALESCE(SUM(conversions), 0) as total_conversions,
        COALESCE(SUM(conversions_value), 0) as total_value,
        COALESCE(SUM(cost_micros), 0) / 1000000.0 as total_cost,
        CASE
            WHEN SUM(conversions) > 0
            THEN (SUM(cost_micros) / 1000000.0) / SUM(conversions)
            ELSE 0
        END as cpa,
        CASE
            WHEN SUM(cost_micros) > 0
            THEN SUM(conversions_value) / (SUM(cost_micros) / 1000000.0)
            ELSE 0
        END as roas
    FROM google_ads_campaign_metrics m
    JOIN google_ads_campaigns c ON m.campaign_id = c.id
    WHERE c.account_id = p_account_id
    AND m.date BETWEEN p_start_date AND p_end_date;
$$ LANGUAGE SQL STABLE;

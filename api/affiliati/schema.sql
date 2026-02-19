-- Affiliati Clinical Trial Intelligence Platform
-- Run this in your Supabase SQL Editor

-- ============================================
-- Offers (cached from CAKE API)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- CAKE API fields
    offer_id INTEGER NOT NULL UNIQUE,
    campaign_id INTEGER,
    offer_name TEXT NOT NULL,
    vertical_name TEXT,
    status TEXT,

    -- Payout
    payout NUMERIC,
    price_format TEXT,

    -- Content
    description TEXT,
    restrictions TEXT,
    preview_link TEXT,
    allowed_media_types TEXT[],

    -- AI-extracted fields (populated by enrich-offer)
    condition_name TEXT,
    condition_keywords TEXT[],
    min_age INTEGER,
    max_age INTEGER,
    gender TEXT,
    qualifications TEXT[],
    exclusions TEXT[],
    compliance_notes TEXT,

    -- Raw data
    raw_data JSONB,
    is_active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Trial Matches (ClinicalTrials.gov links)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_trial_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    offer_id INTEGER NOT NULL REFERENCES affiliati_offers(offer_id) ON DELETE CASCADE,
    nct_id TEXT NOT NULL,

    -- Study info
    study_title TEXT,
    brief_summary TEXT,
    sponsor TEXT,
    phase TEXT,
    enrollment_count INTEGER,

    -- Match metadata
    match_type TEXT NOT NULL DEFAULT 'auto', -- 'auto' or 'manual'
    match_score INTEGER DEFAULT 0,           -- 0-100
    match_reason TEXT,

    -- Location summary
    location_count INTEGER DEFAULT 0,
    states TEXT[],

    -- Status
    is_verified BOOLEAN DEFAULT false,
    is_dismissed BOOLEAN DEFAULT false,
    raw_data JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(offer_id, nct_id)
);

-- ============================================
-- Trial Locations (for geo-targeting)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_trial_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    match_id UUID NOT NULL REFERENCES affiliati_trial_matches(id) ON DELETE CASCADE,
    nct_id TEXT NOT NULL,

    facility_name TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT DEFAULT 'United States',

    latitude NUMERIC,
    longitude NUMERIC,
    recruitment_status TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Ad Units (AI-generated breakdowns)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_ad_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    offer_id INTEGER NOT NULL REFERENCES affiliati_offers(offer_id) ON DELETE CASCADE,
    version INTEGER DEFAULT 1,
    generation_model TEXT,

    -- Structured ad data
    persona JSONB,
    geo_targeting JSONB,
    screening_flow JSONB,
    ad_copy JSONB,         -- { headlines[], primary_text[], descriptions[], ctas[] }
    video_scripts JSONB,
    compliance_notes JSONB,

    status TEXT DEFAULT 'draft', -- 'draft', 'reviewed', 'approved'

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Sync Log (audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sync_type TEXT NOT NULL, -- 'offers', 'enrich', 'match', 'ad_unit'
    status TEXT NOT NULL,    -- 'started', 'completed', 'failed'

    records_processed INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,

    error_message TEXT,
    duration_ms INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- ============================================
-- Alerts (notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS affiliati_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    alert_type TEXT NOT NULL, -- 'new_offer', 'new_match', 'high_score_match', 'sync_error'
    offer_id INTEGER REFERENCES affiliati_offers(offer_id) ON DELETE SET NULL,

    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_affiliati_offers_active ON affiliati_offers(is_active);
CREATE INDEX IF NOT EXISTS idx_affiliati_offers_condition ON affiliati_offers(condition_name);
CREATE INDEX IF NOT EXISTS idx_affiliati_trial_matches_offer ON affiliati_trial_matches(offer_id);
CREATE INDEX IF NOT EXISTS idx_affiliati_trial_matches_nct ON affiliati_trial_matches(nct_id);
CREATE INDEX IF NOT EXISTS idx_affiliati_trial_matches_score ON affiliati_trial_matches(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_affiliati_trial_locations_match ON affiliati_trial_locations(match_id);
CREATE INDEX IF NOT EXISTS idx_affiliati_trial_locations_state ON affiliati_trial_locations(state);
CREATE INDEX IF NOT EXISTS idx_affiliati_ad_units_offer ON affiliati_ad_units(offer_id);
CREATE INDEX IF NOT EXISTS idx_affiliati_alerts_unread ON affiliati_alerts(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_affiliati_sync_log_type ON affiliati_sync_log(sync_type, created_at DESC);

-- ============================================================================
-- AG2020 Lead-Attribution Platform — Phase 1 schema
--
-- See docs/lead-attribution-platform-plan.md for the full design rationale.
-- All tables include `tenant_id` (defaults to 'ag2020') so the engine is
-- multi-tenant-shaped from day one — Phase 3 extraction to AutomateDojo is a
-- `WHERE tenant_id = ?` exercise, not a rewrite.
--
-- Run this in the Supabase SQL Editor for project ilbovwnhrowvxjdkvrln.
-- Safe to re-run (CREATE … IF NOT EXISTS everywhere).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ag2020_lead_journey: one row per lead per tenant. Phone is the universal
-- join key; email is the secondary key when phone is missing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ag2020_lead_journey (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL DEFAULT 'ag2020',

    -- Universal identity
    phone VARCHAR(20),
    phone_normalized VARCHAR(20),
    email VARCHAR(320),
    email_normalized VARCHAR(320),

    -- First-touch attribution (set once, immutable)
    first_touch_at TIMESTAMP WITH TIME ZONE NOT NULL,
    first_touch_source VARCHAR(50) NOT NULL,
        -- google_paid | meta_paid | organic | referral | direct
        -- | call_inbound | sms_inbound | manual | unknown
    first_touch_channel VARCHAR(100),
    first_touch_campaign VARCHAR(200),
    first_touch_ad_group VARCHAR(200),
    first_touch_keyword TEXT,
    first_touch_url TEXT,
    first_touch_utm JSONB,
    first_touch_gclid VARCHAR(200),
    first_touch_fbclid VARCHAR(200),

    -- Last-touch (multi-touch attribution support)
    last_touch_at TIMESTAMP WITH TIME ZONE,
    last_touch_source VARCHAR(50),

    -- Linked external IDs
    ac_contact_id VARCHAR(50),
    ac_deal_id VARCHAR(50),
    ac_pipeline_id VARCHAR(50),
    ac_stage_id VARCHAR(50),
    callrail_contact_id VARCHAR(50),
    crm_customer_id VARCHAR(100),
    crm_job_ids TEXT[],
    crm_invoice_ids TEXT[],

    -- State machine
    journey_state VARCHAR(30) NOT NULL DEFAULT 'new',
        -- new | contacted | spoke | quoted | won | lost | completed | dormant

    -- Financial outcome (denormalized for dashboard speed)
    revenue_total NUMERIC(12, 2) DEFAULT 0,
    cogs_total NUMERIC(12, 2) DEFAULT 0,
    margin_total NUMERIC(12, 2) DEFAULT 0,

    -- Allocated acquisition cost (back-allocated at journey close)
    ad_spend_attributed NUMERIC(12, 2),

    -- Audit
    raw_first_touch JSONB,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ag2020_lead_journey_tenant_phone
    ON ag2020_lead_journey(tenant_id, phone_normalized)
    WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ag2020_lead_journey_tenant_email
    ON ag2020_lead_journey(tenant_id, email_normalized)
    WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ag2020_lead_journey_tenant_first_touch
    ON ag2020_lead_journey(tenant_id, first_touch_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_lead_journey_tenant_source
    ON ag2020_lead_journey(tenant_id, first_touch_source, first_touch_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_lead_journey_state
    ON ag2020_lead_journey(tenant_id, journey_state)
    WHERE journey_state NOT IN ('completed', 'lost');

-- ----------------------------------------------------------------------------
-- ag2020_lead_touchpoints: per-event log. One row per discrete touchpoint
-- (ad click, form submit, call leg, SMS, AC tag, CRM job event, …).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ag2020_lead_touchpoints (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL DEFAULT 'ag2020',
    journey_id BIGINT REFERENCES ag2020_lead_journey(id),
    touchpoint_at TIMESTAMP WITH TIME ZONE NOT NULL,
    touchpoint_type VARCHAR(40) NOT NULL,
        -- ad_click | form_submit | call_inbound | call_outbound
        -- | call_missed | call_voicemail | sms_inbound | sms_outbound
        -- | ac_tag_added | ac_deal_stage_change | quote_sent
        -- | job_created | invoice_sent | invoice_paid | job_completed
    source VARCHAR(50),                        -- google_paid | meta_paid | …
    channel VARCHAR(100),
    direction VARCHAR(20),                     -- inbound | outbound | n/a
    payload JSONB,                             -- type-specific (call SID, AC event, etc.)
    revenue_cents BIGINT,                      -- if monetary
    duration_seconds INTEGER,                  -- if call
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ag2020_lead_touchpoints_journey
    ON ag2020_lead_touchpoints(tenant_id, journey_id, touchpoint_at DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_lead_touchpoints_type_date
    ON ag2020_lead_touchpoints(tenant_id, touchpoint_type, touchpoint_at DESC);

-- ----------------------------------------------------------------------------
-- ag2020_crm_jobs: GlassBiller (or any CRM) job mirror, populated via the
-- XLSX/CSV adapter. Generic shape so the same table serves other CRMs in
-- Phase 3 (AccuLynx, JobNimbus, ServiceTitan, MindBody, Spark Membership…).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ag2020_crm_jobs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL DEFAULT 'ag2020',
    source_system VARCHAR(50) NOT NULL,        -- glassbiller | acculynx | …
    source_job_id VARCHAR(100) NOT NULL,       -- upstream job/invoice id
    journey_id BIGINT REFERENCES ag2020_lead_journey(id),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(20),
    customer_phone_normalized VARCHAR(20),
    customer_email VARCHAR(320),
    customer_email_normalized VARCHAR(320),
    location_name VARCHAR(200),                -- GlassBiller's "Location Name"
                                               -- (e.g. "JESSE GOOGLE")
    job_status VARCHAR(50),
    invoice_number VARCHAR(50),
    invoice_date DATE,
    invoice_amount NUMERIC(12, 2),
    cogs_amount NUMERIC(12, 2),
    margin_amount NUMERIC(12, 2),
    rebate_amount NUMERIC(12, 2),
    paid_at TIMESTAMP WITH TIME ZONE,
    payment_method VARCHAR(50),
    raw_row JSONB,                             -- the source row for re-ingest / debug
    upload_batch UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, source_system, source_job_id)
);

CREATE INDEX IF NOT EXISTS idx_ag2020_crm_jobs_journey
    ON ag2020_crm_jobs(tenant_id, journey_id);
CREATE INDEX IF NOT EXISTS idx_ag2020_crm_jobs_phone
    ON ag2020_crm_jobs(tenant_id, customer_phone_normalized, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_crm_jobs_email
    ON ag2020_crm_jobs(tenant_id, customer_email_normalized, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ag2020_crm_jobs_date
    ON ag2020_crm_jobs(tenant_id, invoice_date DESC);

-- ----------------------------------------------------------------------------
-- ag2020_ad_spend_daily: daily campaign cost rollups from Google Ads, Meta
-- Ads, (eventually) TikTok, Bing, etc. Used for cost back-allocation to
-- journeys via the daily attribution rollup cron.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ag2020_ad_spend_daily (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL DEFAULT 'ag2020',
    platform VARCHAR(30) NOT NULL,             -- google_ads | meta_ads | …
    account_id VARCHAR(50) NOT NULL,
    campaign_id VARCHAR(100),
    campaign_name VARCHAR(300),
    ad_group_id VARCHAR(100),
    ad_group_name VARCHAR(300),
    date DATE NOT NULL,
    spend NUMERIC(12, 2) DEFAULT 0,
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    conversions NUMERIC(12, 2) DEFAULT 0,
    raw JSONB,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ag2020_ad_spend_unique
    ON ag2020_ad_spend_daily(
        tenant_id, platform, account_id,
        COALESCE(campaign_id, ''), COALESCE(ad_group_id, ''), date
    );
CREATE INDEX IF NOT EXISTS idx_ag2020_ad_spend_tenant_date
    ON ag2020_ad_spend_daily(tenant_id, date DESC, platform);

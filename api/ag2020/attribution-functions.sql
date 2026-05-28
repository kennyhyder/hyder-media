-- ============================================================================
-- AG2020 Lead-Attribution — Postgres functions
--
-- Run this in the Supabase SQL Editor (project ilbovwnhrowvxjdkvrln) AFTER
-- attribution-schema.sql. Safe to re-run (CREATE OR REPLACE).
--
-- Why functions? The naive JS linker is N+1 queries (one per unlinked job →
-- minutes for thousands of rows). A single SQL UPDATE...FROM does the same
-- work in milliseconds.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ag2020_link_crm_jobs_to_journeys
--
-- Link any crm_jobs rows that have no journey_id to a lead_journey by
-- normalized phone (preferred), falling back to normalized email. Single
-- statement per match path. Returns counts. Idempotent — safe to call after
-- every ingest or on a cron.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ag2020_link_crm_jobs_to_journeys(
    p_tenant_id VARCHAR DEFAULT 'ag2020'
)
RETURNS TABLE (
    linked_by_phone BIGINT,
    linked_by_email BIGINT,
    still_unlinked BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_phone_linked BIGINT := 0;
    v_email_linked BIGINT := 0;
    v_still_unlinked BIGINT := 0;
BEGIN
    -- Phone match (preferred)
    WITH phone_match AS (
        UPDATE ag2020_crm_jobs j
        SET journey_id = lj.id,
            updated_at = NOW()
        FROM ag2020_lead_journey lj
        WHERE j.tenant_id = p_tenant_id
          AND j.journey_id IS NULL
          AND j.customer_phone_normalized IS NOT NULL
          AND lj.tenant_id = p_tenant_id
          AND lj.phone_normalized = j.customer_phone_normalized
        RETURNING j.id
    )
    SELECT COUNT(*) INTO v_phone_linked FROM phone_match;

    -- Email fallback for still-unlinked
    WITH email_match AS (
        UPDATE ag2020_crm_jobs j
        SET journey_id = lj.id,
            updated_at = NOW()
        FROM ag2020_lead_journey lj
        WHERE j.tenant_id = p_tenant_id
          AND j.journey_id IS NULL
          AND j.customer_email_normalized IS NOT NULL
          AND lj.tenant_id = p_tenant_id
          AND lj.email_normalized = j.customer_email_normalized
        RETURNING j.id
    )
    SELECT COUNT(*) INTO v_email_linked FROM email_match;

    -- Remaining unlinked
    SELECT COUNT(*) INTO v_still_unlinked
    FROM ag2020_crm_jobs
    WHERE tenant_id = p_tenant_id AND journey_id IS NULL;

    RETURN QUERY SELECT v_phone_linked, v_email_linked, v_still_unlinked;
END;
$$;

-- ----------------------------------------------------------------------------
-- ag2020_rollup_journey_financials
--
-- Recompute `revenue_total`, `cogs_total`, `margin_total` on every journey
-- from its linked crm_jobs. Run after every ingest + on the daily attribution
-- rollup cron.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- ag2020_revenue_by_source_window
--
-- Sum revenue/margin/cogs from CRM jobs INVOICED in a date window, attributed
-- back to the journey's first_touch_source. This is what powers the
-- Attribution dashboard's date-windowed view — when you change "last 30 days"
-- to "last 90 days", these numbers move.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ag2020_revenue_by_source_window(
    p_tenant_id VARCHAR DEFAULT 'ag2020',
    p_start DATE DEFAULT (NOW() - INTERVAL '30 days')::date,
    p_end DATE DEFAULT NOW()::date
)
RETURNS TABLE (
    first_touch_source VARCHAR,
    first_touch_channel VARCHAR,
    jobs BIGINT,
    journeys BIGINT,
    revenue NUMERIC,
    margin NUMERIC,
    cogs NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(j.first_touch_source, 'unknown')::VARCHAR AS first_touch_source,
        j.first_touch_channel::VARCHAR AS first_touch_channel,
        COUNT(c.id)::BIGINT AS jobs,
        COUNT(DISTINCT j.id)::BIGINT AS journeys,
        SUM(COALESCE(c.invoice_amount, 0))::NUMERIC AS revenue,
        SUM(COALESCE(c.margin_amount, 0))::NUMERIC AS margin,
        SUM(COALESCE(c.cogs_amount, 0))::NUMERIC AS cogs
    FROM ag2020_crm_jobs c
    JOIN ag2020_lead_journey j ON j.id = c.journey_id
    WHERE c.tenant_id = p_tenant_id
      AND j.tenant_id = p_tenant_id
      AND c.invoice_date BETWEEN p_start AND p_end
    GROUP BY j.first_touch_source, j.first_touch_channel
    ORDER BY revenue DESC;
END;
$$;

CREATE OR REPLACE FUNCTION ag2020_rollup_journey_financials(
    p_tenant_id VARCHAR DEFAULT 'ag2020'
)
RETURNS TABLE (journeys_updated BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT := 0;
BEGIN
    WITH agg AS (
        SELECT
            journey_id,
            SUM(COALESCE(invoice_amount, 0)) AS revenue,
            SUM(COALESCE(cogs_amount, 0)) AS cogs,
            SUM(COALESCE(margin_amount, 0)) AS margin,
            ARRAY_AGG(DISTINCT source_job_id) AS job_ids,
            MAX(paid_at) AS last_paid_at
        FROM ag2020_crm_jobs
        WHERE tenant_id = p_tenant_id AND journey_id IS NOT NULL
        GROUP BY journey_id
    ),
    upd AS (
        UPDATE ag2020_lead_journey lj
        SET revenue_total = agg.revenue,
            cogs_total = agg.cogs,
            margin_total = agg.margin,
            crm_job_ids = agg.job_ids,
            journey_state = CASE
                WHEN agg.last_paid_at IS NOT NULL THEN 'completed'
                ELSE lj.journey_state
            END,
            updated_at = NOW()
        FROM agg
        WHERE lj.id = agg.journey_id
          AND lj.tenant_id = p_tenant_id
        RETURNING lj.id
    )
    SELECT COUNT(*) INTO v_count FROM upd;
    RETURN QUERY SELECT v_count;
END;
$$;

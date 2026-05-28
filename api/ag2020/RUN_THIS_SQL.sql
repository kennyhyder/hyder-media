-- ============================================================================
-- One-time: enables the date-windowed revenue view on the Attribution tab.
-- Run in Supabase SQL Editor (project ilbovwnhrowvxjdkvrln). Idempotent.
-- ============================================================================

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
        COALESCE(j.first_touch_source, 'unknown')::VARCHAR,
        j.first_touch_channel::VARCHAR,
        COUNT(c.id)::BIGINT,
        COUNT(DISTINCT j.id)::BIGINT,
        SUM(COALESCE(c.invoice_amount, 0))::NUMERIC,
        SUM(COALESCE(c.margin_amount, 0))::NUMERIC,
        SUM(COALESCE(c.cogs_amount, 0))::NUMERIC
    FROM ag2020_crm_jobs c
    JOIN ag2020_lead_journey j ON j.id = c.journey_id
    WHERE c.tenant_id = p_tenant_id
      AND j.tenant_id = p_tenant_id
      AND c.invoice_date BETWEEN p_start AND p_end
    GROUP BY j.first_touch_source, j.first_touch_channel
    ORDER BY SUM(COALESCE(c.invoice_amount, 0)) DESC;
END;
$$;

-- Quick smoke test (should return rows):
SELECT * FROM ag2020_revenue_by_source_window('ag2020', '2025-01-01', CURRENT_DATE);

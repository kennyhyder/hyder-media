-- ============================================================================
-- One-time: bulk-link RPC that accepts parallel arrays of (job_id, journey_id)
-- and does a single UPDATE...FROM unnest — fast enough to link 50k jobs in
-- ~3-5 seconds (vs 60+ minutes with one PostgREST call per journey).
--
-- Also bumps the original link RPC's statement_timeout so the big
-- UPDATE...JOIN doesn't time out at 8s (the AG2020 backfill scaled past it).
--
-- Run in Supabase SQL Editor (project ilbovwnhrowvxjdkvrln). Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION ag2020_bulk_link_jobs(
    p_tenant_id VARCHAR,
    p_job_ids   BIGINT[],
    p_journey_ids BIGINT[]
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT := 0;
BEGIN
    IF array_length(p_job_ids, 1) <> array_length(p_journey_ids, 1) THEN
        RAISE EXCEPTION 'job_ids and journey_ids must be same length';
    END IF;

    WITH pairs AS (
        SELECT UNNEST(p_job_ids) AS job_id, UNNEST(p_journey_ids) AS journey_id
    ),
    upd AS (
        UPDATE ag2020_crm_jobs c
        SET journey_id = p.journey_id,
            updated_at = NOW()
        FROM pairs p
        WHERE c.id = p.job_id
          AND c.tenant_id = p_tenant_id
          AND c.journey_id IS NULL
        RETURNING c.id
    )
    SELECT COUNT(*) INTO v_count FROM upd;
    RETURN v_count;
END;
$$;

-- Bump the timeout on the original linker RPC so the big JOIN approach
-- also works after future bulk imports.
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
    -- Allow this function up to 5 minutes (default is 8 seconds)
    PERFORM set_config('statement_timeout', '300000', true);

    WITH phone_match AS (
        UPDATE ag2020_crm_jobs j
        SET journey_id = lj.id, updated_at = NOW()
        FROM ag2020_lead_journey lj
        WHERE j.tenant_id = p_tenant_id
          AND j.journey_id IS NULL
          AND j.customer_phone_normalized IS NOT NULL
          AND lj.tenant_id = p_tenant_id
          AND lj.phone_normalized = j.customer_phone_normalized
        RETURNING j.id
    )
    SELECT COUNT(*) INTO v_phone_linked FROM phone_match;

    WITH email_match AS (
        UPDATE ag2020_crm_jobs j
        SET journey_id = lj.id, updated_at = NOW()
        FROM ag2020_lead_journey lj
        WHERE j.tenant_id = p_tenant_id
          AND j.journey_id IS NULL
          AND j.customer_email_normalized IS NOT NULL
          AND lj.tenant_id = p_tenant_id
          AND lj.email_normalized = j.customer_email_normalized
        RETURNING j.id
    )
    SELECT COUNT(*) INTO v_email_linked FROM email_match;

    SELECT COUNT(*) INTO v_still_unlinked
    FROM ag2020_crm_jobs
    WHERE tenant_id = p_tenant_id AND journey_id IS NULL;

    RETURN QUERY SELECT v_phone_linked, v_email_linked, v_still_unlinked;
END;
$$;

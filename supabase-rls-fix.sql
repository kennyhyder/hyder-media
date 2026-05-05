-- =========================================================================
-- Hyder Media — RLS Lockdown
--
-- Enables Row Level Security on every user table in the public schema.
-- After this runs:
--   - anon  role (publicly visible key) → ZERO access to any user table
--   - service_role (Vercel serverless functions) → full access (bypasses RLS)
--   - authenticated users (via Supabase Auth) → ZERO access (no policies)
--
-- This is safe because every dashboard in this repo proxies through
-- /api/** serverless functions that use SUPABASE_SERVICE_KEY. No client-side
-- code reads from these tables directly.
--
-- PostGIS internal tables are skipped — they're metadata, no sensitive data,
-- and PostGIS can break if you mess with them.
-- =========================================================================

-- ---------- Enable RLS ----------
DO $$
DECLARE
    r record;
    skip_tables text[] := ARRAY['spatial_ref_sys', 'geography_columns', 'geometry_columns'];
    enabled int := 0;
BEGIN
    FOR r IN
        SELECT n.nspname AS schemaname, c.relname AS tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity = false
          AND NOT (c.relname = ANY(skip_tables))
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
        RAISE NOTICE 'RLS enabled: %.%', r.schemaname, r.tablename;
        enabled := enabled + 1;
    END LOOP;
    RAISE NOTICE 'Total tables locked down: %', enabled;
END $$;

-- ---------- Drop any pre-existing permissive policies ----------
-- Some Supabase templates create FOR-ALL or anon-readable policies. We
-- nuke them so RLS = genuinely closed by default.
DO $$
DECLARE
    p record;
    dropped int := 0;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                       p.policyname, p.schemaname, p.tablename);
        RAISE NOTICE 'Dropped policy: %.% / %',
                     p.schemaname, p.tablename, p.policyname;
        dropped := dropped + 1;
    END LOOP;
    RAISE NOTICE 'Total policies removed: %', dropped;
END $$;

-- ---------- Verify ----------
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies p
       WHERE p.schemaname = n.nspname
         AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname NOT IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns')
ORDER BY c.relrowsecurity ASC, c.relname;
-- Expectation: every row shows rls_enabled = true and policy_count = 0.

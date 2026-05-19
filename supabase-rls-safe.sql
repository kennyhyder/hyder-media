-- =========================================================================
-- Supabase RLS Lockdown — SAFE / IDEMPOTENT version
--
-- Enables Row Level Security on every public-schema user table that doesn't
-- already have it. UNLIKE supabase-rls-fix.sql (May 5), this script does NOT
-- drop existing policies — safe to run on projects that rely on auth-based
-- RLS (sportsbookish, automatedojo, etc.).
--
-- After this runs:
--   - any table with no policies        → no anon/auth access (locked)
--   - any table WITH policies           → continues to honor them
--   - service_role (Vercel + admin)     → unchanged (always bypasses RLS)
--
-- Skips PostGIS metadata tables (they break if you touch them).
-- =========================================================================

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
          AND c.relkind = 'r'                  -- ordinary tables only
          AND c.relrowsecurity = false         -- only those without RLS
          AND NOT (c.relname = ANY(skip_tables))
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
        RAISE NOTICE 'RLS enabled: %.%', r.schemaname, r.tablename;
        enabled := enabled + 1;
    END LOOP;
    RAISE NOTICE 'Total tables newly locked: %', enabled;
END $$;

-- ---------- Verify ----------
-- Each row: table name, RLS state, existing policy count.
-- Expectation: every row shows rls_enabled = true. Tables that legitimately
-- need anon/auth access should also show policy_count > 0.
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

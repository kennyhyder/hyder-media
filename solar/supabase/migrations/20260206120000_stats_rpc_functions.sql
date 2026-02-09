-- RPC functions for solar stats aggregation
-- These are used by /api/solar/stats.js to avoid the 1000-row PostgREST default limit

-- Count installations by state (top 50)
CREATE OR REPLACE FUNCTION solar_count_by_state()
RETURNS TABLE(state TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT state, COUNT(*) as count
  FROM solar_installations
  WHERE state IS NOT NULL
  GROUP BY state
  ORDER BY count DESC
  LIMIT 50;
$$;

-- Count installations by site type
CREATE OR REPLACE FUNCTION solar_count_by_type()
RETURNS TABLE(site_type TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT site_type, COUNT(*) as count
  FROM solar_installations
  WHERE site_type IS NOT NULL
  GROUP BY site_type
  ORDER BY count DESC;
$$;

-- Sum total capacity in MW
CREATE OR REPLACE FUNCTION solar_total_capacity()
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(SUM(capacity_mw), 0)
  FROM solar_installations;
$$;

-- Count equipment by technology type
CREATE OR REPLACE FUNCTION solar_count_by_technology()
RETURNS TABLE(module_technology TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT module_technology, COUNT(*) as count
  FROM solar_equipment
  WHERE equipment_type = 'module'
    AND module_technology IS NOT NULL
  GROUP BY module_technology
  ORDER BY count DESC
  LIMIT 20;
$$;

-- Count installations by age bracket
CREATE OR REPLACE FUNCTION solar_count_by_age()
RETURNS TABLE(bracket TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  WITH ages AS (
    SELECT EXTRACT(YEAR FROM AGE(CURRENT_DATE, install_date)) as age_years
    FROM solar_installations
    WHERE install_date IS NOT NULL
  )
  SELECT 'over_10_years' as bracket, COUNT(*) as count FROM ages WHERE age_years >= 10
  UNION ALL
  SELECT 'over_15_years', COUNT(*) FROM ages WHERE age_years >= 15
  UNION ALL
  SELECT 'over_20_years', COUNT(*) FROM ages WHERE age_years >= 20;
$$;

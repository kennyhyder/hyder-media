-- GridScout Demo Token System
-- Tables + RPC function for rate-limited demo access

-- Demo tokens table
CREATE TABLE IF NOT EXISTS grid_demo_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  hourly_limit INTEGER DEFAULT 60,
  daily_limit INTEGER DEFAULT 200,
  lifetime_limit INTEGER DEFAULT 500,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Demo usage tracking table
CREATE TABLE IF NOT EXISTS grid_demo_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL REFERENCES grid_demo_tokens(token),
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grid_demo_usage_token ON grid_demo_usage(token);
CREATE INDEX IF NOT EXISTS idx_grid_demo_usage_used_at ON grid_demo_usage(used_at);

-- RPC function to atomically increment usage and return counts
CREATE OR REPLACE FUNCTION increment_grid_demo_usage(p_token TEXT)
RETURNS TABLE(hourly_total BIGINT, daily_total BIGINT, lifetime_total BIGINT) AS $$
BEGIN
  -- Insert usage record
  INSERT INTO grid_demo_usage (token) VALUES (p_token);

  -- Return current counts
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM grid_demo_usage WHERE token = p_token AND used_at > NOW() - INTERVAL '1 hour') AS hourly_total,
    (SELECT COUNT(*) FROM grid_demo_usage WHERE token = p_token AND used_at > NOW() - INTERVAL '1 day') AS daily_total,
    (SELECT COUNT(*) FROM grid_demo_usage WHERE token = p_token) AS lifetime_total;
END;
$$ LANGUAGE plpgsql;

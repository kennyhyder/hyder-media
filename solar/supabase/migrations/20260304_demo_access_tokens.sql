-- Demo access tokens for SolarTrack
-- Allows sharing limited-access demo links with potential clients

CREATE TABLE IF NOT EXISTS solar_demo_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  daily_limit INTEGER DEFAULT 200,
  hourly_limit INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solar_demo_usage (
  token TEXT NOT NULL,
  date DATE NOT NULL,
  hour INTEGER NOT NULL,
  request_count INTEGER DEFAULT 0,
  PRIMARY KEY (token, date, hour)
);

-- Atomic rate limit counter
CREATE OR REPLACE FUNCTION increment_demo_usage(p_token TEXT)
RETURNS TABLE(daily_total INTEGER, hourly_total INTEGER) AS $$
DECLARE
  v_date DATE := CURRENT_DATE;
  v_hour INTEGER := EXTRACT(HOUR FROM NOW());
  v_hourly INTEGER;
  v_daily INTEGER;
BEGIN
  INSERT INTO solar_demo_usage (token, date, hour, request_count)
  VALUES (p_token, v_date, v_hour, 1)
  ON CONFLICT (token, date, hour)
  DO UPDATE SET request_count = solar_demo_usage.request_count + 1;

  SELECT request_count INTO v_hourly
  FROM solar_demo_usage WHERE token = p_token AND date = v_date AND hour = v_hour;

  SELECT COALESCE(SUM(request_count), 0) INTO v_daily
  FROM solar_demo_usage WHERE token = p_token AND date = v_date;

  RETURN QUERY SELECT v_daily, v_hourly;
END;
$$ LANGUAGE plpgsql;

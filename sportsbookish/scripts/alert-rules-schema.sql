-- Per-user alert rules. Each rule is a filter (scope + thresholds) plus
-- delivery channels. When the data-plane cron fires a new alert, the
-- dispatcher matches it against every enabled rule and queues a delivery
-- to the rule's owner.

CREATE TABLE IF NOT EXISTS sb_alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  name            TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,

  -- Scope (NULL or empty = match anything in that dimension)
  sports          TEXT[],          -- 'golf' | 'basketball' | 'baseball' | 'hockey' | 'soccer'
  leagues         TEXT[],          -- 'pga' | 'nba' | 'mlb' | 'nhl' | 'epl' | 'mls'
  alert_types     TEXT[],          -- 'movement' | 'edge_buy' | 'edge_sell'
  direction       TEXT,            -- 'up' | 'down' | NULL = both

  -- Thresholds (logical AND)
  min_delta       NUMERIC NOT NULL DEFAULT 0.03 CHECK (min_delta > 0 AND min_delta <= 1),
  min_kalshi_prob NUMERIC,         -- only fire when Kalshi prob >= X (e.g. ignore tiny prices)
  max_kalshi_prob NUMERIC,         -- only fire when Kalshi prob <= X

  -- Delivery
  channels        TEXT[] NOT NULL DEFAULT ARRAY['email'],  -- 'email' | 'sms'

  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fired_at   TIMESTAMPTZ,
  fire_count      INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sb_alert_rules_user_enabled ON sb_alert_rules(user_id, enabled);

-- Delivery records (dedup + audit). Unique on (rule, alert) so the dispatcher
-- can be idempotent.
CREATE TABLE IF NOT EXISTS sb_alert_dispatches (
  id              BIGSERIAL PRIMARY KEY,
  rule_id         UUID NOT NULL REFERENCES sb_alert_rules(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  alert_source    TEXT NOT NULL,    -- 'golf' | 'sports'
  alert_id        TEXT NOT NULL,    -- string so we can hold either bigint or uuid
  channels        TEXT[] NOT NULL,
  email_status    TEXT,             -- 'sent' | 'failed' | NULL (not attempted)
  sms_status      TEXT,
  error           TEXT,
  snapshot        JSONB,            -- the alert payload at dispatch time
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, alert_source, alert_id)
);
CREATE INDEX IF NOT EXISTS idx_sb_alert_dispatches_user ON sb_alert_dispatches(user_id, dispatched_at DESC);

-- Update updated_at automatically
CREATE OR REPLACE FUNCTION sb_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sb_alert_rules_updated_at ON sb_alert_rules;
CREATE TRIGGER sb_alert_rules_updated_at BEFORE UPDATE ON sb_alert_rules
  FOR EACH ROW EXECUTE FUNCTION sb_set_updated_at();

-- RLS
ALTER TABLE sb_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_alert_dispatches ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own rules
DROP POLICY IF EXISTS sb_alert_rules_select_own ON sb_alert_rules;
CREATE POLICY sb_alert_rules_select_own ON sb_alert_rules FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS sb_alert_rules_insert_own ON sb_alert_rules;
CREATE POLICY sb_alert_rules_insert_own ON sb_alert_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS sb_alert_rules_update_own ON sb_alert_rules;
CREATE POLICY sb_alert_rules_update_own ON sb_alert_rules FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS sb_alert_rules_delete_own ON sb_alert_rules;
CREATE POLICY sb_alert_rules_delete_own ON sb_alert_rules FOR DELETE USING (auth.uid() = user_id);

-- Users can read their own dispatch history; only service role writes
DROP POLICY IF EXISTS sb_alert_dispatches_select_own ON sb_alert_dispatches;
CREATE POLICY sb_alert_dispatches_select_own ON sb_alert_dispatches FOR SELECT USING (auth.uid() = user_id);

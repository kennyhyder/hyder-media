-- Email drip + behavior-tracking schema. Append to existing schema; idempotent.

-- ============================================================
-- 1. Behavior tracking
-- ============================================================
--
-- Every meaningful action a user takes goes here. The drip cron reads
-- this to (a) trigger behavior-conditional emails and (b) populate
-- dynamic "noticed you did X" copy blocks inside scheduled emails.
--
-- Schema is intentionally narrow: high-cardinality JSON props go in
-- `props`, low-cardinality dims (sport, market_type) get their own
-- columns for fast aggregation.

CREATE TABLE IF NOT EXISTS sb_user_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name    TEXT NOT NULL,
  -- common dims pulled out for speed
  sport         TEXT,
  market_type   TEXT,
  -- arbitrary detail
  props         JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_user_events_user_event ON sb_user_events (user_id, event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_user_events_created ON sb_user_events (created_at DESC);

-- Canonical event names — keep this list documented. Track-event helper
-- emits these:
--   signup, login, page_view, event_view, league_view, contestant_view,
--   positive_ev_view, movers_view, pricing_view, sportsbooks_view,
--   subscription_started, subscription_canceled, paywall_hit,
--   bet_logged, alert_created, preference_changed, settings_view

-- ============================================================
-- 2. Email send log + sequence state
-- ============================================================
--
-- One row per email we send. The cron checks this to ensure idempotency
-- (never send the same `key` twice) and to compute "how many days since
-- last contact" for cadence pacing.

CREATE TABLE IF NOT EXISTS sb_email_sends (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Stable identifier per email type ("welcome_d0", "behavior_paywall_hit",
  -- "winback_d30", etc). NEVER reuse across email content changes — if
  -- copy changes meaningfully, bump the key.
  email_key       TEXT NOT NULL,
  -- Resend message id (used for webhook reconciliation / opens / clicks)
  resend_id       TEXT,
  -- Materialized snapshots so we can debug retroactively
  subject         TEXT,
  to_email        TEXT,
  -- Lifecycle
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  complained_at   TIMESTAMPTZ,
  -- Idempotency key — (user_id, email_key) is unique. Welcome series
  -- emails fire once per user; behavior-triggered emails may use
  -- (user_id, email_key, date_bucket) via custom keys instead.
  CONSTRAINT sb_email_sends_user_key_uniq UNIQUE (user_id, email_key)
);

CREATE INDEX IF NOT EXISTS idx_sb_email_sends_user ON sb_email_sends (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_email_sends_resend ON sb_email_sends (resend_id) WHERE resend_id IS NOT NULL;

-- ============================================================
-- 3. Per-user subscription state for marketing emails
-- ============================================================
--
-- Transactional emails (receipts, password reset) always send.
-- Marketing/drip emails respect this flag + the granular preferences.
-- One row per user; auto-created on first email-send attempt.

CREATE TABLE IF NOT EXISTS sb_email_preferences (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unsubscribed_all        BOOLEAN NOT NULL DEFAULT false,
  unsubscribed_at         TIMESTAMPTZ,
  -- Granular: each can be flipped without unsubscribing entirely
  marketing_drip          BOOLEAN NOT NULL DEFAULT true,
  product_updates         BOOLEAN NOT NULL DEFAULT true,
  daily_digest            BOOLEAN NOT NULL DEFAULT true,
  movement_alerts         BOOLEAN NOT NULL DEFAULT true,
  -- One-click unsubscribe token (rotates on unsubscribe to prevent replay)
  unsub_token             TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_email_preferences_token ON sb_email_preferences (unsub_token);

-- ============================================================
-- 4. RLS — service-role-only (cron writes; user reads own row only)
-- ============================================================

ALTER TABLE sb_user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_email_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_user_events_read_own ON sb_user_events;
CREATE POLICY sb_user_events_read_own ON sb_user_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_email_sends_read_own ON sb_email_sends;
CREATE POLICY sb_email_sends_read_own ON sb_email_sends FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_email_preferences_read_own ON sb_email_preferences;
CREATE POLICY sb_email_preferences_read_own ON sb_email_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_email_preferences_update_own ON sb_email_preferences;
CREATE POLICY sb_email_preferences_update_own ON sb_email_preferences FOR UPDATE
  USING (auth.uid() = user_id);

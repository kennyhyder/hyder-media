-- Twitter auto-reply system tables. Append to existing schema; idempotent.
-- These are separate from sb_social_posts (which tracks our outbound original
-- posts via Make.com). The auto-reply path goes directly to Twitter API v2 so
-- it doesn't consume Make ops.

-- Accounts whose timeline we watch + may reply to.
-- Seeded by scripts/twitter-seed-targets.sql.
CREATE TABLE IF NOT EXISTS sb_twitter_targets (
  twitter_id      TEXT PRIMARY KEY,    -- numeric ID as string (BIGINT overflows JSON)
  handle          TEXT NOT NULL UNIQUE,
  category        TEXT,                -- 'kalshi' | 'sharp_analytics' | 'line_movement' | 'quant' | 'media' | 'friends'
  added_at        TIMESTAMPTZ DEFAULT now(),
  active          BOOLEAN DEFAULT true,
  blocklist       BOOLEAN DEFAULT false,  -- never reply (e.g. brands we shouldn't tag)
  follower_count  INTEGER,
  notes           TEXT,
  -- Engagement governance
  last_replied_at TIMESTAMPTZ,
  replies_total   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sb_twitter_targets_active ON sb_twitter_targets (active) WHERE active = true;

-- Tweets we've fetched from the targets' timelines.
CREATE TABLE IF NOT EXISTS sb_twitter_seen (
  tweet_id          TEXT PRIMARY KEY,
  author_id         TEXT NOT NULL REFERENCES sb_twitter_targets(twitter_id) ON DELETE CASCADE,
  author_handle     TEXT,
  text              TEXT,
  created_at        TIMESTAMPTZ,
  has_media         BOOLEAN DEFAULT false,
  media_urls        TEXT[],
  is_reply          BOOLEAN DEFAULT false,
  is_quote          BOOLEAN DEFAULT false,
  fetched_at        TIMESTAMPTZ DEFAULT now(),

  -- Processing state
  processed_at      TIMESTAMPTZ,
  reply_status      TEXT,               -- null=unprocessed, 'queued','posted','skipped:<reason>','failed'
  skip_reason       TEXT,

  -- Claude analysis output
  parsed_legs       JSONB,              -- [{player, stat, line, american_odds, book}, ...]
  reply_text        TEXT,
  reply_confidence NUMERIC(3,2),       -- 0.00–1.00
  reply_reasoning   TEXT,               -- internal: why this reply / what fact

  -- Posted reply tracking
  reply_tweet_id    TEXT,               -- the tweet WE posted as a reply
  posted_at         TIMESTAMPTZ,
  twitter_error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sb_twitter_seen_author_created ON sb_twitter_seen (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_twitter_seen_unprocessed ON sb_twitter_seen (created_at DESC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sb_twitter_seen_posted ON sb_twitter_seen (posted_at DESC) WHERE posted_at IS NOT NULL;

-- Per-day per-account rate limits (config)
CREATE TABLE IF NOT EXISTS sb_twitter_rate_config (
  k         TEXT PRIMARY KEY,
  v_int     INTEGER,
  v_text    TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO sb_twitter_rate_config (k, v_int) VALUES
  ('max_replies_per_day', 8),
  ('min_hours_between_replies_same_account', 24),
  ('min_confidence_to_post', 70),  -- stored as int 0-100, divide by 100 in code
  ('min_reply_length_chars', 60),
  ('timeline_lookback_minutes', 90)
ON CONFLICT (k) DO NOTHING;

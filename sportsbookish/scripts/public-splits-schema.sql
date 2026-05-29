-- Public betting splits — % of bets / % of handle on each side of a market.
-- Sourced from public splits feeds (Action Network public-betting page,
-- VSiN, Sports Insights free pages). Used to surface contrarian /
-- sharp-side fade signals on every event.

CREATE TABLE IF NOT EXISTS sb_public_splits (
  id                  BIGSERIAL PRIMARY KEY,
  -- Link to our event (denormalized for survival of source deletions)
  sports_event_id     UUID REFERENCES sports_events(id) ON DELETE CASCADE,
  league              TEXT NOT NULL,
  event_title         TEXT,
  market_type         TEXT NOT NULL,           -- 'moneyline' | 'spread' | 'total'
  side                TEXT NOT NULL,           -- contestant name OR 'over'/'under'
  -- The data
  tickets_pct         INTEGER,                 -- 0..100 = % of bets on this side
  handle_pct          INTEGER,                 -- 0..100 = % of $$ on this side
  -- Provenance
  source              TEXT NOT NULL,           -- 'action_network','vsin','sportsinsights'
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: one row per (source, event, market, side, day)
  CONSTRAINT sb_public_splits_uniq UNIQUE (source, sports_event_id, market_type, side, (date_trunc('day', fetched_at)))
);

CREATE INDEX IF NOT EXISTS idx_sb_public_splits_event ON sb_public_splits (sports_event_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_public_splits_fresh ON sb_public_splits (fetched_at DESC);

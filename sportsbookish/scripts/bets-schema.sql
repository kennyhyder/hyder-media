-- Bet tracker tables. Append to existing schema; idempotent.

CREATE TABLE IF NOT EXISTS sb_bets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What was bet
  market_label            TEXT NOT NULL,        -- "Lakers ML", "Schwarber 2+ TB", etc
  event_title             TEXT,
  -- Link to canonical event/market if known (denormalized to survive event deletion)
  sports_event_id         UUID,
  sports_market_id        UUID,
  league                  TEXT,
  market_type             TEXT,                 -- 'h2h','spread','total','prop','outrights','winner'
  contestant_label        TEXT,
  -- Where + at what price
  book                    TEXT NOT NULL,        -- 'draftkings', 'kalshi', 'polymarket', etc.
  line_american           INTEGER,              -- e.g. -120, +185
  line_implied_prob       NUMERIC(6,5),         -- 0..1 implied from American (raw, not no-vig)
  user_stated_prob        NUMERIC(6,5),         -- optional: user's own probability estimate (for Brier)
  -- Sizing
  stake_units             NUMERIC(10,2) NOT NULL DEFAULT 1.0,
  unit_size_usd           NUMERIC(10,2),        -- bankroll unit size (display only)
  -- Outcome
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','won','lost','push','void','cashed_out')),
  profit_units            NUMERIC(10,3),        -- net units won/lost (negative for lost)
  cashed_out_amount       NUMERIC(10,2),
  -- CLV — captured by cron-capture-clv just before event start
  closing_implied_prob    NUMERIC(6,5),
  closing_book            TEXT,                 -- which book the closing line came from
  clv                     NUMERIC(7,5),         -- closing_implied_prob - line_implied_prob
  -- Timestamps
  placed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at               TIMESTAMPTZ,          -- when settlement was recorded
  notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sb_bets_user_placed ON sb_bets (user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_bets_pending_event ON sb_bets (sports_event_id, status) WHERE status = 'pending' AND sports_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sb_bets_needs_clv ON sb_bets (placed_at) WHERE closing_implied_prob IS NULL AND sports_market_id IS NOT NULL;

-- RLS — Elite users read + write their own bets only
ALTER TABLE sb_bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_bets_user_select ON sb_bets;
CREATE POLICY sb_bets_user_select ON sb_bets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_bets_user_insert ON sb_bets;
CREATE POLICY sb_bets_user_insert ON sb_bets FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_bets_user_update ON sb_bets;
CREATE POLICY sb_bets_user_update ON sb_bets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_bets_user_delete ON sb_bets;
CREATE POLICY sb_bets_user_delete ON sb_bets FOR DELETE USING (auth.uid() = user_id);

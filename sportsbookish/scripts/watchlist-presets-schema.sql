-- Watchlist: bookmarked teams/players/events. Free + Pro + Elite can all bookmark;
-- Elite gets the extra "watchlist_only" smart preset that filters alerts
-- to only watchlist matches.

CREATE TABLE IF NOT EXISTS sb_watchlist (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('team', 'player', 'event', 'tournament')),
  ref_id      TEXT NOT NULL,                  -- contestant_id, player_id, or event_id
  label       TEXT NOT NULL,                  -- display name
  league      TEXT,                           -- 'nba', 'pga', etc.
  source      TEXT NOT NULL DEFAULT 'sports', -- 'sports' or 'golf'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, ref_id, source)
);
CREATE INDEX IF NOT EXISTS idx_sb_watchlist_user ON sb_watchlist(user_id);

ALTER TABLE sb_watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sb_watchlist_select_own ON sb_watchlist;
CREATE POLICY sb_watchlist_select_own ON sb_watchlist FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS sb_watchlist_insert_own ON sb_watchlist;
CREATE POLICY sb_watchlist_insert_own ON sb_watchlist FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS sb_watchlist_delete_own ON sb_watchlist;
CREATE POLICY sb_watchlist_delete_own ON sb_watchlist FOR DELETE USING (auth.uid() = user_id);

-- Smart preset support on alert rules
ALTER TABLE sb_alert_rules ADD COLUMN IF NOT EXISTS preset_key TEXT;
ALTER TABLE sb_alert_rules ADD COLUMN IF NOT EXISTS watchlist_only BOOLEAN NOT NULL DEFAULT FALSE;

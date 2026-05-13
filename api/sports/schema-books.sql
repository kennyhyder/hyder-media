-- Sportsbook overlay tables for non-golf sports.
-- Books come from The Odds API (https://the-odds-api.com).
-- These join onto sports_events / sports_markets at read time so we don't
-- have to change the existing Kalshi ingest path.

CREATE TABLE IF NOT EXISTS sports_book_events_map (
  id              BIGSERIAL PRIMARY KEY,
  league          TEXT NOT NULL,
  sport_key       TEXT NOT NULL,                  -- 'basketball_nba'
  odds_api_event_id TEXT NOT NULL UNIQUE,
  sports_event_id UUID REFERENCES sports_events(id) ON DELETE SET NULL,
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  home_team_norm  TEXT NOT NULL,
  away_team_norm  TEXT NOT NULL,
  commence_time   TIMESTAMPTZ,
  matched_at      TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sbem_sports_event ON sports_book_events_map(sports_event_id);
CREATE INDEX IF NOT EXISTS idx_sbem_commence    ON sports_book_events_map(commence_time);
CREATE INDEX IF NOT EXISTS idx_sbem_league      ON sports_book_events_map(league);

CREATE TABLE IF NOT EXISTS sports_book_quotes (
  id                BIGSERIAL PRIMARY KEY,
  sports_event_id   UUID REFERENCES sports_events(id) ON DELETE CASCADE,
  odds_api_event_id TEXT NOT NULL,
  league            TEXT NOT NULL,
  contestant_label  TEXT NOT NULL,
  contestant_norm   TEXT NOT NULL,
  market_type       TEXT NOT NULL,                -- 'h2h' | 'outrights' | etc
  book              TEXT NOT NULL,
  american          INT,
  implied_prob_raw  NUMERIC(7,5),                 -- before de-vigging
  implied_prob_novig NUMERIC(7,5),                -- after sum-to-1 normalisation
  fetched_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sbq_event_market ON sports_book_quotes(sports_event_id, market_type);
CREATE INDEX IF NOT EXISTS idx_sbq_oaeid_book   ON sports_book_quotes(odds_api_event_id, market_type, book);
CREATE INDEX IF NOT EXISTS idx_sbq_fetched      ON sports_book_quotes(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_sbq_contestant   ON sports_book_quotes(sports_event_id, contestant_norm, market_type);

-- Latest quote per (event, contestant, market_type, book). Read this from
-- API endpoints so we always see the freshest line per book.
CREATE OR REPLACE VIEW sports_book_v_latest AS
SELECT DISTINCT ON (sports_event_id, contestant_norm, market_type, book)
  sports_event_id, odds_api_event_id, league, contestant_label, contestant_norm,
  market_type, book, american, implied_prob_raw, implied_prob_novig, fetched_at
FROM sports_book_quotes
WHERE sports_event_id IS NOT NULL
ORDER BY sports_event_id, contestant_norm, market_type, book, fetched_at DESC;

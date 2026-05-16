-- Player props schema extension for sports_markets.
--
-- Each Kalshi prop event is one (game × stat) combo (e.g., KXNBASTL-26MAY18SASOKC
-- = "SAS at OKC: Steals"). Within an event there are N markets per player —
-- one per threshold (1+ steals, 2+ steals, 3+ steals, etc.). The existing
-- (event_id, contestant_id, market_type) uniqueness was too narrow because
-- the same (player, market_type) appears at multiple thresholds.
--
-- Migration: add prop_line + prop_side columns, relax the legacy unique
-- constraint to only winner-type rows (prop_line IS NULL), and add a new
-- partial unique constraint for prop rows.
--
-- Also enforce kalshi_ticker uniqueness so prop ingestion can upsert by
-- the natural Kalshi key without worrying about constraint shape.
--
-- Idempotent — safe to re-run.

ALTER TABLE sports_markets
  ADD COLUMN IF NOT EXISTS prop_line NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS prop_side TEXT;

-- Drop the existing full unique constraint (it'd block props otherwise)
ALTER TABLE sports_markets
  DROP CONSTRAINT IF EXISTS sports_markets_event_id_contestant_id_market_type_key;

-- Re-add as a partial index — only legacy winner-type rows enforce it
CREATE UNIQUE INDEX IF NOT EXISTS sports_markets_winner_uniq
  ON sports_markets (event_id, contestant_id, market_type)
  WHERE prop_line IS NULL;

-- Props use (event_id, contestant_id, market_type, prop_line) as natural key
CREATE UNIQUE INDEX IF NOT EXISTS sports_markets_prop_uniq
  ON sports_markets (event_id, contestant_id, market_type, prop_line)
  WHERE prop_line IS NOT NULL;

-- Global kalshi_ticker uniqueness — lets the ingester upsert by ticker for
-- both legacy and prop rows without juggling constraint names
CREATE UNIQUE INDEX IF NOT EXISTS sports_markets_kalshi_ticker_uniq
  ON sports_markets (kalshi_ticker)
  WHERE kalshi_ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS sports_markets_prop_event_idx
  ON sports_markets (event_id, market_type)
  WHERE prop_line IS NOT NULL;

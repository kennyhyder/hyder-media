-- GolfOdds schema
-- Run this in the Supabase SQL editor for project ilbovwnhrowvxjdkvrln.
-- All tables prefixed golfodds_ per hyder-media convention.

-- ---------------------------------------------------------------------------
-- Tournaments
-- One row per PGA Tour event. Other tours can be added by extending `tour`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tour TEXT NOT NULL DEFAULT 'pga',          -- pga, korn_ferry, dpwt, liv, ...
    name TEXT NOT NULL,                         -- "Masters Tournament"
    short_name TEXT,                            -- "Masters"
    season_year INT,
    start_date DATE,
    end_date DATE,
    course_name TEXT,
    location TEXT,
    is_major BOOLEAN DEFAULT FALSE,
    kalshi_event_ticker TEXT UNIQUE,            -- e.g. KXPGATOUR-MAST26
    dg_event_id INT,                            -- DataGolf event_id
    status TEXT NOT NULL DEFAULT 'upcoming',    -- upcoming | live | settled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_golfodds_tournaments_start_date ON golfodds_tournaments(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_golfodds_tournaments_status ON golfodds_tournaments(status);

-- ---------------------------------------------------------------------------
-- Players
-- Canonical golfer identities. Name reconciliation across Kalshi/DG/books
-- happens via aliases table below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                         -- "Scottie Scheffler"
    normalized_name TEXT NOT NULL UNIQUE,       -- "scottie scheffler"
    dg_id INT UNIQUE,                           -- DataGolf player id
    owgr_rank INT,
    country TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_golfodds_players_dg_id ON golfodds_players(dg_id);

CREATE TABLE IF NOT EXISTS golfodds_player_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES golfodds_players(id) ON DELETE CASCADE,
    source TEXT NOT NULL,                       -- kalshi | datagolf | book:draftkings | ...
    alias TEXT NOT NULL,                        -- raw name string from that source
    UNIQUE (source, alias)
);

-- ---------------------------------------------------------------------------
-- Markets
-- One row per (tournament, player, market_type). Quote tables reference this.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES golfodds_tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES golfodds_players(id) ON DELETE CASCADE,
    market_type TEXT NOT NULL CHECK (market_type IN ('win', 't5', 't10', 't20', 'mc', 'frl')),
    -- t5 = top 5, t10 = top 10, t20 = top 20, mc = make cut, frl = first round leader
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tournament_id, player_id, market_type)
);
CREATE INDEX IF NOT EXISTS idx_golfodds_markets_tournament ON golfodds_markets(tournament_id);

-- ---------------------------------------------------------------------------
-- Kalshi quotes
-- One row per snapshot of a Kalshi market price. Append-only time series.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_kalshi_quotes (
    id BIGSERIAL PRIMARY KEY,
    market_id UUID NOT NULL REFERENCES golfodds_markets(id) ON DELETE CASCADE,
    kalshi_ticker TEXT NOT NULL,                -- e.g. KXPGATOUR-MAST26-SCHEFFLER
    yes_bid NUMERIC(5,4),                       -- 0.0000 - 1.0000 (dollars)
    yes_ask NUMERIC(5,4),
    last_price NUMERIC(5,4),
    implied_prob NUMERIC(5,4),                  -- mid of bid/ask, or last
    volume NUMERIC,
    open_interest NUMERIC,
    status TEXT,                                -- open | closed | settled
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_golfodds_kalshi_market ON golfodds_kalshi_quotes(market_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_golfodds_kalshi_ticker ON golfodds_kalshi_quotes(kalshi_ticker, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- Book quotes (DataGolf-aggregated)
-- One row per (market, book) snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_book_quotes (
    id BIGSERIAL PRIMARY KEY,
    market_id UUID NOT NULL REFERENCES golfodds_markets(id) ON DELETE CASCADE,
    book TEXT NOT NULL,                         -- draftkings | fanduel | circa | betmgm | caesars | pinnacle | ...
    price_decimal NUMERIC(8,3),                 -- decimal odds, e.g. 8.5
    price_american INT,                         -- american odds, e.g. +750
    implied_prob NUMERIC(5,4),                  -- 1 / decimal odds (raw, with vig)
    novig_prob NUMERIC(5,4),                    -- de-vigged probability across the field for this market
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_golfodds_book_market ON golfodds_book_quotes(market_id, book, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_golfodds_book_book ON golfodds_book_quotes(book, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- DataGolf model probabilities (their "fair" line)
-- One row per snapshot per market.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_dg_model (
    id BIGSERIAL PRIMARY KEY,
    market_id UUID NOT NULL REFERENCES golfodds_markets(id) ON DELETE CASCADE,
    dg_prob NUMERIC(5,4),                       -- DataGolf's baseline probability
    dg_fit_prob NUMERIC(5,4),                   -- baseline + course-fit adjustment
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_golfodds_dg_model_market ON golfodds_dg_model(market_id, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- Latest-snapshot views for fast dashboard reads
-- These return the most recent row per (market, [book]) and are what the
-- comparison API endpoints should query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW golfodds_v_latest_kalshi AS
SELECT DISTINCT ON (market_id)
    market_id, kalshi_ticker, yes_bid, yes_ask, last_price, implied_prob,
    volume, open_interest, status, fetched_at
FROM golfodds_kalshi_quotes
ORDER BY market_id, fetched_at DESC;

CREATE OR REPLACE VIEW golfodds_v_latest_books AS
SELECT DISTINCT ON (market_id, book)
    market_id, book, price_decimal, price_american,
    implied_prob, novig_prob, fetched_at
FROM golfodds_book_quotes
ORDER BY market_id, book, fetched_at DESC;

CREATE OR REPLACE VIEW golfodds_v_latest_dg AS
SELECT DISTINCT ON (market_id)
    market_id, dg_prob, dg_fit_prob, fetched_at
FROM golfodds_dg_model
ORDER BY market_id, fetched_at DESC;

-- ---------------------------------------------------------------------------
-- Data source tracking (parallels solar_data_sources convention)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS golfodds_data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,                  -- kalshi | datagolf
    base_url TEXT,
    auth_method TEXT,
    last_import TIMESTAMPTZ,
    record_count INT DEFAULT 0,
    notes TEXT
);

INSERT INTO golfodds_data_sources (name, base_url, auth_method, notes) VALUES
    ('kalshi',   'https://api.elections.kalshi.com/trade-api/v2', 'none (public read)', 'KXPGATOUR series for PGA Tour markets'),
    ('datagolf', 'https://feeds.datagolf.com',                    'api key (query param)', 'Scratch+ membership; 11+ books aggregated')
ON CONFLICT (name) DO NOTHING;

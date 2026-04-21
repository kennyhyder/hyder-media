-- SERP (Search Engine Results Page) rank cache
-- Stores top organic result per keyword, refreshed on demand.
-- Populated by /api/serp/rank via DuckDuckGo HTML scraping.

CREATE TABLE IF NOT EXISTS serp_rankings (
    id BIGSERIAL PRIMARY KEY,
    keyword TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'duckduckgo',  -- duckduckgo | bing | google

    -- Top organic result
    top_domain TEXT,
    top_url TEXT,
    top_title TEXT,

    -- Next 4 organic results (for context)
    top_results JSONB,  -- [{rank, url, domain, title}, ...]

    -- Metadata
    raw_query TEXT,
    error TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT serp_rankings_keyword_source_unique UNIQUE (keyword, source)
);

CREATE INDEX IF NOT EXISTS idx_serp_rankings_keyword ON serp_rankings (keyword);
CREATE INDEX IF NOT EXISTS idx_serp_rankings_checked_at ON serp_rankings (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_serp_rankings_top_domain ON serp_rankings (top_domain);

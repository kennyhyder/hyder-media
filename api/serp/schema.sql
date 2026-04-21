-- SERP (Search Engine Results Page) rank cache.
-- Stores top organic result per keyword, refreshed on demand.
-- Populated by /api/serp/rank via DuckDuckGo HTML scraping.
-- source: duckduckgo | bing | google
-- top_results: JSONB array of {rank, url, domain, title}
CREATE TABLE IF NOT EXISTS serp_rankings (
    id BIGSERIAL PRIMARY KEY,
    keyword TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'duckduckgo',
    top_domain TEXT,
    top_url TEXT,
    top_title TEXT,
    top_results JSONB,
    raw_query TEXT,
    error TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT serp_rankings_keyword_source_unique UNIQUE (keyword, source)
);

CREATE INDEX IF NOT EXISTS idx_serp_rankings_keyword ON serp_rankings (keyword);
CREATE INDEX IF NOT EXISTS idx_serp_rankings_checked_at ON serp_rankings (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_serp_rankings_top_domain ON serp_rankings (top_domain);

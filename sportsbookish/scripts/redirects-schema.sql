-- URL redirect table. Middleware consults this on every request and
-- 301/308s when a match is found. Populated by:
--   1. Initial bulk import of GSC-reported 404 URLs (one-time)
--   2. Daily GSC API pull cron that adds newly-reported 404s
--   3. Sitemap-diff cron: when a URL leaves the sitemap, register a
--      redirect to its closest live equivalent
--   4. Manual additions when shipping structural changes

CREATE TABLE IF NOT EXISTS sb_url_redirects (
  id            BIGSERIAL PRIMARY KEY,
  -- Exact path match (no scheme/host). Begins with /.
  from_path     TEXT UNIQUE NOT NULL,
  to_path       TEXT NOT NULL,
  -- 301 (permanent — for resolver-based fallbacks) or 308 (permanent w/ method preservation)
  status_code   INTEGER NOT NULL DEFAULT 301
                CHECK (status_code IN (301, 302, 307, 308)),
  -- Provenance — helps audit which source registered this
  source        TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','gsc_import','gsc_pull','sitemap_diff','smart_resolver')),
  -- Telemetry
  hits          BIGINT NOT NULL DEFAULT 0,
  last_hit_at   TIMESTAMPTZ,
  -- Audit
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_url_redirects_from ON sb_url_redirects (from_path);
-- For high-frequency middleware lookup: just the from_path index above is enough.
-- The hits/last_hit_at update is async and best-effort.

-- A few patterns we'll route via a smart resolver instead of explicit
-- rows (saves table size if sitemap churn produces 10k+ event 404s):
--   /sports/<league>/<year>/<slug>   → /sports/<league>/<year>
--   /sports/<league>/players/<slug>  → /sports/<league>/players
--   /sports/<league>/teams/<slug>    → /sports/<league>/teams
-- These are handled by the middleware fallback chain after the table
-- lookup misses. Configure via env: SB_SMART_404_FALLBACK=1.

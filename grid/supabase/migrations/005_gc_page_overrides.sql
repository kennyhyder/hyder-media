-- ============================================================================
-- GridCensus — Migration 005: SEO page overrides (overlay metadata)
-- ============================================================================
-- The autonomous SEO loop improves a page's <title>/<meta description>/JSON-LD
-- WITHOUT code changes by writing an overlay row keyed by URL path. The entity
-- page templates' generateMetadata() merges an override if one exists.
--
-- `page` is the canonical URL path (e.g. "/datacenters/foo-ab12cd"). Matching
-- is by exact path. `source` records who/what applied it ("claude" | "manual").
-- ============================================================================

create table if not exists public.gc_page_overrides (
  page          text primary key,             -- canonical URL path
  title         text,                         -- overlay <title> (null = keep canonical)
  description   text,                         -- overlay meta description
  extra_jsonld  jsonb,                         -- optional extra JSON-LD to inject
  source        text not null default 'manual', -- 'claude' | 'manual'
  applied_at    timestamptz not null default now()
);

comment on table public.gc_page_overrides is
  'Overlay SEO metadata applied by the autonomous SEO loop, keyed by URL path. Merged into generateMetadata at render time. Never mutates canonical data.';

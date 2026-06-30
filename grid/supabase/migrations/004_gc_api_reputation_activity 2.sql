-- ============================================================================
-- GridCensus v2 — Migration 004: API tokens, Reputation, Activity log
-- ============================================================================
-- Tables: gc_api_tokens, gc_reputation, gc_activity_log
-- API token model reuses AutomateDojo lib/api-tokens.ts (sha256-hashed), but
-- token prefix is gck_live_ and the scope is GridCensus read endpoints.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gc_api_tokens — free read-only API keys (gck_live_…, sha256-hashed at rest).
-- The raw token is shown ONCE on creation; only the hash + prefix are stored.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_api_tokens (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.gc_users(id) on delete cascade,
  name                text not null default 'API token',
  prefix              text not null,                 -- "gck_live_aB12cD34" for display + fast lookup
  token_hash          text not null unique,          -- sha256(raw)
  scopes              text[] not null default array['read:sites','read:entities','read:rankings'],
  -- rate-limit tier raises the ceiling; free default
  tier                text not null default 'free' check (tier in ('free','pro','enterprise')),
  rate_limit_per_min  integer not null default 60,
  request_count_total bigint not null default 0,
  last_used_at        timestamptz,
  last_used_ip        text,
  revoked_at          timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.gc_api_tokens is
  'Free/tiered read-only API tokens (gck_live_…). Hash-at-rest; raw shown once. Reuses AutomateDojo api-tokens pattern.';

create index if not exists idx_gc_api_tokens_user on public.gc_api_tokens (user_id);
create index if not exists idx_gc_api_tokens_hash on public.gc_api_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- gc_reputation — points for approved contributions/claims/verified edits.
-- One row per user (rolling totals). Badges derived in app from points + facets.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_reputation (
  user_id              uuid primary key references public.gc_users(id) on delete cascade,
  points               integer not null default 0,
  contributions_approved integer not null default 0,
  claims_verified      integer not null default 0,
  edits_merged         integer not null default 0,
  -- per-facet leaderboard hooks, e.g. { "TX": 40, "editor": 12 }
  facets               jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now()
);

comment on table public.gc_reputation is
  'Contributor reputation. Drives "Verified Contributor"/"Top Editor — TX" badges + auto-merge threshold.';

create index if not exists idx_gc_reputation_points on public.gc_reputation (points desc);

-- ---------------------------------------------------------------------------
-- gc_activity_log — full audit trail (claims, approvals, overrides, rollbacks,
-- theme/owner edits). Enables rollback + abuse forensics.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_activity_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.gc_users(id) on delete set null,
  -- claim_created | claim_approved | contribution_submitted | override_applied |
  -- override_rolled_back | reputation_awarded | alert_fired | token_created | ...
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);

comment on table public.gc_activity_log is 'Append-only audit trail for the claim/contribution/override flywheel + rollback.';

create index if not exists idx_gc_activity_actor  on public.gc_activity_log (actor_id);
create index if not exists idx_gc_activity_entity on public.gc_activity_log (entity_type, entity_id);
create index if not exists idx_gc_activity_created on public.gc_activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.gc_api_tokens   enable row level security;
alter table public.gc_reputation   enable row level security;
alter table public.gc_activity_log enable row level security;

-- API tokens: owner manages own (but token_hash never select'd client-side; the
-- app reads it server-side via the service key). Owner can list metadata.
drop policy if exists gc_api_tokens_owner on public.gc_api_tokens;
create policy gc_api_tokens_owner on public.gc_api_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reputation: public read (leaderboards/badges), owner+staff write via service key.
drop policy if exists gc_reputation_public_read on public.gc_reputation;
create policy gc_reputation_public_read on public.gc_reputation
  for select using (true);

-- Activity log: staff read only; writes via service key.
drop policy if exists gc_activity_staff_read on public.gc_activity_log;
create policy gc_activity_staff_read on public.gc_activity_log
  for select using (public.is_gc_staff());

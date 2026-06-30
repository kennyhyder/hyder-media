-- ============================================================================
-- GridCensus v2 — Migration 003: Watch/Save, Lists/Portfolios, Alerts
-- ============================================================================
-- Tables: gc_saved_sites, gc_lists, gc_list_items, gc_alerts
-- Works immediately on the existing 195k entity pages (no canonical change).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gc_saved_sites — a user "watches/saves" any entity (sites included; unowned
-- infra has no claim, but can still be saved).
-- ---------------------------------------------------------------------------
create table if not exists public.gc_saved_sites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.gc_users(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('site','substation','brownfield','ixp','datacenter','company','county')),
  entity_id   text not null,
  -- denormalized for fast dashboard rendering without re-querying grid_*
  label       text,
  meta        jsonb not null default '{}'::jsonb,  -- {name,state,score,...}
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.gc_saved_sites is
  'Per-user saved/watched entities. meta denormalizes name/state/score for fast dashboard reads.';

create unique index if not exists uq_gc_saved_user_entity
  on public.gc_saved_sites (user_id, entity_type, entity_id);
create index if not exists idx_gc_saved_user on public.gc_saved_sites (user_id);

-- ---------------------------------------------------------------------------
-- gc_lists — named portfolios. gc_list_items — membership.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.gc_users(id) on delete cascade,
  name        text not null,
  description text,
  is_public   boolean not null default false,
  -- short slug for shareable public lists (nullable until shared)
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.gc_lists is 'User portfolios/lists of entities. Optionally public+shareable.';

create index if not exists idx_gc_lists_user on public.gc_lists (user_id);

create table if not exists public.gc_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.gc_lists(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('site','substation','brownfield','ixp','datacenter','company','county')),
  entity_id   text not null,
  meta        jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_gc_list_items
  on public.gc_list_items (list_id, entity_type, entity_id);
create index if not exists idx_gc_list_items_list on public.gc_list_items (list_id);

-- ---------------------------------------------------------------------------
-- gc_alerts — "notify me when …". Email + webhook. Drives re-engagement +
-- is a premium feature (tier-gated delivery cadence).
-- ---------------------------------------------------------------------------
create table if not exists public.gc_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.gc_users(id) on delete cascade,
  -- queue_status | new_high_score_site | node_price | entity_change
  alert_type    text not null
    check (alert_type in ('queue_status','new_high_score_site','node_price','entity_change','saved_change')),
  -- structured trigger params: { state, county_fips, min_score, node, threshold, entity_type, entity_id, ... }
  params        jsonb not null default '{}'::jsonb,
  -- email | webhook
  channel       text not null default 'email' check (channel in ('email','webhook')),
  webhook_url   text,
  is_active     boolean not null default true,
  last_fired_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.gc_alerts is
  'User alerts: queue-status change, new >=75-score site in a county, nodal price move, watched-entity change. Email + webhook.';

create index if not exists idx_gc_alerts_user   on public.gc_alerts (user_id);
create index if not exists idx_gc_alerts_active on public.gc_alerts (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- touch triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_gc_lists_touch on public.gc_lists;
create trigger trg_gc_lists_touch
  before update on public.gc_lists
  for each row execute function public.gc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — all owner-scoped (with public read for shared lists/items)
-- ---------------------------------------------------------------------------
alter table public.gc_saved_sites enable row level security;
alter table public.gc_lists       enable row level security;
alter table public.gc_list_items  enable row level security;
alter table public.gc_alerts      enable row level security;

drop policy if exists gc_saved_owner on public.gc_saved_sites;
create policy gc_saved_owner on public.gc_saved_sites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists gc_lists_owner on public.gc_lists;
create policy gc_lists_owner on public.gc_lists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists gc_lists_public_read on public.gc_lists;
create policy gc_lists_public_read on public.gc_lists
  for select using (is_public);

drop policy if exists gc_list_items_owner on public.gc_list_items;
create policy gc_list_items_owner on public.gc_list_items
  for all using (
    exists (select 1 from public.gc_lists l where l.id = list_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.gc_lists l where l.id = list_id and l.user_id = auth.uid())
  );

drop policy if exists gc_list_items_public_read on public.gc_list_items;
create policy gc_list_items_public_read on public.gc_list_items
  for select using (
    exists (select 1 from public.gc_lists l where l.id = list_id and l.is_public)
  );

drop policy if exists gc_alerts_owner on public.gc_alerts;
create policy gc_alerts_owner on public.gc_alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

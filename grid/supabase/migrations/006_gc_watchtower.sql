-- 006: Watchtower — watched sites/places with signal snapshots, change events,
-- and email log. Rides 003 (gc_lists = portfolios, gc_alerts = channels).
-- Spec: grid/docs/watchtower-v1-spec.md
-- RLS: owner-only on every table (service key bypasses for crons/API), per the
-- 2026-08-04 estate-wide RLS lockdown discipline.

-- Stripe plan state lives on the existing profile row.
alter table public.gc_users add column if not exists stripe_customer_id text;
alter table public.gc_users add column if not exists stripe_sub_id text;
alter table public.gc_users add column if not exists plan_status text; -- active|past_due|canceled|null

create table if not exists public.gc_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.gc_users(id) on delete cascade,
  kind text not null check (kind in ('site','place','query')),
  dc_site_id bigint,                       -- kind=site
  lat double precision,
  lng double precision,
  label text not null,
  query_params jsonb,                      -- kind=query (reserved; v1 rejects)
  target_mw numeric,
  list_id uuid references public.gc_lists(id) on delete set null,
  is_active boolean not null default true,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists gc_watches_user_idx on public.gc_watches (user_id);
create index if not exists gc_watches_due_idx on public.gc_watches (is_active, last_scanned_at nulls first);

create table if not exists public.gc_watch_snapshots (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.gc_watches(id) on delete cascade,
  taken_at timestamptz not null default now(),
  signals jsonb not null,                  -- { signal_key: { value, hash } }
  signals_hash text not null
);
create index if not exists gc_watch_snapshots_watch_idx
  on public.gc_watch_snapshots (watch_id, taken_at desc);

create table if not exists public.gc_watch_events (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.gc_watches(id) on delete cascade,
  event_type text not null,                -- score_change|regulatory|congestion|pipeline|datacenter|news|baseline
  severity text not null check (severity in ('info','notable','high')),
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  digested_at timestamptz
);
create index if not exists gc_watch_events_watch_idx
  on public.gc_watch_events (watch_id, created_at desc);
create index if not exists gc_watch_events_undigested_idx
  on public.gc_watch_events (created_at) where digested_at is null;

create table if not exists public.gc_email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,                      -- digest|alert
  sent_at timestamptz not null default now(),
  resend_id text
);
create index if not exists gc_email_log_user_idx on public.gc_email_log (user_id, kind, sent_at desc);

-- RLS: owner-only. Crons/API mutate via the service key (bypasses RLS); the
-- anon/authenticated roles can only see their own rows.
alter table public.gc_watches enable row level security;
alter table public.gc_watch_snapshots enable row level security;
alter table public.gc_watch_events enable row level security;
alter table public.gc_email_log enable row level security;

drop policy if exists gc_watches_owner on public.gc_watches;
create policy gc_watches_owner on public.gc_watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists gc_watch_snapshots_owner on public.gc_watch_snapshots;
create policy gc_watch_snapshots_owner on public.gc_watch_snapshots
  for select using (exists (select 1 from public.gc_watches w where w.id = watch_id and w.user_id = auth.uid()));

drop policy if exists gc_watch_events_owner on public.gc_watch_events;
create policy gc_watch_events_owner on public.gc_watch_events
  for select using (exists (select 1 from public.gc_watches w where w.id = watch_id and w.user_id = auth.uid()));

drop policy if exists gc_email_log_owner on public.gc_email_log;
create policy gc_email_log_owner on public.gc_email_log
  for select using (auth.uid() = user_id);

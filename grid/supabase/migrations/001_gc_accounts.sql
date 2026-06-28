-- ============================================================================
-- GridCensus v2 — Migration 001: Accounts + Companies
-- ============================================================================
-- Project: ilbovwnhrowvxjdkvrln (SHARED with AutomateDojo / AG2020 / SportsBookISH)
-- Apply via Supabase SQL Editor or psql (session-mode pooler, port 5432).
--
-- Tables: gc_users, gc_companies
--
-- CRITICAL SHARED-PROJECT TRIGGER GOTCHA
-- --------------------------------------
-- This project has auth.users triggers from other products
-- (9dm_handle_new_user for AutomateDojo, sb_handle_new_user for SportsBookISH)
-- that fire on EVERY signup. The GridCensus trigger below MUST gate on
--   raw_user_meta_data->>'product' = 'gridcensus'
-- and the signup flow MUST pass  data: { product: 'gridcensus' }  — otherwise
-- cross-product signups break each other. See root CLAUDE.md.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gc_users — one row per GridCensus account. Mirrors auth.users (1:1 via id).
-- ---------------------------------------------------------------------------
create table if not exists public.gc_users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  -- role: member (default free) | contributor (earned trust) | owner (claimed an
  -- entity) | enterprise (paid/API) | moderator | staff
  role         text not null default 'member'
    check (role in ('member','contributor','owner','enterprise','moderator','staff')),
  -- capability flags resolved server-side; role is the coarse default, these are
  -- per-user overrides layered on top (see src/lib/auth.ts resolveCapabilities()).
  capabilities jsonb not null default '{}'::jsonb,
  -- soft profile fields
  avatar_url   text,
  company_name text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.gc_users is
  'GridCensus accounts (product-scoped). 1:1 with auth.users. role + capabilities resolve server-side.';

create index if not exists idx_gc_users_email on public.gc_users (email);
create index if not exists idx_gc_users_role  on public.gc_users (role);

-- ---------------------------------------------------------------------------
-- gc_companies — claimable org profiles (operators, utilities, brokers, EPCs,
-- developers). The Crunchbase/G2 layer that relates to datacenters/IXPs/sites.
-- Additive: built here only if not created elsewhere.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_companies (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  -- operator | utility | broker | epc | developer | colo | hyperscaler | other
  company_type  text not null default 'other'
    check (company_type in ('operator','utility','broker','epc','developer','colo','hyperscaler','reit','other')),
  website       text,
  website_domain text,            -- normalized apex domain, used for email-match claim auto-verify
  logo_url      text,
  description   text,
  hq_city       text,
  hq_state      text,
  hq_country    text default 'US',
  founded_year  integer,
  employee_count integer,
  linkedin_url  text,
  -- claim/ownership state (denormalized for fast reads; source of truth is gc_entity_claims)
  claimed_by    uuid references public.gc_users(id) on delete set null,
  claimed_at    timestamptz,
  is_verified   boolean not null default false,
  is_featured   boolean not null default false,   -- paid "Enhanced/Featured listing"
  -- arbitrary structured specs (markets served, certifications, etc.)
  attributes    jsonb not null default '{}'::jsonb,
  date_modified timestamptz not null default now(),  -- AEO freshness signal
  created_at    timestamptz not null default now()
);

comment on table public.gc_companies is
  'Claimable organization profiles (operators/utilities/brokers/EPCs/developers). Relates to grid_* entities. date_modified powers AEO freshness.';

create index if not exists idx_gc_companies_type     on public.gc_companies (company_type);
create index if not exists idx_gc_companies_state    on public.gc_companies (hq_state);
create index if not exists idx_gc_companies_domain   on public.gc_companies (website_domain);
create index if not exists idx_gc_companies_featured on public.gc_companies (is_featured) where is_featured;

-- ---------------------------------------------------------------------------
-- updated_at / date_modified touch triggers
-- ---------------------------------------------------------------------------
create or replace function public.gc_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gc_users_touch on public.gc_users;
create trigger trg_gc_users_touch
  before update on public.gc_users
  for each row execute function public.gc_touch_updated_at();

create or replace function public.gc_touch_date_modified()
returns trigger language plpgsql as $$
begin
  new.date_modified = now();
  return new;
end;
$$;

drop trigger if exists trg_gc_companies_touch on public.gc_companies;
create trigger trg_gc_companies_touch
  before update on public.gc_companies
  for each row execute function public.gc_touch_date_modified();

-- ---------------------------------------------------------------------------
-- PRODUCT-SCOPED auth.users signup trigger
-- Inserts a gc_users row ONLY for GridCensus signups. Gated on the product flag
-- so it never touches AutomateDojo/SportsBookISH/AG2020 signups (and theirs
-- skip GridCensus). The function is SECURITY DEFINER so it can write public.*.
-- ---------------------------------------------------------------------------
create or replace function public.gc_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- PRODUCT GATE: bail unless this signup is a GridCensus signup.
  if (new.raw_user_meta_data->>'product') is distinct from 'gridcensus' then
    return new;
  end if;

  insert into public.gc_users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'member'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Note: AFTER INSERT so auth.users row already exists when we FK to it.
drop trigger if exists trg_gc_handle_new_user on auth.users;
create trigger trg_gc_handle_new_user
  after insert on auth.users
  for each row execute function public.gc_handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper: is the current (or given) user GridCensus staff/moderator?
-- Used by RLS policies in later migrations. SECURITY DEFINER so RLS on gc_users
-- doesn't recurse.
-- ---------------------------------------------------------------------------
create or replace function public.is_gc_staff(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.gc_users u
    where u.id = uid and u.role in ('staff','moderator')
  );
$$;

create or replace function public.gc_user_role(uid uuid default auth.uid())
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.gc_users where id = uid;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.gc_users     enable row level security;
alter table public.gc_companies enable row level security;

-- gc_users: a user can see + edit their own row; staff can see all.
drop policy if exists gc_users_self_select on public.gc_users;
create policy gc_users_self_select on public.gc_users
  for select using (id = auth.uid() or public.is_gc_staff());

drop policy if exists gc_users_self_update on public.gc_users;
create policy gc_users_self_update on public.gc_users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- gc_companies: public read (these are directory pages). Writes are
-- service-key/owner/staff only — handled server-side; no anon write policy.
drop policy if exists gc_companies_public_read on public.gc_companies;
create policy gc_companies_public_read on public.gc_companies
  for select using (true);

drop policy if exists gc_companies_owner_update on public.gc_companies;
create policy gc_companies_owner_update on public.gc_companies
  for update using (claimed_by = auth.uid() or public.is_gc_staff())
  with check (claimed_by = auth.uid() or public.is_gc_staff());

-- Service-key reads/writes bypass RLS entirely (the app's server code uses the
-- service key for canonical reads + moderated writes).

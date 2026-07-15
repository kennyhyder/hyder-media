-- AG2020 dashboard: per-user auth + tab permissions
--
-- Apply via Supabase SQL editor (or psql with the session-mode pooler on port 5432).
-- Idempotent: safe to re-run.
--
-- Linked auth.users rows (kenny@hyder.me, cash@autoglass2020.com) are
-- created/invited by scripts/seed-admins.js using the service-role key.

-- ------------------------------------------------------------------
-- Table
-- ------------------------------------------------------------------
create table if not exists public.ag2020_users (
    user_id      uuid primary key references auth.users(id) on delete cascade,
    email        text not null unique,
    role         text not null default 'member' check (role in ('admin', 'member')),
    allowed_tabs jsonb default '[]'::jsonb,
    display_name text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

comment on table  public.ag2020_users          is 'Per-user permissions for the AG2020 financial dashboard.';
comment on column public.ag2020_users.role         is 'admin = sees all tabs by default + can manage users. member = sees team-safe tabs only.';
comment on column public.ag2020_users.allowed_tabs is 'JSONB array of tab ids that overrides the role default. Empty array = use role defaults.';

create index if not exists ag2020_users_email_idx on public.ag2020_users (lower(email));

-- updated_at auto-touch
create or replace function public.ag2020_users_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists ag2020_users_touch on public.ag2020_users;
create trigger ag2020_users_touch
    before update on public.ag2020_users
    for each row execute function public.ag2020_users_touch_updated_at();

-- ------------------------------------------------------------------
-- Helper: is_ag2020_admin(uuid) — used by RLS policies
-- ------------------------------------------------------------------
create or replace function public.is_ag2020_admin(uid uuid)
returns boolean
language sql
security definer  -- bypass RLS so the policy itself can call this
set search_path = public
stable
as $$
    select exists (
        select 1 from public.ag2020_users
        where user_id = uid and role = 'admin'
    );
$$;

revoke all on function public.is_ag2020_admin(uuid) from public;
grant execute on function public.is_ag2020_admin(uuid) to anon, authenticated;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.ag2020_users enable row level security;

drop policy if exists ag2020_users_select_self     on public.ag2020_users;
drop policy if exists ag2020_users_select_admin    on public.ag2020_users;
drop policy if exists ag2020_users_insert_admin    on public.ag2020_users;
drop policy if exists ag2020_users_update_admin    on public.ag2020_users;
drop policy if exists ag2020_users_delete_admin    on public.ag2020_users;

-- Every authenticated user can read their own row
create policy ag2020_users_select_self
    on public.ag2020_users
    for select
    to authenticated
    using (user_id = auth.uid());

-- Admins can read everyone's row
create policy ag2020_users_select_admin
    on public.ag2020_users
    for select
    to authenticated
    using (public.is_ag2020_admin(auth.uid()));

-- Admins can insert / update / delete any row
create policy ag2020_users_insert_admin
    on public.ag2020_users
    for insert
    to authenticated
    with check (public.is_ag2020_admin(auth.uid()));

create policy ag2020_users_update_admin
    on public.ag2020_users
    for update
    to authenticated
    using      (public.is_ag2020_admin(auth.uid()))
    with check (public.is_ag2020_admin(auth.uid()));

create policy ag2020_users_delete_admin
    on public.ag2020_users
    for delete
    to authenticated
    using (public.is_ag2020_admin(auth.uid()));

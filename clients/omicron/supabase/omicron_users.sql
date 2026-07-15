-- Omicron dashboard membership table.
--
-- The shared Supabase project (ilbovwnhrowvxjdkvrln) holds users for several
-- products (AG2020, Omicron, AutomateDojo, SportsBookISH...). A Supabase
-- session alone does NOT mean "Omicron user" — the 2026-07-14 incident had an
-- AG2020 employee land on the Omicron login (site_url fallback) and pass the
-- session+MFA gate. Every Omicron page gate must verify a row exists here.
--
-- Only the service role can write; users can read their own row (that's what
-- auth-check.js / login.html query through RLS).

create table if not exists public.omicron_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null unique,
    role text not null default 'member' check (role in ('admin', 'member')),
    display_name text,
    created_at timestamptz not null default now()
);

alter table public.omicron_users enable row level security;

drop policy if exists "omicron_users_select_own" on public.omicron_users;
create policy "omicron_users_select_own" on public.omicron_users
    for select using (auth.uid() = user_id);

-- Seed current members from auth.users
insert into public.omicron_users (user_id, email, role)
select id, lower(email),
       case when lower(email) in ('kenny@hyder.me', 'kenny.hyder@omicronmedia.com')
            then 'admin' else 'member' end
from auth.users
where lower(email) in (
    'kenny@hyder.me',
    'kenny.hyder@omicronmedia.com',
    'jeremy.palmer@omicronmedia.com',
    'liehao.su@omicronmedia.com',
    'marisa.petrick@omicronmedia.com'
)
on conflict (user_id) do nothing;

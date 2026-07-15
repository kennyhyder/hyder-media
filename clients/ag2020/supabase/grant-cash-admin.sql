-- Run this AFTER Cash signs up at hyder.me/clients/ag2020/login.html
-- (Magic Link tab → enters cash@autoglass2020.com → clicks email link).
--
-- This grants him admin role + creates his ag2020_users row.
-- Safe to re-run; uses upsert semantics.

insert into public.ag2020_users (user_id, email, role, display_name, allowed_tabs)
select
    u.id,
    'cash@autoglass2020.com',
    'admin',
    'Cash (AG2020)',
    '[]'::jsonb
from auth.users u
where lower(u.email) = 'cash@autoglass2020.com'
on conflict (user_id) do update
set role = excluded.role,
    email = excluded.email,
    display_name = excluded.display_name;

-- Verify
select user_id, email, role, display_name, created_at
from public.ag2020_users
where email = 'cash@autoglass2020.com';

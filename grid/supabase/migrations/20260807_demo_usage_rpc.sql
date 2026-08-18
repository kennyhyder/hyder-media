-- Trial/demo API rate-limiting RPC.
--
-- src/lib/grid-api/demo.ts calls increment_grid_demo_usage(p_token) on every
-- demo-token API request: it logs one usage row and returns the token's
-- rolling hourly / 24h / lifetime request counts, which the caller compares
-- against grid_demo_tokens.{hourly,daily,lifetime}_limit.
--
-- This function was referenced by the ported TypeScript but never created in
-- the DB, so EVERY demo token 503'd ("Demo access temporarily unavailable").
-- Applied 2026-08-07 to make trial API access actually work.

create or replace function increment_grid_demo_usage(p_token text)
returns table(daily_total bigint, hourly_total bigint, lifetime_total bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into grid_demo_usage (token, used_at) values (p_token, now());
  return query
  select
    count(*) filter (where used_at > now() - interval '24 hours')::bigint,
    count(*) filter (where used_at > now() - interval '1 hour')::bigint,
    count(*)::bigint
  from grid_demo_usage
  where token = p_token;
end;
$$;

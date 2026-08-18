-- grid_dc_sites.updated_at was never auto-stamped: the rescore PATCHes score
-- columns without setting updated_at, so freshness monitoring (which keys on
-- updated_at) falsely read "stale" after every rescore. This BEFORE UPDATE
-- trigger stamps updated_at=now() on any row update, so the freshness signal is
-- honest for all future rescores (via REST or psql). Added 2026-08-18.
create or replace function grid_dc_sites_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_grid_dc_sites_updated_at on grid_dc_sites;
create trigger trg_grid_dc_sites_updated_at
  before update on grid_dc_sites
  for each row execute function grid_dc_sites_touch_updated_at();

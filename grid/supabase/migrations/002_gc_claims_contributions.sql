-- ============================================================================
-- GridCensus v2 — Migration 002: Claims, Contributions, Override-merge layer
-- ============================================================================
-- Tables: gc_entity_claims, gc_contributions, gc_entity_overrides
--
-- OVERLAY ARCHITECTURE (important):
--   UGC edits NEVER mutate the canonical ingested grid_* data. Approved edits
--   write to gc_entity_overrides; the render layer merges overrides ON TOP of
--   canonical data at read time (src/lib/overrides.ts mergeOverrides()). This
--   keeps the ingest pipeline idempotent and lets us trust/distrust UGC
--   independently. Mirrors AutomateDojo's ingested-vs-edited content split.
--
-- entity_type values used app-wide:
--   'site'        -> grid_dc_sites
--   'substation'  -> grid_substations
--   'brownfield'  -> grid_brownfield_sites
--   'ixp'         -> grid_ixp_facilities
--   'datacenter'  -> grid_datacenters
--   'company'     -> gc_companies
--   'county'      -> grid_county_data
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gc_entity_claims — a user claims an owned entity (datacenter/IXP/company).
-- Verification escalates by risk (GBP-style). One active claim per entity.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_entity_claims (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         text not null
    check (entity_type in ('site','substation','brownfield','ixp','datacenter','company','county')),
  entity_id           text not null,              -- text: grid_* ids are uuids, but keep generic
  user_id             uuid not null references public.gc_users(id) on delete cascade,
  -- pending | email_verified | dns_verified | doc_verified | approved | rejected | disputed
  status              text not null default 'pending'
    check (status in ('pending','email_verified','dns_verified','doc_verified','approved','rejected','disputed')),
  -- email_domain | dns_txt | dns_meta | manual_doc
  verification_method text,
  claimant_email      text,
  claimed_domain      text,                       -- the entity website domain we matched against
  verification_token  text,                       -- TXT/meta token for DNS verification
  verified_at         timestamptz,
  reviewed_by         uuid references public.gc_users(id) on delete set null,
  review_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.gc_entity_claims is
  'Profile claims on owned entities. Verification tiers: email-domain (low trust) -> DNS (verified badge) -> manual doc (disputes/paid).';

-- One non-rejected claim per (entity_type, entity_id, user) — re-claims update.
create unique index if not exists uq_gc_claims_entity_user
  on public.gc_entity_claims (entity_type, entity_id, user_id)
  where status <> 'rejected';

create index if not exists idx_gc_claims_entity on public.gc_entity_claims (entity_type, entity_id);
create index if not exists idx_gc_claims_user   on public.gc_entity_claims (user_id);
create index if not exists idx_gc_claims_status on public.gc_entity_claims (status);

-- ---------------------------------------------------------------------------
-- gc_contributions — "suggest an edit / add a site / report stale". Field-level
-- diff JSON + REQUIRED source citation. Moderation queue feeds gc_entity_overrides.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_contributions (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null
    check (entity_type in ('site','substation','brownfield','ixp','datacenter','company','county')),
  entity_id     text not null,
  -- edit | add | report_stale | report_incorrect
  kind          text not null default 'edit'
    check (kind in ('edit','add','report_stale','report_incorrect')),
  -- field-level diff: { "field": { "from": <old>, "to": <new> }, ... }
  diff          jsonb not null default '{}'::jsonb,
  -- REQUIRED source/citation (URL or description). Enforced at app + DB level.
  source        text not null,
  note          text,
  submitter_id  uuid references public.gc_users(id) on delete set null,
  submitter_ip  text,
  -- pending | approved | rejected | auto_merged
  status        text not null default 'pending'
    check (status in ('pending','approved','rejected','auto_merged')),
  -- spam/abuse score (lib/lead-abuse.ts pattern): { verdict, score, reasons }
  abuse         jsonb,
  moderator_id  uuid references public.gc_users(id) on delete set null,
  moderated_at  timestamptz,
  moderator_note text,
  created_at    timestamptz not null default now()
);

comment on table public.gc_contributions is
  'UGC edit/add/report submissions. source is REQUIRED. Approval writes to gc_entity_overrides (never to canonical grid_*).';

-- Belt-and-suspenders: source must be non-empty.
alter table public.gc_contributions
  drop constraint if exists gc_contributions_source_nonempty;
alter table public.gc_contributions
  add constraint gc_contributions_source_nonempty check (length(trim(source)) > 0);

create index if not exists idx_gc_contrib_entity on public.gc_contributions (entity_type, entity_id);
create index if not exists idx_gc_contrib_status on public.gc_contributions (status);
create index if not exists idx_gc_contrib_submitter on public.gc_contributions (submitter_id);

-- ---------------------------------------------------------------------------
-- gc_entity_overrides — THE MERGE LAYER. Approved field-level overrides applied
-- ON TOP of canonical grid_* data at render time. One row per overridden field.
-- ---------------------------------------------------------------------------
create table if not exists public.gc_entity_overrides (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null
    check (entity_type in ('site','substation','brownfield','ixp','datacenter','company','county')),
  entity_id       text not null,
  field           text not null,           -- canonical column name being overridden
  value           jsonb,                   -- override value (typed jsonb; render coerces)
  source          text,                    -- citation copied from the approving contribution
  contribution_id uuid references public.gc_contributions(id) on delete set null,
  approved_by     uuid references public.gc_users(id) on delete set null,
  approved_at     timestamptz not null default now(),
  -- soft-delete so a bad override can be rolled back without losing history.
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.gc_entity_overrides is
  'Overlay-merge layer. Approved UGC field overrides merged onto canonical grid_* at READ time. Never mutates ingested data.';

-- One active override per (entity, field) — newest wins; older deactivated.
create unique index if not exists uq_gc_overrides_active
  on public.gc_entity_overrides (entity_type, entity_id, field)
  where is_active;

create index if not exists idx_gc_overrides_lookup
  on public.gc_entity_overrides (entity_type, entity_id) where is_active;

-- ---------------------------------------------------------------------------
-- touch triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_gc_claims_touch on public.gc_entity_claims;
create trigger trg_gc_claims_touch
  before update on public.gc_entity_claims
  for each row execute function public.gc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.gc_entity_claims    enable row level security;
alter table public.gc_contributions    enable row level security;
alter table public.gc_entity_overrides enable row level security;

-- Claims: owner sees own; staff sees all. Insert: authenticated user for self.
drop policy if exists gc_claims_select on public.gc_entity_claims;
create policy gc_claims_select on public.gc_entity_claims
  for select using (user_id = auth.uid() or public.is_gc_staff());

drop policy if exists gc_claims_insert on public.gc_entity_claims;
create policy gc_claims_insert on public.gc_entity_claims
  for insert with check (user_id = auth.uid());

drop policy if exists gc_claims_staff_update on public.gc_entity_claims;
create policy gc_claims_staff_update on public.gc_entity_claims
  for update using (public.is_gc_staff());

-- Contributions: submitter sees own; staff sees all. Insert: authenticated self.
drop policy if exists gc_contrib_select on public.gc_contributions;
create policy gc_contrib_select on public.gc_contributions
  for select using (submitter_id = auth.uid() or public.is_gc_staff());

drop policy if exists gc_contrib_insert on public.gc_contributions;
create policy gc_contrib_insert on public.gc_contributions
  for insert with check (submitter_id = auth.uid());

drop policy if exists gc_contrib_staff_update on public.gc_contributions;
create policy gc_contrib_staff_update on public.gc_contributions
  for update using (public.is_gc_staff());

-- Overrides: PUBLIC READ (they're merged into public pages). Writes via service
-- key / staff only (the approval flow runs server-side with the service key).
drop policy if exists gc_overrides_public_read on public.gc_entity_overrides;
create policy gc_overrides_public_read on public.gc_entity_overrides
  for select using (is_active);

drop policy if exists gc_overrides_staff_write on public.gc_entity_overrides;
create policy gc_overrides_staff_write on public.gc_entity_overrides
  for all using (public.is_gc_staff()) with check (public.is_gc_staff());

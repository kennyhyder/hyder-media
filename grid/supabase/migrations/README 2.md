# GridCensus Supabase migrations

Shared project: **`ilbovwnhrowvxjdkvrln`** (also used by AutomateDojo / AG2020 /
SportsBookISH / Vita Brevis). The owner applies these by hand via the Supabase
SQL Editor (or `psql` over the **session-mode** pooler, port `5432`, region
`us-west-2`) — the app's runtime only has REST/service-key access, no DDL.

## Apply order

1. `001_gc_accounts.sql` — `gc_users`, `gc_companies`, the **product-scoped
   `auth.users` signup trigger**, `is_gc_staff()` / `gc_user_role()` helpers.
2. `002_gc_claims_contributions.sql` — `gc_entity_claims`, `gc_contributions`,
   `gc_entity_overrides` (the overlay-merge layer).
3. `003_gc_saved_lists_alerts.sql` — `gc_saved_sites`, `gc_lists`,
   `gc_list_items`, `gc_alerts`.
4. `004_gc_api_reputation_activity.sql` — `gc_api_tokens`, `gc_reputation`,
   `gc_activity_log`.

All four are idempotent (`if not exists` / `create or replace` /
`drop policy ... ; create policy`), so re-running is safe.

## CRITICAL — shared-project trigger gotcha

The project has `auth.users` triggers from other products
(`9dm_handle_new_user`, `sb_handle_new_user`). The GridCensus trigger
(`gc_handle_new_user`, in 001) **gates on
`raw_user_meta_data->>'product' = 'gridcensus'`** and bails otherwise, so it
never touches other products' signups — and theirs skip GridCensus the same
way. The app's signup flow passes `data: { product: 'gridcensus' }`
(see `src/lib/auth.ts` / the signup page). Do not remove either half.

## After applying

- Enable Supabase Auth providers in the dashboard: **Email** (password +
  magic link) and optionally **Google OAuth** (the signup UI offers all three).
- Set env vars for the app (Vercel + local `.env.local`):
  - `NEXT_PUBLIC_SUPABASE_URL` — `https://ilbovwnhrowvxjdkvrln.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the project anon key
  - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — already used by the canonical
    read path (`src/lib/db.ts`).

Until the tables exist the account UI degrades gracefully: every `gc_` read is
wrapped in try/catch and a feature flag (`accountsEnabled()`), so existing
pages keep rendering.

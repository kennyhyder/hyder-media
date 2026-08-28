# GridCensus Watchtower — v1 Spec

**Date:** 2026-08-27 · **Status:** approved for build · **Owner:** Kenny
**One-liner:** Looking anything up stays free. Having GridCensus *watch your deals* is paid.
**Win condition (by Oct 1):** Stripe-purchasable Pro tier live, watch digests landing in inboxes,
Jon's Hut 8 candidate sites pinned in a portfolio during his first week.

---

## 1. Product definition

A user pins **watches** — a scored site, a vet-a-site location, or a /find query — and GridCensus
re-runs the siting signals on a schedule, diffs against the last snapshot, and notifies on change:

- **Digest** (weekly free / daily Pro): "what changed across your watched sites this period."
- **Alerts** (Pro): immediate email on high-severity events (regulatory posture flip, score drop ≥5,
  new moratorium/tariff gate tripped at the watch's target MW, major local news).

### Tiers (the Stripe wall goes here — NOT on screening)

| | Free (account) | **Pro $249/mo** | Enterprise (custom) |
|---|---|---|---|
| Screening/browse/vet | unlimited (unchanged) | unlimited | unlimited |
| Watches | **1** | **25** | unlimited + team seats |
| Scan cadence | weekly | nightly | nightly |
| Immediate alerts | — | ✓ | ✓ + webhook (gc_alerts.channel already supports it) |
| History | last event | full timeline | full + CSV/API export (existing 100k cap tier) |

Free tier = the upgrade funnel (1 watch → "your other 4 candidate sites aren't being watched").
Existing role/caps system (`src/lib/auth.ts` capabilities) gates this; map Pro → `owner`-equivalent
plan flag, don't invent a parallel permission system.

---

## 2. Signals watched (v1 = 100% existing data, no new ingests)

Refactor the signal assembly out of `src/app/api/grid/vet/route.ts` into **`src/lib/vet-signals.ts`**
so the /vet endpoint and the scan cron share one implementation. Per watch, snapshot:

| Signal | Source (exists today) | Change event |
|---|---|---|
| DC-readiness score + sub-scores | `grid_dc_sites` | delta after rescores (`score_version` stamp) |
| Regulatory posture @ target MW | `src/lib/dc-policy.ts` | posture or MW-gate change (add `DC_POLICY_VERSION` const; bump on edit) |
| ERCOT congestion context | `src/data/ercot-congestion.json` | bottleneck rank/severity change near watch (statewide v1; per-site when bus→coord crosswalk lands) |
| Nearby AI pipeline (≤75mi) | `src/data/frontier-dc.json` | new/changed project after `build-frontier-dc.py` reruns |
| Nearby datacenters + hyperscalers | `grid_datacenters` + `hyperscalers.ts` | new entrant within radius |
| Local news | `src/lib/grid-api/news.ts` (Google News RSS) | new headline URLs vs snapshot; **Haiku synthesis only when changed** (cost guard; reuse `/api/grid/developments` logic) |

**v2 signals (spec'd, not built):** ERCOT NPRR-1267 queue movement (monthly), Bommar moratorium
tracker updates (quarterly), SEPA DELTa tariff filings — each becomes one more field in the same
snapshot JSON. Design the snapshot as `{signal_key: {value, hash, at}}` so adding signals is additive.

---

## 3. Schema — migration `006_gc_watchtower.sql`

**Reuse migration 003** (already deployed): `gc_saves` (pin), `gc_lists`/`gc_list_items`
(portfolio = a list of watches — this is the Hut 8 view), `gc_alerts` (alert_type, params jsonb,
channel email|webhook, is_active, last_fired_at). Add only:

```sql
create table gc_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references gc_users(id) on delete cascade,
  kind text not null check (kind in ('site','place','query')),
  dc_site_id bigint,                -- kind=site
  lat double precision, lng double precision, label text,  -- kind=place
  query_params jsonb,               -- kind=query (/find params)
  target_mw numeric,
  list_id uuid references gc_lists(id),   -- optional portfolio grouping
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table gc_watch_snapshots (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references gc_watches(id) on delete cascade,
  taken_at timestamptz not null default now(),
  signals jsonb not null,           -- {signal_key:{value,hash,at}}
  signals_hash text not null        -- cheap no-change short-circuit
);
create table gc_watch_events (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references gc_watches(id) on delete cascade,
  event_type text not null,         -- score_change|regulatory|congestion|pipeline|datacenter|news
  severity text not null check (severity in ('info','notable','high')),
  summary text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  digested_at timestamptz           -- null = pending digest
);
create table gc_email_log (         -- idempotency + throttle
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,               -- digest|alert
  sent_at timestamptz not null default now(),
  resend_id text
);
```

**RLS on all four tables day one** (owner-only; service key bypasses for crons) — per the
2026-08-04 RLS lockdown discipline. Keep only latest N=10 snapshots per watch (prune in cron).
No PostgREST aggregates anywhere (disabled on this project) — all diffing in code.

---

## 4. Crons (grid/vercel.json, CRON_SECRET fail-closed, registered in the freshness canary)

1. **`/api/cron/watchtower-scan`** — every 30 min, cursor-based: process up to ~40 due watches per
   invocation (due = Pro daily / free weekly since last snapshot), time-boxed under the function
   limit. For each: assemble signals via `vet-signals.ts` → compare `signals_hash` → if changed,
   write snapshot + emit typed `gc_watch_events` with severity. Haiku call ONLY on news-change,
   capped (e.g. 200/day global, log drops — no silent caps).
2. **`/api/cron/watchtower-digest`** — daily 17:00 UTC: group undigested events by user, honor
   cadence (Pro daily / free Mondays), one Resend email per user, mark `digested_at`, log to
   `gc_email_log`. Throttles: ≤1 digest/day/user; immediate `high` alerts bypass digest but are
   capped at 3/day/user (`gc_alerts.last_fired_at`).

Email via **Resend** (same pattern as the hyder-media canaries; add `RESEND_API_KEY` to the
gridcensus Vercel env with `printf %s`, never `echo`). Digest template: plain, scannable, one
section per watch, deep links to site pages — reuse canary email tone, add the purple accent.

---

## 5. Stripe (the missing middle — v1 scope, patterns from sportsbookish)

- **Stripe-hosted Checkout** (redirect) — zero CSP changes, no Stripe.js on-page.
- New: `/api/stripe/checkout` (creates session for `STRIPE_PRICE_PRO`, $249/mo subscription),
  `/api/stripe/webhook` (raw-body signature verify; on `checkout.session.completed` /
  `customer.subscription.updated|deleted` set `gc_users.plan`, `stripe_customer_id`,
  `stripe_sub_id`, `plan_status`), `/api/stripe/portal` (customer portal for cancel/card).
- `/pricing`: Pro CTA becomes the checkout link (kills the `mailto:` and the stale "MegaWatt
  Site" subject in one move). Enterprise stays mailto.
- Env: `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`.
- Add plan check to watch-creation API: free=1, pro=25, enterprise=∞.

---

## 6. UI (minimal, v1)

- **"Watch this site"** button: site profile pages + /vet results + /find rows (auth-gated;
  hits `/api/account/watch`).
- **`/account/watchtower`**: watches list, per-watch latest events timeline, cadence indicator,
  add-to-portfolio (gc_lists), deactivate. Upgrade prompt when free user hits the 1-watch cap.
- Digest email is the primary UX — the page is management, not consumption.

---

## 7. Hut 8 / Jon motion (the reason this ships now)

1. Ship Watchtower + Stripe by **~Sept 22**.
2. Comp a Pro account for Jon; pre-build a **"Hut 8 candidates" portfolio** (gc_list) seeded with
   sites from his wishlist geographies (W. Texas / Abilene, existing-interconnection sites).
3. First week of October ask: "add your real candidate list; tell me which signals are noise."
   His team's calibration feedback = the enterprise-tier requirements doc, free.
4. Enterprise conversation only after the digest has proven itself for ~a month.

---

## 8. Build order (≈4–5 focused days)

| Step | What | Verify |
|---|---|---|
| 1 | `vet-signals.ts` refactor (no behavior change to /vet) | /vet parity on Abilene example |
| 2 | Migration 006 + RLS + watch CRUD API + Watch buttons | create/list/delete watch |
| 3 | Scan cron + event emission | seeded watch on a TX site; force a dc-policy version bump → event |
| 4 | Digest cron + Resend template | real email to kenny@hyder.me |
| 5 | Stripe checkout/webhook/portal + plan gates | live-mode $249 sub on own card, then refund |
| 6 | /pricing CTA swap + /account/watchtower page | smoke incognito + signed-in |

Post-deploy: register both crons in the coverage canary; add `gc_watch_snapshots` to the
freshness canary; single-request deploy verification (never curl loops).

## 9. Risks / honesty

- **Signal sparsity:** most weeks, most sites won't change — the digest must say "no changes,
  here's your baseline" gracefully or it feels broken. Include the current-state summary always.
- **News noise:** Google News RSS is noisy for small towns; require ≥1 new URL AND Haiku
  relevance pass before a `news` event goes above `info`.
- **Rescore coupling:** score-change events only fire when `score-dc-sites.py --rescore` runs —
  stamp a `score_version` in rollups.json at rescore time so the cron can detect refreshes.
- **The real moat starts here:** snapshots accumulate per-site time-series from day one. Keep
  them (post-prune, roll up monthly) — "site readiness over time" is the enterprise feature.

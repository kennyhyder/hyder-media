-- AG2020 Financial Calculator — Phase 1 schema
-- ============================================================
-- Six tables that together implement the Profit First bucket
-- system, daily funding ingestion, bills tracking, past-due
-- payoff modeling, and an audit trail of every bucket movement.
-- ============================================================

-- 1. Daily funding inflow (synced from Google Sheet "Daily funding" tab)
--    One row per calendar date. Each source column maps to a column in
--    the sheet. The sync endpoint upserts on `funding_date`.
create table if not exists public.ag2020_daily_funding (
    id                uuid primary key default gen_random_uuid(),
    funding_date      date not null unique,
    lightning_wire    numeric(12, 2) not null default 0,
    squares           numeric(12, 2) not null default 0,
    checks            numeric(12, 2) not null default 0,
    cash              numeric(12, 2) not null default 0,
    appraisal_checks  numeric(12, 2) not null default 0,
    daily_total       numeric(12, 2) generated always as
        (lightning_wire + squares + checks + cash + appraisal_checks) stored,
    source            text not null default 'google_sheets',
    synced_at         timestamptz not null default now(),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists ag2020_daily_funding_date_idx
    on public.ag2020_daily_funding (funding_date desc);

-- 2. Recurring bills (synced from "Monthly Bills" tab + manual entries)
--    Template-level: each row represents a recurring obligation, NOT a
--    specific payment instance. Payments tracked separately below.
create table if not exists public.ag2020_bills (
    id            uuid primary key default gen_random_uuid(),
    name          text not null,
    vendor        text,
    amount        numeric(12, 2) not null,
    due_day       int not null check (due_day between 1 and 31),
    category      text,
    bucket        text not null default 'operating'
                  check (bucket in ('operating','payroll','tax','marketing','rebates','reserves','profit')),
    autopay       boolean not null default false,
    notes         text,
    is_active     boolean not null default true,
    source        text not null default 'google_sheets',
    last_paid_at  date,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists ag2020_bills_active_due_idx
    on public.ag2020_bills (is_active, due_day) where is_active = true;
create index if not exists ag2020_bills_bucket_idx
    on public.ag2020_bills (bucket) where is_active = true;

-- 3. Past-due obligations (SBA back-pay, TPT AZDOR, Ally repo risk, etc)
--    Separate from recurring bills because they have target payoff dates
--    and per-period payment plans rather than monthly due dates.
create table if not exists public.ag2020_bills_past_due (
    id                  uuid primary key default gen_random_uuid(),
    name                text not null,
    vendor              text,
    total_amount        numeric(12, 2) not null,
    amount_remaining    numeric(12, 2) not null,
    target_payoff_date  date,
    weekly_payment      numeric(12, 2) default 0,
    bucket              text not null default 'operating'
                        check (bucket in ('operating','payroll','tax','marketing','rebates','reserves','profit')),
    priority            int not null default 5 check (priority between 1 and 10),
    notes               text,
    is_paid             boolean not null default false,
    paid_off_at         date,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index if not exists ag2020_bills_past_due_priority_idx
    on public.ag2020_bills_past_due (priority, target_payoff_date)
    where is_paid = false;

-- 4. Bucket allocation configuration (singleton — one active row at a time)
--    Percentages MUST sum to 100. operating_floor is the minimum operating
--    balance to hold before allocating any extra to other buckets.
create table if not exists public.ag2020_bucket_config (
    id              uuid primary key default gen_random_uuid(),
    effective_from  date not null default current_date,
    operating_pct   numeric(5, 2) not null default 50.0,
    payroll_pct     numeric(5, 2) not null default 30.0,
    tax_pct         numeric(5, 2) not null default 8.0,
    marketing_pct   numeric(5, 2) not null default 8.0,
    rebates_pct     numeric(5, 2) not null default 0.0,
    reserves_pct    numeric(5, 2) not null default 3.0,
    profit_pct      numeric(5, 2) not null default 1.0,
    operating_floor numeric(12, 2) not null default 5000.0,
    is_active       boolean not null default true,
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint ag2020_bucket_config_pcts_sum_to_100 check (
        round(operating_pct + payroll_pct + tax_pct + marketing_pct
            + rebates_pct + reserves_pct + profit_pct, 2) = 100.0
    )
);

-- 5. Bucket transactions (full audit trail)
--    Every allocation IN and payment OUT lands here. Computing a balance
--    is sum(amount) where direction='in' minus sum where direction='out'.
create table if not exists public.ag2020_bucket_transactions (
    id              uuid primary key default gen_random_uuid(),
    txn_date        date not null,
    bucket          text not null
                    check (bucket in ('operating','payroll','tax','marketing','rebates','reserves','profit')),
    direction       text not null check (direction in ('in', 'out')),
    amount          numeric(12, 2) not null check (amount >= 0),
    description     text not null,
    source          text not null
                    check (source in ('funding_allocation','bill_payment','past_due_payment','manual_adjustment','transfer_in','transfer_out')),
    reference_id    uuid,
    reference_table text,
    created_at      timestamptz not null default now()
);
create index if not exists ag2020_bucket_txn_date_idx
    on public.ag2020_bucket_transactions (txn_date desc);
create index if not exists ag2020_bucket_txn_bucket_date_idx
    on public.ag2020_bucket_transactions (bucket, txn_date desc);

-- 6. Bucket balance snapshots (end-of-day rollup of #5)
--    The allocation cron writes one row per day per bucket after applying
--    that day's funding and payments. UI reads from here for fast display.
create table if not exists public.ag2020_bucket_balances (
    id              uuid primary key default gen_random_uuid(),
    snapshot_date   date not null,
    bucket          text not null
                    check (bucket in ('operating','payroll','tax','marketing','rebates','reserves','profit')),
    balance         numeric(14, 2) not null,
    inflow_today    numeric(12, 2) not null default 0,
    outflow_today   numeric(12, 2) not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (snapshot_date, bucket)
);
create index if not exists ag2020_bucket_balances_date_idx
    on public.ag2020_bucket_balances (snapshot_date desc);

-- ============================================================
-- Seed: default bucket config
-- Starting allocations match observed Apr-May bank statement flows,
-- slightly tilted toward building a Reserves + Profit habit.
-- ============================================================
insert into public.ag2020_bucket_config (
    operating_pct, payroll_pct, tax_pct, marketing_pct,
    rebates_pct, reserves_pct, profit_pct, operating_floor, notes
)
select 50.0, 30.0, 8.0, 8.0, 0.0, 3.0, 1.0, 5000.0,
    'Initial config — calibrated to observed Apr/May 2026 bank statement throughput. Adjust monthly as reserves/profit habit builds.'
where not exists (select 1 from public.ag2020_bucket_config where is_active);

-- ============================================================
-- Seed: known past-due items per BILLS sheet (June 2026)
-- ============================================================
insert into public.ag2020_bills_past_due (name, vendor, total_amount, amount_remaining, target_payoff_date, bucket, priority, notes)
values
    ('SBA loan back payments', 'SBA', 6804.00, 6804.00, '2026-08-31', 'operating', 3, 'April, May, and June missed payments'),
    ('TPT AZDOR balance', 'AZ Department of Revenue', 27404.00, 27404.00, '2026-08-15', 'tax', 1, 'Wants payment by June 15. Strategy review before August hearing.'),
    ('Ally car payments (catch-up)', 'Ally Bank', 27000.00, 27000.00, '2026-09-30', 'operating', 2, 'Required to clear active repo risk on company vehicles.')
on conflict do nothing;

-- ============================================================
-- Done. Phase 1 schema applied.
-- ============================================================

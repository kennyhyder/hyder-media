/**
 * AG2020 Profit-First bucket math.
 *
 * Allocation engine, balance calculator, and payment recommender — all
 * pure functions that take fetched data and return decisions. The HTTP
 * handlers wrap these.
 */

import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export const BUCKETS = ['operating', 'payroll', 'tax', 'marketing', 'rebates', 'reserves', 'profit'];

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

function addDaysISO(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

/**
 * Compute allocation for a single day's funding.
 * Returns array of { bucket, amount } summing to total.
 */
export function allocateFunding(total, config) {
    if (total <= 0) return BUCKETS.map(b => ({ bucket: b, amount: 0 }));
    const pcts = {
        operating: config.operating_pct,
        payroll: config.payroll_pct,
        tax: config.tax_pct,
        marketing: config.marketing_pct,
        rebates: config.rebates_pct,
        reserves: config.reserves_pct,
        profit: config.profit_pct,
    };
    // Compute per-bucket amounts, then adjust last bucket for rounding so they sum to total
    const allocs = BUCKETS.map(b => ({
        bucket: b,
        amount: Math.round((total * pcts[b] / 100) * 100) / 100,
    }));
    const sum = allocs.reduce((s, a) => s + a.amount, 0);
    const diff = Math.round((total - sum) * 100) / 100;
    if (diff !== 0) {
        // Add the rounding diff to the first non-zero bucket (typically operating)
        const target = allocs.find(a => a.amount > 0) || allocs[0];
        target.amount = Math.round((target.amount + diff) * 100) / 100;
    }
    return allocs;
}

/**
 * Get current bucket balances by summing all transactions.
 * Returns { operating: n, payroll: n, ... } in dollars.
 */
export async function getCurrentBalances(supabase) {
    const { data: txns, error } = await supabase
        .from('ag2020_bucket_transactions')
        .select('bucket, direction, amount');
    if (error) throw error;
    const bal = Object.fromEntries(BUCKETS.map(b => [b, 0]));
    for (const t of (txns || [])) {
        const amt = Number(t.amount) || 0;
        if (t.direction === 'in') bal[t.bucket] += amt;
        else if (t.direction === 'out') bal[t.bucket] -= amt;
    }
    // Round to cents
    for (const b of BUCKETS) bal[b] = Math.round(bal[b] * 100) / 100;
    return bal;
}

/**
 * Run the allocation for a single date.
 * - Fetches the day's funding from ag2020_daily_funding
 * - Allocates per active config
 * - Writes one 'in' transaction per bucket
 * - Returns the allocation breakdown
 *
 * Idempotent: if transactions for that date already exist with source
 * 'funding_allocation', skips silently.
 */
export async function runAllocationForDate(supabase, date) {
    // Check if already allocated
    const { data: existing } = await supabase
        .from('ag2020_bucket_transactions')
        .select('id')
        .eq('txn_date', date)
        .eq('source', 'funding_allocation')
        .limit(1);
    if (existing && existing.length > 0) {
        return { date, skipped: 'already_allocated', allocations: [] };
    }

    const { data: funding } = await supabase
        .from('ag2020_daily_funding')
        .select('daily_total')
        .eq('funding_date', date)
        .single();
    const total = Number(funding?.daily_total) || 0;
    if (total <= 0) {
        return { date, total, allocations: [], note: 'no funding for date' };
    }

    const { data: config } = await supabase
        .from('ag2020_bucket_config')
        .select('*')
        .eq('is_active', true)
        .single();
    if (!config) throw new Error('No active bucket config');

    const allocs = allocateFunding(total, config);
    const rows = allocs
        .filter(a => a.amount > 0)
        .map(a => ({
            txn_date: date,
            bucket: a.bucket,
            direction: 'in',
            amount: a.amount,
            description: `Daily funding allocation — ${a.bucket} (${(config[a.bucket + '_pct'])}%)`,
            source: 'funding_allocation',
            reference_table: 'ag2020_daily_funding',
        }));
    if (rows.length > 0) {
        const { error } = await supabase.from('ag2020_bucket_transactions').insert(rows);
        if (error) throw error;
    }
    return { date, total, allocations: allocs };
}

/**
 * Run allocations for every funding date that hasn't been allocated yet.
 * Returns { processed, skipped, total_allocated }.
 */
export async function runAllocationCatchup(supabase) {
    const { data: fundingDates } = await supabase
        .from('ag2020_daily_funding')
        .select('funding_date, daily_total')
        .gt('daily_total', 0)
        .order('funding_date');
    const { data: existing } = await supabase
        .from('ag2020_bucket_transactions')
        .select('txn_date')
        .eq('source', 'funding_allocation');
    const allocated = new Set((existing || []).map(r => r.txn_date));
    let processed = 0, skipped = 0;
    let totalAllocated = 0;
    for (const f of fundingDates || []) {
        if (allocated.has(f.funding_date)) {
            skipped++;
            continue;
        }
        try {
            const result = await runAllocationForDate(supabase, f.funding_date);
            if (result.allocations && result.allocations.length > 0) {
                processed++;
                totalAllocated += result.total;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error('Allocation error for', f.funding_date, err.message);
        }
    }
    return { processed, skipped, total_allocated: Math.round(totalAllocated * 100) / 100 };
}

/**
 * Refresh daily balance snapshots.
 * Computes the end-of-day balance per bucket per date and upserts to ag2020_bucket_balances.
 */
export async function refreshBalanceSnapshots(supabase) {
    const { data: txns } = await supabase
        .from('ag2020_bucket_transactions')
        .select('txn_date, bucket, direction, amount')
        .order('txn_date');
    if (!txns || txns.length === 0) return { snapshots: 0 };

    // Roll forward per bucket per date
    const dates = [...new Set(txns.map(t => t.txn_date))].sort();
    const runningBalances = Object.fromEntries(BUCKETS.map(b => [b, 0]));
    const dailyInflows = Object.fromEntries(BUCKETS.map(b => [b, {}]));
    const dailyOutflows = Object.fromEntries(BUCKETS.map(b => [b, {}]));

    for (const t of txns) {
        const amt = Number(t.amount) || 0;
        if (t.direction === 'in') {
            runningBalances[t.bucket] += amt;
            dailyInflows[t.bucket][t.txn_date] = (dailyInflows[t.bucket][t.txn_date] || 0) + amt;
        } else {
            runningBalances[t.bucket] -= amt;
            dailyOutflows[t.bucket][t.txn_date] = (dailyOutflows[t.bucket][t.txn_date] || 0) + amt;
        }
    }

    // For each date, snapshot the running balance per bucket using a fresh roll-forward
    const snapshots = [];
    const balanceAt = Object.fromEntries(BUCKETS.map(b => [b, 0]));
    for (const date of dates) {
        for (const b of BUCKETS) {
            balanceAt[b] += (dailyInflows[b][date] || 0) - (dailyOutflows[b][date] || 0);
        }
        for (const b of BUCKETS) {
            snapshots.push({
                snapshot_date: date,
                bucket: b,
                balance: Math.round(balanceAt[b] * 100) / 100,
                inflow_today: Math.round((dailyInflows[b][date] || 0) * 100) / 100,
                outflow_today: Math.round((dailyOutflows[b][date] || 0) * 100) / 100,
                updated_at: new Date().toISOString(),
            });
        }
    }

    // Batch upsert
    const chunkSize = 500;
    for (let i = 0; i < snapshots.length; i += chunkSize) {
        const chunk = snapshots.slice(i, i + chunkSize);
        const { error } = await supabase
            .from('ag2020_bucket_balances')
            .upsert(chunk, { onConflict: 'snapshot_date,bucket' });
        if (error) throw error;
    }
    return { snapshots: snapshots.length, dates: dates.length };
}

/**
 * Build payment recommendation for `lookaheadDays` from today.
 * Pulls upcoming bills + past-due + balances, returns prioritized payment plan.
 */
export async function buildPaymentRecommendation(supabase, lookaheadDays = 7) {
    const today = todayISO();
    const horizonEnd = addDaysISO(today, lookaheadDays);
    const todayDay = parseInt(today.split('-')[2], 10);

    const balances = await getCurrentBalances(supabase);
    const { data: config } = await supabase
        .from('ag2020_bucket_config')
        .select('*')
        .eq('is_active', true)
        .single();

    // Recurring bills due in the next N days
    const { data: bills } = await supabase
        .from('ag2020_bills')
        .select('*')
        .eq('is_active', true);
    const upcoming = [];
    for (const b of bills || []) {
        // Calculate next occurrence of b.due_day on or after today
        const horizonDays = Math.min(lookaheadDays, 31);
        for (let offset = 0; offset <= horizonDays; offset++) {
            const checkDate = new Date(today + 'T00:00:00Z');
            checkDate.setUTCDate(checkDate.getUTCDate() + offset);
            if (checkDate.getUTCDate() === b.due_day) {
                upcoming.push({
                    id: b.id,
                    name: b.name,
                    vendor: b.vendor,
                    amount: Number(b.amount),
                    due_date: checkDate.toISOString().split('T')[0],
                    days_until: offset,
                    bucket: b.bucket,
                    autopay: b.autopay,
                    last_paid_at: b.last_paid_at,
                    category: b.category,
                    type: 'recurring',
                });
                break; // only count next occurrence within horizon
            }
        }
    }

    // Past-due items
    const { data: pastDue } = await supabase
        .from('ag2020_bills_past_due')
        .select('*')
        .eq('is_paid', false)
        .order('priority');
    const pastDueRows = (pastDue || []).map(p => ({
        id: p.id,
        name: p.name,
        vendor: p.vendor,
        amount: Number(p.weekly_payment) > 0 ? Number(p.weekly_payment) : Number(p.amount_remaining),
        amount_remaining: Number(p.amount_remaining),
        due_date: p.target_payoff_date,
        days_until: p.target_payoff_date ?
            Math.round((new Date(p.target_payoff_date) - new Date(today)) / 86400000) : null,
        bucket: p.bucket,
        priority: p.priority,
        type: 'past_due',
    }));

    // Build recommendation
    const recommendations = [];
    const adjustedBalances = { ...balances };
    const operatingFloor = Number(config?.operating_floor) || 0;

    // 1. Highest-priority past-due first
    for (const p of pastDueRows.sort((a, b) => (a.priority || 99) - (b.priority || 99))) {
        const available = adjustedBalances[p.bucket] - (p.bucket === 'operating' ? operatingFloor : 0);
        const canPay = Math.min(available, p.amount);
        if (canPay > 0) {
            recommendations.push({
                ...p,
                recommended_amount: Math.round(canPay * 100) / 100,
                action: canPay >= p.amount ? 'pay_in_full' : 'partial',
                reason: `priority ${p.priority} past-due`,
            });
            adjustedBalances[p.bucket] -= canPay;
        } else {
            recommendations.push({
                ...p,
                recommended_amount: 0,
                action: 'defer',
                reason: `insufficient ${p.bucket} bucket balance`,
            });
        }
    }

    // 2. Recurring bills due in horizon, sorted by due_date
    for (const u of upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date))) {
        const available = adjustedBalances[u.bucket] - (u.bucket === 'operating' ? operatingFloor : 0);
        const canPay = Math.min(available, u.amount);
        if (canPay >= u.amount) {
            recommendations.push({
                ...u,
                recommended_amount: u.amount,
                action: u.autopay ? 'autopay_funded' : 'pay',
                reason: `due ${u.days_until === 0 ? 'today' : 'in ' + u.days_until + ' days'}`,
            });
            adjustedBalances[u.bucket] -= u.amount;
        } else {
            recommendations.push({
                ...u,
                recommended_amount: 0,
                action: u.autopay ? 'autopay_underfunded' : 'defer',
                reason: `${u.bucket} bucket short by $${Math.round((u.amount - available) * 100) / 100}`,
            });
        }
    }

    return {
        today,
        horizon_days: lookaheadDays,
        horizon_end: horizonEnd,
        current_balances: balances,
        projected_balances_after: adjustedBalances,
        operating_floor: operatingFloor,
        recommendations,
        totals: {
            past_due_count: pastDueRows.length,
            upcoming_count: upcoming.length,
            recommended_payments: recommendations.filter(r => r.action !== 'defer' && r.action !== 'autopay_underfunded').length,
            deferred: recommendations.filter(r => r.action === 'defer' || r.action === 'autopay_underfunded').length,
            total_to_pay: recommendations
                .filter(r => r.recommended_amount > 0)
                .reduce((s, r) => s + r.recommended_amount, 0),
        },
    };
}

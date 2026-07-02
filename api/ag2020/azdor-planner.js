/**
 * AG2020 — AZDOR payoff planner
 * GET /api/ag2020/azdor-planner
 *
 * Models the AZ Department of Revenue ($27,404 by default) payoff against
 * the current tax-bucket inflow rate. Returns:
 *  - Days until target hearing date
 *  - Current tax-bucket inflow rate (per day, per week, per month)
 *  - Projected tax bucket at hearing date if no AZDOR payment is made
 *  - Required weekly allocation to fully fund AZDOR by hearing
 *  - Three payment-plan scenarios (lump sum / 3-month / 6-month) with
 *    the implied required revenue lift if current inflow won't cover
 *
 * Reads the AZDOR row from ag2020_bills_past_due where vendor matches
 * 'AZ Department of Revenue' (seeded in the financial-calculator migration).
 */

import { getSupabase, getCurrentBalances } from './_buckets-lib.js';

function daysBetween(fromISO, toISO) {
    return Math.round((new Date(toISO + 'T00:00:00Z') - new Date(fromISO + 'T00:00:00Z')) / 86400000);
}

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

function addDaysISO(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

    try {
        const supabase = getSupabase();

        // 1. Look up the AZDOR row in past-due
        const { data: azdorRow, error: azdorErr } = await supabase
            .from('ag2020_bills_past_due')
            .select('*')
            .ilike('vendor', '%revenue%')
            .eq('is_paid', false)
            .order('priority')
            .limit(1)
            .single();
        if (azdorErr || !azdorRow) {
            return res.status(200).json({
                ok: false,
                error: 'No active AZDOR past-due entry found. Add a row to ag2020_bills_past_due with vendor matching "%revenue%".',
            });
        }

        const balanceRemaining = Number(azdorRow.amount_remaining) || 0;
        const targetDate = azdorRow.target_payoff_date;
        const today = todayISO();
        const daysUntil = targetDate ? daysBetween(today, targetDate) : null;

        // 2. Compute current tax-bucket inflow rate from last 30 days
        const thirtyDaysAgo = addDaysISO(today, -30);
        const { data: taxInflowRows } = await supabase
            .from('ag2020_bucket_transactions')
            .select('amount')
            .eq('bucket', 'tax')
            .eq('direction', 'in')
            .gte('txn_date', thirtyDaysAgo);
        const taxInflow30d = (taxInflowRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const taxInflowPerDay = taxInflow30d / 30;
        const taxInflowPerWeek = taxInflowPerDay * 7;
        const taxInflowPerMonth = taxInflowPerDay * 30;

        // 3. Current tax bucket balance
        const balances = await getCurrentBalances(supabase);
        const currentTaxBalance = balances.tax || 0;

        // 4. Projection: tax bucket at hearing date if no AZDOR payment made
        const projectedTaxAtTarget = daysUntil != null
            ? currentTaxBalance + (taxInflowPerDay * daysUntil)
            : null;

        // 5. Required weekly allocation rate to fund AZDOR by target
        const weeksUntil = daysUntil != null ? Math.max(daysUntil / 7, 0.1) : null;
        const shortfall = balanceRemaining - currentTaxBalance;
        const requiredWeeklyAllocation = weeksUntil != null && shortfall > 0
            ? shortfall / weeksUntil
            : 0;

        // 6. Payment plan scenarios
        const scenarios = [
            {
                name: 'Lump sum at hearing',
                description: `Pay the full $${balanceRemaining.toLocaleString()} balance on or before ${targetDate}.`,
                duration_weeks: weeksUntil,
                weekly_payment: requiredWeeklyAllocation,
                required_tax_inflow_per_week: requiredWeeklyAllocation,
                feasible: taxInflowPerWeek >= requiredWeeklyAllocation,
                weekly_shortfall: Math.max(requiredWeeklyAllocation - taxInflowPerWeek, 0),
            },
            {
                name: '3-month payment plan',
                description: `If AZDOR accepts a 3-month plan, pay $${(balanceRemaining/13).toLocaleString(undefined,{maximumFractionDigits: 0})} weekly across 13 weeks.`,
                duration_weeks: 13,
                weekly_payment: balanceRemaining / 13,
                required_tax_inflow_per_week: balanceRemaining / 13,
                feasible: taxInflowPerWeek >= (balanceRemaining / 13),
                weekly_shortfall: Math.max((balanceRemaining / 13) - taxInflowPerWeek, 0),
            },
            {
                name: '6-month payment plan',
                description: `If AZDOR accepts a 6-month plan, pay $${(balanceRemaining/26).toLocaleString(undefined,{maximumFractionDigits: 0})} weekly across 26 weeks.`,
                duration_weeks: 26,
                weekly_payment: balanceRemaining / 26,
                required_tax_inflow_per_week: balanceRemaining / 26,
                feasible: taxInflowPerWeek >= (balanceRemaining / 26),
                weekly_shortfall: Math.max((balanceRemaining / 26) - taxInflowPerWeek, 0),
            },
        ];

        // 7. Required revenue lift per scenario
        // Tax bucket gets the configured tax_pct (default 8%) of revenue.
        // So required revenue increase = weekly_shortfall / tax_pct
        const { data: config } = await supabase
            .from('ag2020_bucket_config')
            .select('tax_pct')
            .eq('is_active', true)
            .single();
        const taxPct = Number(config?.tax_pct) || 8;

        for (const s of scenarios) {
            if (s.weekly_shortfall > 0) {
                s.required_revenue_lift_per_week = s.weekly_shortfall / (taxPct / 100);
                s.required_revenue_lift_per_month = s.required_revenue_lift_per_week * 4.33;
            } else {
                s.required_revenue_lift_per_week = 0;
                s.required_revenue_lift_per_month = 0;
            }
        }

        return res.status(200).json({
            ok: true,
            azdor: {
                vendor: azdorRow.vendor,
                name: azdorRow.name,
                balance_remaining: balanceRemaining,
                target_payoff_date: targetDate,
                notes: azdorRow.notes,
            },
            today,
            days_until_target: daysUntil,
            current_tax_balance: Math.round(currentTaxBalance * 100) / 100,
            tax_inflow: {
                per_day_30d_avg: Math.round(taxInflowPerDay * 100) / 100,
                per_week_30d_avg: Math.round(taxInflowPerWeek * 100) / 100,
                per_month_30d_avg: Math.round(taxInflowPerMonth * 100) / 100,
                trailing_30d_total: Math.round(taxInflow30d * 100) / 100,
            },
            projected_tax_at_target: projectedTaxAtTarget != null
                ? Math.round(projectedTaxAtTarget * 100) / 100
                : null,
            shortfall_at_target: projectedTaxAtTarget != null
                ? Math.round((balanceRemaining - projectedTaxAtTarget) * 100) / 100
                : null,
            recommended_weekly_allocation: Math.round(requiredWeeklyAllocation * 100) / 100,
            scenarios,
            tax_pct: taxPct,
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * AG2020 — Bucket balances API
 * GET /api/ag2020/bucket-balances
 *
 * Returns current bucket balances, the active config, and recent daily
 * snapshots (default last 90 days). Powers the CEO Dashboard tab.
 *
 * Query params:
 *   ?days=90  — how many days of snapshot history to return
 */

import { getSupabase, getCurrentBalances, BUCKETS } from './_buckets-lib.js';

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    const startISO = startDate.toISOString().split('T')[0];

    try {
        const supabase = getSupabase();

        const [balancesNow, configRes, snapshotsRes, allTxns, fundingRes] = await Promise.all([
            getCurrentBalances(supabase),
            supabase.from('ag2020_bucket_config').select('*').eq('is_active', true).single(),
            supabase.from('ag2020_bucket_balances')
                .select('*')
                .gte('snapshot_date', startISO)
                .order('snapshot_date'),
            supabase.from('ag2020_bucket_transactions')
                .select('bucket, direction, amount'),
            supabase.from('ag2020_daily_funding')
                .select('funding_date, daily_total, lightning_wire, squares, checks, cash, appraisal_checks')
                .gte('funding_date', startISO)
                .order('funding_date'),
        ]);

        const totalCash = BUCKETS.reduce((s, b) => s + (balancesNow[b] || 0), 0);
        const config = configRes.data;
        const snapshots = snapshotsRes.data || [];

        // Group snapshots by date for chart-ready data
        const byDate = {};
        for (const s of snapshots) {
            if (!byDate[s.snapshot_date]) byDate[s.snapshot_date] = { date: s.snapshot_date };
            byDate[s.snapshot_date][s.bucket] = Number(s.balance);
            byDate[s.snapshot_date][`${s.bucket}_in`] = Number(s.inflow_today);
            byDate[s.snapshot_date][`${s.bucket}_out`] = Number(s.outflow_today);
        }
        const timeline = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

        // Lifetime totals per bucket (computed client-side from txns)
        const lifetimeIn = Object.fromEntries(BUCKETS.map(b => [b, 0]));
        const lifetimeOut = Object.fromEntries(BUCKETS.map(b => [b, 0]));
        for (const t of allTxns.data || []) {
            const amt = Number(t.amount) || 0;
            if (t.direction === 'in') lifetimeIn[t.bucket] = (lifetimeIn[t.bucket] || 0) + amt;
            else lifetimeOut[t.bucket] = (lifetimeOut[t.bucket] || 0) + amt;
        }
        for (const b of BUCKETS) {
            lifetimeIn[b] = Math.round(lifetimeIn[b] * 100) / 100;
            lifetimeOut[b] = Math.round(lifetimeOut[b] * 100) / 100;
        }

        // Daily funding received (straight from the synced Google sheet) — the
        // "cash received each day" view. Independent of snapshots so it's always
        // complete. Newest first for the table; also today's + trailing sums.
        const todayISO2 = new Date().toISOString().split('T')[0];
        const w7 = new Date(); w7.setUTCDate(w7.getUTCDate() - 7); const w7ISO = w7.toISOString().split('T')[0];
        const w30 = new Date(); w30.setUTCDate(w30.getUTCDate() - 30); const w30ISO = w30.toISOString().split('T')[0];
        const fundingRows = (fundingRes.data || []).map(r => ({
            date: r.funding_date,
            total: Number(r.daily_total) || 0,
            lightning_wire: Number(r.lightning_wire) || 0,
            squares: Number(r.squares) || 0,
            checks: Number(r.checks) || 0,
            cash: Number(r.cash) || 0,
            appraisal_checks: Number(r.appraisal_checks) || 0,
        }));
        const dailyFundingDesc = [...fundingRows].reverse();
        const fundingToday = fundingRows.filter(r => r.date === todayISO2).reduce((s, r) => s + r.total, 0);
        const funding7 = fundingRows.filter(r => r.date >= w7ISO && r.date <= todayISO2).reduce((s, r) => s + r.total, 0);
        const funding30 = fundingRows.filter(r => r.date >= w30ISO && r.date <= todayISO2).reduce((s, r) => s + r.total, 0);

        return res.status(200).json({
            ok: true,
            balances: balancesNow,
            total_cash: Math.round(totalCash * 100) / 100,
            config,
            timeline,
            lifetime: {
                inflow: lifetimeIn,
                outflow: lifetimeOut,
            },
            daily_funding: dailyFundingDesc,
            funding_summary: {
                today: Math.round(fundingToday * 100) / 100,
                last_7_days: Math.round(funding7 * 100) / 100,
                last_30_days: Math.round(funding30 * 100) / 100,
            },
            days,
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}

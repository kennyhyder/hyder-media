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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    const startISO = startDate.toISOString().split('T')[0];

    try {
        const supabase = getSupabase();

        const [balancesNow, configRes, snapshotsRes, allTxns] = await Promise.all([
            getCurrentBalances(supabase),
            supabase.from('ag2020_bucket_config').select('*').eq('is_active', true).single(),
            supabase.from('ag2020_bucket_balances')
                .select('*')
                .gte('snapshot_date', startISO)
                .order('snapshot_date'),
            supabase.from('ag2020_bucket_transactions')
                .select('bucket, direction, amount'),
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
            days,
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}

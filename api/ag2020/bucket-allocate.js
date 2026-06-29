/**
 * AG2020 — Bucket allocation engine
 * GET /api/ag2020/bucket-allocate
 *
 * Runs the Profit-First allocation for every funding date that hasn't
 * been allocated yet, then refreshes the daily balance snapshots.
 * Idempotent: re-running does not double-allocate.
 *
 * Wired to a daily cron in vercel.json. Also callable on-demand from the
 * dashboard Refresh button.
 */

import { getSupabase, runAllocationCatchup, refreshBalanceSnapshots } from './_buckets-lib.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const result = { started_at: new Date().toISOString() };
    try {
        const supabase = getSupabase();
        const alloc = await runAllocationCatchup(supabase);
        result.allocation = alloc;
        const snap = await refreshBalanceSnapshots(supabase);
        result.snapshots = snap;
        result.finished_at = new Date().toISOString();
        result.ok = true;
        return res.status(200).json(result);
    } catch (err) {
        result.error = err.message;
        result.ok = false;
        return res.status(500).json(result);
    }
}

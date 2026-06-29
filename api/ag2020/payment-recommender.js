/**
 * AG2020 — Payment recommender
 * GET /api/ag2020/payment-recommender?days=7
 *
 * Given today's bucket balances + upcoming bills + past-due items,
 * returns a prioritized recommendation of what to pay today/this week
 * and what to defer. Per-bucket adjustments are simulated so the output
 * reflects the running balance as recommendations are followed.
 */

import { getSupabase, buildPaymentRecommendation } from './_buckets-lib.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 31);

    try {
        const supabase = getSupabase();
        const recommendation = await buildPaymentRecommendation(supabase, days);
        return res.status(200).json({ ok: true, ...recommendation, generated_at: new Date().toISOString() });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}

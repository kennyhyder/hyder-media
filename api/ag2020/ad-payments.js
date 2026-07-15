/**
 * AG2020 — payments made to Google Ads / Meta Ads.
 *
 * GET /api/ag2020/ad-payments?days=30
 *
 * The daily spend ingested from the Google Ads + Meta APIs
 * (cron-ad-spend-daily → ag2020_ad_spend_daily) IS the billing activity —
 * the platforms charge the card as this spend accrues. This endpoint:
 *
 *   1. Aggregates daily totals per platform for the CEO dashboard
 *      (per-day table, month-to-date, last-30-day totals).
 *   2. Mirrors each COMPLETED day's per-platform total into
 *      ag2020_bucket_transactions as an operating-bucket outflow
 *      (source='ad_spend', description='<Platform> daily spend — <date>'),
 *      so bucket balances and the payment recommender reflect money that
 *      actually leaves the account. Idempotent: keyed on
 *      (source, txn_date, description); amounts are corrected in place if a
 *      backfill changes history. Mirroring starts 2026-07-01 — the day after
 *      the single-pot balance anchor (see ag2020-bucketing memory) — so
 *      nothing double-counts the anchored starting balance.
 *
 * Note: card-billing transactions themselves aren't exposed by the Google
 * Ads API for automatic-payment accounts — accrued daily spend is the
 * accurate, available proxy (charges = spend, batched by Google's billing
 * threshold).
 */

import { requireAuth } from './_auth.js';
import { getSupabase, refreshBalanceSnapshots } from './_buckets-lib.js';

const MIRROR_START = '2026-07-01';   // day after the 2026-06-30 balance anchor
const PLATFORM_LABELS = {
    google_ads: 'Google Ads',
    meta_ads: 'Meta Ads',
};

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://hyder.me');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 120);
    const supabase = getSupabase();
    const today = todayISO();

    try {
        const sinceDisplay = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
        const since = sinceDisplay < MIRROR_START ? MIRROR_START : sinceDisplay;

        // Pull spend rows for BOTH display window and mirror window in one query
        const fetchFrom = since < MIRROR_START ? since : MIRROR_START;
        const { data: rows, error } = await supabase
            .from('ag2020_ad_spend_daily')
            .select('platform, date, spend')
            .gte('date', fetchFrom)
            .order('date', { ascending: false })
            .limit(20000);
        if (error) throw error;

        // Aggregate per (date, platform)
        const byDay = {};   // date -> { google_ads: n, meta_ads: n, total: n }
        for (const r of rows || []) {
            const d = r.date;
            if (!byDay[d]) byDay[d] = { google_ads: 0, meta_ads: 0, total: 0 };
            const amt = Number(r.spend) || 0;
            byDay[d][r.platform] = (byDay[d][r.platform] || 0) + amt;
            byDay[d].total += amt;
        }
        for (const d of Object.keys(byDay)) {
            for (const k of Object.keys(byDay[d])) {
                byDay[d][k] = Math.round(byDay[d][k] * 100) / 100;
            }
        }

        // ---- Mirror completed days into bucket outflows (idempotent) ----
        const { data: mirrored } = await supabase
            .from('ag2020_bucket_transactions')
            .select('id, txn_date, description, amount')
            .eq('source', 'ad_spend')
            .gte('txn_date', MIRROR_START);
        const mirrorKey = (date, platform) => `${date}|${PLATFORM_LABELS[platform]} daily spend — ${date}`;
        const existing = new Map((mirrored || []).map(m => [`${m.txn_date}|${m.description}`, m]));

        const inserts = [];
        const updates = [];
        for (const [date, vals] of Object.entries(byDay)) {
            if (date >= today) continue;           // only completed days
            if (date < MIRROR_START) continue;
            for (const platform of ['google_ads', 'meta_ads']) {
                const amt = Math.round((vals[platform] || 0) * 100) / 100;
                if (amt <= 0) continue;
                const desc = `${PLATFORM_LABELS[platform]} daily spend — ${date}`;
                const prior = existing.get(mirrorKey(date, platform));
                if (!prior) {
                    inserts.push({
                        txn_date: date,
                        bucket: 'operating',
                        direction: 'out',
                        amount: amt,
                        description: desc,
                        source: 'ad_spend',
                        reference_table: 'ag2020_ad_spend_daily',
                    });
                } else if (Math.abs(Number(prior.amount) - amt) > 0.01) {
                    updates.push({ id: prior.id, amount: amt });
                }
            }
        }
        if (inserts.length > 0) {
            const { error: insErr } = await supabase.from('ag2020_bucket_transactions').insert(inserts);
            if (insErr) throw insErr;
        }
        for (const u of updates) {
            await supabase.from('ag2020_bucket_transactions').update({ amount: u.amount }).eq('id', u.id);
        }
        if (inserts.length > 0 || updates.length > 0) {
            await refreshBalanceSnapshots(supabase);
        }

        // ---- Display payload ----
        const monthStart = today.slice(0, 8) + '01';
        const sum = (from, to, platform) => Math.round(Object.entries(byDay)
            .filter(([d]) => d >= from && d <= to)
            .reduce((s, [, v]) => s + (v[platform] || 0), 0) * 100) / 100;

        const daily = Object.entries(byDay)
            .filter(([d]) => d >= since)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, v]) => ({ date, google: v.google_ads || 0, meta: v.meta_ads || 0, total: v.total }));

        return res.status(200).json({
            ok: true,
            days,
            daily,
            totals: {
                mtd: {
                    google: sum(monthStart, today, 'google_ads'),
                    meta: sum(monthStart, today, 'meta_ads'),
                },
                window: {
                    google: sum(since, today, 'google_ads'),
                    meta: sum(since, today, 'meta_ads'),
                },
            },
            mirror: {
                start: MIRROR_START,
                inserted: inserts.length,
                corrected: updates.length,
                note: 'Completed days are logged as operating-bucket outflows automatically.',
            },
        });
    } catch (err) {
        console.error('[ag2020 ad-payments]', err);
        return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
    }
}

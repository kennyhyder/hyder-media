/**
 * Dunham bail keyword rank snapshot (cron)
 * GET /api/dunham/bail-rank-snapshot
 *
 * Daily: pulls a 7-day rolling GSC window (query dimension, bail-filtered),
 * matches rows against the tracked set in dunham_bail_keywords, and upserts
 * one row per tracked keyword into dunham_bail_rank_history keyed by the
 * window's end date. Keywords with no impressions in the window are skipped
 * (sparse history is expected for low-volume county terms).
 *
 * Auth (fail-closed): Vercel cron `Authorization: Bearer CRON_SECRET`, or
 * same-origin dashboard call (Referer https://hyder.me/).
 *
 * No-ops cleanly with status 'needs_access' until Dunham grants GSC access —
 * do NOT register in the freshness canary until data is flowing.
 */

import {
    supabase, getGoogleAccessToken, resolveDunhamGscProperty,
    gscQuery, gscWindow, BAIL_REGEX,
} from './_google.js';

export default async function handler(req, res) {
    const auth = req.headers['authorization'] || '';
    const referer = req.headers['referer'] || '';
    const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
    const isSameOrigin = /^https:\/\/(www\.)?hyder\.me\//.test(referer);
    if (!isCron && !isSameOrigin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { startDate, endDate } = gscWindow(7);
    try {
        const sb = supabase();
        const token = await getGoogleAccessToken(sb);
        const prop = await resolveDunhamGscProperty(token);
        if (!prop) {
            return res.status(200).json({
                status: 'needs_access',
                message: 'GSC access to dunhamlaw.com not granted yet — snapshot skipped.',
            });
        }

        // Tracked keyword set
        const { data: tracked, error: kwErr } = await sb
            .from('dunham_bail_keywords').select('keyword');
        if (kwErr) throw new Error(`keywords read: ${kwErr.message}`);
        const trackedSet = new Set(tracked.map(k => k.keyword));

        // One bail-filtered pull covers the whole tracked set (paginate to 25K)
        const byKeyword = new Map();
        for (let startRow = 0; startRow < 25000; startRow += 5000) {
            const rows = await gscQuery(token, prop.siteUrl, {
                startDate, endDate, dimensions: ['query'], rowLimit: 5000, startRow,
                dimensionFilterGroups: [{
                    filters: [{ dimension: 'query', operator: 'includingRegex', expression: BAIL_REGEX }],
                }],
            });
            for (const r of rows) {
                const kw = (r.keys?.[0] || '').toLowerCase();
                if (trackedSet.has(kw) && !byKeyword.has(kw)) {
                    byKeyword.set(kw, {
                        snapshot_date: endDate,
                        keyword: kw,
                        clicks: r.clicks || 0,
                        impressions: r.impressions || 0,
                        ctr: r.ctr || 0,
                        position: r.position || 0,
                    });
                }
            }
            if (rows.length < 5000) break;
        }

        const records = [...byKeyword.values()];
        if (records.length > 0) {
            const { error: upErr } = await sb
                .from('dunham_bail_rank_history')
                .upsert(records, { onConflict: 'snapshot_date,keyword' });
            if (upErr) throw new Error(`history upsert: ${upErr.message}`);
        }

        return res.status(200).json({
            status: 'success',
            property: prop.siteUrl,
            window: { startDate, endDate },
            tracked: trackedSet.size,
            snapshotted: records.length,
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
    }
}

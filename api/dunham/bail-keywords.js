/**
 * Dunham bail keyword scoreboard data
 * GET /api/dunham/bail-keywords[?priority=1]
 *
 * Joins the tracked keyword set (Feb 2026 SEMrush baseline) with the most
 * recent GSC snapshot per keyword from dunham_bail_rank_history.
 * Returns keywords sorted by volume desc.
 */

import { supabase } from './_google.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const sb = supabase();
        let q = sb.from('dunham_bail_keywords').select('*').order('volume', { ascending: false });
        if (req.query.priority === '1') q = q.eq('is_priority', true);
        const { data: keywords, error } = await q;
        if (error) throw new Error(error.message);

        // Latest two snapshot dates give current + trend
        const { data: dates } = await sb
            .from('dunham_bail_rank_history')
            .select('snapshot_date')
            .order('snapshot_date', { ascending: false })
            .limit(1);
        const latestDate = dates?.[0]?.snapshot_date || null;

        let latest = new Map();
        if (latestDate) {
            const { data: snaps, error: sErr } = await sb
                .from('dunham_bail_rank_history')
                .select('keyword, position, clicks, impressions')
                .eq('snapshot_date', latestDate);
            if (sErr) throw new Error(sErr.message);
            latest = new Map(snaps.map(s => [s.keyword, s]));
        }

        return res.status(200).json({
            status: 'success',
            baselineDate: '2026-02-28',
            latestSnapshot: latestDate,
            keywords: keywords.map(k => ({
                keyword: k.keyword,
                metro: k.metro,
                volume: k.volume,
                hasLocalPack: k.has_local_pack,
                isPriority: k.is_priority,
                baselinePosition: k.baseline_position === 999 ? null : Number(k.baseline_position),
                baselineUrl: k.baseline_url,
                current: latest.get(k.keyword) ? {
                    position: Number(latest.get(k.keyword).position?.toFixed?.(1) ?? latest.get(k.keyword).position),
                    clicks: latest.get(k.keyword).clicks,
                    impressions: latest.get(k.keyword).impressions,
                } : null,
            })),
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
    }
}

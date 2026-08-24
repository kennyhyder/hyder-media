/**
 * Dunham citations — status matrix + admin updates
 * GET  /api/dunham/citations-status            → locations, sources, submissions
 * POST /api/dunham/citations-status            → update one submission (guarded)
 *      body: { id, status?, listing_url?, notes?, nap_ok? }
 *      status ∈ planned|queued|submitted|live|verified|needs_fix|rejected|skipped
 *
 * Read is public (dashboard); writes require same-origin or CRON_SECRET.
 */

import { createClient } from '@supabase/supabase-js';

const STATUSES = ['planned', 'queued', 'submitted', 'live', 'verified', 'needs_fix', 'rejected', 'skipped'];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (req.method === 'POST') {
        const auth = req.headers['authorization'] || '';
        const referer = req.headers['referer'] || '';
        const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
            || /^https:\/\/(www\.)?hyder\.me\//.test(referer);
        if (!ok) return res.status(403).json({ error: 'Forbidden' });

        const { id, status, listing_url, notes, nap_ok } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const patch = { updated_at: new Date().toISOString() };
        if (status) {
            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad status' });
            patch.status = status;
            if (status === 'submitted') patch.submitted_at = new Date().toISOString();
            if (status === 'verified') patch.verified_at = new Date().toISOString();
        }
        if (listing_url !== undefined) patch.listing_url = listing_url || null;
        if (notes !== undefined) patch.notes = notes || null;
        if (nap_ok !== undefined) patch.nap_ok = nap_ok;
        const { error } = await sb.from('cit_submissions').update(patch)
            .eq('id', id).eq('client_slug', 'dunham');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    const [locs, sources, subs] = await Promise.all([
        sb.from('cit_locations').select('*').eq('client_slug', 'dunham').order('city'),
        sb.from('cit_sources').select('*').order('pack').order('tier').order('name'),
        sb.from('cit_submissions').select('*').eq('client_slug', 'dunham'),
    ]);
    for (const r of [locs, sources, subs]) {
        if (r.error) return res.status(500).json({ error: r.error.message });
    }
    return res.status(200).json({
        status: 'success',
        locations: locs.data,
        sources: sources.data,
        submissions: subs.data,
    });
}

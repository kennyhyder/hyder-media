/**
 * AG2020 - Autodial deferred-queue drain (Vercel cron)
 *
 * GET /api/ag2020/autodial-cron
 *   Runs on a schedule (see vercel.json). Picks up autodial attempts that were
 *   deferred because they arrived outside AZ business hours, and dials them
 *   once the dial_after time has passed and the office is open.
 *
 *   Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 */

import { createClient } from '@supabase/supabase-js';
import { isBusinessHours, placeCall } from './_autodial-lib.js';

const BATCH = 25;

export default async function handler(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    if (!isBusinessHours()) {
        return res.status(200).json({ status: 'idle', reason: 'outside business hours', dialed: 0 });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: due, error } = await supabase
        .from('ag2020_autodial_attempts')
        .select('id, customer_number')
        .eq('status', 'deferred')
        .lte('dial_after', new Date().toISOString())
        .order('dial_after', { ascending: true })
        .limit(BATCH);

    if (error) return res.status(200).json({ status: 'error', error: error.message });
    if (!due || due.length === 0) {
        return res.status(200).json({ status: 'idle', reason: 'nothing due', dialed: 0 });
    }

    const results = [];
    for (const row of due) {
        // Claim the row first so a concurrent cron run can't double-dial it.
        const { data: claimed } = await supabase
            .from('ag2020_autodial_attempts')
            .update({ status: 'dialing', updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('status', 'deferred')
            .select('id')
            .single();
        if (!claimed) continue; // another run grabbed it

        const r = await placeCall(supabase, row);
        results.push({ id: row.id, ok: r.ok, callSid: r.callSid || null, error: r.error || null });
    }

    return res.status(200).json({
        status: 'success',
        dialed: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results,
    });
}

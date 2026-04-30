/**
 * AG2020 - Missed-call Follow-up history
 * GET /api/ag2020/followups
 *
 * Returns recent rows from ag2020_missed_call_followups so the Leads & Calls
 * tab can show what went out (or didn't).
 *
 * Query params:
 *   limit  - max rows (default 50, max 500)
 *   days   - lookback window in days (default 30)
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const days = parseInt(req.query.days) || 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        // Total count + recent rows
        const [{ count }, { data: rows, error }] = await Promise.all([
            supabase
                .from('ag2020_missed_call_followups')
                .select('id', { count: 'exact', head: true })
                .gte('received_at', since.toISOString()),
            supabase
                .from('ag2020_missed_call_followups')
                .select('id,caller_number,caller_name,called_at,received_at,ac_status,ac_contact_id,ac_deal_id,ac_error,sms_sent,sms_status,sms_error,sms_body,source')
                .gte('received_at', since.toISOString())
                .order('received_at', { ascending: false })
                .limit(limit),
        ]);

        if (error) throw new Error(error.message);

        const items = rows || [];
        const stats = items.reduce((acc, r) => {
            acc.total += 1;
            if (r.ac_status === 'success') acc.acSuccess += 1;
            if (r.ac_error) acc.acErrors += 1;
            if (r.sms_sent) acc.smsSent += 1;
            if (r.sms_error) acc.smsErrors += 1;
            return acc;
        }, { total: 0, acSuccess: 0, acErrors: 0, smsSent: 0, smsErrors: 0 });

        return res.status(200).json({
            status: 'success',
            count: count ?? items.length,
            stats,
            items,
            range: { sinceDays: days, limit },
        });
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

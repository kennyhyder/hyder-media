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

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const days = parseInt(req.query.days) || 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        // Pull from BOTH:
        //   1. ag2020_missed_call_followups — legacy SMS-reply pipeline (Zapier
        //      email-parser → webhook → AC + SMS). Mostly unused now.
        //   2. ag2020_autodial_attempts WHERE source='missed_call' — current
        //      pipeline (missed call → autodial customer → bridge to rep).
        const [legacyAll, autodialAll, legacyItems, autodialItems] = await Promise.all([
            supabase
                .from('ag2020_missed_call_followups')
                .select('id', { count: 'exact', head: true })
                .gte('received_at', since.toISOString()),
            supabase
                .from('ag2020_autodial_attempts')
                .select('id', { count: 'exact', head: true })
                .eq('source', 'missed_call')
                .gte('created_at', since.toISOString()),
            supabase
                .from('ag2020_missed_call_followups')
                .select('id,caller_number,caller_name,called_at,received_at,ac_status,ac_contact_id,ac_deal_id,ac_error,sms_sent,sms_status,sms_error,sms_body,source')
                .gte('received_at', since.toISOString())
                .order('received_at', { ascending: false })
                .limit(limit),
            supabase
                .from('ag2020_autodial_attempts')
                .select('id,customer_number,customer_name,source,status,twilio_call_sid,answered_by,customer_call_status,customer_call_duration,bridge_status,bridge_duration,error,created_at')
                .eq('source', 'missed_call')
                .gte('created_at', since.toISOString())
                .order('created_at', { ascending: false })
                .limit(limit),
        ]);

        const legacyCount = legacyAll.count || 0;
        const autodialCount = autodialAll.count || 0;
        const totalCount = legacyCount + autodialCount;

        const legacyRows = legacyItems.data || [];
        const autodialRows = autodialItems.data || [];

        // Stats — keep the legacy-flavored keys for backward compat with the UI,
        // then add new autodial-specific stats.
        const stats = legacyRows.reduce((acc, r) => {
            acc.total += 1;
            if (r.ac_status === 'success') acc.acSuccess += 1;
            if (r.ac_error) acc.acErrors += 1;
            if (r.sms_sent) acc.smsSent += 1;
            if (r.sms_error) acc.smsErrors += 1;
            return acc;
        }, { total: 0, acSuccess: 0, acErrors: 0, smsSent: 0, smsErrors: 0 });

        const autodialStats = autodialRows.reduce((acc, r) => {
            acc.total += 1;
            if (r.status === 'completed' || r.bridge_status === 'completed') acc.bridged += 1;
            else if (r.status === 'machine' || r.answered_by === 'machine_start') acc.voicemail += 1;
            else if (r.status === 'customer_answered' || r.status === 'dialing') acc.inFlight += 1;
            else if (r.status === 'no_answer' || r.status === 'failed') acc.failed += 1;
            return acc;
        }, { total: 0, bridged: 0, voicemail: 0, inFlight: 0, failed: 0 });

        // Merge items into one timeline (autodial entries get a `kind` discriminator)
        const merged = [
            ...legacyRows.map(r => ({ kind: 'sms_followup', ...r })),
            ...autodialRows.map(r => ({
                kind: 'autodial',
                id: `ad-${r.id}`,
                caller_number: r.customer_number,
                caller_name: r.customer_name,
                received_at: r.created_at,
                source: r.source,
                ac_status: null,
                ac_contact_id: null,
                ac_deal_id: null,
                ac_error: r.error,
                sms_sent: null,
                sms_status: r.status,
                autodial: {
                    status: r.status,
                    answered_by: r.answered_by,
                    customer_call_status: r.customer_call_status,
                    customer_call_duration: r.customer_call_duration,
                    bridge_status: r.bridge_status,
                    bridge_duration: r.bridge_duration,
                    twilio_call_sid: r.twilio_call_sid,
                },
            })),
        ].sort((a, b) => (b.received_at || '').localeCompare(a.received_at || '')).slice(0, limit);

        return res.status(200).json({
            status: 'success',
            count: totalCount, // total triggered (any pipeline)
            stats,             // legacy stat keys — UI compat
            autodialStats,     // NEW pipeline stats
            pipeline: {
                legacy_sms_followups: legacyCount,
                autodial_callbacks: autodialCount,
                primary_pipeline: autodialCount > legacyCount ? 'autodial' : 'sms_legacy',
            },
            items: merged,
            range: { sinceDays: days, limit },
        });
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

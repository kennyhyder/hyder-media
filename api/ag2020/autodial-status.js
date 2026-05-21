/**
 * AG2020 - Autodial status callbacks
 *
 * POST /api/ag2020/autodial-status?attempt=<id>&token=<sig>[&leg=bridge]
 *
 *   default leg  -> Twilio StatusCallback for the customer call leg
 *                   (initiated/ringing/answered/completed/no-answer/busy/...).
 *   leg=bridge   -> the <Dial> action callback fired when the bridge to the
 *                   rep line ends. DialCallStatus tells us whether a rep
 *                   actually connected (completed) or not (no-answer/busy/...).
 *
 * Updates the ag2020_autodial_attempts row. The bridge callback is
 * authoritative for the final outcome of an answered call.
 */

import { createClient } from '@supabase/supabase-js';
import { verifyToken } from './_autodial-lib.js';

const CUSTOMER_FAIL = { 'no-answer': 'no_answer', busy: 'failed', failed: 'failed', canceled: 'failed' };

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const attemptId = parseInt(req.query.attempt, 10);
    const token = req.query.token;
    const leg = (req.query.leg || 'status').toString();

    if (!attemptId || !verifyToken(attemptId, token)) {
        res.setHeader('Content-Type', 'text/xml');
        return res.status(403).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }

    const body = req.body || {};
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const now = new Date().toISOString();

    if (leg === 'bridge') {
        // <Dial> finished — did a rep connect?
        const dialStatus = (body.DialCallStatus || '').toString();
        const dialDuration = parseInt(body.DialCallDuration, 10);
        const connected = dialStatus === 'completed' || dialStatus === 'answered';

        await supabase.from('ag2020_autodial_attempts').update({
            status: connected ? 'completed' : 'rep_no_answer',
            bridge_status: dialStatus || null,
            bridge_duration: isFinite(dialDuration) ? dialDuration : null,
            updated_at: now,
        }).eq('id', attemptId);

        res.setHeader('Content-Type', 'text/xml');
        const tail = connected
            ? '<Response/>'
            : '<Response><Say voice="Polly.Joanna">We could not reach a specialist right now. We will call you right back. Goodbye.</Say><Hangup/></Response>';
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>' + tail);
    }

    // Default: customer-leg StatusCallback.
    const callStatus = (body.CallStatus || '').toString();
    const answeredBy = (body.AnsweredBy || '').toString();
    const callDuration = parseInt(body.CallDuration, 10);

    const patch = { customer_call_status: callStatus || null, updated_at: now };
    if (answeredBy) patch.answered_by = answeredBy;
    if (isFinite(callDuration)) patch.customer_call_duration = callDuration;
    await supabase.from('ag2020_autodial_attempts').update(patch).eq('id', attemptId);

    // Terminal customer-side failure (never answered) — only if still 'dialing'
    // so we don't clobber customer_answered / bridged / machine / completed.
    if (CUSTOMER_FAIL[callStatus]) {
        await supabase.from('ag2020_autodial_attempts')
            .update({ status: CUSTOMER_FAIL[callStatus], updated_at: now })
            .eq('id', attemptId)
            .eq('status', 'dialing');
    }

    return res.status(204).end();
}

/**
 * AG2020 - Unified Call Event Webhook
 * POST /api/ag2020/call-event-webhook
 *
 * Single intake for all VBC call notifications (missed + answered). Lands
 * each call in the ag2020_call_queue for agent triage in the dashboard.
 *
 * For MISSED calls only, we additionally send an immediate Twilio SMS
 * auto-reply so the customer hears back within seconds. AC deal creation is
 * NOT automatic — agents triage from the dashboard and decide which calls
 * deserve a deal card (avoids drowning the team in 100-200 cards/day).
 *
 * Body: {
 *   caller_number:           "+15551234567",   // required
 *   caller_name?:            "John Smith",
 *   called_at?:              "2026-04-29T15:30:00Z",
 *   answered?:               true | false,     // default false
 *   answered_by_extension?:  "201",
 *   answered_by_user?:       "Cash",
 *   ring_duration_seconds?:  18,
 *   source?:                 "zapier" | "make" | "mailgun" | other
 * }
 *
 * Auth: Header X-Webhook-Secret must match env AG2020_MISSED_CALL_WEBHOOK_SECRET.
 * (Reuses the same secret as the existing missed-call-webhook for backward compat
 * with any Zapier configs that already point at the older URL.)
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const DEFAULT_SMS_BODY =
    "Hi! This is Auto Glass 2020 — sorry we missed your call. Reply here with your vehicle year/make/model and we'll get you a quick quote. — Cash";

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const expectedSecret = process.env.AG2020_MISSED_CALL_WEBHOOK_SECRET;
    const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
    if (!expectedSecret) {
        return res.status(503).json({ error: 'Webhook secret not configured on server' });
    }
    if (providedSecret !== expectedSecret) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const body = req.body || {};
    const callerNumber = normalizePhone(body.caller_number);
    const callerName = strOrNull(body.caller_name)?.slice(0, 200) || null;
    const calledAt = body.called_at ? new Date(body.called_at).toISOString() : new Date().toISOString();
    const answered = body.answered === true || body.answered === 'true' || body.answered === 1 || body.answered === '1';
    const answeredByExt = strOrNull(body.answered_by_extension)?.slice(0, 50) || null;
    const answeredByUser = strOrNull(body.answered_by_user)?.slice(0, 200) || null;
    const ringDuration = parseInt(body.ring_duration_seconds, 10);
    const source = strOrNull(body.source)?.slice(0, 50) || 'unknown';

    if (!callerNumber) {
        return res.status(400).json({ error: 'caller_number is required' });
    }

    // Dedupe by caller + minute (multiple notifications for the same call ring
    // events are common — collapse them to one queue row).
    const minuteBucket = calledAt.slice(0, 16); // YYYY-MM-DDTHH:MM
    const callHash = crypto
        .createHash('sha256')
        .update(`${callerNumber}|${minuteBucket}|${ringDuration || 0}`)
        .digest('hex')
        .slice(0, 64);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // For missed calls, fire SMS first (cheaper to skip than to retry).
    let smsResult = { sent: false, sid: null, status: 'skipped', error: null };
    if (!answered) {
        try {
            const smsBody = (process.env.AG2020_TWILIO_SMS_BODY || DEFAULT_SMS_BODY).slice(0, 1500);
            smsResult = await sendTwilioSms(callerNumber, smsBody);
        } catch (err) {
            smsResult.error = err.message;
            smsResult.status = 'error';
        }
    }

    // Upsert into queue (dedupe via call_hash unique constraint)
    const { data: queueRows, error: queueErr } = await supabase
        .from('ag2020_call_queue')
        .upsert({
            call_hash: callHash,
            caller_number: callerNumber,
            caller_name: callerName,
            called_at: calledAt,
            answered,
            answered_by_extension: answeredByExt,
            answered_by_user: answeredByUser,
            ring_duration_seconds: isFinite(ringDuration) ? ringDuration : null,
            direction: 'inbound',
            source,
            raw_payload: body,
            auto_sms_sent: smsResult.sent,
            auto_sms_sid: smsResult.sid,
            auto_sms_status: smsResult.status,
            auto_sms_error: smsResult.error,
        }, { onConflict: 'call_hash', ignoreDuplicates: false })
        .select('id, triaged_at')
        .limit(1);

    const queueRow = (queueRows && queueRows[0]) || null;
    const wasNew = queueRow && !queueRow.triaged_at;

    return res.status(200).json({
        status: 'success',
        callerNumber,
        callerName,
        calledAt,
        answered,
        queue: {
            id: queueRow?.id || null,
            inserted: wasNew,
            error: queueErr?.message || null,
        },
        sms: smsResult,
    });
}

// ============================================================================
// Helpers
// ============================================================================

function strOrNull(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
}

function normalizePhone(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/[^\d+]/g, '');
    if (!s) return null;
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    else if (!s.startsWith('+')) s = '+' + s;
    return s.slice(0, 20);
}

async function sendTwilioSms(toNumber, body) {
    const sid = process.env.AG2020_TWILIO_ACCOUNT_SID;
    const token = process.env.AG2020_TWILIO_AUTH_TOKEN;
    const from = process.env.AG2020_TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
        return { sent: false, sid: null, status: 'skipped', error: 'Twilio not configured', body };
    }

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const params = new URLSearchParams({
        To: toNumber,
        From: from,
        Body: body,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Twilio ${response.status}: ${data.message || JSON.stringify(data).slice(0, 300)}`);
    }
    return { sent: true, sid: data.sid, status: data.status || 'queued', error: null, body };
}

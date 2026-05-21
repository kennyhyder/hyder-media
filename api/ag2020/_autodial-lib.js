/**
 * AG2020 Autodial — shared helpers.
 *
 * Underscore-prefixed so Vercel does NOT treat this as a routable function.
 * Imported by autodial.js, autodial-twiml.js, autodial-status.js, autodial-cron.js.
 *
 * Speed-to-lead flow (customer-first bridge):
 *   1. A lead arrives (web form submit -> AC automation webhook, or later a
 *      missed call via CallRail). /api/ag2020/autodial records an attempt row.
 *   2. Twilio places an outbound call TO THE CUSTOMER from a local number.
 *   3. When the customer answers, Twilio fetches autodial-twiml, which plays a
 *      short hold message then <Dial>s AG2020's inbound rep line — bridging the
 *      customer to whichever rep picks up.
 *   4. Twilio StatusCallbacks + the <Dial> action callback update the row.
 *
 * Env vars:
 *   AG2020_TWILIO_ACCOUNT_SID      (required)
 *   AG2020_TWILIO_AUTH_TOKEN       (required)
 *   AG2020_AUTODIAL_FROM_NUMBER    number shown to the customer; falls back to
 *                                  AG2020_TWILIO_FROM_NUMBER. Use a LOCAL AZ
 *                                  number for answer rates.
 *   AG2020_REP_INBOUND_NUMBER      (required) the sales line to bridge to.
 *   AG2020_AUTODIAL_SECRET         shared secret for the trigger webhook;
 *                                  falls back to AG2020_MISSED_CALL_WEBHOOK_SECRET.
 *   AG2020_PUBLIC_BASE_URL         base for Twilio callback URLs (default https://hyder.me).
 */

import crypto from 'crypto';

// Arizona observes no DST — fixed UTC-7 year round. Reps are Phoenix-based.
const AZ_OFFSET_MS = -7 * 3600 * 1000;
const BUSINESS_OPEN_HOUR = 7;    // 7:00 AM AZ
const BUSINESS_CLOSE_HOUR = 18;  // 6:00 PM AZ
// Mon–Sat (0 = Sun). Sunday is closed.
const BUSINESS_DAYS = new Set([1, 2, 3, 4, 5, 6]);

export const DEDUPE_HOURS = 6;   // don't re-dial the same number within this window

// ---------------------------------------------------------------------------
// Config accessors
// ---------------------------------------------------------------------------

export function baseUrl() {
    return (process.env.AG2020_PUBLIC_BASE_URL || 'https://hyder.me').replace(/\/$/, '');
}

export function autodialSecret() {
    return process.env.AG2020_AUTODIAL_SECRET || process.env.AG2020_MISSED_CALL_WEBHOOK_SECRET || '';
}

export function twilioCreds() {
    return {
        sid: process.env.AG2020_TWILIO_ACCOUNT_SID,
        token: process.env.AG2020_TWILIO_AUTH_TOKEN,
        from: process.env.AG2020_AUTODIAL_FROM_NUMBER || process.env.AG2020_TWILIO_FROM_NUMBER,
        repNumber: process.env.AG2020_REP_INBOUND_NUMBER,
    };
}

// ---------------------------------------------------------------------------
// Phone / token utilities
// ---------------------------------------------------------------------------

export function normalizePhone(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/[^\d+]/g, '');
    if (!s) return null;
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    else if (!s.startsWith('+')) s = '+' + s;
    return s.slice(0, 20);
}

/** Per-attempt token so Twilio callback URLs can't be forged/replayed by randoms. */
export function signToken(attemptId) {
    return crypto.createHmac('sha256', autodialSecret())
        .update('autodial:' + String(attemptId))
        .digest('hex')
        .slice(0, 32);
}

export function verifyToken(attemptId, token) {
    if (!token) return false;
    const expected = signToken(attemptId);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(token));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Business hours
// ---------------------------------------------------------------------------

/** A Date whose UTC fields read as Arizona wall-clock time. */
function azWallClock(d = new Date()) {
    return new Date(d.getTime() + AZ_OFFSET_MS);
}

export function isBusinessHours(d = new Date()) {
    const az = azWallClock(d);
    const day = az.getUTCDay();
    const hour = az.getUTCHours();
    return BUSINESS_DAYS.has(day) && hour >= BUSINESS_OPEN_HOUR && hour < BUSINESS_CLOSE_HOUR;
}

/** Real UTC instant of the next business-hours open (used to schedule deferred dials). */
export function nextBusinessOpen(d = new Date()) {
    const az = azWallClock(d);
    // Candidate = today at open hour, in AZ wall-clock terms.
    const cand = new Date(Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate(),
        BUSINESS_OPEN_HOUR, 0, 0));
    const todayStillOpensLater = BUSINESS_DAYS.has(az.getUTCDay()) && az.getUTCHours() < BUSINESS_OPEN_HOUR;
    if (!todayStillOpensLater) cand.setUTCDate(cand.getUTCDate() + 1);
    while (!BUSINESS_DAYS.has(cand.getUTCDay())) cand.setUTCDate(cand.getUTCDate() + 1);
    // Convert AZ wall-clock back to a real UTC instant.
    return new Date(cand.getTime() - AZ_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

/**
 * Place the outbound call to the customer for a given attempt row and update
 * the row with the Twilio call SID (or an error). Used by the trigger handler
 * and by the deferred-dial cron.
 */
export async function placeCall(supabase, row) {
    const { sid, token, from, repNumber } = twilioCreds();
    if (!sid || !token || !from) {
        await supabase.from('ag2020_autodial_attempts')
            .update({ status: 'failed', error: 'Twilio not configured', updated_at: new Date().toISOString() })
            .eq('id', row.id);
        return { ok: false, error: 'Twilio not configured' };
    }
    if (!repNumber) {
        await supabase.from('ag2020_autodial_attempts')
            .update({ status: 'failed', error: 'AG2020_REP_INBOUND_NUMBER not set', updated_at: new Date().toISOString() })
            .eq('id', row.id);
        return { ok: false, error: 'AG2020_REP_INBOUND_NUMBER not set' };
    }

    const tok = signToken(row.id);
    const answerUrl = `${baseUrl()}/api/ag2020/autodial-twiml?attempt=${row.id}&token=${tok}`;
    const statusUrl = `${baseUrl()}/api/ag2020/autodial-status?attempt=${row.id}&token=${tok}`;

    const params = new URLSearchParams();
    params.set('To', row.customer_number);
    params.set('From', from);
    params.set('Url', answerUrl);
    params.set('Method', 'POST');
    params.set('StatusCallback', statusUrl);
    params.set('StatusCallbackMethod', 'POST');
    params.append('StatusCallbackEvent', 'initiated');
    params.append('StatusCallbackEvent', 'ringing');
    params.append('StatusCallbackEvent', 'answered');
    params.append('StatusCallbackEvent', 'completed');
    // Answering-machine detection: if voicemail picks up we hang up instead of
    // bridging a rep to a recording. AnsweredBy is passed to the answer URL.
    params.set('MachineDetection', 'Enable');
    params.set('MachineDetectionTimeout', '15');
    params.set('Timeout', '25'); // customer ring time

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    try {
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(`Twilio ${resp.status}: ${data.message || JSON.stringify(data).slice(0, 300)}`);
        }
        await supabase.from('ag2020_autodial_attempts')
            .update({
                status: 'dialing',
                twilio_call_sid: data.sid,
                customer_call_status: data.status || 'queued',
                rep_number: repNumber,
                updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        return { ok: true, callSid: data.sid };
    } catch (err) {
        await supabase.from('ag2020_autodial_attempts')
            .update({ status: 'failed', error: err.message, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        return { ok: false, error: err.message };
    }
}

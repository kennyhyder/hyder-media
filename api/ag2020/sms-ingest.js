/**
 * AG2020 — Inbound SMS ingest endpoint
 *
 * POST /api/ag2020/sms-ingest
 *
 * Receives inbound SMS events (typically from a Twilio Studio Flow's "Make
 * HTTP Request" widget OR direct from a Twilio number's SMS webhook) and
 * writes a lead_touchpoint of type 'sms_inbound', creating a lead_journey
 * for the caller if they're not already in the data plane.
 *
 * This closes the SMS leg of the attribution loop WITHOUT touching Alive5 —
 * the existing Twilio Studio Flows that forward SMS to the AG2020 Vonage
 * main line for Alive5 monitoring keep working unchanged; this endpoint
 * just captures a parallel copy.
 *
 * Body shape (flexible, supports both Twilio-native and custom JSON):
 *   - Twilio native form-encoded: `From`, `Body`, `To`, `MessageSid`, …
 *   - Or JSON: `{ from, body, to, message_sid }`
 *
 * Auth: header `X-Webhook-Secret` or `?secret=` must match
 *       AG2020_AUTODIAL_SECRET (the funnel-wide webhook secret).
 *
 * Returns: empty TwiML `<Response/>` (so it can be safely plugged into a
 * Studio Flow's HTTP widget without injecting an SMS reply).
 */

import { createClient } from '@supabase/supabase-js';
import { upsertJourney, insertTouchpoint } from './_attribution-lib.js';

const TENANT = 'ag2020';

function twiml(status, body = '<Response/>') {
    return { status, headers: { 'Content-Type': 'text/xml' }, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Auth (lenient — we still return 200 to Twilio to avoid retries on auth fails)
    const expected = process.env.AG2020_AUTODIAL_SECRET || process.env.AG2020_MISSED_CALL_WEBHOOK_SECRET;
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (!expected) {
        res.setHeader('Content-Type', 'text/xml');
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }
    if (provided !== expected) {
        res.setHeader('Content-Type', 'text/xml');
        return res.status(401).send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }

    const body = req.body || {};
    // Support both Twilio's PascalCase form fields and snake_case JSON.
    const fromPhone = body.From || body.from || null;
    const toPhone = body.To || body.to || null;
    const messageBody = body.Body || body.body || null;
    const messageSid = body.MessageSid || body.message_sid || null;
    const fromCity = body.FromCity || null;
    const fromState = body.FromState || null;
    const numMedia = parseInt(body.NumMedia || body.num_media || '0', 10);

    if (!fromPhone) {
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    let journeyId = null, errorMsg = null;
    try {
        journeyId = await upsertJourney(supabase, TENANT, {
            phone: fromPhone,
            firstTouchAt: new Date().toISOString(),
            firstTouchSource: 'sms_inbound',
            firstTouchChannel: 'twilio',
            rawFirstTouch: { twilio_message_sid: messageSid, to: toPhone, source: 'sms-ingest' },
        });
        await insertTouchpoint(supabase, TENANT, journeyId, {
            touchpointType: 'sms_inbound',
            source: 'sms_inbound',
            channel: 'twilio',
            direction: 'inbound',
            payload: {
                twilio_message_sid: messageSid,
                from: fromPhone,
                to: toPhone,
                body: messageBody,
                from_city: fromCity,
                from_state: fromState,
                num_media: numMedia,
                raw: body,
            },
        });
    } catch (err) {
        errorMsg = err.message;
        console.error('sms-ingest failed:', err.message);
    }

    // Empty TwiML so a Twilio Studio HTTP widget plugs in cleanly without
    // injecting an SMS reply to the customer.
    res.setHeader('Content-Type', 'text/xml');
    res.setHeader('X-Journey-Id', journeyId ? String(journeyId) : '');
    if (errorMsg) res.setHeader('X-Ingest-Error', errorMsg.slice(0, 200));
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

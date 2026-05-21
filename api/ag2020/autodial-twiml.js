/**
 * AG2020 - Autodial TwiML
 *
 * Twilio fetches this when the customer answers the autodial call.
 * GET/POST /api/ag2020/autodial-twiml?attempt=<id>&token=<sig>[&leg=whisper]
 *
 *   default leg  -> customer just answered. If answering-machine detection
 *                   flagged voicemail, hang up. Otherwise play a short hold
 *                   message and <Dial> AG2020's inbound rep line, bridging the
 *                   customer to whichever rep picks up.
 *   leg=whisper  -> played to the REP when they answer the bridged leg, so
 *                   they know it's an autodialed web lead before connecting.
 *
 * Returns TwiML (text/xml). Twilio passes AnsweredBy (AMD result) on the
 * default leg. The <Dial> action callback goes to autodial-status?leg=bridge.
 */

import { createClient } from '@supabase/supabase-js';
import { verifyToken, twilioCreds, baseUrl, signToken } from './_autodial-lib.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/xml');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const attemptId = parseInt(req.query.attempt, 10);
    const token = req.query.token;
    const leg = (req.query.leg || 'customer').toString();

    if (!attemptId || !verifyToken(attemptId, token)) {
        return res.status(403).send(xml(`<Response><Hangup/></Response>`));
    }

    // Whisper to the rep — no DB needed.
    if (leg === 'whisper') {
        return res.status(200).send(xml(
            `<Response><Say voice="Polly.Joanna">New Auto Glass 2020 web lead. Connecting you now.</Say></Response>`
        ));
    }

    const { from, repNumber } = twilioCreds();
    const body = req.body || {};
    const answeredBy = (body.AnsweredBy || req.query.AnsweredBy || '').toString();
    const isMachine = answeredBy.startsWith('machine') || answeredBy === 'fax';

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Voicemail / machine picked up — don't bridge a rep to a recording.
    if (isMachine) {
        await supabase.from('ag2020_autodial_attempts')
            .update({ status: 'machine', answered_by: answeredBy, updated_at: new Date().toISOString() })
            .eq('id', attemptId)
            .eq('status', 'dialing')
            .then(() => {}, () => {});
        return res.status(200).send(xml(`<Response><Hangup/></Response>`));
    }

    if (!repNumber) {
        return res.status(200).send(xml(
            `<Response><Say voice="Polly.Joanna">We're sorry, we can't connect your call right now. Please call us back. Goodbye.</Say><Hangup/></Response>`
        ));
    }

    // Customer answered (human / unknown) — record and bridge to the rep line.
    await supabase.from('ag2020_autodial_attempts')
        .update({ status: 'customer_answered', answered_by: answeredBy || 'unknown', updated_at: new Date().toISOString() })
        .eq('id', attemptId)
        .eq('status', 'dialing')
        .then(() => {}, () => {});

    const tok = signToken(attemptId);
    const actionUrl = `${baseUrl()}/api/ag2020/autodial-status?attempt=${attemptId}&token=${tok}&leg=bridge`;
    const whisperUrl = `${baseUrl()}/api/ag2020/autodial-twiml?attempt=${attemptId}&token=${tok}&leg=whisper`;

    // answerOnBridge keeps ringback playing to the customer until a rep truly
    // answers (no dead air). The whisper url plays only to the rep.
    return res.status(200).send(xml(
        `<Response>` +
        `<Say voice="Polly.Joanna">Thanks for contacting Auto Glass 2020. Please hold while we connect you with a glass specialist.</Say>` +
        `<Dial answerOnBridge="true" callerId="${esc(from)}" timeout="25" action="${esc(actionUrl)}" method="POST">` +
        `<Number url="${esc(whisperUrl)}" method="POST">${esc(repNumber)}</Number>` +
        `</Dial>` +
        `<Say voice="Polly.Joanna">We could not reach a specialist. We'll call you right back. Goodbye.</Say>` +
        `</Response>`
    ));
}

function xml(s) {
    return `<?xml version="1.0" encoding="UTF-8"?>${s}`;
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

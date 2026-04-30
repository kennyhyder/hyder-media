/**
 * AG2020 - Vonage Missed-Call Webhook
 * POST /api/ag2020/missed-call-webhook
 *
 * Designed to be called by an email-parsing service (Zapier "Email Parser",
 * Make / Integromat email module, Mailgun Inbound, etc.) after VBC sends a
 * missed-call email notification. The parser pulls caller phone + name out
 * of the email body, then POSTs here.
 *
 * Body: {
 *   caller_number: "+15551234567",      // required
 *   caller_name?:  "John Smith",
 *   called_at?:    "2026-04-29T15:30:00Z",
 *   source?:       "zapier" | "make" | "manual" | "mailgun" | other
 * }
 *
 * Auth: Header `X-Webhook-Secret` must match env AG2020_MISSED_CALL_WEBHOOK_SECRET.
 *
 * Side effects (best-effort, partial success returns 200):
 *   1. Find or create ActiveCampaign contact (tag: "Missed Call - Vonage")
 *   2. Create an ActiveCampaign deal in the missed-call follow-up pipeline
 *   3. Send a Twilio SMS auto-reply
 *   4. Audit row into ag2020_missed_call_followups
 *
 * Env vars used (all optional except SUPABASE_*):
 *   AG2020_MISSED_CALL_WEBHOOK_SECRET  - shared secret with the email parser
 *   AG2020_ACTIVECAMPAIGN_URL          - existing
 *   AG2020_ACTIVECAMPAIGN_KEY          - existing
 *   AG2020_AC_MISSED_CALL_TAG_ID       - tag id to apply (default: skip)
 *   AG2020_AC_MISSED_CALL_PIPELINE_ID  - deal pipeline id (default: skip deal)
 *   AG2020_AC_MISSED_CALL_STAGE_ID     - deal stage id (default: skip deal)
 *   AG2020_AC_MISSED_CALL_OWNER_ID     - deal owner user id (default: 1)
 *   AG2020_TWILIO_ACCOUNT_SID
 *   AG2020_TWILIO_AUTH_TOKEN
 *   AG2020_TWILIO_FROM_NUMBER
 *   AG2020_TWILIO_SMS_BODY             - override default SMS template
 */

import { createClient } from '@supabase/supabase-js';

const DEFAULT_SMS_BODY =
    "Hi! This is Auto Glass 2020 — sorry we missed your call. Reply here with your vehicle year/make/model and we'll get you a quick quote. — Cash";

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Auth
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
    const callerName = (body.caller_name || '').toString().trim().slice(0, 200) || null;
    const calledAt = body.called_at ? new Date(body.called_at).toISOString() : new Date().toISOString();
    const source = (body.source || 'unknown').toString().slice(0, 50);

    if (!callerNumber) {
        return res.status(400).json({ error: 'caller_number is required' });
    }

    const result = {
        callerNumber,
        callerName,
        calledAt,
        ac: { contactId: null, dealId: null, status: 'skipped', error: null },
        sms: { sent: false, sid: null, status: 'skipped', error: null },
    };

    // ActiveCampaign: contact + deal
    try {
        const ac = await pushToActiveCampaign(callerNumber, callerName);
        result.ac = ac;
    } catch (err) {
        result.ac.error = err.message;
        result.ac.status = 'error';
    }

    // Twilio: SMS auto-reply
    try {
        const smsBody = (process.env.AG2020_TWILIO_SMS_BODY || DEFAULT_SMS_BODY).slice(0, 1500);
        const sms = await sendTwilioSms(callerNumber, smsBody);
        result.sms = sms;
    } catch (err) {
        result.sms.error = err.message;
        result.sms.status = 'error';
    }

    // Audit
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        await supabase.from('ag2020_missed_call_followups').insert({
            caller_number: callerNumber,
            caller_name: callerName,
            called_at: calledAt,
            ac_contact_id: result.ac.contactId,
            ac_deal_id: result.ac.dealId,
            ac_status: result.ac.status,
            ac_error: result.ac.error,
            sms_sent: result.sms.sent,
            sms_sid: result.sms.sid,
            sms_status: result.sms.status,
            sms_error: result.sms.error,
            sms_body: result.sms.body || null,
            source,
            raw_payload: body,
        });
    } catch (err) {
        // Non-fatal; the operational side effects already ran.
        result.auditError = err.message;
    }

    return res.status(200).json({ status: 'success', ...result });
}

// ============================================================================
// Helpers
// ============================================================================

function normalizePhone(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/[^\d+]/g, '');
    if (!s) return null;
    // If 10 digits and no +, assume US
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    else if (!s.startsWith('+')) s = '+' + s;
    return s.slice(0, 20);
}

// ----- ActiveCampaign -----

async function pushToActiveCampaign(phone, name) {
    const url = process.env.AG2020_ACTIVECAMPAIGN_URL;
    const key = process.env.AG2020_ACTIVECAMPAIGN_KEY;
    if (!url || !key) {
        return { contactId: null, dealId: null, status: 'skipped', error: 'AC not configured' };
    }
    const base = url.replace(/\/$/, '') + '/api/3';
    const headers = {
        'Api-Token': key,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    // 1. Sync contact (creates or updates by email — but we have a phone, not email,
    //    so use POST /contact/sync with phone-only payload. AC accepts contacts with
    //    no email when source=phone).
    let contactId = null;
    const firstName = name ? name.split(/\s+/)[0] : '';
    const lastName = name ? name.split(/\s+/).slice(1).join(' ') : '';

    // AC requires email for /contact/sync. For phone-only contacts, search first by phone,
    // fall back to creating a contact with a placeholder email pattern.
    const search = await fetch(`${base}/contacts?filters[phone]=${encodeURIComponent(phone)}&limit=1`, { headers });
    const searchData = await search.json();
    if (search.ok && searchData.contacts && searchData.contacts.length > 0) {
        contactId = searchData.contacts[0].id;
    } else {
        // Create with placeholder email — AC requires it
        const syntheticEmail = `${phone.replace(/\D/g, '')}@phone.autoglass2020.com`;
        const createBody = {
            contact: {
                email: syntheticEmail,
                phone,
                firstName: firstName || undefined,
                lastName: lastName || undefined,
            },
        };
        const create = await fetch(`${base}/contact/sync`, {
            method: 'POST',
            headers,
            body: JSON.stringify(createBody),
        });
        const createData = await create.json();
        if (!create.ok || !createData.contact) {
            throw new Error(`AC contact create failed: ${JSON.stringify(createData).slice(0, 300)}`);
        }
        contactId = createData.contact.id;
    }

    // 2. Apply tag if configured
    const tagId = process.env.AG2020_AC_MISSED_CALL_TAG_ID;
    if (tagId) {
        await fetch(`${base}/contactTags`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }),
        }).catch(() => { /* non-fatal */ });
    }

    // 3. Create deal if pipeline + stage configured
    let dealId = null;
    const pipelineId = process.env.AG2020_AC_MISSED_CALL_PIPELINE_ID;
    const stageId = process.env.AG2020_AC_MISSED_CALL_STAGE_ID;
    const ownerId = process.env.AG2020_AC_MISSED_CALL_OWNER_ID || '1';
    if (pipelineId && stageId) {
        const dealBody = {
            deal: {
                title: `Missed call — ${name || phone}`,
                contact: contactId,
                value: 0,
                currency: 'usd',
                group: pipelineId,
                stage: stageId,
                owner: ownerId,
            },
        };
        const dealRes = await fetch(`${base}/deals`, {
            method: 'POST',
            headers,
            body: JSON.stringify(dealBody),
        });
        const dealData = await dealRes.json();
        if (dealRes.ok && dealData.deal) {
            dealId = dealData.deal.id;
        }
    }

    return { contactId, dealId, status: 'success', error: null };
}

// ----- Twilio -----

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
    return {
        sent: true,
        sid: data.sid,
        status: data.status || 'queued',
        error: null,
        body,
    };
}

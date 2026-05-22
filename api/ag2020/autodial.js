/**
 * AG2020 - Autodial trigger
 *
 * POST /api/ag2020/autodial
 *   Trigger a speed-to-lead callback. Place an outbound Twilio call to the
 *   customer; on answer they are bridged to AG2020's inbound rep line.
 *
 *   Auth: header `X-Webhook-Secret` OR `?secret=` must match
 *         AG2020_AUTODIAL_SECRET (falls back to AG2020_MISSED_CALL_WEBHOOK_SECRET).
 *
 *   Accepts JSON or form-encoded (ActiveCampaign "Webhook" automation action
 *   posts form-encoded contact[...] fields). Recognized fields:
 *     phone | customer_number | contact[phone]        -> customer number (required)
 *     name  | customer_name   | contact[first_name]+contact[last_name]
 *     source                  -> 'form_submit' (default) | 'missed_call' | 'manual'
 *     ac_contact_id | contact[id]
 *
 *   Behavior:
 *     - Within AZ business hours (Mon-Sat 7am-6pm): dials immediately.
 *     - Outside hours: row is saved 'deferred'; autodial-cron dials it at open.
 *     - De-dupes: same number triggered within DEDUPE_HOURS is skipped.
 *
 * GET /api/ag2020/autodial?secret=...&limit=50
 *   List recent attempts (for the dashboard).
 */

import { createClient } from '@supabase/supabase-js';
import {
    normalizePhone, autodialSecret, isBusinessHours, nextBusinessOpen,
    placeCall, DEDUPE_HOURS,
} from './_autodial-lib.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const expected = autodialSecret();
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (!expected) return res.status(503).json({ error: 'Autodial secret not configured on server' });
    if (provided !== expected) return res.status(401).json({ error: 'Invalid secret' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (req.method === 'GET') return handleList(req, res, supabase);
    if (req.method === 'POST') return handleTrigger(req, res, supabase);
    return res.status(405).json({ error: 'Method not allowed' });
}

async function handleList(req, res, supabase) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { data, error } = await supabase
        .from('ag2020_autodial_attempts')
        .select('id,customer_number,customer_name,source,status,dial_after,answered_by,customer_call_status,customer_call_duration,bridge_status,bridge_duration,error,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) return res.status(200).json({ status: 'error', error: error.message });
    return res.status(200).json({ status: 'success', count: data.length, items: data });
}

async function handleTrigger(req, res, supabase) {
    const body = req.body || {};
    // ActiveCampaign's Webhook action posts contact[...] fields; depending on
    // the body parser these arrive nested ({contact:{phone}}) or flat
    // ({'contact[phone]'}). Read whichever is present.
    const c = (body.contact && typeof body.contact === 'object') ? body.contact : {};
    const cf = (k) => c[k] ?? body[`contact[${k}]`];

    const rawPhone = body.phone || body.customer_number || cf('phone');
    const customerNumber = normalizePhone(rawPhone);
    const name = strOrNull(
        body.name || body.customer_name ||
        [cf('first_name'), cf('last_name')].filter(Boolean).join(' ')
    )?.slice(0, 200) || null;
    const source = strOrNull(body.source)?.slice(0, 50) || 'form_submit';
    const acContactId = strOrNull(body.ac_contact_id || cf('id'))?.slice(0, 50) || null;

    // --- ActiveCampaign trigger gating (fail-closed) ---------------------
    // AG2020's lead forms don't subscribe contacts to a list, so AC fires no
    // usable subscribe / contact-created event — but every new lead receives
    // the "NEW LEAD ALERT" tag. We trigger on the `contact_tag_added` event
    // and only proceed when the added tag is in AG2020_AUTODIAL_TAGS (matched
    // by tag name OR id, case-insensitive; the payload key/shape varies). Any
    // other AC webhook is logged and skipped — never dialed (fail-closed).
    // Non-AC triggers (manual, missed_call) carry no `type` and pass through.
    const isAcWebhook = body.type != null;
    if (isAcWebhook) {
        const allowTags = (process.env.AG2020_AUTODIAL_TAGS || '')
            .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const tagCandidates = extractAcTags(body);
        const matched = body.type === 'contact_tag_added'
            && tagCandidates.some(t => allowTags.includes(t.toLowerCase()));
        if (!matched) {
            // Log with the full payload so the real AC shape stays auditable.
            await supabase.from('ag2020_autodial_attempts').insert({
                customer_number: customerNumber || 'unknown',
                customer_name: name,
                source: 'form_submit',
                ac_contact_id: acContactId,
                trigger_payload: body,
                status: 'skipped_form',
                error: `AC webhook type=${body.type}; tags=[${tagCandidates.join('|') || 'none'}] not an autodial trigger`,
            });
            return res.status(200).json({
                status: 'skipped',
                reason: 'not_autodial_trigger',
                type: String(body.type),
                tags: tagCandidates,
            });
        }
    }

    if (!customerNumber) {
        return res.status(400).json({ error: 'A customer phone number is required (phone | customer_number | contact[phone])' });
    }

    // De-dupe: skip if this number was already triggered recently.
    const since = new Date(Date.now() - DEDUPE_HOURS * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
        .from('ag2020_autodial_attempts')
        .select('id,status,created_at')
        .eq('customer_number', customerNumber)
        .gte('created_at', since)
        .not('status', 'in', '(failed,skipped_duplicate)')
        .limit(1);

    if (recent && recent.length > 0) {
        await supabase.from('ag2020_autodial_attempts').insert({
            customer_number: customerNumber, customer_name: name, source,
            ac_contact_id: acContactId, trigger_payload: body,
            status: 'skipped_duplicate',
            error: `Dialed within last ${DEDUPE_HOURS}h (attempt #${recent[0].id})`,
        });
        return res.status(200).json({
            status: 'skipped', reason: 'duplicate',
            message: `${customerNumber} was already triggered in the last ${DEDUPE_HOURS}h`,
        });
    }

    const open = isBusinessHours();
    const insertRow = {
        customer_number: customerNumber,
        customer_name: name,
        source,
        ac_contact_id: acContactId,
        trigger_payload: body,
        status: open ? 'dialing' : 'deferred',
        dial_after: open ? null : nextBusinessOpen().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase
        .from('ag2020_autodial_attempts')
        .insert(insertRow)
        .select('id')
        .single();

    if (insErr || !inserted) {
        return res.status(500).json({ error: `DB insert failed: ${insErr?.message || 'unknown'}` });
    }

    if (!open) {
        return res.status(200).json({
            status: 'deferred',
            id: inserted.id,
            customerNumber,
            message: 'Outside AZ business hours — call scheduled.',
            dialAfter: insertRow.dial_after,
        });
    }

    const result = await placeCall(supabase, { id: inserted.id, customer_number: customerNumber });
    return res.status(200).json({
        status: result.ok ? 'dialing' : 'error',
        id: inserted.id,
        customerNumber,
        callSid: result.callSid || null,
        error: result.error || null,
    });
}

function strOrNull(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
}

// The contact_tag_added payload may carry the added tag under several keys, as
// a scalar (name or id) or an object — collect every plausible representation
// so the allowlist match works regardless of AC's exact payload shape.
function extractAcTags(body) {
    const out = [];
    const push = (v) => { if (v != null && String(v).trim()) out.push(String(v).trim()); };
    const t = body.tag;
    if (t != null && typeof t === 'object') { push(t.tag); push(t.id); push(t.name); }
    else push(t);
    push(body['tag[tag]']); push(body['tag[id]']); push(body['tag[name]']);
    push(body.tag_id); push(body.tag_name);
    return out;
}

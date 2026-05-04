/**
 * AG2020 - Call Triage Queue
 *
 * GET /api/ag2020/call-queue
 *   Query: status=pending|all (default pending), limit=20 (max 100)
 *   Returns the most recent calls. Pending = not yet triaged.
 *
 * POST /api/ag2020/call-queue/triage
 *   Body: { id, action: 'deal_created'|'spam'|'skip', tags?, pipelineId?, stageId?, ownerId?, notes?, agent? }
 *   Marks the queue row as triaged. For 'deal_created' action, also creates an
 *   AC contact (find-or-sync by phone) and a deal in the chosen pipeline/stage.
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (req.method === 'GET') return handleList(req, res, supabase);
    if (req.method === 'POST') return handleTriage(req, res, supabase);
    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================================
// GET: list queue
// ============================================================================

async function handleList(req, res, supabase) {
    const status = (req.query.status || 'pending').toString();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let query = supabase
        .from('ag2020_call_queue')
        .select('id,call_hash,caller_number,caller_name,called_at,received_at,answered,answered_by_extension,answered_by_user,ring_duration_seconds,direction,source,auto_sms_sent,auto_sms_status,triaged_at,triaged_by,triage_action,triage_ac_contact_id,triage_ac_deal_id')
        .order('called_at', { ascending: false })
        .limit(limit);

    if (status === 'pending') {
        query = query.is('triaged_at', null);
    } else if (status === 'triaged') {
        query = query.not('triaged_at', 'is', null);
    }

    const { data, error } = await query;
    if (error) return res.status(200).json({ status: 'error', error: error.message });

    // Also pull lifetime stats so the UI header can show counts at a glance
    const { count: pendingCount } = await supabase
        .from('ag2020_call_queue')
        .select('id', { count: 'exact', head: true })
        .is('triaged_at', null);

    const { count: triagedToday } = await supabase
        .from('ag2020_call_queue')
        .select('id', { count: 'exact', head: true })
        .gte('triaged_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    return res.status(200).json({
        status: 'success',
        count: data?.length || 0,
        pendingTotal: pendingCount || 0,
        triagedLast24h: triagedToday || 0,
        items: data || [],
    });
}

// ============================================================================
// POST: triage submission
// ============================================================================

async function handleTriage(req, res, supabase) {
    const body = req.body || {};
    const id = parseInt(body.id);
    const action = (body.action || '').toString();
    const validActions = new Set(['deal_created', 'spam', 'skip']);

    if (!id || !validActions.has(action)) {
        return res.status(400).json({ error: 'id and a valid action (deal_created | spam | skip) required' });
    }

    // Load the queue row
    const { data: row, error: rowErr } = await supabase
        .from('ag2020_call_queue')
        .select('*')
        .eq('id', id)
        .single();

    if (rowErr || !row) {
        return res.status(404).json({ error: 'Queue row not found' });
    }
    if (row.triaged_at) {
        return res.status(409).json({ error: 'Already triaged', triaged_at: row.triaged_at, triaged_by: row.triaged_by });
    }

    const triagedBy = strOrNull(body.agent)?.slice(0, 200) || 'unknown';
    const tagsArr = Array.isArray(body.tags) ? body.tags.map(String) : [];
    const notes = strOrNull(body.notes) || null;
    const pipelineId = strOrNull(body.pipelineId) || null;
    const stageId = strOrNull(body.stageId) || null;
    const ownerId = strOrNull(body.ownerId) || null;

    let acContactId = null;
    let acDealId = null;
    let acError = null;

    if (action === 'deal_created') {
        if (!row.caller_number) {
            return res.status(400).json({ error: 'Cannot create AC deal — caller_number is missing on the queue row' });
        }
        try {
            const result = await pushToActiveCampaign({
                phone: row.caller_number,
                name: row.caller_name,
                tags: tagsArr,
                pipelineId,
                stageId,
                ownerId,
                title: `${row.caller_name || row.caller_number} (${row.answered ? 'answered' : 'missed'} ${row.called_at?.slice(0, 16) || ''})`,
                notes,
            });
            acContactId = result.contactId;
            acDealId = result.dealId;
        } catch (err) {
            acError = err.message;
        }
    }

    const updateBody = {
        triaged_at: new Date().toISOString(),
        triaged_by: triagedBy,
        triage_action: action,
        triage_tags: tagsArr,
        triage_pipeline_id: pipelineId,
        triage_stage_id: stageId,
        triage_owner_id: ownerId,
        triage_notes: notes,
        triage_ac_contact_id: acContactId,
        triage_ac_deal_id: acDealId,
        triage_error: acError,
    };

    const { error: updErr } = await supabase
        .from('ag2020_call_queue')
        .update(updateBody)
        .eq('id', id);

    if (updErr) return res.status(500).json({ error: `DB update failed: ${updErr.message}` });

    return res.status(200).json({
        status: acError ? 'partial' : 'success',
        id,
        action,
        ac: { contactId: acContactId, dealId: acDealId, error: acError },
    });
}

// ============================================================================
// AC integration (similar pattern to missed-call-webhook)
// ============================================================================

async function pushToActiveCampaign({ phone, name, tags, pipelineId, stageId, ownerId, title, notes }) {
    const url = process.env.AG2020_ACTIVECAMPAIGN_URL;
    const key = process.env.AG2020_ACTIVECAMPAIGN_KEY;
    if (!url || !key) throw new Error('AC env vars missing');

    const base = url.replace(/\/$/, '') + '/api/3';
    const headers = {
        'Api-Token': key,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    // Find or create contact by phone
    const search = await fetch(`${base}/contacts?filters[phone]=${encodeURIComponent(phone)}&limit=1`, { headers });
    const searchData = await search.json();
    let contactId = null;
    if (search.ok && searchData.contacts?.length > 0) {
        contactId = searchData.contacts[0].id;
        // Update name if we have one and contact lacks one
        if (name && !searchData.contacts[0].firstName) {
            const [first, ...rest] = name.split(/\s+/);
            await fetch(`${base}/contacts/${contactId}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ contact: { firstName: first, lastName: rest.join(' ') || undefined } }),
            }).catch(() => {});
        }
    } else {
        const [first, ...rest] = (name || '').split(/\s+/);
        const create = await fetch(`${base}/contact/sync`, {
            method: 'POST', headers,
            body: JSON.stringify({
                contact: {
                    email: `${phone.replace(/\D/g, '')}@phone.autoglass2020.com`,
                    phone,
                    firstName: first || undefined,
                    lastName: rest.join(' ') || undefined,
                },
            }),
        });
        const createData = await create.json();
        if (!create.ok || !createData.contact) {
            throw new Error(`contact/sync failed: ${JSON.stringify(createData).slice(0, 300)}`);
        }
        contactId = createData.contact.id;
    }

    // Apply tags (best-effort, in parallel)
    if (Array.isArray(tags) && tags.length > 0) {
        await Promise.all(tags.map(tagId =>
            fetch(`${base}/contactTags`, {
                method: 'POST', headers,
                body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }),
            }).catch(() => {})
        ));
    }

    // Create deal
    let dealId = null;
    if (pipelineId && stageId) {
        const dealRes = await fetch(`${base}/deals`, {
            method: 'POST', headers,
            body: JSON.stringify({
                deal: {
                    title: title.slice(0, 200),
                    contact: contactId,
                    value: 0,
                    currency: 'usd',
                    group: pipelineId,
                    stage: stageId,
                    owner: ownerId || '1',
                    description: notes || undefined,
                },
            }),
        });
        const dealData = await dealRes.json();
        if (!dealRes.ok) throw new Error(`deal create failed: ${JSON.stringify(dealData).slice(0, 300)}`);
        dealId = dealData.deal?.id || null;
    }

    return { contactId, dealId };
}

function strOrNull(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
}

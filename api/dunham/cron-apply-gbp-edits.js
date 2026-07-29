/**
 * Dunham GBP scheduled-edit applier (cron — daily 14:00 UTC = 9:00 AM Central)
 * GET /api/dunham/cron-apply-gbp-edits
 *
 * Reads the scheduled-edit queue (gbp_locations row '_scheduled-edits',
 * client_key 'dunham-maps'), applies every edit whose applyAfter has passed
 * via the Business Information API, and emails the notify list on success
 * (kenny + client contact) or kenny alone on failure.
 *
 * Queue item shape:
 *   { id, locationId, city, field: 'description', value, applyAfter (ISO),
 *     notify: [emails], status: 'scheduled' | 'applied' | 'failed', ... }
 *
 * Supported fields:
 *   'description'         — updateMask=profile.description
 *   'serviceItems.append' — value = [{displayName, description}]; reads current
 *                           serviceItems and appends free-form items (dupe-safe)
 *   'placeActionLink'     — value = {type, uri}; creates a place action link
 *                           (requires My Business Place Actions API enabled)
 * Auth (fail-closed): Bearer CRON_SECRET or same-origin.
 */

import { supabase, getGoogleAccessToken } from './_google.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
    const auth = req.headers['authorization'] || '';
    const referer = req.headers['referer'] || '';
    const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
    const isSameOrigin = /^https:\/\/(www\.)?hyder\.me\//.test(referer);
    if (!isCron && !isSameOrigin) return res.status(403).json({ error: 'Forbidden' });

    const sb = supabase();
    const { data: rows, error } = await sb
        .from('gbp_locations').select('*')
        .eq('client_key', 'dunham-maps')
        .eq('location_name', '_scheduled-edits');
    if (error) return res.status(500).json({ error: error.message });

    const row = rows?.[0];
    const queue = row?.data?.queue || [];
    const due = queue.filter(q =>
        q.status === 'scheduled' && new Date(q.applyAfter) <= new Date());
    if (!due.length) {
        return res.status(200).json({ status: 'idle', scheduled: queue.filter(q => q.status === 'scheduled').length });
    }

    const token = await getGoogleAccessToken(sb);
    const results = [];

    for (const edit of due) {
        try {
            let summaryHtml;
            const base = `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${edit.locationId}`;
            const authHdr = { 'Authorization': `Bearer ${token}` };

            if (edit.field === 'description') {
                const before = await (await fetch(`${base}?readMask=profile`, { headers: authHdr })).json();
                const beforeText = before?.profile?.description || '(none)';
                const patch = await (await fetch(`${base}?updateMask=profile.description`, {
                    method: 'PATCH',
                    headers: { ...authHdr, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: { description: edit.value } }),
                })).json();
                if (patch.error) throw new Error(patch.error.message);
                summaryHtml = `<p><b>New description:</b></p><blockquote style="border-left:3px solid #3b82f6;padding-left:12px;color:#334155;">${esc(edit.value)}</blockquote>
                    <p><b>Previous description:</b></p><blockquote style="border-left:3px solid #94a3b8;padding-left:12px;color:#64748b;">${esc(beforeText)}</blockquote>`;
            } else if (edit.field === 'serviceItems.append') {
                const cur = await (await fetch(`${base}?readMask=serviceItems,categories`, { headers: authHdr })).json();
                if (cur.error) throw new Error(cur.error.message);
                const items = cur.serviceItems || [];
                const category = cur.categories?.primaryCategory?.name || 'categories/gcid:criminal_law_attorney';
                const existingNames = new Set(items
                    .map(i => i.freeFormServiceItem?.label?.displayName?.toLowerCase())
                    .filter(Boolean));
                const additions = (edit.value || [])
                    .filter(v => !existingNames.has(v.displayName.toLowerCase()))
                    .map(v => ({ freeFormServiceItem: {
                        category,
                        label: { displayName: v.displayName, description: v.description || undefined },
                    } }));
                if (additions.length) {
                    const patch = await (await fetch(`${base}?updateMask=serviceItems`, {
                        method: 'PATCH',
                        headers: { ...authHdr, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ serviceItems: [...items, ...additions] }),
                    })).json();
                    if (patch.error) throw new Error(patch.error.message);
                }
                summaryHtml = `<p><b>${additions.length} service listings added</b> (existing ${items.length} preserved):</p>
                    <ul>${(edit.value || []).map(v => `<li><b>${esc(v.displayName)}</b>${v.description ? ' — ' + esc(v.description) : ''}</li>`).join('')}</ul>`;
            } else if (edit.field === 'placeActionLink') {
                const paBase = `https://mybusinessplaceactions.googleapis.com/v1/locations/${edit.locationId}/placeActionLinks`;
                const existing = await (await fetch(paBase, { headers: authHdr })).json();
                if (existing.error) throw new Error(existing.error.message);
                const dupe = (existing.placeActionLinks || []).some(l => l.uri === edit.value.uri);
                if (!dupe) {
                    const created = await (await fetch(paBase, {
                        method: 'POST',
                        headers: { ...authHdr, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ placeActionType: edit.value.type, uri: edit.value.uri }),
                    })).json();
                    if (created.error) throw new Error(created.error.message);
                }
                summaryHtml = `<p><b>Second profile link added</b> (${esc(edit.value.type)}):</p>
                    <p><a href="${esc(edit.value.uri)}">${esc(edit.value.uri)}</a></p>
                    <p>The main website link is unchanged.</p>`;
            } else {
                throw new Error(`unsupported field: ${edit.field}`);
            }

            edit.status = 'applied';
            edit.appliedAt = new Date().toISOString();
            results.push({ id: edit.id, status: 'applied' });

            await sendEmail(edit.notify || ['kenny@hyder.me'],
                `✅ Google profile updated — Dunham & Jones ${edit.city}`,
                `<p>An approved update for the <b>${edit.city}</b> office profile is now live on Google.</p>
                 <p><b>Applied:</b> ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} (Central)</p>
                 ${summaryHtml}
                 <p>Google typically shows profile edits within minutes; occasionally an edit is queued for review for up to 24&nbsp;hours.</p>
                 <p style="color:#64748b;font-size:13px;">Dunham &amp; Jones Maps Initiative · applied by Hyder Media via the Google Business Profile API</p>`);
        } catch (err) {
            edit.status = 'failed';
            edit.error = err.message;
            edit.failedAt = new Date().toISOString();
            results.push({ id: edit.id, status: 'failed', error: err.message });
            await sendEmail(['kenny@hyder.me'],
                `⚠️ GBP edit FAILED — Dunham ${edit.city}`,
                `<p>Scheduled edit <b>${edit.id}</b> failed: ${esc(err.message)}</p><p>It will NOT retry automatically — fix and reschedule.</p>`);
        }
    }

    await sb.from('gbp_locations')
        .update({ data: { ...row.data, queue }, updated_at: new Date().toISOString() })
        .eq('id', row.id);

    return res.status(200).json({ status: 'success', applied: results });
}

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

async function sendEmail(to, subject, html) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return;
    await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: 'Dunham Maps Initiative <alerts@sportsbookish.com>',
            to, subject, html,
        }),
    });
}

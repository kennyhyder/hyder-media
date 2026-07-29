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
 * Currently supports field 'description' (updateMask=profile.description).
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
            if (edit.field !== 'description') throw new Error(`unsupported field: ${edit.field}`);

            // Capture "before" for the notification
            const before = await (await fetch(
                `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${edit.locationId}?readMask=profile`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            )).json();
            const beforeText = before?.profile?.description || '(none)';

            const patch = await (await fetch(
                `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${edit.locationId}?updateMask=profile.description`,
                {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: { description: edit.value } }),
                }
            )).json();
            if (patch.error) throw new Error(patch.error.message);

            edit.status = 'applied';
            edit.appliedAt = new Date().toISOString();
            results.push({ id: edit.id, status: 'applied' });

            await sendEmail(edit.notify || ['kenny@hyder.me'],
                `✅ Google profile updated — Dunham & Jones ${edit.city}`,
                `<p>The approved business description for the <b>${edit.city}</b> office is now live on Google.</p>
                 <p><b>Applied:</b> ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} (Central)</p>
                 <p><b>New description:</b></p><blockquote style="border-left:3px solid #3b82f6;padding-left:12px;color:#334155;">${esc(edit.value)}</blockquote>
                 <p><b>Previous description:</b></p><blockquote style="border-left:3px solid #94a3b8;padding-left:12px;color:#64748b;">${esc(beforeText)}</blockquote>
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

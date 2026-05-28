/**
 * POST /api/ag2020/users/delete
 * Body: { user_id }
 *
 * Removes the user's ag2020_users row AND their auth.users row entirely.
 * Admin-only.
 */

import { requireAdmin } from './_admin-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { admin, sb } = ctx;

    const user_id = String(req.body?.user_id || '').trim();
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (user_id === admin.user_id) {
        return res.status(400).json({ error: "You can't delete yourself" });
    }

    // Order: delete ag2020_users row first (the auth.users delete cascades to
    // it via the FK, but explicit is safer in case the FK is missing/disabled).
    const { error: rowErr } = await sb
        .from('ag2020_users')
        .delete()
        .eq('user_id', user_id);
    if (rowErr) {
        return res.status(500).json({ error: 'Failed to delete ag2020_users row: ' + rowErr.message });
    }

    // Now nuke the auth.users row
    const { error: authErr } = await sb.auth.admin.deleteUser(user_id);
    if (authErr) {
        // ag2020_users row is already gone — they no longer have dashboard
        // access. Surface the auth.users delete failure but report partial
        // success so the UI shows the removal happened.
        return res.status(207).json({
            ok: true,
            partial: true,
            warning: 'Dashboard access removed, but auth.users row delete failed: ' + authErr.message,
            user_id,
        });
    }

    return res.status(200).json({ ok: true, user_id });
}

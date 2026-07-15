/**
 * POST /api/ag2020/users/invite
 * Body: { email, role: 'admin'|'member' }
 *
 * Strategy:
 *   1) Try Supabase admin.inviteUserByEmail() — sends a magic-link invite.
 *      If a shared-project trigger on auth.users (from omicron / automatedojo /
 *      etc.) blows up the insert, this fails with "Database error".
 *   2) On failure, fall back to sending a plain Gmail email with sign-in
 *      instructions: the recipient visits login.html and uses the Magic Link
 *      tab, which exercises the PUBLIC sign-up code path (not the admin one)
 *      and may succeed where admin.inviteUserByEmail did not.
 *   3) After EITHER path, attempt to upsert the ag2020_users row so they get
 *      the requested role the moment their auth.users row exists. If we can't
 *      look up their user_id yet (admin path failed AND the public path will
 *      run later), surface a clear message telling the admin to re-promote
 *      via the AdminTab once the user signs in.
 *
 * Requires Authorization: Bearer <jwt> from an admin user.
 */

import nodemailer from 'nodemailer';
import { requireAdmin } from './_admin-auth.js';

const LOGIN_URL = 'https://hyder.me/clients/ag2020/login.html';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { admin, sb } = ctx;

    const email = String(req.body?.email || '').toLowerCase().trim();
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
    }

    const summary = { email, role, paths_attempted: [] };

    // ---- Path 1: Supabase admin invite ---------------------------------
    let user_id = null;
    try {
        const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
            redirectTo: LOGIN_URL,
            // Tag the account so the shared-project auth.users triggers
            // (9dm_handle_new_user, sb_handle_new_user) skip it. The public
            // magic-link path in login.html sets the same metadata.
            data: { product: 'ag2020' },
        });
        if (error) throw error;
        user_id = data?.user?.id || null;
        summary.paths_attempted.push({ method: 'supabase_admin_invite', ok: true });
    } catch (e) {
        summary.paths_attempted.push({
            method: 'supabase_admin_invite',
            ok: false,
            error: e.message || String(e),
        });

        // Check if the user already exists in auth.users (admin invite would
        // fail with a 422 in that case — we still want to upsert their role).
        try {
            // listUsers paginates; AG2020 user count will be tiny
            const { data: listed } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
            const match = (listed?.users || []).find(u => (u.email || '').toLowerCase() === email);
            if (match) {
                user_id = match.id;
                summary.paths_attempted.push({ method: 'lookup_existing', ok: true, note: 'user already in auth.users' });
            }
        } catch (le) {
            summary.paths_attempted.push({ method: 'lookup_existing', ok: false, error: le.message });
        }
    }

    // ---- Path 2: Gmail fallback if admin path failed AND user not pre-existing
    if (!user_id) {
        try {
            const sent = await sendInviteEmail({
                to: email,
                inviterEmail: admin.email,
                role,
            });
            summary.paths_attempted.push({ method: 'gmail_fallback', ok: true, message_id: sent.messageId });
        } catch (e) {
            summary.paths_attempted.push({
                method: 'gmail_fallback',
                ok: false,
                error: e.message || String(e),
            });
            return res.status(500).json({
                error: 'Both Supabase admin invite and Gmail fallback failed',
                detail: summary,
                hint: 'Run `node clients/ag2020/scripts/seed-admins.js --email=' + email + ' --role=' + role + '` locally as a last resort.',
            });
        }
    }

    // ---- Step 3: upsert ag2020_users row if we know the user_id ----------
    if (user_id) {
        const { error: upErr } = await sb
            .from('ag2020_users')
            .upsert({
                user_id,
                email,
                role,
                allowed_tabs: [],
            }, { onConflict: 'user_id' });
        if (upErr) {
            summary.paths_attempted.push({ method: 'upsert_ag2020_users', ok: false, error: upErr.message });
        } else {
            summary.paths_attempted.push({ method: 'upsert_ag2020_users', ok: true });
        }
    }

    return res.status(200).json({
        ok: true,
        email,
        role,
        user_id,
        message: user_id
            ? `Invited ${email} as ${role}. They'll receive a Supabase magic-link email — click it to set their password.`
            : `Sent ${email} a fallback email asking them to sign in via the login page (Supabase admin invite failed). Once they sign up, re-run this invite or grant access from the Admin tab.`,
        detail: summary,
    });
}

async function sendInviteEmail({ to, inviterEmail, role }) {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass) {
        throw new Error('Missing EMAIL_USER / EMAIL_PASS env vars for Gmail fallback');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    });

    const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0f1c2e;">
            <h2 style="color:#1B4B82;margin:0 0 16px;">You've been invited to the Auto Glass 2020 dashboard</h2>
            <p style="font-size:15px;line-height:1.55;">${inviterEmail || 'An administrator'} invited you (<strong>${to}</strong>) as a <strong>${role}</strong>.</p>
            <p style="font-size:15px;line-height:1.55;">Click the button below to sign in:</p>
            <p style="margin:24px 0;">
                <a href="${LOGIN_URL}" style="display:inline-block;background:#1B4B82;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Open the AG2020 Dashboard</a>
            </p>
            <p style="font-size:14px;line-height:1.55;color:#475569;">
                On the login page, click the <strong>"Magic Link"</strong> tab and enter your email
                (<strong>${to}</strong>). Supabase will email you a one-click sign-in link.
            </p>
            <p style="font-size:13px;color:#94a3b8;margin-top:32px;">If you weren't expecting this invitation, you can safely ignore this email.</p>
        </div>
    `;

    return transporter.sendMail({
        from: `"AG2020 Dashboard" <${user}>`,
        to,
        subject: `You're invited to the Auto Glass 2020 dashboard (${role})`,
        html,
        text: `You've been invited to the AG2020 dashboard as ${role}.\n\nSign in at: ${LOGIN_URL}\n\nOn the login page, click "Magic Link" and enter ${to}.`,
    });
}

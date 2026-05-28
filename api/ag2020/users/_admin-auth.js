/**
 * Shared admin-gate for /api/ag2020/users/* endpoints.
 *
 * Caller must include `Authorization: Bearer <jwt>` from a logged-in session.
 * We verify the JWT, then check ag2020_users.role = 'admin' for that user_id.
 *
 * Returns: { admin: { user_id, email } } on success, or sends a response and
 * returns null if rejected.
 */

import { createClient } from '@supabase/supabase-js';

export function getServiceClient() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
    );
}

export async function requireAdmin(req, res) {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
        res.status(401).json({ error: 'Missing Authorization: Bearer <jwt> header' });
        return null;
    }
    const jwt = m[1];

    // Verify the JWT and resolve the user via the user-scoped client
    const userClient = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } }
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userRes?.user) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
    const user = userRes.user;

    // Check ag2020_users.role = 'admin' via service client (bypasses RLS)
    const sb = getServiceClient();
    const { data: row, error: rowErr } = await sb
        .from('ag2020_users')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
    if (rowErr) {
        res.status(500).json({ error: 'Admin lookup failed: ' + rowErr.message });
        return null;
    }
    if (!row || row.role !== 'admin') {
        res.status(403).json({ error: 'Admin role required' });
        return null;
    }

    return { admin: { user_id: user.id, email: user.email }, sb };
}

/**
 * Meta Ads — Active Token Proxy
 * GET /api/meta-ads/active-token
 *
 * Service-to-service endpoint for 9thdanmarketing.com (and future siblings)
 * to read the current active Meta access token without owning the OAuth flow.
 *
 * Auth: Authorization: Bearer <META_PROXY_SECRET> (shared secret env var,
 * set on BOTH this project and the calling project).
 *
 * Returns: { access_token, meta_user_id, name, expires_at }
 * Or:      { error: '...' } with HTTP 401/404/500
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const expected = process.env.META_PROXY_SECRET;
    if (!expected) {
        return res.status(500).json({ error: 'META_PROXY_SECRET not configured' });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token !== expected) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data, error } = await sb
        .from('meta_ads_connections')
        .select('meta_user_id, name, access_token, token_expires_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data?.access_token) return res.status(404).json({ error: 'No active Meta connection' });

    if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
        return res.status(410).json({
            error: 'Token expired. Reconnect at https://hyder.me/api/meta-ads/auth',
            expired_at: data.token_expires_at,
        });
    }

    return res.status(200).json({
        access_token: data.access_token,
        meta_user_id: data.meta_user_id,
        name: data.name ?? null,
        expires_at: data.token_expires_at,
    });
}

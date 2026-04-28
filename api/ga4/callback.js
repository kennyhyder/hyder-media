/**
 * GA4 OAuth — Callback handler
 * GET /api/ga4/callback
 *
 * Exchanges the authorization code for access/refresh tokens, fetches the
 * authorized user's email, and upserts a row into ga4_connections.
 */

import { createClient } from '@supabase/supabase-js';

const DEFAULT_RETURN = '/clients/omicron/dashboard.html#brand-defense';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
        console.error('GA4 OAuth error:', oauthError);
        return res.redirect(`${DEFAULT_RETURN}?ga4_error=${encodeURIComponent(oauthError)}`);
    }
    if (!code) {
        return res.redirect(`${DEFAULT_RETURN}?ga4_error=no_code`);
    }

    let stateData = {};
    if (state) {
        try { stateData = JSON.parse(Buffer.from(state, 'base64').toString()); } catch (_) {}
    }
    const returnUrl = stateData.returnUrl || DEFAULT_RETURN;

    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                redirect_uri: process.env.GA4_REDIRECT_URI || 'https://hyder.me/api/ga4/callback',
                grant_type: 'authorization_code'
            })
        });
        const tokens = await tokenResponse.json();

        if (tokens.error) {
            console.error('GA4 token exchange error:', tokens);
            return res.redirect(`${returnUrl}?ga4_error=${encodeURIComponent(tokens.error)}`);
        }

        // Get authorizing user's email
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const userInfo = await userInfoResponse.json();
        const email = userInfo.email || null;

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();

        // Upsert by email — one connection per Google account
        const { data: existing } = await supabase
            .from('ga4_connections')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (existing) {
            await supabase
                .from('ga4_connections')
                .update({
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token || undefined,
                    token_expires_at: expiresAt,
                    scope: tokens.scope || null,
                    is_active: true,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);
        } else {
            await supabase
                .from('ga4_connections')
                .insert({
                    email,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_expires_at: expiresAt,
                    scope: tokens.scope || null
                });
        }

        return res.redirect(`${returnUrl}?ga4_connected=1`);
    } catch (err) {
        console.error('GA4 callback error:', err);
        return res.redirect(`${returnUrl}?ga4_error=${encodeURIComponent(err.message)}`);
    }
}

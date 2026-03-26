/**
 * Meta Ads OAuth - Callback Handler
 * GET /api/meta-ads/callback
 *
 * Two-step token exchange:
 * 1. Exchange code for short-lived token
 * 2. Exchange short-lived for long-lived token (~60 days)
 * 3. Upsert user + token into meta_ads_connections
 */

import { createClient } from '@supabase/supabase-js';

const REDIRECT_URI = 'https://hyder.me/api/meta-ads/callback';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error_reason } = req.query;
    const defaultReturn = '/clients/dunham/dashboard.html';

    // Parse return URL from state
    let returnUrl = defaultReturn;
    if (state) {
        try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            returnUrl = stateData.returnUrl || defaultReturn;
        } catch (e) {
            // ignore parse errors
        }
    }

    if (error_reason) {
        return res.redirect(`${returnUrl}?error=${encodeURIComponent(error_reason)}`);
    }

    if (!code) {
        return res.redirect(`${returnUrl}?error=no_code`);
    }

    try {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;

        // Step 1: Exchange code for short-lived token
        const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
        tokenUrl.searchParams.set('client_id', appId);
        tokenUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        tokenUrl.searchParams.set('client_secret', appSecret);
        tokenUrl.searchParams.set('code', code);

        const tokenResp = await fetch(tokenUrl.toString());
        const tokenData = await tokenResp.json();

        if (tokenData.error) {
            console.error('Meta token exchange error:', tokenData.error);
            return res.redirect(`${returnUrl}?error=${encodeURIComponent(tokenData.error.message || 'token_exchange_failed')}`);
        }

        const shortLivedToken = tokenData.access_token;

        // Step 2: Exchange for long-lived token (~60 days)
        const longUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
        longUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longUrl.searchParams.set('client_id', appId);
        longUrl.searchParams.set('client_secret', appSecret);
        longUrl.searchParams.set('fb_exchange_token', shortLivedToken);

        const longResp = await fetch(longUrl.toString());
        const longData = await longResp.json();

        if (longData.error) {
            console.error('Meta long-lived token error:', longData.error);
            return res.redirect(`${returnUrl}?error=${encodeURIComponent(longData.error.message || 'long_token_failed')}`);
        }

        const accessToken = longData.access_token;
        // expires_in is in seconds; long-lived tokens are ~60 days
        const expiresIn = longData.expires_in || 5184000; // default 60 days
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        // Step 3: Get user info
        const meResp = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${accessToken}`);
        const meData = await meResp.json();

        if (meData.error) {
            console.error('Meta /me error:', meData.error);
            return res.redirect(`${returnUrl}?error=${encodeURIComponent(meData.error.message || 'user_info_failed')}`);
        }

        // Step 4: Upsert into Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { error: dbError } = await supabase
            .from('meta_ads_connections')
            .upsert({
                meta_user_id: meData.id,
                name: meData.name,
                access_token: accessToken,
                token_expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'meta_user_id',
            });

        if (dbError) {
            console.error('Meta callback DB error:', dbError);
            return res.redirect(`${returnUrl}?error=db_error`);
        }

        res.redirect(`${returnUrl}?meta_connected=true`);

    } catch (error) {
        console.error('Meta callback error:', error);
        res.redirect(`${returnUrl}?error=${encodeURIComponent(error.message)}`);
    }
}

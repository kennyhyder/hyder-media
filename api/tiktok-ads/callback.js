/**
 * TikTok Ads OAuth - Callback Handler
 * GET /api/tiktok-ads/callback
 *
 * Token exchange flow:
 * 1. TikTok redirects here with ?auth_code=...&state=...
 * 2. POST to /oauth2/access_token/ with { app_id, secret, auth_code }
 * 3. Response includes access_token, refresh_token, expires_in,
 *    refresh_token_expires_in, advertiser_ids (array of authorized accts),
 *    scope[]
 * 4. Upsert into tiktok_ads_connections table
 *
 * TikTok response envelope: { code: 0, message: 'OK', data: {...}, request_id }
 * code !== 0 means error.
 */

import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
const USER_INFO_URL = 'https://business-api.tiktok.com/open_api/v1.3/user/info/';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { auth_code, code, state, error: errParam, error_description } = req.query;
    // TikTok docs use auth_code; some flows return code. Accept either.
    const authCode = auth_code || code;
    const defaultReturn = '/clients/vita-brevis/reporting.html#tiktok';

    let returnUrl = defaultReturn;
    if (state) {
        try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            returnUrl = stateData.returnUrl || defaultReturn;
        } catch (e) { /* ignore */ }
    }

    if (errParam) {
        return res.redirect(`${returnUrl}?tiktok_error=${encodeURIComponent(error_description || errParam)}`);
    }
    if (!authCode) {
        return res.redirect(`${returnUrl}?tiktok_error=no_auth_code`);
    }

    const appId = process.env.TIKTOK_APP_ID;
    const appSecret = process.env.TIKTOK_APP_SECRET;
    if (!appId || !appSecret) {
        return res.redirect(`${returnUrl}?tiktok_error=app_not_configured`);
    }

    try {
        const tokenResp = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: appId,
                secret: appSecret,
                auth_code: authCode,
            }),
        });
        const tokenJson = await tokenResp.json();

        if (tokenJson.code !== 0) {
            console.error('TikTok token exchange error:', tokenJson);
            return res.redirect(
                `${returnUrl}?tiktok_error=${encodeURIComponent(tokenJson.message || 'token_exchange_failed')}`
            );
        }

        const data = tokenJson.data || {};
        const accessToken = data.access_token;
        const refreshToken = data.refresh_token || null;
        const expiresIn = data.expires_in || 86400 * 365; // default 1 year
        const refreshExpiresIn = data.refresh_token_expires_in || 86400 * 365;
        const advertiserIds = Array.isArray(data.advertiser_ids) ? data.advertiser_ids : [];
        const scope = Array.isArray(data.scope) ? data.scope : [];

        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        const refreshExpiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

        // Optional: fetch user info for the connection record. The /user/info/
        // endpoint returns the authenticating user's display name + email.
        let userId = null;
        let userName = null;
        try {
            const userResp = await fetch(USER_INFO_URL, {
                headers: { 'Access-Token': accessToken },
            });
            const userJson = await userResp.json();
            if (userJson.code === 0 && userJson.data) {
                userId = userJson.data.core_user_id || userJson.data.user_id || null;
                userName = userJson.data.display_name || userJson.data.email || null;
            }
        } catch (e) { /* non-fatal */ }

        // Upsert in Supabase. If we got a user id, use it as the conflict key;
        // otherwise just write a new row keyed by app_id (single-tenant fallback).
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const row = {
            tiktok_user_id: userId || `app_${appId}`,
            name: userName,
            access_token: accessToken,
            refresh_token: refreshToken,
            token_expires_at: expiresAt.toISOString(),
            refresh_token_expires_at: refreshExpiresAt.toISOString(),
            advertiser_ids: advertiserIds,
            scope,
            updated_at: new Date().toISOString(),
        };

        const { error: dbError } = await supabase
            .from('tiktok_ads_connections')
            .upsert(row, { onConflict: 'tiktok_user_id' });

        if (dbError) {
            console.error('TikTok callback DB error:', dbError);
            return res.redirect(`${returnUrl}?tiktok_error=db_error`);
        }

        res.redirect(`${returnUrl}?tiktok_connected=true&advertisers=${advertiserIds.length}`);
    } catch (error) {
        console.error('TikTok callback error:', error);
        res.redirect(`${returnUrl}?tiktok_error=${encodeURIComponent(error.message)}`);
    }
}

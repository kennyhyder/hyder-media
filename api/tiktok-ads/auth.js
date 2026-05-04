/**
 * TikTok Ads OAuth - Initiate Authorization Flow
 * GET /api/tiktok-ads/auth
 *
 * Sends user to TikTok's authorization portal. After approval, TikTok
 * redirects to /api/tiktok-ads/callback with an auth_code.
 *
 * Required env vars:
 *   TIKTOK_APP_ID     - app_id from business-api.tiktok.com/portal/apps
 *   TIKTOK_APP_SECRET - secret from same page (used in callback only)
 */

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const appId = process.env.TIKTOK_APP_ID;
    const redirectUri = 'https://hyder.me/api/tiktok-ads/callback';

    if (req.query.debug === 'true') {
        return res.status(200).json({
            appId: appId ? `${appId.substring(0, 10)}...` : 'NOT SET',
            redirectUri,
            hasAppId: !!appId,
        });
    }

    if (!appId) {
        return res.status(500).json({ error: 'TIKTOK_APP_ID not configured' });
    }

    const state = Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        returnUrl: req.query.returnUrl || '/clients/vita-brevis/reporting.html#tiktok',
    })).toString('base64');

    const authUrl = new URL('https://business-api.tiktok.com/portal/auth');
    authUrl.searchParams.set('app_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    res.redirect(302, authUrl.toString());
}

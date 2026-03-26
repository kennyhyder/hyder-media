/**
 * Meta Ads OAuth - Initiate Authorization Flow
 * GET /api/meta-ads/auth
 */

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const appId = process.env.META_APP_ID;
    const redirectUri = 'https://hyder.me/api/meta-ads/callback';

    if (req.query.debug === 'true') {
        return res.status(200).json({
            appId: appId ? `${appId.substring(0, 10)}...` : 'NOT SET',
            redirectUri,
            hasAppId: !!appId,
        });
    }

    if (!appId) {
        return res.status(500).json({ error: 'META_APP_ID not configured' });
    }

    const state = Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        returnUrl: req.query.returnUrl || '/clients/dunham/dashboard.html',
    })).toString('base64');

    const authUrl = new URL('https://www.facebook.com/v22.0/dialog/oauth');
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'ads_read,business_management');
    authUrl.searchParams.set('state', state);

    res.redirect(302, authUrl.toString());
}

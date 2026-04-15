/**
 * Microsoft Advertising OAuth — Initiate Authorization Flow
 * GET /api/bing-ads/auth
 *
 * Redirects to Microsoft identity platform for OAuth consent.
 * Requires BING_ADS_CLIENT_ID env var (Azure AD app registration).
 */

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientId = process.env.BING_ADS_CLIENT_ID;
    const redirectUri = 'https://hyder.me/api/bing-ads/callback';

    if (req.query.debug === 'true') {
        return res.status(200).json({
            clientId: clientId ? `${clientId.substring(0, 10)}...` : 'NOT SET',
            redirectUri,
            hasClientId: !!clientId,
            hasDeveloperToken: !!process.env.BING_ADS_DEVELOPER_TOKEN,
        });
    }

    if (!clientId) {
        return res.status(500).json({ error: 'BING_ADS_CLIENT_ID not configured' });
    }

    const state = Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        returnUrl: req.query.returnUrl || '/clients/dunham/dashboard.html',
    })).toString('base64');

    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'https://ads.microsoft.com/msads.manage offline_access');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'consent');

    res.redirect(302, authUrl.toString());
}

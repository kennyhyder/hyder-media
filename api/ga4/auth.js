/**
 * GA4 OAuth — Initiate authorization flow
 * GET /api/ga4/auth
 *
 * Reuses the same Google OAuth client as Google Ads (GOOGLE_ADS_CLIENT_ID /
 * SECRET) but requests the analytics.readonly scope and writes tokens to a
 * separate `ga4_connections` table. Same Google account (kenny@hyder.me) can
 * authorize both — they're independent connections.
 */

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const redirectUri = process.env.GA4_REDIRECT_URI || 'https://hyder.me/api/ga4/callback';

    if (req.query.debug === 'true') {
        return res.status(200).json({
            clientId: clientId ? `${clientId.substring(0, 20)}...` : 'NOT SET',
            redirectUri,
            hasClientId: !!clientId
        });
    }

    if (!clientId) {
        return res.status(500).json({ error: 'GOOGLE_ADS_CLIENT_ID not configured' });
    }

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/analytics.readonly email profile');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');

    const state = Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        returnUrl: req.query.returnUrl || '/clients/omicron/dashboard.html#brand-defense'
    })).toString('base64');
    authUrl.searchParams.set('state', state);

    res.redirect(302, authUrl.toString());
}

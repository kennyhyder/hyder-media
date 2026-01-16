/**
 * Google Ads OAuth - Initiate Authorization Flow
 * GET /api/google-ads/auth
 */

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 'https://hyder.me/api/google-ads/callback';

    if (!clientId) {
        return res.status(500).json({ error: 'Google Ads client ID not configured' });
    }

    // Google OAuth 2.0 authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords email profile');
    authUrl.searchParams.set('access_type', 'offline'); // Required for refresh token
    authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

    // Optional: Add state parameter for security
    const state = Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        returnUrl: req.query.returnUrl || '/clients/'
    })).toString('base64');
    authUrl.searchParams.set('state', state);

    // Redirect to Google OAuth
    res.redirect(302, authUrl.toString());
}

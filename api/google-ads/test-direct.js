/**
 * Direct API Test - Minimal test to isolate the issue
 * GET /api/google-ads/test-direct
 */

export default async function handler(req, res) {
    // Get fresh token via refresh
    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_ADS_CLIENT_ID,
            client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
            refresh_token: 'YOUR_REFRESH_TOKEN_HERE', // We'll need to get this
            grant_type: 'refresh_token',
        }),
    });

    const tokens = await refreshResponse.json();

    if (tokens.error) {
        return res.status(200).json({ step: 'token_refresh', error: tokens });
    }

    // Try the simplest possible API call
    const apiResponse = await fetch(
        'https://googleads.googleapis.com/v23/customers:listAccessibleCustomers',
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            },
        }
    );

    const apiText = await apiResponse.text();

    return res.status(200).json({
        status: apiResponse.status,
        headers: Object.fromEntries(apiResponse.headers.entries()),
        body: apiText,
        tokenInfo: {
            hasAccessToken: !!tokens.access_token,
            expiresIn: tokens.expires_in,
            scope: tokens.scope
        }
    });
}

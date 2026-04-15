/**
 * Microsoft Advertising OAuth — Callback Handler
 * GET /api/bing-ads/callback
 *
 * 1. Exchange authorization code for tokens
 * 2. Discover account details (numeric IDs) via Customer Management API
 * 3. Upsert connection into Supabase
 */

import { createClient } from '@supabase/supabase-js';

const REDIRECT_URI = 'https://hyder.me/api/bing-ads/callback';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const CUST_BASE = 'https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc/v13';
const TARGET_ACCOUNT_NUMBER = 'C449285895';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error: oauthError, error_description } = req.query;
    let returnUrl = '/clients/dunham/dashboard.html';

    if (state) {
        try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            returnUrl = stateData.returnUrl || returnUrl;
        } catch (e) { /* ignore */ }
    }

    if (oauthError) {
        return res.redirect(`${returnUrl}?error=${encodeURIComponent(error_description || oauthError)}`);
    }

    if (!code) {
        return res.redirect(`${returnUrl}?error=no_code`);
    }

    try {
        const clientId = process.env.BING_ADS_CLIENT_ID;
        const clientSecret = process.env.BING_ADS_CLIENT_SECRET;

        // Step 1: Exchange code for tokens
        const tokenResp = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
                scope: 'https://ads.microsoft.com/msads.manage offline_access',
            }),
        });

        const tokenData = await tokenResp.json();
        if (tokenData.error) {
            console.error('Bing token exchange error:', tokenData);
            return res.redirect(`${returnUrl}?error=${encodeURIComponent(tokenData.error_description || 'token_exchange_failed')}`);
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const expiresIn = tokenData.expires_in || 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        // Step 2: Get user info
        const devToken = process.env.BING_ADS_DEVELOPER_TOKEN;
        let userName = 'Microsoft User';
        let userId = 'unknown';

        try {
            const userResp = await fetch(`${CUST_BASE}/GetUser`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'AuthenticationToken': accessToken,
                    'DeveloperToken': devToken,
                },
                body: JSON.stringify({ UserId: null }), // null = current user
            });
            const userData = await userResp.json();
            if (userData.User) {
                userName = userData.User.Name?.FirstName
                    ? `${userData.User.Name.FirstName} ${userData.User.Name.LastName}`
                    : (userData.User.UserName || 'Microsoft User');
                userId = String(userData.User.Id || 'unknown');
            }
        } catch (e) {
            console.error('GetUser failed (non-fatal):', e.message);
        }

        // Step 3: Discover account numeric IDs
        let accountId = null;
        let accountName = null;
        let customerId = null;

        try {
            const searchResp = await fetch(`${CUST_BASE}/SearchAccounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'AuthenticationToken': accessToken,
                    'DeveloperToken': devToken,
                },
                body: JSON.stringify({
                    Predicates: [{
                        Field: 'AccountNumber',
                        Operator: 'Equals',
                        Value: TARGET_ACCOUNT_NUMBER,
                    }],
                    Ordering: null,
                    PageInfo: { Index: 0, Size: 10 },
                }),
            });
            const searchData = await searchResp.json();

            if (searchData.Accounts && searchData.Accounts.length > 0) {
                const acct = searchData.Accounts[0];
                accountId = acct.Id;
                accountName = acct.Name;
                customerId = acct.ParentCustomerId;
            }
        } catch (e) {
            console.error('SearchAccounts failed (non-fatal):', e.message);
        }

        // Step 4: Upsert into Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { error: dbError } = await supabase
            .from('bing_ads_connections')
            .upsert({
                microsoft_user_id: userId,
                name: userName,
                email: 'kenny@hyder.me',
                access_token: accessToken,
                refresh_token: refreshToken,
                token_expires_at: expiresAt.toISOString(),
                account_id: accountId,
                account_number: TARGET_ACCOUNT_NUMBER,
                account_name: accountName,
                customer_id: customerId,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'microsoft_user_id',
            });

        if (dbError) {
            console.error('Bing callback DB error:', dbError);
            return res.redirect(`${returnUrl}?error=db_error`);
        }

        res.redirect(`${returnUrl}?bing_connected=true`);

    } catch (error) {
        console.error('Bing callback error:', error);
        res.redirect(`${returnUrl}?error=${encodeURIComponent(error.message)}`);
    }
}

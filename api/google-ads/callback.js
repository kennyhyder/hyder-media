/**
 * Google Ads OAuth - Callback Handler
 * GET /api/google-ads/callback
 *
 * Exchanges authorization code for access token and stores in Supabase
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error: oauthError } = req.query;

    // Handle OAuth errors
    if (oauthError) {
        console.error('OAuth error:', oauthError);
        return res.redirect('/clients/omicron/summary.html?error=' + encodeURIComponent(oauthError));
    }

    if (!code) {
        return res.redirect('/clients/omicron/summary.html?error=no_code');
    }

    try {
        // Exchange code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                code: code,
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                redirect_uri: process.env.GOOGLE_ADS_REDIRECT_URI || 'https://hyder.me/api/google-ads/callback',
                grant_type: 'authorization_code',
            }),
        });

        const tokens = await tokenResponse.json();

        if (tokens.error) {
            console.error('Token exchange error:', tokens);
            return res.redirect('/clients/?error=' + encodeURIComponent(tokens.error));
        }

        // Get user info
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const userInfo = await userInfoResponse.json();

        // Initialize Supabase client (service key for server-side operations)
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Parse state to get user context
        let stateData = {};
        if (state) {
            try {
                stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            } catch (e) {
                console.warn('Could not parse state:', e);
            }
        }

        // Calculate token expiry
        const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

        // Check if connection already exists for this email
        const { data: existingConnection } = await supabase
            .from('google_ads_connections')
            .select('id')
            .eq('email', userInfo.email)
            .single();

        let connection;
        let dbError;

        if (existingConnection) {
            // Update existing connection
            const result = await supabase
                .from('google_ads_connections')
                .update({
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_expires_at: expiresAt.toISOString(),
                    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
                    is_active: true,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingConnection.id)
                .select()
                .single();
            connection = result.data;
            dbError = result.error;
        } else {
            // Insert new connection
            const result = await supabase
                .from('google_ads_connections')
                .insert({
                    email: userInfo.email,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_expires_at: expiresAt.toISOString(),
                    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();
            connection = result.data;
            dbError = result.error;
        }

        if (dbError) {
            console.error('Database error:', dbError);
            return res.redirect('/clients/omicron/summary.html?error=db_error');
        }

        // Fetch accessible Google Ads accounts
        await fetchAndStoreAccounts(supabase, connection.id, tokens.access_token);

        // Redirect to success page or dashboard
        const returnUrl = stateData.returnUrl || '/clients/omicron/summary.html';
        res.redirect(returnUrl + '?connected=true');

    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect('/clients/omicron/summary.html?error=' + encodeURIComponent(error.message));
    }
}

/**
 * Fetch accessible Google Ads accounts and store them
 * Includes recursive fetching of MCC child accounts
 */
async function fetchAndStoreAccounts(supabase, connectionId, accessToken) {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

    if (!developerToken || !loginCustomerId) {
        console.warn('Missing developer token or login customer ID');
        return;
    }

    try {
        // Use Google Ads API to list accessible customers
        const response = await fetch(
            'https://googleads.googleapis.com/v23/customers:listAccessibleCustomers',
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'developer-token': developerToken,
                    'login-customer-id': loginCustomerId,
                },
            }
        );

        const data = await response.json();

        if (data.resourceNames) {
            // Extract customer IDs from resource names
            const customerIds = data.resourceNames.map(name =>
                name.replace('customers/', '')
            );

            // Track all accounts (including MCC children)
            const allAccountIds = new Set(customerIds);

            // Fetch details for each account
            for (const customerId of customerIds) {
                try {
                    const accountDetails = await fetchAccountDetails(
                        customerId,
                        accessToken,
                        developerToken,
                        loginCustomerId
                    );

                    if (accountDetails) {
                        await supabase
                            .from('google_ads_accounts')
                            .upsert({
                                connection_id: connectionId,
                                customer_id: customerId,
                                descriptive_name: accountDetails.descriptiveName,
                                currency_code: accountDetails.currencyCode,
                                time_zone: accountDetails.timeZone,
                                is_manager: accountDetails.manager || false,
                                parent_customer_id: null,
                                status: 'ENABLED',
                                updated_at: new Date().toISOString(),
                            }, {
                                onConflict: 'connection_id,customer_id',
                            });

                        // If this is an MCC account, fetch its child accounts
                        if (accountDetails.manager) {
                            const childAccounts = await fetchMccChildAccounts(
                                customerId,
                                accessToken,
                                developerToken,
                                loginCustomerId
                            );

                            for (const child of childAccounts) {
                                if (!allAccountIds.has(child.id)) {
                                    allAccountIds.add(child.id);

                                    await supabase
                                        .from('google_ads_accounts')
                                        .upsert({
                                            connection_id: connectionId,
                                            customer_id: child.id,
                                            descriptive_name: child.descriptiveName,
                                            currency_code: child.currencyCode,
                                            time_zone: child.timeZone,
                                            is_manager: child.manager || false,
                                            parent_customer_id: customerId,
                                            status: child.status || 'ENABLED',
                                            updated_at: new Date().toISOString(),
                                        }, {
                                            onConflict: 'connection_id,customer_id',
                                        });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Could not fetch details for account ${customerId}:`, e.message);
                }
            }
        }
    } catch (error) {
        console.error('Error fetching accounts:', error);
    }
}

/**
 * Fetch child accounts under an MCC account
 */
async function fetchMccChildAccounts(mccCustomerId, accessToken, developerToken, loginCustomerId) {
    const childAccounts = [];

    try {
        const query = `
            SELECT
                customer_client.id,
                customer_client.descriptive_name,
                customer_client.currency_code,
                customer_client.time_zone,
                customer_client.manager,
                customer_client.status
            FROM customer_client
            WHERE customer_client.level = 1
        `;

        const response = await fetch(
            `https://googleads.googleapis.com/v23/customers/${mccCustomerId}/googleAds:search`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'developer-token': developerToken,
                    'login-customer-id': loginCustomerId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query }),
            }
        );

        const data = await response.json();

        if (data.results) {
            for (const result of data.results) {
                const client = result.customerClient;
                if (client && client.id) {
                    childAccounts.push({
                        id: client.id.toString(),
                        descriptiveName: client.descriptiveName,
                        currencyCode: client.currencyCode,
                        timeZone: client.timeZone,
                        manager: client.manager || false,
                        status: client.status
                    });
                }
            }
        }
    } catch (error) {
        console.warn(`Error fetching child accounts for MCC ${mccCustomerId}:`, error.message);
    }

    return childAccounts;
}

/**
 * Fetch details for a specific Google Ads account
 */
async function fetchAccountDetails(customerId, accessToken, developerToken, loginCustomerId) {
    const query = `
        SELECT
            customer.id,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager
        FROM customer
        LIMIT 1
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': developerToken,
                'login-customer-id': loginCustomerId,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        }
    );

    const data = await response.json();

    if (data.results && data.results.length > 0) {
        return data.results[0].customer;
    }

    return null;
}

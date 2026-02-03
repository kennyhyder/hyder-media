/**
 * Google Ads Debug - Test API Connection
 * GET /api/google-ads/debug
 *
 * Tests the Google Ads API connection and shows what accounts are accessible
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const results = {
        config: {},
        connection: null,
        accessibleCustomers: null,
        accountDetails: [],
        errors: []
    };

    try {
        // Check config
        results.config = {
            hasDeveloperToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            hasLoginCustomerId: !!process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
            loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
            hasSupabaseUrl: !!process.env.SUPABASE_URL,
            hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY
        };

        // Initialize Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Get the most recent connection
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (connError) {
            results.errors.push({ step: 'get_connection', error: connError.message });
            return res.status(200).json(results);
        }

        results.connection = {
            id: connection.id,
            email: connection.email,
            hasAccessToken: !!connection.access_token,
            hasRefreshToken: !!connection.refresh_token,
            tokenExpiresAt: connection.token_expires_at,
            isExpired: new Date(connection.token_expires_at) < new Date()
        };

        let accessToken = connection.access_token;

        // Check if token is expired and refresh if needed
        if (results.connection.isExpired && connection.refresh_token) {
            results.errors.push({ step: 'token_check', message: 'Token expired, attempting refresh' });

            const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                    refresh_token: connection.refresh_token,
                    grant_type: 'refresh_token',
                }),
            });

            const refreshData = await refreshResponse.json();

            if (refreshData.error) {
                results.errors.push({ step: 'token_refresh', error: refreshData });
                return res.status(200).json(results);
            }

            accessToken = refreshData.access_token;

            // Update token in database
            await supabase
                .from('google_ads_connections')
                .update({
                    access_token: accessToken,
                    token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', connection.id);

            results.connection.tokenRefreshed = true;
        }

        // Test listing accessible customers
        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

        // Try WITHOUT login-customer-id first (not required for listAccessibleCustomers)
        const listResponse = await fetch(
            'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers',
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'developer-token': developerToken,
                },
            }
        );

        const listText = await listResponse.text();
        results.accessibleCustomersRaw = listText.substring(0, 500);
        results.accessibleCustomersStatus = listResponse.status;
        results.responseHeaders = Object.fromEntries(listResponse.headers.entries());
        results.requestDetails = {
            developerTokenLength: developerToken?.length,
            developerTokenPreview: developerToken ? developerToken.substring(0, 5) + '...' : null,
            loginCustomerId: loginCustomerId,
            accessTokenPreview: accessToken ? accessToken.substring(0, 20) + '...' : null
        };

        let listData;
        try {
            listData = JSON.parse(listText);
            results.accessibleCustomers = listData;
        } catch (e) {
            results.errors.push({ step: 'parse_customers', error: 'Response is not JSON', preview: listText.substring(0, 200) });
            return res.status(200).json(results);
        }

        if (listData.error) {
            results.errors.push({ step: 'list_customers', error: listData.error });

            // Try direct MCC query as fallback
            results.mccDirectQuery = await tryDirectMccQuery(accessToken, developerToken, loginCustomerId);
        }

        // Try to get details for each accessible customer
        if (listData.resourceNames) {
            for (const resourceName of listData.resourceNames) {
                const customerId = resourceName.replace('customers/', '');

                try {
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

                    const detailResponse = await fetch(
                        `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
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

                    const detailData = await detailResponse.json();

                    results.accountDetails.push({
                        customerId,
                        response: detailData
                    });
                } catch (e) {
                    results.accountDetails.push({
                        customerId,
                        error: e.message
                    });
                }
            }
        }

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message, stack: error.stack });
        return res.status(200).json(results);
    }
}

/**
 * Try to query the MCC account directly
 */
async function tryDirectMccQuery(accessToken, developerToken, loginCustomerId) {
    try {
        // Query the MCC account directly using its customer ID
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
            `https://googleads.googleapis.com/v18/customers/${loginCustomerId}/googleAds:search`,
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

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return { error: 'Response is not JSON', preview: text.substring(0, 200), status: response.status };
        }

        // If MCC works, also try to list client accounts under it
        if (data.results) {
            const clientsQuery = `
                SELECT
                    customer_client.id,
                    customer_client.descriptive_name,
                    customer_client.manager,
                    customer_client.status
                FROM customer_client
                LIMIT 100
            `;

            const clientsResponse = await fetch(
                `https://googleads.googleapis.com/v18/customers/${loginCustomerId}/googleAds:search`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'developer-token': developerToken,
                        'login-customer-id': loginCustomerId,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: clientsQuery }),
                }
            );

            const clientsData = await clientsResponse.json();

            return {
                mccAccount: data,
                clientAccounts: clientsData,
                status: response.status
            };
        }

        return { response: data, status: response.status };
    } catch (e) {
        return { error: e.message };
    }
}

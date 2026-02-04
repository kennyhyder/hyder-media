/**
 * Google Ads Debug - Test BUR and Top10 Access
 * GET /api/google-ads/debug-bur-top10
 *
 * Tries multiple login-customer-ids to find which gives access to BUR and Top10
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Accounts to test
    const TEST_ACCOUNTS = [
        { id: '4413390727', name: 'BUR' },
        { id: '1478467425', name: 'Top10usenet' },
    ];

    // Different login-customer-ids to try
    const LOGIN_CUSTOMER_IDS = [
        { id: '6736988718', name: 'Kenny Hyder MCC' },
        { id: '8086957043', name: 'Omicron MCC' },
        { id: '4413390727', name: 'BUR itself (direct)' },
        { id: '1478467425', name: 'Top10 itself (direct)' },
        { id: null, name: 'No login-customer-id' },
    ];

    const results = {
        connection: null,
        tests: [],
        errors: []
    };

    try {
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

        if (connError || !connection) {
            results.errors.push({ step: 'get_connection', error: connError?.message || 'No connection' });
            return res.status(200).json(results);
        }

        results.connection = {
            email: connection.email,
            tokenExpiresAt: connection.token_expires_at
        };

        let accessToken = connection.access_token;

        // Refresh if needed
        if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
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
            if (refreshData.access_token) {
                accessToken = refreshData.access_token;
            }
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

        // Test each account with each login-customer-id
        for (const account of TEST_ACCOUNTS) {
            const accountResults = {
                account: account.name,
                accountId: account.id,
                attempts: []
            };

            for (const loginMcc of LOGIN_CUSTOMER_IDS) {
                try {
                    const query = `
                        SELECT
                            customer.id,
                            customer.descriptive_name,
                            customer.currency_code
                        FROM customer
                        LIMIT 1
                    `;

                    const headers = {
                        'Authorization': `Bearer ${accessToken}`,
                        'developer-token': developerToken,
                        'Content-Type': 'application/json',
                    };

                    // Only add login-customer-id if specified
                    if (loginMcc.id) {
                        headers['login-customer-id'] = loginMcc.id;
                    }

                    const response = await fetch(
                        `https://googleads.googleapis.com/v23/customers/${account.id}/googleAds:search`,
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ query }),
                        }
                    );

                    const responseText = await response.text();
                    let data;
                    try {
                        data = JSON.parse(responseText);
                    } catch (parseError) {
                        accountResults.attempts.push({
                            loginCustomerId: loginMcc.id,
                            loginCustomerName: loginMcc.name,
                            status: 'PARSE_ERROR',
                            httpStatus: response.status,
                            responsePreview: responseText.substring(0, 200)
                        });
                        continue;
                    }

                    if (data.results && data.results.length > 0) {
                        accountResults.attempts.push({
                            loginCustomerId: loginMcc.id,
                            loginCustomerName: loginMcc.name,
                            status: 'SUCCESS',
                            customerName: data.results[0].customer?.descriptiveName
                        });
                    } else if (data.error) {
                        accountResults.attempts.push({
                            loginCustomerId: loginMcc.id,
                            loginCustomerName: loginMcc.name,
                            status: 'ERROR',
                            errorCode: data.error.code,
                            errorStatus: data.error.status,
                            errorMessage: data.error.message?.substring(0, 100)
                        });
                    } else {
                        accountResults.attempts.push({
                            loginCustomerId: loginMcc.id,
                            loginCustomerName: loginMcc.name,
                            status: 'NO_DATA'
                        });
                    }
                } catch (e) {
                    accountResults.attempts.push({
                        loginCustomerId: loginMcc.id,
                        loginCustomerName: loginMcc.name,
                        status: 'EXCEPTION',
                        error: e.message
                    });
                }
            }

            results.tests.push(accountResults);
        }

        // Summary - find working combinations
        results.summary = {
            BUR: results.tests.find(t => t.account === 'BUR')?.attempts.find(a => a.status === 'SUCCESS') || 'No working login-customer-id found',
            Top10: results.tests.find(t => t.account === 'Top10usenet')?.attempts.find(a => a.status === 'SUCCESS') || 'No working login-customer-id found'
        };

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

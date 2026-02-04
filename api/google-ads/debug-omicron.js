/**
 * Google Ads Debug - Test Omicron MCC Access
 * GET /api/google-ads/debug-omicron
 *
 * Tests access to Omicron accounts using Omicron MCC as login-customer-id
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Omicron MCC ID (without dashes)
    const OMICRON_MCC_ID = '8086957043';

    // All Omicron account IDs to test
    const OMICRON_ACCOUNTS = [
        { id: '8086957043', name: 'Omicron MCC' },
        { id: '7079118680', name: 'Eweka' },
        { id: '5380661321', name: 'Easynews' },
        { id: '7566341629', name: 'Newshosting' },
        { id: '3972303325', name: 'UsenetServer' },
        { id: '1146581474', name: 'Tweak' },
        { id: '1721346287', name: 'Pure' },
        { id: '8908689985', name: 'Sunny' },
        { id: '4413390727', name: 'BUR' },
        { id: '1478467425', name: 'Top10usenet' },
    ];

    const results = {
        loginCustomerId: OMICRON_MCC_ID,
        connection: null,
        accountTests: [],
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

        if (connError) {
            results.errors.push({ step: 'get_connection', error: connError.message });
            return res.status(200).json(results);
        }

        results.connection = {
            email: connection.email,
            tokenExpiresAt: connection.token_expires_at,
            isExpired: new Date(connection.token_expires_at) < new Date()
        };

        let accessToken = connection.access_token;

        // Refresh token if expired
        if (results.connection.isExpired && connection.refresh_token) {
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
                results.connection.tokenRefreshed = true;
            } else {
                results.errors.push({ step: 'refresh', error: refreshData });
            }
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

        // Test each Omicron account using Omicron MCC as login-customer-id
        for (const account of OMICRON_ACCOUNTS) {
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

                const response = await fetch(
                    `https://googleads.googleapis.com/v23/customers/${account.id}/googleAds:search`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'developer-token': developerToken,
                            'login-customer-id': OMICRON_MCC_ID,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query }),
                    }
                );

                const data = await response.json();

                if (data.results && data.results.length > 0) {
                    const customer = data.results[0].customer;
                    results.accountTests.push({
                        id: account.id,
                        expectedName: account.name,
                        status: 'SUCCESS',
                        actualName: customer.descriptiveName,
                        isManager: customer.manager,
                        currency: customer.currencyCode
                    });
                } else if (data.error) {
                    results.accountTests.push({
                        id: account.id,
                        expectedName: account.name,
                        status: 'ERROR',
                        errorCode: data.error.code,
                        errorMessage: data.error.message,
                        errorStatus: data.error.status
                    });
                } else {
                    results.accountTests.push({
                        id: account.id,
                        expectedName: account.name,
                        status: 'NO_DATA',
                        response: data
                    });
                }
            } catch (e) {
                results.accountTests.push({
                    id: account.id,
                    expectedName: account.name,
                    status: 'EXCEPTION',
                    error: e.message
                });
            }
        }

        // Summary
        results.summary = {
            total: OMICRON_ACCOUNTS.length,
            success: results.accountTests.filter(a => a.status === 'SUCCESS').length,
            errors: results.accountTests.filter(a => a.status === 'ERROR').length
        };

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

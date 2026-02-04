/**
 * Google Ads - Omicron Dashboard Data
 * GET /api/google-ads/omicron-data
 *
 * Fetches metrics for all Omicron accounts using correct MCC login-customer-ids
 */

import { createClient } from '@supabase/supabase-js';

// Account configuration with their respective MCC login-customer-ids
const ACCOUNT_CONFIG = [
    // Omicron MCC accounts (use 8086957043 as login-customer-id)
    { id: '8086957043', name: 'Omicron MCC', mcc: '8086957043', color: '#6366f1' },
    { id: '7079118680', name: 'Eweka', mcc: '8086957043', color: '#22c55e' },
    { id: '5380661321', name: 'Easynews', mcc: '8086957043', color: '#f59e0b' },
    { id: '7566341629', name: 'Newshosting', mcc: '8086957043', color: '#8b5cf6' },
    { id: '3972303325', name: 'UsenetServer', mcc: '8086957043', color: '#14b8a6' },
    { id: '1146581474', name: 'Tweak', mcc: '8086957043', color: '#ef4444' },
    { id: '1721346287', name: 'Pure', mcc: '8086957043', color: '#6366f1' },
    { id: '8908689985', name: 'Sunny', mcc: '8086957043', color: '#eab308' },
    // BUR - under Kenny Hyder MCC
    { id: '4413390727', name: 'BUR', mcc: '6736988718', color: '#3b82f6' },
    // Top10usenet - direct access (use itself as login-customer-id)
    { id: '1478467425', name: 'Top10usenet', mcc: '1478467425', color: '#ec4899' },
    // Privado VPN - under Privado MCC
    { id: '6759792960', name: 'Privado', mcc: '2031897556', color: '#10b981' },
];

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse date range from query params (default: last 30 days)
    const days = parseInt(req.query.days) || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const dateRange = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

    const results = {
        dateRange,
        accounts: [],
        totals: {
            spend: 0,
            clicks: 0,
            impressions: 0,
            conversions: 0,
            conversionValue: 0
        },
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
            results.errors.push({ step: 'get_connection', error: connError?.message || 'No connection found' });
            return res.status(200).json(results);
        }

        let accessToken = connection.access_token;

        // Refresh token if expired
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
                // Update token in database
                await supabase
                    .from('google_ads_connections')
                    .update({
                        access_token: accessToken,
                        token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                    })
                    .eq('id', connection.id);
            } else {
                results.errors.push({ step: 'refresh', error: refreshData });
                return res.status(200).json(results);
            }
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

        // Fetch metrics for each account (skip MCC accounts - they don't have direct metrics)
        for (const account of ACCOUNT_CONFIG) {
            // Skip MCC accounts (manager accounts don't have campaign metrics)
            if (account.id === '8086957043') continue;

            try {
                const metrics = await fetchAccountMetrics(
                    account.id,
                    account.mcc,
                    accessToken,
                    developerToken,
                    dateRange
                );

                if (metrics.error) {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        status: 'error',
                        error: metrics.error
                    });
                } else {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        status: 'success',
                        metrics: metrics
                    });

                    // Add to totals
                    results.totals.spend += metrics.spend || 0;
                    results.totals.clicks += metrics.clicks || 0;
                    results.totals.impressions += metrics.impressions || 0;
                    results.totals.conversions += metrics.conversions || 0;
                    results.totals.conversionValue += metrics.conversionValue || 0;
                }
            } catch (e) {
                results.accounts.push({
                    id: account.id,
                    name: account.name,
                    color: account.color,
                    status: 'exception',
                    error: e.message
                });
            }
        }

        // Calculate derived totals
        results.totals.ctr = results.totals.impressions > 0
            ? (results.totals.clicks / results.totals.impressions)
            : 0;
        results.totals.cpa = results.totals.conversions > 0
            ? (results.totals.spend / results.totals.conversions)
            : 0;
        results.totals.roas = results.totals.spend > 0
            ? (results.totals.conversionValue / results.totals.spend)
            : 0;
        results.totals.convRate = results.totals.clicks > 0
            ? (results.totals.conversions / results.totals.clicks)
            : 0;

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

/**
 * Fetch metrics for a single account
 */
async function fetchAccountMetrics(customerId, loginCustomerId, accessToken, developerToken, dateRange) {
    const query = `
        SELECT
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value,
            metrics.ctr,
            metrics.average_cpc,
            metrics.cost_per_conversion
        FROM customer
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
    `;

    try {
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

        if (data.error) {
            return { error: data.error.message || 'API error' };
        }

        // Aggregate metrics from results
        let spend = 0, clicks = 0, impressions = 0, conversions = 0, conversionValue = 0;

        if (data.results) {
            for (const row of data.results) {
                const m = row.metrics || {};
                // Parse all values as numbers to prevent string concatenation
                spend += parseFloat(m.costMicros || 0) / 1000000; // Convert micros to dollars
                clicks += parseInt(m.clicks || 0, 10);
                impressions += parseInt(m.impressions || 0, 10);
                conversions += parseFloat(m.conversions || 0);
                conversionValue += parseFloat(m.conversionsValue || 0);
            }
        }

        return {
            spend,
            clicks,
            impressions,
            conversions,
            conversionValue,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            roas: spend > 0 ? conversionValue / spend : 0,
            convRate: clicks > 0 ? conversions / clicks : 0
        };
    } catch (e) {
        return { error: e.message };
    }
}

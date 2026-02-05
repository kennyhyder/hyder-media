/**
 * Google Ads - Auto Glass 2020 Historical Spend Data
 * GET /api/google-ads/ag2020-spend
 *
 * Fetches monthly ad spend from two AG2020 accounts:
 * - 505-336-5860 (current, via MCC)
 * - 439-961-4856 (historical, direct access)
 */

import { createClient } from '@supabase/supabase-js';

// Account configuration
const AG2020_ACCOUNTS = [
    { id: '5053365860', name: 'AG2020 Current', mcc: '6736988718', color: '#1B4B82' },
    { id: '4399614856', name: 'AG2020 Historical', mcc: null, color: '#6BA4D0' }, // Direct access
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

    // Parse parameters - get all available historical data
    const startDate = req.query.startDate || '2020-01-01';
    const endDate = req.query.endDate || new Date().toISOString().split('T')[0];

    console.log(`Fetching AG2020 spend from ${startDate} to ${endDate}`);

    // Initialize Supabase to get OAuth tokens
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    // Get OAuth tokens
    const { data: tokenData, error: tokenError } = await supabase
        .from('google_ads_tokens')
        .select('*')
        .single();

    if (tokenError || !tokenData) {
        console.error('Token error:', tokenError);
        return res.status(401).json({
            error: 'Not authenticated with Google Ads',
            details: 'Please connect via /api/google-ads/auth'
        });
    }

    // Check if token needs refresh
    let accessToken = tokenData.access_token;
    const tokenExpiry = new Date(tokenData.expires_at);

    if (tokenExpiry < new Date()) {
        console.log('Token expired, refreshing...');
        try {
            const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                    refresh_token: tokenData.refresh_token,
                    grant_type: 'refresh_token'
                })
            });

            const refreshData = await refreshResponse.json();
            if (refreshData.access_token) {
                accessToken = refreshData.access_token;

                // Update token in database
                await supabase
                    .from('google_ads_tokens')
                    .update({
                        access_token: refreshData.access_token,
                        expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
                    })
                    .eq('id', tokenData.id);
            } else {
                throw new Error('Failed to refresh token');
            }
        } catch (refreshError) {
            console.error('Token refresh error:', refreshError);
            return res.status(401).json({ error: 'Token refresh failed', details: refreshError.message });
        }
    }

    const results = {};
    const errors = [];

    // Fetch data for each account
    for (const account of AG2020_ACCOUNTS) {
        try {
            console.log(`Fetching data for ${account.name} (${account.id})...`);

            // Build the Google Ads API query for monthly spend
            const query = `
                SELECT
                    segments.month,
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.conversions,
                    metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
            `;

            const loginCustomerId = account.mcc || account.id;

            const response = await fetch(
                `https://googleads.googleapis.com/v18/customers/${account.id}/googleAds:searchStream`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                        'login-customer-id': loginCustomerId,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Error for ${account.name}:`, errorText);
                errors.push({ account: account.name, error: errorText });
                continue;
            }

            const data = await response.json();

            // Process the streaming response
            const monthlySpend = {};

            if (data && Array.isArray(data)) {
                for (const batch of data) {
                    if (batch.results) {
                        for (const row of batch.results) {
                            const month = row.segments?.month;
                            if (!month) continue;

                            if (!monthlySpend[month]) {
                                monthlySpend[month] = {
                                    month,
                                    spend: 0,
                                    clicks: 0,
                                    impressions: 0,
                                    conversions: 0,
                                    conversionValue: 0
                                };
                            }

                            const m = monthlySpend[month];
                            m.spend += (row.metrics?.costMicros || 0) / 1000000;
                            m.clicks += row.metrics?.clicks || 0;
                            m.impressions += row.metrics?.impressions || 0;
                            m.conversions += row.metrics?.conversions || 0;
                            m.conversionValue += row.metrics?.conversionsValue || 0;
                        }
                    }
                }
            }

            results[account.id] = {
                name: account.name,
                color: account.color,
                monthly: Object.values(monthlySpend).sort((a, b) => a.month.localeCompare(b.month))
            };

            console.log(`Got ${Object.keys(monthlySpend).length} months for ${account.name}`);

        } catch (err) {
            console.error(`Exception for ${account.name}:`, err);
            errors.push({ account: account.name, error: err.message });
        }
    }

    // Merge monthly spend from both accounts
    const combinedMonthly = {};

    for (const accountData of Object.values(results)) {
        for (const month of accountData.monthly) {
            if (!combinedMonthly[month.month]) {
                combinedMonthly[month.month] = {
                    month: month.month,
                    spend: 0,
                    clicks: 0,
                    impressions: 0,
                    conversions: 0,
                    conversionValue: 0
                };
            }
            const c = combinedMonthly[month.month];
            c.spend += month.spend;
            c.clicks += month.clicks;
            c.impressions += month.impressions;
            c.conversions += month.conversions;
            c.conversionValue += month.conversionValue;
        }
    }

    // Round spend values
    Object.values(combinedMonthly).forEach(m => {
        m.spend = Math.round(m.spend * 100) / 100;
        m.conversionValue = Math.round(m.conversionValue * 100) / 100;
    });

    return res.status(200).json({
        success: true,
        accounts: results,
        combined: Object.values(combinedMonthly).sort((a, b) => a.month.localeCompare(b.month)),
        errors: errors.length > 0 ? errors : undefined
    });
}

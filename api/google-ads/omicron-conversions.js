/**
 * Google Ads - Omicron Conversion Action Breakdown
 * GET /api/google-ads/omicron-conversions
 *
 * Returns monthly metrics segmented by conversion action name
 * - For Review Sites (BUR, Top10): Shows which brand conversions came from
 * - For Owned Sites: Shows SKU/product breakdown
 */

import { createClient } from '@supabase/supabase-js';

// Account configuration with their respective MCC login-customer-ids
const ACCOUNT_CONFIG = [
    // Review sites - track brand conversions
    { id: '4413390727', name: 'BUR', mcc: '6736988718', color: '#3b82f6', group: 'review' },
    { id: '1478467425', name: 'Top10usenet', mcc: '1478467425', color: '#ec4899', group: 'review' },
    // Owned sites - track SKU conversions
    { id: '7079118680', name: 'Eweka', mcc: '8086957043', color: '#22c55e', group: 'owned' },
    { id: '5380661321', name: 'Easynews', mcc: '8086957043', color: '#f59e0b', group: 'owned' },
    { id: '7566341629', name: 'Newshosting', mcc: '8086957043', color: '#8b5cf6', group: 'owned' },
    { id: '3972303325', name: 'UsenetServer', mcc: '8086957043', color: '#14b8a6', group: 'owned' },
    { id: '1146581474', name: 'Tweak', mcc: '8086957043', color: '#ef4444', group: 'owned' },
    { id: '1721346287', name: 'Pure', mcc: '8086957043', color: '#6366f1', group: 'owned' },
    { id: '8908689985', name: 'Sunny', mcc: '8086957043', color: '#eab308', group: 'owned' },
    { id: '6759792960', name: 'Privado', mcc: '2031897556', color: '#10b981', group: 'owned' },
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

    // Parse parameters
    const months = parseInt(req.query.months) || 13;
    const accountFilter = req.query.account; // Optional: filter to single account

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setDate(1);

    const dateRange = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

    const results = {
        dateRange,
        accounts: [],
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

        // Filter accounts if specified
        const accountsToFetch = accountFilter
            ? ACCOUNT_CONFIG.filter(a => a.name.toLowerCase() === accountFilter.toLowerCase() || a.id === accountFilter)
            : ACCOUNT_CONFIG;

        // Fetch conversion action data for each account
        for (const account of accountsToFetch) {
            try {
                const conversionData = await fetchConversionActionData(
                    account.id,
                    account.mcc,
                    accessToken,
                    developerToken,
                    dateRange
                );

                if (conversionData.error) {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        group: account.group,
                        status: 'error',
                        error: conversionData.error
                    });
                } else {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        group: account.group,
                        status: 'success',
                        conversionActions: conversionData.conversionActions,
                        monthly: conversionData.monthly,
                        totals: conversionData.totals
                    });
                }
            } catch (e) {
                results.accounts.push({
                    id: account.id,
                    name: account.name,
                    color: account.color,
                    group: account.group,
                    status: 'exception',
                    error: e.message
                });
            }
        }

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

/**
 * Fetch conversion action data for a single account
 */
async function fetchConversionActionData(customerId, loginCustomerId, accessToken, developerToken, dateRange) {
    // Query for conversion metrics segmented by conversion action and month
    // Must use campaign resource (not customer) to segment by conversion action
    const query = `
        SELECT
            segments.conversion_action_name,
            segments.month,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status != 'REMOVED'
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

        // Track unique conversion actions and aggregate by month
        const conversionActionSet = new Set();
        const monthlyMap = {};
        const actionTotals = {};

        if (data.results) {
            for (const row of data.results) {
                const actionName = row.segments?.conversionActionName || 'Unknown';
                const month = row.segments?.month || '';
                const m = row.metrics || {};

                if (!month) continue;

                // Skip non-primary/duplicate conversion actions (usually contain "imported" or system names)
                // Keep actions that look like product names, brand names, or SKUs
                if (shouldSkipConversionAction(actionName)) continue;

                conversionActionSet.add(actionName);

                const conversions = parseFloat(m.conversions || 0);
                const conversionValue = parseFloat(m.conversionsValue || 0);

                // Initialize month if needed
                if (!monthlyMap[month]) {
                    monthlyMap[month] = {
                        month,
                        actions: {},
                        total: { conversions: 0, value: 0 }
                    };
                }

                // Initialize action in month if needed
                if (!monthlyMap[month].actions[actionName]) {
                    monthlyMap[month].actions[actionName] = { conversions: 0, value: 0 };
                }

                // Add to monthly action totals
                monthlyMap[month].actions[actionName].conversions += conversions;
                monthlyMap[month].actions[actionName].value += conversionValue;
                monthlyMap[month].total.conversions += conversions;
                monthlyMap[month].total.value += conversionValue;

                // Track overall action totals
                if (!actionTotals[actionName]) {
                    actionTotals[actionName] = { conversions: 0, value: 0 };
                }
                actionTotals[actionName].conversions += conversions;
                actionTotals[actionName].value += conversionValue;
            }
        }

        // Sort months and convert to array
        const monthly = Object.values(monthlyMap)
            .sort((a, b) => a.month.localeCompare(b.month));

        // Sort conversion actions by total conversions (descending)
        const conversionActions = Object.entries(actionTotals)
            .sort((a, b) => b[1].conversions - a[1].conversions)
            .map(([name, data]) => ({ name, ...data }));

        // Calculate totals
        const totals = {
            conversions: conversionActions.reduce((sum, a) => sum + a.conversions, 0),
            value: conversionActions.reduce((sum, a) => sum + a.value, 0)
        };

        return { conversionActions, monthly, totals };

    } catch (e) {
        return { error: e.message };
    }
}

/**
 * Filter out non-primary conversion actions
 * Keep: Product names, SKU names, brand names
 * Skip: System conversions, imported conversions, generic tracking
 */
function shouldSkipConversionAction(actionName) {
    const lowerName = actionName.toLowerCase();

    // Skip patterns for non-primary conversions
    const skipPatterns = [
        'website',
        'page view',
        'pageview',
        'all pages',
        'click',
        'session',
        'engaged',
        'scroll',
        'video',
        'form',
        'lead',
        'call',
        'direction',
        'store visit',
        'import',
        'offline',
        'ga4',
        'analytics',
        'cross-device',
        'cross device',
        'view-through',
        'view through'
    ];

    for (const pattern of skipPatterns) {
        if (lowerName.includes(pattern)) {
            return true;
        }
    }

    return false;
}

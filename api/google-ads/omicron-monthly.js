/**
 * Google Ads - Omicron Monthly Data with Brand/Non-Brand Breakdown
 * GET /api/google-ads/omicron-monthly
 *
 * Returns monthly metrics with campaign-level brand/non-brand classification
 * This powers the executive PPC weekly update style dashboard
 */

import { createClient } from '@supabase/supabase-js';

// Account configuration with their respective MCC login-customer-ids
const ACCOUNT_CONFIG = [
    // Omicron MCC child accounts
    { id: '7079118680', name: 'Eweka', mcc: '8086957043', color: '#22c55e', group: 'owned' },
    { id: '5380661321', name: 'Easynews', mcc: '8086957043', color: '#f59e0b', group: 'owned' },
    { id: '7566341629', name: 'Newshosting', mcc: '8086957043', color: '#8b5cf6', group: 'owned' },
    { id: '3972303325', name: 'UsenetServer', mcc: '8086957043', color: '#14b8a6', group: 'owned' },
    { id: '1146581474', name: 'Tweak', mcc: '8086957043', color: '#ef4444', group: 'owned' },
    { id: '1721346287', name: 'Pure', mcc: '8086957043', color: '#6366f1', group: 'owned' },
    { id: '8908689985', name: 'Sunny', mcc: '8086957043', color: '#eab308', group: 'owned' },
    // Review sites - BUR and Top10
    { id: '4413390727', name: 'BUR', mcc: '6736988718', color: '#3b82f6', group: 'review' },
    { id: '1478467425', name: 'Top10usenet', mcc: '1478467425', color: '#ec4899', group: 'review' },
    // Privado VPN - under Privado MCC
    { id: '6759792960', name: 'Privado', mcc: '2031897556', color: '#10b981', group: 'owned' },
];

// Brand keywords to identify brand campaigns (case-insensitive)
// NOTE: We check for explicit "non-brand" FIRST before checking these patterns
const BRAND_PATTERNS = [
    'eweka',
    'easynews',
    'newshosting',
    'usenetserver',
    'usenet server',
    'tweaknews',
    'tweak news',
    'pure usenet',
    'sunny usenet',
    'bestusenetreviews',
    'best usenet reviews',
    'bur',
    'top10usenet',
    'top 10 usenet',
    'privado',
    'privadovpn',
    'ownedsites',   // Top10usenet brand campaigns
    'owned sites',
    'owned-sites'
];

// Non-brand patterns to explicitly identify non-brand campaigns
// These take priority over brand patterns
const NON_BRAND_PATTERNS = [
    'non-brand',
    'nonbrand',
    'non brand',
    'generic',
    'competitor',
    'discovery',
    'dsa',  // Dynamic Search Ads often non-brand
    'prospecting'
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

    // Parse parameters — prefer `lookback` (new), fall back to legacy `months`
    const { dateRange, granularity, lookback } = parseLookback(req);

    const results = {
        dateRange,
        granularity,
        lookback,
        accounts: [],
        monthlyTotals: [],
        groupTotals: {
            review: { brand: [], nonBrand: [] },
            owned: { brand: [], nonBrand: [] }
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

        // Fetch monthly metrics for each account
        for (const account of ACCOUNT_CONFIG) {
            try {
                const monthlyData = await fetchAccountMonthlyMetrics(
                    account.id,
                    account.mcc,
                    accessToken,
                    developerToken,
                    dateRange,
                    account.name,
                    granularity
                );

                if (monthlyData.error) {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        group: account.group,
                        status: 'error',
                        error: monthlyData.error
                    });
                } else {
                    results.accounts.push({
                        id: account.id,
                        name: account.name,
                        color: account.color,
                        group: account.group,
                        status: 'success',
                        monthly: monthlyData.monthly,
                        totals: monthlyData.totals
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

        // Calculate group-level aggregations (Review Sites vs Owned Sites)
        const reviewAccounts = results.accounts.filter(a => a.group === 'review' && a.status === 'success');
        const ownedAccounts = results.accounts.filter(a => a.group === 'owned' && a.status === 'success');

        results.groupTotals.review = aggregateMonthlyByGroup(reviewAccounts);
        results.groupTotals.owned = aggregateMonthlyByGroup(ownedAccounts);

        // Calculate all-accounts monthly totals
        const allAccounts = results.accounts.filter(a => a.status === 'success');
        results.monthlyTotals = aggregateMonthlyByGroup(allAccounts);

        return res.status(200).json(results);

    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

/**
 * Aggregate monthly data across multiple accounts
 */
function aggregateMonthlyByGroup(accounts) {
    const monthlyMap = {};

    for (const account of accounts) {
        if (!account.monthly) continue;

        for (const m of account.monthly) {
            if (!monthlyMap[m.month]) {
                monthlyMap[m.month] = {
                    month: m.month,
                    brand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
                    nonBrand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
                    total: { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
                };
            }

            monthlyMap[m.month].brand.spend += m.brand.spend || 0;
            monthlyMap[m.month].brand.conversions += m.brand.conversions || 0;
            monthlyMap[m.month].brand.clicks += m.brand.clicks || 0;
            monthlyMap[m.month].brand.impressions += m.brand.impressions || 0;

            monthlyMap[m.month].nonBrand.spend += m.nonBrand.spend || 0;
            monthlyMap[m.month].nonBrand.conversions += m.nonBrand.conversions || 0;
            monthlyMap[m.month].nonBrand.clicks += m.nonBrand.clicks || 0;
            monthlyMap[m.month].nonBrand.impressions += m.nonBrand.impressions || 0;

            monthlyMap[m.month].total.spend += m.total.spend || 0;
            monthlyMap[m.month].total.conversions += m.total.conversions || 0;
            monthlyMap[m.month].total.clicks += m.total.clicks || 0;
            monthlyMap[m.month].total.impressions += m.total.impressions || 0;
        }
    }

    // Calculate CPAs for each month
    for (const month of Object.values(monthlyMap)) {
        month.brand.cpa = month.brand.conversions > 0 ? month.brand.spend / month.brand.conversions : 0;
        month.nonBrand.cpa = month.nonBrand.conversions > 0 ? month.nonBrand.spend / month.nonBrand.conversions : 0;
        month.total.cpa = month.total.conversions > 0 ? month.total.spend / month.total.conversions : 0;
    }

    // Return sorted by month
    return Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Fetch metrics for a single account with brand/non-brand breakdown.
 * `granularity` is 'day' or 'month' — controls the segment used for bucketing.
 */
async function fetchAccountMonthlyMetrics(customerId, loginCustomerId, accessToken, developerToken, dateRange, accountName, granularity = 'month') {
    const segmentField = granularity === 'day' ? 'segments.date' : 'segments.month';
    const query = `
        SELECT
            campaign.name,
            ${segmentField},
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
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

        // Group by month and brand type
        const monthlyMap = {};

        if (data.results) {
            for (const row of data.results) {
                const campaignName = row.campaign?.name || '';
                // Bucket key — 'month' field name is kept for response compat,
                // but contains a YYYY-MM-DD day string when granularity is 'day'.
                const month = granularity === 'day'
                    ? (row.segments?.date || '')
                    : (row.segments?.month || '');
                const m = row.metrics || {};

                if (!month) continue;

                // Determine if this is a brand campaign
                const isBrand = isBrandCampaign(campaignName, accountName);

                if (!monthlyMap[month]) {
                    monthlyMap[month] = {
                        month,
                        brand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
                        nonBrand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
                        total: { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
                    };
                }

                const spend = parseFloat(m.costMicros || 0) / 1000000;
                const conversions = parseFloat(m.conversions || 0);
                const clicks = parseInt(m.clicks || 0, 10);
                const impressions = parseInt(m.impressions || 0, 10);

                const bucket = isBrand ? 'brand' : 'nonBrand';
                monthlyMap[month][bucket].spend += spend;
                monthlyMap[month][bucket].conversions += conversions;
                monthlyMap[month][bucket].clicks += clicks;
                monthlyMap[month][bucket].impressions += impressions;

                monthlyMap[month].total.spend += spend;
                monthlyMap[month].total.conversions += conversions;
                monthlyMap[month].total.clicks += clicks;
                monthlyMap[month].total.impressions += impressions;
            }
        }

        // Calculate CPAs and sort
        const monthly = Object.values(monthlyMap)
            .map(m => {
                m.brand.cpa = m.brand.conversions > 0 ? m.brand.spend / m.brand.conversions : 0;
                m.nonBrand.cpa = m.nonBrand.conversions > 0 ? m.nonBrand.spend / m.nonBrand.conversions : 0;
                m.total.cpa = m.total.conversions > 0 ? m.total.spend / m.total.conversions : 0;
                return m;
            })
            .sort((a, b) => a.month.localeCompare(b.month));

        // Calculate account totals
        const totals = {
            brand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
            nonBrand: { spend: 0, conversions: 0, clicks: 0, impressions: 0 },
            total: { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
        };

        for (const m of monthly) {
            totals.brand.spend += m.brand.spend;
            totals.brand.conversions += m.brand.conversions;
            totals.brand.clicks += m.brand.clicks;
            totals.brand.impressions += m.brand.impressions;

            totals.nonBrand.spend += m.nonBrand.spend;
            totals.nonBrand.conversions += m.nonBrand.conversions;
            totals.nonBrand.clicks += m.nonBrand.clicks;
            totals.nonBrand.impressions += m.nonBrand.impressions;

            totals.total.spend += m.total.spend;
            totals.total.conversions += m.total.conversions;
            totals.total.clicks += m.total.clicks;
            totals.total.impressions += m.total.impressions;
        }

        totals.brand.cpa = totals.brand.conversions > 0 ? totals.brand.spend / totals.brand.conversions : 0;
        totals.nonBrand.cpa = totals.nonBrand.conversions > 0 ? totals.nonBrand.spend / totals.nonBrand.conversions : 0;
        totals.total.cpa = totals.total.conversions > 0 ? totals.total.spend / totals.total.conversions : 0;

        return { monthly, totals };

    } catch (e) {
        return { error: e.message };
    }
}

/**
 * Determine if a campaign is a brand campaign based on name patterns
 * Non-brand patterns take priority (e.g., "BUR - Non-Brand" is non-brand)
 *
 * Account-specific rules:
 * - Top10usenet: Only 'ownedsites' campaigns are brand, everything else is non-brand
 */
function isBrandCampaign(campaignName, accountName = '') {
    const nameLower = campaignName.toLowerCase();
    const accountLower = accountName.toLowerCase();

    // Special handling for Top10usenet:
    // Only 'ownedsites' campaigns are brand, all others are non-brand
    if (accountLower === 'top10usenet') {
        return nameLower.includes('ownedsites') ||
               nameLower.includes('owned sites') ||
               nameLower.includes('owned-sites');
    }

    // For all other accounts, use standard logic:
    // First check if explicitly marked as non-brand
    if (NON_BRAND_PATTERNS.some(pattern => nameLower.includes(pattern.toLowerCase()))) {
        return false;
    }

    // Then check if it matches brand patterns
    // Also check for explicit "brand" keyword but not as part of "non-brand"
    if (nameLower.includes('brand') && !nameLower.includes('non')) {
        return true;
    }

    return BRAND_PATTERNS.some(pattern => nameLower.includes(pattern.toLowerCase()));
}

/**
 * Parse the lookback window from the request.
 * Supported `lookback` values: '7d', '1mo', '3mo', '6mo', '13mo'.
 * Falls back to legacy `months` query param, then to 13mo.
 * Returns { dateRange, granularity, lookback }.
 *   - granularity is 'day' for 7d/1mo, 'month' otherwise.
 */
function parseLookback(req) {
    const lookbackRaw = (req.query.lookback || '').toString().toLowerCase();
    const monthsParam = parseInt(req.query.months);

    const endDate = new Date();
    const startDate = new Date(endDate);
    let granularity = 'month';
    let lookback = lookbackRaw;

    if (lookbackRaw === '7d') {
        // 7 days inclusive of today
        startDate.setDate(endDate.getDate() - 6);
        granularity = 'day';
    } else if (lookbackRaw === '1mo' || lookbackRaw === '30d') {
        // 30 days inclusive of today, daily buckets
        startDate.setDate(endDate.getDate() - 29);
        granularity = 'day';
        lookback = '1mo';
    } else if (lookbackRaw === '3mo') {
        startDate.setMonth(endDate.getMonth() - 3);
        startDate.setDate(1);
    } else if (lookbackRaw === '6mo') {
        startDate.setMonth(endDate.getMonth() - 6);
        startDate.setDate(1);
    } else if (lookbackRaw === '13mo') {
        startDate.setMonth(endDate.getMonth() - 13);
        startDate.setDate(1);
    } else if (!isNaN(monthsParam)) {
        startDate.setMonth(endDate.getMonth() - monthsParam);
        startDate.setDate(1);
        lookback = `${monthsParam}mo`;
    } else {
        // Default
        startDate.setMonth(endDate.getMonth() - 13);
        startDate.setDate(1);
        lookback = '13mo';
    }

    return {
        dateRange: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
        },
        granularity,
        lookback
    };
}

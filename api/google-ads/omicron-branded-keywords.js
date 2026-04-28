/**
 * Google Ads - Omicron Branded Keyword Analysis
 * GET /api/google-ads/omicron-branded-keywords
 *
 * Returns keyword-level performance data for BRANDED campaigns only,
 * across all 10 accounts. Powers the Brand Defense tab, which models
 * what would happen if we paused branded ad spend (assuming the
 * owned-domain organic #1 listing would capture those clicks).
 *
 * Query params:
 *   lookback=7d|1mo|this_month|last_month|3mo|6mo|13mo  (default 3mo)
 *   limit=500  (max keywords to return, ranked by cost desc)
 */

import { createClient } from '@supabase/supabase-js';

// Brand Defense scope is the usenet portfolio only — Privado (VPN) is excluded
// since the brand-bidding question is about usenet-property cannibalization.
const ACCOUNT_CONFIG = [
    { id: '7079118680', name: 'Eweka', mcc: '8086957043', color: '#22c55e', group: 'owned', ownedDomain: 'eweka.nl' },
    { id: '5380661321', name: 'Easynews', mcc: '8086957043', color: '#f59e0b', group: 'owned', ownedDomain: 'easynews.com' },
    { id: '7566341629', name: 'Newshosting', mcc: '8086957043', color: '#8b5cf6', group: 'owned', ownedDomain: 'newshosting.com' },
    { id: '3972303325', name: 'UsenetServer', mcc: '8086957043', color: '#14b8a6', group: 'owned', ownedDomain: 'usenetserver.com' },
    { id: '1146581474', name: 'Tweak', mcc: '8086957043', color: '#ef4444', group: 'owned', ownedDomain: 'tweaknews.eu' },
    { id: '1721346287', name: 'Pure', mcc: '8086957043', color: '#6366f1', group: 'owned', ownedDomain: 'pureusenet.nl' },
    { id: '8908689985', name: 'Sunny', mcc: '8086957043', color: '#eab308', group: 'owned', ownedDomain: 'sunnyusenet.com' },
    { id: '4413390727', name: 'BUR', mcc: '6736988718', color: '#3b82f6', group: 'review', ownedDomain: 'bestusenetreviews.com' },
    { id: '1478467425', name: 'Top10usenet', mcc: '1478467425', color: '#ec4899', group: 'review', ownedDomain: 'top10usenet.com' },
];

const BRAND_PATTERNS = [
    'eweka', 'easynews', 'newshosting', 'usenetserver', 'usenet server',
    'tweaknews', 'tweak news', 'pure usenet', 'sunny usenet',
    'bestusenetreviews', 'best usenet reviews', 'bur',
    'top10usenet', 'top 10 usenet', 'privado', 'privadovpn',
    'ownedsites', 'owned sites', 'owned-sites'
];

const NON_BRAND_PATTERNS = [
    'non-brand', 'nonbrand', 'non brand', 'generic', 'competitor',
    'discovery', 'dsa', 'prospecting'
];

function isBrandCampaign(campaignName, accountName = '') {
    const nameLower = campaignName.toLowerCase();
    const accountLower = accountName.toLowerCase();
    if (accountLower === 'top10usenet') {
        return nameLower.includes('ownedsites') ||
               nameLower.includes('owned sites') ||
               nameLower.includes('owned-sites');
    }
    if (NON_BRAND_PATTERNS.some(p => nameLower.includes(p))) return false;
    if (nameLower.includes('brand') && !nameLower.includes('non')) return true;
    return BRAND_PATTERNS.some(p => nameLower.includes(p));
}

function parseLookback(req) {
    const lookbackRaw = (req.query.lookback || '').toString().toLowerCase();
    const endDate = new Date();
    const startDate = new Date(endDate);
    let lookback = lookbackRaw || '3mo';

    if (lookbackRaw === '7d') {
        startDate.setDate(endDate.getDate() - 6);
    } else if (lookbackRaw === '1mo' || lookbackRaw === '30d') {
        startDate.setDate(endDate.getDate() - 29);
        lookback = '1mo';
    } else if (lookbackRaw === 'this_month') {
        startDate.setFullYear(endDate.getFullYear(), endDate.getMonth(), 1);
    } else if (lookbackRaw === 'last_month') {
        startDate.setFullYear(endDate.getFullYear(), endDate.getMonth() - 1, 1);
        endDate.setFullYear(endDate.getFullYear(), endDate.getMonth(), 0);
    } else if (lookbackRaw === '6mo') {
        startDate.setMonth(endDate.getMonth() - 6);
        startDate.setDate(1);
    } else if (lookbackRaw === '13mo') {
        startDate.setMonth(endDate.getMonth() - 13);
        startDate.setDate(1);
    } else {
        // default 3mo
        startDate.setMonth(endDate.getMonth() - 3);
        startDate.setDate(1);
        lookback = '3mo';
    }

    return {
        dateRange: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
        },
        lookback
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { dateRange, lookback } = parseLookback(req);
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    const accountFilter = req.query.account;

    const results = {
        dateRange,
        lookback,
        limit,
        accounts: [],
        keywords: [],
        totals: { cost: 0, clicks: 0, conversions: 0, impressions: 0, conversionValue: 0 },
        errors: []
    };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

        let accessToken = connection.access_token;
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
        const accountsToQuery = accountFilter
            ? ACCOUNT_CONFIG.filter(a => a.name.toLowerCase() === accountFilter.toLowerCase())
            : ACCOUNT_CONFIG;

        const allKeywords = [];

        for (const account of accountsToQuery) {
            try {
                const accountKws = await fetchBrandedKeywords(
                    account, accessToken, developerToken, dateRange
                );
                results.accounts.push({
                    name: account.name,
                    group: account.group,
                    color: account.color,
                    ownedDomain: account.ownedDomain,
                    keywordCount: accountKws.length,
                    cost: accountKws.reduce((s, k) => s + k.cost, 0),
                    clicks: accountKws.reduce((s, k) => s + k.clicks, 0),
                    conversions: accountKws.reduce((s, k) => s + k.conversions, 0),
                    status: 'success'
                });
                allKeywords.push(...accountKws);
            } catch (e) {
                results.accounts.push({
                    name: account.name,
                    group: account.group,
                    color: account.color,
                    status: 'error',
                    error: e.message
                });
                results.errors.push({ account: account.name, error: e.message });
            }
        }

        // Sort by cost desc, truncate to limit
        allKeywords.sort((a, b) => b.cost - a.cost);
        const topKeywords = allKeywords.slice(0, limit);

        // Compute derived metrics
        for (const kw of topKeywords) {
            kw.cpa = kw.conversions > 0 ? kw.cost / kw.conversions : 0;
            kw.cpc = kw.clicks > 0 ? kw.cost / kw.clicks : 0;
            kw.ctr = kw.impressions > 0 ? kw.clicks / kw.impressions : 0;
            kw.convRate = kw.clicks > 0 ? kw.conversions / kw.clicks : 0;
            kw.roas = kw.cost > 0 ? kw.conversionValue / kw.cost : 0;
        }

        results.keywords = topKeywords;

        for (const kw of topKeywords) {
            results.totals.cost += kw.cost;
            results.totals.clicks += kw.clicks;
            results.totals.conversions += kw.conversions;
            results.totals.impressions += kw.impressions;
            results.totals.conversionValue += kw.conversionValue;
        }

        return res.status(200).json(results);
    } catch (error) {
        results.errors.push({ step: 'general', error: error.message });
        return res.status(200).json(results);
    }
}

async function fetchBrandedKeywords(account, accessToken, developerToken, dateRange) {
    // Pull all keyword-level metrics for the account, filter branded client-side.
    const query = `
        SELECT
            campaign.name,
            ad_group.name,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM keyword_view
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status != 'REMOVED'
            AND ad_group_criterion.status != 'REMOVED'
            AND metrics.impressions > 0
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${account.id}/googleAds:searchStream`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': developerToken,
                'login-customer-id': account.mcc,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        }
    );

    const data = await response.json();
    if (!response.ok) {
        // searchStream returns an array, check for error shape
        const err = Array.isArray(data) ? data[0]?.error : data.error;
        throw new Error(err?.message || `API error: ${response.status}`);
    }

    // searchStream returns array of chunks, each with a `results` array
    const chunks = Array.isArray(data) ? data : [data];
    const keywordMap = new Map(); // key = campaign|adgroup|keyword|matchType

    for (const chunk of chunks) {
        const rows = chunk.results || [];
        for (const row of rows) {
            const campaignName = row.campaign?.name || '';
            if (!isBrandCampaign(campaignName, account.name)) continue;

            const keywordText = row.adGroupCriterion?.keyword?.text || '';
            const matchType = row.adGroupCriterion?.keyword?.matchType || '';
            const adGroupName = row.adGroup?.name || '';
            const m = row.metrics || {};

            if (!keywordText) continue;

            const key = `${campaignName}|${adGroupName}|${keywordText}|${matchType}`;
            if (!keywordMap.has(key)) {
                keywordMap.set(key, {
                    account: account.name,
                    accountColor: account.color,
                    accountGroup: account.group,
                    ownedDomain: account.ownedDomain,
                    campaign: campaignName,
                    adGroup: adGroupName,
                    keyword: keywordText,
                    matchType,
                    impressions: 0,
                    clicks: 0,
                    cost: 0,
                    conversions: 0,
                    conversionValue: 0
                });
            }
            const entry = keywordMap.get(key);
            entry.impressions += parseInt(m.impressions || 0, 10);
            entry.clicks += parseInt(m.clicks || 0, 10);
            entry.cost += parseFloat(m.costMicros || 0) / 1000000;
            entry.conversions += parseFloat(m.conversions || 0);
            entry.conversionValue += parseFloat(m.conversionsValue || 0);
        }
    }

    return Array.from(keywordMap.values());
}

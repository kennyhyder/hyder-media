/**
 * Google Ads - Digistore24 Performance Data
 * GET /api/digistore/performance
 *
 * Fetches metrics for Digistore24 (246-624-6400)
 * Supports ?days=30 (default) and ?breakdown=summary|campaign|adgroup|monthly|daily
 * All campaign-level filters use ENABLED only — paused campaigns excluded.
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '2466246400';
// Direct access (not via MCC)
const LOGIN_CUSTOMER_ID = '2466246400';

// 2026-05-01: dedicated Vendor Sign-up + Affiliate Sign-up conversion actions
// were implemented in the Google Ads account. Before this date the breakout
// only existed in GA4 (see /api/digistore/ga4-insights.js).
const VA_CUTOFF_START = '2026-05-01';
const VENDOR_NAME = 'Vendor Sign-up';
const AFFILIATE_NAME = 'Affiliate Sign-up';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = req.query.breakdown || 'summary'; // 'summary' | 'campaign' | 'adgroup' | 'monthly' | 'daily'
    const dateRange = resolveDateRange(req.query);

    const result = { dateRange, status: 'loading', errors: [] };

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
            result.errors.push({ step: 'get_connection', error: connError?.message || 'No connection found' });
            result.status = 'error';
            return res.status(200).json(result);
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
                result.errors.push({ step: 'refresh', error: refreshData });
                result.status = 'error';
                return res.status(200).json(result);
            }
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        if (breakdown === 'campaign') {
            result.campaigns = await fetchCampaignBreakdown(headers, dateRange);
        } else if (breakdown === 'adgroup') {
            result.adGroups = await fetchAdGroupBreakdown(headers, dateRange);
        } else if (breakdown === 'monthly') {
            result.monthly = await fetchMonthlyMetrics(headers, dateRange);
        } else if (breakdown === 'daily') {
            result.daily = await fetchDailyMetrics(headers, dateRange);
        } else if (breakdown === 'vendor-affiliate') {
            result.vendorAffiliate = await fetchVendorAffiliateBreakdown(headers, dateRange);
        } else {
            result.summary = await fetchSummaryMetrics(headers, dateRange);
        }

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);

    } catch (error) {
        result.errors.push({ step: 'general', error: error.message });
        result.status = 'error';
        return res.status(200).json(result);
    }
}

async function fetchSummaryMetrics(headers, dateRange) {
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

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    let spend = 0, clicks = 0, impressions = 0, conversions = 0, conversionValue = 0;

    if (data.results) {
        for (const row of data.results) {
            const m = row.metrics || {};
            spend += parseFloat(m.costMicros || 0) / 1000000;
            clicks += parseInt(m.clicks || 0, 10);
            impressions += parseInt(m.impressions || 0, 10);
            conversions += parseFloat(m.conversions || 0);
            conversionValue += parseFloat(m.conversionsValue || 0);
        }
    }

    return {
        spend, clicks, impressions, conversions, conversionValue,
        ctr: impressions > 0 ? clicks / impressions : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpa: conversions > 0 ? spend / conversions : 0,
        roas: spend > 0 ? conversionValue / spend : 0,
        convRate: clicks > 0 ? conversions / clicks : 0,
    };
}

async function fetchCampaignBreakdown(headers, dateRange) {
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value,
            metrics.average_cpc,
            metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status = 'ENABLED'
        ORDER BY metrics.cost_micros DESC
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    return (data.results || []).map(row => {
        const c = row.campaign || {};
        const m = row.metrics || {};
        const spend = parseFloat(m.costMicros || 0) / 1000000;
        const clicks = parseInt(m.clicks || 0, 10);
        const impressions = parseInt(m.impressions || 0, 10);
        const conversions = parseFloat(m.conversions || 0);
        const conversionValue = parseFloat(m.conversionsValue || 0);

        return {
            id: c.id,
            name: c.name,
            status: c.status,
            spend,
            clicks,
            impressions,
            conversions,
            conversionValue,
            cpc: clicks > 0 ? spend / clicks : 0,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            roas: spend > 0 ? conversionValue / spend : 0,
        };
    });
}

async function fetchMonthlyMetrics(headers, dateRange) {
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            segments.month,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status = 'ENABLED'
        ORDER BY segments.month ASC
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    // Aggregate by month
    const monthMap = {};
    for (const row of (data.results || [])) {
        const month = row.segments?.month;
        if (!month) continue;
        const m = row.metrics || {};

        if (!monthMap[month]) {
            monthMap[month] = { month, spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
        }
        monthMap[month].spend += parseFloat(m.costMicros || 0) / 1000000;
        monthMap[month].clicks += parseInt(m.clicks || 0, 10);
        monthMap[month].impressions += parseInt(m.impressions || 0, 10);
        monthMap[month].conversions += parseFloat(m.conversions || 0);
        monthMap[month].conversionValue += parseFloat(m.conversionsValue || 0);
    }

    return Object.values(monthMap).map(m => ({
        ...m,
        ctr: m.impressions > 0 ? m.clicks / m.impressions : 0,
        cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
        cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
        roas: m.spend > 0 ? m.conversionValue / m.spend : 0,
    }));
}

async function fetchDailyMetrics(headers, dateRange) {
    const query = `
        SELECT
            segments.date,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
        ORDER BY segments.date ASC
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    return (data.results || []).map(row => {
        const m = row.metrics || {};
        const spend = parseFloat(m.costMicros || 0) / 1000000;
        const clicks = parseInt(m.clicks || 0, 10);
        const impressions = parseInt(m.impressions || 0, 10);
        const conversions = parseFloat(m.conversions || 0);
        const conversionValue = parseFloat(m.conversionsValue || 0);

        return {
            date: row.segments?.date,
            spend,
            clicks,
            impressions,
            conversions,
            conversionValue,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            roas: spend > 0 ? conversionValue / spend : 0,
        };
    });
}

async function fetchAdGroupBreakdown(headers, dateRange) {
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.url_custom_parameters,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value
        FROM ad_group
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status = 'ENABLED'
            AND ad_group.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    return (data.results || []).map(row => {
        const c = row.campaign || {};
        const ag = row.adGroup || {};
        const m = row.metrics || {};
        const spend = parseFloat(m.costMicros || 0) / 1000000;
        const clicks = parseInt(m.clicks || 0, 10);
        const impressions = parseInt(m.impressions || 0, 10);
        const conversions = parseFloat(m.conversions || 0);
        const conversionValue = parseFloat(m.conversionsValue || 0);

        // Extract the {_adgroup} custom param value (the slug used in utm_content)
        const customParams = ag.urlCustomParameters || [];
        const adgroupParam = customParams.find(p => p.key === 'adgroup');
        const slug = adgroupParam?.value || null;

        return {
            campaignId: c.id,
            campaign: c.name,
            adGroupId: ag.id,
            adGroup: ag.name,
            slug,  // The utm_content slug from this ad group's custom parameters
            status: ag.status,
            spend,
            clicks,
            impressions,
            conversions,
            conversionValue,
            cpc: clicks > 0 ? spend / clicks : 0,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            convRate: clicks > 0 ? conversions / clicks : 0,
        };
    });
}

// Vendor / Affiliate signups per ad group from the dedicated Google Ads
// conversion actions added 2026-05-01. Auto-clamps the start date to the
// cutoff — anything earlier comes from GA4 via /api/digistore/ga4-insights.
async function fetchVendorAffiliateBreakdown(headers, dateRange) {
    const requested = { start: dateRange.start, end: dateRange.end };
    const start = dateRange.start < VA_CUTOFF_START ? VA_CUTOFF_START : dateRange.start;
    const end = dateRange.end;

    if (start > end) {
        return {
            source: 'out_of_range',
            byAdGroup: [],
            totals: { vendor: 0, affiliate: 0, signups: 0 },
            dateRange: requested,
            effectiveRange: null,
            cutoff: VA_CUTOFF_START,
            dataAge: `Vendor / Affiliate Sign-up actions only available from ${VA_CUTOFF_START} onwards`,
        };
    }

    const query = `
        SELECT
            ad_group.id,
            ad_group.name,
            campaign.id,
            campaign.name,
            segments.conversion_action_name,
            metrics.conversions
        FROM ad_group
        WHERE segments.date BETWEEN '${start}' AND '${end}'
            AND ad_group.status != 'REMOVED'
            AND campaign.status = 'ENABLED'
            AND segments.conversion_action_name IN ('${VENDOR_NAME}', '${AFFILIATE_NAME}')
    `;

    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );

    const data = await response.json();
    if (data.error) return { error: data.error.message };

    const byAdGroupMap = {};
    for (const row of (data.results || [])) {
        const adGroupName = row.adGroup?.name || '(unknown)';
        const actionName = row.segments?.conversionActionName;
        const conv = parseFloat(row.metrics?.conversions || 0);
        if (!actionName || conv === 0) continue;

        if (!byAdGroupMap[adGroupName]) {
            byAdGroupMap[adGroupName] = {
                ad_group: adGroupName,
                campaign: row.campaign?.name || null,
                vendor: 0,
                affiliate: 0,
                signups: 0,
            };
        }
        if (actionName === VENDOR_NAME) byAdGroupMap[adGroupName].vendor += conv;
        else if (actionName === AFFILIATE_NAME) byAdGroupMap[adGroupName].affiliate += conv;
        byAdGroupMap[adGroupName].signups += conv;
    }

    const byAdGroup = Object.values(byAdGroupMap).sort((a, b) => b.signups - a.signups);
    const totals = byAdGroup.reduce((acc, r) => {
        acc.vendor += r.vendor;
        acc.affiliate += r.affiliate;
        acc.signups += r.signups;
        return acc;
    }, { vendor: 0, affiliate: 0, signups: 0 });

    return {
        source: 'google_ads',
        byAdGroup,
        totals,
        dateRange: requested,
        effectiveRange: { start, end },
        cutoff: VA_CUTOFF_START,
        dataAge: `Google Ads conversion actions (Vendor Sign-up + Affiliate Sign-up) for ${start} → ${end}`,
    };
}

// Resolve the date range from query params.
// Accepts ?start=YYYY-MM-DD&end=YYYY-MM-DD (preferred) or ?days=N (fallback).
// Returns { start, end } in ISO date format.
function resolveDateRange(query) {
    const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (isISODate(query.start) && isISODate(query.end)) {
        return { start: query.start, end: query.end };
    }
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

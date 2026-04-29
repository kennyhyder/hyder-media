/**
 * Meta Ads - Vita Brevis Fine Art Performance
 * GET /api/vita-brevis/meta-performance
 *
 * Aggregates 3 Meta ad accounts:
 *   act_910982119354033, act_1187662444921041, act_1088960198165753
 *
 * Query params:
 *   breakdown  - summary | daily | monthly | campaign  (default: summary)
 *   days       - lookback window from today (default: 30)
 *   account    - optional filter to a single account (e.g. 'act_910982119354033')
 *
 * Summary response includes aggregated totals AND per-account breakdown.
 * Uses shared meta_ads_connections OAuth token under kenny@hyder.me.
 */

import { createClient } from '@supabase/supabase-js';

const AD_ACCOUNTS = [
    { id: 'act_910982119354033', name: 'Vita Brevis Account 1' },
    { id: 'act_1187662444921041', name: 'Vita Brevis Account 2' },
    { id: 'act_1088960198165753', name: 'Vita Brevis Account 3' },
];

const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

const CONVERSION_ACTION_TYPES = new Set([
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_web_purchase',
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'lead_form_submission',
    'omni_purchase',
]);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const accountFilter = req.query.account;
    const { startDate, endDate } = resolveDateRange(req.query);

    const accounts = accountFilter
        ? AD_ACCOUNTS.filter(a => a.id === accountFilter)
        : AD_ACCOUNTS;

    const result = {
        dateRange: { start: startDate, end: endDate },
        breakdown,
        accounts: AD_ACCOUNTS,
        status: 'loading',
        errors: [],
    };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: connection, error: connError } = await supabase
            .from('meta_ads_connections').select('*')
            .order('updated_at', { ascending: false }).limit(1).single();

        if (connError || !connection) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'No Meta Ads OAuth connection found. Visit /api/meta-ads/auth to authorize.',
            });
        }

        if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'Meta access token expired. Re-authorize at /api/meta-ads/auth.',
            });
        }

        const accessToken = connection.access_token;

        if (breakdown === 'summary') {
            const perAccount = await Promise.all(
                accounts.map(async acc => {
                    try {
                        const m = await fetchAccountSummary(accessToken, acc.id, startDate, endDate);
                        return { ...acc, ...m };
                    } catch (err) {
                        result.errors.push({ account: acc.id, error: err.message });
                        return { ...acc, ...emptyDerived(), error: err.message };
                    }
                })
            );
            result.byAccount = perAccount;
            result.summary = aggregateSummaries(perAccount);
        } else if (breakdown === 'daily' || breakdown === 'monthly') {
            // Aggregate time series across accounts
            const granularity = breakdown;
            const perAccountSeries = await Promise.all(
                accounts.map(async acc => {
                    try {
                        return await fetchTimeSeries(accessToken, acc.id, startDate, endDate, granularity);
                    } catch (err) {
                        result.errors.push({ account: acc.id, error: err.message });
                        return [];
                    }
                })
            );
            result[granularity] = mergeTimeSeries(perAccountSeries, granularity);
        } else if (breakdown === 'campaign') {
            const perAccountCampaigns = await Promise.all(
                accounts.map(async acc => {
                    try {
                        const camps = await fetchCampaignBreakdown(accessToken, acc.id, startDate, endDate);
                        return camps.map(c => ({ ...c, accountId: acc.id, accountName: acc.name }));
                    } catch (err) {
                        result.errors.push({ account: acc.id, error: err.message });
                        return [];
                    }
                })
            );
            result.campaigns = perAccountCampaigns.flat().sort((a, b) => b.spend - a.spend);
        } else {
            result.status = 'error';
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            return res.status(200).json(result);
        }

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = 'error';
        return res.status(200).json(result);
    }
}

// ============================================================================
// Date helpers
// ============================================================================

function resolveDateRange(query) {
    if (query.startDate && query.endDate) {
        return { startDate: query.startDate, endDate: query.endDate };
    }
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

// ============================================================================
// Metric helpers
// ============================================================================

function emptyMetrics() {
    return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
}

function emptyDerived() {
    return { ...emptyMetrics(), ctr: 0, cpc: 0, cpm: 0, cpa: 0, roas: 0, convRate: 0, frequency: 0 };
}

function addInsightRow(target, row) {
    target.spend += parseFloat(row.spend || 0);
    target.impressions += parseInt(row.impressions || 0, 10);
    target.clicks += parseInt(row.clicks || 0, 10);
    target.reach += parseInt(row.reach || 0, 10);

    for (const a of (row.actions || [])) {
        if (CONVERSION_ACTION_TYPES.has(a.action_type)) {
            target.conversions += parseFloat(a.value || 0);
        }
    }
    for (const a of (row.action_values || [])) {
        if (CONVERSION_ACTION_TYPES.has(a.action_type)) {
            target.conversionValue += parseFloat(a.value || 0);
        }
    }
}

function derivedMetrics(m) {
    return {
        ...m,
        ctr: m.impressions > 0 ? m.clicks / m.impressions : 0,
        cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
        cpm: m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0,
        cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
        roas: m.spend > 0 ? m.conversionValue / m.spend : 0,
        convRate: m.clicks > 0 ? m.conversions / m.clicks : 0,
        frequency: m.reach > 0 ? m.impressions / m.reach : 0,
    };
}

function aggregateSummaries(perAccount) {
    const totals = emptyMetrics();
    for (const acc of perAccount) {
        totals.spend += acc.spend || 0;
        totals.impressions += acc.impressions || 0;
        totals.clicks += acc.clicks || 0;
        totals.conversions += acc.conversions || 0;
        totals.conversionValue += acc.conversionValue || 0;
        totals.reach += acc.reach || 0;
    }
    return derivedMetrics(totals);
}

function mergeTimeSeries(seriesPerAccount, granularity) {
    const byKey = {};
    const keyField = granularity === 'monthly' ? 'month' : 'date';
    for (const series of seriesPerAccount) {
        for (const point of series) {
            const k = point[keyField];
            if (!byKey[k]) byKey[k] = { ...emptyMetrics(), [keyField]: k };
            byKey[k].spend += point.spend || 0;
            byKey[k].impressions += point.impressions || 0;
            byKey[k].clicks += point.clicks || 0;
            byKey[k].conversions += point.conversions || 0;
            byKey[k].conversionValue += point.conversionValue || 0;
            byKey[k].reach += point.reach || 0;
        }
    }
    return Object.values(byKey)
        .map(p => ({ ...derivedMetrics(p) }))
        .sort((a, b) => (a[keyField] || '').localeCompare(b[keyField] || ''));
}

// ============================================================================
// Graph API
// ============================================================================

async function graphGet(endpoint, params, accessToken) {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}/${endpoint}`);
    url.searchParams.set('access_token', accessToken);
    for (const [key, val] of Object.entries(params || {})) {
        if (val != null) url.searchParams.set(key, val);
    }
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (data.error) throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`);
    return data;
}

async function paginatedInsights(accessToken, accountId, params) {
    const all = [];
    let data = await graphGet(`${accountId}/insights`, params, accessToken);
    if (data.data) all.push(...data.data);
    let nextUrl = data.paging?.next || null;
    let safety = 0;
    while (nextUrl && safety < 20) {
        const resp = await fetch(nextUrl);
        const pageData = await resp.json();
        if (pageData.error) break;
        if (pageData.data) all.push(...pageData.data);
        nextUrl = pageData.paging?.next || null;
        safety += 1;
    }
    return all;
}

async function fetchAccountSummary(accessToken, accountId, startDate, endDate) {
    const rows = await paginatedInsights(accessToken, accountId, {
        level: 'account',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        time_increment: 'all_days',
        fields: 'spend,impressions,clicks,reach,actions,action_values',
        limit: 500,
    });
    const totals = emptyMetrics();
    for (const row of rows) addInsightRow(totals, row);
    return derivedMetrics(totals);
}

async function fetchTimeSeries(accessToken, accountId, startDate, endDate, granularity) {
    const increment = granularity === 'monthly' ? 'monthly' : 1;
    const rows = await paginatedInsights(accessToken, accountId, {
        level: 'account',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        time_increment: increment,
        fields: 'spend,impressions,clicks,reach,actions,action_values,date_start,date_stop',
        limit: 500,
    });

    return rows.map(r => {
        const m = emptyMetrics();
        addInsightRow(m, r);
        const out = { ...derivedMetrics(m) };
        if (granularity === 'monthly') out.month = r.date_start?.slice(0, 7) || '';
        else out.date = r.date_start || '';
        return out;
    });
}

async function fetchCampaignBreakdown(accessToken, accountId, startDate, endDate) {
    const rows = await paginatedInsights(accessToken, accountId, {
        level: 'campaign',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        time_increment: 'all_days',
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values',
        limit: 500,
    });

    const byCampaign = {};
    for (const row of rows) {
        const id = row.campaign_id;
        if (!byCampaign[id]) {
            byCampaign[id] = { id, name: row.campaign_name || `Campaign ${id}`, ...emptyMetrics() };
        }
        addInsightRow(byCampaign[id], row);
    }

    return Object.values(byCampaign).map(c => {
        const { id, name, ...metrics } = c;
        return { id, name, ...derivedMetrics(metrics) };
    });
}

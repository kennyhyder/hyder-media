/**
 * Meta Ads - Auto Glass 2020 Live Performance Reporting
 * GET /api/meta-ads/ag2020-performance
 *
 * Query params:
 *   breakdown  - summary | daily | monthly | campaign (default: summary)
 *   days       - lookback window from today (default: 30)
 *   startDate, endDate  - explicit range override (YYYY-MM-DD)
 *   compare    - "true" to also fetch previous same-length period (summary only)
 *
 * Uses the shared meta_ads_connections OAuth token (covers all ad accounts
 * under kenny@hyder.me's Business Portfolio access). AG2020 ad account is
 * act_1455451028117748 under the "2020 Business Portfolio."
 */

import { createClient } from '@supabase/supabase-js';

const AD_ACCOUNT_ID = 'act_1455451028117748';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

// Meta action types we sum as "conversions" / "conversionValue"
const CONVERSION_ACTION_TYPES = new Set([
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_web_purchase',
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'lead_form_submission',
]);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const compareFlag = req.query.compare === 'true' || req.query.compare === '1';
    const { startDate, endDate } = resolveDateRange(req.query);

    const result = {
        dateRange: { start: startDate, end: endDate },
        breakdown,
        account: { id: AD_ACCOUNT_ID, name: 'AG2020 Meta' },
        status: 'loading',
        errors: [],
    };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        const { data: connection, error: connError } = await supabase
            .from('meta_ads_connections')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(200).json({
                ...result,
                status: 'not_configured',
                needsAuth: true,
                message: 'No Meta Ads OAuth connection found. Visit /api/meta-ads/auth to authorize.',
            });
        }

        if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
            return res.status(200).json({
                ...result,
                status: 'not_configured',
                needsAuth: true,
                message: 'Meta access token expired. Re-authorize at /api/meta-ads/auth.',
            });
        }

        const accessToken = connection.access_token;

        if (breakdown === 'summary') {
            result.summary = await fetchSummary(accessToken, startDate, endDate);
            if (compareFlag) {
                const prev = previousRange(startDate, endDate);
                result.previous = {
                    dateRange: prev,
                    summary: await fetchSummary(accessToken, prev.start, prev.end),
                };
            }
        } else if (breakdown === 'daily') {
            result.daily = await fetchTimeSeries(accessToken, startDate, endDate, 'daily');
        } else if (breakdown === 'monthly') {
            result.monthly = await fetchTimeSeries(accessToken, startDate, endDate, 'monthly');
        } else if (breakdown === 'campaign') {
            result.campaigns = await fetchCampaignBreakdown(accessToken, startDate, endDate);
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
    if (query.startDate && query.endDate) return { startDate: query.startDate, endDate: query.endDate };
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] };
}

function previousRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.max(1, Math.round((end - start) / 86400000));
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - days);
    return {
        start: prevStart.toISOString().split('T')[0],
        end: prevEnd.toISOString().split('T')[0],
    };
}

// ============================================================================
// Metric parsing
// ============================================================================

function emptyMetrics() {
    return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
}

function addInsightRow(target, row) {
    target.spend += parseFloat(row.spend || 0);
    target.impressions += parseInt(row.impressions || 0, 10);
    target.clicks += parseInt(row.clicks || 0, 10);
    target.reach += parseInt(row.reach || 0, 10);
    // reach is not additive across dates but we'll accept the approximation for totals

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

// ============================================================================
// Graph API queries
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

async function paginatedInsights(accessToken, params) {
    const all = [];
    let data = await graphGet(`${AD_ACCOUNT_ID}/insights`, params, accessToken);
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

async function fetchSummary(accessToken, startDate, endDate) {
    const rows = await paginatedInsights(accessToken, {
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

async function fetchTimeSeries(accessToken, startDate, endDate, granularity) {
    // granularity: 'daily' | 'monthly'
    // Meta supports time_increment = 1 (daily) or 'monthly'
    const increment = granularity === 'monthly' ? 'monthly' : 1;
    const rows = await paginatedInsights(accessToken, {
        level: 'account',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        time_increment: increment,
        fields: 'spend,impressions,clicks,reach,actions,action_values,date_start,date_stop',
        limit: 500,
    });

    return rows.map(r => {
        const m = emptyMetrics();
        addInsightRow(m, r);
        const key = granularity === 'monthly'
            ? r.date_start?.slice(0, 7) || ''   // YYYY-MM
            : r.date_start || '';                // YYYY-MM-DD
        const out = { ...derivedMetrics(m) };
        if (granularity === 'monthly') out.month = key;
        else out.date = key;
        return out;
    }).sort((a, b) => {
        const ak = a.month || a.date || '';
        const bk = b.month || b.date || '';
        return ak.localeCompare(bk);
    });
}

async function fetchCampaignBreakdown(accessToken, startDate, endDate) {
    const rows = await paginatedInsights(accessToken, {
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
            byCampaign[id] = {
                id, name: row.campaign_name || `Campaign ${id}`,
                ...emptyMetrics(),
            };
        }
        addInsightRow(byCampaign[id], row);
    }

    return Object.values(byCampaign)
        .map(c => {
            const { spend, impressions, clicks, conversions, conversionValue, reach, ...rest } = c;
            return { ...rest, ...derivedMetrics({ spend, impressions, clicks, conversions, conversionValue, reach }) };
        })
        .sort((a, b) => b.spend - a.spend);
}

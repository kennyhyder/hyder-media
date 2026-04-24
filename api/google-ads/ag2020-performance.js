/**
 * Google Ads - Auto Glass 2020 Live Performance Reporting
 * GET /api/google-ads/ag2020-performance
 *
 * Query params:
 *   breakdown  - summary | campaign | daily | monthly (default: summary)
 *   days       - number of days back from today (default: 30)
 *   startDate  - explicit start date (YYYY-MM-DD, overrides `days`)
 *   endDate    - explicit end date (YYYY-MM-DD, overrides `days`)
 *   compare    - "true" to also fetch previous same-length period (summary only)
 *
 * Merges data from both AG2020 Google Ads accounts:
 *   - 505-336-5860 (current, via MCC 673-698-8718)
 *   - 439-961-4856 (historical, direct access)
 */

import { createClient } from '@supabase/supabase-js';

const AG2020_ACCOUNTS = [
    { id: '5053365860', name: 'AG2020 Current', mcc: '6736988718', color: '#1B4B82' },
    { id: '4399614856', name: 'AG2020 Historical', mcc: '4399614856', color: '#6BA4D0' },
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const compareFlag = req.query.compare === 'true' || req.query.compare === '1';

    // Date range resolution
    let startDate, endDate;
    if (req.query.startDate && req.query.endDate) {
        startDate = req.query.startDate;
        endDate = req.query.endDate;
    } else {
        const days = parseInt(req.query.days) || 30;
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        endDate = end.toISOString().split('T')[0];
        startDate = start.toISOString().split('T')[0];
    }

    const result = { dateRange: { start: startDate, end: endDate }, breakdown, status: 'loading', errors: [] };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

        const buildHeaders = (mcc) => ({
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'login-customer-id': mcc,
            'Content-Type': 'application/json',
        });

        // Dispatch to the correct breakdown
        if (breakdown === 'campaign') {
            const perAccount = await Promise.all(
                AG2020_ACCOUNTS.map(acc =>
                    fetchCampaignBreakdown(acc, buildHeaders(acc.mcc), { start: startDate, end: endDate })
                        .catch(err => {
                            result.errors.push({ account: acc.name, step: 'campaign', error: err.message });
                            return [];
                        })
                )
            );
            // Flatten; tag rows with account name
            result.campaigns = perAccount.flat();
        } else if (breakdown === 'monthly') {
            result.monthly = await fetchTimeSeriesMerged(AG2020_ACCOUNTS, buildHeaders, { start: startDate, end: endDate }, 'month', result.errors);
        } else if (breakdown === 'daily') {
            result.daily = await fetchTimeSeriesMerged(AG2020_ACCOUNTS, buildHeaders, { start: startDate, end: endDate }, 'date', result.errors);
        } else {
            // summary
            result.summary = await fetchSummaryMerged(AG2020_ACCOUNTS, buildHeaders, { start: startDate, end: endDate }, result.errors);
            result.byAccount = await fetchSummaryPerAccount(AG2020_ACCOUNTS, buildHeaders, { start: startDate, end: endDate }, result.errors);

            if (compareFlag) {
                // Previous period of same length
                const start = new Date(startDate);
                const end = new Date(endDate);
                const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
                const prevEnd = new Date(start);
                prevEnd.setDate(prevEnd.getDate() - 1);
                const prevStart = new Date(prevEnd);
                prevStart.setDate(prevStart.getDate() - days);
                const prevRange = {
                    start: prevStart.toISOString().split('T')[0],
                    end: prevEnd.toISOString().split('T')[0],
                };
                result.previous = {
                    dateRange: prevRange,
                    summary: await fetchSummaryMerged(AG2020_ACCOUNTS, buildHeaders, prevRange, result.errors),
                };
            }
        }

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (error) {
        result.errors.push({ step: 'general', error: error.message });
        result.status = 'error';
        return res.status(200).json(result);
    }
}

// ============================================================================
// Queries
// ============================================================================

async function runQuery(account, headers, query) {
    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${account.id}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const data = await response.json();
    if (data.error) throw new Error(`${account.name}: ${data.error.message || JSON.stringify(data.error)}`);
    return data.results || [];
}

function emptyMetrics() {
    return { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
}

function addMetrics(target, row) {
    const m = row.metrics || {};
    target.spend += parseFloat(m.costMicros || 0) / 1000000;
    target.clicks += parseInt(m.clicks || 0, 10);
    target.impressions += parseInt(m.impressions || 0, 10);
    target.conversions += parseFloat(m.conversions || 0);
    target.conversionValue += parseFloat(m.conversionsValue || 0);
}

function derivedMetrics(m) {
    return {
        ...m,
        ctr: m.impressions > 0 ? m.clicks / m.impressions : 0,
        cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
        cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
        roas: m.spend > 0 ? m.conversionValue / m.spend : 0,
        convRate: m.clicks > 0 ? m.conversions / m.clicks : 0,
    };
}

async function fetchSummaryMerged(accounts, buildHeaders, dateRange, errors) {
    const totals = emptyMetrics();
    await Promise.all(accounts.map(async acc => {
        try {
            const query = `
                SELECT
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.conversions,
                    metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            `;
            const rows = await runQuery(acc, buildHeaders(acc.mcc), query);
            for (const row of rows) addMetrics(totals, row);
        } catch (err) {
            errors.push({ account: acc.name, step: 'summary', error: err.message });
        }
    }));
    return derivedMetrics(totals);
}

async function fetchSummaryPerAccount(accounts, buildHeaders, dateRange, errors) {
    const out = {};
    await Promise.all(accounts.map(async acc => {
        try {
            const totals = emptyMetrics();
            const query = `
                SELECT
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.conversions,
                    metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            `;
            const rows = await runQuery(acc, buildHeaders(acc.mcc), query);
            for (const row of rows) addMetrics(totals, row);
            out[acc.id] = { name: acc.name, color: acc.color, ...derivedMetrics(totals) };
        } catch (err) {
            errors.push({ account: acc.name, step: 'summary_per_account', error: err.message });
            out[acc.id] = { name: acc.name, color: acc.color, ...derivedMetrics(emptyMetrics()), error: err.message };
        }
    }));
    return out;
}

async function fetchCampaignBreakdown(account, headers, dateRange) {
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            AND campaign.status != 'REMOVED'
    `;
    const rows = await runQuery(account, headers, query);
    // Aggregate per campaign (one row per campaign per date segment)
    const byCampaign = {};
    for (const row of rows) {
        const c = row.campaign || {};
        const id = String(c.id);
        if (!byCampaign[id]) {
            byCampaign[id] = {
                account: account.name,
                accountId: account.id,
                id,
                name: c.name,
                status: c.status,
                channel: c.advertisingChannelType,
                ...emptyMetrics(),
            };
        }
        addMetrics(byCampaign[id], row);
    }
    return Object.values(byCampaign).map(c => {
        const { spend, clicks, impressions, conversions, conversionValue, ...rest } = c;
        return { ...rest, ...derivedMetrics({ spend, clicks, impressions, conversions, conversionValue }) };
    }).sort((a, b) => b.spend - a.spend);
}

async function fetchTimeSeriesMerged(accounts, buildHeaders, dateRange, granularity, errors) {
    // granularity: 'date' (daily) or 'month'
    const segField = granularity === 'month' ? 'segments.month' : 'segments.date';
    const bucketKey = granularity === 'month' ? 'month' : 'date';
    const buckets = {};

    await Promise.all(accounts.map(async acc => {
        try {
            const query = `
                SELECT
                    ${segField},
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.conversions,
                    metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'
            `;
            const rows = await runQuery(acc, buildHeaders(acc.mcc), query);
            for (const row of rows) {
                const key = row.segments?.[bucketKey === 'month' ? 'month' : 'date'];
                if (!key) continue;
                if (!buckets[key]) buckets[key] = { [bucketKey]: key, ...emptyMetrics() };
                addMetrics(buckets[key], row);
            }
        } catch (err) {
            errors.push({ account: acc.name, step: `timeseries_${granularity}`, error: err.message });
        }
    }));

    return Object.values(buckets)
        .map(b => ({ [bucketKey]: b[bucketKey], ...derivedMetrics({
            spend: b.spend, clicks: b.clicks, impressions: b.impressions,
            conversions: b.conversions, conversionValue: b.conversionValue,
        }) }))
        .sort((a, b) => String(a[bucketKey]).localeCompare(String(b[bucketKey])));
}

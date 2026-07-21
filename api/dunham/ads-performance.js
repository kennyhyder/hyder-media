/**
 * Dunham Google Ads performance metrics
 * GET /api/dunham/ads-performance?days=28  (or startDate+endDate YYYY-MM-DD)
 *
 * Returns totals, per-campaign metrics, and a daily series for the primary
 * account 840-838-5870 over the date range. Uses the same OAuth connection
 * and GAQL searchStream pattern as api/google-ads/dunham-ads.js.
 */

import { supabase, getGoogleAccessToken } from './_google.js';

const CUSTOMER_ID = '8408385870';
const API_VERSION = 'v23';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    let startDate, endDate;
    if (req.query.startDate && req.query.endDate) {
        startDate = req.query.startDate;
        endDate = req.query.endDate;
    } else {
        const days = [7, 28, 90].includes(parseInt(req.query.days)) ? parseInt(req.query.days) : 28;
        const end = new Date(); end.setDate(end.getDate() - 1);
        const start = new Date(end); start.setDate(start.getDate() - (days - 1));
        startDate = start.toISOString().split('T')[0];
        endDate = end.toISOString().split('T')[0];
    }

    try {
        const token = await getGoogleAccessToken(supabase());
        const headers = {
            'Authorization': `Bearer ${token}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        const [campaignRows, dailyRows, customerRows] = await Promise.all([
            gaql(headers, `
                SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                       metrics.cost_micros, metrics.impressions, metrics.clicks,
                       metrics.conversions, metrics.conversions_value
                FROM campaign
                WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
                  AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC`),
            gaql(headers, `
                SELECT segments.date, metrics.cost_micros, metrics.impressions,
                       metrics.clicks, metrics.conversions
                FROM customer
                WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
            gaql(headers, `SELECT customer.currency_code, customer.descriptive_name FROM customer LIMIT 1`),
        ]);

        const campaigns = campaignRows.map(r => ({
            id: r.campaign.id,
            name: r.campaign.name,
            status: r.campaign.status,
            channelType: r.campaign.advertisingChannelType,
            cost: Number(r.metrics.costMicros || 0) / 1e6,
            impressions: Number(r.metrics.impressions || 0),
            clicks: Number(r.metrics.clicks || 0),
            conversions: Number(r.metrics.conversions || 0),
            conversionsValue: Number(r.metrics.conversionsValue || 0),
        }));

        const daily = dailyRows.map(r => ({
            date: r.segments.date,
            cost: Number(r.metrics.costMicros || 0) / 1e6,
            impressions: Number(r.metrics.impressions || 0),
            clicks: Number(r.metrics.clicks || 0),
            conversions: Number(r.metrics.conversions || 0),
        })).sort((a, b) => a.date.localeCompare(b.date));

        const totals = campaigns.reduce((t, c) => ({
            cost: t.cost + c.cost,
            impressions: t.impressions + c.impressions,
            clicks: t.clicks + c.clicks,
            conversions: t.conversions + c.conversions,
        }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 });

        return res.status(200).json({
            status: 'success',
            account: CUSTOMER_ID,
            accountName: customerRows[0]?.customer?.descriptiveName || null,
            currency: customerRows[0]?.customer?.currencyCode || 'USD',
            dateRange: { start: startDate, end: endDate },
            totals, campaigns, daily,
        });
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

async function gaql(headers, query) {
    const resp = await fetch(
        `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const data = await resp.json();
    if (data.error || data[0]?.error) {
        const e = data.error || data[0].error;
        throw new Error(`Google Ads: ${e.message || JSON.stringify(e)}`);
    }
    return (Array.isArray(data) ? data : [data]).flatMap(chunk => chunk.results || []);
}

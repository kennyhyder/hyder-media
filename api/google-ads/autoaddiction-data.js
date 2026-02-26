/**
 * Google Ads - Auto Addiction OC Dashboard Data
 * GET /api/google-ads/autoaddiction-data
 *
 * Fetches metrics for Auto Addiction OC (835-776-9782)
 * Supports ?days=30 (default) and ?breakdown=campaign for campaign-level data
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '8357769782';
// Direct access (not via MCC)
const LOGIN_CUSTOMER_ID = '8357769782';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = parseInt(req.query.days) || 30;
    const breakdown = req.query.breakdown || 'summary'; // 'summary' | 'campaign' | 'daily'
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const dateRange = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

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
        } else if (breakdown === 'daily') {
            result.daily = await fetchDailyMetrics(headers, dateRange);
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
            AND campaign.status != 'REMOVED'
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

        return {
            id: c.id,
            name: c.name,
            status: c.status,
            spend,
            clicks,
            impressions,
            conversions,
            conversionValue: parseFloat(m.conversionsValue || 0),
            cpc: clicks > 0 ? spend / clicks : 0,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
        };
    });
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

        return {
            date: row.segments?.date,
            spend,
            clicks,
            impressions: parseInt(m.impressions || 0, 10),
            conversions: parseFloat(m.conversions || 0),
            conversionValue: parseFloat(m.conversionsValue || 0),
            cpc: clicks > 0 ? spend / clicks : 0,
        };
    });
}

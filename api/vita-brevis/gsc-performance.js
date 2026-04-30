/**
 * Google Search Console - Vita Brevis Performance
 * GET /api/vita-brevis/gsc-performance
 *
 * Property: sc-domain:vitabrevisfineart.com (domain property — covers all
 * subdomains and protocols).
 *
 * Query params:
 *   days       - lookback window from today (default: 28; max GSC retention 16 months)
 *   breakdown  - summary | query | page | date | device | country (default: summary)
 *   limit      - max rows for query/page/country breakdowns (default: 100, max 5000)
 *
 * Note: GSC data is delayed ~2 days. Most-recent date in results will lag.
 */

import { createClient } from '@supabase/supabase-js';

const SITE_URL = 'sc-domain:vitabrevisfineart.com';
const SITE_URL_ENCODED = encodeURIComponent(SITE_URL);
const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = parseInt(req.query.days) || 28;
    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 100, 5000);

    // GSC has a ~2-day delay; cap end date at 2 days ago to avoid sparse rows
    const end = new Date();
    end.setDate(end.getDate() - 2);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    const startDate = start.toISOString().split('T')[0];
    const endDate = end.toISOString().split('T')[0];

    const result = {
        property: SITE_URL,
        dateRange: { start: startDate, end: endDate },
        breakdown,
        status: 'loading',
        errors: [],
    };

    try {
        const accessToken = await getAccessToken();
        const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

        if (breakdown === 'summary') {
            // No dimensions — single aggregate row
            const rows = await runQuery(headers, { startDate, endDate, dimensions: [], rowLimit: 1 });
            const row = rows[0] || {};
            result.summary = {
                clicks: row.clicks || 0,
                impressions: row.impressions || 0,
                ctr: row.ctr || 0,
                position: row.position || 0,
            };
        } else if (breakdown === 'query') {
            const rows = await runQuery(headers, {
                startDate, endDate, dimensions: ['query'], rowLimit: limit,
            });
            result.queries = rows.map(r => ({
                query: r.keys?.[0] || '',
                clicks: r.clicks || 0,
                impressions: r.impressions || 0,
                ctr: r.ctr || 0,
                position: r.position || 0,
            }));
        } else if (breakdown === 'page') {
            const rows = await runQuery(headers, {
                startDate, endDate, dimensions: ['page'], rowLimit: limit,
            });
            result.pages = rows.map(r => ({
                page: r.keys?.[0] || '',
                clicks: r.clicks || 0,
                impressions: r.impressions || 0,
                ctr: r.ctr || 0,
                position: r.position || 0,
            }));
        } else if (breakdown === 'date') {
            const rows = await runQuery(headers, {
                startDate, endDate, dimensions: ['date'], rowLimit: 5000,
            });
            result.daily = rows.map(r => ({
                date: r.keys?.[0] || '',
                clicks: r.clicks || 0,
                impressions: r.impressions || 0,
                ctr: r.ctr || 0,
                position: r.position || 0,
            })).sort((a, b) => a.date.localeCompare(b.date));
        } else if (breakdown === 'device') {
            const rows = await runQuery(headers, {
                startDate, endDate, dimensions: ['device'], rowLimit: 10,
            });
            result.devices = rows.map(r => ({
                device: r.keys?.[0] || '',
                clicks: r.clicks || 0,
                impressions: r.impressions || 0,
                ctr: r.ctr || 0,
                position: r.position || 0,
            }));
        } else if (breakdown === 'country') {
            const rows = await runQuery(headers, {
                startDate, endDate, dimensions: ['country'], rowLimit: limit,
            });
            result.countries = rows.map(r => ({
                country: r.keys?.[0] || '',
                clicks: r.clicks || 0,
                impressions: r.impressions || 0,
                ctr: r.ctr || 0,
                position: r.position || 0,
            }));
        } else {
            result.status = 'error';
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            return res.status(200).json(result);
        }

        result.status = 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = err.message?.includes('insufficient') || err.message?.includes('forbidden')
            ? 'needs_reauth'
            : 'error';
        if (result.status === 'needs_reauth') {
            result.message = 'GSC scope missing — re-authorize at /api/google-ads/auth';
        }
        return res.status(200).json(result);
    }
}

async function getAccessToken() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error } = await supabase
        .from('google_ads_connections').select('*')
        .order('created_at', { ascending: false }).limit(1).single();

    if (error || !connection) throw new Error('No Google connection found');

    let accessToken = connection.access_token;
    if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: connection.refresh_token,
                grant_type: 'refresh_token',
            }),
        });
        const refreshData = await refreshResp.json();
        if (!refreshData.access_token) throw new Error('Token refresh failed');
        accessToken = refreshData.access_token;
        await supabase.from('google_ads_connections').update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        }).eq('id', connection.id);
    }
    return accessToken;
}

async function runQuery(headers, body) {
    const resp = await fetch(
        `${GSC_BASE}/sites/${SITE_URL_ENCODED}/searchAnalytics/query`,
        { method: 'POST', headers, body: JSON.stringify(body) }
    );
    const data = await resp.json();
    if (data.error) {
        const msg = data.error.message || JSON.stringify(data.error);
        throw new Error(`GSC API: ${msg}`);
    }
    return data.rows || [];
}

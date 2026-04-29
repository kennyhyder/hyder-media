/**
 * Google Ads - Vita Brevis Keywords (account targeting)
 * GET /api/vita-brevis/google-keywords?days=30
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '3278085194';
const LOGIN_CUSTOMER_ID = '3278085194';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections').select('*')
            .order('created_at', { ascending: false }).limit(1).single();

        if (connError || !connection) {
            return res.status(200).json({ status: 'error', error: 'No connection', keywords: [] });
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
            if (!refreshData.access_token) {
                return res.status(200).json({ status: 'error', error: 'Token refresh failed', keywords: [] });
            }
            accessToken = refreshData.access_token;
            await supabase.from('google_ads_connections').update({
                access_token: accessToken,
                token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
            }).eq('id', connection.id);
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        const days = parseInt(req.query.days) || 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const start = startDate.toISOString().split('T')[0];
        const end = endDate.toISOString().split('T')[0];

        const query = `
            SELECT
                ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text,
                ad_group_criterion.keyword.match_type,
                ad_group_criterion.status,
                ad_group_criterion.quality_info.quality_score,
                campaign.name, ad_group.name,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value
            FROM keyword_view
            WHERE segments.date BETWEEN '${start}' AND '${end}'
                AND ad_group_criterion.status != 'REMOVED'
                AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC
        `;

        const response = await fetch(
            `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
            { method: 'POST', headers, body: JSON.stringify({ query }) }
        );
        const data = await response.json();
        if (data.error) {
            return res.status(200).json({ status: 'error', error: data.error.message, keywords: [] });
        }

        const keywords = (data.results || []).map(row => {
            const c = row.adGroupCriterion || {};
            const m = row.metrics || {};
            const kw = c.keyword || {};
            const spend = parseFloat(m.costMicros || 0) / 1000000;
            const clicks = parseInt(m.clicks || 0, 10);
            const impressions = parseInt(m.impressions || 0, 10);
            const conversions = parseFloat(m.conversions || 0);
            const conversionValue = parseFloat(m.conversionsValue || 0);

            return {
                criterionId: c.criterionId,
                keyword: kw.text, matchType: kw.matchType, status: c.status,
                qualityScore: c.qualityInfo?.qualityScore || null,
                campaign: row.campaign?.name || '',
                adGroup: row.adGroup?.name || '',
                impressions, clicks, spend, conversions, conversionValue,
                ctr: impressions > 0 ? clicks / impressions : 0,
                cpc: clicks > 0 ? spend / clicks : 0,
                cpa: conversions > 0 ? spend / conversions : 0,
                convRate: clicks > 0 ? conversions / clicks : 0,
            };
        });

        return res.status(200).json({
            status: 'success',
            dateRange: { start, end },
            keywords,
        });
    } catch (error) {
        return res.status(200).json({ status: 'error', error: error.message, keywords: [] });
    }
}

/**
 * Google Ads - Digistore24 Search Terms
 * GET /api/digistore/search-terms?days=30&limit=50
 *
 * Returns search terms the account's ads matched against, with metrics.
 * Results are aggregated by search term across campaigns/ad groups.
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '2466246400';
const LOGIN_CUSTOMER_ID = '2466246400';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(200).json({ status: 'error', error: 'No connection', terms: [] });
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
                return res.status(200).json({ status: 'error', error: 'Token refresh failed', terms: [] });
            }
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        const days = parseInt(req.query.days) || 30;
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const start = startDate.toISOString().split('T')[0];
        const end = endDate.toISOString().split('T')[0];

        const query = `
            SELECT
                search_term_view.search_term,
                search_term_view.status,
                campaign.name,
                ad_group.name,
                metrics.impressions,
                metrics.clicks,
                metrics.cost_micros,
                metrics.conversions,
                metrics.conversions_value
            FROM search_term_view
            WHERE segments.date BETWEEN '${start}' AND '${end}'
            ORDER BY metrics.cost_micros DESC
        `;

        const response = await fetch(
            `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
            { method: 'POST', headers, body: JSON.stringify({ query }) }
        );
        const data = await response.json();
        if (data.error) {
            return res.status(200).json({ status: 'error', error: data.error.message, terms: [] });
        }

        // Aggregate by search term (can appear in multiple ad groups)
        const byTerm = {};
        for (const row of (data.results || [])) {
            const stv = row.searchTermView || {};
            const term = stv.searchTerm;
            if (!term) continue;
            const m = row.metrics || {};
            if (!byTerm[term]) {
                byTerm[term] = {
                    searchTerm: term,
                    status: stv.status || '',
                    sources: new Set(),
                    impressions: 0,
                    clicks: 0,
                    spend: 0,
                    conversions: 0,
                    conversionValue: 0,
                };
            }
            byTerm[term].sources.add(`${row.campaign?.name || ''} › ${row.adGroup?.name || ''}`);
            byTerm[term].impressions += parseInt(m.impressions || 0, 10);
            byTerm[term].clicks += parseInt(m.clicks || 0, 10);
            byTerm[term].spend += parseFloat(m.costMicros || 0) / 1000000;
            byTerm[term].conversions += parseFloat(m.conversions || 0);
            byTerm[term].conversionValue += parseFloat(m.conversionsValue || 0);
        }

        const terms = Object.values(byTerm).map(t => ({
            searchTerm: t.searchTerm,
            status: t.status,
            sources: [...t.sources],
            impressions: t.impressions,
            clicks: t.clicks,
            spend: t.spend,
            conversions: t.conversions,
            conversionValue: t.conversionValue,
            ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
            cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
            cpa: t.conversions > 0 ? t.spend / t.conversions : 0,
            convRate: t.clicks > 0 ? t.conversions / t.clicks : 0,
        }));

        // Sort by spend desc, then cap
        terms.sort((a, b) => b.spend - a.spend);

        return res.status(200).json({
            status: 'success',
            dateRange: { start, end },
            totalCount: terms.length,
            terms: terms.slice(0, limit),
        });

    } catch (error) {
        return res.status(200).json({ status: 'error', error: error.message, terms: [] });
    }
}

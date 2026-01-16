/**
 * Google Ads Campaigns API
 * GET /api/google-ads/campaigns
 *
 * Returns campaign data with performance metrics
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        accountId,
        startDate,
        endDate,
        status = 'ENABLED',
        limit = 100,
        offset = 0,
    } = req.query;

    if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
    }

    // Initialize Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Default date range: last 30 days
        const defaultEndDate = new Date();
        defaultEndDate.setDate(defaultEndDate.getDate() - 1);
        const defaultStartDate = new Date();
        defaultStartDate.setDate(defaultStartDate.getDate() - 30);

        const dateStart = startDate || defaultStartDate.toISOString().split('T')[0];
        const dateEnd = endDate || defaultEndDate.toISOString().split('T')[0];

        // Get campaigns with aggregated metrics
        const { data: campaigns, error } = await supabase
            .from('google_ads_campaigns')
            .select(`
                id,
                campaign_id,
                name,
                status,
                advertising_channel_type,
                bidding_strategy_type,
                budget_amount_micros
            `)
            .eq('account_id', accountId)
            .eq('status', status)
            .order('name')
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) {
            throw error;
        }

        // Get metrics for each campaign
        const campaignsWithMetrics = await Promise.all(
            campaigns.map(async (campaign) => {
                const { data: metrics } = await supabase
                    .from('google_ads_campaign_metrics')
                    .select('*')
                    .eq('campaign_id', campaign.id)
                    .gte('date', dateStart)
                    .lte('date', dateEnd);

                // Aggregate metrics
                const aggregated = (metrics || []).reduce(
                    (acc, m) => ({
                        impressions: acc.impressions + (m.impressions || 0),
                        clicks: acc.clicks + (m.clicks || 0),
                        cost: acc.cost + ((m.cost_micros || 0) / 1000000),
                        conversions: acc.conversions + (m.conversions || 0),
                        conversions_value: acc.conversions_value + (m.conversions_value || 0),
                    }),
                    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 }
                );

                // Calculate derived metrics
                const ctr = aggregated.impressions > 0
                    ? (aggregated.clicks / aggregated.impressions) * 100
                    : 0;
                const avgCpc = aggregated.clicks > 0
                    ? aggregated.cost / aggregated.clicks
                    : 0;
                const cpa = aggregated.conversions > 0
                    ? aggregated.cost / aggregated.conversions
                    : 0;
                const roas = aggregated.cost > 0
                    ? aggregated.conversions_value / aggregated.cost
                    : 0;

                return {
                    ...campaign,
                    budget: campaign.budget_amount_micros
                        ? campaign.budget_amount_micros / 1000000
                        : null,
                    metrics: {
                        ...aggregated,
                        ctr: ctr.toFixed(2),
                        avg_cpc: avgCpc.toFixed(2),
                        cpa: cpa.toFixed(2),
                        roas: roas.toFixed(2),
                    },
                    // Include daily breakdown
                    daily: metrics || [],
                };
            })
        );

        // Get total count for pagination
        const { count } = await supabase
            .from('google_ads_campaigns')
            .select('id', { count: 'exact', head: true })
            .eq('account_id', accountId)
            .eq('status', status);

        res.status(200).json({
            success: true,
            campaigns: campaignsWithMetrics,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset),
            },
            dateRange: {
                start: dateStart,
                end: dateEnd,
            },
        });

    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Google Ads - Digistore24 Ad Creative Data
 * GET /api/digistore/ads
 *
 * Fetches RSA ad creative + asset performance labels for account 246-624-6400
 * Supports ?days=30 (default)
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
            return res.status(500).json({ error: 'No Google Ads connection found' });
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
                return res.status(500).json({ error: 'Token refresh failed', details: refreshData });
            }
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        const days = parseInt(req.query.days) || 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const start = startDate.toISOString().split('T')[0];
        const end = endDate.toISOString().split('T')[0];

        // Fetch live ads (no date filter), metrics for date range, and asset performance in parallel
        const [liveAds, adMetrics, assetData] = await Promise.all([
            fetchLiveRSAAds(headers),
            fetchRSAMetrics(headers, start, end),
            fetchAssetPerformance(headers).catch(() => null),
        ]);

        // Build asset leaderboard from asset performance data
        const assetLeaderboard = assetData ? buildAssetLeaderboard(assetData) : null;

        // Merge live ad structure with metrics + asset labels
        const ads = mergeAdsAndMetrics(liveAds, adMetrics, assetData);

        return res.status(200).json({
            status: 'success',
            dateRange: { start, end },
            ads,
            assetLeaderboard,
        });

    } catch (error) {
        return res.status(200).json({
            status: 'error',
            error: error.message,
            ads: [],
            assetLeaderboard: null,
        });
    }
}

async function fetchQuery(headers, query) {
    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.results || [];
}

async function fetchLiveRSAAds(headers) {
    // All enabled RSA ads in enabled campaigns/ad groups — no date filter, structural only
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group_ad.ad.id,
            ad_group_ad.ad.type,
            ad_group_ad.status,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.responsive_search_ad.path1,
            ad_group_ad.ad.responsive_search_ad.path2,
            ad_group_ad.ad.final_urls
        FROM ad_group_ad
        WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
            AND ad_group_ad.status = 'ENABLED'
            AND ad_group.status = 'ENABLED'
            AND campaign.status = 'ENABLED'
    `;
    return fetchQuery(headers, query);
}

async function fetchRSAMetrics(headers, start, end) {
    // Metrics per ad for the date range (aggregated, no segments in SELECT)
    const query = `
        SELECT
            ad_group_ad.ad.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM ad_group_ad
        WHERE segments.date BETWEEN '${start}' AND '${end}'
            AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    `;
    return fetchQuery(headers, query);
}

async function fetchAssetPerformance(headers) {
    const query = `
        SELECT
            ad_group_ad_asset_view.ad_group_ad,
            ad_group_ad_asset_view.field_type,
            ad_group_ad_asset_view.performance_label,
            asset.text_asset.text
        FROM ad_group_ad_asset_view
        WHERE ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
            AND ad_group_ad_asset_view.enabled = true
    `;
    return fetchQuery(headers, query);
}

function mergeAdsAndMetrics(liveAds, adMetrics, assetData) {
    // Build asset label lookup: adId -> { headlines: {text: label}, descriptions: {text: label} }
    const assetLabels = {};
    if (assetData) {
        for (const row of assetData) {
            const view = row.adGroupAdAssetView || {};
            const adResourceName = view.adGroupAd || '';
            const adIdMatch = adResourceName.match(/~(\d+)$/);
            if (!adIdMatch) continue;
            const adId = adIdMatch[1];
            const fieldType = view.fieldType;
            const label = view.performanceLabel || 'UNRATED';
            const text = row.asset?.textAsset?.text || '';

            if (!assetLabels[adId]) assetLabels[adId] = { headlines: {}, descriptions: {} };
            if (fieldType === 'HEADLINE') {
                assetLabels[adId].headlines[text] = label;
            } else if (fieldType === 'DESCRIPTION') {
                assetLabels[adId].descriptions[text] = label;
            }
        }
    }

    // Build metrics lookup by ad ID (aggregate if duplicate rows)
    const metricsByAdId = {};
    for (const row of (adMetrics || [])) {
        const adId = row.adGroupAd?.ad?.id;
        if (!adId) continue;
        const m = row.metrics || {};
        if (!metricsByAdId[adId]) {
            metricsByAdId[adId] = { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 };
        }
        metricsByAdId[adId].impressions += parseInt(m.impressions || 0, 10);
        metricsByAdId[adId].clicks += parseInt(m.clicks || 0, 10);
        metricsByAdId[adId].spend += parseFloat(m.costMicros || 0) / 1000000;
        metricsByAdId[adId].conversions += parseFloat(m.conversions || 0);
        metricsByAdId[adId].conversionValue += parseFloat(m.conversionsValue || 0);
    }

    return liveAds.map(row => {
        const campaign = row.campaign?.name || '';
        const adGroup = row.adGroup?.name || '';
        const ad = row.adGroupAd?.ad || {};
        const adId = ad.id;
        const metrics = metricsByAdId[adId] || { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 };

        const headlines = (ad.responsiveSearchAd?.headlines || []).map(h => ({
            text: h.text,
            pinned: h.pinnedField || null,
            performanceLabel: assetLabels[adId]?.headlines[h.text] || null,
        }));

        const descriptions = (ad.responsiveSearchAd?.descriptions || []).map(d => ({
            text: d.text,
            pinned: d.pinnedField || null,
            performanceLabel: assetLabels[adId]?.descriptions[d.text] || null,
        }));

        // Count performance labels for quick summary
        const labelCounts = { BEST: 0, GOOD: 0, LEARNING: 0, LOW: 0, UNRATED: 0 };
        [...headlines, ...descriptions].forEach(a => {
            const l = a.performanceLabel || 'UNRATED';
            if (labelCounts[l] != null) labelCounts[l]++;
        });

        const rsa = ad.responsiveSearchAd || {};
        return {
            adId,
            campaign,
            adGroup,
            campaignId: row.campaign?.id,
            adGroupId: row.adGroup?.id,
            status: row.adGroupAd?.status || '',
            finalUrl: (ad.finalUrls || [])[0] || '',
            path1: rsa.path1 || '',
            path2: rsa.path2 || '',
            headlines,
            descriptions,
            labelCounts,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            spend: metrics.spend,
            conversions: metrics.conversions,
            conversionValue: metrics.conversionValue,
            ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
            cpa: metrics.conversions > 0 ? metrics.spend / metrics.conversions : 0,
        };
    });
}

function buildAssetLeaderboard(assetData) {
    const headlines = {};
    const descriptions = {};

    for (const row of assetData) {
        const view = row.adGroupAdAssetView || {};
        const fieldType = view.fieldType;
        const label = view.performanceLabel || 'UNRATED';
        const text = row.asset?.textAsset?.text || '';
        if (!text) continue;

        const target = fieldType === 'HEADLINE' ? headlines : descriptions;
        if (!target[text]) {
            target[text] = { text, performanceLabel: label, adCount: 0 };
        }
        target[text].adCount++;
        // Keep the best label (BEST > GOOD > LEARNING > LOW > UNRATED)
        const rank = { BEST: 4, GOOD: 3, LEARNING: 2, LOW: 1, UNRATED: 0 };
        if ((rank[label] || 0) > (rank[target[text].performanceLabel] || 0)) {
            target[text].performanceLabel = label;
        }
    }

    const sortByLabel = (a, b) => {
        const rank = { BEST: 4, GOOD: 3, LEARNING: 2, LOW: 1, UNRATED: 0 };
        return (rank[b.performanceLabel] || 0) - (rank[a.performanceLabel] || 0);
    };

    return {
        headlines: Object.values(headlines).sort(sortByLabel),
        descriptions: Object.values(descriptions).sort(sortByLabel),
    };
}

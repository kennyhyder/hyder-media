/**
 * Google Ads - Vita Brevis RSA Ad Creative
 * GET /api/vita-brevis/google-ads?days=30
 *
 * Customer ID: 327-808-5194 (3278085194). Returns live RSA ads with
 * per-asset performance labels merged in from ad_group_ad_asset_view.
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
        const headers = await getHeaders();

        const { start, end } = resolveDateRange(req.query);

        const [liveAds, adMetrics, assetData] = await Promise.all([
            fetchLiveRSAAds(headers),
            fetchRSAMetrics(headers, start, end),
            fetchAssetPerformance(headers, start, end).catch(() => null),
        ]);

        const assetLeaderboard = assetData ? buildAssetLeaderboard(assetData) : null;
        const ads = mergeAdsAndMetrics(liveAds, adMetrics, assetData);

        return res.status(200).json({
            status: 'success',
            dateRange: { start, end },
            ads,
            assetLeaderboard,
        });
    } catch (error) {
        return res.status(200).json({
            status: 'error', error: error.message, ads: [], assetLeaderboard: null,
        });
    }
}

function resolveDateRange(query) {
    if (query.startDate && query.endDate) {
        return { start: query.startDate, end: query.endDate };
    }
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
    };
}

async function getHeaders() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error: connError } = await supabase
        .from('google_ads_connections').select('*')
        .order('created_at', { ascending: false }).limit(1).single();

    if (connError || !connection) throw new Error('No Google Ads connection found');

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
        if (!refreshData.access_token) throw new Error('Token refresh failed');
        accessToken = refreshData.access_token;
        await supabase.from('google_ads_connections').update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        }).eq('id', connection.id);
    }

    return {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': LOGIN_CUSTOMER_ID,
        'Content-Type': 'application/json',
    };
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
    const query = `
        SELECT
            campaign.id, campaign.name, campaign.status,
            ad_group.id, ad_group.name, ad_group.status,
            ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
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
    const query = `
        SELECT
            ad_group_ad.ad.id,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.conversions_value
        FROM ad_group_ad
        WHERE segments.date BETWEEN '${start}' AND '${end}'
            AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    `;
    return fetchQuery(headers, query);
}

async function fetchAssetPerformance(headers, start, end) {
    const query = `
        SELECT
            ad_group_ad_asset_view.ad_group_ad,
            ad_group_ad_asset_view.field_type,
            ad_group_ad_asset_view.performance_label,
            asset.text_asset.text,
            asset.resource_name
        FROM ad_group_ad_asset_view
        WHERE segments.date BETWEEN '${start}' AND '${end}'
            AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
    `;
    return fetchQuery(headers, query);
}

function mergeAdsAndMetrics(liveAds, adMetrics, assetData) {
    const assetLabels = {};
    if (assetData) {
        for (const row of assetData) {
            const view = row.adGroupAdAssetView || {};
            const adIdMatch = (view.adGroupAd || '').match(/~(\d+)$/);
            if (!adIdMatch) continue;
            const adId = adIdMatch[1];
            const text = (row.asset?.textAsset?.text || '').trim();
            if (!text) continue;
            if (!assetLabels[adId]) assetLabels[adId] = { headlines: {}, descriptions: {} };
            const bucket = view.fieldType === 'HEADLINE' ? assetLabels[adId].headlines
                         : view.fieldType === 'DESCRIPTION' ? assetLabels[adId].descriptions : null;
            if (!bucket) continue;
            bucket[text] = bestLabel(bucket[text], view.performanceLabel);
        }
    }

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
        const ad = row.adGroupAd?.ad || {};
        const adId = ad.id;
        const metrics = metricsByAdId[adId] || { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 };

        const headlines = (ad.responsiveSearchAd?.headlines || []).map(h => ({
            text: h.text,
            pinned: h.pinnedField || null,
            performanceLabel: normalizeLabel(h.assetPerformanceLabel)
                || normalizeLabel(assetLabels[adId]?.headlines[(h.text || '').trim()])
                || null,
        }));

        const descriptions = (ad.responsiveSearchAd?.descriptions || []).map(d => ({
            text: d.text,
            pinned: d.pinnedField || null,
            performanceLabel: normalizeLabel(d.assetPerformanceLabel)
                || normalizeLabel(assetLabels[adId]?.descriptions[(d.text || '').trim()])
                || null,
        }));

        const labelCounts = { BEST: 0, GOOD: 0, LEARNING: 0, LOW: 0, PENDING: 0 };
        [...headlines, ...descriptions].forEach(a => {
            if (a.performanceLabel && labelCounts[a.performanceLabel] != null) labelCounts[a.performanceLabel]++;
        });

        const rsa = ad.responsiveSearchAd || {};
        return {
            adId,
            campaign: row.campaign?.name || '',
            adGroup: row.adGroup?.name || '',
            status: row.adGroupAd?.status || '',
            finalUrl: (ad.finalUrls || [])[0] || '',
            path1: rsa.path1 || '',
            path2: rsa.path2 || '',
            headlines, descriptions, labelCounts,
            ...metrics,
            ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
            cpa: metrics.conversions > 0 ? metrics.spend / metrics.conversions : 0,
        };
    });
}

function buildAssetLeaderboard(assetData) {
    const headlines = {}, descriptions = {};
    for (const row of assetData) {
        const view = row.adGroupAdAssetView || {};
        const text = (row.asset?.textAsset?.text || '').trim();
        if (!text) continue;
        const target = view.fieldType === 'HEADLINE' ? headlines
                     : view.fieldType === 'DESCRIPTION' ? descriptions : null;
        if (!target) continue;
        if (!target[text]) target[text] = { text, performanceLabel: null, adCount: 0 };
        target[text].adCount++;
        target[text].performanceLabel = bestLabel(target[text].performanceLabel, view.performanceLabel);
    }
    const items = obj => {
        const arr = Object.values(obj);
        arr.sort((a, b) => labelRank(b.performanceLabel) - labelRank(a.performanceLabel));
        return arr;
    };
    return { headlines: items(headlines), descriptions: items(descriptions) };
}

function normalizeLabel(label) {
    if (!label) return null;
    const up = String(label).toUpperCase();
    return ['BEST', 'GOOD', 'LEARNING', 'LOW', 'PENDING'].includes(up) ? up : null;
}

function labelRank(label) {
    return { BEST: 5, GOOD: 4, LEARNING: 3, LOW: 2, PENDING: 1 }[label] || 0;
}

function bestLabel(a, b) {
    const na = normalizeLabel(a), nb = normalizeLabel(b);
    return labelRank(nb) > labelRank(na) ? nb : na;
}

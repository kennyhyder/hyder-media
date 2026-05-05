/**
 * Meta Ads - Vita Brevis Fine Art Creative
 * GET /api/vita-brevis/meta-ads?days=30
 *
 * Fetches active ads + per-ad metrics across all 3 Vita Brevis Meta accounts.
 * Returns flat array of ads with { account, campaign, adSet, ad, creative, metrics }.
 */

import { createClient } from '@supabase/supabase-js';

const AD_ACCOUNTS = [
    { id: 'act_910982119354033', name: 'Vita Brevis Account 1' },
    { id: 'act_1187662444921041', name: 'Vita Brevis Account 2' },
    { id: 'act_1088960198165753', name: 'Vita Brevis Account 3' },
];

const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

const CONVERSION_ACTION_TYPES = new Set([
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_web_purchase',
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'lead_form_submission',
    'omni_purchase',
]);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const accountFilter = req.query.account;
    const accounts = accountFilter
        ? AD_ACCOUNTS.filter(a => a.id === accountFilter)
        : AD_ACCOUNTS;

    const { start, end } = resolveDateRange(req.query);

    const result = {
        dateRange: { start, end },
        accounts: AD_ACCOUNTS,
        ads: [],
        status: 'loading',
        errors: [],
    };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: connection, error: connError } = await supabase
            .from('meta_ads_connections').select('*')
            .order('updated_at', { ascending: false }).limit(1).single();

        if (connError || !connection) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'No Meta Ads OAuth connection found.',
            });
        }
        if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'Meta access token expired.',
            });
        }

        const accessToken = connection.access_token;

        const allAds = await Promise.all(
            accounts.map(async acc => {
                try {
                    return await fetchAccountAds(accessToken, acc, start, end);
                } catch (err) {
                    result.errors.push({ account: acc.id, error: err.message });
                    return [];
                }
            })
        );

        result.ads = allAds.flat().sort((a, b) => (b.spend || 0) - (a.spend || 0));
        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = 'error';
        return res.status(200).json(result);
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

async function fetchAccountAds(accessToken, account, start, end) {
    // Active ads with creative details + per-ad insights for the date range
    const [adsResp, insightsRows] = await Promise.all([
        graphGet(`${account.id}/ads`, {
            fields: [
                'id', 'name', 'status', 'effective_status',
                'campaign_id', 'campaign{name}',
                'adset_id', 'adset{name}',
                'creative{id,name,title,body,asset_feed_spec,image_url,thumbnail_url,object_story_spec}',
            ].join(','),
            effective_status: '["ACTIVE"]',
            limit: 200,
        }, accessToken),
        paginatedInsights(accessToken, account.id, {
            level: 'ad',
            time_range: JSON.stringify({ since: start, until: end }),
            time_increment: 'all_days',
            fields: 'ad_id,spend,impressions,clicks,reach,actions,action_values',
            limit: 500,
        }),
    ]);

    const metricsByAdId = {};
    for (const row of insightsRows) {
        const id = row.ad_id;
        if (!metricsByAdId[id]) {
            metricsByAdId[id] = { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversionValue: 0 };
        }
        const m = metricsByAdId[id];
        m.spend += parseFloat(row.spend || 0);
        m.impressions += parseInt(row.impressions || 0, 10);
        m.clicks += parseInt(row.clicks || 0, 10);
        m.reach += parseInt(row.reach || 0, 10);
        for (const a of (row.actions || [])) {
            if (CONVERSION_ACTION_TYPES.has(a.action_type)) m.conversions += parseFloat(a.value || 0);
        }
        for (const a of (row.action_values || [])) {
            if (CONVERSION_ACTION_TYPES.has(a.action_type)) m.conversionValue += parseFloat(a.value || 0);
        }
    }

    return (adsResp.data || []).map(ad => {
        const metrics = metricsByAdId[ad.id] || { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversionValue: 0 };
        const parsed = parseCreative(ad.creative || {});
        return {
            accountId: account.id,
            accountName: account.name,
            campaign: ad.campaign?.name || '',
            campaignId: ad.campaign_id,
            adSet: ad.adset?.name || '',
            adSetId: ad.adset_id,
            id: ad.id,
            name: ad.name,
            status: ad.effective_status || ad.status || '',
            ...parsed,
            ...metrics,
            ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
            cpc: metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0,
            cpm: metrics.impressions > 0 ? (metrics.spend / metrics.impressions) * 1000 : 0,
            cpa: metrics.conversions > 0 ? metrics.spend / metrics.conversions : 0,
            roas: metrics.spend > 0 ? metrics.conversionValue / metrics.spend : 0,
        };
    });
}

function parseCreative(creative) {
    const result = {
        primaryTexts: [], headlines: [], descriptions: [],
        imageUrl: creative.image_url || null,
        thumbnailUrl: creative.thumbnail_url || null,
        linkUrl: null,
    };

    const afs = creative.asset_feed_spec;
    if (afs) {
        if (afs.bodies) result.primaryTexts = afs.bodies.map(b => ({ text: b.text || '' }));
        if (afs.titles) result.headlines = afs.titles.map(t => ({ text: t.text || '' }));
        if (afs.descriptions) result.descriptions = afs.descriptions.map(d => ({ text: d.text || '' }));
        if (afs.link_urls) result.linkUrl = afs.link_urls[0]?.website_url || null;
        if (afs.images?.length > 0) result.imageUrl = result.imageUrl || afs.images[0].url || null;
    }

    const oss = creative.object_story_spec;
    if (oss) {
        const linkData = oss.link_data || {};
        const videoData = oss.video_data || {};
        if (!result.primaryTexts.length) {
            const msg = linkData.message || videoData.message || '';
            if (msg) result.primaryTexts = [{ text: msg }];
        }
        if (!result.headlines.length) {
            const name = linkData.name || videoData.title || '';
            if (name) result.headlines = [{ text: name }];
        }
        if (!result.descriptions.length) {
            const desc = linkData.description || videoData.description || '';
            if (desc) result.descriptions = [{ text: desc }];
        }
        if (!result.linkUrl) result.linkUrl = linkData.link || null;
        if (!result.imageUrl) result.imageUrl = linkData.picture || videoData.image_url || null;
    }

    if (!result.primaryTexts.length && creative.body) result.primaryTexts = [{ text: creative.body }];
    if (!result.headlines.length && creative.title) result.headlines = [{ text: creative.title }];
    if (!result.imageUrl) result.imageUrl = creative.thumbnail_url || null;

    return result;
}

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

async function paginatedInsights(accessToken, accountId, params) {
    const all = [];
    let data = await graphGet(`${accountId}/insights`, params, accessToken);
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

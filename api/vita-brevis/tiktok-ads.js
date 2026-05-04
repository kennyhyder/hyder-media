/**
 * TikTok Ads - Vita Brevis Creative
 * GET /api/vita-brevis/tiktok-ads?days=30
 *
 * Returns active ads with creative (image preview / video thumbnail, ad text,
 * CTA, landing page) plus per-ad metrics for the date range.
 *
 * 4 sequential API calls (one batched):
 *   1. /ad/get/                   — list active ads with text/IDs
 *   2. /file/image/ad/info/       — image URL lookup (batched by 100)
 *   3. /file/video/ad/info/       — video cover/preview URL lookup (batched)
 *   4. /report/integrated/get/    — per-ad metrics
 */

import { createClient } from '@supabase/supabase-js';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const AD_GET_URL = `${TT_BASE}/ad/get/`;
const IMAGE_INFO_URL = `${TT_BASE}/file/image/ad/info/`;
const VIDEO_INFO_URL = `${TT_BASE}/file/video/ad/info/`;
const REPORT_URL = `${TT_BASE}/report/integrated/get/`;
const REFRESH_URL = `${TT_BASE}/oauth2/refresh_token/`;
const BC_ID = '7094682853576916994';

const AD_FIELDS = [
    'ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name',
    'ad_format', 'image_ids', 'video_id',
    'ad_text', 'ad_texts', 'call_to_action', 'landing_page_url', 'display_name',
    'operation_status', 'secondary_status', 'creative_material_mode',
];

const AD_METRICS = [
    'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
    'reach', 'conversion', 'cost_per_conversion',
    'video_play_actions', 'video_watched_2s', 'video_watched_100p',
    'engaged_view', 'likes', 'comments', 'shares',
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = parseInt(req.query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const startDate = start.toISOString().split('T')[0];
    const endDate = end.toISOString().split('T')[0];

    const result = {
        bcId: BC_ID,
        dateRange: { start: startDate, end: endDate },
        ads: [],
        status: 'loading',
        errors: [],
    };

    try {
        const { accessToken, advertiserId } = await getCredentials();
        if (!advertiserId) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'No TikTok advertiser found.',
            });
        }
        result.advertiserId = advertiserId;

        // 1. List active ads
        const ads = await fetchActiveAds(accessToken, advertiserId);

        // 2 & 3. Resolve image + video URLs
        const allImageIds = [...new Set(ads.flatMap(a => a.image_ids || []).filter(Boolean))];
        const allVideoIds = [...new Set(ads.map(a => a.video_id).filter(Boolean))];

        const [imageMap, videoMap] = await Promise.all([
            allImageIds.length ? fetchImageInfo(accessToken, advertiserId, allImageIds) : Promise.resolve(new Map()),
            allVideoIds.length ? fetchVideoInfo(accessToken, advertiserId, allVideoIds) : Promise.resolve(new Map()),
        ]);

        // 4. Per-ad metrics
        const metricsByAdId = await fetchAdMetrics(accessToken, advertiserId, startDate, endDate);

        result.ads = ads.map(ad => {
            const m = metricsByAdId.get(ad.ad_id) || emptyMetrics();
            const firstImageId = (ad.image_ids || [])[0];
            const imageUrl = firstImageId ? imageMap.get(firstImageId) || null : null;
            const video = ad.video_id ? videoMap.get(ad.video_id) || null : null;

            return {
                id: ad.ad_id,
                name: ad.ad_name || ad.display_name || '',
                campaign: ad.campaign_name || '',
                campaignId: ad.campaign_id || '',
                adGroup: ad.adgroup_name || '',
                adGroupId: ad.adgroup_id || '',
                status: ad.operation_status || ad.secondary_status || '',
                adFormat: ad.ad_format || '',
                adText: ad.ad_text || (Array.isArray(ad.ad_texts) ? ad.ad_texts[0] : '') || '',
                callToAction: ad.call_to_action || '',
                landingUrl: ad.landing_page_url || '',
                imageUrl,
                videoCoverUrl: video?.video_cover_url || null,
                videoPreviewUrl: video?.preview_url || null,
                ...m,
            };
        }).sort((a, b) => (b.spend || 0) - (a.spend || 0));

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        const m = (err.message || '').toLowerCase();
        result.status = m.includes('not found') || m.includes('no tiktok') ? 'not_configured'
                      : m.includes('auth') || m.includes('token') ? 'needs_reauth'
                      : 'error';
        return res.status(200).json(result);
    }
}

// ============================================================================
// Credentials (mirrors tiktok-performance.js)
// ============================================================================

async function getCredentials() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error } = await supabase
        .from('tiktok_ads_connections').select('*')
        .order('updated_at', { ascending: false }).limit(1).single();

    if (error || !connection) throw new Error('No TikTok connection found');

    let accessToken = connection.access_token;
    const advertiserIds = Array.isArray(connection.advertiser_ids) ? connection.advertiser_ids : [];
    const advertiserId = advertiserIds[0] ? String(advertiserIds[0]) : null;

    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const refreshResp = await fetch(REFRESH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: process.env.TIKTOK_APP_ID,
                secret: process.env.TIKTOK_APP_SECRET,
                refresh_token: connection.refresh_token,
            }),
        });
        const refreshJson = await refreshResp.json();
        if (refreshJson.code === 0 && refreshJson.data?.access_token) {
            const d = refreshJson.data;
            accessToken = d.access_token;
            await supabase.from('tiktok_ads_connections').update({
                access_token: d.access_token,
                refresh_token: d.refresh_token || connection.refresh_token,
                token_expires_at: new Date(Date.now() + (d.expires_in || 31536000) * 1000).toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('id', connection.id);
        }
    }

    return { accessToken, advertiserId };
}

// ============================================================================
// API helpers
// ============================================================================

async function tiktokGet(url, accessToken, params) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params || {})) {
        if (v == null) continue;
        u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const resp = await fetch(u.toString(), {
        headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (data.code !== 0) {
        throw new Error(`TikTok API: ${data.message || 'unknown error'} (code ${data.code})`);
    }
    return data.data || {};
}

async function fetchActiveAds(accessToken, advertiserId) {
    const out = [];
    let page = 1;
    const pageSize = 200;
    while (true) {
        const data = await tiktokGet(AD_GET_URL, accessToken, {
            advertiser_id: advertiserId,
            filtering: { primary_status: 'STATUS_DELIVERY_OK' },
            fields: AD_FIELDS,
            page,
            page_size: pageSize,
        });
        const list = data.list || [];
        out.push(...list);
        const total = data.page_info?.total_number || 0;
        if (page * pageSize >= total || !list.length) break;
        page += 1;
    }
    return out;
}

async function fetchImageInfo(accessToken, advertiserId, imageIds) {
    const map = new Map();
    // Batch by 100
    for (let i = 0; i < imageIds.length; i += 100) {
        const batch = imageIds.slice(i, i + 100);
        try {
            const data = await tiktokGet(IMAGE_INFO_URL, accessToken, {
                advertiser_id: advertiserId,
                image_ids: batch,
            });
            for (const item of (data.list || [])) {
                if (item.image_id && item.image_url) map.set(item.image_id, item.image_url);
            }
        } catch (e) { /* non-fatal */ }
    }
    return map;
}

async function fetchVideoInfo(accessToken, advertiserId, videoIds) {
    const map = new Map();
    for (let i = 0; i < videoIds.length; i += 100) {
        const batch = videoIds.slice(i, i + 100);
        try {
            const data = await tiktokGet(VIDEO_INFO_URL, accessToken, {
                advertiser_id: advertiserId,
                video_ids: batch,
            });
            for (const item of (data.list || [])) {
                if (item.video_id) {
                    map.set(item.video_id, {
                        video_cover_url: item.video_cover_url || item.poster_url || null,
                        preview_url: item.preview_url || null,
                    });
                }
            }
        } catch (e) { /* non-fatal */ }
    }
    return map;
}

async function fetchAdMetrics(accessToken, advertiserId, startDate, endDate) {
    const map = new Map();
    let page = 1;
    const pageSize = 1000;
    while (true) {
        const data = await tiktokGet(REPORT_URL, accessToken, {
            advertiser_id: advertiserId,
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_AD',
            dimensions: ['ad_id'],
            metrics: AD_METRICS,
            start_date: startDate,
            end_date: endDate,
            page,
            page_size: pageSize,
        });
        const list = data.list || [];
        for (const r of list) {
            const adId = r.dimensions?.ad_id;
            if (!adId) continue;
            const m = r.metrics || {};
            const num = v => v == null || v === '' ? 0 : parseFloat(v) || 0;
            map.set(adId, {
                spend: num(m.spend),
                impressions: num(m.impressions),
                clicks: num(m.clicks),
                reach: num(m.reach),
                ctr: num(m.ctr) / 100,
                cpc: num(m.cpc),
                cpm: num(m.cpm),
                conversions: num(m.conversion),
                costPerConv: num(m.cost_per_conversion),
                videoPlays: num(m.video_play_actions),
                video2s: num(m.video_watched_2s),
                video100p: num(m.video_watched_100p),
                engagedView: num(m.engaged_view),
                likes: num(m.likes),
                comments: num(m.comments),
                shares: num(m.shares),
            });
        }
        const total = data.page_info?.total_number || 0;
        if (page * pageSize >= total || !list.length) break;
        page += 1;
    }
    return map;
}

function emptyMetrics() {
    return {
        spend: 0, impressions: 0, clicks: 0, reach: 0,
        ctr: 0, cpc: 0, cpm: 0,
        conversions: 0, costPerConv: 0,
        videoPlays: 0, video2s: 0, video100p: 0,
        engagedView: 0, likes: 0, comments: 0, shares: 0,
    };
}

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

// Fields requested from /ad/get/. Names are validated by TikTok — invalid names
// throw 40002. `creative_material_mode` was removed because it isn't an accepted
// field name in v1.3 (ad_format covers the same idea).
const AD_FIELDS = [
    'ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name',
    'ad_format', 'image_ids', 'video_id',
    'ad_text', 'ad_texts', 'call_to_action', 'landing_page_url', 'display_name',
    'operation_status', 'secondary_status',
];

const AD_METRICS = [
    'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
    'reach', 'conversion', 'cost_per_conversion',
    'video_play_actions', 'video_watched_2s', 'video_views_p100',
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

        // 1. Per-ad metrics first — this gives us the ads that actually ran in
        //    the date range. STATUS_DELIVERY_OK alone misses ads that ran
        //    earlier in the period but aren't delivering at this exact moment.
        const metricsByAdId = await fetchAdMetrics(accessToken, advertiserId, startDate, endDate);
        const adIdsWithMetrics = [...metricsByAdId.keys()];

        // 2. Fetch the full ad structures for those IDs (plus any currently-live
        //    ads that haven't accrued impressions yet). Two parallel queries
        //    deduped by ad_id.
        const [adsByMetrics, adsCurrentlyLive] = await Promise.all([
            adIdsWithMetrics.length
                ? fetchAdsByIds(accessToken, advertiserId, adIdsWithMetrics)
                : Promise.resolve([]),
            fetchCurrentlyDeliveringAds(accessToken, advertiserId),
        ]);

        const adsById = new Map();
        for (const ad of [...adsByMetrics, ...adsCurrentlyLive]) {
            if (ad?.ad_id) adsById.set(ad.ad_id, ad);
        }
        const ads = [...adsById.values()];

        // 3. Resolve image + video URLs
        const allImageIds = [...new Set(ads.flatMap(a => a.image_ids || []).filter(Boolean))];
        const allVideoIds = [...new Set(ads.map(a => a.video_id).filter(Boolean))];

        const [imageMap, videoMap] = await Promise.all([
            allImageIds.length ? fetchImageInfo(accessToken, advertiserId, allImageIds, result.errors) : Promise.resolve(new Map()),
            allVideoIds.length ? fetchVideoInfo(accessToken, advertiserId, allVideoIds, result.errors) : Promise.resolve(new Map()),
        ]);

        if (req.query.diag === 'true') {
            result.diagnostics = {
                ads_total: ads.length,
                unique_image_ids: allImageIds.length,
                unique_video_ids: allVideoIds.length,
                image_urls_resolved: imageMap.size,
                video_urls_resolved: videoMap.size,
                first_image_id: allImageIds[0],
                first_video_id: allVideoIds[0],
            };
        }

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
        result.status = classifyError(err.message);
        return res.status(200).json(result);
    }
}

function classifyError(message) {
    const m = (message || '').toLowerCase();
    if (m.includes('no tiktok connection') || m.includes('not found')) return 'not_configured';
    if (/\bunauth\w*\b/.test(m)) return 'needs_reauth';
    if (/\binvalid\s+token\b/.test(m) || /\bexpired\s+token\b/.test(m)) return 'needs_reauth';
    if (/\baccess[\s_-]?token\b/.test(m) && /(invalid|expired|missing)/.test(m)) return 'needs_reauth';
    if (/\bcode\s+(40100|40104|40105)\b/.test(m)) return 'needs_reauth';
    return 'error';
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

async function fetchAdsByIds(accessToken, advertiserId, adIds) {
    // /ad/get/ accepts ad_ids[] in the filtering object — batch by 100.
    const out = [];
    for (let i = 0; i < adIds.length; i += 100) {
        const batch = adIds.slice(i, i + 100);
        try {
            const data = await tiktokGet(AD_GET_URL, accessToken, {
                advertiser_id: advertiserId,
                filtering: { ad_ids: batch },
                fields: AD_FIELDS,
                page: 1,
                page_size: 100,
            });
            out.push(...(data.list || []));
        } catch (e) { /* non-fatal, skip the batch */ }
    }
    return out;
}

async function fetchCurrentlyDeliveringAds(accessToken, advertiserId) {
    // Catch ads that are delivering right now but might not have impressions
    // yet (just-launched). Limited to a single page (200) — a small advertiser
    // shouldn't have more than that delivering.
    try {
        const data = await tiktokGet(AD_GET_URL, accessToken, {
            advertiser_id: advertiserId,
            filtering: { primary_status: 'STATUS_DELIVERY_OK' },
            fields: AD_FIELDS,
            page: 1,
            page_size: 200,
        });
        return data.list || [];
    } catch (e) {
        return [];
    }
}

async function fetchImageInfo(accessToken, advertiserId, imageIds, errorBag) {
    const map = new Map();
    for (let i = 0; i < imageIds.length; i += 50) {
        const batch = imageIds.slice(i, i + 50);
        try {
            const data = await tiktokGet(IMAGE_INFO_URL, accessToken, {
                advertiser_id: advertiserId,
                image_ids: batch,
            });
            for (const item of (data.list || [])) {
                if (item.image_id && item.image_url) map.set(item.image_id, item.image_url);
            }
        } catch (e) {
            if (errorBag) errorBag.push({ step: 'fetchImageInfo', batch_index: i, error: e.message });
        }
    }
    return map;
}

async function fetchVideoInfo(accessToken, advertiserId, videoIds, errorBag) {
    const map = new Map();
    for (let i = 0; i < videoIds.length; i += 50) {
        const batch = videoIds.slice(i, i + 50);
        try {
            const data = await tiktokGet(VIDEO_INFO_URL, accessToken, {
                advertiser_id: advertiserId,
                video_ids: batch,
            });
            for (const item of (data.list || [])) {
                if (item.video_id) {
                    map.set(item.video_id, {
                        video_cover_url: item.video_cover_url || null,
                        preview_url: item.preview_url || null,
                    });
                }
            }
        } catch (e) {
            if (errorBag) errorBag.push({ step: 'fetchVideoInfo', batch_index: i, error: e.message });
        }
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
                video100p: num(m.video_views_p100),
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

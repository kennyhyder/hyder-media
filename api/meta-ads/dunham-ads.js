/**
 * Meta Ads - Dunham & Jones Ad Copy Audit
 * GET /api/meta-ads/dunham-ads
 *
 * Active mode (no year param): fetches currently active campaigns/ads
 * Historical mode (?year=YYYY): fetches ads that received impressions that year
 *
 * Historical results are cached in Supabase to avoid Meta API rate limits.
 * Past years: 24h cache. Current year: 1h cache. Active: no cache.
 */

import { createClient } from '@supabase/supabase-js';

const AD_ACCOUNT_ID = 'act_104149513126190';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

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
            .from('meta_ads_connections')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(401).json({
                error: 'No Meta Ads connection found. Please authorize first.',
                needsAuth: true,
            });
        }

        if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
            return res.status(401).json({
                error: 'Meta token expired. Please re-authorize.',
                needsAuth: true,
            });
        }

        const accessToken = connection.access_token;
        const year = parseInt(req.query.year);
        const currentYear = new Date().getFullYear();
        const isHistorical = year && year >= 2020 && year <= currentYear;

        if (isHistorical) {
            const data = await fetchHistorical(accessToken, year, supabase);
            return res.status(200).json(data);
        }

        const data = await fetchActive(accessToken);
        return res.status(200).json(data);

    } catch (error) {
        console.error('Meta dunham-ads error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// --------------- Cache helpers ---------------

async function getCached(supabase, key, maxAgeMinutes) {
    try {
        const { data } = await supabase
            .from('meta_ads_cache')
            .select('data, cached_at')
            .eq('cache_key', key)
            .single();
        if (!data) return null;
        const ageMin = (Date.now() - new Date(data.cached_at).getTime()) / 60000;
        if (ageMin > maxAgeMinutes) return null;
        return data.data;
    } catch {
        return null;
    }
}

async function setCache(supabase, key, value) {
    try {
        await supabase
            .from('meta_ads_cache')
            .upsert({ cache_key: key, data: value, cached_at: new Date().toISOString() },
                     { onConflict: 'cache_key' });
    } catch { /* non-fatal */ }
}

// --------------- Data fetching ---------------

/**
 * Fetch currently active campaigns and ads (no cache)
 */
async function fetchActive(accessToken) {
    const campaignsResp = await graphGet(
        `${AD_ACCOUNT_ID}/campaigns`,
        {
            fields: 'id,name,status,objective',
            effective_status: '["ACTIVE"]',
            limit: 100,
        },
        accessToken
    );
    const campaigns = campaignsResp.data || [];

    const adsResp = await graphGet(
        `${AD_ACCOUNT_ID}/ads`,
        {
            fields: [
                'id', 'name', 'status', 'effective_status',
                'campaign_id', 'adset_id',
                'adset{name,status}',
                'creative{id,name,title,body,asset_feed_spec,image_url,thumbnail_url,object_story_spec}',
            ].join(','),
            effective_status: '["ACTIVE"]',
            limit: 200,
        },
        accessToken
    );
    const ads = adsResp.data || [];

    return buildActiveResponse(campaigns, ads);
}

/**
 * Fetch historical ads for a given year.
 * Uses Supabase cache to avoid rate limiting.
 */
async function fetchHistorical(accessToken, year, supabase) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const isCurrentYear = year >= currentYear;

    // Check cache: 1h for current year, indefinite for past years
    const cacheKey = `dunham:meta:${year}`;
    const maxAgeMin = isCurrentYear ? 60 : Infinity;
    const cached = await getCached(supabase, cacheKey, maxAgeMin);
    if (cached) {
        cached._cached = true;
        return cached;
    }

    // Determine date range
    const untilDate = isCurrentYear
        ? now.toISOString().slice(0, 10)
        : `${year}-12-31`;

    // Meta retains ~37 months of insights — clamp start date
    const minDate = new Date(now);
    minDate.setMonth(minDate.getMonth() - 37);
    const minDateStr = minDate.toISOString().slice(0, 10);
    const sinceDate = `${year}-01-01` < minDateStr ? minDateStr : `${year}-01-01`;

    const timeRange = JSON.stringify({ since: sinceDate, until: untilDate });

    // 1. Fetch insights (all ads with impressions in the date range)
    let allInsights = [];
    const baseParams = {
        level: 'ad',
        time_range: timeRange,
        fields: 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,impressions',
        limit: 500,
        time_increment: 'all_days',
    };

    const firstResp = await graphGet(`${AD_ACCOUNT_ID}/insights`, baseParams, accessToken);
    allInsights = firstResp.data || [];
    let nextUrl = firstResp.paging?.next || null;

    while (nextUrl) {
        const pageResp = await fetch(nextUrl);
        const pageData = await pageResp.json();
        if (pageData.error) break;
        allInsights = allInsights.concat(pageData.data || []);
        nextUrl = pageData.paging?.next || null;
    }

    const insights = allInsights.filter(r => parseInt(r.impressions || 0) > 0);

    // 2. Fetch creative details in bulk using multi-ID endpoint
    //    GET /?ids=id1,id2,...&fields=creative{...} — up to 50 IDs per call
    const insightAdIds = new Set(insights.map(r => r.ad_id));
    const creativeMap = new Map();

    const adIdsToFetch = [...insightAdIds];
    for (let i = 0; i < adIdsToFetch.length; i += 50) {
        const batch = adIdsToFetch.slice(i, i + 50);
        try {
            const resp = await graphGet('', {
                ids: batch.join(','),
                fields: 'creative{id,name,title,body,asset_feed_spec,image_url,thumbnail_url,object_story_spec}',
            }, accessToken);
            // Response is keyed by ad ID
            for (const [adId, adData] of Object.entries(resp)) {
                if (adData && adData.creative) creativeMap.set(adId, adData.creative);
            }
        } catch { /* batch may partially fail, continue */ }
    }

    // 3. For current year, also fetch active ads directly
    //    (insights can lag for recently launched ads)
    let directAds = [];
    if (isCurrentYear) {
        try {
            const adsResp = await graphGet(
                `${AD_ACCOUNT_ID}/ads`,
                {
                    fields: [
                        'id', 'name', 'status', 'effective_status',
                        'campaign_id', 'adset_id',
                        'campaign{name}', 'adset{name}',
                        'creative{id,name,title,body,asset_feed_spec,image_url,thumbnail_url,object_story_spec}',
                    ].join(','),
                    effective_status: '["ACTIVE"]',
                    limit: 200,
                },
                accessToken
            );
            directAds = adsResp.data || [];
        } catch { /* non-fatal */ }
    }

    // 4. Build response
    const response = buildHistoricalResponse(insights, creativeMap, year);

    // Merge in active ads not already in insights
    if (directAds.length > 0) {
        for (const ad of directAds) {
            if (insightAdIds.has(ad.id)) continue;

            const campId = ad.campaign_id;
            const adsetId = ad.adset_id;
            const campaign = ad.campaign || {};
            const adset = ad.adset || {};

            let camp = response.campaigns.find(c => c.id === campId);
            if (!camp) {
                camp = { id: campId, name: campaign.name || `Campaign ${campId}`, status: 'ACTIVE', objective: null, adSets: [] };
                response.campaigns.push(camp);
            }

            let adSetObj = camp.adSets.find(s => s.id === adsetId);
            if (!adSetObj) {
                adSetObj = { id: adsetId, name: adset.name || `Ad Set ${adsetId}`, status: 'ACTIVE', ads: [] };
                camp.adSets.push(adSetObj);
            }

            const parsed = parseCreative(ad.creative || {});
            adSetObj.ads.push({
                id: ad.id, name: ad.name,
                status: ad.effective_status || ad.status || 'ACTIVE',
                ...parsed, impressions: 0,
            });
        }
        response.campaigns.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    response._debug = {
        totalInsightsRows: allInsights.length,
        afterImpressionFilter: insights.length,
        uniqueAdsFromInsights: insightAdIds.size,
        creativesFound: creativeMap.size,
        directAdsMerged: directAds.filter(a => !insightAdIds.has(a.id)).length,
        timeRange: { since: sinceDate, until: untilDate },
    };

    // 5. Cache the result
    await setCache(supabase, cacheKey, response);

    return response;
}

// --------------- Response builders ---------------

function buildActiveResponse(campaigns, ads) {
    const campaignMap = new Map();

    for (const c of campaigns) {
        campaignMap.set(c.id, {
            id: c.id, name: c.name, status: c.status,
            objective: c.objective || null, adSets: new Map(),
        });
    }

    for (const ad of ads) {
        const campId = ad.campaign_id;
        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId, name: `Campaign ${campId}`, status: 'ACTIVE',
                objective: null, adSets: new Map(),
            });
        }

        const camp = campaignMap.get(campId);
        const adsetId = ad.adset_id;
        const adset = ad.adset || {};

        if (!camp.adSets.has(adsetId)) {
            camp.adSets.set(adsetId, {
                id: adsetId, name: adset.name || `Ad Set ${adsetId}`,
                status: adset.status || 'ACTIVE', ads: [],
            });
        }

        camp.adSets.get(adsetId).ads.push(parseAd(ad));
    }

    for (const [id, camp] of campaignMap) {
        if (camp.adSets.size === 0) campaignMap.delete(id);
    }

    const result = Array.from(campaignMap.values()).map(c => ({
        ...c, adSets: Array.from(c.adSets.values()),
    }));
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: AD_ACCOUNT_ID, name: 'Dunham & Jones' },
        platform: 'meta', campaigns: result,
        historical: false, fetchedAt: new Date().toISOString(),
    };
}

function buildHistoricalResponse(insights, creativeMap, year) {
    const campaignMap = new Map();

    for (const row of insights) {
        const campId = row.campaign_id;
        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId, name: row.campaign_name, status: 'HISTORICAL',
                objective: null, adSets: new Map(),
            });
        }

        const camp = campaignMap.get(campId);
        const adsetId = row.adset_id;

        if (!camp.adSets.has(adsetId)) {
            camp.adSets.set(adsetId, {
                id: adsetId, name: row.adset_name, status: 'HISTORICAL', ads: [],
            });
        }

        const adSetObj = camp.adSets.get(adsetId);
        const existing = adSetObj.ads.find(a => a.id === row.ad_id);
        if (existing) {
            existing.impressions += parseInt(row.impressions || 0);
            continue;
        }

        const creative = creativeMap.get(row.ad_id);
        const parsed = creative
            ? parseCreative(creative)
            : { primaryTexts: [], headlines: [], descriptions: [], imageUrl: null, thumbnailUrl: null, linkUrl: null };

        adSetObj.ads.push({
            id: row.ad_id, name: row.ad_name, status: 'HISTORICAL',
            ...parsed, impressions: parseInt(row.impressions || 0),
        });
    }

    const result = Array.from(campaignMap.values()).map(c => ({
        ...c, adSets: Array.from(c.adSets.values()),
    }));
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: AD_ACCOUNT_ID, name: 'Dunham & Jones' },
        platform: 'meta', campaigns: result,
        historical: true, year, fetchedAt: new Date().toISOString(),
    };
}

// --------------- Creative parsing ---------------

function parseAd(ad) {
    const parsed = parseCreative(ad.creative || {});
    return { id: ad.id, name: ad.name, status: ad.status, ...parsed };
}

function parseCreative(creative) {
    const result = {
        primaryTexts: [], headlines: [], descriptions: [],
        imageUrl: creative.image_url || creative.thumbnail_url || null,
        thumbnailUrl: creative.thumbnail_url || null,
        linkUrl: null,
    };

    // 1. Dynamic creative (asset_feed_spec)
    const afs = creative.asset_feed_spec;
    if (afs) {
        if (afs.bodies) result.primaryTexts = afs.bodies.map(b => ({ text: b.text || '' }));
        if (afs.titles) result.headlines = afs.titles.map(t => ({ text: t.text || '' }));
        if (afs.descriptions) result.descriptions = afs.descriptions.map(d => ({ text: d.text || '' }));
        if (afs.link_urls) result.linkUrl = afs.link_urls[0]?.website_url || null;
        if (afs.images?.length > 0) result.imageUrl = result.imageUrl || afs.images[0].url || null;
    }

    // 2. object_story_spec (standard link/video ads)
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

    // 3. Legacy fallbacks
    if (!result.primaryTexts.length && creative.body) result.primaryTexts = [{ text: creative.body }];
    if (!result.headlines.length && creative.title) result.headlines = [{ text: creative.title }];

    return result;
}

// --------------- Graph API helper ---------------

async function graphGet(endpoint, params, accessToken) {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}/${endpoint}`);
    url.searchParams.set('access_token', accessToken);

    for (const [key, val] of Object.entries(params || {})) {
        if (val != null) url.searchParams.set(key, val);
    }

    const resp = await fetch(url.toString());
    const data = await resp.json();

    if (data.error) {
        throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`);
    }

    return data;
}

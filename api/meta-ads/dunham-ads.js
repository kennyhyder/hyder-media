/**
 * Meta Ads - Dunham & Jones Ad Copy Audit
 * GET /api/meta-ads/dunham-ads
 *
 * Active mode (no year param): fetches currently active campaigns/ads
 * Historical mode (?year=YYYY): fetches ads that received impressions that year
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
            const data = await fetchHistorical(accessToken, year);
            return res.status(200).json(data);
        }

        const data = await fetchActive(accessToken);
        return res.status(200).json(data);

    } catch (error) {
        console.error('Meta dunham-ads error:', error);
        return res.status(500).json({ error: error.message });
    }
}

/**
 * Fetch currently active campaigns and ads
 */
async function fetchActive(accessToken) {
    // Use effective_status param (not filtering) to get active campaigns
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

    // Use effective_status param for ads too
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
 * Fetch historical ads for a given year using insights.
 * Only ads with impressions > 0 are included.
 */
async function fetchHistorical(accessToken, year) {
    // For current year, use today's date as end (Meta API doesn't handle future dates)
    const now = new Date();
    const untilDate = year >= now.getFullYear()
        ? now.toISOString().slice(0, 10)
        : `${year}-12-31`;
    const timeRange = JSON.stringify({ since: `${year}-01-01`, until: untilDate });

    // Paginate through all insights for the year
    let allInsights = [];
    let nextUrl = null;
    const baseParams = {
        level: 'ad',
        time_range: timeRange,
        fields: 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,impressions',
        limit: 500,
    };

    const firstResp = await graphGet(`${AD_ACCOUNT_ID}/insights`, baseParams, accessToken);
    allInsights = firstResp.data || [];
    nextUrl = firstResp.paging?.next || null;

    while (nextUrl) {
        const pageResp = await fetch(nextUrl);
        const pageData = await pageResp.json();
        if (pageData.error) break;
        allInsights = allInsights.concat(pageData.data || []);
        nextUrl = pageData.paging?.next || null;
    }

    // Only keep ads with actual impressions
    const insights = allInsights.filter(r => parseInt(r.impressions || 0) > 0);

    // Fetch creative details for each unique ad
    const adIds = [...new Set(insights.map(r => r.ad_id))];
    const creativeMap = new Map();

    // Fetch all creatives in parallel batches of 10
    for (let i = 0; i < adIds.length; i += 10) {
        const batch = adIds.slice(i, i + 10);
        const results = await Promise.allSettled(
            batch.map(adId =>
                graphGet(adId, {
                    fields: 'creative{id,name,title,body,asset_feed_spec,image_url,thumbnail_url,object_story_spec}',
                }, accessToken).then(resp => {
                    if (resp.creative) creativeMap.set(adId, resp.creative);
                })
            )
        );
    }

    return buildHistoricalResponse(insights, creativeMap, year);
}

/**
 * Build response for active ads
 */
function buildActiveResponse(campaigns, ads) {
    const campaignMap = new Map();

    for (const c of campaigns) {
        campaignMap.set(c.id, {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective || null,
            adSets: new Map(),
        });
    }

    for (const ad of ads) {
        const campId = ad.campaign_id;
        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId,
                name: `Campaign ${campId}`,
                status: 'ACTIVE',
                objective: null,
                adSets: new Map(),
            });
        }

        const camp = campaignMap.get(campId);
        const adsetId = ad.adset_id;
        const adset = ad.adset || {};

        if (!camp.adSets.has(adsetId)) {
            camp.adSets.set(adsetId, {
                id: adsetId,
                name: adset.name || `Ad Set ${adsetId}`,
                status: adset.status || 'ACTIVE',
                ads: [],
            });
        }

        camp.adSets.get(adsetId).ads.push(parseAd(ad));
    }

    // Remove campaigns with no ads
    for (const [id, camp] of campaignMap) {
        if (camp.adSets.size === 0) campaignMap.delete(id);
    }

    const result = Array.from(campaignMap.values()).map(c => ({
        ...c,
        adSets: Array.from(c.adSets.values()),
    }));
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: AD_ACCOUNT_ID, name: 'Dunham & Jones' },
        platform: 'meta',
        campaigns: result,
        historical: false,
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * Build response for historical ads from insights data
 */
function buildHistoricalResponse(insights, creativeMap, year) {
    const campaignMap = new Map();

    for (const row of insights) {
        const campId = row.campaign_id;
        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId,
                name: row.campaign_name,
                status: 'HISTORICAL',
                objective: null,
                adSets: new Map(),
            });
        }

        const camp = campaignMap.get(campId);
        const adsetId = row.adset_id;

        if (!camp.adSets.has(adsetId)) {
            camp.adSets.set(adsetId, {
                id: adsetId,
                name: row.adset_name,
                status: 'HISTORICAL',
                ads: [],
            });
        }

        const adSetObj = camp.adSets.get(adsetId);

        // Aggregate if same ad appears multiple times
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
            id: row.ad_id,
            name: row.ad_name,
            status: 'HISTORICAL',
            ...parsed,
            impressions: parseInt(row.impressions || 0),
        });
    }

    const result = Array.from(campaignMap.values()).map(c => ({
        ...c,
        adSets: Array.from(c.adSets.values()),
    }));
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: AD_ACCOUNT_ID, name: 'Dunham & Jones' },
        platform: 'meta',
        campaigns: result,
        historical: true,
        year,
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * Parse a single active ad into our response shape
 */
function parseAd(ad) {
    const creative = ad.creative || {};
    const parsed = parseCreative(creative);
    return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        ...parsed,
    };
}

/**
 * Parse creative into primaryTexts/headlines/descriptions/imageUrl.
 * Handles asset_feed_spec (dynamic creative), object_story_spec (standard),
 * and legacy body/title fields.
 */
function parseCreative(creative) {
    const result = {
        primaryTexts: [],
        headlines: [],
        descriptions: [],
        imageUrl: creative.image_url || creative.thumbnail_url || null,
        thumbnailUrl: creative.thumbnail_url || null,
        linkUrl: null,
    };

    // 1. Dynamic creative (asset_feed_spec) — highest priority
    const afs = creative.asset_feed_spec;
    if (afs) {
        if (afs.bodies) result.primaryTexts = afs.bodies.map(b => ({ text: b.text || '' }));
        if (afs.titles) result.headlines = afs.titles.map(t => ({ text: t.text || '' }));
        if (afs.descriptions) result.descriptions = afs.descriptions.map(d => ({ text: d.text || '' }));
        if (afs.link_urls) result.linkUrl = afs.link_urls[0]?.website_url || null;
        if (afs.images && afs.images.length > 0) {
            result.imageUrl = result.imageUrl || afs.images[0].url || null;
        }
    }

    // 2. object_story_spec — standard ads (link ads, video ads)
    const oss = creative.object_story_spec;
    if (oss) {
        const linkData = oss.link_data || {};
        const videoData = oss.video_data || {};

        if (result.primaryTexts.length === 0) {
            const msg = linkData.message || videoData.message || '';
            if (msg) result.primaryTexts = [{ text: msg }];
        }
        if (result.headlines.length === 0) {
            const name = linkData.name || videoData.title || '';
            if (name) result.headlines = [{ text: name }];
        }
        if (result.descriptions.length === 0) {
            const desc = linkData.description || videoData.description || '';
            if (desc) result.descriptions = [{ text: desc }];
        }
        if (!result.linkUrl) {
            result.linkUrl = linkData.link || null;
        }
        if (!result.imageUrl) {
            result.imageUrl = linkData.picture || videoData.image_url || null;
        }
    }

    // 3. Legacy fallbacks
    if (result.primaryTexts.length === 0 && creative.body) {
        result.primaryTexts = [{ text: creative.body }];
    }
    if (result.headlines.length === 0 && creative.title) {
        result.headlines = [{ text: creative.title }];
    }

    return result;
}

/**
 * Helper: GET request to Graph API with pagination support
 */
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

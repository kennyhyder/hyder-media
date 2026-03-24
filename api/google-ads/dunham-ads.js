/**
 * Google Ads - Dunham & Jones Ad Copy Audit
 * GET /api/google-ads/dunham-ads
 *
 * Fetches all active ad copy + extensions for account 840-838-5870
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '8408385870';

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

        // Get most recent connection
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(500).json({ error: 'No Google Ads connection found. Please authorize first.' });
        }

        let accessToken = connection.access_token;

        // Refresh token if expired
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
            'login-customer-id': CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        // Run all three queries in parallel
        const [adsData, campaignAssetsData, customerAssetsData] = await Promise.all([
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    campaign.id, campaign.name, campaign.status,
                    ad_group.id, ad_group.name, ad_group.status,
                    ad_group_ad.ad.id, ad_group_ad.ad.type,
                    ad_group_ad.ad.name, ad_group_ad.status,
                    ad_group_ad.ad.responsive_search_ad.headlines,
                    ad_group_ad.ad.responsive_search_ad.descriptions,
                    ad_group_ad.ad.final_urls,
                    ad_group_ad.ad.final_url_suffix
                FROM ad_group_ad
                WHERE campaign.status = 'ENABLED'
                    AND ad_group.status = 'ENABLED'
                    AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id, asset.name, asset.type,
                    asset.sitelink_asset.description1,
                    asset.sitelink_asset.description2,
                    asset.sitelink_asset.link_text,
                    asset.callout_asset.callout_text,
                    asset.structured_snippet_asset.header,
                    asset.structured_snippet_asset.values,
                    asset.final_urls,
                    campaign_asset.campaign,
                    campaign_asset.field_type,
                    campaign_asset.status
                FROM campaign_asset
                WHERE campaign_asset.status != 'REMOVED'
                    AND campaign.status = 'ENABLED'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id, asset.name, asset.type,
                    asset.sitelink_asset.description1,
                    asset.sitelink_asset.description2,
                    asset.sitelink_asset.link_text,
                    asset.callout_asset.callout_text,
                    asset.structured_snippet_asset.header,
                    asset.structured_snippet_asset.values,
                    asset.final_urls,
                    customer_asset.field_type,
                    customer_asset.status
                FROM customer_asset
                WHERE customer_asset.status != 'REMOVED'
            `),
        ]);

        // Check for errors
        if (adsData.error) return res.status(500).json({ error: 'Ads query failed', details: adsData.error });
        if (campaignAssetsData.error) return res.status(500).json({ error: 'Campaign assets query failed', details: campaignAssetsData.error });
        if (customerAssetsData.error) return res.status(500).json({ error: 'Customer assets query failed', details: customerAssetsData.error });

        // Build structured response
        const response = buildResponse(adsData.results || [], campaignAssetsData.results || [], customerAssetsData.results || []);

        return res.status(200).json(response);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

async function fetchQuery(customerId, headers, query) {
    try {
        const response = await fetch(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ query }),
            }
        );

        const data = await response.json();
        if (data.error) {
            return { error: data.error.message || JSON.stringify(data.error) };
        }
        return { results: data.results || [] };
    } catch (e) {
        return { error: e.message };
    }
}

function buildResponse(adsRows, campaignAssetRows, customerAssetRows) {
    // Build campaigns → adGroups → ads hierarchy
    const campaignMap = new Map();

    for (const row of adsRows) {
        const campaign = row.campaign || {};
        const adGroup = row.adGroup || {};
        const adGroupAd = row.adGroupAd || {};
        const ad = adGroupAd.ad || {};

        const campId = campaign.id;
        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId,
                name: campaign.name,
                status: campaign.status,
                adGroups: new Map(),
                assets: [],
            });
        }

        const campObj = campaignMap.get(campId);
        const agId = adGroup.id;
        if (!campObj.adGroups.has(agId)) {
            campObj.adGroups.set(agId, {
                id: agId,
                name: adGroup.name,
                status: adGroup.status,
                ads: [],
            });
        }

        const agObj = campObj.adGroups.get(agId);

        // Parse RSA headlines/descriptions
        const rsa = ad.responsiveSearchAd || {};
        const headlines = (rsa.headlines || []).map((h, i) => ({
            position: i + 1,
            text: h.text,
            pinnedField: h.pinnedField || null,
        }));
        const descriptions = (rsa.descriptions || []).map((d, i) => ({
            position: i + 1,
            text: d.text,
            pinnedField: d.pinnedField || null,
        }));

        agObj.ads.push({
            id: ad.id,
            type: ad.type,
            name: ad.name || null,
            status: adGroupAd.status,
            headlines,
            descriptions,
            finalUrls: ad.finalUrls || [],
            finalUrlSuffix: ad.finalUrlSuffix || null,
        });
    }

    // Attach campaign-level assets
    for (const row of campaignAssetRows) {
        const asset = row.asset || {};
        const campaignAsset = row.campaignAsset || {};
        const campaignResource = campaignAsset.campaign || '';
        // Extract campaign ID from resource name: customers/XXX/campaigns/YYY
        const campIdMatch = campaignResource.match(/campaigns\/(\d+)/);
        const campId = campIdMatch ? campIdMatch[1] : null;

        if (campId && campaignMap.has(campId)) {
            campaignMap.get(campId).assets.push(formatAsset(asset, campaignAsset));
        }
    }

    // Format customer-level assets
    const accountAssets = customerAssetRows.map(row => {
        const asset = row.asset || {};
        const customerAsset = row.customerAsset || {};
        return formatAsset(asset, customerAsset);
    });

    // Convert maps to arrays
    const campaigns = Array.from(campaignMap.values()).map(c => ({
        ...c,
        adGroups: Array.from(c.adGroups.values()),
    }));

    // Sort campaigns by name
    campaigns.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: '840-838-5870', name: 'Dunham & Jones' },
        campaigns,
        accountAssets,
        fetchedAt: new Date().toISOString(),
    };
}

function formatAsset(asset, parentAsset) {
    const type = asset.type;
    const base = {
        id: asset.id,
        type,
        name: asset.name || null,
        fieldType: parentAsset.fieldType || null,
        status: parentAsset.status || null,
    };

    if (type === 'SITELINK') {
        const sl = asset.sitelinkAsset || {};
        return { ...base, linkText: sl.linkText, desc1: sl.description1, desc2: sl.description2, finalUrls: asset.finalUrls || [] };
    }
    if (type === 'CALLOUT') {
        const co = asset.calloutAsset || {};
        return { ...base, text: co.calloutText };
    }
    if (type === 'STRUCTURED_SNIPPET') {
        const ss = asset.structuredSnippetAsset || {};
        return { ...base, header: ss.header, values: ss.values || [] };
    }
    return base;
}

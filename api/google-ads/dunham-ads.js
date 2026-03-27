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

        // Check for year parameter (historical mode)
        const year = parseInt(req.query.year);
        const currentYear = new Date().getFullYear();
        const isHistorical = year && year >= 2010 && year <= currentYear;

        if (isHistorical) {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;

            const [adsData, keywordsData, agNegData, campNegData, pmaxCampaigns, assetGroupsData, assetGroupAssetsData, histTextAssets, histImageAssets, sharedSetsH, sharedCriteriaH, campaignSharedSetsH, accountNegsH] = await Promise.all([
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id, campaign.name, campaign.status,
                        ad_group.id, ad_group.name, ad_group.status,
                        ad_group_ad.ad.id, ad_group_ad.ad.type,
                        ad_group_ad.ad.name, ad_group_ad.status,
                        ad_group_ad.ad.responsive_search_ad.headlines,
                        ad_group_ad.ad.responsive_search_ad.descriptions,
                        ad_group_ad.ad.expanded_text_ad.headline_part1,
                        ad_group_ad.ad.expanded_text_ad.headline_part2,
                        ad_group_ad.ad.expanded_text_ad.headline_part3,
                        ad_group_ad.ad.expanded_text_ad.description,
                        ad_group_ad.ad.expanded_text_ad.description2,
                        ad_group_ad.ad.expanded_text_ad.path1,
                        ad_group_ad.ad.expanded_text_ad.path2,
                        ad_group_ad.ad.final_urls,
                        metrics.impressions
                    FROM ad_group_ad
                    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
                        AND metrics.impressions > 0
                `),
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id,
                        ad_group.id,
                        ad_group_criterion.keyword.text,
                        ad_group_criterion.keyword.match_type,
                        metrics.impressions
                    FROM keyword_view
                    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
                        AND metrics.impressions > 0
                `),
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id,
                        ad_group.id,
                        ad_group_criterion.keyword.text,
                        ad_group_criterion.keyword.match_type
                    FROM ad_group_criterion
                    WHERE ad_group_criterion.type = 'KEYWORD'
                        AND ad_group_criterion.negative = true
                `),
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id,
                        campaign_criterion.keyword.text,
                        campaign_criterion.keyword.match_type
                    FROM campaign_criterion
                    WHERE campaign_criterion.type = 'KEYWORD'
                        AND campaign_criterion.negative = true
                `),
                // PMax: find campaigns that ran during this period
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id, campaign.name, campaign.status,
                        metrics.impressions
                    FROM campaign
                    WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
                        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
                        AND metrics.impressions > 0
                `),
                // PMax: asset groups (current state — no historical snapshots available)
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id, campaign.name, campaign.status,
                        asset_group.id, asset_group.name, asset_group.status
                    FROM asset_group
                `),
                // PMax: asset group → asset links
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        campaign.id,
                        asset_group.id,
                        asset.id, asset.name, asset.type,
                        asset_group_asset.field_type,
                        asset_group_asset.status
                    FROM asset_group_asset
                    WHERE asset_group_asset.status = 'ENABLED'
                `),
                // Asset details: text
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT asset.id, asset.text_asset.text
                    FROM asset WHERE asset.type = 'TEXT'
                `),
                // Asset details: images
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT
                        asset.id, asset.name,
                        asset.image_asset.full_size.url,
                        asset.image_asset.full_size.width_pixels,
                        asset.image_asset.full_size.height_pixels
                    FROM asset WHERE asset.type = 'IMAGE'
                `),
                // Shared negative keyword lists
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT shared_set.id, shared_set.name, shared_set.member_count
                    FROM shared_set
                    WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
                        AND shared_set.status = 'ENABLED'
                `),
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT shared_set.id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
                    FROM shared_criterion
                    WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
                `),
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT campaign.id, campaign.name, shared_set.id
                    FROM campaign_shared_set
                    WHERE campaign_shared_set.status = 'ENABLED'
                `),
                // Account-level negative keywords
                fetchQuery(CUSTOMER_ID, headers, `
                    SELECT customer_negative_criterion.id,
                           customer_negative_criterion.keyword.text,
                           customer_negative_criterion.keyword.match_type
                    FROM customer_negative_criterion
                    WHERE customer_negative_criterion.type = 'KEYWORD'
                `),
            ]);
            if (adsData.error) return res.status(500).json({ error: 'Historical ads query failed', details: adsData.error, query: adsData.query });

            const response = buildHistoricalResponse(adsData.results || [], year);

            // Attach PMax campaigns that ran during this period
            if (!pmaxCampaigns.error) {
                const pmaxCampIds = new Set();
                for (const row of (pmaxCampaigns.results || [])) {
                    if (row.campaign?.id) pmaxCampIds.add(row.campaign.id);
                }
                if (pmaxCampIds.size > 0) {
                    const histAssetDetails = new Map();
                    for (const result of [histTextAssets, histImageAssets]) {
                        if (result.results) {
                            for (const row of result.results) {
                                if (row.asset) histAssetDetails.set(row.asset.id, row.asset);
                            }
                        }
                    }
                    attachPMax(response, pmaxCampIds,
                        assetGroupsData.error ? [] : (assetGroupsData.results || []),
                        assetGroupAssetsData.error ? [] : (assetGroupAssetsData.results || []),
                        histAssetDetails);
                }
            }

            attachKeywords(response, keywordsData.error ? [] : (keywordsData.results || []));
            attachNegatives(response, agNegData.error ? [] : (agNegData.results || []), campNegData.error ? [] : (campNegData.results || []));
            attachSharedNegatives(response,
                sharedSetsH.error ? [] : (sharedSetsH.results || []),
                sharedCriteriaH.error ? [] : (sharedCriteriaH.results || []),
                campaignSharedSetsH.error ? [] : (campaignSharedSetsH.results || []),
                accountNegsH.error ? [] : (accountNegsH.results || [])
            );

            return res.status(200).json(response);
        }

        // Query 1: Active ads (current mode - no year parameter)
        const adsData = await fetchQuery(CUSTOMER_ID, headers, `
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
                AND ad_group_ad.status = 'ENABLED'
        `);
        if (adsData.error) return res.status(500).json({ error: 'Ads query failed', details: adsData.error, query: adsData.query });

        // Query 2: Campaign-level asset links (minimal fields)
        const campaignAssetLinks = await fetchQuery(CUSTOMER_ID, headers, `
            SELECT
                asset.id, asset.name, asset.type,
                campaign.id, campaign.status,
                campaign_asset.field_type,
                campaign_asset.status
            FROM campaign_asset
            WHERE campaign_asset.status != 'REMOVED'
                AND campaign.status = 'ENABLED'
        `);
        if (campaignAssetLinks.error) return res.status(500).json({ error: 'Campaign assets query failed', details: campaignAssetLinks.error, query: campaignAssetLinks.query });

        // Query 3: Customer-level asset links (minimal fields)
        const customerAssetLinks = await fetchQuery(CUSTOMER_ID, headers, `
            SELECT
                asset.id, asset.name, asset.type,
                customer_asset.field_type,
                customer_asset.status
            FROM customer_asset
            WHERE customer_asset.status != 'REMOVED'
        `);
        if (customerAssetLinks.error) return res.status(500).json({ error: 'Customer assets query failed', details: customerAssetLinks.error, query: customerAssetLinks.query });

        // Query 4: PMax asset groups
        const assetGroupsData = await fetchQuery(CUSTOMER_ID, headers, `
            SELECT
                campaign.id, campaign.name, campaign.status,
                asset_group.id, asset_group.name, asset_group.status
            FROM asset_group
            WHERE campaign.status = 'ENABLED'
                AND asset_group.status = 'ENABLED'
        `);

        // Query 5: PMax asset group → asset links
        const assetGroupAssetsData = await fetchQuery(CUSTOMER_ID, headers, `
            SELECT
                campaign.id, campaign.status,
                asset_group.id, asset_group.status,
                asset.id, asset.name, asset.type,
                asset_group_asset.field_type,
                asset_group_asset.status
            FROM asset_group_asset
            WHERE campaign.status = 'ENABLED'
                AND asset_group.status = 'ENABLED'
                AND asset_group_asset.status = 'ENABLED'
        `);

        // Query 6: Fetch full asset details per type + keywords + negatives
        let assetDetails = new Map();
        const [sitelinks, callouts, snippets, images, textAssets, activeKeywords, activeAgNegs, activeCampNegs, sharedSets, sharedCriteria, campaignSharedSets, accountNegs] = await Promise.all([
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id,
                    asset.sitelink_asset.description1,
                    asset.sitelink_asset.description2,
                    asset.sitelink_asset.link_text
                FROM asset
                WHERE asset.type = 'SITELINK'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id,
                    asset.callout_asset.callout_text
                FROM asset
                WHERE asset.type = 'CALLOUT'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id,
                    asset.structured_snippet_asset.header,
                    asset.structured_snippet_asset.values
                FROM asset
                WHERE asset.type = 'STRUCTURED_SNIPPET'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id, asset.name,
                    asset.image_asset.full_size.url,
                    asset.image_asset.full_size.width_pixels,
                    asset.image_asset.full_size.height_pixels
                FROM asset
                WHERE asset.type = 'IMAGE'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    asset.id,
                    asset.text_asset.text
                FROM asset
                WHERE asset.type = 'TEXT'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    campaign.id,
                    ad_group.id,
                    ad_group_criterion.keyword.text,
                    ad_group_criterion.keyword.match_type
                FROM ad_group_criterion
                WHERE campaign.status = 'ENABLED'
                    AND ad_group.status = 'ENABLED'
                    AND ad_group_criterion.type = 'KEYWORD'
                    AND ad_group_criterion.negative = false
                    AND ad_group_criterion.status != 'REMOVED'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    campaign.id,
                    ad_group.id,
                    ad_group_criterion.keyword.text,
                    ad_group_criterion.keyword.match_type
                FROM ad_group_criterion
                WHERE ad_group_criterion.type = 'KEYWORD'
                    AND ad_group_criterion.negative = true
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT
                    campaign.id,
                    campaign_criterion.keyword.text,
                    campaign_criterion.keyword.match_type
                FROM campaign_criterion
                WHERE campaign_criterion.type = 'KEYWORD'
                    AND campaign_criterion.negative = true
            `),
            // Shared negative keyword lists
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT shared_set.id, shared_set.name, shared_set.member_count
                FROM shared_set
                WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
                    AND shared_set.status = 'ENABLED'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT shared_set.id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
                FROM shared_criterion
                WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
            `),
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT campaign.id, campaign.name, shared_set.id
                FROM campaign_shared_set
                WHERE campaign_shared_set.status = 'ENABLED'
            `),
            // Account-level negative keywords
            fetchQuery(CUSTOMER_ID, headers, `
                SELECT customer_negative_criterion.id,
                       customer_negative_criterion.keyword.text,
                       customer_negative_criterion.keyword.match_type
                FROM customer_negative_criterion
                WHERE customer_negative_criterion.type = 'KEYWORD'
            `),
        ]);

        // Build lookup map from asset details
        for (const result of [sitelinks, callouts, snippets, images, textAssets]) {
            if (result.results) {
                for (const row of result.results) {
                    if (row.asset) assetDetails.set(row.asset.id, row.asset);
                }
            }
        }

        // Build structured response
        const response = buildResponse(
            adsData.results || [],
            campaignAssetLinks.results || [],
            customerAssetLinks.results || [],
            assetDetails,
            assetGroupsData.results || [],
            assetGroupAssetsData.results || []
        );

        attachKeywords(response, activeKeywords.error ? [] : (activeKeywords.results || []));
        attachNegatives(response, activeAgNegs.error ? [] : (activeAgNegs.results || []), activeCampNegs.error ? [] : (activeCampNegs.results || []));
        attachSharedNegatives(response,
            sharedSets.error ? [] : (sharedSets.results || []),
            sharedCriteria.error ? [] : (sharedCriteria.results || []),
            campaignSharedSets.error ? [] : (campaignSharedSets.results || []),
            accountNegs.error ? [] : (accountNegs.results || [])
        );

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
            // Include full error details for debugging
            const details = data.error.details
                ? data.error.details.map(d => JSON.stringify(d)).join('; ')
                : '';
            const msg = `${data.error.message || 'Unknown error'}${details ? ' | ' + details : ''} [status: ${data.error.status || data.error.code}]`;
            return { error: msg, query: query.trim() };
        }
        return { results: data.results || [] };
    } catch (e) {
        return { error: e.message, query: query.trim() };
    }
}

function buildResponse(adsRows, campaignAssetRows, customerAssetRows, assetDetails, assetGroupRows, assetGroupAssetRows) {
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
                type: 'SEARCH',
                adGroups: new Map(),
                assetGroups: [],
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

    // Build PMax asset groups
    const assetGroupMap = new Map(); // assetGroupId → { ... }
    for (const row of assetGroupRows) {
        const campaign = row.campaign || {};
        const ag = row.assetGroup || {};
        const campId = campaign.id;

        if (!campaignMap.has(campId)) {
            campaignMap.set(campId, {
                id: campId,
                name: campaign.name,
                status: campaign.status,
                type: 'PERFORMANCE_MAX',
                adGroups: new Map(),
                assetGroups: [],
                assets: [],
            });
        } else {
            campaignMap.get(campId).type = 'PERFORMANCE_MAX';
        }

        const agObj = {
            id: ag.id,
            name: ag.name,
            status: ag.status,
            headlines: [],
            longHeadlines: [],
            descriptions: [],
            businessName: null,
            images: [],
            logos: [],
            finalUrl: null,
        };
        assetGroupMap.set(ag.id, agObj);
        campaignMap.get(campId).assetGroups.push(agObj);
    }

    // Attach assets to their asset groups
    for (const row of assetGroupAssetRows) {
        const agId = (row.assetGroup || {}).id;
        const asset = row.asset || {};
        const fieldType = (row.assetGroupAsset || {}).fieldType;
        const agObj = assetGroupMap.get(agId);
        if (!agObj) continue;

        // Merge in detailed asset info
        const details = assetDetails.get(asset.id) || {};
        const merged = { ...asset, ...details };

        const textVal = (merged.textAsset || {}).text || merged.name || '';
        const imgInfo = formatAsset(merged, { fieldType });

        switch (fieldType) {
            case 'HEADLINE':
                agObj.headlines.push({ text: textVal }); break;
            case 'LONG_HEADLINE':
                agObj.longHeadlines.push({ text: textVal }); break;
            case 'DESCRIPTION':
                agObj.descriptions.push({ text: textVal }); break;
            case 'BUSINESS_NAME':
                agObj.businessName = textVal; break;
            case 'MARKETING_IMAGE':
            case 'SQUARE_MARKETING_IMAGE':
                agObj.images.push(imgInfo); break;
            case 'LOGO':
            case 'LANDSCAPE_LOGO':
                agObj.logos.push(imgInfo); break;
            case 'FINAL_URL':
                agObj.finalUrl = textVal; break;
        }
    }

    // Attach campaign-level assets
    for (const row of campaignAssetRows) {
        const asset = row.asset || {};
        const campaignAsset = row.campaignAsset || {};
        const campaign = row.campaign || {};
        const campId = campaign.id;
        // Merge in full asset details from separate queries
        const details = assetDetails.get(asset.id) || {};
        const mergedAsset = { ...asset, ...details };

        if (campId && campaignMap.has(campId)) {
            campaignMap.get(campId).assets.push(formatAsset(mergedAsset, campaignAsset));
        }
    }

    // Format customer-level assets
    const accountAssets = customerAssetRows.map(row => {
        const asset = row.asset || {};
        const customerAsset = row.customerAsset || {};
        const details = assetDetails.get(asset.id) || {};
        const mergedAsset = { ...asset, ...details };
        return formatAsset(mergedAsset, customerAsset);
    });

    // Convert maps to arrays
    const campaigns = Array.from(campaignMap.values()).map(c => ({
        ...c,
        adGroups: Array.from(c.adGroups.values()),
        assetGroups: c.assetGroups || [],
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

function buildHistoricalResponse(adsRows, year) {
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
                type: 'SEARCH',
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

        // Skip duplicate ads (can happen with date aggregation)
        if (agObj.ads.find(a => a.id === ad.id)) continue;

        let headlines = [];
        let descriptions = [];

        if (ad.type === 'EXPANDED_TEXT_AD') {
            const eta = ad.expandedTextAd || {};
            const parts = [eta.headlinePart1, eta.headlinePart2, eta.headlinePart3].filter(Boolean);
            headlines = parts.map((text, i) => ({ position: i + 1, text, pinnedField: null }));
            const descs = [eta.description, eta.description2].filter(Boolean);
            descriptions = descs.map((text, i) => ({ position: i + 1, text, pinnedField: null }));
        } else {
            const rsa = ad.responsiveSearchAd || {};
            headlines = (rsa.headlines || []).map((h, i) => ({
                position: i + 1,
                text: h.text,
                pinnedField: h.pinnedField || null,
            }));
            descriptions = (rsa.descriptions || []).map((d, i) => ({
                position: i + 1,
                text: d.text,
                pinnedField: d.pinnedField || null,
            }));
        }

        agObj.ads.push({
            id: ad.id,
            type: ad.type,
            name: ad.name || null,
            status: adGroupAd.status,
            headlines,
            descriptions,
            finalUrls: ad.finalUrls || [],
        });
    }

    const campaigns = Array.from(campaignMap.values()).map(c => ({
        ...c,
        adGroups: Array.from(c.adGroups.values()),
    }));
    campaigns.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
        account: { id: '840-838-5870', name: 'Dunham & Jones' },
        campaigns,
        accountAssets: [],
        year,
        historical: true,
        fetchedAt: new Date().toISOString(),
    };
}

function attachKeywords(response, keywordRows) {
    const kwMap = new Map(); // "campId:agId" → Map<lowercaseText, {keyword, matchType}>
    for (const row of keywordRows) {
        const campId = row.campaign?.id;
        const agId = row.adGroup?.id;
        const text = (row.adGroupCriterion?.keyword?.text || '').toLowerCase();
        const matchType = row.adGroupCriterion?.keyword?.matchType || 'BROAD';
        if (!campId || !agId || !text) continue;

        const key = `${campId}:${agId}`;
        if (!kwMap.has(key)) kwMap.set(key, new Map());
        if (!kwMap.get(key).has(text)) {
            kwMap.get(key).set(text, {
                keyword: row.adGroupCriterion.keyword.text,
                matchType,
            });
        }
    }

    for (const camp of response.campaigns) {
        for (const ag of camp.adGroups) {
            const key = `${camp.id}:${ag.id}`;
            const agKws = kwMap.get(key);
            ag.keywords = agKws
                ? Array.from(agKws.values()).sort((a, b) => a.keyword.localeCompare(b.keyword))
                : [];
        }
    }
}

function attachNegatives(response, agNegRows, campNegRows) {
    const campNegMap = new Map();
    for (const row of campNegRows) {
        const campId = row.campaign?.id;
        const text = row.campaignCriterion?.keyword?.text;
        const matchType = row.campaignCriterion?.keyword?.matchType || 'BROAD';
        if (!campId || !text) continue;
        if (!campNegMap.has(campId)) campNegMap.set(campId, []);
        campNegMap.get(campId).push({ keyword: text, matchType, level: 'campaign' });
    }

    const agNegMap = new Map();
    for (const row of agNegRows) {
        const campId = row.campaign?.id;
        const agId = row.adGroup?.id;
        const text = row.adGroupCriterion?.keyword?.text;
        const matchType = row.adGroupCriterion?.keyword?.matchType || 'BROAD';
        if (!campId || !agId || !text) continue;
        const key = `${campId}:${agId}`;
        if (!agNegMap.has(key)) agNegMap.set(key, []);
        agNegMap.get(key).push({ keyword: text, matchType, level: 'ad_group' });
    }

    for (const camp of response.campaigns) {
        const campNegs = campNegMap.get(camp.id) || [];
        for (const ag of camp.adGroups) {
            const key = `${camp.id}:${ag.id}`;
            const agNegs = agNegMap.get(key) || [];
            ag.negativeKeywords = [...agNegs, ...campNegs].sort((a, b) => a.keyword.localeCompare(b.keyword));
        }
    }
}

function attachSharedNegatives(response, sharedSetRows, sharedCriteriaRows, campaignSharedSetRows, accountNegRows) {
    // Account-level negatives
    response.accountNegativeKeywords = accountNegRows
        .filter(row => row.customerNegativeCriterion?.keyword?.text)
        .map(row => ({
            keyword: row.customerNegativeCriterion.keyword.text,
            matchType: row.customerNegativeCriterion.keyword.matchType || 'BROAD',
        }))
        .sort((a, b) => a.keyword.localeCompare(b.keyword));

    // Build shared set info
    const listMap = new Map();
    for (const row of sharedSetRows) {
        const ss = row.sharedSet || {};
        if (ss.id) {
            listMap.set(ss.id, {
                id: ss.id,
                name: ss.name,
                memberCount: ss.memberCount || 0,
                keywords: [],
                campaigns: [],
            });
        }
    }

    // Attach keywords to their lists
    for (const row of sharedCriteriaRows) {
        const ssId = row.sharedSet?.id;
        const text = row.sharedCriterion?.keyword?.text;
        const matchType = row.sharedCriterion?.keyword?.matchType || 'BROAD';
        if (ssId && text && listMap.has(ssId)) {
            listMap.get(ssId).keywords.push({ keyword: text, matchType });
        }
    }

    // Attach campaign associations
    for (const row of campaignSharedSetRows) {
        const ssId = row.sharedSet?.id;
        const campName = row.campaign?.name;
        if (ssId && campName && listMap.has(ssId)) {
            listMap.get(ssId).campaigns.push(campName);
        }
    }

    // Sort keywords and campaigns within each list
    for (const list of listMap.values()) {
        list.keywords.sort((a, b) => a.keyword.localeCompare(b.keyword));
        list.campaigns.sort();
    }

    response.negativeKeywordLists = Array.from(listMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function attachPMax(response, pmaxCampIds, assetGroupRows, assetGroupAssetRows, assetDetails) {
    // Build asset groups, filtered to campaigns that ran in the period
    const assetGroupMap = new Map();
    const campMap = new Map();
    const campAssetGroups = new Map();

    for (const row of assetGroupRows) {
        const campaign = row.campaign || {};
        const ag = row.assetGroup || {};
        const campId = campaign.id;
        if (!pmaxCampIds.has(campId)) continue;

        if (!campMap.has(campId)) {
            campMap.set(campId, { id: campId, name: campaign.name, status: campaign.status });
        }

        const agObj = {
            id: ag.id, name: ag.name, status: ag.status,
            headlines: [], longHeadlines: [], descriptions: [],
            businessName: null, images: [], logos: [], finalUrl: null,
        };
        assetGroupMap.set(ag.id, agObj);
        if (!campAssetGroups.has(campId)) campAssetGroups.set(campId, []);
        campAssetGroups.get(campId).push(agObj);
    }

    // Attach assets to their asset groups
    for (const row of assetGroupAssetRows) {
        const agId = (row.assetGroup || {}).id;
        const agObj = assetGroupMap.get(agId);
        if (!agObj) continue;

        const asset = row.asset || {};
        const fieldType = (row.assetGroupAsset || {}).fieldType;
        const details = assetDetails.get(asset.id) || {};
        const merged = { ...asset, ...details };
        const textVal = (merged.textAsset || {}).text || merged.name || '';

        switch (fieldType) {
            case 'HEADLINE': agObj.headlines.push({ text: textVal }); break;
            case 'LONG_HEADLINE': agObj.longHeadlines.push({ text: textVal }); break;
            case 'DESCRIPTION': agObj.descriptions.push({ text: textVal }); break;
            case 'BUSINESS_NAME': agObj.businessName = textVal; break;
            case 'MARKETING_IMAGE':
            case 'SQUARE_MARKETING_IMAGE': {
                const img = merged.imageAsset || {};
                const fs = img.fullSize || {};
                agObj.images.push({ id: asset.id, type: 'IMAGE', name: asset.name || null, imageUrl: fs.url || null, width: fs.widthPixels, height: fs.heightPixels });
                break;
            }
            case 'LOGO':
            case 'LANDSCAPE_LOGO': {
                const img = merged.imageAsset || {};
                const fs = img.fullSize || {};
                agObj.logos.push({ id: asset.id, type: 'IMAGE', name: asset.name || null, imageUrl: fs.url || null, width: fs.widthPixels, height: fs.heightPixels });
                break;
            }
            case 'FINAL_URL': agObj.finalUrl = textVal; break;
        }
    }

    // Add PMax campaigns to response
    const existingCampIds = new Set(response.campaigns.map(c => c.id));
    for (const [campId, assetGroups] of campAssetGroups) {
        if (existingCampIds.has(campId)) {
            const camp = response.campaigns.find(c => c.id === campId);
            camp.assetGroups = assetGroups;
            camp.type = 'PERFORMANCE_MAX';
        } else {
            const info = campMap.get(campId);
            response.campaigns.push({
                id: campId, name: info.name, status: info.status,
                type: 'PERFORMANCE_MAX', adGroups: [], assetGroups, assets: [],
            });
        }
    }
    response.campaigns.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
        return { ...base, linkText: sl.linkText, desc1: sl.description1, desc2: sl.description2 };
    }
    if (type === 'CALLOUT') {
        const co = asset.calloutAsset || {};
        return { ...base, text: co.calloutText };
    }
    if (type === 'STRUCTURED_SNIPPET') {
        const ss = asset.structuredSnippetAsset || {};
        return { ...base, header: ss.header, values: ss.values || [] };
    }
    if (type === 'IMAGE') {
        const img = asset.imageAsset || {};
        const fullSize = img.fullSize || {};
        return { ...base, imageUrl: fullSize.url || null, width: fullSize.widthPixels, height: fullSize.heightPixels };
    }
    return base;
}

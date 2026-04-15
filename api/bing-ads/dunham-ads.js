/**
 * Microsoft Advertising — Dunham & Jones Ad Copy Audit
 * GET /api/bing-ads/dunham-ads
 *
 * Fetches ad copy from Microsoft Advertising account C449285895.
 * Returns data in the same format as the Google Ads endpoint so the
 * dashboard can reuse the same rendering logic.
 *
 * Query params:
 *   ?year=2024      — historical mode (ads that ran during that year)
 *   ?refresh=true   — bypass any caching
 */

import { createClient } from '@supabase/supabase-js';
import { inflateRawSync } from 'zlib';

const ACCOUNT_NUMBER = 'C449285895';

const CM_BASE = 'https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc/v13';
const CUST_BASE = 'https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc/v13';
const REPORT_BASE = 'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc/v13';

// ─── Status / Type Mapping (Bing → Google format) ───

function mapStatus(s) {
    if (!s) return 'UNKNOWN';
    switch (s) {
        case 'Active': return 'ENABLED';
        case 'Paused': case 'BudgetPaused': case 'Suspended': return 'PAUSED';
        case 'Deleted': return 'REMOVED';
        default: return s.toUpperCase();
    }
}

function mapCampaignType(t) {
    if (!t) return 'SEARCH';
    switch (t) {
        case 'Search': case 'DynamicSearchAds': return 'SEARCH';
        case 'Shopping': return 'SHOPPING';
        case 'Audience': return 'DISPLAY';
        case 'PerformanceMax': return 'PERFORMANCE_MAX';
        default: return t.toUpperCase();
    }
}

function mapAdType(t) {
    if (!t) return 'UNKNOWN';
    switch (t) {
        case 'ResponsiveSearch': return 'RESPONSIVE_SEARCH_AD';
        case 'ExpandedText': return 'EXPANDED_TEXT_AD';
        case 'DynamicSearch': return 'DYNAMIC_SEARCH_AD';
        case 'ResponsiveAd': return 'RESPONSIVE_DISPLAY_AD';
        default: return t.toUpperCase();
    }
}

function mapMatchType(t) {
    if (!t) return 'BROAD';
    return t.toUpperCase(); // Broad→BROAD, Exact→EXACT, Phrase→PHRASE
}

function mapPinnedField(field, prefix) {
    if (!field || field === 'None') return null;
    // Bing: "Headline1" → "HEADLINE_1", "Description2" → "DESCRIPTION_2"
    const match = field.match(/(Headline|Description)(\d+)/);
    if (match) return `${match[1].toUpperCase()}_${match[2]}`;
    return null;
}

// ─── API Helpers ───

async function bingCM(operation, body, token, devToken, customerId, accountId) {
    const headers = {
        'Content-Type': 'application/json',
        'AuthenticationToken': token,
        'DeveloperToken': devToken,
    };
    if (customerId) headers['CustomerId'] = String(customerId);
    if (accountId) headers['AccountId'] = String(accountId);

    const resp = await fetch(`${CM_BASE}/${operation}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`Bing CM ${operation}: ${resp.status} — ${text.substring(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`Bing CM ${operation}: invalid JSON — ${text.substring(0, 500)}`);
    }
}

async function bingReport(operation, body, token, devToken, customerId, accountId) {
    const headers = {
        'Content-Type': 'application/json',
        'AuthenticationToken': token,
        'DeveloperToken': devToken,
    };
    if (customerId) headers['CustomerId'] = String(customerId);
    if (accountId) headers['AccountId'] = String(accountId);

    const resp = await fetch(`${REPORT_BASE}/${operation}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`Bing Report ${operation}: ${resp.status} — ${text.substring(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`Bing Report ${operation}: invalid JSON — ${text.substring(0, 500)}`);
    }
}

// ─── ZIP extraction (for report downloads, no external deps) ───

function extractCsvFromZip(buffer) {
    // ZIP local file header starts with PK\x03\x04
    if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
        // Not a ZIP — maybe raw CSV
        return buffer.toString('utf-8');
    }

    const compressionMethod = buffer.readUInt16LE(8);
    const compressedSize = buffer.readUInt32LE(18);
    const filenameLength = buffer.readUInt16LE(26);
    const extraFieldLength = buffer.readUInt16LE(28);
    const dataOffset = 30 + filenameLength + extraFieldLength;
    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
        return compressedData.toString('utf-8');
    } else if (compressionMethod === 8) {
        return inflateRawSync(compressedData).toString('utf-8');
    }
    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

// ─── Transform Bing RSA ad → Google-compatible format ───

function transformAd(ad) {
    const type = mapAdType(ad.Type);
    const result = {
        type,
        status: mapStatus(ad.Status),
        name: ad.Name || null,
        finalUrls: ad.FinalUrls || [],
        headlines: [],
        descriptions: [],
    };

    if (type === 'RESPONSIVE_SEARCH_AD') {
        // RSA headlines: [{Asset: {Text: "..."}, PinnedField: "Headline1"}]
        if (ad.Headlines) {
            result.headlines = ad.Headlines.map((h, i) => ({
                text: h.Asset?.Text || h.Text || '',
                position: i + 1,
                pinnedField: mapPinnedField(h.PinnedField),
            }));
        }
        if (ad.Descriptions) {
            result.descriptions = ad.Descriptions.map((d, i) => ({
                text: d.Asset?.Text || d.Text || '',
                position: i + 1,
                pinnedField: mapPinnedField(d.PinnedField),
            }));
        }
        if (ad.Path1) result.path1 = ad.Path1;
        if (ad.Path2) result.path2 = ad.Path2;

    } else if (type === 'EXPANDED_TEXT_AD') {
        // ETA: TitlePart1, TitlePart2, TitlePart3, Text, TextPart2
        const parts = [ad.TitlePart1, ad.TitlePart2, ad.TitlePart3].filter(Boolean);
        result.headlines = parts.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
        const descs = [ad.Text, ad.TextPart2].filter(Boolean);
        result.descriptions = descs.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
        if (ad.Path1) result.path1 = ad.Path1;
        if (ad.Path2) result.path2 = ad.Path2;

    } else if (type === 'RESPONSIVE_DISPLAY_AD') {
        if (ad.Headlines) {
            result.headlines = ad.Headlines.map((h, i) => ({
                text: h.Asset?.Text || h.Text || '',
                position: i + 1,
                pinnedField: null,
            }));
        }
        if (ad.LongHeadline) {
            result.longHeadline = ad.LongHeadline.Asset?.Text || ad.LongHeadline.Text || ad.LongHeadline;
        }
        if (ad.Descriptions) {
            result.descriptions = ad.Descriptions.map((d, i) => ({
                text: d.Asset?.Text || d.Text || '',
                position: i + 1,
                pinnedField: null,
            }));
        }
        if (ad.BusinessName) result.businessName = ad.BusinessName;

    } else if (type === 'DYNAMIC_SEARCH_AD') {
        // DSAs only have descriptions (headlines are auto-generated)
        const descs = [ad.Text, ad.TextPart2].filter(Boolean);
        result.descriptions = descs.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
    }

    return result;
}

function transformKeyword(kw) {
    return {
        keyword: kw.Text || kw.text || '',
        matchType: mapMatchType(kw.MatchType || kw.matchType),
    };
}

function transformExtension(ext) {
    if (!ext) return null;
    const type = ext.Type || '';

    if (type.includes('Sitelink') || type === 'SitelinkAdExtension') {
        return {
            type: 'SITELINK',
            linkText: ext.DisplayText || ext.SitelinkText || '',
            desc1: ext.Description1 || '',
            desc2: ext.Description2 || '',
            name: ext.DisplayText || ext.SitelinkText || '',
            finalUrls: ext.FinalUrls || [],
        };
    }
    if (type.includes('Callout') || type === 'CalloutAdExtension') {
        return {
            type: 'CALLOUT',
            text: ext.Text || '',
            name: ext.Text || '',
        };
    }
    if (type.includes('StructuredSnippet') || type === 'StructuredSnippetAdExtension') {
        return {
            type: 'STRUCTURED_SNIPPET',
            header: ext.Header || '',
            values: ext.Values || [],
            name: ext.Header || '',
        };
    }
    if (type.includes('Image') || type === 'ImageAdExtension') {
        return {
            type: 'IMAGE',
            name: ext.DisplayText || ext.AlternativeText || 'Image',
            imageUrl: null,
        };
    }

    return {
        type: type.replace(/AdExtension$/i, '').toUpperCase(),
        name: ext.DisplayText || ext.Text || type,
        text: ext.Text || '',
    };
}

// ─── Fetch: Active Ads ───

async function fetchActiveData(token, devToken, customerId, accountId) {
    // 1. Get campaigns
    const campResult = await bingCM('GetCampaignsByAccountId', {
        AccountId: accountId,
        CampaignType: 'Search Shopping Audience DynamicSearchAds PerformanceMax',
    }, token, devToken, customerId, accountId);

    const campaigns = (campResult.Campaigns || [])
        .filter(c => c.Status === 'Active' || c.Status === 'Paused');

    if (campaigns.length === 0) {
        return { campaigns: [], accountAssets: [] };
    }

    // 2. Get ad groups for all campaigns in parallel
    const agResults = await Promise.all(
        campaigns.map(c =>
            bingCM('GetAdGroupsByCampaignId', {
                CampaignId: c.Id,
            }, token, devToken, customerId, accountId)
                .then(r => ({ campaignId: c.Id, adGroups: r.AdGroups || [] }))
                .catch(() => ({ campaignId: c.Id, adGroups: [] }))
        )
    );

    const agMap = {};
    for (const r of agResults) {
        agMap[r.campaignId] = r.adGroups.filter(ag =>
            ag.Status === 'Active' || ag.Status === 'Paused'
        );
    }

    // 3. Flatten all ad groups, fetch ads + keywords in parallel
    const allAgs = [];
    for (const camp of campaigns) {
        for (const ag of (agMap[camp.Id] || [])) {
            allAgs.push({ ...ag, _campaignId: camp.Id });
        }
    }

    const detailResults = await Promise.all(
        allAgs.map(ag =>
            Promise.all([
                bingCM('GetAdsByAdGroupId', {
                    AdGroupId: ag.Id,
                    AdTypes: ['ResponsiveSearch', 'ExpandedText', 'DynamicSearch', 'ResponsiveAd'],
                }, token, devToken, customerId, accountId)
                    .then(r => r.Ads || [])
                    .catch(() => []),

                bingCM('GetKeywordsByAdGroupId', {
                    AdGroupId: ag.Id,
                }, token, devToken, customerId, accountId)
                    .then(r => r.Keywords || [])
                    .catch(() => []),
            ]).then(([ads, keywords]) => ({
                adGroupId: ag.Id,
                campaignId: ag._campaignId,
                name: ag.Name,
                ads: ads.filter(a => a.Status === 'Active' || a.Status === 'Paused')
                    .map(transformAd),
                keywords: keywords.filter(k => k.Status === 'Active' || k.Status === 'Paused')
                    .map(transformKeyword),
                negativeKeywords: [],
            }))
        )
    );

    // 4. Fetch negative keywords (ad-group and campaign level)
    const negKwResults = await Promise.all([
        // Ad group level negatives
        ...allAgs.map(ag =>
            bingCM('GetNegativeKeywordsByEntityIds', {
                EntityIds: [ag.Id],
                EntityType: 'AdGroup',
                ParentEntityId: ag._campaignId,
            }, token, devToken, customerId, accountId)
                .then(r => ({
                    level: 'adgroup',
                    entityId: ag.Id,
                    keywords: extractNegativeKeywords(r),
                }))
                .catch(() => ({ level: 'adgroup', entityId: ag.Id, keywords: [] }))
        ),
        // Campaign level negatives
        ...campaigns.map(c =>
            bingCM('GetNegativeKeywordsByEntityIds', {
                EntityIds: [c.Id],
                EntityType: 'Campaign',
                ParentEntityId: accountId,
            }, token, devToken, customerId, accountId)
                .then(r => ({
                    level: 'campaign',
                    entityId: c.Id,
                    keywords: extractNegativeKeywords(r),
                }))
                .catch(() => ({ level: 'campaign', entityId: c.Id, keywords: [] }))
        ),
    ]);

    // Index negative keywords
    const agNegMap = {};
    const campNegMap = {};
    for (const nr of negKwResults) {
        if (nr.level === 'adgroup') {
            agNegMap[nr.entityId] = nr.keywords;
        } else {
            campNegMap[nr.entityId] = nr.keywords;
        }
    }

    // Attach neg keywords to ad groups
    for (const detail of detailResults) {
        detail.negativeKeywords = agNegMap[detail.adGroupId] || [];
        // Also include campaign-level negatives on the first ad group
        const campNegs = campNegMap[detail.campaignId];
        if (campNegs && campNegs.length > 0) {
            const alreadyIncluded = detailResults.find(
                d => d.campaignId === detail.campaignId && d.negativeKeywords.some(n => n.level === 'campaign')
            );
            if (!alreadyIncluded) {
                detail.negativeKeywords = detail.negativeKeywords.concat(
                    campNegs.map(k => ({ ...k, level: 'campaign' }))
                );
            }
        }
    }

    // Group by campaign
    const adGroupsByCampaign = {};
    for (const detail of detailResults) {
        if (!adGroupsByCampaign[detail.campaignId]) {
            adGroupsByCampaign[detail.campaignId] = [];
        }
        adGroupsByCampaign[detail.campaignId].push({
            name: detail.name,
            ads: detail.ads,
            keywords: detail.keywords,
            negativeKeywords: detail.negativeKeywords,
        });
    }

    // 5. Get extensions
    const accountAssets = await fetchExtensions(token, devToken, customerId, accountId);

    // Get campaign-level extensions
    const campExtResults = await Promise.all(
        campaigns.map(c =>
            fetchCampaignExtensions(c.Id, token, devToken, customerId, accountId)
                .then(exts => ({ campaignId: c.Id, extensions: exts }))
                .catch(() => ({ campaignId: c.Id, extensions: [] }))
        )
    );
    const campExtMap = {};
    for (const r of campExtResults) {
        campExtMap[r.campaignId] = r.extensions;
    }

    // 6. Build shared negative keyword lists
    const negKwLists = await fetchSharedNegativeKeywordLists(token, devToken, customerId, accountId, campaigns);

    // 7. Assemble result
    const result = {
        campaigns: campaigns.map(c => ({
            name: c.Name,
            status: mapStatus(c.Status),
            type: mapCampaignType(c.CampaignType),
            adGroups: adGroupsByCampaign[c.Id] || [],
            assets: campExtMap[c.Id] || [],
        })),
        accountAssets,
        negativeKeywordLists: negKwLists,
    };

    return result;
}

// ─── Fetch: Historical Ads (via Reporting API) ───

async function fetchHistoricalData(token, devToken, customerId, accountId, year) {
    // Submit a report to find which ads had impressions during the year
    const startDate = { Day: 1, Month: 1, Year: year };
    const endDate = { Day: 31, Month: 12, Year: year };

    let reportAdIds = null; // Set of ad IDs with impressions

    try {
        const submitResult = await bingReport('SubmitGenerateReport', {
            ReportRequest: {
                __type: 'AdPerformanceReportRequest',
                Format: 'Csv',
                ReportName: `DunhamAds_${year}`,
                ReturnOnlyCompleteData: false,
                ExcludeReportHeader: true,
                ExcludeReportFooter: true,
                Columns: ['CampaignId', 'AdGroupId', 'AdId', 'Impressions'],
                Scope: { AccountIds: [accountId] },
                Time: {
                    CustomDateRangeStart: startDate,
                    CustomDateRangeEnd: endDate,
                },
                Aggregation: 'Summary',
            },
        }, token, devToken, customerId, accountId);

        const requestId = submitResult.ReportRequestId;
        if (requestId) {
            // Poll for completion (max 40s)
            const downloadUrl = await pollReport(requestId, token, devToken, customerId, accountId);
            if (downloadUrl) {
                reportAdIds = await downloadAndParseReport(downloadUrl);
            }
        }
    } catch (e) {
        console.error('Report generation failed:', e.message);
        // Fall through — fetch all ads without filtering
    }

    // Fetch all campaigns (including paused/deleted)
    const campResult = await bingCM('GetCampaignsByAccountId', {
        AccountId: accountId,
        CampaignType: 'Search Shopping Audience DynamicSearchAds PerformanceMax',
    }, token, devToken, customerId, accountId);

    let campaigns = campResult.Campaigns || [];

    // If we have report data, filter to only campaigns that had impressions
    const reportCampaignIds = reportAdIds
        ? new Set([...reportAdIds.values()].map(v => v.campaignId))
        : null;

    if (reportCampaignIds) {
        campaigns = campaigns.filter(c => reportCampaignIds.has(String(c.Id)));
    }

    if (campaigns.length === 0) {
        return { campaigns: [], accountAssets: [] };
    }

    // Get ad groups
    const agResults = await Promise.all(
        campaigns.map(c =>
            bingCM('GetAdGroupsByCampaignId', {
                CampaignId: c.Id,
            }, token, devToken, customerId, accountId)
                .then(r => ({ campaignId: c.Id, adGroups: r.AdGroups || [] }))
                .catch(() => ({ campaignId: c.Id, adGroups: [] }))
        )
    );

    // Filter ad groups if we have report data
    const reportAdGroupIds = reportAdIds
        ? new Set([...reportAdIds.values()].map(v => v.adGroupId))
        : null;

    const agMap = {};
    for (const r of agResults) {
        let ags = r.adGroups;
        if (reportAdGroupIds) {
            ags = ags.filter(ag => reportAdGroupIds.has(String(ag.Id)));
        }
        agMap[r.campaignId] = ags;
    }

    // Flatten and fetch ads + keywords
    const allAgs = [];
    for (const camp of campaigns) {
        for (const ag of (agMap[camp.Id] || [])) {
            allAgs.push({ ...ag, _campaignId: camp.Id });
        }
    }

    const detailResults = await Promise.all(
        allAgs.map(ag =>
            Promise.all([
                bingCM('GetAdsByAdGroupId', {
                    AdGroupId: ag.Id,
                    AdTypes: ['ResponsiveSearch', 'ExpandedText', 'DynamicSearch', 'ResponsiveAd'],
                }, token, devToken, customerId, accountId)
                    .then(r => r.Ads || [])
                    .catch(() => []),

                bingCM('GetKeywordsByAdGroupId', {
                    AdGroupId: ag.Id,
                }, token, devToken, customerId, accountId)
                    .then(r => r.Keywords || [])
                    .catch(() => []),
            ]).then(([ads, keywords]) => {
                // Filter ads by report data if available
                let filteredAds = ads;
                if (reportAdIds) {
                    filteredAds = ads.filter(a => reportAdIds.has(String(a.Id)));
                }

                return {
                    adGroupId: ag.Id,
                    campaignId: ag._campaignId,
                    name: ag.Name,
                    ads: filteredAds.map(transformAd),
                    keywords: keywords.map(transformKeyword),
                    negativeKeywords: [],
                };
            })
        )
    );

    // Group by campaign
    const adGroupsByCampaign = {};
    for (const detail of detailResults) {
        if (detail.ads.length === 0 && detail.keywords.length === 0) continue;
        if (!adGroupsByCampaign[detail.campaignId]) {
            adGroupsByCampaign[detail.campaignId] = [];
        }
        adGroupsByCampaign[detail.campaignId].push({
            name: detail.name,
            ads: detail.ads,
            keywords: detail.keywords,
            negativeKeywords: detail.negativeKeywords,
        });
    }

    // Get extensions
    const accountAssets = await fetchExtensions(token, devToken, customerId, accountId);

    return {
        campaigns: campaigns
            .filter(c => adGroupsByCampaign[c.Id] && adGroupsByCampaign[c.Id].length > 0)
            .map(c => ({
                name: c.Name,
                status: mapStatus(c.Status),
                type: mapCampaignType(c.CampaignType),
                adGroups: adGroupsByCampaign[c.Id] || [],
                assets: [],
            })),
        accountAssets,
        negativeKeywordLists: [],
    };
}

// ─── Report Polling ───

async function pollReport(requestId, token, devToken, customerId, accountId) {
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
        const result = await bingReport('PollGenerateReport', {
            ReportRequestId: requestId,
        }, token, devToken, customerId, accountId);

        const status = result.ReportRequestStatus?.Status;
        if (status === 'Success') {
            return result.ReportRequestStatus.ReportDownloadUrl;
        }
        if (status === 'Error') {
            throw new Error('Report generation failed');
        }

        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('Report polling timed out');
}

async function downloadAndParseReport(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Report download failed: ${resp.status}`);

    const buffer = Buffer.from(await resp.arrayBuffer());
    const csv = extractCsvFromZip(buffer);

    // Parse CSV — find column indices and extract ad IDs
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length === 0) return new Map();

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const campaignIdIdx = headers.indexOf('CampaignId');
    const adGroupIdIdx = headers.indexOf('AdGroupId');
    const adIdIdx = headers.indexOf('AdId');
    const impressionsIdx = headers.indexOf('Impressions');

    const adIds = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const adId = cols[adIdIdx];
        const impressions = parseInt(cols[impressionsIdx]) || 0;
        if (adId && impressions > 0) {
            adIds.set(adId, {
                campaignId: cols[campaignIdIdx],
                adGroupId: cols[adGroupIdIdx],
                impressions,
            });
        }
    }

    return adIds;
}

// ─── Extension Helpers ───

async function fetchExtensions(token, devToken, customerId, accountId) {
    try {
        // Get account-level extension IDs
        const idResult = await bingCM('GetAdExtensionIdsByAccountId', {
            AccountId: accountId,
            AdExtensionType: 'SitelinkAdExtension CalloutAdExtension StructuredSnippetAdExtension ImageAdExtension',
            AssociationType: 'Account',
        }, token, devToken, customerId, accountId);

        const extensionIds = [];
        const collections = idResult.AdExtensionIdCollection || [];
        for (const coll of collections) {
            if (coll.AdExtensionIdCollection) {
                extensionIds.push(...coll.AdExtensionIdCollection);
            }
        }

        if (extensionIds.length === 0) return [];

        // Get full extension details
        const extResult = await bingCM('GetAdExtensionsByIds', {
            AccountId: accountId,
            AdExtensionIds: extensionIds,
            AdExtensionType: 'SitelinkAdExtension CalloutAdExtension StructuredSnippetAdExtension ImageAdExtension',
        }, token, devToken, customerId, accountId);

        return (extResult.AdExtensions || [])
            .map(e => e.AdExtension || e)
            .map(transformExtension)
            .filter(Boolean);

    } catch (e) {
        console.error('fetchExtensions error:', e.message);
        return [];
    }
}

async function fetchCampaignExtensions(campaignId, token, devToken, customerId, accountId) {
    try {
        const idResult = await bingCM('GetAdExtensionIdsByAccountId', {
            AccountId: accountId,
            AdExtensionType: 'SitelinkAdExtension CalloutAdExtension StructuredSnippetAdExtension',
            AssociationType: 'Campaign',
        }, token, devToken, customerId, accountId);

        // Filter to the target campaign
        const collections = idResult.AdExtensionIdCollection || [];
        const extensionIds = [];
        for (const coll of collections) {
            if (String(coll.EntityId) === String(campaignId) && coll.AdExtensionIdCollection) {
                extensionIds.push(...coll.AdExtensionIdCollection);
            }
        }

        if (extensionIds.length === 0) return [];

        const extResult = await bingCM('GetAdExtensionsByIds', {
            AccountId: accountId,
            AdExtensionIds: extensionIds,
            AdExtensionType: 'SitelinkAdExtension CalloutAdExtension StructuredSnippetAdExtension',
        }, token, devToken, customerId, accountId);

        return (extResult.AdExtensions || [])
            .map(e => e.AdExtension || e)
            .map(transformExtension)
            .filter(Boolean);

    } catch (e) {
        return [];
    }
}

// ─── Negative Keyword Helpers ───

function extractNegativeKeywords(result) {
    const lists = result.EntityNegativeKeywords || result.NegativeKeywords || [];
    const keywords = [];
    for (const entity of lists) {
        const nkws = entity.NegativeKeywords || [];
        for (const nk of nkws) {
            keywords.push(transformKeyword(nk));
        }
    }
    return keywords;
}

async function fetchSharedNegativeKeywordLists(token, devToken, customerId, accountId, campaigns) {
    try {
        // Get shared entities (negative keyword lists)
        const sharedResult = await bingCM('GetSharedEntitiesByAccountId', {
            SharedEntityType: 'NegativeKeywordList',
        }, token, devToken, customerId, accountId);

        const sharedEntities = sharedResult.SharedEntities || [];
        if (sharedEntities.length === 0) return [];

        // Get list items and campaign associations in parallel
        const [listItemsResults, assocResults] = await Promise.all([
            Promise.all(sharedEntities.map(se =>
                bingCM('GetListItemsBySharedList', {
                    SharedList: { Id: se.Id, Type: 'NegativeKeywordList' },
                }, token, devToken, customerId, accountId)
                    .then(r => ({ listId: se.Id, items: r.ListItems || [] }))
                    .catch(() => ({ listId: se.Id, items: [] }))
            )),
            Promise.all(sharedEntities.map(se =>
                bingCM('GetSharedEntityAssociationsBySharedEntityIds', {
                    EntityType: 'Campaign',
                    SharedEntityIds: [se.Id],
                    SharedEntityType: 'NegativeKeywordList',
                }, token, devToken, customerId, accountId)
                    .then(r => ({ listId: se.Id, assocs: r.Associations || [] }))
                    .catch(() => ({ listId: se.Id, assocs: [] }))
            )),
        ]);

        const itemsMap = {};
        for (const r of listItemsResults) itemsMap[r.listId] = r.items;

        const assocMap = {};
        for (const r of assocResults) assocMap[r.listId] = r.assocs;

        // Build campaign name lookup
        const campNameMap = {};
        for (const c of campaigns) campNameMap[String(c.Id)] = c.Name;

        return sharedEntities.map(se => ({
            name: se.Name,
            keywords: (itemsMap[se.Id] || []).map(item => ({
                keyword: item.Text || '',
                matchType: mapMatchType(item.MatchType),
            })),
            campaigns: (assocMap[se.Id] || [])
                .map(a => campNameMap[String(a.EntityId)] || String(a.EntityId))
                .filter(Boolean),
        }));

    } catch (e) {
        console.error('fetchSharedNegativeKeywordLists error:', e.message);
        return [];
    }
}

// ─── Token Management ───

async function getConnection(supabase) {
    const { data: connection, error } = await supabase
        .from('bing_ads_connections')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

    if (error || !connection) return null;
    return connection;
}

async function refreshTokenIfNeeded(connection, supabase) {
    if (new Date(connection.token_expires_at) > new Date()) {
        return connection.access_token;
    }

    if (!connection.refresh_token) {
        throw new Error('Token expired and no refresh token available. Please re-authorize.');
    }

    const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.BING_ADS_CLIENT_ID,
            client_secret: process.env.BING_ADS_CLIENT_SECRET,
            refresh_token: connection.refresh_token,
            grant_type: 'refresh_token',
            scope: 'https://ads.microsoft.com/msads.manage offline_access',
        }),
    });

    const data = await resp.json();
    if (data.error) {
        throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
    }

    // Update stored tokens
    await supabase
        .from('bing_ads_connections')
        .update({
            access_token: data.access_token,
            refresh_token: data.refresh_token || connection.refresh_token,
            token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

    return data.access_token;
}

// ─── Main Handler ───

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

        // Get connection
        const connection = await getConnection(supabase);
        if (!connection) {
            return res.status(401).json({
                error: 'Microsoft Advertising not connected',
                needsAuth: true,
                authUrl: '/api/bing-ads/auth',
            });
        }

        // Refresh token if needed
        const accessToken = await refreshTokenIfNeeded(connection, supabase);
        const devToken = process.env.BING_ADS_DEVELOPER_TOKEN;

        if (!devToken) {
            return res.status(500).json({ error: 'BING_ADS_DEVELOPER_TOKEN not configured' });
        }

        const customerId = connection.customer_id;
        const accountId = connection.account_id;

        if (!customerId || !accountId) {
            return res.status(500).json({
                error: 'Account not fully configured. Re-authorize to discover account IDs.',
                needsAuth: true,
                authUrl: '/api/bing-ads/auth',
            });
        }

        // Historical or active mode?
        const year = parseInt(req.query.year);
        const currentYear = new Date().getFullYear();
        const isHistorical = year && year >= 2010 && year <= currentYear;

        let data;
        if (isHistorical) {
            data = await fetchHistoricalData(accessToken, devToken, customerId, accountId, year);
        } else {
            data = await fetchActiveData(accessToken, devToken, customerId, accountId);
        }

        // Wrap in the standard response format
        const response = {
            platform: 'bing',
            fetchedAt: new Date().toISOString(),
            historical: isHistorical,
            year: isHistorical ? year : null,
            account: {
                id: connection.account_number || ACCOUNT_NUMBER,
                name: connection.account_name || 'Dunham & Jones',
            },
            ...data,
        };

        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.status(200).json(response);

    } catch (err) {
        console.error('Bing Ads API error:', err);
        return res.status(500).json({
            error: 'Failed to fetch Bing Ads data',
            details: err.message,
        });
    }
}

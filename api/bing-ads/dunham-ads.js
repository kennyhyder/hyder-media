/**
 * Microsoft Advertising — Dunham & Jones Ad Copy Audit
 * GET /api/bing-ads/dunham-ads
 *
 * Uses SOAP XML for all Bing Ads API calls (REST JSON endpoints are unreliable).
 * Returns data in the same format as the Google Ads endpoint for dashboard reuse.
 *
 * Query params:
 *   ?year=2024  — historical mode (ads that ran during that year)
 *   ?refresh=true — bypass caching
 */

import { createClient } from '@supabase/supabase-js';
import { inflateRawSync } from 'zlib';

const ACCOUNT_NUMBER = 'X1592490';
const CM_SOAP = 'https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc';
const CM_NS = 'https://bingads.microsoft.com/CampaignManagement/v13';
const CUST_NS = 'https://bingads.microsoft.com/Customer/v13';
const REPORT_SOAP = 'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';
const REPORT_NS = 'https://bingads.microsoft.com/Reporting/v13';

// ─── SOAP Helper ───
// CRITICAL: Must use default namespace on s:Header and include Action element.
// Microsoft's API rejects requests without this exact format.

function soapEnvelope(ns, action, headers, bodyXml) {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${ns}">
    <Action mustUnderstand="1">${action}</Action>
    <ApplicationToken i:nil="true"/>
    <AuthenticationToken i:nil="false">${headers.token}</AuthenticationToken>
    <CustomerAccountId i:nil="false">${headers.accountId || ''}</CustomerAccountId>
    <CustomerId i:nil="false">${headers.customerId || ''}</CustomerId>
    <DeveloperToken i:nil="false">${headers.devToken}</DeveloperToken>
  </s:Header>
  <s:Body>${bodyXml}</s:Body>
</s:Envelope>`;
}

async function soapCall(url, action, ns, headers, bodyXml) {
    const envelope = soapEnvelope(ns, action, headers, bodyXml);
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': action,
        },
        body: envelope,
    });
    const text = await resp.text();
    if (!resp.ok || text.includes('Fault>') || text.includes('faultstring') || text.includes('ErrorCode>')) {
        const fault = text.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/);
        const errCode = text.match(/<ErrorCode>([^<]+)<\/ErrorCode>/);
        const errMsg = text.match(/<Message>([^<]+)<\/Message>/);
        throw new Error(`SOAP ${action}: ${errCode ? errCode[1] : ''} ${errMsg ? errMsg[1] : fault ? fault[1] : `HTTP ${resp.status}`}`);
    }
    return text;
}

// ─── XML Parsing Helpers ───

function xmlVal(xml, tag) {
    const m = xml.match(new RegExp(`<[^>]*:?${tag}[^>]*>([^<]*)<`));
    return m ? decodeXmlEntities(m[1]) : null;
}

function xmlAll(xml, tag) {
    const re = new RegExp(`<[^>]*:?${tag}[^/>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, 'g');
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null) results.push(m[1]);
    return results;
}

function xmlBlocks(xml, tag) {
    // Returns array of full blocks including the wrapper tag content
    const re = new RegExp(`<[^>]*:?${tag}[^/>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, 'g');
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null) results.push(m[0]);
    return results;
}

function decodeXmlEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function isNil(xml, tag) {
    return new RegExp(`<[^>]*:?${tag}[^>]*i:nil="true"`).test(xml);
}

// ─── Status / Type Mapping ───

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
    if (t.includes('ResponsiveSearch') || t === 'ResponsiveSearchAd') return 'RESPONSIVE_SEARCH_AD';
    if (t.includes('ExpandedText') || t === 'ExpandedTextAd') return 'EXPANDED_TEXT_AD';
    if (t.includes('DynamicSearch') || t === 'DynamicSearchAd') return 'DYNAMIC_SEARCH_AD';
    if (t.includes('ResponsiveAd')) return 'RESPONSIVE_DISPLAY_AD';
    return t.toUpperCase();
}

function mapMatchType(t) {
    if (!t) return 'BROAD';
    return t.toUpperCase();
}

function mapPinnedField(field) {
    if (!field || field === 'None') return null;
    const m = field.match(/(Headline|Description)(\d+)/);
    if (m) return `${m[1].toUpperCase()}_${m[2]}`;
    return null;
}

// ─── Parse campaigns from SOAP XML ───

function parseCampaigns(xml) {
    const campaigns = [];
    // Use split instead of regex to avoid Node.js regex issues on large XML
    const parts = xml.split('<Campaign>');
    for (let i = 1; i < parts.length; i++) {
        const endIdx = parts[i].indexOf('</Campaign>');
        if (endIdx === -1) continue;
        const block = parts[i].substring(0, endIdx);
        const id = xmlVal(block, 'Id');
        const name = xmlVal(block, 'Name');
        const status = xmlVal(block, 'Status');
        const type = xmlVal(block, 'CampaignType');
        if (id && name) {
            campaigns.push({ Id: id, Name: name, Status: status, CampaignType: type });
        }
    }
    // Also handle <a:Campaign> prefix variant
    if (campaigns.length === 0) {
        const parts2 = xml.split('<a:Campaign>');
        for (let i = 1; i < parts2.length; i++) {
            const endIdx = parts2[i].indexOf('</a:Campaign>');
            if (endIdx === -1) continue;
            const block = parts2[i].substring(0, endIdx);
            const id = xmlVal(block, 'Id');
            const name = xmlVal(block, 'Name');
            const status = xmlVal(block, 'Status');
            const type = xmlVal(block, 'CampaignType');
            if (id && name) {
                campaigns.push({ Id: id, Name: name, Status: status, CampaignType: type });
            }
        }
    }
    return campaigns;
}

function parseAdGroups(xml) {
    const adGroups = [];
    const tag = xml.includes('<a:AdGroup>') ? '<a:AdGroup>' : '<AdGroup>';
    const endTag = xml.includes('<a:AdGroup>') ? '</a:AdGroup>' : '</AdGroup>';
    const parts = xml.split(tag);
    for (let i = 1; i < parts.length; i++) {
        const endIdx = parts[i].indexOf(endTag);
        if (endIdx === -1) continue;
        const block = parts[i].substring(0, endIdx);
        const id = xmlVal(block, 'Id');
        const name = xmlVal(block, 'Name');
        const status = xmlVal(block, 'Status');
        if (id && name) {
            adGroups.push({ Id: id, Name: name, Status: status });
        }
    }
    return adGroups;
}

function parseAds(xml) {
    const ads = [];
    const tag = xml.includes('<a:Ad>') ? '<a:Ad>' : '<Ad>';
    const endTag = xml.includes('<a:Ad>') ? '</a:Ad>' : '</Ad>';
    // Handle Ad blocks which may have i:type attribute
    const tagPattern = xml.includes('<a:Ad') ? '<a:Ad' : '<Ad';
    const parts = xml.split(new RegExp(`${tagPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[> ]`));
    for (let i = 1; i < parts.length; i++) {
        const endIdx = parts[i].indexOf(endTag.replace('>', '>').replace('</', '</'));
        if (endIdx === -1) continue;
        const block = parts[i].substring(0, endIdx);
        const type = block.match(/i:type="([^"]+)"/)?.[1] || xmlVal(block, 'Type') || 'Unknown';
        const id = xmlVal(block, 'Id');
        const status = xmlVal(block, 'Status');
        const name = xmlVal(block, 'Name');

        // Final URLs
        const finalUrls = xmlAll(block, 'string').length > 0
            ? xmlAll(block, 'string').filter(u => u.startsWith('http'))
            : [];

        const ad = { Type: type, Id: id, Status: status, Name: name, FinalUrls: finalUrls };

        // RSA: headlines and descriptions with pinning
        if (type.includes('ResponsiveSearch')) {
            ad.Headlines = [];
            ad.Descriptions = [];

            // Parse AssetLink blocks within Headlines section
            const headlinesSection = block.match(/<[^>]*Headlines[^>]*>([\s\S]*?)<\/[^>]*Headlines>/);
            if (headlinesSection) {
                const assetLinks = xmlBlocks(headlinesSection[1], 'AssetLink');
                for (const al of assetLinks) {
                    const text = xmlVal(al, 'Text');
                    const pinned = xmlVal(al, 'PinnedField');
                    if (text) ad.Headlines.push({ Asset: { Text: text }, PinnedField: pinned });
                }
            }

            const descsSection = block.match(/<[^>]*Descriptions[^>]*>([\s\S]*?)<\/[^>]*Descriptions>/);
            if (descsSection) {
                const assetLinks = xmlBlocks(descsSection[1], 'AssetLink');
                for (const al of assetLinks) {
                    const text = xmlVal(al, 'Text');
                    const pinned = xmlVal(al, 'PinnedField');
                    if (text) ad.Descriptions.push({ Asset: { Text: text }, PinnedField: pinned });
                }
            }

            ad.Path1 = xmlVal(block, 'Path1');
            ad.Path2 = xmlVal(block, 'Path2');

        } else if (type.includes('ExpandedText')) {
            ad.TitlePart1 = xmlVal(block, 'TitlePart1');
            ad.TitlePart2 = xmlVal(block, 'TitlePart2');
            ad.TitlePart3 = xmlVal(block, 'TitlePart3');
            ad.Text = xmlVal(block, 'Text');
            ad.TextPart2 = xmlVal(block, 'TextPart2');
            ad.Path1 = xmlVal(block, 'Path1');
            ad.Path2 = xmlVal(block, 'Path2');

        } else if (type.includes('DynamicSearch')) {
            ad.Text = xmlVal(block, 'Text');
            ad.TextPart2 = xmlVal(block, 'TextPart2');
        }

        if (id) ads.push(ad);
    }
    return ads;
}

function parseKeywords(xml) {
    const keywords = [];
    const tag = xml.includes('<a:Keyword>') ? '<a:Keyword>' : '<Keyword>';
    const endTag = xml.includes('<a:Keyword>') ? '</a:Keyword>' : '</Keyword>';
    const parts = xml.split(tag);
    for (let i = 1; i < parts.length; i++) {
        const endIdx = parts[i].indexOf(endTag);
        if (endIdx === -1) continue;
        const block = parts[i].substring(0, endIdx);
        const text = xmlVal(block, 'Text');
        const matchType = xmlVal(block, 'MatchType');
        const status = xmlVal(block, 'Status');
        if (text) keywords.push({ Text: text, MatchType: matchType, Status: status });
    }
    return keywords;
}

// ─── Transform helpers (Bing → Google format) ───

function transformAd(ad) {
    const type = mapAdType(ad.Type);
    const result = {
        type, status: mapStatus(ad.Status), name: ad.Name || null,
        finalUrls: ad.FinalUrls || [], headlines: [], descriptions: [],
    };

    if (type === 'RESPONSIVE_SEARCH_AD') {
        if (ad.Headlines) {
            result.headlines = ad.Headlines.map((h, i) => ({
                text: h.Asset?.Text || '', position: i + 1,
                pinnedField: mapPinnedField(h.PinnedField),
            }));
        }
        if (ad.Descriptions) {
            result.descriptions = ad.Descriptions.map((d, i) => ({
                text: d.Asset?.Text || '', position: i + 1,
                pinnedField: mapPinnedField(d.PinnedField),
            }));
        }
    } else if (type === 'EXPANDED_TEXT_AD') {
        const parts = [ad.TitlePart1, ad.TitlePart2, ad.TitlePart3].filter(Boolean);
        result.headlines = parts.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
        const descs = [ad.Text, ad.TextPart2].filter(Boolean);
        result.descriptions = descs.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
    } else if (type === 'DYNAMIC_SEARCH_AD') {
        const descs = [ad.Text, ad.TextPart2].filter(Boolean);
        result.descriptions = descs.map((t, i) => ({ text: t, position: i + 1, pinnedField: null }));
    }

    return result;
}

function transformKeyword(kw) {
    return { keyword: kw.Text || '', matchType: mapMatchType(kw.MatchType) };
}

function transformExtension(xml) {
    const type = xml.match(/i:type="([^"]+)"/)?.[1] || '';
    if (type.includes('Sitelink')) {
        return {
            type: 'SITELINK',
            linkText: xmlVal(xml, 'DisplayText') || xmlVal(xml, 'SitelinkText') || '',
            desc1: xmlVal(xml, 'Description1') || '',
            desc2: xmlVal(xml, 'Description2') || '',
            name: xmlVal(xml, 'DisplayText') || xmlVal(xml, 'SitelinkText') || '',
        };
    }
    if (type.includes('Callout')) {
        const text = xmlVal(xml, 'Text') || '';
        return { type: 'CALLOUT', text, name: text };
    }
    if (type.includes('StructuredSnippet')) {
        const header = xmlVal(xml, 'Header') || '';
        const values = xmlAll(xml, 'string');
        return { type: 'STRUCTURED_SNIPPET', header, values, name: header };
    }
    return null;
}

// ─── SOAP API Calls ───

async function getCampaigns(h, accountId) {
    const xml = await soapCall(CM_SOAP, 'GetCampaignsByAccountId', CM_NS, h,
        `<GetCampaignsByAccountIdRequest xmlns="${CM_NS}">
            <AccountId>${accountId}</AccountId>
            <CampaignType>Search</CampaignType>
        </GetCampaignsByAccountIdRequest>`);
    const result = parseCampaigns(xml);
    if (result.length === 0) {
        // Add XML diagnostics to help debug
        const hasCampaignTag = xml.includes('<Campaign>');
        const xmlLen = xml.length;
        const first200 = xml.substring(0, 200);
        const splitCount = xml.split('<Campaign>').length - 1;
        const idxFirst = xml.indexOf('<Campaign>');
        const around = idxFirst >= 0 ? xml.substring(idxFirst, idxFirst + 100) : 'N/A';
        throw new Error(`parse=0 xmlLen=${xmlLen} splits=${splitCount} idx=${idxFirst} around=${around}`);
    }
    return result;
}

async function getAdGroups(h, campaignId) {
    const xml = await soapCall(CM_SOAP, 'GetAdGroupsByCampaignId', CM_NS, h,
        `<GetAdGroupsByCampaignIdRequest xmlns="${CM_NS}">
            <CampaignId>${campaignId}</CampaignId>
        </GetAdGroupsByCampaignIdRequest>`);
    return parseAdGroups(xml);
}

async function getAds(h, adGroupId) {
    const xml = await soapCall(CM_SOAP, 'GetAdsByAdGroupId', CM_NS, h,
        `<GetAdsByAdGroupIdRequest xmlns="${CM_NS}">
            <AdGroupId>${adGroupId}</AdGroupId>
            <AdTypes xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                <a:string>ResponsiveSearch</a:string>
                <a:string>ExpandedText</a:string>
                <a:string>DynamicSearch</a:string>
            </AdTypes>
        </GetAdsByAdGroupIdRequest>`);
    return parseAds(xml);
}

async function getKeywords(h, adGroupId) {
    const xml = await soapCall(CM_SOAP, 'GetKeywordsByAdGroupId', CM_NS, h,
        `<GetKeywordsByAdGroupIdRequest xmlns="${CM_NS}">
            <AdGroupId>${adGroupId}</AdGroupId>
        </GetKeywordsByAdGroupIdRequest>`);
    return parseKeywords(xml);
}

async function getExtensions(h, accountId) {
    try {
        const xml = await soapCall(CM_SOAP, 'GetAdExtensionsByAccountId', CM_NS, h,
            `<GetAdExtensionsByAccountIdRequest xmlns="${CM_NS}">
                <AccountId>${accountId}</AccountId>
                <AdExtensionType>SitelinkAdExtension CalloutAdExtension StructuredSnippetAdExtension</AdExtensionType>
            </GetAdExtensionsByAccountIdRequest>`);
        const extBlocks = xmlBlocks(xml, 'AdExtension');
        return extBlocks.map(transformExtension).filter(Boolean);
    } catch (e) {
        // Some operations may not be supported — return empty
        return [];
    }
}

// ─── Fetch Active Ads ───

async function fetchActiveData(token, devToken, customerId, accountId) {
    const h = { token, devToken, customerId, accountId };

    // 1. Get campaigns
    let allCampaigns;
    try {
        allCampaigns = await getCampaigns(h, accountId);
    } catch (e) {
        throw new Error(`getCampaigns failed: ${e.message}`);
    }
    // Include all non-deleted campaigns (Paused campaigns are important for audit)
    const campaigns = allCampaigns.filter(c => c.Status !== 'Deleted');

    if (campaigns.length === 0) {
        const statuses = [...new Set(allCampaigns.map(c => c.Status))];
        throw new Error(`0 campaigns after filter. Raw count: ${allCampaigns.length}. Statuses: [${statuses.join(', ')}]`);
        return { campaigns: [], accountAssets: [] };
    }

    // 2. Get ad groups in parallel
    const agResults = await Promise.all(
        campaigns.map(c => getAdGroups(h, c.Id)
            .then(ags => ({ cId: c.Id, ags: ags.filter(ag => ag.Status === 'Active' || ag.Status === 'Paused') }))
            .catch(() => ({ cId: c.Id, ags: [] }))
        )
    );

    const agMap = {};
    for (const r of agResults) agMap[r.cId] = r.ags;

    // 3. Flatten ad groups, fetch ads + keywords in parallel
    const allAgs = [];
    for (const camp of campaigns) {
        for (const ag of (agMap[camp.Id] || [])) {
            allAgs.push({ ...ag, _cId: camp.Id });
        }
    }

    const details = await Promise.all(
        allAgs.map(ag =>
            Promise.all([
                getAds(h, ag.Id).catch(() => []),
                getKeywords(h, ag.Id).catch(() => []),
            ]).then(([ads, kws]) => ({
                adGroupId: ag.Id, campaignId: ag._cId, name: ag.Name,
                ads: ads.filter(a => a.Status === 'Active' || a.Status === 'Paused').map(transformAd),
                keywords: kws.filter(k => k.Status === 'Active' || k.Status === 'Paused').map(transformKeyword),
                negativeKeywords: [],
            }))
        )
    );

    // 4. Group by campaign
    const byCampaign = {};
    for (const d of details) {
        if (!byCampaign[d.campaignId]) byCampaign[d.campaignId] = [];
        byCampaign[d.campaignId].push({ name: d.name, ads: d.ads, keywords: d.keywords, negativeKeywords: [] });
    }

    // 5. Get extensions
    const accountAssets = await getExtensions(h, accountId);

    return {
        campaigns: campaigns.map(c => ({
            name: c.Name, status: mapStatus(c.Status), type: mapCampaignType(c.CampaignType),
            adGroups: byCampaign[c.Id] || [], assets: [],
        })),
        accountAssets,
        negativeKeywordLists: [],
    };
}

// ─── Fetch Historical Ads ───

async function fetchHistoricalData(token, devToken, customerId, accountId, year) {
    const h = { token, devToken, customerId, accountId };

    // Get ALL campaigns (including paused)
    const campaigns = await getCampaigns(h, accountId);
    if (campaigns.length === 0) return { campaigns: [], accountAssets: [] };

    // Get ad groups
    const agResults = await Promise.all(
        campaigns.map(c => getAdGroups(h, c.Id)
            .then(ags => ({ cId: c.Id, ags }))
            .catch(() => ({ cId: c.Id, ags: [] }))
        )
    );

    const agMap = {};
    for (const r of agResults) agMap[r.cId] = r.ags;

    const allAgs = [];
    for (const camp of campaigns) {
        for (const ag of (agMap[camp.Id] || [])) {
            allAgs.push({ ...ag, _cId: camp.Id });
        }
    }

    // Fetch ads + keywords (all statuses for historical)
    const details = await Promise.all(
        allAgs.map(ag =>
            Promise.all([
                getAds(h, ag.Id).catch(() => []),
                getKeywords(h, ag.Id).catch(() => []),
            ]).then(([ads, kws]) => ({
                campaignId: ag._cId, name: ag.Name,
                ads: ads.map(transformAd),
                keywords: kws.map(transformKeyword),
            }))
        )
    );

    const byCampaign = {};
    for (const d of details) {
        if (d.ads.length === 0 && d.keywords.length === 0) continue;
        if (!byCampaign[d.campaignId]) byCampaign[d.campaignId] = [];
        byCampaign[d.campaignId].push({ name: d.name, ads: d.ads, keywords: d.keywords, negativeKeywords: [] });
    }

    const accountAssets = await getExtensions(h, accountId);

    return {
        campaigns: campaigns
            .filter(c => byCampaign[c.Id])
            .map(c => ({
                name: c.Name, status: mapStatus(c.Status), type: mapCampaignType(c.CampaignType),
                adGroups: byCampaign[c.Id] || [], assets: [],
            })),
        accountAssets,
        negativeKeywordLists: [],
    };
}

// ─── Token Management ───

async function getConnection(supabase) {
    const { data, error } = await supabase
        .from('bing_ads_connections').select('*')
        .order('updated_at', { ascending: false }).limit(1).single();
    return error ? null : data;
}

async function refreshTokenIfNeeded(connection, supabase) {
    // Always refresh if within 5 minutes of expiry
    const fiveMinutes = 5 * 60 * 1000;
    if (new Date(connection.token_expires_at).getTime() - fiveMinutes > Date.now()) return connection.access_token;
    if (!connection.refresh_token) throw new Error('Token expired. Please re-authorize.');

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
    if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);

    await supabase.from('bing_ads_connections').update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || connection.refresh_token,
        token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
    }).eq('id', connection.id);

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
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const connection = await getConnection(supabase);
        if (!connection) return res.status(401).json({ error: 'Microsoft Advertising not connected', needsAuth: true });

        const accessToken = await refreshTokenIfNeeded(connection, supabase);
        const devToken = (process.env.BING_ADS_DEVELOPER_TOKEN || '').trim();
        if (!devToken) return res.status(500).json({ error: 'BING_ADS_DEVELOPER_TOKEN not configured' });

        const { customer_id: customerId, account_id: accountId } = connection;
        if (!customerId || !accountId) {
            return res.status(500).json({ error: 'Account not fully configured. Re-authorize.', needsAuth: true });
        }

        const year = parseInt(req.query.year);
        const isHistorical = year && year >= 2010 && year <= new Date().getFullYear();

        const data = isHistorical
            ? await fetchHistoricalData(accessToken, devToken, customerId, accountId, year)
            : await fetchActiveData(accessToken, devToken, customerId, accountId);

        return res.status(200).json({
            platform: 'bing',
            fetchedAt: new Date().toISOString(),
            historical: isHistorical,
            year: isHistorical ? year : null,
            account: { id: connection.account_number || ACCOUNT_NUMBER, name: connection.account_name || 'Dunham & Jones' },
            ...data,
        });
    } catch (err) {
        console.error('Bing Ads API error:', err);
        return res.status(500).json({ error: 'Failed to fetch Bing Ads data', details: err.message });
    }
}

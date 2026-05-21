/**
 * Google Ads — Digistore24 RSA Combinations
 * GET /api/digistore/ad-combinations?adId=NNN&days=30
 *
 * Fetches served combinations for a specific responsive search ad from
 * ad_group_ad_asset_combination_view (impressions-only — same as Google's UI).
 *
 * Two-step:
 *   1. Pull the parent RSA's headline/description assets so we can resolve
 *      asset resource names to text.
 *   2. Pull combinations and inline-resolve each served_asset.
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '2466246400';
const LOGIN_CUSTOMER_ID = '2466246400';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const adId = (req.query.adId || '').trim();
    if (!adId || !/^\d+$/.test(adId)) {
        return res.status(400).json({ status: 'error', error: 'Valid numeric adId is required' });
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        if (connError || !connection) {
            return res.status(500).json({ status: 'error', error: 'No Google Ads connection found' });
        }

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
            if (refreshData.access_token) {
                accessToken = refreshData.access_token;
                await supabase.from('google_ads_connections').update({
                    access_token: accessToken,
                    token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                }).eq('id', connection.id);
            } else {
                return res.status(500).json({ status: 'error', error: 'Token refresh failed' });
            }
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        const { start, end } = resolveDateRange(req.query);

        // Step 1: resolve the ad's asset resource names → text
        const assetMap = await fetchAdAssetMap(headers, adId);

        // Step 2: pull combinations
        const combinations = await fetchCombinations(headers, adId, start, end, assetMap);

        const totalImpressions = combinations.reduce((sum, c) => sum + c.impressions, 0);

        return res.status(200).json({
            status: 'success',
            adId,
            dateRange: { start, end },
            totalImpressions,
            combinations,
        });
    } catch (error) {
        return res.status(200).json({
            status: 'error',
            error: error.message,
            combinations: [],
        });
    }
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

async function fetchAdAssetMap(headers, adId) {
    // The `asset` field on inline RSA headlines (AdTextAsset.asset) is usually
    // empty in v23 responses — Google doesn't echo it back when the headline
    // is stored inline. Instead query ad_group_ad_asset_view, which always
    // gives us the resolved asset resource name + linked text for the ad.
    const query = `
        SELECT
            ad_group_ad_asset_view.asset,
            ad_group_ad_asset_view.field_type,
            asset.text_asset.text
        FROM ad_group_ad_asset_view
        WHERE ad_group_ad.ad.id = ${adId}
            AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
    `;
    const rows = await fetchQuery(headers, query);
    const map = {}; // assetResourceName → { text, fieldType }
    for (const row of rows) {
        const view = row.adGroupAdAssetView || {};
        const assetRef = view.asset || '';
        const text = row.asset?.textAsset?.text || '';
        const fieldType = view.fieldType || '';
        if (!assetRef || !text) continue;
        map[assetRef] = { text, fieldType };
    }
    return map;
}

async function fetchCombinations(headers, adId, start, end, assetMap) {
    // Only impressions are available on this resource (Google's combinations
    // report shows the same — impressions + impression share, no clicks/conv).
    const query = `
        SELECT
            ad_group_ad_asset_combination_view.served_assets,
            ad_group_ad_asset_combination_view.enabled,
            metrics.impressions
        FROM ad_group_ad_asset_combination_view
        WHERE ad_group_ad.ad.id = ${adId}
            AND segments.date BETWEEN '${start}' AND '${end}'
        ORDER BY metrics.impressions DESC
        LIMIT 100
    `;
    const rows = await fetchQuery(headers, query);

    return rows.map(row => {
        const view = row.adGroupAdAssetCombinationView || {};
        const impressions = parseInt(row.metrics?.impressions || 0, 10);
        const enabled = view.enabled !== false;

        // Resolve served_assets[] to ordered headline/description text lists.
        // served_asset_field_type is HEADLINE_1/2/3 or DESCRIPTION_1/2/3/4 —
        // we use the trailing digit to sort them.
        const headlines = [];
        const descriptions = [];
        (view.servedAssets || []).forEach(sa => {
            const assetRef = sa.asset || '';
            const fieldType = sa.servedAssetFieldType || '';
            const text = assetMap[assetRef]?.text || '';
            if (!text) return;
            const positionMatch = fieldType.match(/_(\d+)$/);
            const position = positionMatch ? parseInt(positionMatch[1], 10) : 99;
            const entry = { text, fieldType, position };
            if (fieldType.startsWith('HEADLINE')) headlines.push(entry);
            else if (fieldType.startsWith('DESCRIPTION')) descriptions.push(entry);
        });
        headlines.sort((a, b) => a.position - b.position);
        descriptions.sort((a, b) => a.position - b.position);

        return {
            impressions,
            enabled,
            headlines: headlines.map(h => h.text),
            descriptions: descriptions.map(d => d.text),
        };
    });
}

function resolveDateRange(query) {
    const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (isISO(query.start) && isISO(query.end)) return { start: query.start, end: query.end };
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

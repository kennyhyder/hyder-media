/**
 * Google Search Console - Vita Brevis Sitemap & Property Status
 * GET /api/vita-brevis/gsc-coverage
 *
 * Returns sitemaps registered for the property + per-sitemap submission stats
 * (submitted/indexed counts, last download time, errors/warnings).
 */

import { createClient } from '@supabase/supabase-js';

const SITE_URL = 'sc-domain:vitabrevisfineart.com';
const SITE_URL_ENCODED = encodeURIComponent(SITE_URL);
const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const result = {
        property: SITE_URL,
        status: 'loading',
        errors: [],
    };

    try {
        const accessToken = await getAccessToken();
        const headers = { 'Authorization': `Bearer ${accessToken}` };

        // List sitemaps
        const sitemapsResp = await fetch(
            `${GSC_BASE}/sites/${SITE_URL_ENCODED}/sitemaps`,
            { headers }
        );
        const sitemapsData = await sitemapsResp.json();

        if (sitemapsData.error) {
            const msg = sitemapsData.error.message || JSON.stringify(sitemapsData.error);
            throw new Error(`GSC API: ${msg}`);
        }

        result.sitemaps = (sitemapsData.sitemap || []).map(s => ({
            path: s.path,
            lastSubmitted: s.lastSubmitted,
            lastDownloaded: s.lastDownloaded,
            isPending: s.isPending,
            isSitemapsIndex: s.isSitemapsIndex,
            type: s.type,
            warnings: s.warnings || 0,
            errors: s.errors || 0,
            contents: (s.contents || []).map(c => ({
                type: c.type,
                submitted: c.submitted,
                indexed: c.indexed,
            })),
        }));

        // Site/property metadata
        const siteResp = await fetch(
            `${GSC_BASE}/sites/${SITE_URL_ENCODED}`,
            { headers }
        );
        const siteData = await siteResp.json();
        if (!siteData.error) {
            result.permissionLevel = siteData.permissionLevel;
        }

        result.status = 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = err.message?.includes('insufficient') || err.message?.includes('forbidden')
            ? 'needs_reauth'
            : 'error';
        if (result.status === 'needs_reauth') {
            result.message = 'GSC scope missing — re-authorize at /api/google-ads/auth';
        }
        return res.status(200).json(result);
    }
}

async function getAccessToken() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error } = await supabase
        .from('google_ads_connections').select('*')
        .order('created_at', { ascending: false }).limit(1).single();

    if (error || !connection) throw new Error('No Google connection found');

    let accessToken = connection.access_token;
    if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: connection.refresh_token,
                grant_type: 'refresh_token',
            }),
        });
        const refreshData = await refreshResp.json();
        if (!refreshData.access_token) throw new Error('Token refresh failed');
        accessToken = refreshData.access_token;
        await supabase.from('google_ads_connections').update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        }).eq('id', connection.id);
    }
    return accessToken;
}

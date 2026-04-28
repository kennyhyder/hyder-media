/**
 * GA4 — Organic landing-page conversion rates for Omicron-owned domains
 * POST /api/ga4/landing-page-conversions
 *
 * Body:
 *   { urls: string[], days?: number = 180 }
 *
 * For each URL whose host maps to a known GA4 property (the 7 owned Omicron
 * sites), runs a GA4 Data API report to pull:
 *   - sessions filtered to sessionDefaultChannelGroup = "Organic Search"
 *   - eventCount filtered to eventName = "purchase" on the same scope
 * grouped by landingPagePlusQueryString, then matches that landing page
 * back to the requested URL's path.
 *
 * Returns per-URL: sessions, purchases, conv_rate (purchases / sessions).
 *
 * Date window default: 180 days for stability. Override with `days` in body.
 *
 * Auth: pulls the most-recent ga4_connections row from Supabase, refreshes
 * the access token if expired. The user authorizes once via /api/ga4/auth.
 */

import { createClient } from '@supabase/supabase-js';

// Domain → GA4 property ID. From the user's GA4 admin.
// BUR (bestusenetreviews.com), Top10usenet, Privado are not mapped — they
// are review/affiliate properties without dedicated GA4 access.
const DOMAIN_TO_PROPERTY = {
    'easynews.com':     '313389254',
    'eweka.nl':         '313304161',
    'newshosting.com':  '313382711',
    'pureusenet.nl':    '313392625',
    'sunnyusenet.com':  '311752132',
    'tweaknews.eu':     '313411933',
    'usenetserver.com': '313385778'
};

function normalizeHost(h) {
    if (!h) return '';
    return String(h).toLowerCase().replace(/^www\./, '');
}

// Find the property ID for a host, allowing subdomain matches (members.easynews.com → easynews.com).
function lookupProperty(host) {
    const norm = normalizeHost(host);
    if (!norm) return null;
    if (DOMAIN_TO_PROPERTY[norm]) return { domain: norm, propertyId: DOMAIN_TO_PROPERTY[norm] };
    for (const [d, p] of Object.entries(DOMAIN_TO_PROPERTY)) {
        if (norm === d || norm.endsWith('.' + d)) return { domain: d, propertyId: p };
    }
    return null;
}

function parseUrl(raw) {
    try {
        const u = new URL(raw);
        return {
            url: raw,
            host: u.hostname,
            // landingPagePlusQueryString in GA4 is path + search, no host
            pathPlusQuery: u.pathname + (u.search || '')
        };
    } catch (_) {
        return null;
    }
}

async function getValidAccessToken(supabase) {
    const { data: connection, error } = await supabase
        .from('ga4_connections')
        .select('*')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`ga4_connections lookup failed: ${error.message}`);
    if (!connection) {
        const e = new Error('not_authenticated');
        e.code = 'not_authenticated';
        throw e;
    }

    let accessToken = connection.access_token;

    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date(Date.now() + 60_000)) {
        if (!connection.refresh_token) throw new Error('Token expired and no refresh_token on file. Re-authorize.');
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: connection.refresh_token,
                grant_type: 'refresh_token'
            })
        });
        const refreshData = await refreshResponse.json();
        if (!refreshData.access_token) {
            throw new Error('Token refresh failed: ' + JSON.stringify(refreshData));
        }
        accessToken = refreshData.access_token;
        await supabase
            .from('ga4_connections')
            .update({
                access_token: accessToken,
                token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', connection.id);
    }

    return accessToken;
}

/**
 * Run a single GA4 runReport for one property, returning a Map<pathPlusQuery, {sessions, purchases}>.
 * One call returns ALL landing pages with organic sessions / purchases — we filter client-side.
 */
async function fetchPropertyLandingPages(propertyId, accessToken, days) {
    // GA4 Data API doesn't allow per-metric filters in a single runReport, so we
    // issue two reports against the same date range and join on landing page.
    // First call: organic sessions per landing page
    const sessionsBody = {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
            filter: {
                fieldName: 'sessionDefaultChannelGroup',
                stringFilter: { matchType: 'EXACT', value: 'Organic Search' }
            }
        },
        limit: 5000
    };

    // Second call: purchase events per landing page, scoped to organic
    const purchasesBody = {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
            andGroup: {
                expressions: [
                    {
                        filter: {
                            fieldName: 'sessionDefaultChannelGroup',
                            stringFilter: { matchType: 'EXACT', value: 'Organic Search' }
                        }
                    },
                    {
                        filter: {
                            fieldName: 'eventName',
                            stringFilter: { matchType: 'EXACT', value: 'purchase' }
                        }
                    }
                ]
            }
        },
        limit: 5000
    };

    async function callReport(reqBody) {
        const resp = await fetch(
            `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(reqBody)
            }
        );
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(`GA4 ${propertyId} ${resp.status}: ${data?.error?.message || JSON.stringify(data)}`);
        }
        return data;
    }

    const [sessionsData, purchasesData] = await Promise.all([
        callReport(sessionsBody),
        callReport(purchasesBody)
    ]);

    const out = new Map();
    for (const row of sessionsData.rows || []) {
        const path = row.dimensionValues?.[0]?.value || '';
        const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
        if (!out.has(path)) out.set(path, { sessions: 0, purchases: 0 });
        out.get(path).sessions = sessions;
    }
    for (const row of purchasesData.rows || []) {
        const path = row.dimensionValues?.[0]?.value || '';
        const purchases = parseInt(row.metricValues?.[0]?.value || '0', 10);
        if (!out.has(path)) out.set(path, { sessions: 0, purchases: 0 });
        out.get(path).purchases = purchases;
    }
    return out;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { urls = [], days = 180 } = req.body || {};
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'urls array required' });
    }
    const cleanDays = Math.max(7, Math.min(365, parseInt(days) || 180));

    // Group requested URLs by mapped property
    const requested = urls
        .map(u => parseUrl(u))
        .filter(Boolean)
        .map(u => {
            const lookup = lookupProperty(u.host);
            return lookup ? { ...u, ...lookup } : { ...u, propertyId: null };
        });

    const byProperty = new Map();
    for (const u of requested) {
        if (!u.propertyId) continue;
        if (!byProperty.has(u.propertyId)) byProperty.set(u.propertyId, []);
        byProperty.get(u.propertyId).push(u);
    }

    let supabase, accessToken;
    try {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        accessToken = await getValidAccessToken(supabase);
    } catch (err) {
        if (err.code === 'not_authenticated') {
            return res.status(200).json({
                authenticated: false,
                authUrl: '/api/ga4/auth',
                results: {},
                days: cleanDays
            });
        }
        return res.status(500).json({ error: err.message });
    }

    // Fetch each property's landing-page report once, then match URLs to rows
    const results = {};
    const errors = [];

    await Promise.all(
        Array.from(byProperty.entries()).map(async ([propertyId, urlList]) => {
            try {
                const pageMap = await fetchPropertyLandingPages(propertyId, accessToken, cleanDays);
                for (const u of urlList) {
                    // Try exact match first, then path-only match (drop query string)
                    let stats = pageMap.get(u.pathPlusQuery);
                    if (!stats) {
                        const pathOnly = u.pathPlusQuery.split('?')[0];
                        stats = pageMap.get(pathOnly);
                    }
                    // For the homepage, GA4 sometimes reports as "/" or just "" — try both
                    if (!stats && (u.pathPlusQuery === '/' || u.pathPlusQuery === '')) {
                        stats = pageMap.get('/') || pageMap.get('');
                    }
                    const sessions = stats?.sessions || 0;
                    const purchases = stats?.purchases || 0;
                    const convRate = sessions > 0 ? purchases / sessions : null;
                    results[u.url] = {
                        url: u.url,
                        host: u.host,
                        path: u.pathPlusQuery,
                        domain: u.domain,
                        propertyId,
                        sessions,
                        purchases,
                        convRate,
                        matched: !!stats
                    };
                }
            } catch (e) {
                console.error(`GA4 property ${propertyId} failed:`, e.message);
                errors.push({ propertyId, error: e.message });
                for (const u of urlList) {
                    results[u.url] = { url: u.url, error: e.message };
                }
            }
        })
    );

    // Mark unmapped URLs
    for (const u of requested) {
        if (!u.propertyId && !results[u.url]) {
            results[u.url] = {
                url: u.url,
                host: u.host,
                unmapped: true
            };
        }
    }

    return res.status(200).json({
        authenticated: true,
        days: cleanDays,
        propertiesQueried: byProperty.size,
        urlsRequested: urls.length,
        urlsMapped: Array.from(byProperty.values()).reduce((s, arr) => s + arr.length, 0),
        errors: errors.length ? errors : undefined,
        results
    });
}

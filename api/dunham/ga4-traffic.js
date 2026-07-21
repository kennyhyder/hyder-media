/**
 * Dunham GA4 traffic breakdowns — compliance reporting
 * GET /api/dunham/ga4-traffic
 *
 * Query params:
 *   breakdown - properties | channel | source | daily | platform | compare
 *               (default: channel)
 *   property  - numeric GA4 property id (default 253496127 = "Dunham & Jones
 *               GA4 (Main Site)"). Must belong to the Dunham & Jones Assets
 *               GA4 account — arbitrary property ids are rejected so this
 *               public endpoint can never read another client's data.
 *   days      - 7 | 28 | 90 (default 28), or startDate+endDate (YYYY-MM-DD)
 *
 * channel:  sessions + totalUsers by sessionDefaultChannelGroup
 * source:   sessions by sessionSource/sessionMedium (top 25)
 * daily:    sessions by date × channel (for the stacked trend chart)
 * platform: sessions rolled up to recognizable platforms (Google, Bing,
 *           DuckDuckGo, Yahoo, Facebook, Instagram, …) with paid/unpaid
 *           split — the client's compliance ask. The six explicitly-asked
 *           platforms always appear, even at zero sessions.
 * compare:  the platform rollup for EVERY Dunham property at once — the
 *           cross-website matrix (dunhamlaw.com vs jailrelease.com vs …).
 */

import { supabase, getGoogleAccessToken } from './_google.js';

const DEFAULT_PROPERTY = '253496127';
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

// ---- Platform classification (source/medium → recognizable platform) ----
// Order matters: first match wins.
const PLATFORM_RULES = [
    ['DuckDuckGo',        /duckduckgo/i],
    ['Bing (Microsoft)',  /\bbing\b|microsoft/i],
    ['Yahoo',             /yahoo/i],
    ['YouTube',           /youtube/i],
    ['Google',            /google|gclid|adwords|googleads|g\.doubleclick/i],
    ['Facebook',          /facebook|^fb$|^fb\.|meta\b/i],
    ['Instagram',         /instagram|^ig$/i],
    ['TikTok',            /tiktok/i],
    ['X (Twitter)',       /twitter|^t\.co$|^x\.com$/i],
    ['LinkedIn',          /linkedin|lnkd\.in/i],
    ['Reddit',            /reddit/i],
    ['Nextdoor',          /nextdoor/i],
    ['AI Assistants',     /chatgpt|openai|perplexity|gemini|bard\b|copilot|claude|anthropic|deepseek/i],
    ['Other Search',      /ecosia|brave|startpage|aol\b|baidu|yandex|dogpile|ask\.com|searx|qwant|presearch/i],
    ['Yelp',              /yelp/i],
    ['Legal Directories', /avvo|findlaw|justia|lawyers\.com|superlawyers|martindale|nolo|legalmatch|expertise\.com/i],
    ['Email',             /mail\b|gmail|outlook|sendgrid|mailchimp|klaviyo/i],
];
// The platforms the client explicitly asked about — always present in output.
const ALWAYS_SHOW = ['Google', 'Bing (Microsoft)', 'DuckDuckGo', 'Yahoo', 'Facebook', 'Instagram'];
const PAID_MEDIUM = /cpc|ppc|paid|cpm|cpv|cpa|display|banner|retarget/i;

function classifyPlatform(source, medium) {
    const s = String(source || '');
    if (s === '(direct)' || (s === '(not set)' && String(medium) === '(none)')) return 'Direct';
    if (String(medium).toLowerCase() === 'email') return 'Email';
    for (const [name, re] of PLATFORM_RULES) if (re.test(s)) return name;
    return 'Other / Referral';
}

function rollupPlatforms(rows) {
    // rows: [{source, medium, sessions}]
    const map = new Map();
    for (const name of ALWAYS_SHOW) {
        map.set(name, { platform: name, sessions: 0, paid: 0, unpaid: 0, topSources: [] });
    }
    for (const r of rows) {
        const name = classifyPlatform(r.source, r.medium);
        if (!map.has(name)) map.set(name, { platform: name, sessions: 0, paid: 0, unpaid: 0, topSources: [] });
        const p = map.get(name);
        p.sessions += r.sessions;
        if (PAID_MEDIUM.test(r.medium)) p.paid += r.sessions; else p.unpaid += r.sessions;
        p.topSources.push({ sm: `${r.source} / ${r.medium}`, sessions: r.sessions });
    }
    const platforms = [...map.values()];
    for (const p of platforms) {
        p.topSources = p.topSources.sort((a, b) => b.sessions - a.sessions).slice(0, 4);
    }
    return platforms.sort((a, b) => b.sessions - a.sessions
        || ALWAYS_SHOW.indexOf(a.platform) - ALWAYS_SHOW.indexOf(b.platform));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'channel').toLowerCase();
    const propertyId = String(req.query.property || DEFAULT_PROPERTY).replace(/\D/g, '');

    let startDate, endDate;
    if (req.query.startDate && req.query.endDate) {
        startDate = req.query.startDate;
        endDate = req.query.endDate;
    } else {
        const days = [7, 28, 90].includes(parseInt(req.query.days)) ? parseInt(req.query.days) : 28;
        startDate = `${days}daysAgo`;
        endDate = 'yesterday';
    }

    try {
        const token = await getGoogleAccessToken(supabase(), 'ga4_connections');
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

        // Enumerate Dunham-account properties (also the allowlist guard)
        const sums = await (await fetch(
            'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers }
        )).json();
        if (sums.error) throw new Error(`GA4 admin: ${sums.error.message}`);
        const dunhamProps = (sums.accountSummaries || [])
            .filter(a => /dunham/i.test(a.displayName))
            .flatMap(a => (a.propertySummaries || []).map(p => ({
                property: p.property.replace('properties/', ''),
                displayName: p.displayName,
                account: a.displayName,
            })));

        if (dunhamProps.length === 0) {
            return res.status(200).json({
                status: 'needs_access',
                message: 'No Dunham GA4 account visible — grant kenny@hyder.me Viewer access in GA4 Admin.',
            });
        }

        if (breakdown === 'properties') {
            return res.status(200).json({ status: 'success', properties: dunhamProps, default: DEFAULT_PROPERTY });
        }

        const dateRangesShared = [{ startDate, endDate }];

        if (breakdown === 'compare') {
            // Platform rollup across every Dunham property (the cross-website matrix)
            const results = await Promise.all(dunhamProps.map(async (p) => {
                try {
                    const rows = await fetchSourceRows(headers, p.property, dateRangesShared);
                    const platforms = rollupPlatforms(rows);
                    return {
                        id: p.property,
                        name: p.displayName,
                        total: platforms.reduce((s, x) => s + x.sessions, 0),
                        platforms: Object.fromEntries(platforms.map(x => [x.platform, x.sessions])),
                    };
                } catch (e) {
                    return { id: p.property, name: p.displayName, total: 0, platforms: {}, error: e.message };
                }
            }));
            return res.status(200).json({
                status: 'success', breakdown,
                dateRange: { start: startDate, end: endDate },
                properties: results.sort((a, b) => b.total - a.total),
            });
        }

        const prop = dunhamProps.find(p => p.property === propertyId);
        if (!prop) {
            return res.status(400).json({ error: 'Unknown property — must be a Dunham & Jones GA4 property.' });
        }

        const runReport = async (body) => {
            const data = await (await fetch(`${DATA_BASE}/properties/${propertyId}:runReport`, {
                method: 'POST', headers, body: JSON.stringify(body),
            })).json();
            if (data.error) throw new Error(`GA4 data: ${data.error.message}`);
            return data.rows || [];
        };
        const dateRanges = [{ startDate, endDate }];
        const result = {
            status: 'success', breakdown,
            property: { id: propertyId, name: prop.displayName },
            dateRange: { start: startDate, end: endDate },
        };

        if (breakdown === 'channel') {
            const rows = await runReport({
                dateRanges,
                dimensions: [{ name: 'sessionDefaultChannelGroup' }],
                metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
                limit: 50,
            });
            result.channels = rows.map(r => ({
                channel: r.dimensionValues[0].value,
                sessions: Number(r.metricValues[0].value),
                users: Number(r.metricValues[1].value),
            })).sort((a, b) => b.sessions - a.sessions);
            result.totals = {
                sessions: result.channels.reduce((s, c) => s + c.sessions, 0),
                users: result.channels.reduce((s, c) => s + c.users, 0),
            };
        } else if (breakdown === 'source') {
            const rows = await runReport({
                dateRanges,
                dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
                metrics: [{ name: 'sessions' }],
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: 25,
            });
            result.sources = rows.map(r => ({
                source: r.dimensionValues[0].value,
                medium: r.dimensionValues[1].value,
                sessions: Number(r.metricValues[0].value),
            }));
            const totalRows = await runReport({ dateRanges, dimensions: [], metrics: [{ name: 'sessions' }], limit: 1 });
            result.totalSessions = Number(totalRows[0]?.metricValues?.[0]?.value || 0);
        } else if (breakdown === 'platform') {
            const rows = await fetchSourceRows(headers, propertyId, dateRanges);
            const platforms = rollupPlatforms(rows);
            result.platforms = platforms;
            result.totalSessions = platforms.reduce((s, p) => s + p.sessions, 0);
        } else if (breakdown === 'daily') {
            const rows = await runReport({
                dateRanges,
                dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
                metrics: [{ name: 'sessions' }],
                limit: 10000,
            });
            result.daily = rows.map(r => ({
                date: r.dimensionValues[0].value,          // YYYYMMDD
                channel: r.dimensionValues[1].value,
                sessions: Number(r.metricValues[0].value),
            })).sort((a, b) => a.date.localeCompare(b.date));
        } else {
            return res.status(400).json({ error: `Unknown breakdown: ${breakdown}` });
        }

        return res.status(200).json(result);
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

// Full source/medium rows for a property (up to 1000 combos — covers the tail)
async function fetchSourceRows(headers, propertyId, dateRanges) {
    const data = await (await fetch(`${DATA_BASE}/properties/${propertyId}:runReport`, {
        method: 'POST', headers,
        body: JSON.stringify({
            dateRanges,
            dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
            metrics: [{ name: 'sessions' }],
            limit: 1000,
        }),
    })).json();
    if (data.error) throw new Error(`GA4 data: ${data.error.message}`);
    return (data.rows || []).map(r => ({
        source: r.dimensionValues[0].value,
        medium: r.dimensionValues[1].value,
        sessions: Number(r.metricValues[0].value),
    }));
}

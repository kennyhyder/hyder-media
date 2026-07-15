/**
 * Google Search Console — dunhamlaw.com performance
 * GET /api/dunham/gsc
 *
 * Query params:
 *   days      - lookback window (default 28; GSC lags ~2 days)
 *   breakdown - summary | query | page | date (default: summary)
 *   filter    - "bail" limits rows to bail/jail-release queries or
 *               /tx/bail-bonds/ pages (regex filter, default: none)
 *   limit     - max rows (default 250, max 5000)
 *
 * Returns { status: 'needs_access' } with grant instructions until Dunham
 * adds kenny@hyder.me to the dunhamlaw.com Search Console property.
 */

import {
    supabase, getGoogleAccessToken, resolveDunhamGscProperty,
    gscQuery, gscWindow, BAIL_REGEX,
} from './_google.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 250, 5000);
    const days = parseInt(req.query.days) || 28;
    const bailOnly = req.query.filter === 'bail';
    const { startDate, endDate } = gscWindow(days);

    const result = { dateRange: { start: startDate, end: endDate }, breakdown, bailOnly };

    try {
        const sb = supabase();
        const token = await getGoogleAccessToken(sb);
        const prop = await resolveDunhamGscProperty(token);
        if (!prop) {
            return res.status(200).json({
                ...result,
                status: 'needs_access',
                message: 'kenny@hyder.me is not yet a user on the dunhamlaw.com Search Console property.',
            });
        }
        result.property = prop.siteUrl;

        const dimensionFilterGroups = bailOnly ? [{
            filters: [{
                dimension: breakdown === 'page' ? 'page' : 'query',
                operator: 'includingRegex',
                expression: breakdown === 'page' ? '/tx/(bail-bonds|warrants)/' : BAIL_REGEX,
            }],
        }] : undefined;

        if (breakdown === 'summary') {
            const rows = await gscQuery(token, prop.siteUrl, {
                startDate, endDate, dimensions: [], rowLimit: 1,
                ...(dimensionFilterGroups ? { dimensionFilterGroups } : {}),
            });
            const r = rows[0] || {};
            result.summary = {
                clicks: r.clicks || 0, impressions: r.impressions || 0,
                ctr: r.ctr || 0, position: r.position || 0,
            };
        } else if (['query', 'page', 'date'].includes(breakdown)) {
            const rows = await gscQuery(token, prop.siteUrl, {
                startDate, endDate, dimensions: [breakdown], rowLimit: limit,
                ...(dimensionFilterGroups ? { dimensionFilterGroups } : {}),
            });
            result.rows = rows.map(r => ({
                key: r.keys?.[0] || '',
                clicks: r.clicks || 0, impressions: r.impressions || 0,
                ctr: r.ctr || 0, position: r.position || 0,
            }));
            if (breakdown === 'date') result.rows.sort((a, b) => a.key.localeCompare(b.key));
        } else {
            return res.status(400).json({ error: `Unknown breakdown: ${breakdown}` });
        }

        result.status = 'success';
        return res.status(200).json(result);
    } catch (err) {
        return res.status(200).json({ ...result, status: 'error', error: err.message });
    }
}

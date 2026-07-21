/**
 * Dunham GA4 traffic breakdowns — compliance reporting
 * GET /api/dunham/ga4-traffic
 *
 * Query params:
 *   breakdown - properties | channel | source | daily   (default: channel)
 *   property  - numeric GA4 property id (default 253496127 = "Dunham & Jones
 *               GA4 (Main Site)"). Must belong to the Dunham & Jones Assets
 *               GA4 account — arbitrary property ids are rejected so this
 *               public endpoint can never read another client's data.
 *   days      - 7 | 28 | 90 (default 28), or startDate+endDate (YYYY-MM-DD)
 *
 * channel: sessions + totalUsers by sessionDefaultChannelGroup
 * source:  sessions by sessionSource/sessionMedium (top 25)
 * daily:   sessions by date × channel (for the stacked trend chart)
 */

import { supabase, getGoogleAccessToken } from './_google.js';

const DEFAULT_PROPERTY = '253496127';
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

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

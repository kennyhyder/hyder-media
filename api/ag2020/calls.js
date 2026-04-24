/**
 * AG2020 - Vonage VBC Calls
 * GET /api/ag2020/calls
 *
 * Query params:
 *   breakdown  - summary | daily | recent (default: summary)
 *   days       - number of days back (default: 30)
 *   startDate, endDate - explicit range override
 *
 * Status: STUB pending VBC OAuth setup. Returns { status: 'not_configured' }
 * until the following env vars are set in Vercel and OAuth is completed:
 *   AG2020_VONAGE_CLIENT_ID
 *   AG2020_VONAGE_CLIENT_SECRET
 *   AG2020_VONAGE_ACCOUNT_ID       (400386)
 *   AG2020_VONAGE_REDIRECT_URI     (e.g. https://hyder.me/api/vonage/callback)
 *
 * Vonage VBC API docs:
 *   OAuth:   https://developer.vonage.com/en/vonage-business-communications/concepts/authentication
 *   Insights: https://developer.vonage.com/en/api/voice.insights
 *   Call Logs: POST https://api.vonage.com/t/vbc.prod/insights/api/calls
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const clientId = process.env.AG2020_VONAGE_CLIENT_ID;
    const clientSecret = process.env.AG2020_VONAGE_CLIENT_SECRET;
    const accountId = process.env.AG2020_VONAGE_ACCOUNT_ID;

    if (!clientId || !clientSecret || !accountId) {
        return res.status(200).json({
            status: 'not_configured',
            setupRequired: true,
            message: 'Vonage VBC OAuth not yet configured',
            steps: [
                'Log in to https://developer.vonage.com',
                'Create a new API Application with VBC scopes enabled',
                'Add redirect URI: https://hyder.me/api/vonage/callback',
                'Add these env vars to Vercel: AG2020_VONAGE_CLIENT_ID, AG2020_VONAGE_CLIENT_SECRET, AG2020_VONAGE_ACCOUNT_ID, AG2020_VONAGE_REDIRECT_URI',
                'Visit /api/vonage/auth to complete OAuth and store tokens in Supabase',
            ],
        });
    }

    // --- Proceed once configured ---
    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const { startDate, endDate } = resolveDateRange(req.query);
    const result = { dateRange: { start: startDate, end: endDate }, breakdown, status: 'loading', errors: [] };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const accessToken = await getAccessToken(supabase, clientId, clientSecret);

        if (!accessToken) {
            result.status = 'not_configured';
            result.message = 'Vonage OAuth tokens not in database. Visit /api/vonage/auth to authorize.';
            return res.status(200).json(result);
        }

        if (breakdown === 'summary') {
            result.summary = await fetchCallSummary(accountId, accessToken, startDate, endDate);
        } else if (breakdown === 'daily') {
            result.daily = await fetchCallsDaily(accountId, accessToken, startDate, endDate);
        } else if (breakdown === 'recent') {
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            result.recent = await fetchCallsRecent(accountId, accessToken, startDate, endDate, limit);
        } else {
            result.status = 'error';
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            return res.status(200).json(result);
        }

        result.status = 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = 'error';
        return res.status(200).json(result);
    }
}

function resolveDateRange(query) {
    if (query.startDate && query.endDate) return { startDate: query.startDate, endDate: query.endDate };
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] };
}

// ============================================================================
// OAuth token management (same pattern as Google Ads)
// ============================================================================

async function getAccessToken(supabase, clientId, clientSecret) {
    const { data: conn } = await supabase
        .from('vonage_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!conn) return null;

    let accessToken = conn.access_token;

    if (new Date(conn.token_expires_at) < new Date() && conn.refresh_token) {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const refreshResponse = await fetch('https://api.vonage.com/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: conn.refresh_token,
            }),
        });
        const data = await refreshResponse.json();
        if (!data.access_token) throw new Error(`Vonage refresh failed: ${JSON.stringify(data)}`);

        accessToken = data.access_token;
        await supabase
            .from('vonage_connections')
            .update({
                access_token: accessToken,
                refresh_token: data.refresh_token || conn.refresh_token,
                token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
            })
            .eq('id', conn.id);
    }

    return accessToken;
}

// ============================================================================
// VBC Insights API (call logs)
// ============================================================================

const VBC_BASE = 'https://api.vonage.com/t/vbc.prod/insights/api';

async function fetchVbcCalls(accountId, accessToken, startDate, endDate, { page = 0, size = 100 } = {}) {
    const url = `${VBC_BASE}/accounts/${accountId}/calls?startTime=${startDate}T00:00:00Z&endTime=${endDate}T23:59:59Z&page=${page}&size=${size}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
        },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`VBC ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.json();
}

async function fetchCallSummary(accountId, accessToken, startDate, endDate) {
    // Get first page + use pagination metadata
    const first = await fetchVbcCalls(accountId, accessToken, startDate, endDate, { page: 0, size: 1 });
    const total = first.totalElements ?? first.total ?? 0;
    return { totalCalls: total, startDate, endDate };
}

async function fetchCallsDaily(accountId, accessToken, startDate, endDate) {
    // Paginate, bucket by date
    const byDay = {};
    const cur = new Date(startDate);
    const endD = new Date(endDate);
    while (cur <= endD) {
        const k = cur.toISOString().split('T')[0];
        byDay[k] = { date: k, count: 0, answered: 0, missed: 0, totalSeconds: 0 };
        cur.setDate(cur.getDate() + 1);
    }

    let page = 0;
    const MAX_PAGES = 20;
    while (page < MAX_PAGES) {
        const data = await fetchVbcCalls(accountId, accessToken, startDate, endDate, { page, size: 100 });
        const calls = data.content || data.calls || [];
        for (const c of calls) {
            const t = c.startTime || c.start_time || c.createdAt;
            if (!t) continue;
            const key = t.split('T')[0];
            if (!byDay[key]) byDay[key] = { date: key, count: 0, answered: 0, missed: 0, totalSeconds: 0 };
            byDay[key].count += 1;
            const answered = c.answered ?? (c.status === 'answered') ?? (c.state === 'ANSWERED');
            if (answered) byDay[key].answered += 1; else byDay[key].missed += 1;
            byDay[key].totalSeconds += parseInt(c.duration || c.durationSeconds || 0, 10);
        }
        const got = calls.length;
        if (got < 100) break;
        page += 1;
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchCallsRecent(accountId, accessToken, startDate, endDate, limit) {
    const data = await fetchVbcCalls(accountId, accessToken, startDate, endDate, { page: 0, size: limit });
    return (data.content || data.calls || []).map(c => ({
        id: c.id || c.callId,
        startTime: c.startTime || c.start_time,
        direction: c.direction,
        status: c.status || c.state,
        from: c.from || c.caller,
        to: c.to || c.callee,
        duration: c.duration || c.durationSeconds,
        extension: c.extension,
    }));
}

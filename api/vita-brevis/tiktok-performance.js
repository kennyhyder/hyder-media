/**
 * TikTok Ads - Vita Brevis Performance
 * GET /api/vita-brevis/tiktok-performance
 *
 * Business Center: 7094682853576916994 (single advertiser within it).
 *
 * Query params:
 *   breakdown  - summary | daily | monthly | campaign  (default: summary)
 *   days       - lookback window from today (default: 30)
 *
 * Reads access_token from tiktok_ads_connections, refreshes if expired.
 * advertiser_ids[0] from the connection is used as the queried advertiser.
 */

import { createClient } from '@supabase/supabase-js';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const REPORT_URL = `${TT_BASE}/report/integrated/get/`;
const REFRESH_URL = `${TT_BASE}/oauth2/refresh_token/`;
const BC_ID = '7094682853576916994';

// Metrics requested for every breakdown.
// Names follow TikTok Marketing API v1.3 — video percentiles use `video_views_pN`,
// NOT `video_watched_Np` (the latter is rejected as 40002 invalid metric).
const BASE_METRICS = [
    'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
    'reach', 'frequency',
    'conversion', 'cost_per_conversion', 'conversion_rate',
    'video_play_actions', 'video_watched_2s', 'video_watched_6s',
    'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
    'engaged_view', 'profile_visits', 'follows', 'likes', 'comments', 'shares',
];

// Extra fields on the campaign-level report. campaign_id is already the dimension,
// so we only ask for descriptive fields (name + objective).
const CAMPAIGN_FIELDS = ['campaign_name', 'objective_type'];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const { start: startDate, end: endDate } = resolveDateRange(req.query);

    const result = {
        bcId: BC_ID,
        dateRange: { start: startDate, end: endDate },
        breakdown,
        status: 'loading',
        errors: [],
    };

    try {
        const { accessToken, advertiserId } = await getCredentials();
        if (!advertiserId) {
            return res.status(200).json({
                ...result, status: 'not_configured', needsAuth: true,
                message: 'No TikTok advertiser found. Authorize at /api/tiktok-ads/auth.',
            });
        }
        result.advertiserId = advertiserId;

        if (breakdown === 'summary') {
            result.summary = await fetchSummary(accessToken, advertiserId, startDate, endDate);
        } else if (breakdown === 'daily') {
            result.daily = await fetchTimeSeries(accessToken, advertiserId, startDate, endDate, 'day');
        } else if (breakdown === 'monthly') {
            const daily = await fetchTimeSeries(accessToken, advertiserId, startDate, endDate, 'day');
            result.monthly = aggregateByMonth(daily);
        } else if (breakdown === 'campaign') {
            result.campaigns = await fetchCampaignBreakdown(accessToken, advertiserId, startDate, endDate);
        } else {
            result.status = 'error';
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            return res.status(200).json(result);
        }

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = classifyError(err.message);
        if (result.status === 'needs_reauth') {
            result.message = 'TikTok token invalid — re-authorize at /api/tiktok-ads/auth';
        }
        return res.status(200).json(result);
    }
}

function resolveDateRange(query) {
    if (query.startDate && query.endDate) {
        return { start: query.startDate, end: query.endDate };
    }
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
    };
}

// Map error message → status. Use word-boundary matching so we don't flag
// a generic field-validation error that happens to contain "auth" inside
// the substring "authorized" or "authenticator" etc.
function classifyError(message) {
    const m = (message || '').toLowerCase();
    if (m.includes('no tiktok connection') || m.includes('not found')) return 'not_configured';
    // QPS / rate limit — not an auth issue, just transient
    if (m.includes('qps limit') || m.includes('rate limit')) return 'error';
    // TikTok auth-failure phrases
    if (/\bunauth\w*\b/.test(m)) return 'needs_reauth';
    if (/\binvalid\s+token\b/.test(m) || /\bexpired\s+token\b/.test(m)) return 'needs_reauth';
    if (/\baccess[\s_-]?token\b/.test(m) && /(invalid|expired|missing)/.test(m)) return 'needs_reauth';
    // 40104 = invalid token, 40105 = token expired. 40100 is too generic
    // (used for both auth failures AND rate limits) so we only flag it as
    // re-auth when paired with auth keywords above.
    if (/\bcode\s+(40104|40105)\b/.test(m)) return 'needs_reauth';
    return 'error';
}

// ============================================================================
// Credentials
// ============================================================================

async function getCredentials() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error } = await supabase
        .from('tiktok_ads_connections').select('*')
        .order('updated_at', { ascending: false }).limit(1).single();

    if (error || !connection) throw new Error('No TikTok connection found');

    let accessToken = connection.access_token;
    const advertiserIds = Array.isArray(connection.advertiser_ids) ? connection.advertiser_ids : [];
    const advertiserId = advertiserIds[0] ? String(advertiserIds[0]) : null;

    // Refresh if expired
    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const refreshResp = await fetch(REFRESH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: process.env.TIKTOK_APP_ID,
                secret: process.env.TIKTOK_APP_SECRET,
                refresh_token: connection.refresh_token,
            }),
        });
        const refreshJson = await refreshResp.json();
        if (refreshJson.code === 0 && refreshJson.data?.access_token) {
            const d = refreshJson.data;
            accessToken = d.access_token;
            await supabase.from('tiktok_ads_connections').update({
                access_token: d.access_token,
                refresh_token: d.refresh_token || connection.refresh_token,
                token_expires_at: new Date(Date.now() + (d.expires_in || 31536000) * 1000).toISOString(),
                refresh_token_expires_at: d.refresh_token_expires_in
                    ? new Date(Date.now() + d.refresh_token_expires_in * 1000).toISOString()
                    : connection.refresh_token_expires_at,
                updated_at: new Date().toISOString(),
            }).eq('id', connection.id);
        }
        // If refresh fails, fall through with the (probably-expired) token —
        // TikTok will return an auth error which we surface as needs_reauth.
    }

    return { accessToken, advertiserId };
}

// ============================================================================
// Reporting
// ============================================================================

async function tiktokGet(url, accessToken, params) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params || {})) {
        if (v == null) continue;
        u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const resp = await fetch(u.toString(), {
        headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (data.code !== 0) {
        throw new Error(`TikTok API: ${data.message || 'unknown error'} (code ${data.code})`);
    }
    return data.data || {};
}

function metricsFromRow(row) {
    const m = row.metrics || {};
    const num = v => v == null || v === '' ? 0 : parseFloat(v) || 0;
    return {
        spend: num(m.spend),
        impressions: num(m.impressions),
        clicks: num(m.clicks),
        reach: num(m.reach),
        frequency: num(m.frequency),
        ctr: num(m.ctr) / 100,           // TikTok returns CTR as percentage 0-100
        cpc: num(m.cpc),
        cpm: num(m.cpm),
        conversions: num(m.conversion),
        costPerConv: num(m.cost_per_conversion),
        convRate: num(m.conversion_rate) / 100,
        videoPlays: num(m.video_play_actions),
        video2s: num(m.video_watched_2s),
        video6s: num(m.video_watched_6s),
        video25p: num(m.video_views_p25),
        video50p: num(m.video_views_p50),
        video75p: num(m.video_views_p75),
        video100p: num(m.video_views_p100),
        engagedView: num(m.engaged_view),
        profileVisits: num(m.profile_visits),
        follows: num(m.follows),
        likes: num(m.likes),
        comments: num(m.comments),
        shares: num(m.shares),
    };
}

async function fetchSummary(accessToken, advertiserId, startDate, endDate) {
    const data = await tiktokGet(REPORT_URL, accessToken, {
        advertiser_id: advertiserId,
        service_type: 'AUCTION',
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: ['advertiser_id'],
        metrics: BASE_METRICS,
        start_date: startDate,
        end_date: endDate,
        page: 1,
        page_size: 1,
    });
    const list = data.list || [];
    if (!list.length) return emptyMetrics();
    return metricsFromRow(list[0]);
}

async function fetchTimeSeries(accessToken, advertiserId, startDate, endDate, granularity) {
    // TikTok caps stat_time_day queries at 30 days AND rate-limits the app
    // at 10 QPS. Chunk into <=28-day windows and use a concurrency-limited
    // pool (max 4 in flight) so 13 chunks for a 12-month range don't trip
    // the QPS limit.
    const chunks = chunkDateRange(startDate, endDate, 28);
    const chunkResults = await pMap(
        chunks,
        ({ start, end }) => fetchDailyChunkWithRetry(accessToken, advertiserId, start, end),
        4
    );
    const out = chunkResults.flat();
    out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return out;
}

async function pMap(items, mapper, concurrency) {
    const results = new Array(items.length);
    let i = 0;
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, items.length); w++) {
        workers.push((async () => {
            while (true) {
                const idx = i++;
                if (idx >= items.length) break;
                results[idx] = await mapper(items[idx], idx);
            }
        })());
    }
    await Promise.all(workers);
    return results;
}

async function fetchDailyChunkWithRetry(accessToken, advertiserId, startDate, endDate) {
    // Retry once on rate-limit. TikTok returns code 40100 + "QPS limit" message
    // when we hit the cap.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await fetchDailyChunk(accessToken, advertiserId, startDate, endDate);
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            const isRateLimit = msg.includes('qps limit') || msg.includes('rate limit') ||
                                /\bcode\s+50002\b/.test(msg);
            if (!isRateLimit || attempt === 2) throw err;
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
    }
}

function chunkDateRange(startDate, endDate, maxDays) {
    const chunks = [];
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    let cur = new Date(start);
    while (cur <= end) {
        const chunkEnd = new Date(cur);
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
        if (chunkEnd > end) chunkEnd.setTime(end.getTime());
        chunks.push({
            start: cur.toISOString().slice(0, 10),
            end: chunkEnd.toISOString().slice(0, 10),
        });
        cur = new Date(chunkEnd);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return chunks;
}

async function fetchDailyChunk(accessToken, advertiserId, startDate, endDate) {
    const out = [];
    let page = 1;
    const pageSize = 1000;
    while (true) {
        const data = await tiktokGet(REPORT_URL, accessToken, {
            advertiser_id: advertiserId,
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_ADVERTISER',
            dimensions: ['stat_time_day'],
            metrics: BASE_METRICS,
            start_date: startDate,
            end_date: endDate,
            page,
            page_size: pageSize,
        });
        const list = data.list || [];
        for (const r of list) {
            const m = metricsFromRow(r);
            const date = (r.dimensions?.stat_time_day || '').split(' ')[0];
            out.push({ date, ...m });
        }
        const total = data.page_info?.total_number || 0;
        if (page * pageSize >= total || !list.length) break;
        page += 1;
    }
    return out;
}

function aggregateByMonth(daily) {
    const byMonth = {};
    for (const d of daily) {
        const key = (d.date || '').slice(0, 7);  // YYYY-MM
        if (!key) continue;
        if (!byMonth[key]) byMonth[key] = { month: key, ...emptyMetrics() };
        for (const k of Object.keys(d)) {
            if (k === 'date') continue;
            byMonth[key][k] = (byMonth[key][k] || 0) + (d[k] || 0);
        }
    }
    // Recompute rates that don't sum
    for (const m of Object.values(byMonth)) {
        m.ctr = m.impressions > 0 ? m.clicks / m.impressions : 0;
        m.cpc = m.clicks > 0 ? m.spend / m.clicks : 0;
        m.cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0;
        m.convRate = m.clicks > 0 ? m.conversions / m.clicks : 0;
        m.costPerConv = m.conversions > 0 ? m.spend / m.conversions : 0;
        m.frequency = m.reach > 0 ? m.impressions / m.reach : 0;
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
}

async function fetchCampaignBreakdown(accessToken, advertiserId, startDate, endDate) {
    const out = [];
    let page = 1;
    const pageSize = 200;
    while (true) {
        const data = await tiktokGet(REPORT_URL, accessToken, {
            advertiser_id: advertiserId,
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_CAMPAIGN',
            dimensions: ['campaign_id'],
            metrics: [...BASE_METRICS, ...CAMPAIGN_FIELDS],
            start_date: startDate,
            end_date: endDate,
            page,
            page_size: pageSize,
        });
        const list = data.list || [];
        for (const r of list) {
            const m = metricsFromRow(r);
            out.push({
                id: r.dimensions?.campaign_id || '',
                name: r.metrics?.campaign_name || '',
                objective: r.metrics?.objective_type || '',
                ...m,
            });
        }
        const total = data.page_info?.total_number || 0;
        if (page * pageSize >= total || !list.length) break;
        page += 1;
    }
    out.sort((a, b) => b.spend - a.spend);
    return out;
}

function emptyMetrics() {
    return {
        spend: 0, impressions: 0, clicks: 0, reach: 0, frequency: 0,
        ctr: 0, cpc: 0, cpm: 0,
        conversions: 0, costPerConv: 0, convRate: 0,
        videoPlays: 0, video2s: 0, video25p: 0, video50p: 0, video75p: 0, video100p: 0,
        engagedView: 0, profileVisits: 0, follows: 0, likes: 0, comments: 0, shares: 0,
    };
}

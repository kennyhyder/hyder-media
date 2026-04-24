/**
 * AG2020 - VBC Call Logs (from uploaded CSV data)
 * GET /api/ag2020/calls
 *
 * Query params:
 *   breakdown  - summary | daily | recent | uploads (default: summary)
 *   days       - number of days back (default: 30)
 *   startDate, endDate - explicit range override
 *   limit      - max recent calls to return (default 50, max 500)
 *
 * Data source: ag2020_call_logs Supabase table (populated via CSV upload at
 * /api/ag2020/call-log-upload).
 *
 * Why CSV: VBC account 400386 is below the 50-extension threshold Vonage
 * requires for direct API access. Manual CSV export from bc.vonage.com is
 * the practical workaround.
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const { startDate, endDate } = resolveDateRange(req.query);
    const result = {
        dateRange: { start: startDate, end: endDate },
        breakdown,
        source: 'csv-upload',
        status: 'loading',
        errors: [],
    };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        // Check if any call data exists
        const { count: totalCallsInDb, error: countErr } = await supabase
            .from('ag2020_call_logs')
            .select('id', { count: 'exact', head: true });

        if (countErr) {
            result.errors.push({ step: 'count_check', error: countErr.message });
            result.status = 'error';
            return res.status(200).json(result);
        }

        if (!totalCallsInDb || totalCallsInDb === 0) {
            return res.status(200).json({
                ...result,
                status: 'not_configured',
                setupRequired: true,
                message: 'No call log data uploaded yet',
                context: 'VBC account #400386 is under the 50-extension threshold Vonage requires for direct API access. Export call history from bc.vonage.com and upload it here to enable reporting.',
                options: [
                    {
                        title: 'Upload CSV (recommended)',
                        detail: 'Export call history from the VBC admin at bc.vonage.com and upload the CSV via the drag-drop area below. Uploads accumulate across months and dedupe automatically.',
                    },
                    {
                        title: 'Request VBC API access',
                        detail: 'If AG2020 scales past 50 extensions, Vonage CSM can enable direct API access (OAuth 2.0, 24h tokens).',
                    },
                    {
                        title: 'Voice API tracking numbers',
                        detail: 'Alternatively, route calls through Vonage Voice API numbers under a separate developer account; real-time logs available via simple api_key + api_secret.',
                    },
                ],
            });
        }

        const rangeStartIso = `${startDate}T00:00:00Z`;
        const rangeEndIso = `${endDate}T23:59:59Z`;

        if (breakdown === 'summary') {
            result.summary = await fetchSummary(supabase, rangeStartIso, rangeEndIso);
            result.totalInDb = totalCallsInDb;
        } else if (breakdown === 'daily') {
            result.daily = await fetchDaily(supabase, rangeStartIso, rangeEndIso, startDate, endDate);
        } else if (breakdown === 'recent') {
            const limit = Math.min(parseInt(req.query.limit) || 50, 500);
            result.recent = await fetchRecent(supabase, rangeStartIso, rangeEndIso, limit);
        } else if (breakdown === 'uploads') {
            result.uploads = await fetchUploads(supabase);
        } else {
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            result.status = 'error';
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

// Supabase/PostgREST caps a single SELECT at 1000 rows by default. Paginate
// through the result set using .range() so large date ranges return real totals.
async function selectAll(queryFactory, pageSize = 1000, hardLimit = 200000) {
    const rows = [];
    for (let offset = 0; offset < hardLimit; offset += pageSize) {
        const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
        if (error) throw new Error(error.message);
        const chunk = data || [];
        rows.push(...chunk);
        if (chunk.length < pageSize) break;
    }
    return rows;
}

async function fetchSummary(supabase, startIso, endIso) {
    const data = await selectAll(() =>
        supabase
            .from('ag2020_call_logs')
            .select('id,direction,answered,duration_seconds')
            .gte('call_time', startIso)
            .lte('call_time', endIso)
            .order('call_time', { ascending: true })
    );

    let inbound = 0, outbound = 0, internal = 0, other = 0;
    let answered = 0, missed = 0;
    let totalDuration = 0;

    for (const r of data) {
        if (r.direction === 'inbound') inbound++;
        else if (r.direction === 'outbound') outbound++;
        else if (r.direction === 'internal') internal++;
        else other++;

        if (r.answered) answered++; else missed++;
        totalDuration += r.duration_seconds || 0;
    }

    const totalCalls = data.length;
    return {
        totalCalls,
        inbound,
        outbound,
        internal,
        other,
        answered,
        missed,
        answerRate: totalCalls > 0 ? answered / totalCalls : 0,
        totalDurationSeconds: totalDuration,
        avgDurationSeconds: answered > 0 ? totalDuration / answered : 0,
    };
}

async function fetchDaily(supabase, startIso, endIso, startDate, endDate) {
    const data = await selectAll(() =>
        supabase
            .from('ag2020_call_logs')
            .select('call_time,answered,duration_seconds,direction')
            .gte('call_time', startIso)
            .lte('call_time', endIso)
            .order('call_time', { ascending: true })
    );

    const byDay = {};
    const cur = new Date(startDate);
    const end = new Date(endDate);
    while (cur <= end) {
        const k = cur.toISOString().split('T')[0];
        byDay[k] = { date: k, count: 0, answered: 0, missed: 0, inbound: 0, outbound: 0, totalSeconds: 0 };
        cur.setDate(cur.getDate() + 1);
    }

    for (const r of data || []) {
        const key = r.call_time.slice(0, 10);
        if (!byDay[key]) byDay[key] = { date: key, count: 0, answered: 0, missed: 0, inbound: 0, outbound: 0, totalSeconds: 0 };
        byDay[key].count += 1;
        if (r.answered) byDay[key].answered += 1; else byDay[key].missed += 1;
        if (r.direction === 'inbound') byDay[key].inbound += 1;
        else if (r.direction === 'outbound') byDay[key].outbound += 1;
        byDay[key].totalSeconds += r.duration_seconds || 0;
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchRecent(supabase, startIso, endIso, limit) {
    const { data, error } = await supabase
        .from('ag2020_call_logs')
        .select('id,call_time,direction,from_number,to_number,extension,user_name,duration_seconds,answered,status')
        .gte('call_time', startIso)
        .lte('call_time', endIso)
        .order('call_time', { ascending: false })
        .limit(limit);

    if (error) throw new Error(error.message);
    return data || [];
}

async function fetchUploads(supabase) {
    const { data, error } = await supabase
        .from('ag2020_call_log_uploads')
        .select('id,filename,total_rows,inserted,duplicates,errors,date_range_start,date_range_end,created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) throw new Error(error.message);
    return data || [];
}

/**
 * AG2020 - VBC Call Logs
 * GET /api/ag2020/calls
 *
 * Query params:
 *   breakdown  - summary | daily | recent | uploads (default: summary)
 *   days       - number of days back (default: 30)
 *   startDate, endDate - explicit range override
 *   limit      - max recent calls to return (default 50, max 500)
 *
 * Data sources (queried + UNIONed):
 *   1) ag2020_call_logs — populated by /api/ag2020/call-log-upload (the old
 *      "All Calls" Vonage CSV format with no phone numbers but unique ids).
 *   2) ag2020_lead_touchpoints WHERE touchpoint_type IN
 *      (call_inbound, call_outbound, voicemail, missed_call) — populated by
 *      the Vonage "Company Report" CSV backfill (newer format, has phones).
 *      This is the more current source going forward.
 *
 * Why both: VBC account 400386 is below the 50-extension threshold Vonage
 * requires for direct API access. We're stuck on CSV exports. The Company
 * Report format is the only one with phone numbers, so it's what the
 * attribution pipeline ingests. We merge both so the dashboard sees every
 * call regardless of which CSV format brought it in.
 *
 * Dedupe: touchpoints don't carry the call_logs.call_hash, so we dedupe
 * by `(direction, timestamp-bucketed-to-minute, duration_seconds)` — close
 * enough for display purposes; a stray duplicate is far better than missing
 * a month of data.
 */

import { createClient } from '@supabase/supabase-js';

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

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

        // Check if any call data exists (either source)
        const [{ count: logsCount, error: logsErr }, { count: tpCount, error: tpErr }] = await Promise.all([
            supabase.from('ag2020_call_logs').select('id', { count: 'exact', head: true }),
            supabase.from('ag2020_lead_touchpoints').select('id', { count: 'exact', head: true })
                .in('touchpoint_type', ['call_inbound', 'call_outbound', 'voicemail', 'missed_call']),
        ]);
        const totalCallsInDb = (logsCount || 0) + (tpCount || 0);

        if (logsErr && tpErr) {
            result.errors.push({ step: 'count_check', error: (logsErr || tpErr).message });
            result.status = 'error';
            return res.status(200).json(result);
        }

        if (totalCallsInDb === 0) {
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

// Pull calls from both ag2020_call_logs and ag2020_lead_touchpoints in the
// window, normalize into a common shape {ts, direction, answered, duration},
// dedupe by (direction, minute, duration). Returns the merged array.
async function fetchMergedCalls(supabase, startIso, endIso, extraFields = false) {
    const fromLogs = await selectAll(() =>
        supabase
            .from('ag2020_call_logs')
            .select(extraFields
                ? 'id,call_time,direction,answered,duration_seconds,from_number,to_number,extension,user_name,status'
                : 'call_time,direction,answered,duration_seconds')
            .gte('call_time', startIso)
            .lte('call_time', endIso)
            .order('call_time', { ascending: true })
    );
    const fromTouch = await selectAll(() =>
        supabase
            .from('ag2020_lead_touchpoints')
            .select(extraFields
                ? 'id,touchpoint_at,touchpoint_type,direction,duration_seconds,payload'
                : 'touchpoint_at,touchpoint_type,direction,duration_seconds')
            .in('touchpoint_type', ['call_inbound', 'call_outbound', 'voicemail', 'missed_call'])
            .gte('touchpoint_at', startIso)
            .lte('touchpoint_at', endIso)
            .order('touchpoint_at', { ascending: true })
    );
    const merged = [];
    for (const r of fromLogs) {
        merged.push({
            source: 'call_logs',
            ts: r.call_time,
            direction: r.direction || 'other',
            answered: !!r.answered,
            duration_seconds: r.duration_seconds || 0,
            ...(extraFields && {
                id: `cl-${r.id}`,
                from_number: r.from_number,
                to_number: r.to_number,
                extension: r.extension,
                user_name: r.user_name,
                status: r.status,
            }),
        });
    }
    for (const r of fromTouch) {
        const type = r.touchpoint_type;
        // Prefer the Vonage payload.result field ('answered'/'missed'/etc) when
        // the backfill captured it; otherwise infer from touchpoint_type.
        const result = (r.payload?.result || '').toLowerCase();
        const answered = result
            ? result === 'answered'
            : (type === 'call_inbound' || type === 'call_outbound');
        merged.push({
            source: 'touchpoints',
            ts: r.touchpoint_at,
            direction: r.direction || (type.includes('outbound') ? 'outbound' : 'inbound'),
            answered,
            duration_seconds: r.duration_seconds || 0,
            ...(extraFields && {
                id: `tp-${r.id}`,
                from_number: r.payload?.From || r.payload?.from || r.payload?.Caller || null,
                to_number: r.payload?.To || r.payload?.to || r.payload?.Called || null,
                extension: null,
                user_name: r.payload?.user || null,
                status: type,
            }),
        });
    }
    // Dedupe by (direction, minute-bucket of ts, duration_seconds). When a
    // touchpoint and a call_logs row describe the same call, the touchpoint
    // wins (more accurate phone/payload fields).
    const seen = new Map();
    for (const r of merged) {
        const minute = (r.ts || '').slice(0, 16); // YYYY-MM-DDTHH:MM
        const key = `${r.direction}|${minute}|${r.duration_seconds}`;
        const existing = seen.get(key);
        if (!existing || (existing.source === 'call_logs' && r.source === 'touchpoints')) {
            seen.set(key, r);
        }
    }
    return [...seen.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

async function fetchSummary(supabase, startIso, endIso) {
    const data = await fetchMergedCalls(supabase, startIso, endIso);

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
    const data = await fetchMergedCalls(supabase, startIso, endIso);

    const byDay = {};
    const cur = new Date(startDate);
    const end = new Date(endDate);
    while (cur <= end) {
        const k = cur.toISOString().split('T')[0];
        byDay[k] = { date: k, count: 0, answered: 0, missed: 0, inbound: 0, outbound: 0, totalSeconds: 0 };
        cur.setDate(cur.getDate() + 1);
    }

    for (const r of data || []) {
        const key = (r.ts || '').slice(0, 10);
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
    const data = await fetchMergedCalls(supabase, startIso, endIso, true);
    // most recent first, capped at `limit`
    return data.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit).map(r => ({
        id: r.id,
        call_time: r.ts,
        direction: r.direction,
        from_number: r.from_number,
        to_number: r.to_number,
        extension: r.extension,
        user_name: r.user_name,
        duration_seconds: r.duration_seconds,
        answered: r.answered,
        status: r.status,
    }));
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

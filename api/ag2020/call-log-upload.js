/**
 * AG2020 - VBC Call Log CSV Upload
 * POST /api/ag2020/call-log-upload
 *
 * Body: { filename: string, rows: [{ ...csvRow }], mapping?: {...} }
 *
 * Normalizes VBC call log CSV exports and upserts into ag2020_call_logs.
 * Dedupe is by sha256 hash of (call_time, from_number, to_number, duration).
 *
 * Auto-detects columns by common VBC header names. User can override via `mapping`.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const MAX_ROWS = 10000;

// ============================================================================
// Column detection
// ============================================================================

// Map normalized field -> regex patterns matching VBC CSV headers (case-insensitive)
const COLUMN_PATTERNS = {
    call_time: [
        /^call\s*date(\s*\/?\s*time)?$/i,
        /^date(\s*\/?\s*time)?$/i,
        /^start\s*time$/i,
        /^timestamp$/i,
        /^time$/i,
        /^call\s*start$/i,
    ],
    direction: [
        /^(call\s*)?direction$/i,
        /^(call\s*)?type$/i,
        /^in\s*\/?\s*out$/i,
    ],
    from_number: [
        /^from(\s*(number|phone|caller))?$/i,
        /^caller(\s*(id|number|phone))?$/i,
        /^origin(\s*number)?$/i,
        /^source$/i,
        /^a\s*number$/i,
    ],
    to_number: [
        /^to(\s*(number|phone|callee))?$/i,
        /^callee(\s*(number|phone))?$/i,
        /^destination(\s*number)?$/i,
        /^b\s*number$/i,
    ],
    extension: [
        /^extension$/i,
        /^ext$/i,
        /^user\s*extension$/i,
    ],
    user_name: [
        /^(user|employee|agent|handled\s*by)(\s*name)?$/i,
        /^name$/i,
    ],
    duration_seconds: [
        /^duration(\s*\((s|sec|seconds)\))?$/i,
        /^call\s*duration$/i,
        /^talk\s*time$/i,
        /^length$/i,
    ],
    status: [
        /^(call\s*)?status$/i,
        /^result$/i,
        /^disposition$/i,
    ],
    answered: [
        /^answered$/i,
        /^was\s*answered$/i,
    ],
};

function detectColumns(headers) {
    const mapping = {};
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
        for (const header of headers) {
            const clean = String(header || '').trim();
            if (patterns.some(rx => rx.test(clean))) {
                mapping[field] = header;
                break;
            }
        }
    }
    return mapping;
}

// ============================================================================
// Value normalization
// ============================================================================

function parseCallTime(v) {
    if (!v) return null;
    // Try common VBC formats
    // "2026-04-24 13:45:30", "04/24/2026 1:45 PM", ISO 8601, etc.
    const s = String(v).trim();
    // Direct Date parsing (JS handles most common formats)
    let d = new Date(s);
    if (isNaN(d.getTime())) {
        // Try MM/DD/YYYY HH:MM:SS format
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (m) {
            let [, mo, da, yr, hr, mi, se, ap] = m;
            hr = parseInt(hr, 10);
            if (ap && ap.toUpperCase() === 'PM' && hr < 12) hr += 12;
            if (ap && ap.toUpperCase() === 'AM' && hr === 12) hr = 0;
            d = new Date(`${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}T${String(hr).padStart(2, '0')}:${mi}:${se || '00'}`);
        }
    }
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
}

function parseDuration(v) {
    if (v == null || v === '') return 0;
    const s = String(v).trim();
    // "HH:MM:SS" or "MM:SS" or "123" or "2m 30s"
    if (/^\d+:\d+:\d+$/.test(s)) {
        const [h, m, se] = s.split(':').map(Number);
        return h * 3600 + m * 60 + se;
    }
    if (/^\d+:\d+$/.test(s)) {
        const [m, se] = s.split(':').map(Number);
        return m * 60 + se;
    }
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
}

function parseDirection(v) {
    if (!v) return null;
    const s = String(v).toLowerCase().trim();
    if (/\b(in(bound|coming)|received)\b/.test(s)) return 'inbound';
    if (/\b(out(bound|going)|dialed|placed)\b/.test(s)) return 'outbound';
    if (/\binternal\b/.test(s)) return 'internal';
    return s.slice(0, 20);
}

function parseAnswered(statusVal, answeredVal) {
    if (answeredVal != null && answeredVal !== '') {
        const s = String(answeredVal).toLowerCase().trim();
        if (['yes', 'true', '1', 'y', 'answered'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'missed'].includes(s)) return false;
    }
    if (statusVal) {
        const s = String(statusVal).toLowerCase();
        if (/answer|completed|connected/.test(s)) return true;
        if (/miss|no\s*answer|busy|fail|cancel|voicemail/.test(s)) return false;
    }
    return false;
}

function normalizePhone(v) {
    if (!v) return null;
    return String(v).replace(/[^\d+*#]/g, '').slice(0, 50) || null;
}

function hashRow({ callTime, fromNumber, toNumber, duration }) {
    const payload = [callTime || '', fromNumber || '', toNumber || '', duration || 0].join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 64);
}

// ============================================================================
// Handler
// ============================================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { filename, rows, mapping: userMapping } = req.body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'Body must include a non-empty rows array' });
    }
    if (rows.length > MAX_ROWS) {
        return res.status(400).json({ error: `Too many rows (${rows.length}). Max ${MAX_ROWS} per upload.` });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Column detection
    const headers = Object.keys(rows[0] || {});
    const mapping = { ...detectColumns(headers), ...(userMapping || {}) };

    if (!mapping.call_time) {
        return res.status(400).json({
            error: 'Could not auto-detect the call time column. Please upload a CSV with a header like "Call Date", "Start Time", or "Timestamp", or provide a mapping.',
            detectedHeaders: headers,
            detectedMapping: mapping,
        });
    }

    const batchId = crypto.randomUUID();
    const toInsert = [];
    const errors = [];
    let minDate = null;
    let maxDate = null;

    for (const [i, row] of rows.entries()) {
        try {
            const callTimeIso = parseCallTime(row[mapping.call_time]);
            if (!callTimeIso) {
                errors.push({ row: i + 1, error: 'Missing or unparseable call_time' });
                continue;
            }
            const fromNumber = normalizePhone(row[mapping.from_number]);
            const toNumber = normalizePhone(row[mapping.to_number]);
            const duration = parseDuration(row[mapping.duration_seconds]);
            const direction = parseDirection(row[mapping.direction]);
            const status = mapping.status ? String(row[mapping.status] || '').slice(0, 50) : null;
            const answered = parseAnswered(status, mapping.answered ? row[mapping.answered] : null);
            const extension = mapping.extension ? String(row[mapping.extension] || '').slice(0, 50) : null;
            const userName = mapping.user_name ? String(row[mapping.user_name] || '').slice(0, 200) : null;

            const callHash = hashRow({ callTime: callTimeIso, fromNumber, toNumber, duration });

            toInsert.push({
                call_hash: callHash,
                call_time: callTimeIso,
                direction,
                from_number: fromNumber,
                to_number: toNumber,
                extension: extension || null,
                user_name: userName || null,
                duration_seconds: duration,
                answered,
                status: status || null,
                raw_row: row,
                upload_batch: batchId,
            });

            const d = callTimeIso.slice(0, 10);
            if (!minDate || d < minDate) minDate = d;
            if (!maxDate || d > maxDate) maxDate = d;
        } catch (err) {
            errors.push({ row: i + 1, error: err.message });
        }
    }

    // Upsert with on_conflict=call_hash (ignore duplicates)
    let inserted = 0;
    let duplicates = 0;

    if (toInsert.length > 0) {
        // Insert in chunks of 1000
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
            const chunk = toInsert.slice(i, i + CHUNK_SIZE);
            const { data, error } = await supabase
                .from('ag2020_call_logs')
                .upsert(chunk, { onConflict: 'call_hash', ignoreDuplicates: true })
                .select('id');

            if (error) {
                errors.push({ step: 'supabase_upsert', error: error.message });
                continue;
            }
            const insertedCount = (data || []).length;
            inserted += insertedCount;
            duplicates += chunk.length - insertedCount;
        }
    }

    // Record the upload audit row
    await supabase.from('ag2020_call_log_uploads').insert({
        id: batchId,
        filename: filename || null,
        total_rows: rows.length,
        inserted,
        duplicates,
        errors: errors.length,
        error_details: errors.slice(0, 100),
        date_range_start: minDate,
        date_range_end: maxDate,
        column_mapping: mapping,
    });

    return res.status(200).json({
        status: errors.length === 0 ? 'success' : 'partial',
        batchId,
        totalRows: rows.length,
        inserted,
        duplicates,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
        mapping,
        dateRange: { start: minDate, end: maxDate },
    });
}

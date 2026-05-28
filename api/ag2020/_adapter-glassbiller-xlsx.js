/**
 * AG2020 — GlassBiller XLSX ingester
 *
 * Underscore-prefixed so Vercel does NOT treat this as a routable function.
 * Imported by `clients/ag2020/scripts/ingest-glassbiller-xlsx.js` (the local
 * CLI runner) and — eventually — by a future `crm-jobs-upload.js` Vercel
 * endpoint when the dashboard gets an upload widget.
 *
 * Targets the preferred GlassBiller export format documented in
 * `docs/glassbiller-csv-schema.md` §6:
 *   "Sales-and-margin-report-(<range>)_<YYYY-MM-DD>.xlsx"
 * — 15 columns, one combined sheet, includes Contact Phone 1, Customer Email,
 * Contact Name, Invoice Date, Location Name, and full financials.
 *
 * Exports:
 *   parseGlassbillerXlsx(filePath) → normalized rows
 *   ingestRows(supabase, tenantId, rows, uploadBatch, filename) → stats
 *   linkJobsToJourneys(supabase, tenantId) → link stats (phone/email match)
 */

import XLSX from 'xlsx';
import crypto from 'crypto';
import { normalizePhone, normalizeEmail } from './_attribution-lib.js';

// Column indexes (0-based) in the GlassBiller XLSX. Col 0 is unnamed (row #).
const COL = {
    contact_name: 1,
    customer_email: 2,
    contact_phone: 3,
    invoice_date: 4,
    total_margin: 5,
    total_cost: 6,                     // first occurrence; col 9 is a dup, ignored
    total_after_taxes: 7,
    total_balance_after_payments: 8,
    total_customer_rebate: 10,
    total_subtotal: 11,
    total_taxes: 12,
    total_labor: 13,
    location_name: 14,
};

function cleanDash(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s === '-' || s === ' - ') return null;
    return s;
}

function parseCurrency(v) {
    const s = cleanDash(v);
    if (s == null) return null;
    const cleaned = s.replace(/[$,\s]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
    const s = cleanDash(v);
    if (s == null) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return null;
}

export function parseGlassbillerXlsx(filePath) {
    return parseGlassbillerWorkbook(XLSX.readFile(filePath));
}

/**
 * Parse a GlassBiller workbook (loaded from any source — file, buffer, etc.)
 * into normalized rows. Use this when the XLSX is in-memory (e.g., from an
 * email-parser POST payload).
 */
export function parseGlassbillerBuffer(buffer) {
    return parseGlassbillerWorkbook(XLSX.read(buffer, { type: 'buffer' }));
}

export function parseGlassbillerWorkbook(wb) {
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error('No sheet in workbook');
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
    if (aoa.length < 2) return [];

    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i];
        if (!r || r.every(c => c == null || String(c).trim() === '')) continue;
        rows.push({
            contact_name:                 cleanDash(r[COL.contact_name]),
            customer_email:               cleanDash(r[COL.customer_email]),
            contact_phone:                cleanDash(r[COL.contact_phone]),
            invoice_date:                 parseDate(r[COL.invoice_date]),
            total_margin:                 parseCurrency(r[COL.total_margin]),
            total_cost:                   parseCurrency(r[COL.total_cost]),
            total_after_taxes:            parseCurrency(r[COL.total_after_taxes]),
            total_balance_after_payments: parseCurrency(r[COL.total_balance_after_payments]),
            total_customer_rebate:        parseCurrency(r[COL.total_customer_rebate]),
            total_subtotal:               parseCurrency(r[COL.total_subtotal]),
            total_taxes:                  parseCurrency(r[COL.total_taxes]),
            total_labor:                  parseCurrency(r[COL.total_labor]),
            location_name:                cleanDash(r[COL.location_name]),
            _row_index: i,
        });
    }
    return rows;
}

/** Stable per-row id since GlassBiller exports don't include Invoice #. */
function synthSourceJobId(phoneN, emailN, dateIso, amountCents) {
    const key = [phoneN || emailN || 'unknown', dateIso || 'nodate', amountCents ?? 0].join('|');
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export async function ingestRows(supabase, tenantId, parsedRows, uploadBatch, filename) {
    const stats = {
        total: parsedRows.length,
        with_phone: 0,
        with_email: 0,
        with_location_name: 0,
        skipped_no_identity: 0,
        in_batch_duplicates: 0,
        processed: 0,
        errors: 0,
        paid: 0,
    };

    const bodies = [];
    const seenIds = new Set();
    for (const row of parsedRows) {
        const phoneN = normalizePhone(row.contact_phone);
        const emailN = normalizeEmail(row.customer_email);
        if (phoneN) stats.with_phone++;
        if (emailN) stats.with_email++;
        if (row.location_name) stats.with_location_name++;
        if (!phoneN && !emailN) { stats.skipped_no_identity++; continue; }

        const amountCents = row.total_after_taxes != null
            ? Math.round(row.total_after_taxes * 100) : null;
        const source_job_id = synthSourceJobId(phoneN, emailN, row.invoice_date, amountCents);

        // Dedupe within this upload batch — keep the LAST occurrence.
        if (seenIds.has(source_job_id)) {
            stats.in_batch_duplicates++;
            // Replace the previous occurrence with this one
            const prevIdx = bodies.findIndex(b => b.source_job_id === source_job_id);
            if (prevIdx >= 0) bodies.splice(prevIdx, 1);
        }
        seenIds.add(source_job_id);

        const paid_at = row.total_balance_after_payments === 0 && row.invoice_date
            ? new Date(row.invoice_date + 'T12:00:00Z').toISOString()
            : null;
        if (paid_at) stats.paid++;

        bodies.push({
            tenant_id: tenantId,
            source_system: 'glassbiller',
            source_job_id,
            customer_name: row.contact_name,
            customer_phone: row.contact_phone,
            customer_phone_normalized: phoneN,
            customer_email: row.customer_email,
            customer_email_normalized: emailN,
            location_name: row.location_name,
            invoice_date: row.invoice_date,
            invoice_amount: row.total_after_taxes,
            cogs_amount: row.total_cost,
            margin_amount: row.total_margin,
            rebate_amount: row.total_customer_rebate,
            paid_at,
            raw_row: { ...row, _source_file: filename },
            upload_batch: uploadBatch,
            updated_at: new Date().toISOString(),
        });
    }

    // Upsert in batches of 200.
    const BATCH = 200;
    for (let i = 0; i < bodies.length; i += BATCH) {
        const chunk = bodies.slice(i, i + BATCH);
        const { error } = await supabase
            .from('ag2020_crm_jobs')
            .upsert(chunk, { onConflict: 'tenant_id,source_system,source_job_id' });
        if (error) {
            stats.errors += chunk.length;
            console.error(`  upsert batch ${i / BATCH + 1} error: ${error.message}`);
        } else {
            stats.processed += chunk.length;
        }
    }
    return stats;
}

/**
 * Link unlinked crm_jobs rows to lead_journey rows by phone (preferred)
 * then email. Uses a server-side Postgres function (single UPDATE…FROM per
 * match path) — sub-second even for thousands of unlinked jobs.
 *
 * Requires `ag2020_link_crm_jobs_to_journeys` from
 * `api/ag2020/attribution-functions.sql` to be applied in Supabase.
 *
 * Also recomputes per-journey financial rollups (revenue/cogs/margin/state)
 * via `ag2020_rollup_journey_financials` so the dashboard always reads fresh
 * totals.
 */
export async function linkJobsToJourneys(supabase, tenantId) {
    const linkRes = await supabase.rpc('ag2020_link_crm_jobs_to_journeys', {
        p_tenant_id: tenantId,
    });
    if (linkRes.error) {
        throw new Error('link RPC failed: ' + linkRes.error.message +
            ' — did you apply api/ag2020/attribution-functions.sql in Supabase?');
    }
    const link = (linkRes.data && linkRes.data[0]) || {
        linked_by_phone: 0, linked_by_email: 0, still_unlinked: 0,
    };

    const rollRes = await supabase.rpc('ag2020_rollup_journey_financials', {
        p_tenant_id: tenantId,
    });
    if (rollRes.error) {
        throw new Error('rollup RPC failed: ' + rollRes.error.message);
    }
    const journeys_updated = (rollRes.data && rollRes.data[0]?.journeys_updated) || 0;

    return {
        linked_by_phone: Number(link.linked_by_phone) || 0,
        linked_by_email: Number(link.linked_by_email) || 0,
        still_unlinked: Number(link.still_unlinked) || 0,
        journeys_rolled_up: Number(journeys_updated) || 0,
    };
}

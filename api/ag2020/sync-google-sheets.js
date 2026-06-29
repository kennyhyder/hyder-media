/**
 * AG2020 — Sync Google Sheets → Supabase
 * GET /api/ag2020/sync-google-sheets
 *
 * Pulls all three tabs from the "Financials AG2020" workbook and upserts:
 *  - "Daily funding"  → ag2020_daily_funding
 *  - "Monthly Bills"  → ag2020_bills  (template-level only; bucket may be edited in DB)
 *  - "Job Count"      → returned for inspection only (cross-reference with GlassBiller)
 *
 * Runs every 30 min via cron (see vercel.json) and is also safe to call
 * on-demand from a Refresh button on the dashboard.
 *
 * Authorization: cron header `Authorization: Bearer ${CRON_SECRET}` for scheduled
 * invocations; the dashboard Refresh button calls it via the dashboard's auth
 * session (no token required for in-app calls).
 */

import { createClient } from '@supabase/supabase-js';
import { fetchDailyFunding, fetchMonthlyBills, fetchJobCount } from './_google-sheets-lib.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    const result = {
        started_at: new Date().toISOString(),
        funding: { rows: 0, upserted: 0, errors: [] },
        bills:   { rows: 0, upserted: 0, errors: [] },
        jobs:    { rows: 0, errors: [] },
    };

    // ====== Daily funding ======
    try {
        const fundingRows = await fetchDailyFunding();
        result.funding.rows = fundingRows.length;
        if (fundingRows.length > 0) {
            const { error, count } = await supabase
                .from('ag2020_daily_funding')
                .upsert(
                    fundingRows.map(r => ({
                        funding_date: r.funding_date,
                        lightning_wire: r.lightning_wire,
                        squares: r.squares,
                        checks: r.checks,
                        cash: r.cash,
                        appraisal_checks: r.appraisal_checks,
                        source: 'google_sheets',
                        synced_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })),
                    { onConflict: 'funding_date', count: 'exact' }
                );
            if (error) result.funding.errors.push(error.message);
            else result.funding.upserted = count ?? fundingRows.length;
        }
    } catch (err) {
        result.funding.errors.push(err.message);
    }

    // ====== Monthly bills ======
    // Only upsert NEW rows (don't overwrite manually-edited bucket/autopay)
    try {
        const billRows = await fetchMonthlyBills();
        result.bills.rows = billRows.length;
        if (billRows.length > 0) {
            // Match on (name, due_day) since the sheet doesn't have stable IDs.
            // For each row, insert if not exists, otherwise UPDATE only amount + category + notes.
            const { data: existing } = await supabase
                .from('ag2020_bills')
                .select('id, name, due_day, amount')
                .eq('source', 'google_sheets');
            const existingMap = new Map(
                (existing || []).map(b => [`${b.name.toLowerCase()}|${b.due_day}`, b])
            );
            const toInsert = [];
            const toUpdate = [];
            for (const row of billRows) {
                const key = `${row.name.toLowerCase()}|${row.due_day}`;
                const e = existingMap.get(key);
                if (!e) {
                    toInsert.push({
                        ...row,
                        is_active: true,
                        autopay: false,
                        updated_at: new Date().toISOString(),
                    });
                } else if (Number(e.amount) !== row.amount) {
                    toUpdate.push({ id: e.id, amount: row.amount, category: row.category, notes: row.notes });
                }
            }
            if (toInsert.length > 0) {
                const { error } = await supabase.from('ag2020_bills').insert(toInsert);
                if (error) result.bills.errors.push(`insert: ${error.message}`);
            }
            for (const u of toUpdate) {
                const { error } = await supabase
                    .from('ag2020_bills')
                    .update({ amount: u.amount, category: u.category, notes: u.notes, updated_at: new Date().toISOString() })
                    .eq('id', u.id);
                if (error) result.bills.errors.push(`update ${u.id}: ${error.message}`);
            }
            result.bills.upserted = toInsert.length + toUpdate.length;
            result.bills.inserted = toInsert.length;
            result.bills.updated_amount = toUpdate.length;
        }
    } catch (err) {
        result.bills.errors.push(err.message);
    }

    // ====== Job count (read only — for inspection / reconciliation later) ======
    try {
        const jobRows = await fetchJobCount();
        result.jobs.rows = jobRows.length;
        result.jobs.latest = jobRows[jobRows.length - 1] || null;
    } catch (err) {
        result.jobs.errors.push(err.message);
    }

    result.finished_at = new Date().toISOString();
    result.ok = result.funding.errors.length === 0
            && result.bills.errors.length === 0
            && result.jobs.errors.length === 0;

    return res.status(200).json(result);
}

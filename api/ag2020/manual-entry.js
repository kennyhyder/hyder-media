/**
 * AG2020 — manual balance adjustments + ad-hoc payments/income.
 *
 * The bank balances don't always match the bucket math during the platform
 * transition (e.g. 2026-07-14: ~$7,100 received but immediately swept by
 * overdue balances). This endpoint lets the team keep the buckets truthful:
 *
 * GET  /api/ag2020/manual-entry
 *   → { ok, balances, entries: [recent manual txns] }
 *
 * POST /api/ag2020/manual-entry   (JSON body)
 *   { kind: 'set_balance', bucket, actual_balance, note? }
 *     → inserts a manual_adjustment txn for the difference so the bucket's
 *       computed balance equals actual_balance, then refreshes snapshots.
 *   { kind: 'entry', direction: 'in'|'out', bucket, amount, description, date? }
 *     → records an ad-hoc payment (out) or income (in) that isn't on the
 *       bills calendar, then refreshes snapshots.
 *   { kind: 'delete', id }
 *     → deletes a manual entry created by this endpoint (typo undo).
 */

import { requireAuth } from './_auth.js';
import { getSupabase, getCurrentBalances, refreshBalanceSnapshots, BUCKETS } from './_buckets-lib.js';

const MANUAL_SOURCES = ['manual_adjustment', 'manual_entry'];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://hyder.me');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getSupabase();

    try {
        if (req.method === 'GET') {
            const balances = await getCurrentBalances(supabase);
            const { data: entries, error } = await supabase
                .from('ag2020_bucket_transactions')
                .select('id, txn_date, bucket, direction, amount, description, source, created_at')
                .in('source', MANUAL_SOURCES)
                .order('created_at', { ascending: false })
                .limit(30);
            if (error) throw error;
            return res.status(200).json({ ok: true, balances, entries: entries || [] });
        }

        if (req.method !== 'POST') {
            return res.status(405).json({ ok: false, error: 'Method not allowed' });
        }

        const body = req.body || {};
        const kind = body.kind;
        const today = new Date().toISOString().split('T')[0];

        if (kind === 'set_balance') {
            const bucket = String(body.bucket || '');
            if (!BUCKETS.includes(bucket)) {
                return res.status(400).json({ ok: false, error: `bucket must be one of ${BUCKETS.join(', ')}` });
            }
            const target = Math.round(Number(body.actual_balance) * 100) / 100;
            if (!Number.isFinite(target)) {
                return res.status(400).json({ ok: false, error: 'actual_balance must be a number' });
            }
            const balances = await getCurrentBalances(supabase);
            const current = balances[bucket] || 0;
            const diff = Math.round((target - current) * 100) / 100;
            if (Math.abs(diff) < 0.005) {
                return res.status(200).json({ ok: true, note: 'already at that balance', balances });
            }
            const note = String(body.note || '').slice(0, 300);
            const { error } = await supabase.from('ag2020_bucket_transactions').insert({
                txn_date: today,
                bucket,
                direction: diff > 0 ? 'in' : 'out',
                amount: Math.abs(diff),
                description: `Balance set to $${target.toLocaleString()} (was $${current.toLocaleString()})${note ? ' — ' + note : ''}`,
                source: 'manual_adjustment',
            });
            if (error) throw error;
            await refreshBalanceSnapshots(supabase);
            const after = await getCurrentBalances(supabase);
            return res.status(200).json({ ok: true, bucket, previous: current, new_balance: after[bucket], balances: after });
        }

        if (kind === 'entry') {
            const bucket = String(body.bucket || 'operating');
            const direction = body.direction === 'in' ? 'in' : 'out';
            const amount = Math.round(Number(body.amount) * 100) / 100;
            const description = String(body.description || '').trim().slice(0, 300);
            const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : today;
            if (!BUCKETS.includes(bucket)) {
                return res.status(400).json({ ok: false, error: `bucket must be one of ${BUCKETS.join(', ')}` });
            }
            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
            }
            if (!description) {
                return res.status(400).json({ ok: false, error: 'description is required — say what this payment/income was' });
            }
            const { data: inserted, error } = await supabase
                .from('ag2020_bucket_transactions')
                .insert({
                    txn_date: date,
                    bucket,
                    direction,
                    amount,
                    description,
                    source: 'manual_entry',
                })
                .select('id')
                .single();
            if (error) throw error;
            await refreshBalanceSnapshots(supabase);
            const balances = await getCurrentBalances(supabase);
            return res.status(200).json({ ok: true, id: inserted?.id, balances });
        }

        if (kind === 'delete') {
            const id = String(body.id || '');
            if (!id) return res.status(400).json({ ok: false, error: 'id required' });
            // Only entries this endpoint created can be deleted — never
            // funding allocations or bill payments.
            const { data: deleted, error } = await supabase
                .from('ag2020_bucket_transactions')
                .delete()
                .eq('id', id)
                .in('source', MANUAL_SOURCES)
                .select('id');
            if (error) throw error;
            if (!deleted || deleted.length === 0) {
                return res.status(404).json({ ok: false, error: 'entry not found (only manual entries can be deleted)' });
            }
            await refreshBalanceSnapshots(supabase);
            const balances = await getCurrentBalances(supabase);
            return res.status(200).json({ ok: true, deleted: deleted.length, balances });
        }

        return res.status(400).json({ ok: false, error: "kind must be 'set_balance', 'entry', or 'delete'" });
    } catch (err) {
        console.error('[ag2020 manual-entry]', err);
        return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
    }
}

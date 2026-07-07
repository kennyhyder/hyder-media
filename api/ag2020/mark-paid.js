/**
 * AG2020 — Mark a bill / past-due obligation as paid (full or partial).
 *
 * POST /api/ag2020/mark-paid
 *   { obligation_type: 'bill' | 'past_due', obligation_id, amount_paid, paid_date?, note? }
 *
 * Records the payment as a bucket OUTFLOW (so bucket balances stay real — this is
 * what closes the loop) and maintains a running remaining tally:
 *   - past_due: decrements ag2020_bills_past_due.amount_remaining; marks is_paid when it hits 0.
 *   - bill (recurring): the per-period remaining is derived (bill.amount − payments this month)
 *     in the recommender; here we just record the outflow tagged to the bill.
 *
 * Auth: Bearer CRON_SECRET (internal) or dashboard JWT, via requireAuth.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './_auth.js';

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch { return res.status(400).json({ error: 'bad JSON body' }); }

    const type = body.obligation_type;
    const id = body.obligation_id;
    const amountPaid = Math.round(Number(body.amount_paid) * 100) / 100;
    const paidDate = (body.paid_date && /^\d{4}-\d{2}-\d{2}$/.test(body.paid_date)) ? body.paid_date : todayISO();
    const note = (body.note || '').toString().slice(0, 300) || null;

    if (type !== 'bill' && type !== 'past_due') return res.status(400).json({ error: "obligation_type must be 'bill' or 'past_due'" });
    if (!id) return res.status(400).json({ error: 'obligation_id required' });
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) return res.status(400).json({ error: 'amount_paid must be > 0' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const table = type === 'bill' ? 'ag2020_bills' : 'ag2020_bills_past_due';

    // Look up the obligation for its bucket + name
    const { data: ob, error: obErr } = await supabase.from(table).select('*').eq('id', id).single();
    if (obErr || !ob) return res.status(404).json({ error: `obligation not found in ${table}` });
    const bucket = ob.bucket;
    const name = ob.name;

    // 1) Record the outflow so the bucket balance drops (the whole point).
    const { error: txnErr } = await supabase.from('ag2020_bucket_transactions').insert({
        txn_date: paidDate,
        bucket,
        direction: 'out',
        amount: amountPaid,
        description: `Payment: ${name}${note ? ' — ' + note : ''}`,
        source: type === 'past_due' ? 'past_due_payment' : 'bill_payment',
        reference_id: id,
        reference_table: table,
    });
    if (txnErr) return res.status(500).json({ error: 'failed to record payment: ' + txnErr.message });

    // 2) Update the running tally.
    let remaining = null, fullyPaid = false;
    if (type === 'past_due') {
        const prev = Number(ob.amount_remaining) || 0;
        remaining = Math.round((prev - amountPaid) * 100) / 100;
        fullyPaid = remaining <= 0.005;
        const { error: updErr } = await supabase.from('ag2020_bills_past_due')
            .update({ amount_remaining: Math.max(0, remaining), is_paid: fullyPaid })
            .eq('id', id);
        if (updErr) return res.status(500).json({ error: 'payment recorded but tally update failed: ' + updErr.message });
    } else {
        // Recurring bill: remaining for THIS calendar month = amount − payments this month.
        const monthStart = paidDate.slice(0, 8) + '01';
        const { data: pays } = await supabase.from('ag2020_bucket_transactions')
            .select('amount')
            .eq('reference_id', id).eq('source', 'bill_payment').gte('txn_date', monthStart);
        const paidThisMonth = (pays || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        remaining = Math.round((Number(ob.amount) - paidThisMonth) * 100) / 100;
        fullyPaid = remaining <= 0.005;
    }

    return res.status(200).json({
        ok: true,
        obligation_type: type,
        obligation_id: id,
        name,
        bucket,
        amount_paid: amountPaid,
        remaining: Math.max(0, remaining),
        fully_paid: fullyPaid,
        paid_date: paidDate,
    });
}

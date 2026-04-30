/**
 * AG2020 - Rebates from Airtable
 * GET /api/ag2020/rebates
 *
 * Pulls Lacy's rebate tracker from Airtable, normalizes status, and returns
 * a flat list with summary stats. Cached for 60 seconds in memory per-warm-
 * function-instance to spare the Airtable rate limit.
 *
 * Query params:
 *   q       - search string (matches customer name, phone, vehicle, invoice)
 *   status  - filter (Owed | Committed | Paid | All) default All
 *   week    - "yes" to limit to rebates with payment due / committed this week
 *   limit   - max rows (default 500, max 5000)
 *
 * Env vars:
 *   AG2020_AIRTABLE_API_KEY        - Personal Access Token (PAT) with read on the rebates base
 *   AG2020_AIRTABLE_BASE_ID        - e.g. appXXXXXXXXXXXXXX
 *   AG2020_AIRTABLE_REBATES_TABLE  - table name or ID, default "Rebate List"
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
let _cache = null;
let _cacheAt = 0;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.AG2020_AIRTABLE_API_KEY;
    const baseId = process.env.AG2020_AIRTABLE_BASE_ID;
    const tableName = process.env.AG2020_AIRTABLE_REBATES_TABLE || 'Rebate List';

    if (!apiKey || !baseId) {
        return res.status(200).json({
            status: 'not_configured',
            message: 'Airtable credentials missing',
            hint: 'Set AG2020_AIRTABLE_API_KEY and AG2020_AIRTABLE_BASE_ID in Vercel env vars. Get a Personal Access Token at airtable.com → Account → Developer hub → Personal access tokens.',
        });
    }

    const q = (req.query.q || '').toString().toLowerCase().trim();
    const statusFilter = (req.query.status || 'All').toString();
    const weekOnly = req.query.week === 'yes' || req.query.week === '1';
    const limit = Math.min(parseInt(req.query.limit) || 500, 5000);

    try {
        // 60s cache (per function instance memory)
        const now = Date.now();
        let allRecords;
        if (_cache && (now - _cacheAt) < 60000) {
            allRecords = _cache;
        } else {
            allRecords = await fetchAllRecords(apiKey, baseId, tableName);
            _cache = allRecords;
            _cacheAt = now;
        }

        const normalized = allRecords.map(normalizeRecord).filter(r => r != null);

        // Filter
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sunday = new Date(today);
        sunday.setDate(today.getDate() + (7 - today.getDay()));

        let filtered = normalized;
        if (statusFilter && statusFilter !== 'All') {
            filtered = filtered.filter(r => r.status === statusFilter);
        }
        if (weekOnly) {
            filtered = filtered.filter(r => {
                if (r.status === 'Paid') return false;
                if (!r.payDate) return r.status === 'Committed' || r.status === 'Owed';
                const d = new Date(r.payDate);
                return d <= sunday;
            });
        }
        if (q) {
            filtered = filtered.filter(r =>
                (r.customer || '').toLowerCase().includes(q) ||
                (r.phone || '').toLowerCase().includes(q) ||
                (r.vehicle || '').toLowerCase().includes(q) ||
                (r.invoice || '').toLowerCase().includes(q) ||
                (r.notes || '').toLowerCase().includes(q)
            );
        }

        // Sort by job date desc by default
        filtered.sort((a, b) => (b.jobDate || '').localeCompare(a.jobDate || ''));
        const limited = filtered.slice(0, limit);

        // Stats over the unfiltered set so the headline numbers don't shift with filters
        const stats = computeStats(normalized, sunday);

        return res.status(200).json({
            status: 'success',
            count: normalized.length,
            filteredCount: filtered.length,
            returned: limited.length,
            stats,
            items: limited,
            cached: now - _cacheAt < 60000 && (now - _cacheAt) > 50,
        });
    } catch (err) {
        return res.status(200).json({
            status: 'error',
            error: err.message,
        });
    }
}

// ============================================================================
// Airtable fetch
// ============================================================================

async function fetchAllRecords(apiKey, baseId, tableName) {
    const records = [];
    let offset = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (offset) params.set('offset', offset);
        const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${params}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Airtable ${response.status}: ${data.error?.message || JSON.stringify(data).slice(0, 300)}`);
        }
        records.push(...(data.records || []));
        offset = data.offset || null;
        if (!offset) break;
    }
    return records;
}

// ============================================================================
// Field normalization
// ============================================================================

// Lacy's table likely has Title-Cased column names. We accept many spellings
// for each canonical field so we don't have to ask Kenny what every column is.
const FIELD_ALIASES = {
    customer: ['Customer', 'Customer Name', 'Name', 'Client', 'Client Name'],
    phone: ['Phone', 'Phone Number', 'Mobile', 'Cell', 'Caller', 'Customer Phone'],
    vehicle: ['Vehicle', 'Car', 'YMM', 'Year/Make/Model', 'Make/Model', 'Vehicle Description'],
    year: ['Year'],
    make: ['Make'],
    model: ['Model'],
    jobDate: ['Job Date', 'Service Date', 'Date', 'Install Date', 'Install', 'Date Installed'],
    invoice: ['Invoice', 'Invoice #', 'Invoice Number', 'Job #', 'Job Number'],
    amount: ['Amount', 'Rebate Amount', 'Rebate', 'Amount Owed', '$', 'Total', 'Payout'],
    status: ['Status', 'Pay Status', 'Payment Status', 'State'],
    payDate: ['Pay Date', 'Date Paid', 'Paid Date', 'Promised Date', 'Commit Date', 'Date Committed'],
    checkNumber: ['Check #', 'Check Number', 'Check'],
    notes: ['Notes', 'Comment', 'Comments', 'Note'],
    paid: ['Paid', 'Is Paid'],
    committed: ['Committed', 'Is Committed', 'Promise', 'Promised'],
};

function getField(fields, aliases) {
    for (const a of aliases) {
        if (Object.prototype.hasOwnProperty.call(fields, a)) {
            const v = fields[a];
            if (v !== '' && v !== null && v !== undefined) return v;
        }
    }
    return null;
}

function normalizeRecord(r) {
    const f = r.fields || {};

    const customer = strOrNull(getField(f, FIELD_ALIASES.customer));
    const phone = strOrNull(getField(f, FIELD_ALIASES.phone));
    let vehicle = strOrNull(getField(f, FIELD_ALIASES.vehicle));
    if (!vehicle) {
        const y = getField(f, FIELD_ALIASES.year);
        const mk = getField(f, FIELD_ALIASES.make);
        const md = getField(f, FIELD_ALIASES.model);
        const parts = [y, mk, md].filter(Boolean).join(' ').trim();
        if (parts) vehicle = parts;
    }
    const jobDate = parseDate(getField(f, FIELD_ALIASES.jobDate));
    const invoice = strOrNull(getField(f, FIELD_ALIASES.invoice));
    const amount = parseAmount(getField(f, FIELD_ALIASES.amount));
    let status = strOrNull(getField(f, FIELD_ALIASES.status));
    const payDate = parseDate(getField(f, FIELD_ALIASES.payDate));
    const checkNumber = strOrNull(getField(f, FIELD_ALIASES.checkNumber));
    const notes = strOrNull(getField(f, FIELD_ALIASES.notes));

    // If no Status column, infer from booleans
    if (!status) {
        const paid = !!getField(f, FIELD_ALIASES.paid);
        const committed = !!getField(f, FIELD_ALIASES.committed);
        if (paid) status = 'Paid';
        else if (committed) status = 'Committed';
        else status = 'Owed';
    } else {
        // Normalize variant spellings
        const lower = status.toLowerCase();
        if (lower.includes('paid')) status = 'Paid';
        else if (lower.includes('commit') || lower.includes('promis')) status = 'Committed';
        else if (lower.includes('owed') || lower.includes('outstand') || lower.includes('open')) status = 'Owed';
    }

    // Skip rows with no customer + no amount + no invoice — likely deleted/empty
    if (!customer && amount == null && !invoice) return null;

    return {
        id: r.id,
        customer,
        phone,
        vehicle,
        jobDate,
        invoice,
        amount,
        status,
        payDate,
        checkNumber,
        notes,
        // Pass through anything we didn't recognize so the UI can hint at unmapped data
        unmappedFields: Object.fromEntries(
            Object.entries(f).filter(([k]) => !isMapped(k))
        ),
    };
}

function isMapped(field) {
    for (const aliases of Object.values(FIELD_ALIASES)) {
        if (aliases.includes(field)) return true;
    }
    return false;
}

function strOrNull(v) {
    if (v == null) return null;
    if (Array.isArray(v)) return v.length ? String(v[0]).trim() : null;
    const s = String(v).trim();
    return s || null;
}

function parseAmount(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[^\d.\-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
}

function parseDate(v) {
    if (!v) return null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function computeStats(records, sunday) {
    const stats = {
        total: records.length,
        owed: { count: 0, amount: 0 },
        committed: { count: 0, amount: 0 },
        paid: { count: 0, amount: 0 },
        thisWeek: { count: 0, amount: 0 },
    };
    for (const r of records) {
        const amt = r.amount || 0;
        if (r.status === 'Paid') {
            stats.paid.count += 1;
            stats.paid.amount += amt;
        } else if (r.status === 'Committed') {
            stats.committed.count += 1;
            stats.committed.amount += amt;
        } else {
            stats.owed.count += 1;
            stats.owed.amount += amt;
        }

        if (r.status !== 'Paid') {
            const isThisWeek = !r.payDate || new Date(r.payDate) <= sunday;
            if (isThisWeek && r.status !== 'Owed') {
                stats.thisWeek.count += 1;
                stats.thisWeek.amount += amt;
            }
        }
    }
    return stats;
}

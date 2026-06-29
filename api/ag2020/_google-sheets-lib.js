/**
 * AG2020 Google Sheets sync — shared library.
 *
 * Reads the "Financials AG2020" workbook (sheet id in env AG2020_FUNDING_SHEET_ID)
 * via the service account stored in env AG2020_GOOGLE_SHEETS_KEY.
 *
 * Three tabs:
 *  - "Daily funding"  — funding inflow per day, split by source
 *  - "Monthly Bills"  — recurring bill template
 *  - "Job Count"      — daily job counts (cross-reference with GlassBiller)
 *
 * Underscore prefix on the filename so Vercel doesn't route it.
 */

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function parseCreds() {
    const raw = process.env.AG2020_GOOGLE_SHEETS_KEY;
    if (!raw) throw new Error('AG2020_GOOGLE_SHEETS_KEY env var is not set');
    let creds;
    try {
        creds = typeof raw === 'string' ? JSON.parse(raw.trim()) : raw;
    } catch (err) {
        throw new Error(`AG2020_GOOGLE_SHEETS_KEY is not valid JSON (length=${raw.length}): ${err.message}`);
    }
    if (!creds.client_email) throw new Error(`Service account JSON missing client_email (keys: ${Object.keys(creds).join(',')})`);
    if (!creds.private_key) throw new Error(`Service account JSON missing private_key (keys: ${Object.keys(creds).join(',')})`);
    // Vercel env var storage normalizes literal newlines. Restore them so
    // OpenSSL can parse the PEM-encoded private key.
    if (!creds.private_key.includes('\n')) {
        creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    }
    return creds;
}

async function getSheets() {
    const creds = parseCreds();
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
        },
        scopes: SCOPES,
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

function getSheetId() {
    const id = process.env.AG2020_FUNDING_SHEET_ID;
    if (!id) throw new Error('AG2020_FUNDING_SHEET_ID env var is not set');
    return id.trim();
}

// Convert "$1,234.56" or "1234.56" → 1234.56 (number). Returns 0 on null/empty.
function parseMoney(s) {
    if (s === null || s === undefined || s === '') return 0;
    const cleaned = String(s).replace(/[$,\s]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

// Convert "3/30/2026" or "03/30/2026" → "2026-03-30" (ISO date). Returns null on invalid.
function parseDate(s) {
    if (!s) return null;
    const trimmed = String(s).trim();
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    // M/D/YYYY or MM/DD/YYYY
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, mo, day, year] = m;
        return `${year}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
}

// "1st", "8th", "15th", "30th" → 1, 8, 15, 30
function parseDueDay(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2})/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 31 ? n : null;
}

/**
 * Pull and parse the "Daily funding" tab.
 * Returns: Array of { funding_date, lightning_wire, squares, checks, cash, appraisal_checks }
 * Skips rows that aren't a calendar date (header, blank, "Weekly Total Funding" subtotals).
 */
export async function fetchDailyFunding() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: getSheetId(),
        range: "'Daily funding'!A:G",
    });
    const rows = res.data.values || [];
    const parsed = [];
    for (const row of rows) {
        const [dateRaw, wire, squares, checks, cash, appraisal /* , total */] = row;
        const date = parseDate(dateRaw);
        if (!date) continue; // header, blank, or "Weekly Total Funding" row
        parsed.push({
            funding_date: date,
            lightning_wire: parseMoney(wire),
            squares: parseMoney(squares),
            checks: parseMoney(checks),
            cash: parseMoney(cash),
            appraisal_checks: parseMoney(appraisal),
        });
    }
    return parsed;
}

/**
 * Pull and parse the "Monthly Bills" tab.
 * Returns: Array of { name, due_day, amount, category, notes, vendor, bucket }
 * Maps category → bucket using sensible defaults; manual overrides happen in DB.
 * Skips header and blank rows.
 */
const CATEGORY_TO_BUCKET = {
    'Loan': 'operating',
    'Rent': 'operating',
    'Security': 'operating',
    'Software': 'operating',
    'Insurance': 'operating',
    'Equipment': 'operating',
    'Marketing': 'marketing',
    'Vehicle': 'operating',
    'Utilities': 'operating',
    'Misc': 'operating',
    'Vendor': 'operating',
    'Tax': 'tax',
    'Payroll': 'payroll',
};

export async function fetchMonthlyBills() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: getSheetId(),
        range: "'Monthly Bills'!A:E",
    });
    const rows = res.data.values || [];
    const parsed = [];
    let skippedHeader = false;
    for (const row of rows) {
        const [name, dueDayRaw, amountRaw, category, notes] = row;
        if (!name) continue;
        // Skip header row
        if (!skippedHeader && /^bill\s*name/i.test(name)) {
            skippedHeader = true;
            continue;
        }
        const due_day = parseDueDay(dueDayRaw);
        const amount = parseMoney(amountRaw);
        if (!due_day || amount <= 0) continue;
        const bucket = CATEGORY_TO_BUCKET[(category || '').trim()] || 'operating';
        parsed.push({
            name: name.trim(),
            vendor: null,                // not in sheet; can be enriched later
            amount,
            due_day,
            category: (category || '').trim() || null,
            bucket,
            notes: (notes || '').trim() || null,
            source: 'google_sheets',
        });
    }
    return parsed;
}

/**
 * Pull and parse the "Job Count" tab.
 * Returns: Array of { job_date, cash_jobs, insurance_jobs, direct_bills, total_invoices }
 * Skips header and "Weekly Total Jobs" subtotal rows.
 */
export async function fetchJobCount() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: getSheetId(),
        range: "'Job Count'!A:E",
    });
    const rows = res.data.values || [];
    const parsed = [];
    for (const row of rows) {
        const [dateRaw, cashRaw, insRaw, directRaw, totalRaw] = row;
        const date = parseDate(dateRaw);
        if (!date) continue;
        parsed.push({
            job_date: date,
            cash_jobs: parseInt(cashRaw) || 0,
            insurance_jobs: parseInt(insRaw) || 0,
            direct_bills: parseInt(directRaw) || 0,
            total_invoices: parseInt(totalRaw) || 0,
        });
    }
    return parsed;
}

export { parseMoney, parseDate, parseDueDay };

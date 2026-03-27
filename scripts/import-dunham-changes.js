#!/usr/bin/env node
/**
 * Import Dunham & Jones Google Ads Change History from CSV export
 *
 * Usage:
 *   node scripts/import-dunham-changes.js "/path/to/Change history report.csv"
 *
 * The CSV is exported from Google Ads UI: Tools → Change History → Download
 * Format: multi-line CSV with header rows, entries like:
 *   "Mar 26, 2026, 5:36:14 PM",user@email.com,Campaign Name,Ad Group,"Changes details
 *     indented detail lines"
 *
 * Streams entries to avoid OOM on large files (1.8GB+).
 * Filters out CHEQ automated IP exclusions (noise).
 * Stores in Supabase `dunham_change_history` table.
 */

import { createClient } from '@supabase/supabase-js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
    process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
    console.error('Usage: node scripts/import-dunham-changes.js <csv-path>');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 500;

// ─── Streaming state ────────────────────────────────────────────────

let entryIndex = 0;
let filtered = 0;
let stored = 0;
let batchErrors = 0;
let batch = [];
const years = {};
const types = {};

// ─── Process a completed entry: transform, filter, batch upload ─────

async function processEntry(entry) {
    const record = transformEntry(entry, entryIndex++);
    if (!record) {
        filtered++;
        return;
    }

    // Track stats
    const y = new Date(record.change_date_time).getFullYear();
    years[y] = (years[y] || 0) + 1;
    types[record.resource_type] = (types[record.resource_type] || 0) + 1;

    batch.push(record);

    if (batch.length >= BATCH_SIZE) {
        await flushBatch();
    }
}

async function flushBatch() {
    if (batch.length === 0) return;

    const toUpload = batch;
    batch = [];

    const { error } = await supabase
        .from('dunham_change_history')
        .upsert(toUpload, { onConflict: 'id' });

    if (error) {
        console.error(`\n  Batch error: ${error.message}`);
        batchErrors++;
    } else {
        stored += toUpload.length;
    }

    process.stdout.write(`  Uploaded ${stored.toLocaleString()} (filtered ${filtered.toLocaleString()}, ${batchErrors} errors)\r`);
}

// ─── Parse CSV (streaming) ──────────────────────────────────────────

async function parseAndUpload(filePath) {
    let currentEntry = null;
    let lineNum = 0;
    let skippedHeader = false;

    const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        lineNum++;

        // Skip header rows (first 3 lines)
        if (!skippedHeader) {
            if (lineNum <= 3) continue;
            skippedHeader = true;
        }

        // New entry starts with a quoted date
        if (line.startsWith('"')) {
            // Process previous entry
            if (currentEntry) {
                await processEntry(currentEntry);
            }

            currentEntry = parseLine(line);
        } else if (currentEntry && line.startsWith('  ')) {
            // Continuation line (indented detail) — only keep first 5 to save memory
            if (currentEntry.detailLines.length < 5) {
                currentEntry.detailLines.push(line.trim());
            }
        }

        if (lineNum % 1000000 === 0) {
            process.stdout.write(`  Parsed ${(lineNum / 1000000).toFixed(0)}M lines, uploaded ${stored.toLocaleString()}...\r`);
        }
    }

    // Don't forget the last entry
    if (currentEntry) {
        await processEntry(currentEntry);
    }

    // Flush remaining batch
    await flushBatch();

    console.log(`\n  Parsed ${lineNum.toLocaleString()} lines → ${entryIndex.toLocaleString()} entries`);
}

function parseLine(line) {
    const fields = parseCSVFields(line);

    return {
        dateTimeRaw: fields[0] || '',
        user: fields[1] || '',
        campaign: fields[2] || '',
        adGroup: fields[3] || '',
        changesText: fields[4] || '',
        detailLines: [],
    };
}

function parseCSVFields(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++; // skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

// ─── Transform entries to DB records ─────────────────────────────────

function transformEntry(entry, index) {
    // Skip CHEQ automated IP exclusions
    const userLower = entry.user.toLowerCase();
    const changesLower = entry.changesText.toLowerCase();
    if (userLower.includes('cheq.ai')) return null;
    if (changesLower.includes('ip block') || changesLower.includes('negative ip block')) return null;
    if (changesLower.includes('account exclusion') && entry.detailLines.some(l => l.toLowerCase().includes('ip block'))) return null;

    const dateTime = parseDateTime(entry.dateTimeRaw);
    if (!dateTime) return null;

    const { resourceType, operation, summary } = classifyChange(entry.changesText);

    // Build a stable ID from date + user + campaign + change text (for dedup)
    const idSource = `csv:${entry.dateTimeRaw}|${entry.user}|${entry.campaign}|${entry.adGroup}|${entry.changesText}|${index}`;
    const id = simpleHash(idSource);

    // Build details from the changes text and detail lines
    const details = {};
    if (entry.detailLines.length > 0) {
        details.lines = entry.detailLines;
    }
    if (summary) {
        details.summary = summary;
    }

    return {
        id,
        change_date_time: dateTime,
        resource_type: resourceType,
        operation,
        user_email: entry.user || null,
        client_type: 'CSV_IMPORT',
        campaign_name: entry.campaign || null,
        ad_group_name: entry.adGroup || null,
        changed_fields: [],
        details: Object.keys(details).length > 0 ? details : null,
    };
}

function parseDateTime(raw) {
    if (!raw) return null;
    // Format: "Mar 26, 2026, 5:36:14 PM"
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

function classifyChange(text) {
    const t = text.toLowerCase();
    let resourceType = 'UNKNOWN';
    let operation = 'UPDATE';
    let summary = text;

    // Resource type detection
    if (t.includes('campaign') && !t.includes('campaign asset') && !t.includes('campaign criterion')) {
        resourceType = 'CAMPAIGN';
    } else if (t.includes('ad group') || t.includes('ad_group')) {
        resourceType = 'AD_GROUP';
    } else if (t.includes('responsive search ad') || t.includes('expanded text ad') || t.includes(' ad ')) {
        resourceType = 'AD';
    } else if (t.includes('keyword')) {
        resourceType = 'AD_GROUP_CRITERION';
    } else if (t.includes('budget')) {
        resourceType = 'CAMPAIGN_BUDGET';
    } else if (t.includes('asset group')) {
        resourceType = 'ASSET_GROUP';
    } else if (t.includes('campaign asset') || t.includes('asset')) {
        resourceType = 'ASSET';
    } else if (t.includes('extension') || t.includes('sitelink') || t.includes('callout') || t.includes('snippet')) {
        resourceType = 'ASSET';
    } else if (t.includes('label')) {
        resourceType = 'LABEL';
    } else if (t.includes('bid') || t.includes('target roas') || t.includes('target cpa')) {
        resourceType = 'AD_GROUP';
    } else if (t.includes('customer') || t.includes('account')) {
        resourceType = 'CUSTOMER';
    } else if (t.includes('experiment')) {
        resourceType = 'EXPERIMENT';
    } else if (t.includes('audience') || t.includes('targeting')) {
        resourceType = 'TARGETING';
    }

    // Operation detection
    if (t.includes('created') || t.includes('added') || t.includes('granted') || t.includes('sent invitation')) {
        operation = 'CREATE';
    } else if (t.includes('removed') || t.includes('deleted') || t.includes('paused')) {
        operation = 'REMOVE';
    } else if (t.includes('changed') || t.includes('updated') || t.includes('increased') || t.includes('decreased')
        || t.includes('enabled') || t.includes('active') || t.includes('halted')) {
        operation = 'UPDATE';
    }

    return { resourceType, operation, summary };
}

function simpleHash(str) {
    // FNV-1a 64-bit-ish hash as hex string
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= c;
        h2 = Math.imul(h2, 0x811c9dc5);
    }
    return `csv-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nImporting Dunham change history from CSV...`);
    console.log(`  File: ${csvPath}\n`);

    console.log('Parsing + filtering + uploading (streaming)...');
    await parseAndUpload(csvPath);

    // Stats
    console.log(`\n  ${stored.toLocaleString()} meaningful changes stored (filtered ${filtered.toLocaleString()} IP/CHEQ entries, ${batchErrors} batch errors)`);
    console.log('  By year:', Object.entries(years).sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}: ${n.toLocaleString()}`).join(', '));
    console.log('  By type:', Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(', '));

    console.log(`\nImport complete! ${stored.toLocaleString()} records stored.`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

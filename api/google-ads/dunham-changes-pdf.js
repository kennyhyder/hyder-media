/**
 * Google Ads - Dunham & Jones Change History PDF Export
 *
 * GET /api/google-ads/dunham-changes-pdf?year=2025
 * GET /api/google-ads/dunham-changes-pdf              (all years)
 *
 * Generates a PDF server-side using PDFKit — streams directly to the response.
 * Handles 75K+ rows in seconds (no DOM, no layout engine).
 */

import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const year = parseInt(req.query.year) || null;
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        // ── Fetch all rows in batches of 5000 ──
        const allRows = [];
        const BATCH = 1000;
        let offset = 0;
        while (true) {
            let query = supabase
                .from('dunham_change_history')
                .select('change_date_time, resource_type, operation, user_email, campaign_name, ad_group_name, details')
                .order('change_date_time', { ascending: false })
                .range(offset, offset + BATCH - 1);

            if (year) {
                query = query
                    .gte('change_date_time', `${year}-01-01T00:00:00Z`)
                    .lt('change_date_time', `${year + 1}-01-01T00:00:00Z`);
            }

            const { data, error } = await query;
            if (error) throw new Error(`Supabase error: ${error.message}`);
            if (!data || data.length === 0) break;
            allRows.push(...data);
            if (data.length < BATCH) break;
            offset += BATCH;
        }

        if (allRows.length === 0) {
            return res.status(404).json({ error: 'No change history found' });
        }

        // ── Create PDF ──
        const doc = new PDFDocument({ layout: 'landscape', size: 'letter', margin: 30, bufferPages: false });

        const filename = `dunham-change-history-${year || 'all-years'}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        // Page dimensions (landscape letter)
        const PAGE_W = 792;
        const PAGE_H = 612;
        const MARGIN = 30;
        const MIN_ROW_H = 10;
        const FONT_SIZE = 6.5;
        const HEADER_FONT = 7;
        const FOOTER_ZONE = 30;
        const COL_PAD = 4; // gap between columns

        // Column layout
        const cols = [
            { label: 'Date',      x: 30,  w: 55 },
            { label: 'Time',      x: 85,  w: 42 },
            { label: 'Type',      x: 127, w: 62 },
            { label: 'Operation', x: 189, w: 48 },
            { label: 'Campaign',  x: 237, w: 150 },
            { label: 'Ad Group',  x: 387, w: 100 },
            { label: 'User',      x: 487, w: 115 },
            { label: 'Details',   x: 602, w: 160 },
        ];

        let y = 0;
        let pageNum = 0;

        function startPage(isFirst) {
            if (!isFirst) doc.addPage();
            pageNum++;
            y = MARGIN;

            if (isFirst) {
                doc.font('Helvetica-Bold').fontSize(16)
                    .text('Dunham & Jones \u2014 Change History', MARGIN, y, { lineBreak: false });
                y += 20;
                const now = new Date();
                const genDate = `${now.toLocaleString('en-US', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`;
                doc.font('Helvetica').fontSize(9)
                    .text(`${year || 'All Years'}  |  ${allRows.length.toLocaleString()} changes  |  Generated ${genDate}`, MARGIN, y, { lineBreak: false });
                y += 18;
            }

            // Column headers
            doc.font('Helvetica-Bold').fontSize(HEADER_FONT);
            for (const col of cols) {
                doc.text(col.label, col.x, y, { width: col.w - COL_PAD, lineBreak: false });
            }
            y += MIN_ROW_H + 2;
            doc.moveTo(MARGIN, y - 1).lineTo(PAGE_W - MARGIN, y - 1).lineWidth(0.5).stroke();
            y += 3;
            doc.font('Helvetica').fontSize(FONT_SIZE);
        }

        function drawFooter() {
            doc.font('Helvetica').fontSize(7).fillColor('#888888')
                .text(`Dunham & Jones Change History \u2014 Page ${pageNum}`, 0, PAGE_H - 20, { width: PAGE_W, align: 'center', lineBreak: false });
            doc.fillColor('#000000').font('Helvetica').fontSize(FONT_SIZE);
        }

        // Word-wrap text into lines that fit a given width (all rendering
        // uses lineBreak:false so PDFKit never auto-adds pages)
        function wrapLines(str, maxW) {
            if (!str) return [''];
            if (doc.widthOfString(str) <= maxW) return [str];
            const words = str.split(/\s+/);
            const lines = [];
            let cur = '';
            for (const word of words) {
                const test = cur ? cur + ' ' + word : word;
                if (doc.widthOfString(test) > maxW && cur) {
                    lines.push(cur);
                    cur = word;
                } else {
                    cur = test;
                }
            }
            if (cur) lines.push(cur);
            return lines.length ? lines : [''];
        }

        startPage(true);
        const lineH = doc.currentLineHeight();

        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            const dt = row.change_date_time ? new Date(row.change_date_time) : null;
            const values = [
                dt ? fmtDate(dt) : '',
                dt ? fmtTime(dt) : '',
                shortType(row.resource_type),
                row.operation || '',
                row.campaign_name || '',
                row.ad_group_name || '',
                row.user_email || '',
                buildDetail(row.details),
            ];

            // Pre-wrap all cells and calculate row height
            doc.font('Helvetica').fontSize(FONT_SIZE);
            const cellLines = [];
            let rowH = MIN_ROW_H;
            for (let c = 0; c < cols.length; c++) {
                const lines = wrapLines(values[c], cols[c].w - COL_PAD);
                cellLines.push(lines);
                rowH = Math.max(rowH, lines.length * lineH);
            }
            rowH = Math.min(rowH, PAGE_H / 3);

            // Page break if needed
            if (y + rowH > PAGE_H - FOOTER_ZONE) {
                drawFooter();
                startPage(false);
            }

            // Render each cell line by line (lineBreak:false prevents auto pages)
            for (let c = 0; c < cols.length; c++) {
                const lines = cellLines[c];
                for (let l = 0; l < lines.length; l++) {
                    const ly = y + l * lineH;
                    if (ly + lineH > y + rowH) break;
                    doc.text(lines[l], cols[c].x, ly, { lineBreak: false });
                }
            }
            y += rowH + 1;
        }

        drawFooter();
        doc.end();

    } catch (error) {
        // If we already started streaming, we can't send JSON
        if (!res.headersSent) {
            return res.status(500).json({ error: error.message });
        }
    }
}

// ── Helpers ──

function fmtDate(d) {
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function fmtTime(d) {
    let h = d.getHours(), m = d.getMinutes(), ap = 'AM';
    if (h >= 12) { ap = 'PM'; if (h > 12) h -= 12; }
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

const TYPE_LABELS = {
    AD: 'Ad',
    AD_GROUP: 'Ad Group',
    AD_GROUP_CRITERION: 'Keyword',
    CAMPAIGN: 'Campaign',
    CAMPAIGN_BUDGET: 'Budget',
    CAMPAIGN_CRITERION: 'Campaign Neg',
    ASSET: 'Asset',
    ASSET_GROUP: 'Asset Group',
    LABEL: 'Label',
    CUSTOMER: 'Account',
    TARGETING: 'Targeting',
    EXPERIMENT: 'Experiment',
};

function shortType(t) {
    if (!t) return '';
    return TYPE_LABELS[t] || t.replace(/_/g, ' ').toLowerCase();
}


function buildDetail(details) {
    if (!details) return '';

    // lines/summary format (CSV-imported data)
    if (details.lines && details.lines.length > 0) {
        const summary = details.summary || '';
        const lines = details.lines.join('; ');
        return summary ? `${summary} \u2014 ${lines}` : lines;
    }

    // Structured format (API-synced data)
    const parts = [];

    if (details.name) {
        parts.push(`Name: ${details.name.old || '(none)'} → ${details.name.new || '(none)'}`);
    }
    if (details.status) {
        parts.push(`Status: ${details.status.old || '?'} → ${details.status.new || '?'}`);
    }
    if (details.dailyBudget) {
        parts.push(`Budget: $${details.dailyBudget.old || '?'} → $${details.dailyBudget.new || '?'}`);
    }
    if (details.cpcBid) {
        parts.push(`CPC: $${details.cpcBid.old || '?'} → $${details.cpcBid.new || '?'}`);
    }
    if (details.keyword) {
        parts.push(`Keyword: ${details.keyword.text} [${details.keyword.matchType}]${details.negative ? ' (negative)' : ''}`);
    }
    if (details.headlines) {
        const added = (details.headlines.new || []).filter(h => !(details.headlines.old || []).includes(h));
        const removed = (details.headlines.old || []).filter(h => !(details.headlines.new || []).includes(h));
        if (added.length) parts.push(`+Headlines: ${added.join(', ')}`);
        if (removed.length) parts.push(`-Headlines: ${removed.join(', ')}`);
    }
    if (details.descriptions) {
        const added = (details.descriptions.new || []).filter(d => !(details.descriptions.old || []).includes(d));
        const removed = (details.descriptions.old || []).filter(d => !(details.descriptions.new || []).includes(d));
        if (added.length) parts.push(`+Desc: ${added.join(', ')}`);
        if (removed.length) parts.push(`-Desc: ${removed.join(', ')}`);
    }

    return parts.join('; ');
}

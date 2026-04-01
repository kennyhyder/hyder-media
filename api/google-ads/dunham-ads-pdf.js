/**
 * Dunham & Jones Ad Report PDF Export
 *
 * GET /api/google-ads/dunham-ads-pdf?platform=google&year=2020
 * GET /api/google-ads/dunham-ads-pdf?platform=meta&year=active
 * GET /api/google-ads/dunham-ads-pdf?all=true
 *
 * Generates a PDF server-side using PDFKit — streams directly to the response.
 * Handles large multi-account years without browser memory issues.
 */

import PDFDocument from 'pdfkit';

// ── Image Prefetching ──

async function prefetchImages(data, platform) {
    const urls = new Set();
    for (const camp of (data?.campaigns || [])) {
        if (platform !== 'meta') {
            for (const ag of (camp.assetGroups || [])) {
                for (const img of (ag.images || [])) { if (img.imageUrl) urls.add(img.imageUrl); }
                for (const logo of (ag.logos || [])) { if (logo.imageUrl) urls.add(logo.imageUrl); }
            }
        }
        if (platform === 'meta') {
            for (const adSet of (camp.adSets || [])) {
                for (const ad of (adSet.ads || [])) {
                    const url = ad.imageUrl || ad.thumbnailUrl;
                    if (url) urls.add(url);
                }
            }
        }
    }
    const cache = new Map();
    if (urls.size === 0) return cache;
    const arr = [...urls];
    const BATCH = 8;
    for (let i = 0; i < arr.length; i += BATCH) {
        await Promise.all(arr.slice(i, i + BATCH).map(async (url) => {
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 5000);
                const r = await fetch(url, { signal: ctrl.signal });
                clearTimeout(t);
                if (r.ok) cache.set(url, Buffer.from(await r.arrayBuffer()));
            } catch {}
        }));
    }
    return cache;
}

function getImageDimensions(buffer) {
    try {
        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            let i = 2;
            while (i < buffer.length - 1) {
                if (buffer[i] !== 0xFF) break;
                const m = buffer[i + 1];
                if (m === 0xC0 || m === 0xC2) {
                    return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
                }
                i += 2 + buffer.readUInt16BE(i + 2);
            }
        }
    } catch {}
    return null;
}

const CURRENT_YEAR = new Date().getFullYear();
const GOOGLE_START_YEAR = 2016;
const META_START_YEAR = 2023;

// Page layout (portrait letter)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 532
const FOOTER_ZONE = 30;
const MAX_Y = PAGE_H - FOOTER_ZONE;

// Font sizes
const F_TITLE = 18;
const F_SECTION = 14;
const F_CAMPAIGN = 11;
const F_ADGROUP = 9.5;
const F_BODY = 8;
const F_LABEL = 7;
const F_ITEM = 8;
const F_FOOTER = 7;

// Indentation
const I0 = MARGIN;       // Campaign level
const I1 = MARGIN + 16;  // Ad group
const I2 = MARGIN + 32;  // Ad / section header
const I3 = MARGIN + 44;  // Section labels
const I4 = MARGIN + 56;  // Individual items

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'];
        const baseUrl = `${proto}://${host}`;

        const isAll = req.query.all === 'true';
        if (isAll) {
            return await generateAllYearsPdf(baseUrl, res);
        }

        const platform = req.query.platform || 'google';
        const yearParam = req.query.year || 'active';

        const data = await fetchData(baseUrl, platform, yearParam);
        if (!data || data.error) {
            return res.status(500).json({ error: data?.error || 'Failed to fetch data' });
        }

        const imageCache = await prefetchImages(data, platform);

        const yearLabel = yearParam === 'active' ? 'Active Ads' : yearParam;
        const platformLabel = platform === 'meta' ? 'Meta Ads' : 'Google Ads';
        const filename = `dunham-ads-${platform}-${yearParam}.pdf`;

        const doc = new PDFDocument({ size: 'letter', margin: MARGIN, bufferPages: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const ctx = createCtx(doc, imageCache);
        renderTitleBlock(ctx, `Dunham & Jones \u2014 Ad Report \u2014 ${yearLabel}`, platformLabel, data);

        if (platform === 'meta') {
            renderMetaData(ctx, data);
        } else {
            renderGoogleData(ctx, data);
        }

        drawFooter(ctx);
        doc.end();

    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ error: error.message });
        }
    }
}

// ── Data Fetching ──

async function fetchData(baseUrl, platform, yearParam) {
    const apiPath = platform === 'meta' ? '/api/meta-ads/dunham-ads' : '/api/google-ads/dunham-ads';
    const url = yearParam === 'active'
        ? `${baseUrl}${apiPath}`
        : `${baseUrl}${apiPath}?year=${yearParam}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        return { error: body.error || `HTTP ${resp.status}` };
    }
    return resp.json();
}

// ── All Years Mode ──

async function generateAllYearsPdf(baseUrl, res) {
    const googleYears = ['active'];
    for (let y = CURRENT_YEAR; y >= GOOGLE_START_YEAR; y--) googleYears.push(y);
    const metaYears = ['active'];
    for (let y = CURRENT_YEAR; y >= META_START_YEAR; y--) metaYears.push(y);

    const allData = {};
    const pairs = [];
    for (const yr of googleYears) pairs.push({ platform: 'google', year: yr });
    for (const yr of metaYears) pairs.push({ platform: 'meta', year: yr });

    const BATCH = 4;
    for (let i = 0; i < pairs.length; i += BATCH) {
        const batch = pairs.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ platform, year }) => {
            try {
                const data = await fetchData(baseUrl, platform, String(year));
                if (data && !data.error && data.campaigns?.length > 0) {
                    allData[`${platform}:${year}`] = data;
                }
            } catch { /* skip failed years */ }
        }));
    }

    const doc = new PDFDocument({ size: 'letter', margin: MARGIN, bufferPages: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="dunham-ads-all-years.pdf"');
    doc.pipe(res);

    const ctx = createCtx(doc);

    // Cover
    doc.font('Helvetica-Bold').fontSize(F_TITLE)
        .text('Dunham & Jones \u2014 Complete Ad Report', MARGIN, ctx.y, { lineBreak: false });
    ctx.y += 24;
    doc.font('Helvetica').fontSize(9)
        .text(`Generated ${fmtFullDate(new Date())}`, MARGIN, ctx.y, { lineBreak: false });
    ctx.y += 20;

    let needsNewPage = false;

    for (const yr of googleYears) {
        const data = allData[`google:${yr}`];
        if (!data) continue;
        if (needsNewPage) { drawFooter(ctx); doc.addPage(); ctx.y = MARGIN; ctx.pageNum++; }
        needsNewPage = true;
        const label = yr === 'active' ? 'Active Ads' : String(yr);
        renderSectionDivider(ctx, `Google Ads \u2014 ${label}`);
        ctx.imageCache = await prefetchImages(data, 'google');
        renderGoogleData(ctx, data);
    }

    for (const yr of metaYears) {
        const data = allData[`meta:${yr}`];
        if (!data) continue;
        if (needsNewPage) { drawFooter(ctx); doc.addPage(); ctx.y = MARGIN; ctx.pageNum++; }
        needsNewPage = true;
        const label = yr === 'active' ? 'Active Ads' : String(yr);
        renderSectionDivider(ctx, `Meta Ads \u2014 ${label}`);
        ctx.imageCache = await prefetchImages(data, 'meta');
        renderMetaData(ctx, data);
    }

    drawFooter(ctx);
    doc.end();
}

// ── PDF Helpers ──

function createCtx(doc, imageCache) {
    return { doc, y: MARGIN, pageNum: 1, imageCache: imageCache || new Map() };
}

function checkPageBreak(ctx, needed) {
    if (ctx.y + needed > MAX_Y) {
        drawFooter(ctx);
        ctx.doc.addPage();
        ctx.y = MARGIN;
        ctx.pageNum++;
    }
}

function drawFooter(ctx) {
    const str = `Dunham & Jones Ad Report \u2014 Page ${ctx.pageNum}`;
    ctx.doc.font('Helvetica').fontSize(F_FOOTER).fillColor('#888888');
    const w = ctx.doc.widthOfString(str);
    ctx.doc.text(str, (PAGE_W - w) / 2, PAGE_H - 20, { lineBreak: false });
    ctx.doc.fillColor('#000000');
}

function wrapLines(doc, str, maxW) {
    if (!str) return [''];
    str = String(str);
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

function textBlock(ctx, str, x, maxW) {
    const doc = ctx.doc;
    const lines = wrapLines(doc, str, maxW);
    const lh = doc.currentLineHeight();
    for (const line of lines) {
        checkPageBreak(ctx, lh);
        doc.text(line, x, ctx.y, { lineBreak: false });
        ctx.y += lh;
    }
}

function truncText(doc, str, maxW) {
    if (!str || doc.widthOfString(str) <= maxW) return str;
    while (str.length > 0 && doc.widthOfString(str + '\u2026') > maxW) {
        str = str.slice(0, -1);
    }
    return str + '\u2026';
}

function fmtFullDate(d) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPin(pinnedField) {
    if (!pinnedField) return '';
    const match = pinnedField.match(/(HEADLINE|DESCRIPTION)_(\d+)/);
    if (match) {
        const prefix = match[1] === 'HEADLINE' ? 'H' : 'D';
        return `Pin ${prefix}${match[2]}`;
    }
    return pinnedField;
}

// ── Ad Preview Cards ──

function renderSearchPreview(ctx, ad, sitelinks) {
    const doc = ctx.doc;

    let displayUrl = '';
    if (ad.finalUrls && ad.finalUrls.length > 0) {
        try { const u = new URL(ad.finalUrls[0]); displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname : ''); }
        catch { displayUrl = ad.finalUrls[0] || ''; }
    }

    // Build preview headlines with pinning logic
    const pinnedH = {}, unpinnedH = [];
    for (const h of (ad.headlines || [])) {
        if (h.pinnedField) {
            const m = h.pinnedField.match(/HEADLINE_(\d+)/);
            if (m) { pinnedH[parseInt(m[1])] = h.text; continue; }
        }
        unpinnedH.push(h.text);
    }
    const previewHL = [];
    let ui = 0;
    for (let i = 1; i <= 3; i++) {
        if (pinnedH[i]) previewHL.push(pinnedH[i]);
        else if (ui < unpinnedH.length) previewHL.push(unpinnedH[ui++]);
    }

    // Build preview descriptions with pinning logic
    const pinnedD = {}, unpinnedD = [];
    for (const d of (ad.descriptions || [])) {
        if (d.pinnedField) {
            const m = d.pinnedField.match(/DESCRIPTION_(\d+)/);
            if (m) { pinnedD[parseInt(m[1])] = d.text; continue; }
        }
        unpinnedD.push(d.text);
    }
    const previewDesc = [];
    let di = 0;
    for (let i = 1; i <= 2; i++) {
        if (pinnedD[i]) previewDesc.push(pinnedD[i]);
        else if (di < unpinnedD.length) previewDesc.push(unpinnedD[di++]);
    }

    if (previewHL.length === 0) return;

    const cardX = I2;
    const cardW = CONTENT_W - (I2 - MARGIN);
    const padX = 12, padY = 10;
    const innerW = cardW - 2 * padX;

    // Pre-calculate text lines
    doc.font('Helvetica-Bold').fontSize(11);
    const hlText = previewHL.join(' | ');
    const hlLines = wrapLines(doc, hlText, innerW);

    doc.font('Helvetica').fontSize(8);
    const descText = previewDesc.join(' ');
    const descLines = descText ? wrapLines(doc, descText, innerW) : [];

    const slItems = (sitelinks || []).slice(0, 4);
    const slRows = slItems.length > 0 ? Math.ceil(slItems.length / 2) : 0;

    // Calculate total card height
    let cardH = padY;
    cardH += 10; // "Sponsored"
    if (displayUrl) cardH += 11;
    cardH += hlLines.length * 13 + 2;
    if (descLines.length) cardH += descLines.length * 10;
    if (slRows) cardH += 5 + slRows * 20 + 3;
    cardH += padY;

    checkPageBreak(ctx, cardH + 12);

    // Label
    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
        .text('AD PREVIEW', cardX, ctx.y, { lineBreak: false });
    ctx.y += 9;

    // Card background + border
    const cardTop = ctx.y;
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4).fill('#ffffff');
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4)
        .lineWidth(0.5).strokeColor('#dadce0').stroke();

    let cy = cardTop + padY;

    // "Sponsored"
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#202124')
        .text('Sponsored', cardX + padX, cy, { lineBreak: false });
    cy += 10;

    // Display URL
    if (displayUrl) {
        doc.font('Helvetica').fontSize(8).fillColor('#202124')
            .text(truncText(doc, displayUrl, innerW), cardX + padX, cy, { lineBreak: false });
        cy += 11;
    }

    // Headlines (blue)
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a0dab');
    for (const line of hlLines) {
        doc.text(line, cardX + padX, cy, { lineBreak: false });
        cy += 13;
    }
    cy += 2;

    // Descriptions (gray)
    if (descLines.length) {
        doc.font('Helvetica').fontSize(8).fillColor('#4d5156');
        for (const line of descLines) {
            doc.text(line, cardX + padX, cy, { lineBreak: false });
            cy += 10;
        }
    }

    // Sitelinks (2-column grid)
    if (slRows > 0) {
        cy += 2;
        doc.moveTo(cardX + padX, cy).lineTo(cardX + cardW - padX, cy)
            .lineWidth(0.3).strokeColor('#dadce0').stroke();
        cy += 3;
        const colW = (innerW - 12) / 2;
        for (let i = 0; i < slItems.length; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const sx = cardX + padX + col * (colW + 12);
            const sy = cy + row * 20;
            doc.font('Helvetica').fontSize(8).fillColor('#1a0dab')
                .text(truncText(doc, slItems[i].linkText || slItems[i].name || '', colW), sx, sy, { lineBreak: false });
            if (slItems[i].desc1) {
                doc.font('Helvetica').fontSize(6.5).fillColor('#4d5156')
                    .text(truncText(doc, slItems[i].desc1, colW), sx, sy + 9, { lineBreak: false });
            }
        }
    }

    doc.fillColor('#000000');
    ctx.y = cardTop + cardH + 6;
}

function renderDisplayPreview(ctx, ad) {
    const doc = ctx.doc;
    const headline = ad.longHeadline || (ad.headlines && ad.headlines[0] ? ad.headlines[0].text : '');
    const desc = ad.descriptions && ad.descriptions[0] ? ad.descriptions[0].text : '';
    const bizName = ad.businessName || '';
    let displayUrl = '';
    if (ad.finalUrls && ad.finalUrls.length > 0) {
        try { displayUrl = new URL(ad.finalUrls[0]).hostname; } catch { displayUrl = ad.finalUrls[0] || ''; }
    }

    if (!headline) return;

    const cardX = I2;
    const cardW = Math.min(CONTENT_W - (I2 - MARGIN), 300);
    const padX = 12, padY = 10;
    const innerW = cardW - 2 * padX;

    doc.font('Helvetica-Bold').fontSize(11);
    const hlLines = wrapLines(doc, headline, innerW);

    let cardH = padY;
    if (bizName) cardH += 10;
    cardH += hlLines.length * 13 + 2;
    if (desc) { doc.font('Helvetica').fontSize(8); cardH += wrapLines(doc, desc, innerW).length * 10; }
    if (displayUrl) cardH += 10;
    cardH += padY;

    checkPageBreak(ctx, cardH + 12);

    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
        .text('DISPLAY AD PREVIEW', cardX, ctx.y, { lineBreak: false });
    ctx.y += 9;

    const cardTop = ctx.y;
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4).fill('#ffffff');
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4)
        .lineWidth(0.5).strokeColor('#dadce0').stroke();

    let cy = cardTop + padY;

    if (bizName) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#202124')
            .text(bizName, cardX + padX, cy, { lineBreak: false });
        cy += 10;
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a0dab');
    for (const line of hlLines) {
        doc.text(line, cardX + padX, cy, { lineBreak: false });
        cy += 13;
    }
    cy += 2;

    if (desc) {
        doc.font('Helvetica').fontSize(8).fillColor('#4d5156');
        for (const line of wrapLines(doc, desc, innerW)) {
            doc.text(line, cardX + padX, cy, { lineBreak: false });
            cy += 10;
        }
    }

    if (displayUrl) {
        doc.font('Helvetica').fontSize(7).fillColor('#202124')
            .text(displayUrl, cardX + padX, cy, { lineBreak: false });
    }

    doc.fillColor('#000000');
    ctx.y = cardTop + cardH + 6;
}

function renderPMaxPreviewCard(ctx, ag) {
    const doc = ctx.doc;
    const headline = ag.headlines && ag.headlines[0] ? ag.headlines[0].text : '';
    const longHL = ag.longHeadlines && ag.longHeadlines[0] ? ag.longHeadlines[0].text : '';
    const desc = ag.descriptions && ag.descriptions[0] ? ag.descriptions[0].text : '';
    const displayUrl = ag.finalUrl || ag.businessName || '';

    if (!headline && !longHL) return;

    const cardX = I2;
    const cardW = CONTENT_W - (I2 - MARGIN);
    const padX = 12, padY = 10;
    const innerW = cardW - 2 * padX;

    doc.font('Helvetica-Bold').fontSize(11);
    const hlText = longHL || headline;
    const hlLines = wrapLines(doc, hlText, innerW);

    let cardH = padY + 10 + (displayUrl ? 11 : 0) + hlLines.length * 13 + 2;
    if (desc) { doc.font('Helvetica').fontSize(8); cardH += wrapLines(doc, desc, innerW).length * 10; }
    cardH += padY;

    checkPageBreak(ctx, cardH + 12);

    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
        .text('PMAX AD PREVIEW (EXAMPLE COMBINATION)', cardX, ctx.y, { lineBreak: false });
    ctx.y += 9;

    const cardTop = ctx.y;
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4).fill('#ffffff');
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4)
        .lineWidth(0.5).strokeColor('#dadce0').stroke();

    let cy = cardTop + padY;

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#202124')
        .text('Sponsored', cardX + padX, cy, { lineBreak: false });
    cy += 10;

    if (displayUrl) {
        doc.font('Helvetica').fontSize(8).fillColor('#202124')
            .text(truncText(doc, displayUrl, innerW), cardX + padX, cy, { lineBreak: false });
        cy += 11;
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a0dab');
    for (const line of hlLines) {
        doc.text(line, cardX + padX, cy, { lineBreak: false });
        cy += 13;
    }
    cy += 2;

    if (desc) {
        doc.font('Helvetica').fontSize(8).fillColor('#4d5156');
        for (const line of wrapLines(doc, desc, innerW)) {
            doc.text(line, cardX + padX, cy, { lineBreak: false });
            cy += 10;
        }
    }

    doc.fillColor('#000000');
    ctx.y = cardTop + cardH + 6;
}

function renderMetaPreviewCard(ctx, ad) {
    const doc = ctx.doc;
    const primaryText = ad.primaryTexts && ad.primaryTexts[0] ? ad.primaryTexts[0].text : '';
    const headline = ad.headlines && ad.headlines[0] ? ad.headlines[0].text : '';
    const description = ad.descriptions && ad.descriptions[0] ? ad.descriptions[0].text : '';
    const imageUrl = ad.imageUrl || ad.thumbnailUrl;

    if (!primaryText && !headline && !imageUrl) return;

    const cardX = I2;
    const cardW = CONTENT_W - (I2 - MARGIN);
    const textPad = 12;
    const textW = cardW - 2 * textPad;

    // Pre-measure text
    doc.font('Helvetica').fontSize(8.5);
    const ptLines = primaryText ? wrapLines(doc, primaryText, textW) : [];
    doc.font('Helvetica-Bold').fontSize(10);
    const hlLines = headline ? wrapLines(doc, headline, textW) : [];
    doc.font('Helvetica').fontSize(8);
    const descLines = description ? wrapLines(doc, description, textW) : [];

    let domain = '';
    if (ad.linkUrl) { try { domain = new URL(ad.linkUrl).hostname.toUpperCase(); } catch {} }

    // Image dimensions
    let imgRW = 0, imgRH = 0;
    const imgBuf = imageUrl ? ctx.imageCache?.get(imageUrl) : null;
    if (imgBuf) {
        const dims = getImageDimensions(imgBuf);
        if (dims) {
            const scale = Math.min(cardW / dims.width, 180 / dims.height, 1);
            imgRW = Math.round(dims.width * scale);
            imgRH = Math.round(dims.height * scale);
        }
    }

    // Calculate card height
    let cardH = 12; // top pad
    cardH += 32; // page header
    if (ptLines.length) cardH += ptLines.length * 11 + 6;
    if (imgRH) cardH += imgRH + 2;
    if (headline || description || domain) {
        cardH += 8;
        if (domain) cardH += 10;
        if (hlLines.length) cardH += hlLines.length * 12;
        if (descLines.length) cardH += descLines.length * 10;
        cardH += 8;
    }
    cardH += 4;

    checkPageBreak(ctx, cardH + 12);

    // Label
    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
        .text('META AD PREVIEW', cardX, ctx.y, { lineBreak: false });
    ctx.y += 9;

    const cardTop = ctx.y;

    // Card with clip for rounded corners on footer
    doc.save();
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4).clip();
    doc.rect(cardX, cardTop, cardW, cardH).fill('#ffffff');

    let cy = cardTop + 12;

    // Avatar
    const avX = cardX + textPad;
    const avR = 14;
    doc.circle(avX + avR, cy + avR, avR).fill('#1877f2');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
        .text('DJ', avX + avR - 7, cy + avR - 5, { lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#050505')
        .text('Dunham & Jones', avX + avR * 2 + 8, cy + 3, { lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor('#65676b')
        .text('Sponsored', avX + avR * 2 + 8, cy + 15, { lineBreak: false });
    cy += 32;

    // Primary text
    if (ptLines.length) {
        doc.font('Helvetica').fontSize(8.5).fillColor('#050505');
        for (const line of ptLines) {
            doc.text(line, cardX + textPad, cy, { lineBreak: false });
            cy += 11;
        }
        cy += 6;
    }

    // Image
    if (imgRH && imgBuf) {
        try {
            const imgX = cardX + (cardW - imgRW) / 2;
            doc.image(imgBuf, imgX, cy, { width: imgRW, height: imgRH });
            cy += imgRH + 2;
        } catch {}
    }

    // Footer (gray background)
    if (headline || description || domain) {
        doc.rect(cardX, cy, cardW, cardH - (cy - cardTop)).fill('#f0f2f5');
        cy += 8;
        if (domain) {
            doc.font('Helvetica').fontSize(7).fillColor('#65676b')
                .text(domain, cardX + textPad, cy, { lineBreak: false });
            cy += 10;
        }
        if (hlLines.length) {
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#050505');
            for (const line of hlLines) {
                doc.text(line, cardX + textPad, cy, { lineBreak: false });
                cy += 12;
            }
        }
        if (descLines.length) {
            doc.font('Helvetica').fontSize(8).fillColor('#65676b');
            for (const line of descLines) {
                doc.text(line, cardX + textPad, cy, { lineBreak: false });
                cy += 10;
            }
        }
    }

    doc.restore();

    // Card border (after restore to release clip)
    doc.roundedRect(cardX, cardTop, cardW, cardH, 4)
        .lineWidth(0.5).strokeColor('#dadce0').stroke();

    doc.fillColor('#000000');
    ctx.y = cardTop + cardH + 6;
}

// ── Title / Section Headers ──

function renderTitleBlock(ctx, title, platformLabel, data) {
    const doc = ctx.doc;
    doc.font('Helvetica-Bold').fontSize(F_TITLE)
        .text(title, MARGIN, ctx.y, { lineBreak: false });
    ctx.y += 24;

    const parts = [];
    if (platformLabel) parts.push(platformLabel);
    if (data && data.campaigns) {
        const isMeta = data.platform === 'meta';
        const campCount = data.campaigns.length;
        let agCount = 0, adCount = 0;
        for (const c of data.campaigns) {
            if (isMeta) {
                agCount += (c.adSets || []).length;
                for (const s of (c.adSets || [])) adCount += s.ads.length;
            } else {
                agCount += (c.adGroups || []).length;
                for (const ag of (c.adGroups || [])) adCount += ag.ads.length;
            }
        }
        const agLabel = isMeta ? 'Ad Sets' : 'Ad Groups';
        parts.push(`${campCount} Campaigns, ${agCount} ${agLabel}, ${adCount} Ads`);
    }
    parts.push(`Generated ${fmtFullDate(new Date())}`);
    doc.font('Helvetica').fontSize(9)
        .text(parts.join('  |  '), MARGIN, ctx.y, { lineBreak: false });
    ctx.y += 18;

    doc.moveTo(MARGIN, ctx.y).lineTo(PAGE_W - MARGIN, ctx.y).lineWidth(0.5).stroke();
    ctx.y += 10;
}

function renderSectionDivider(ctx, text) {
    checkPageBreak(ctx, 30);
    ctx.doc.font('Helvetica-Bold').fontSize(F_SECTION)
        .text(text, MARGIN, ctx.y, { lineBreak: false });
    ctx.y += 18;
    ctx.doc.moveTo(MARGIN, ctx.y).lineTo(PAGE_W - MARGIN, ctx.y).lineWidth(0.5).stroke();
    ctx.y += 8;
}

// ── Google Ads Rendering ──

function renderGoogleData(ctx, data) {
    const doc = ctx.doc;
    const hasAccounts = data.accounts && data.accounts.length > 1;
    const accountLookup = {};
    if (data.accounts) data.accounts.forEach(a => { accountLookup[a.id] = a; });

    let currentAccountId = null;

    for (const camp of data.campaigns) {
        if (hasAccounts && camp.accountId && camp.accountId !== currentAccountId) {
            if (currentAccountId !== null) {
                renderAccountExtras(ctx, data, currentAccountId);
            }
            currentAccountId = camp.accountId;
            const acct = accountLookup[currentAccountId] || {};
            checkPageBreak(ctx, 30);
            ctx.y += 6;
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a56db')
                .text(acct.name || currentAccountId, MARGIN, ctx.y, { lineBreak: false });
            ctx.y += 15;
            doc.font('Helvetica').fontSize(F_LABEL).fillColor('#666666')
                .text(`Account ID: ${acct.id || currentAccountId}`, MARGIN, ctx.y, { lineBreak: false });
            ctx.y += 10;
            doc.fillColor('#000000');
        }

        renderGoogleCampaign(ctx, camp, data.historical);
    }

    if (hasAccounts && currentAccountId !== null) {
        renderAccountExtras(ctx, data, currentAccountId);
    }

    if (!hasAccounts) {
        renderAccountExtras(ctx, data, data.account?.id || '840-838-5870');
    }
}

function renderGoogleCampaign(ctx, camp, isHistorical) {
    const doc = ctx.doc;
    const isPMax = camp.type === 'PERFORMANCE_MAX';
    checkPageBreak(ctx, 20);
    ctx.y += 4;

    // Campaign header bar
    doc.rect(I0, ctx.y, CONTENT_W, 16).fill('#f0f0f0');
    doc.font('Helvetica-Bold').fontSize(F_CAMPAIGN).fillColor('#000000');
    doc.text('Campaign:', I0 + 4, ctx.y + 3, { lineBreak: false });

    const labelW = doc.widthOfString('Campaign: ');
    const nameX = I0 + 4 + labelW;
    const maxNameW = CONTENT_W - labelW - 88;
    const campName = truncText(doc, camp.name || 'Unnamed', maxNameW);
    doc.text(campName, nameX, ctx.y + 3, { lineBreak: false });

    // Badges (right-aligned)
    let badgeX = PAGE_W - MARGIN - 4;
    if (isPMax) {
        const pmaxStr = 'PMAX';
        doc.font('Helvetica-Bold').fontSize(6);
        const pmaxW = doc.widthOfString(pmaxStr) + 6;
        badgeX -= pmaxW;
        doc.rect(badgeX, ctx.y + 3, pmaxW, 10).fill('#7c3aed');
        doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff')
            .text(pmaxStr, badgeX + 3, ctx.y + 4.5, { lineBreak: false });
        badgeX -= 4;
    }
    const statusStr = camp.status || '';
    if (statusStr) {
        doc.font('Helvetica').fontSize(6);
        const statusW = doc.widthOfString(statusStr) + 6;
        badgeX -= statusW;
        const statusColor = statusStr === 'ENABLED' ? '#16a34a' : '#9ca3af';
        doc.rect(badgeX, ctx.y + 3, statusW, 10).fill(statusColor);
        doc.font('Helvetica').fontSize(6).fillColor('#ffffff')
            .text(statusStr, badgeX + 3, ctx.y + 4.5, { lineBreak: false });
    }
    doc.fillColor('#000000');
    ctx.y += 20;

    const campaignSitelinks = (camp.assets || []).filter(a => a.type === 'SITELINK');
    for (const ag of (camp.adGroups || [])) {
        renderGoogleAdGroup(ctx, ag, isHistorical, campaignSitelinks);
    }

    if (camp.assetGroups && camp.assetGroups.length > 0) {
        for (const ag of camp.assetGroups) {
            renderAssetGroup(ctx, ag);
        }
    }

    if (camp.assets && camp.assets.length > 0) {
        renderExtensionList(ctx, camp.assets, 'Campaign Extensions');
    }

    ctx.y += 4;
}

function renderGoogleAdGroup(ctx, ag, isHistorical, sitelinks) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 16);
    doc.font('Helvetica-Bold').fontSize(F_ADGROUP).fillColor('#374151')
        .text('Ad Group:', I1, ctx.y, { lineBreak: false });
    const nameX = I1 + doc.widthOfString('Ad Group: ');
    doc.font('Helvetica').fontSize(F_ADGROUP)
        .text(ag.name || 'Unnamed', nameX, ctx.y, { lineBreak: false });
    doc.fillColor('#000000');
    ctx.y += 13;

    for (const ad of ag.ads) {
        renderGoogleAd(ctx, ad, isHistorical, sitelinks);
    }

    if (ag.keywords && ag.keywords.length > 0) {
        renderKeywordList(ctx, ag.keywords, 'Targeted Keywords', false);
    }

    if (ag.negativeKeywords && ag.negativeKeywords.length > 0) {
        renderKeywordList(ctx, ag.negativeKeywords, 'Negative Keywords', true);
    }

    ctx.y += 4;
}

function renderGoogleAd(ctx, ad, isHistorical, sitelinks) {
    const doc = ctx.doc;
    const typeName = (ad.type || 'UNKNOWN').replace(/_/g, ' ');
    checkPageBreak(ctx, 14);

    doc.font('Helvetica-Bold').fontSize(F_BODY).fillColor('#6b7280')
        .text(`Ad: ${typeName}`, I2, ctx.y, { lineBreak: false });
    if (isHistorical && ad.status) {
        const afterType = I2 + doc.widthOfString(`Ad: ${typeName} `);
        const statusColor = ad.status === 'ENABLED' ? '#16a34a' : '#9ca3af';
        doc.font('Helvetica').fontSize(6).fillColor(statusColor)
            .text(`[${ad.status}]`, afterType, ctx.y + 1, { lineBreak: false });
    }
    doc.fillColor('#000000');
    ctx.y += 11;

    // Ad preview card
    const isRSA = ad.type === 'RESPONSIVE_SEARCH_AD';
    const isETA = ad.type === 'EXPANDED_TEXT_AD';
    const isRDA = ad.type === 'RESPONSIVE_DISPLAY_AD';
    if ((isRSA || isETA) && ad.headlines && ad.headlines.length > 0) {
        renderSearchPreview(ctx, ad, sitelinks);
    } else if (isRDA) {
        renderDisplayPreview(ctx, ad);
    }

    // URL
    if (ad.finalUrls && ad.finalUrls.length > 0) {
        doc.font('Helvetica').fontSize(F_LABEL).fillColor('#2563eb')
            .text(ad.finalUrls[0], I3, ctx.y, { lineBreak: false });
        doc.fillColor('#000000');
        ctx.y += 9;
    }

    // Headlines
    if (ad.headlines && ad.headlines.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Headlines (${ad.headlines.length}):`, I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        for (const h of ad.headlines) {
            checkPageBreak(ctx, 10);
            let text = `${h.position}. ${h.text}`;
            if (h.pinnedField) text += ` [${formatPin(h.pinnedField)}]`;
            textBlock(ctx, text, I4, CONTENT_W - (I4 - MARGIN));
        }
    }

    // Descriptions
    if (ad.descriptions && ad.descriptions.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Descriptions (${ad.descriptions.length}):`, I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        for (const d of ad.descriptions) {
            checkPageBreak(ctx, 10);
            let text = `${d.position}. ${d.text}`;
            if (d.pinnedField) text += ` [${formatPin(d.pinnedField)}]`;
            textBlock(ctx, text, I4, CONTENT_W - (I4 - MARGIN));
        }
    }

    // Long headline (RDA)
    if (ad.longHeadline) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text('Long Headline:', I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        textBlock(ctx, ad.longHeadline, I4, CONTENT_W - (I4 - MARGIN));
    }

    // Business name (RDA)
    if (ad.businessName) {
        checkPageBreak(ctx, 10);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text('Business Name:', I3, ctx.y, { lineBreak: false });
        const bnX = I3 + doc.widthOfString('Business Name: ');
        doc.font('Helvetica').fontSize(F_ITEM)
            .text(ad.businessName, bnX, ctx.y, { lineBreak: false });
        ctx.y += 10;
    }

    ctx.y += 3;
}

function renderAssetGroup(ctx, ag) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 16);
    doc.font('Helvetica-Bold').fontSize(F_ADGROUP).fillColor('#374151')
        .text('Asset Group:', I1, ctx.y, { lineBreak: false });
    const nameX = I1 + doc.widthOfString('Asset Group: ');
    doc.font('Helvetica').fontSize(F_ADGROUP)
        .text(ag.name || 'Unnamed', nameX, ctx.y, { lineBreak: false });
    const pmaxX = nameX + doc.widthOfString((ag.name || 'Unnamed') + ' ');
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#7c3aed')
        .text('[PMAX]', pmaxX, ctx.y + 1, { lineBreak: false });
    doc.fillColor('#000000');
    ctx.y += 13;

    // PMax preview card
    if (ag.headlines && ag.headlines.length > 0) {
        renderPMaxPreviewCard(ctx, ag);
    }

    // Final URL
    if (ag.finalUrl) {
        doc.font('Helvetica').fontSize(F_LABEL).fillColor('#2563eb')
            .text(ag.finalUrl, I2, ctx.y, { lineBreak: false });
        doc.fillColor('#000000');
        ctx.y += 9;
    }

    // Headlines
    if (ag.headlines && ag.headlines.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Headlines (${ag.headlines.length}):`, I2, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ag.headlines.forEach((h, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${h.text}`, I3, CONTENT_W - (I3 - MARGIN));
        });
    }

    // Long headlines
    if (ag.longHeadlines && ag.longHeadlines.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Long Headlines (${ag.longHeadlines.length}):`, I2, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ag.longHeadlines.forEach((h, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${h.text}`, I3, CONTENT_W - (I3 - MARGIN));
        });
    }

    // Descriptions
    if (ag.descriptions && ag.descriptions.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Descriptions (${ag.descriptions.length}):`, I2, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ag.descriptions.forEach((d, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${d.text}`, I3, CONTENT_W - (I3 - MARGIN));
        });
    }

    // Business name
    if (ag.businessName) {
        checkPageBreak(ctx, 10);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text('Business Name:', I2, ctx.y, { lineBreak: false });
        const bnX = I2 + doc.widthOfString('Business Name: ');
        doc.font('Helvetica').fontSize(F_ITEM)
            .text(ag.businessName, bnX, ctx.y, { lineBreak: false });
        ctx.y += 10;
    }

    // Images
    if (ag.images && ag.images.length > 0) {
        checkPageBreak(ctx, 14);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Images (${ag.images.length}):`, I2, ctx.y, { lineBreak: false });
        ctx.y += 9;
        const imgMaxW = 120, imgMaxH = 90;
        const imgCols = 3, imgGap = 8;
        let imgCol = 0, rowMaxH = 0;
        for (const img of ag.images) {
            if (!img.imageUrl) continue;
            const buf = ctx.imageCache?.get(img.imageUrl);
            if (!buf) continue;
            const dims = getImageDimensions(buf);
            if (!dims) continue;
            const scale = Math.min(imgMaxW / dims.width, imgMaxH / dims.height, 1);
            const rW = Math.round(dims.width * scale);
            const rH = Math.round(dims.height * scale);
            if (imgCol >= imgCols) {
                ctx.y += rowMaxH + imgGap;
                imgCol = 0;
                rowMaxH = 0;
                checkPageBreak(ctx, rH + 4);
            }
            const ix = I3 + imgCol * (imgMaxW + imgGap);
            try { ctx.doc.image(buf, ix, ctx.y, { width: rW, height: rH }); } catch {}
            rowMaxH = Math.max(rowMaxH, rH);
            imgCol++;
        }
        if (rowMaxH > 0) ctx.y += rowMaxH + imgGap;
    }

    // Logos
    if (ag.logos && ag.logos.length > 0) {
        checkPageBreak(ctx, 14);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Logos (${ag.logos.length}):`, I2, ctx.y, { lineBreak: false });
        ctx.y += 9;
        const logoMaxW = 60, logoMaxH = 60, logoGap = 8;
        let logoCol = 0, logoRowH = 0;
        for (const logo of ag.logos) {
            if (!logo.imageUrl) continue;
            const buf = ctx.imageCache?.get(logo.imageUrl);
            if (!buf) continue;
            const dims = getImageDimensions(buf);
            if (!dims) continue;
            const scale = Math.min(logoMaxW / dims.width, logoMaxH / dims.height, 1);
            const rW = Math.round(dims.width * scale);
            const rH = Math.round(dims.height * scale);
            if (logoCol >= 5) {
                ctx.y += logoRowH + logoGap;
                logoCol = 0;
                logoRowH = 0;
                checkPageBreak(ctx, rH + 4);
            }
            const lx = I3 + logoCol * (logoMaxW + logoGap);
            try { ctx.doc.image(buf, lx, ctx.y, { width: rW, height: rH }); } catch {}
            logoRowH = Math.max(logoRowH, rH);
            logoCol++;
        }
        if (logoRowH > 0) ctx.y += logoRowH + logoGap;
    }

    ctx.y += 3;
}

function renderKeywordList(ctx, keywords, title, isNegative) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 14);
    doc.font('Helvetica-Bold').fontSize(F_LABEL)
        .text(`${title} (${keywords.length}):`, I2, ctx.y, { lineBreak: false });
    ctx.y += 9;

    doc.font('Helvetica').fontSize(F_ITEM);
    if (isNegative) doc.fillColor('#dc2626');
    for (const kw of keywords) {
        checkPageBreak(ctx, 10);
        let text = kw.keyword;
        if (kw.matchType) text += ` [${kw.matchType}]`;
        if (kw.level === 'campaign') text += ' [Campaign]';
        textBlock(ctx, text, I3, CONTENT_W - (I3 - MARGIN));
    }
    doc.fillColor('#000000');
    ctx.y += 2;
}

function renderExtensionList(ctx, assets, title) {
    const doc = ctx.doc;

    const sitelinks = assets.filter(a => a.type === 'SITELINK');
    const callouts = assets.filter(a => a.type === 'CALLOUT');
    const snippets = assets.filter(a => a.type === 'STRUCTURED_SNIPPET');
    const total = sitelinks.length + callouts.length + snippets.length;
    if (total === 0) return;

    checkPageBreak(ctx, 14);
    doc.font('Helvetica-Bold').fontSize(F_LABEL)
        .text(`${title}:`, I2, ctx.y, { lineBreak: false });
    ctx.y += 9;

    doc.font('Helvetica').fontSize(F_ITEM);
    for (const sl of sitelinks) {
        checkPageBreak(ctx, 10);
        let text = `Sitelink: ${sl.linkText || sl.name || ''}`;
        if (sl.desc1) text += ` \u2014 ${sl.desc1}`;
        if (sl.desc2) text += ` \u2014 ${sl.desc2}`;
        textBlock(ctx, text, I3, CONTENT_W - (I3 - MARGIN));
    }

    for (const co of callouts) {
        checkPageBreak(ctx, 10);
        textBlock(ctx, `Callout: ${co.text || ''}`, I3, CONTENT_W - (I3 - MARGIN));
    }

    for (const ss of snippets) {
        checkPageBreak(ctx, 10);
        const vals = (ss.values || []).join(', ');
        textBlock(ctx, `Structured Snippet: ${ss.header || ''}: ${vals}`, I3, CONTENT_W - (I3 - MARGIN));
    }

    ctx.y += 2;
}

function renderAccountExtras(ctx, data, accountId) {
    const doc = ctx.doc;
    const primaryId = data.account?.id || '840-838-5870';

    let acctAssets, acctNegKws, negKwLists;
    if (accountId === primaryId) {
        acctAssets = data.accountAssets || [];
        acctNegKws = data.accountNegativeKeywords || [];
        negKwLists = data.negativeKeywordLists || [];
    } else {
        const extras = (data.accountExtras || {})[accountId] || {};
        acctAssets = extras.accountAssets || [];
        acctNegKws = extras.accountNegativeKeywords || [];
        negKwLists = extras.negativeKeywordLists || [];
    }

    // Account-level negative keywords didn't exist before Jan 2023
    if (data.historical && data.year && data.year < 2023) {
        acctNegKws = [];
    }

    // Account-level extensions
    if (acctAssets.length > 0) {
        renderExtensionList(ctx, acctAssets, 'Account-Level Extensions');
    }

    // Account-level negative keywords
    if (acctNegKws.length > 0) {
        checkPageBreak(ctx, 14);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Account-Level Negative Keywords (${acctNegKws.length}):`, I0, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM).fillColor('#dc2626');
        for (const kw of acctNegKws) {
            checkPageBreak(ctx, 10);
            let text = kw.keyword;
            if (kw.matchType) text += ` [${kw.matchType}]`;
            textBlock(ctx, text, I1, CONTENT_W - (I1 - MARGIN));
        }
        doc.fillColor('#000000');
        ctx.y += 2;
    }

    // Shared negative keyword lists
    if (negKwLists.length > 0) {
        checkPageBreak(ctx, 14);
        doc.font('Helvetica-Bold').fontSize(F_ADGROUP)
            .text('Shared Negative Keyword Lists', I0, ctx.y, { lineBreak: false });
        ctx.y += 13;

        for (const list of negKwLists) {
            checkPageBreak(ctx, 14);
            doc.font('Helvetica-Bold').fontSize(F_BODY)
                .text(`${list.name} (${list.keywords.length} keywords)`, I1, ctx.y, { lineBreak: false });
            ctx.y += 10;

            if (list.campaigns.length > 0) {
                doc.font('Helvetica').fontSize(F_LABEL).fillColor('#6b7280');
                textBlock(ctx, `Applied to: ${list.campaigns.join(', ')}`, I2, CONTENT_W - (I2 - MARGIN));
                doc.fillColor('#000000');
            }

            doc.font('Helvetica').fontSize(F_ITEM).fillColor('#dc2626');
            for (const kw of list.keywords) {
                checkPageBreak(ctx, 10);
                let text = kw.keyword;
                if (kw.matchType) text += ` [${kw.matchType}]`;
                textBlock(ctx, text, I2, CONTENT_W - (I2 - MARGIN));
            }
            doc.fillColor('#000000');
            ctx.y += 4;
        }
    }
}

// ── Meta Ads Rendering ──

function renderMetaData(ctx, data) {
    for (const camp of data.campaigns) {
        renderMetaCampaign(ctx, camp, data.historical);
    }
}

function renderMetaCampaign(ctx, camp, isHistorical) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 20);
    ctx.y += 4;

    // Campaign header bar (blue tint for Meta)
    doc.rect(I0, ctx.y, CONTENT_W, 16).fill('#eef2ff');
    doc.font('Helvetica-Bold').fontSize(F_CAMPAIGN).fillColor('#000000');
    doc.text('Campaign:', I0 + 4, ctx.y + 3, { lineBreak: false });

    const labelW = doc.widthOfString('Campaign: ');
    const nameX = I0 + 4 + labelW;
    const maxNameW = CONTENT_W - labelW - 88;
    const campName = truncText(doc, camp.name || 'Unnamed', maxNameW);
    doc.text(campName, nameX, ctx.y + 3, { lineBreak: false });

    // Status + objective badges (right-aligned)
    let badgeX = PAGE_W - MARGIN - 4;
    if (camp.objective) {
        const objStr = camp.objective.replace(/_/g, ' ');
        doc.font('Helvetica').fontSize(6);
        const objW = doc.widthOfString(objStr) + 6;
        badgeX -= objW;
        doc.rect(badgeX, ctx.y + 3, objW, 10).fill('#6366f1');
        doc.font('Helvetica').fontSize(6).fillColor('#ffffff')
            .text(objStr, badgeX + 3, ctx.y + 4.5, { lineBreak: false });
        badgeX -= 4;
    }
    const statusStr = camp.status || '';
    if (statusStr) {
        doc.font('Helvetica').fontSize(6);
        const statusW = doc.widthOfString(statusStr) + 6;
        badgeX -= statusW;
        const statusColor = statusStr === 'ACTIVE' ? '#16a34a' : '#9ca3af';
        doc.rect(badgeX, ctx.y + 3, statusW, 10).fill(statusColor);
        doc.font('Helvetica').fontSize(6).fillColor('#ffffff')
            .text(statusStr, badgeX + 3, ctx.y + 4.5, { lineBreak: false });
    }
    doc.fillColor('#000000');
    ctx.y += 20;

    for (const adSet of (camp.adSets || [])) {
        renderMetaAdSet(ctx, adSet, isHistorical);
    }

    ctx.y += 4;
}

function renderMetaAdSet(ctx, adSet, isHistorical) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 14);
    doc.font('Helvetica-Bold').fontSize(F_ADGROUP).fillColor('#374151')
        .text('Ad Set:', I1, ctx.y, { lineBreak: false });
    const nameX = I1 + doc.widthOfString('Ad Set: ');
    doc.font('Helvetica').fontSize(F_ADGROUP)
        .text(adSet.name || 'Unnamed', nameX, ctx.y, { lineBreak: false });
    doc.fillColor('#000000');
    ctx.y += 13;

    for (const ad of adSet.ads) {
        renderMetaAd(ctx, ad, isHistorical);
    }

    ctx.y += 3;
}

function renderMetaAd(ctx, ad, isHistorical) {
    const doc = ctx.doc;
    checkPageBreak(ctx, 14);

    doc.font('Helvetica-Bold').fontSize(F_BODY).fillColor('#1877f2')
        .text('Ad:', I2, ctx.y, { lineBreak: false });
    const nameX = I2 + doc.widthOfString('Ad: ');
    doc.font('Helvetica').fontSize(F_BODY).fillColor('#000000')
        .text(ad.name || 'Unnamed', nameX, ctx.y, { lineBreak: false });
    if (isHistorical && ad.status) {
        const afterName = nameX + doc.widthOfString((ad.name || 'Unnamed') + ' ');
        const statusColor = ad.status === 'ACTIVE' ? '#16a34a' : '#9ca3af';
        doc.font('Helvetica').fontSize(6).fillColor(statusColor)
            .text(`[${ad.status}]`, afterName, ctx.y + 1, { lineBreak: false });
    }
    doc.fillColor('#000000');
    ctx.y += 11;

    // Meta ad preview card
    renderMetaPreviewCard(ctx, ad);

    // Link URL
    if (ad.linkUrl) {
        doc.font('Helvetica').fontSize(F_LABEL).fillColor('#2563eb')
            .text(ad.linkUrl, I3, ctx.y, { lineBreak: false });
        doc.fillColor('#000000');
        ctx.y += 9;
    }

    // Primary texts
    if (ad.primaryTexts && ad.primaryTexts.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Primary Text (${ad.primaryTexts.length}):`, I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ad.primaryTexts.forEach((t, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${t.text}`, I4, CONTENT_W - (I4 - MARGIN));
        });
    }

    // Headlines
    if (ad.headlines && ad.headlines.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Headlines (${ad.headlines.length}):`, I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ad.headlines.forEach((h, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${h.text}`, I4, CONTENT_W - (I4 - MARGIN));
        });
    }

    // Descriptions
    if (ad.descriptions && ad.descriptions.length > 0) {
        checkPageBreak(ctx, 12);
        doc.font('Helvetica-Bold').fontSize(F_LABEL)
            .text(`Descriptions (${ad.descriptions.length}):`, I3, ctx.y, { lineBreak: false });
        ctx.y += 9;
        doc.font('Helvetica').fontSize(F_ITEM);
        ad.descriptions.forEach((d, i) => {
            checkPageBreak(ctx, 10);
            textBlock(ctx, `${i + 1}. ${d.text}`, I4, CONTENT_W - (I4 - MARGIN));
        });
    }

    ctx.y += 3;
}

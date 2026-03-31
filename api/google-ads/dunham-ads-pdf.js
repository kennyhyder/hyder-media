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

        const yearLabel = yearParam === 'active' ? 'Active Ads' : yearParam;
        const platformLabel = platform === 'meta' ? 'Meta Ads' : 'Google Ads';
        const filename = `dunham-ads-${platform}-${yearParam}.pdf`;

        const doc = new PDFDocument({ size: 'letter', margin: MARGIN, bufferPages: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const ctx = createCtx(doc);
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
        renderGoogleData(ctx, data);
    }

    for (const yr of metaYears) {
        const data = allData[`meta:${yr}`];
        if (!data) continue;
        if (needsNewPage) { drawFooter(ctx); doc.addPage(); ctx.y = MARGIN; ctx.pageNum++; }
        needsNewPage = true;
        const label = yr === 'active' ? 'Active Ads' : String(yr);
        renderSectionDivider(ctx, `Meta Ads \u2014 ${label}`);
        renderMetaData(ctx, data);
    }

    drawFooter(ctx);
    doc.end();
}

// ── PDF Helpers ──

function createCtx(doc) {
    return { doc, y: MARGIN, pageNum: 1 };
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

    for (const ag of (camp.adGroups || [])) {
        renderGoogleAdGroup(ctx, ag, isHistorical);
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

function renderGoogleAdGroup(ctx, ag, isHistorical) {
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
        renderGoogleAd(ctx, ad, isHistorical);
    }

    if (ag.keywords && ag.keywords.length > 0) {
        renderKeywordList(ctx, ag.keywords, 'Targeted Keywords', false);
    }

    if (ag.negativeKeywords && ag.negativeKeywords.length > 0) {
        renderKeywordList(ctx, ag.negativeKeywords, 'Negative Keywords', true);
    }

    ctx.y += 4;
}

function renderGoogleAd(ctx, ad, isHistorical) {
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

    // Images note (skip embedding remote images)
    const imgCount = (ag.images?.length || 0) + (ag.logos?.length || 0);
    if (imgCount > 0) {
        checkPageBreak(ctx, 10);
        doc.font('Helvetica').fontSize(F_LABEL).fillColor('#6b7280')
            .text(`(${imgCount} images \u2014 see online report)`, I2, ctx.y, { lineBreak: false });
        doc.fillColor('#000000');
        ctx.y += 10;
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

    // Image note (skip embedding remote images)
    if (ad.imageUrl || ad.thumbnailUrl) {
        checkPageBreak(ctx, 10);
        doc.font('Helvetica').fontSize(F_LABEL).fillColor('#6b7280')
            .text('(1 image \u2014 see online report)', I3, ctx.y, { lineBreak: false });
        doc.fillColor('#000000');
        ctx.y += 10;
    }

    ctx.y += 3;
}

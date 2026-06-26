// Omicron weekly performance report — full slideshow PDF, emailed weekly.
//
// Mirrors every dashboard tab so the VP gets the whole picture in one deck:
//   • Title + portfolio KPI cards
//   • Overview      — conversions, CPA, cost distribution (all accounts ex Sunny/Pure)
//   • Review Sites  — conversions, CPA, cost (BUR + Top10usenet)
//   • Owned Sites   — conversions, CPA, cost (ex Sunny/Pure)
//   • Account Details — one slide per brand: conversions, CPA, spend, SKU/brand breakdown
//
// Charts render chromium-free via QuickChart (Chart.js → PNG); pdfkit assembles
// landscape slides. Scheduled Tuesday 12pm America/New_York (cron at 16:00 &
// 17:00 UTC, gated on noon ET so exactly one fires across DST). ?force=1 sends
// now; ?pdf=1 returns the PDF bytes instead of emailing (both need CRON_SECRET).
// Recipient: OMICRON_REPORT_TO (defaults to kenny@hyder.me for the approval loop).

import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';

const HM = 'https://hyder.me';
const BLUE = '#3b82f6';
const RED = '#ef4444';
const INK = '#0f172a';
const MUTED = '#64748b';
const SKU_COLORS = ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#4ade80', '#86efac', '#bbf7d0'];
const BRAND_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#ef4444', '#6366f1', '#eab308'];
// Account Details display order (Sunny/Pure last — deprecated from regular reporting).
const ORDER = ['BUR', 'Top10usenet', 'Newshosting', 'Easynews', 'Eweka', 'Tweak', 'UsenetServer', 'Privado', 'Sunny', 'Pure'];
const DEPRECATED = ['Sunny', 'Pure'];

function isNoonET(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  return parts.find(p => p.type === 'weekday').value === 'Tue' && Number(parts.find(p => p.type === 'hour').value) === 12;
}

const fmtMonth = (m) => { const [y, mo] = String(m).split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const num = (n) => Math.round(Number(n) || 0).toLocaleString();
const orderIdx = (name) => { const i = ORDER.indexOf(name); return i === -1 ? ORDER.length : i; };

// Sum a set of accounts' monthly series into a totals-style array.
function aggregateMonthly(accounts) {
  const byMonth = new Map();
  for (const acc of accounts) {
    for (const m of (acc.monthly || [])) {
      let e = byMonth.get(m.month);
      if (!e) { e = { month: m.month, brand: { spend: 0, conversions: 0 }, nonBrand: { spend: 0, conversions: 0 } }; byMonth.set(m.month, e); }
      for (const seg of ['brand', 'nonBrand']) { const s = m[seg] || {}; e[seg].spend += s.spend || 0; e[seg].conversions += s.conversions || 0; }
    }
  }
  const out = [...byMonth.values()].sort((a, b) => a.month < b.month ? -1 : 1);
  for (const e of out) {
    e.brand.cpa = e.brand.conversions ? e.brand.spend / e.brand.conversions : 0;
    e.nonBrand.cpa = e.nonBrand.conversions ? e.nonBrand.spend / e.nonBrand.conversions : 0;
    e.total = { spend: e.brand.spend + e.nonBrand.spend, conversions: e.brand.conversions + e.nonBrand.conversions };
    e.total.cpa = e.total.conversions ? e.total.spend / e.total.conversions : 0;
  }
  return out;
}

async function chartPng(config, width = 820, height = 540) {
  const res = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, width, height, format: 'png', backgroundColor: 'white', devicePixelRatio: 2, version: '4' }),
  });
  if (!res.ok) throw new Error('quickchart ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// Bounded-concurrency map so ~40 chart calls don't hammer QuickChart at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// brand/non-brand bar chart. kind: conv | cpa | cost | costpct
function barConfig(monthly, kind) {
  const labels = monthly.map(m => fmtMonth(m.month));
  const stacked = kind !== 'cpa';
  let datasets;
  if (kind === 'costpct') {
    const tot = monthly.map(m => (m.total?.spend || ((m.brand?.spend || 0) + (m.nonBrand?.spend || 0)) || 1));
    datasets = [
      { label: 'Non-Brand', data: monthly.map((m, i) => Math.round(((m.nonBrand?.spend || 0) / tot[i]) * 100)), backgroundColor: BLUE },
      { label: 'Brand', data: monthly.map((m, i) => Math.round(((m.brand?.spend || 0) / tot[i]) * 100)), backgroundColor: RED },
    ];
  } else {
    const pick = (m, seg) => kind === 'conv' ? (m[seg]?.conversions || 0) : kind === 'cpa' ? (m[seg]?.cpa || 0) : (m[seg]?.spend || 0);
    datasets = [
      { label: 'Non-Brand', data: monthly.map(m => Math.round(pick(m, 'nonBrand'))), backgroundColor: BLUE },
      { label: 'Brand', data: monthly.map(m => Math.round(pick(m, 'brand'))), backgroundColor: RED },
    ];
  }
  return {
    type: 'bar', data: { labels, datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        datalabels: { color: stacked ? '#fff' : INK, anchor: stacked ? 'center' : 'end', align: stacked ? 'center' : 'end', font: { size: 10, weight: 'bold' } },
      },
      scales: { x: { stacked, ticks: { font: { size: 10 } } }, y: { stacked, ticks: { font: { size: 10 } }, ...(kind === 'costpct' ? { max: 100 } : {}) } },
    },
  };
}

// SKU/brand conversion breakdown (one color per action; legend, no per-segment labels).
function skuConfig(convAccount, isReview) {
  const monthly = convAccount.monthly || [];
  const labels = monthly.map(m => fmtMonth(m.month));
  const top = (convAccount.conversionActions || []).slice(0, 8).map(a => a.name);
  const palette = isReview ? BRAND_COLORS : SKU_COLORS;
  const datasets = top.map((name, i) => ({ label: name, data: monthly.map(m => Math.round(m.actions?.[name]?.conversions || 0)), backgroundColor: palette[i % palette.length] }));
  return {
    type: 'bar', data: { labels, datasets },
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 8 }, boxWidth: 8, padding: 4 } }, datalabels: { display: false } },
      scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } },
    },
  };
}

function kpis(monthly) {
  return monthly.reduce((a, m) => {
    a.spend += m.total.spend; a.conv += m.total.conversions;
    a.bSpend += m.brand.spend; a.bConv += m.brand.conversions;
    a.nSpend += m.nonBrand.spend; a.nConv += m.nonBrand.conversions;
    return a;
  }, { spend: 0, conv: 0, bSpend: 0, bConv: 0, nSpend: 0, nConv: 0 });
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  const auth = req.headers.authorization || '';
  const force = req.query?.force === '1';
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  // Safe recipient check (no PDF build, no send) — confirm the configured list.
  if (req.query?.recipients === '1') {
    return res.status(200).json({ ok: true, configured_to: process.env.OMICRON_REPORT_TO || 'kenny@hyder.me (default)', cc: process.env.OMICRON_REPORT_CC || null });
  }
  if (!force && !isNoonET()) return res.status(200).json({ ok: true, skipped: 'not noon ET Tuesday' });

  try {
    // 1) Data — 6 months monthly + conversion-action breakdown.
    const [data, conv] = await Promise.all([
      (await fetch(`${HM}/api/google-ads/omicron-monthly?lookback=6mo`)).json(),
      (await fetch(`${HM}/api/google-ads/omicron-conversions?lookback=6mo`)).json(),
    ]);
    const ok = (data.accounts || []).filter(a => a.status === 'success');
    const convByName = new Map((conv.accounts || []).filter(a => a.status === 'success').map(a => [a.name, a]));
    const allActive = ok.filter(a => !DEPRECATED.includes(a.name));
    const review = ok.filter(a => a.group === 'review');
    const ownedActive = ok.filter(a => a.group === 'owned' && !DEPRECATED.includes(a.name));
    const overview = aggregateMonthly(allActive);
    const reviewM = aggregateMonthly(review);
    const ownedM = aggregateMonthly(ownedActive);
    const range = overview.length ? `${fmtMonth(overview[0].month)} – ${fmtMonth(overview[overview.length - 1].month)}` : '';
    const orderedAccounts = ok.slice().sort((a, b) => orderIdx(a.name) - orderIdx(b.name));

    // 2) Build slide specs (chart configs + captions).
    const slides = [];
    slides.push({ type: 'kpi', range });
    slides.push({ type: 'charts', title: 'Overview', sub: range + ' · all accounts (excl. Sunny & Pure)', items: [
      { config: barConfig(overview, 'conv'), caption: 'Conversions (Brand vs Non-Brand)' },
      { config: barConfig(overview, 'cpa'), caption: 'CPA (Brand vs Non-Brand)' },
      { config: barConfig(overview, 'costpct'), caption: 'Cost Distribution (%)' },
    ] });
    slides.push({ type: 'charts', title: 'Review Sites', sub: 'BUR + Top10usenet', items: [
      { config: barConfig(reviewM, 'conv'), caption: 'Conversions' },
      { config: barConfig(reviewM, 'cpa'), caption: 'CPA' },
      { config: barConfig(reviewM, 'cost'), caption: 'Cost' },
    ] });
    slides.push({ type: 'charts', title: 'Owned Sites', sub: 'Direct-to-consumer brands (excl. Sunny & Pure)', items: [
      { config: barConfig(ownedM, 'conv'), caption: 'Conversions' },
      { config: barConfig(ownedM, 'cpa'), caption: 'CPA' },
      { config: barConfig(ownedM, 'cost'), caption: 'Cost' },
    ] });
    for (const acc of orderedAccounts) {
      const isReview = acc.group === 'review';
      const items = [
        { config: barConfig(acc.monthly || [], 'conv'), caption: 'Conversions' },
        { config: barConfig(acc.monthly || [], 'cpa'), caption: 'CPA' },
        { config: barConfig(acc.monthly || [], 'cost'), caption: 'Spend' },
      ];
      const cv = convByName.get(acc.name);
      if (cv && (cv.conversionActions || []).length) items.push({ config: skuConfig(cv, isReview), caption: isReview ? 'Brand Breakdown' : 'SKU Breakdown' });
      slides.push({ type: 'charts', title: acc.name, sub: (isReview ? 'Review Site' : 'Owned Site') + ' · Account Details', items });
    }

    // 3) Render every chart (bounded concurrency).
    const jobs = [];
    for (const s of slides) if (s.items) for (const it of s.items) jobs.push(it);
    const bufs = await mapLimit(jobs, 6, (it) => chartPng(it.config));
    jobs.forEach((it, i) => { it.buf = bufs[i]; });

    // 4) Assemble the PDF.
    const doc = new PDFDocument({ size: 'letter', layout: 'landscape', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(r => doc.on('end', r));
    const W = doc.page.width, H = doc.page.height;

    const slideHeader = (title, sub) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(title, 40, 34);
      if (sub) doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(sub, 40, 60);
      doc.moveTo(40, 82).lineTo(W - 40, 82).strokeColor('#e2e8f0').stroke();
    };
    // Lay N charts out in a grid (≤3 → one row; 4 → 2×2), each centered in its cell
    // with the caption directly beneath — always inside the bottom margin.
    const chartsGrid = (title, sub, items) => {
      doc.addPage();
      slideHeader(title, sub);
      const n = items.length;
      const cols = n <= 3 ? n : 2;
      const rows = Math.ceil(n / cols);
      const gap = 16, x0 = 40, y0 = 92;
      const bottomSafe = H - 52;            // everything stays above this (within margin)
      const areaW = W - 80, areaH = bottomSafe - y0;
      const cellW = (areaW - (cols - 1) * gap) / cols;
      const cellH = (areaH - (rows - 1) * gap) / rows;
      const capH = 15;
      items.forEach((it, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const cx = x0 + col * (cellW + gap), cyTop = y0 + row * (cellH + gap);
        const chMaxH = cellH - capH;
        const chH = Math.min(chMaxH, Math.round(cellW * 540 / 820));
        const chY = cyTop + Math.max(0, (chMaxH - chH) / 2);
        if (it.buf) doc.image(it.buf, cx, chY, { fit: [cellW, chH] });
        // caption DIRECTLY under the rendered chart — never at the cell bottom,
        // which would hit the page margin and make pdfkit add a blank page.
        doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(it.caption, cx, chY + chH + 4, { width: cellW, align: 'center', lineBreak: false });
      });
    };

    // Title slide
    doc.rect(0, 0, W, H).fill('#0b1220');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('Omicron — Weekly Performance', 0, H / 2 - 70, { align: 'center' });
    doc.fillColor('#93c5fd').font('Helvetica').fontSize(16).text('Google Ads · Usenet Portfolio', 0, H / 2 - 24, { align: 'center' });
    doc.fillColor('#94a3b8').fontSize(13).text(range, 0, H / 2 + 6, { align: 'center' });
    doc.fillColor('#64748b').fontSize(11).text('Prepared by Hyder Media · ' + new Date().toLocaleDateString('en-US', { dateStyle: 'long' }), 0, H - 60, { align: 'center' });

    for (const s of slides) {
      if (s.type === 'kpi') {
        doc.addPage();
        slideHeader('Portfolio Summary', s.range + ' · all accounts (excl. Sunny & Pure)');
        const k = kpis(overview);
        const cards = [
          ['Total Spend', usd(k.spend)], ['Conversions', num(k.conv)],
          ['Blended CPA', usd(k.conv ? k.spend / k.conv : 0)],
          ['Brand CPA', usd(k.bConv ? k.bSpend / k.bConv : 0)],
          ['Non-Brand CPA', usd(k.nConv ? k.nSpend / k.nConv : 0)],
        ];
        const cwx = (W - 80 - 4 * 16) / 5;
        cards.forEach(([label, val], i) => {
          const x = 40 + i * (cwx + 16), y = 150;
          doc.roundedRect(x, y, cwx, 120, 10).fillAndStroke('#f8fafc', '#e2e8f0');
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(val, x, y + 32, { width: cwx, align: 'center' });
          doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(label, x, y + 72, { width: cwx, align: 'center' });
        });
        doc.fillColor(MUTED).fontSize(11).text('Blue = Non-Brand · Red = Brand. Owned & Overview exclude Sunny & Pure (deprecated from regular reporting).', 40, H - 54, { width: W - 80, lineBreak: false });
      } else {
        chartsGrid(s.title, s.sub, s.items);
      }
    }

    doc.end();
    await done;
    const pdf = Buffer.concat(chunks);

    if (req.query?.pdf === '1') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="omicron-weekly.pdf"');
      res.end(pdf);
      return;
    }

    // 5) Email it.
    const to = (process.env.OMICRON_REPORT_TO || 'kenny@hyder.me').trim();
    const cc = (process.env.OMICRON_REPORT_CC || '').trim();
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    const stamp = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
    await transporter.sendMail({
      from: `Hyder Media <${process.env.EMAIL_USER}>`,
      to, ...(cc ? { cc } : {}),
      subject: `Omicron Weekly Performance — ${stamp}`,
      text: `Attached: the full Omicron weekly performance deck (${range}) — overview, review sites, owned sites, and per-brand account details.\n\n— Hyder Media`,
      attachments: [{ filename: `Omicron-Weekly-${new Date().toISOString().slice(0, 10)}.pdf`, content: pdf }],
    });

    return res.status(200).json({ ok: true, sent_to: to, cc: cc || null, slides: slides.length + 1, accounts: orderedAccounts.length, charts: jobs.length, months: overview.length, bytes: pdf.length, forced: force });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}

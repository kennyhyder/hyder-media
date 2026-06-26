// Omicron weekly performance report — slideshow PDF, emailed weekly.
//
// The VP of Marketing is used to a Google-slides walkthrough on the weekly call;
// this emails a slide-formatted PDF (one slide per landscape page) built from the
// same live Google Ads data the dashboard uses. Charts are rendered chromium-free
// via QuickChart (Chart.js → PNG); the PDF is assembled with pdfkit.
//
// Schedule: Tuesday 12:00 PM America/New_York. Vercel cron is fixed-UTC, so this
// is scheduled at BOTH 16:00 and 17:00 UTC Tuesday and gated on "is it noon ET"
// so exactly one fires year-round across DST. Pass ?force=1 to send immediately.
//
// Recipient: OMICRON_REPORT_TO (defaults to kenny@hyder.me for the approval loop
// until the VP's address is set). OMICRON_REPORT_CC optional.

import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';

const HM = 'https://hyder.me';
const BLUE = '#3b82f6';   // non-brand
const RED = '#ef4444';    // brand
const INK = '#0f172a';
const MUTED = '#64748b';

function isNoonET(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const wd = parts.find(p => p.type === 'weekday').value;
  return wd === 'Tue' && hour === 12;
}

const fmtMonth = (m) => {
  const [y, mo] = String(m).split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const num = (n) => Math.round(Number(n) || 0).toLocaleString();

// Sum a set of accounts' monthly series into a totals-style array (mirrors the
// dashboard's client-side aggregation so Owned-ex-Sunny/Pure matches the UI).
function aggregateMonthly(accounts) {
  const byMonth = new Map();
  for (const acc of accounts) {
    for (const m of (acc.monthly || [])) {
      let e = byMonth.get(m.month);
      if (!e) { e = { month: m.month, brand: { spend: 0, conversions: 0 }, nonBrand: { spend: 0, conversions: 0 } }; byMonth.set(m.month, e); }
      for (const seg of ['brand', 'nonBrand']) {
        const s = m[seg] || {};
        e[seg].spend += s.spend || 0;
        e[seg].conversions += s.conversions || 0;
      }
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

async function chartPng(config, width = 900, height = 560) {
  const res = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, width, height, format: 'png', backgroundColor: 'white', devicePixelRatio: 2, version: '4' }),
  });
  if (!res.ok) throw new Error('quickchart ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// A bar chart config. data values are pre-rounded so the datalabels read clean.
function barConfig(monthly, kind) {
  const labels = monthly.map(m => fmtMonth(m.month));
  const stacked = kind !== 'cpa';
  const pick = (m, seg) => kind === 'conv' ? (m[seg].conversions || 0) : kind === 'cpa' ? (m[seg].cpa || 0) : (m[seg].spend || 0);
  const datasets = [
    { label: 'Non-Brand', data: monthly.map(m => Math.round(pick(m, 'nonBrand'))), backgroundColor: BLUE, borderRadius: 3 },
    { label: 'Brand', data: monthly.map(m => Math.round(pick(m, 'brand'))), backgroundColor: RED, borderRadius: 3 },
  ];
  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 13 } } },
        datalabels: {
          color: stacked ? '#ffffff' : '#0f172a',
          anchor: stacked ? 'center' : 'end',
          align: stacked ? 'center' : 'end',
          font: { size: 11, weight: 'bold' },
          formatter: kind === 'conv' ? null : undefined,
        },
      },
      scales: {
        x: { stacked, grid: { display: false } },
        y: { stacked, ticks: { font: { size: 11 } } },
      },
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
  // Vercel cron sends the CRON_SECRET as a bearer; manual/forced runs need it too.
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!force && !isNoonET()) return res.status(200).json({ ok: true, skipped: 'not noon ET Tuesday' });

  try {
    // 1) Data — 6 months monthly, all accounts.
    const data = await (await fetch(`${HM}/api/google-ads/omicron-monthly?lookback=6mo`)).json();
    const monthlyTotals = data.monthlyTotals || [];
    const review = data.groupTotals?.review || [];
    const ok = (data.accounts || []).filter(a => a.status === 'success');
    const ownedActive = ok.filter(a => a.group === 'owned' && !['Sunny', 'Pure'].includes(a.name));
    const owned = aggregateMonthly(ownedActive);
    const range = monthlyTotals.length ? `${fmtMonth(monthlyTotals[0].month)} – ${fmtMonth(monthlyTotals[monthlyTotals.length - 1].month)}` : '';

    // 2) Charts (chromium-free via QuickChart).
    const [ovConv, ovCpa, rvConv, rvCpa, owConv, owCpa] = await Promise.all([
      chartPng(barConfig(monthlyTotals, 'conv')),
      chartPng(barConfig(monthlyTotals, 'cpa')),
      chartPng(barConfig(review, 'conv')),
      chartPng(barConfig(review, 'cpa')),
      chartPng(barConfig(owned, 'conv')),
      chartPng(barConfig(owned, 'cpa')),
    ]);

    // 3) Assemble the slideshow PDF (landscape, one slide per page).
    const doc = new PDFDocument({ size: 'letter', layout: 'landscape', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(r => doc.on('end', r));
    const W = doc.page.width, H = doc.page.height;

    const slideHeader = (title, sub) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(title, 40, 36);
      if (sub) doc.fillColor(MUTED).font('Helvetica').fontSize(12).text(sub, 40, 64);
      doc.moveTo(40, 86).lineTo(W - 40, 86).strokeColor('#e2e8f0').stroke();
    };
    const twoCharts = (title, sub, leftBuf, leftCap, rightBuf, rightCap) => {
      doc.addPage();
      slideHeader(title, sub);
      // Charts are width-constrained (PNG is 900×560), so each renders cw wide ×
      // cw*560/900 tall. Place captions DIRECTLY under the rendered chart — never
      // near the bottom margin, where overflowing text makes pdfkit add a blank page.
      const cw = (W - 80 - 20) / 2, cy = 104, ch = H - cy - 70;
      doc.image(leftBuf, 40, cy, { fit: [cw, ch] });
      doc.image(rightBuf, 40 + cw + 20, cy, { fit: [cw, ch] });
      const chartH = Math.min(ch, Math.round(cw * 560 / 900));
      const capY = cy + chartH + 14;
      doc.fillColor(MUTED).font('Helvetica').fontSize(12);
      doc.text(leftCap, 40, capY, { width: cw, align: 'center', lineBreak: false });
      doc.text(rightCap, 40 + cw + 20, capY, { width: cw, align: 'center', lineBreak: false });
    };

    // Slide 1 — title
    doc.rect(0, 0, W, H).fill('#0b1220');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('Omicron — Weekly Performance', 0, H / 2 - 70, { align: 'center' });
    doc.fillColor('#93c5fd').font('Helvetica').fontSize(16).text('Google Ads · Usenet Portfolio', 0, H / 2 - 24, { align: 'center' });
    doc.fillColor('#94a3b8').fontSize(13).text(range, 0, H / 2 + 6, { align: 'center' });
    doc.fillColor('#64748b').fontSize(11).text('Prepared by Hyder Media · ' + new Date().toLocaleDateString('en-US', { dateStyle: 'long' }), 0, H - 60, { align: 'center' });

    // Slide 2 — portfolio KPIs
    doc.addPage();
    slideHeader('Portfolio Summary', range + ' · all accounts');
    const k = kpis(monthlyTotals);
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
    doc.fillColor(MUTED).fontSize(11).text('Blue = Non-Brand · Red = Brand. Owned-site slides exclude Sunny & Pure (deprecated from regular reporting).', 40, H - 54, { width: W - 80, lineBreak: false });

    // Slides 3-5 — charts
    twoCharts('Portfolio Trend', 'All accounts', ovConv, 'Conversions (Brand vs Non-Brand)', ovCpa, 'CPA (Brand vs Non-Brand)');
    twoCharts('Review Sites', 'BUR + Top10usenet', rvConv, 'Conversions', rvCpa, 'CPA');
    twoCharts('Owned Sites', 'Excludes Sunny & Pure', owConv, 'Conversions', owCpa, 'CPA');

    doc.end();
    await done;
    const pdf = Buffer.concat(chunks);

    // Debug: return the PDF bytes directly (skip email) to inspect server output.
    if (req.query?.pdf === '1') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="omicron-weekly.pdf"');
      res.end(pdf);
      return;
    }

    // 4) Email it.
    const to = (process.env.OMICRON_REPORT_TO || 'kenny@hyder.me').trim();
    const cc = (process.env.OMICRON_REPORT_CC || '').trim();
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    const stamp = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
    await transporter.sendMail({
      from: `Hyder Media <${process.env.EMAIL_USER}>`,
      to, ...(cc ? { cc } : {}),
      subject: `Omicron Weekly Performance — ${stamp}`,
      text: `Attached: the Omicron weekly performance slideshow (${range}).\n\nGoogle Ads across the Usenet portfolio. Owned-site slides exclude Sunny & Pure.\n\n— Hyder Media`,
      attachments: [{ filename: `Omicron-Weekly-${new Date().toISOString().slice(0, 10)}.pdf`, content: pdf }],
    });

    return res.status(200).json({ ok: true, sent_to: to, cc: cc || null, slides: 5, months: monthlyTotals.length, bytes: pdf.length, forced: force });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}

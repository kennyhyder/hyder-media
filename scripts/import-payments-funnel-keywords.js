/**
 * Payments-funnel competitive keyword import — Digistore24 research.
 *
 * Context (Aug 2026): DS24 leadership wants campaigns targeting businesses
 * searching for payment processing, citing whop.com / checkoutchamp.com /
 * shop.app as reference plays. This script ingests SimilarWeb keyword exports
 * for those three domains, keeps PAID rows only, classifies every keyword by
 * intent bucket, and emits data/payments-funnel-keywords.json for the
 * payments-funnel-analysis.html page. The core question it answers: how much
 * of each brand's paid search footprint is genuinely payment-processing
 * intent vs something else entirely.
 *
 * Run: node scripts/import-payments-funnel-keywords.js
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'clients', 'digistore24', 'data');
const FILES = {
  'checkoutchamp.com': 'Website Keywords-checkoutchamp.com-(999)-(2025_08-2026_07).xlsx',
  'shop.app': 'Website Keywords-shop.app-(999)-(2025_08-2026_07).xlsx',
  'whop.com': 'Website Keywords-whop.com-(999)-(2025_08-2026_07).xlsx',
};

// Ordered — first match wins.
const CATEGORIES = [
  ['Brand — Own', /\bwhop\b|whops\b|whop\.com|\bshop app\b|shop\.app|\bshop pay\b|shoppay|^shop$|^shopapp$|^the shop app|shop (login|account|install|customer service|support)|shop\.com|checkout ?champ|check[aiou]+t champ|konnektive/i],
  ['Brand — Payment Processors', /\bstripe\b|paypal|\bsquare\b(?!space)|adyen|braintree|authorize\.?net|\bnmi\b|payoneer|\bwise\b|worldpay|checkout\.com|2checkout|paddle|lemon ?squeezy|fastspring|merchant one|helcim|payline|stax\b|nuvei|mollie|gocardless|chargebee|recurly|billsby/i],
  ['Payment Processing (core)', /payment (processor|processing|gateway|provider|service|solution|infrastructure|platform)s?|merchant (account|services)|accept (credit ?cards?|payments?|online payments?)|credit card (processing|reader|machine)|high.?risk (merchant|payment|processor)|recurring (billing|payments?)|subscription (billing|payments?|management)|billing (software|platform|system)|payment method|process payments?|pos system|point of sale/i],
  ['Brand — Ecom Platforms & Competitors', /shopify|click ?funnels|samcart|woo ?comm|bigcommerce|funnel ?kit|dropship|zendrop|\betsy\b|\bebay\b|\bamazon\b|squarespace|\bwix\b|magento|gumroad|stan store|sellfy|payhip|podia|kajabi|thinkific|teachable|\bbfcm\b/i],
  ['Checkout / Cart / CRO', /checkout|shopping cart|cart abandon|one.?click upsell|upsell|order bump|order form|payment page|post.?purchase|conversion rate|split test|funnel software|sales funnel/i],
  ['Sell Digital Products (DS24 turf)', /sell (digital|online course|course|ebook|product)|digital product|online course platform|course platform|membership site|create and sell/i],
  ['Creator / Community / Marketplace', /discord|telegram|community|membership|creator|monetiz|course marketplace|content creator|clip(ping)? (farm|job)|clips? for|paid group|mastermind|trading (group|community|discord)|sports? (picks?|betting (group|discord))|reselling (group|community)/i],
  ['Consumer Shopping / Tracking', /track(ing)? (my )?(order|package|parcel)|order track|package track|where('s| is) my (order|package)|\bbuy\b|\bdeals?\b|discount|coupon|promo code|black friday|cyber monday|gift card|price|review of|\breviews\b|\bshoe|clothing|apparel|electronics/i],
  ['Affiliate', /affiliat/i],
];

function num(v) { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%,$]/g, '')); return isFinite(n) ? n : 0; }

// Residual bucket is domain-specific — for these three brands the long tail
// IS the story: whop bids on its hosted sellers' brand names; shop.app buys
// consumer product queries; checkoutchamp's residual is misc DR/ecom terms.
const RESIDUAL = {
  'whop.com': 'Hosted-Seller Brand Terms (buyer capture)',
  'shop.app': 'Consumer Product Queries',
  'checkoutchamp.com': 'Other / DR & Ecom Misc',
};
function categorize(kw, domain) {
  for (const [name, rx] of CATEGORIES) if (rx.test(kw)) return name;
  return RESIDUAL[domain] || 'Other / Long-tail';
}

const out = { generated: new Date().toISOString().slice(0, 10), source: 'SimilarWeb paid keywords, worldwide, trailing 12mo (2025-08 → 2026-07)', domains: {} };

for (const [domain, file] of Object.entries(FILES)) {
  const wb = XLSX.readFile(path.join(DATA, file));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Website_Keywords']);
  const kept = [];
  for (const r of rows) {
    const paidShare = num(r['Paid share']);
    if (paidShare <= 0) continue;
    const clicks = num(r.Clicks);
    const paidClicks = clicks * paidShare;
    if (paidClicks < 1) continue;
    const cpc = num(r.CPC);
    kept.push({
      kw: String(r.Keywords || '').trim(),
      cat: categorize(String(r.Keywords || ''), domain),
      paidClicks: Math.round(paidClicks),
      estSpend: Math.round(paidClicks * cpc),
      volume: num(r.Volume),
      cpc,
      intent: r.Intent || null,
    });
  }
  const cats = {};
  for (const k of kept) {
    const c = (cats[k.cat] ||= { keywords: 0, paidClicks: 0, estSpend: 0 });
    c.keywords += 1; c.paidClicks += k.paidClicks; c.estSpend += k.estSpend;
  }
  kept.sort((a, b) => b.paidClicks - a.paidClicks);
  out.domains[domain] = {
    totalPaidKeywords: kept.length,
    totalPaidClicks: kept.reduce((s, k) => s + k.paidClicks, 0),
    totalEstSpend: kept.reduce((s, k) => s + k.estSpend, 0),
    categories: cats,
    keywords: kept,
  };
  console.log(`${domain}: ${kept.length} paid kws, ${out.domains[domain].totalPaidClicks.toLocaleString()} paid clicks, ~$${out.domains[domain].totalEstSpend.toLocaleString()} est spend`);
  for (const [c, v] of Object.entries(cats).sort((a, b) => b[1].paidClicks - a[1].paidClicks)) {
    console.log(`   ${c}: ${v.keywords} kws · ${v.paidClicks.toLocaleString()} clicks · $${v.estSpend.toLocaleString()} · ${(v.paidClicks / out.domains[domain].totalPaidClicks * 100).toFixed(1)}%`);
  }
}

fs.writeFileSync(path.join(DATA, 'payments-funnel-keywords.json'), JSON.stringify(out));
console.log('\nwrote data/payments-funnel-keywords.json');

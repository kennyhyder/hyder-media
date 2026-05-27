/**
 * Import PageWheel competitor keyword data from SimilarWeb Excel exports.
 *
 * Mirrors the Digistore24 import structure (scripts/import-digistore-keywords.js)
 * but with PageWheel-specific brand mapping, category rules, and topic groups
 * for the funnel-builder / landing-page-builder / website-builder space.
 *
 * Usage: node scripts/import-pagewheel-keywords.js
 *
 * Reads:
 *   /clients/digistore24/data/ppc-kws/Website Keywords-<domain>-(999)-*.xlsx
 *   (only domains in PW_BRAND_MAP — Digistore24 affiliate-network files are skipped)
 *
 * Writes:
 *   /clients/digistore24/data/pagewheel-keywords-combined.json
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../clients/digistore24/data/ppc-kws');
const OUTPUT_FILE = path.join(__dirname, '../clients/digistore24/data/pagewheel-keywords-combined.json');

// PageWheel competitive set: 12 brands across funnel/page/website builders.
// Maps filename token (lowercase) → clean brand key used throughout the dashboard.
const PW_BRAND_MAP = {
    // Core funnel/landing-page builders (the original 6)
    'clickfunnels.com': 'clickfunnels',
    'leadpages.com': 'leadpages',
    'kartra.com': 'kartra',
    'kajabi.com': 'kajabi',
    'systeme.io': 'systemeio',
    'gohighlevel.com': 'gohighlevel',
    // Expanded set from page-builder search (6 more)
    'base44.com': 'base44',
    'elementor.com': 'elementor',
    'lovable.dev': 'lovable',
    'shopify.com': 'shopify',
    'squarespace.com': 'squarespace',
    'wix.com': 'wix',
};

// Category classification — PageWheel-relevant taxonomy
const CATEGORY_RULES = [
    { pattern: /\b(clickfunnels?|leadpages?|kartra|kajabi|systeme|gohighlevel|ghl|base44|elementor|lovable|shopify|squarespace|wix|unbounce|instapage|webflow|carrd|builderall|teachable|thinkific|podia)\b/i, category: 'Brand - Competitor' },
    { pattern: /\b(ai|gpt|automate|automated|chatgpt|generate|generator)\b/i, category: 'AI / Automation' },
    { pattern: /\b(funnel|sales\s*page|opt[ -]?in|lead\s*magnet|landing\s*page)\b/i, category: 'Funnel / LP' },
    { pattern: /\b(website|web\s*site|site|builder|builder)\b/i, category: 'Website Builder' },
    { pattern: /\b(course|membership|coaching|coach|community)\b/i, category: 'Course / Coaching' },
    { pattern: /\b(checkout|cart|payment|stripe|paypal|subscription)\b/i, category: 'Checkout / Payments' },
    { pattern: /\b(email|drip|newsletter|automation|workflow|crm)\b/i, category: 'Email / CRM' },
    { pattern: /\b(template|theme|design|drag\s*and\s*drop)\b/i, category: 'Templates / Design' },
    { pattern: /\b(price|pricing|cost|cheap|discount|coupon|deal|free)\b/i, category: 'Price / Trial' },
    { pattern: /\b(review|vs|versus|compare|comparison|best|top|alternative)\b/i, category: 'Review / Comparison' },
    { pattern: /\b(how\s+to|tutorial|guide|learn|step\s*by\s*step)\b/i, category: 'How-To / Education' },
    { pattern: /\b(login|sign\s*up|account|dashboard|register)\b/i, category: 'Sign Up / Login' },
];

// Short-tail topic groups — for non-brand keywords
const TOPIC_GROUPS = [
    { pattern: /\b(landing\s*page|sales\s*page|opt[ -]?in\s*page)\b/i, group: 'landing pages' },
    { pattern: /\bsales\s*funnel\b/i, group: 'sales funnels' },
    { pattern: /\bfunnel\s*builder\b/i, group: 'funnel builders' },
    { pattern: /\b(website\s*builder|web\s*site\s*builder)\b/i, group: 'website builders' },
    { pattern: /\bpage\s*builder\b/i, group: 'page builders' },
    { pattern: /\b(online\s*course|course\s*platform|course\s*creator)\b/i, group: 'online courses' },
    { pattern: /\b(membership\s*site|membership\s*platform)\b/i, group: 'memberships' },
    { pattern: /\b(checkout|shopping\s*cart|payment\s*gateway)\b/i, group: 'checkout & carts' },
    { pattern: /\b(email\s*marketing|email\s*automation|drip)\b/i, group: 'email marketing' },
    { pattern: /\b(coach|coaching|consultant)\b/i, group: 'coaches & consultants' },
    { pattern: /\b(creator|influencer|author|expert)\b/i, group: 'creators & experts' },
    { pattern: /\b(network\s*marketing|mlm|affiliate)\b/i, group: 'network marketing & affiliates' },
    { pattern: /\b(template|theme|design)\b/i, group: 'templates & design' },
    { pattern: /\b(ai|gpt|artificial\s*intelligence|chatgpt|automated)\b/i, group: 'AI-assisted' },
    { pattern: /\b(ecommerce|e-?commerce|online\s*store|sell\s*online)\b/i, group: 'ecommerce' },
    { pattern: /\b(digital\s*product|digital\s*download|ebook|info\s*product)\b/i, group: 'digital products' },
    { pattern: /\bwordpress|wp\b/i, group: 'wordpress' },
];

// Brand detection: if a keyword contains a brand name, route to brand group not topic group
const BRAND_KEYWORDS = {
    clickfunnels: /clickfunnels?/i,
    leadpages: /leadpages?|lead\s*pages?/i,
    kartra: /\bkartra\b/i,
    kajabi: /\bkajabi\b/i,
    systemeio: /systeme\.?io|systeme/i,
    gohighlevel: /gohighlevel|go\s*high\s*level|\bghl\b/i,
    base44: /\bbase\s*44\b|base44/i,
    elementor: /\belementor\b/i,
    lovable: /\blovable\b/i,
    shopify: /\bshopify\b/i,
    squarespace: /\bsquarespace\b/i,
    wix: /\bwix\b/i,
    // Adjacent brands that may show up in cross-bidding (no own file but flagged)
    unbounce: /\bunbounce\b/i,
    instapage: /\binstapage\b/i,
    webflow: /\bwebflow\b/i,
    carrd: /\bcarrd\b/i,
    builderall: /\bbuilderall\b/i,
    teachable: /\bteachable\b/i,
    thinkific: /\bthinkific\b/i,
    podia: /\bpodia\b/i,
};

function categorizeKeyword(keyword) {
    const kw = keyword.toLowerCase();
    for (const rule of CATEGORY_RULES) if (rule.pattern.test(kw)) return rule.category;
    return 'Other';
}

function getIntent(keyword, swIntent) {
    if (swIntent && typeof swIntent === 'string') return swIntent.trim();
    const kw = keyword.toLowerCase();
    if (/buy|price|cost|cheap|discount|deal|coupon|trial|free/i.test(kw)) return 'Transactional';
    if (/how|what|why|guide|tutorial|learn/i.test(kw)) return 'Informational';
    if (/review|compare|vs|best|top|alternative/i.test(kw)) return 'Commercial';
    if (/login|signup|sign\s*up|account|dashboard/i.test(kw)) return 'Navigational';
    return 'Informational';
}

function getBrandGroup(keyword) {
    const kw = keyword.toLowerCase();
    for (const [brand, pattern] of Object.entries(BRAND_KEYWORDS)) {
        if (pattern.test(kw)) return brand;
    }
    return null;
}

function getShortTailGroup(keyword) {
    const kw = keyword.toLowerCase();
    for (const rule of TOPIC_GROUPS) if (rule.pattern.test(kw)) return rule.group;
    return null;
}

function extractBrandFromFilename(filename) {
    // "Website Keywords-{domain}-(999)-..."
    const m = filename.match(/Website Keywords-([^-]+(?:\.[a-z]+)+)-\(999\)/i);
    if (!m) return null;
    return PW_BRAND_MAP[m[1].toLowerCase()] || null;
}

console.log('Loading SimilarWeb exports from', DATA_DIR);
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
console.log(`Found ${files.length} .xlsx files. Filtering to PageWheel competitive set...`);

// keyword text → aggregated keyword data
const keywordMap = new Map();
let skippedFiles = 0;
let ingestedFiles = 0;

for (const file of files) {
    const brand = extractBrandFromFilename(file);
    if (!brand) {
        skippedFiles++;
        continue;
    }
    console.log(`  Ingesting ${file} → ${brand}`);

    const wb = XLSX.readFile(path.join(DATA_DIR, file));
    const sheet = wb.Sheets['Website_Keywords'];
    if (!sheet) { console.log(`    (no Website_Keywords sheet — skipping)`); continue; }
    const rows = XLSX.utils.sheet_to_json(sheet);

    for (const row of rows) {
        const keyword = (row.Keywords || '').toString().trim();
        if (!keyword) continue;
        const clicks = parseInt(row.Clicks || 0, 10);
        const cpc = parseFloat(row.CPC || 0);
        const volume = parseInt(row.Volume || 0, 10);
        const swIntent = row.Intent;
        const desktopShare = parseFloat(row['Desktop Share'] || 0);
        const mobileShare = parseFloat(row['Mobile Share'] || 0);
        const topUrl = (row['Top URL'] || '').toString();

        const existing = keywordMap.get(keyword);
        const brandEntry = {
            name: brand,
            clicks,
            cpc,
            est_spend: Math.round(clicks * cpc * 100) / 100,
            desktop_share: desktopShare,
            mobile_share: mobileShare,
            top_url: topUrl,
        };

        if (existing) {
            // Merge: sum clicks across brands bidding on same keyword
            existing.brands.push(brandEntry);
            existing.total_clicks += clicks;
            existing.total_spend += brandEntry.est_spend;
            existing.total_spend = Math.round(existing.total_spend * 100) / 100;
            // Volume / CPC: pick whichever is higher (different SW snapshots can disagree)
            if (volume > existing.volume) existing.volume = volume;
            // CPC: weighted average by clicks
            const totalCpcClicks = existing._cpcWeight + clicks;
            if (totalCpcClicks > 0) {
                existing.cpc = Math.round(((existing.cpc * existing._cpcWeight) + (cpc * clicks)) / totalCpcClicks * 100) / 100;
                existing._cpcWeight = totalCpcClicks;
            }
        } else {
            keywordMap.set(keyword, {
                keyword,
                category: categorizeKeyword(keyword),
                intent: getIntent(keyword, swIntent),
                short_tail_group: null, // set after brand detection
                brand_group: getBrandGroup(keyword),
                total_clicks: clicks,
                total_spend: brandEntry.est_spend,
                volume,
                cpc,
                brands: [brandEntry],
                _cpcWeight: clicks,
            });
        }
    }
    ingestedFiles++;
}

// Finalize: brand-detection priority, topic group fallback
const keywords = Array.from(keywordMap.values()).map(kw => {
    if (kw.brand_group) {
        // brand-related keyword → no topic group
        kw.short_tail_group = null;
    } else {
        kw.short_tail_group = getShortTailGroup(kw.keyword);
    }
    delete kw._cpcWeight;
    return kw;
});

console.log(`\nIngested ${ingestedFiles} files, skipped ${skippedFiles}`);
console.log(`Total unique keywords (pre-filter): ${keywords.length}`);

// Filter: drop extreme long tail / zero-value rows that would balloon the
// JSON without informing strategy. Keep keywords with meaningful clicks OR
// reasonable commercial intent (non-zero CPC).
const MIN_CLICKS = 5;
const MIN_CPC = 0.50;
const TOP_N_CAP = 50000; // hard ceiling — keyword tool perf degrades past ~50K

const beforeFilter = keywords.length;
let filtered = keywords.filter(k => k.total_clicks >= MIN_CLICKS || k.cpc >= MIN_CPC);
console.log(`After threshold filter (≥${MIN_CLICKS} clicks OR ≥$${MIN_CPC} CPC): ${filtered.length}`);

if (filtered.length > TOP_N_CAP) {
    filtered.sort((a, b) => b.total_clicks - a.total_clicks);
    filtered = filtered.slice(0, TOP_N_CAP);
    console.log(`Capped at top ${TOP_N_CAP} by clicks: ${filtered.length}`);
}

// Replace the original array with the filtered one for everything downstream
keywords.length = 0;
keywords.push(...filtered);
console.log(`Final keyword count: ${keywords.length}`);

// Build keyword groups (topics + brands)
const keyword_groups = { topics: {}, brands: {} };
for (const kw of keywords) {
    if (kw.brand_group) {
        const g = keyword_groups.brands[kw.brand_group] ||= {
            count: 0, total_clicks: 0, total_spend: 0,
            sample_keywords: [], brands_bidding: {},
        };
        g.count++;
        g.total_clicks += kw.total_clicks;
        g.total_spend += kw.total_spend;
        if (g.sample_keywords.length < 10) g.sample_keywords.push({ keyword: kw.keyword, clicks: kw.total_clicks, brands: kw.brands.map(b => b.name) });
        for (const b of kw.brands) {
            const bb = g.brands_bidding[b.name] ||= { count: 0, clicks: 0, spend: 0 };
            bb.count++; bb.clicks += b.clicks; bb.spend += b.est_spend;
        }
    } else if (kw.short_tail_group) {
        const g = keyword_groups.topics[kw.short_tail_group] ||= {
            count: 0, total_clicks: 0, total_spend: 0,
            sample_keywords: [], brands_bidding: {},
        };
        g.count++;
        g.total_clicks += kw.total_clicks;
        g.total_spend += kw.total_spend;
        if (g.sample_keywords.length < 10) g.sample_keywords.push({ keyword: kw.keyword, clicks: kw.total_clicks, brands: kw.brands.map(b => b.name) });
        for (const b of kw.brands) {
            const bb = g.brands_bidding[b.name] ||= { count: 0, clicks: 0, spend: 0 };
            bb.count++; bb.clicks += b.clicks; bb.spend += b.est_spend;
        }
    }
}

// Round totals in groups
for (const groupSet of Object.values(keyword_groups)) {
    for (const g of Object.values(groupSet)) {
        g.total_spend = Math.round(g.total_spend * 100) / 100;
        for (const b of Object.values(g.brands_bidding)) {
            b.spend = Math.round(b.spend * 100) / 100;
        }
    }
}

const category_counts = {};
for (const kw of keywords) category_counts[kw.category] = (category_counts[kw.category] || 0) + 1;

// Global avg CPC: weighted by clicks, only counting keywords with non-zero cpc
const withCpc = keywords.filter(k => k.cpc > 0 && k.total_clicks > 0);
const cpcWeightedClicks = withCpc.reduce((s, k) => s + k.total_clicks, 0);
const cpcWeightedSpend = withCpc.reduce((s, k) => s + (k.cpc * k.total_clicks), 0);
const globalAvgCpc = cpcWeightedClicks > 0
    ? Math.round((cpcWeightedSpend / cpcWeightedClicks) * 100) / 100
    : 0;

const out = {
    total_keywords: keywords.length,
    brands: Object.values(PW_BRAND_MAP).filter((v, i, a) => a.indexOf(v) === i),
    category_counts,
    keyword_groups,
    global_avg_cpc: globalAvgCpc,
    keywords,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
const stats = fs.statSync(OUTPUT_FILE);
console.log(`\nWrote ${OUTPUT_FILE}`);
console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  total_keywords: ${out.total_keywords}`);
console.log(`  brands: ${out.brands.join(', ')}`);
console.log(`  global_avg_cpc: $${out.global_avg_cpc}`);
console.log(`  topic groups: ${Object.keys(out.keyword_groups.topics).length}`);
console.log(`  brand groups: ${Object.keys(out.keyword_groups.brands).length}`);
console.log(`  category breakdown:`);
Object.entries(out.category_counts).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`    ${c}: ${n}`));

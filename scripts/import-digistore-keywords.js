/**
 * Import Digistore24 competitor keyword data from Excel files
 *
 * Usage: node scripts/import-digistore-keywords.js
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../clients/digistore24/data/ppc-kws');
const OUTPUT_FILE = path.join(__dirname, '../clients/digistore24/data/keywords-combined.json');

// Brand name mapping from filename to clean name
// NOTE: Stripe excluded - not a direct competitor
const BRAND_MAP = {
    'awin.com': 'awin',
    'clickbank.com': 'clickbank',
    'impact.com': 'impact',
    'maxweb.com': 'maxweb',
    'realize.com': 'realize',
    'samcart.com': 'samcart',
    // 'stripe.com': 'stripe' // Excluded - not direct competitor
};

// Category classification rules
const CATEGORY_RULES = [
    { pattern: /affiliate|network|partner|referral/i, category: 'Affiliate/Network' },
    { pattern: /cart|checkout|payment|ecommerce|shop/i, category: 'E-commerce/Cart' },
    { pattern: /clickbank|impact|awin|maxweb|samcart|digistore/i, category: 'Brand - Competitor' },
    { pattern: /marketing|advertis|campaign|funnel|landing/i, category: 'Marketing/Strategy' },
    { pattern: /review|compare|vs|best|top \d+/i, category: 'Review/Comparison' },
    { pattern: /product|digital|download|ebook|course/i, category: 'Product/Digital' },
    { pattern: /training|learn|tutorial|how to/i, category: 'Course/Education' },
    { pattern: /login|signup|sign up|register|account/i, category: 'Sign Up/Login' },
    { pattern: /money|income|earn|profit|commission/i, category: 'Money/Income' },
];

// Short-tail topic groups - consolidated meaningful groups (< 20)
const TOPIC_GROUPS = [
    { pattern: /affiliate\s*marketing|affiliate\s*program/i, group: 'affiliate marketing' },
    { pattern: /affiliate\s*network/i, group: 'affiliate network' },
    { pattern: /partner\s*program|partnership/i, group: 'partner program' },
    { pattern: /referral\s*program|referral\s*marketing/i, group: 'referral program' },
    { pattern: /influencer\s*marketing|influencer\s*platform/i, group: 'influencer marketing' },
    { pattern: /performance\s*marketing/i, group: 'performance marketing' },
    { pattern: /ecommerce|e-commerce|online\s*store/i, group: 'ecommerce' },
    { pattern: /shopping\s*cart|checkout/i, group: 'shopping cart' },
    { pattern: /payment\s*gateway|payment\s*processing/i, group: 'payment processing' },
    { pattern: /digital\s*product|sell\s*digital/i, group: 'digital products' },
    { pattern: /online\s*course|course\s*platform/i, group: 'online courses' },
    { pattern: /commission|payout/i, group: 'commissions' },
    { pattern: /tracking|attribution/i, group: 'tracking & attribution' },
    { pattern: /landing\s*page|sales\s*page/i, group: 'landing pages' },
    { pattern: /conversion|cro/i, group: 'conversion' },
    { pattern: /api|integration/i, group: 'integrations' },
];

// Brand-related keywords for brand groups
const BRAND_KEYWORDS = {
    'clickbank': /clickbank/i,
    'impact': /impact\.com|impact\s+radius|partnerize/i,
    'awin': /awin|shareasale/i,
    'samcart': /samcart/i,
    'maxweb': /maxweb/i,
    'realize': /realize/i,
    'rakuten': /rakuten/i,
    'cj': /commission\s*junction|cj\s+affiliate/i,
    'partnerstack': /partnerstack/i,
    'refersion': /refersion/i,
    'tapfiliate': /tapfiliate/i,
    'stripe': /stripe/i,
    'paypal': /paypal/i,
    'shopify': /shopify/i,
    'woocommerce': /woocommerce/i,
    'clickfunnels': /clickfunnels/i,
};

function categorizeKeyword(keyword) {
    const kw = keyword.toLowerCase();
    for (const rule of CATEGORY_RULES) {
        if (rule.pattern.test(kw)) {
            return rule.category;
        }
    }
    return 'Other';
}

function getIntent(keyword) {
    const kw = keyword.toLowerCase();
    if (/buy|price|cost|cheap|discount|deal|coupon/i.test(kw)) return 'Transactional';
    if (/how|what|why|guide|tutorial|learn/i.test(kw)) return 'Informational';
    if (/review|compare|vs|best|top/i.test(kw)) return 'Commercial';
    if (/login|signup|account|dashboard/i.test(kw)) return 'Navigational';
    return 'Informational';
}

function getShortTailGroup(keyword) {
    const kw = keyword.toLowerCase();

    // Only check against consolidated topic groups - no fallback
    // This ensures we get < 20 meaningful groups
    for (const rule of TOPIC_GROUPS) {
        if (rule.pattern.test(kw)) {
            return rule.group;
        }
    }

    return null; // No fallback - only use defined topic groups
}

function getBrandGroup(keyword) {
    const kw = keyword.toLowerCase();

    // Check if keyword contains any brand name
    for (const [brand, pattern] of Object.entries(BRAND_KEYWORDS)) {
        if (pattern.test(kw)) {
            return brand;
        }
    }

    return null;
}

async function main() {
    console.log('Starting keyword import...\n');

    // Read all Excel files
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
    console.log(`Found ${files.length} Excel files to process\n`);

    const allKeywords = new Map(); // keyword -> data

    for (const file of files) {
        // Extract brand from filename
        const brandMatch = file.match(/Website Keywords-([^-]+)-/);
        if (!brandMatch) {
            console.log(`Skipping ${file} - can't extract brand`);
            continue;
        }

        const brandDomain = brandMatch[1];
        const brandName = BRAND_MAP[brandDomain] || brandDomain.replace('.com', '');

        console.log(`Processing ${file} (${brandName})...`);

        const filePath = path.join(DATA_DIR, file);
        const workbook = XLSX.readFile(filePath);
        // Use 'Website_Keywords' sheet if available, otherwise first sheet
        const sheetName = workbook.SheetNames.includes('Website_Keywords')
            ? 'Website_Keywords'
            : workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);

        console.log(`  Found ${rows.length} rows in sheet "${sheetName}"`);

        for (const row of rows) {
            // SimilarWeb uses 'Keywords' column
            const keyword = (row['Keywords'] || row['Keyword'] || row['keyword'] || '').toString().trim().toLowerCase();
            if (!keyword) continue;

            // Get or create keyword entry
            if (!allKeywords.has(keyword)) {
                allKeywords.set(keyword, {
                    keyword,
                    category: categorizeKeyword(keyword),
                    intent: row['Intent'] || getIntent(keyword), // Use SimilarWeb intent if available
                    short_tail_group: getShortTailGroup(keyword),
                    brand_group: getBrandGroup(keyword),
                    total_clicks: 0,
                    total_spend: 0,
                    volume: 0,
                    brands: []
                });
            }

            const entry = allKeywords.get(keyword);

            // Parse metrics - SimilarWeb format
            const clicks = parseInt(row['Clicks'] || 0) || 0;
            const cpc = parseFloat(row['CPC'] || 0) || 0;
            const spend = clicks * cpc;
            const volume = parseInt(row['Volume'] || row['Avg. Volume'] || 0) || 0;
            const desktopShare = parseFloat(row['Desktop Share'] || 0.5) || 0.5;
            const mobileShare = parseFloat(row['Mobile Share'] || 0.5) || 0.5;
            const topUrl = row['Top URL'] || '';

            // Update volume (take max across brands)
            if (volume > entry.volume) entry.volume = volume;

            // Add brand data
            entry.brands.push({
                name: brandName,
                clicks,
                cpc,
                est_spend: spend,
                desktop_share: desktopShare,
                mobile_share: mobileShare,
                top_url: topUrl
            });

            entry.total_clicks += clicks;
            entry.total_spend += spend;
        }
    }

    console.log(`\nTotal unique keywords: ${allKeywords.size}`);

    // Convert to array
    const keywordsArray = Array.from(allKeywords.values()).map(kw => ({
        ...kw,
        // Use actual volume if available, otherwise estimate
        volume: kw.volume > 0 ? kw.volume : Math.round(kw.total_clicks * 10),
        cpc: kw.total_clicks > 0 ? Math.round((kw.total_spend / kw.total_clicks) * 100) / 100 : 0
    }));

    // Sort by total clicks
    keywordsArray.sort((a, b) => b.total_clicks - a.total_clicks);

    console.log(`\nTop 10 keywords by clicks:`);
    keywordsArray.slice(0, 10).forEach((kw, i) => {
        console.log(`  ${i + 1}. "${kw.keyword}" - ${kw.total_clicks} clicks, $${kw.total_spend.toFixed(2)} spend`);
    });

    // Build metadata for the keyword tool UI
    const uniqueBrands = [...new Set(keywordsArray.flatMap(kw => kw.brands.map(b => b.name)))].sort();

    const categoryCounts = {};
    keywordsArray.forEach(kw => {
        categoryCounts[kw.category] = (categoryCounts[kw.category] || 0) + 1;
    });

    // Build keyword_groups for UI with sample_keywords and brand info
    const topicGroups = {};
    const brandGroups = {};

    keywordsArray.forEach(kw => {
        // Group by short_tail_group (topics) - only if has a group
        const topic = kw.short_tail_group;
        if (topic) {
            if (!topicGroups[topic]) {
                topicGroups[topic] = {
                    count: 0,
                    total_clicks: 0,
                    total_spend: 0,
                    sample_keywords: [],
                    brands_bidding: {}
                };
            }
            topicGroups[topic].count++;
            topicGroups[topic].total_clicks += kw.total_clicks;
            topicGroups[topic].total_spend += kw.total_spend;

            // Add sample keywords (max 10, sorted by clicks)
            if (topicGroups[topic].sample_keywords.length < 10) {
                topicGroups[topic].sample_keywords.push({
                    keyword: kw.keyword,
                    clicks: kw.total_clicks,
                    brands: kw.brands.map(b => b.name)
                });
            }

            // Track which brands bid on this topic
            kw.brands.forEach(b => {
                if (!topicGroups[topic].brands_bidding[b.name]) {
                    topicGroups[topic].brands_bidding[b.name] = { count: 0, clicks: 0, spend: 0 };
                }
                topicGroups[topic].brands_bidding[b.name].count++;
                topicGroups[topic].brands_bidding[b.name].clicks += b.clicks;
                topicGroups[topic].brands_bidding[b.name].spend += b.est_spend;
            });
        }

        // Group by brand_group (brand keywords) - only if has a brand_group
        const brandGroup = kw.brand_group;
        if (brandGroup) {
            if (!brandGroups[brandGroup]) {
                brandGroups[brandGroup] = {
                    count: 0,
                    total_clicks: 0,
                    total_spend: 0,
                    sample_keywords: [],
                    brands_bidding: {}
                };
            }
            brandGroups[brandGroup].count++;
            brandGroups[brandGroup].total_clicks += kw.total_clicks;
            brandGroups[brandGroup].total_spend += kw.total_spend;

            // Add sample keywords
            if (brandGroups[brandGroup].sample_keywords.length < 10) {
                brandGroups[brandGroup].sample_keywords.push({
                    keyword: kw.keyword,
                    clicks: kw.total_clicks,
                    brands: kw.brands.map(b => b.name)
                });
            }

            // Track which brands bid on this brand group
            kw.brands.forEach(b => {
                if (!brandGroups[brandGroup].brands_bidding[b.name]) {
                    brandGroups[brandGroup].brands_bidding[b.name] = { count: 0, clicks: 0, spend: 0 };
                }
                brandGroups[brandGroup].brands_bidding[b.name].count++;
                brandGroups[brandGroup].brands_bidding[b.name].clicks += b.clicks;
                brandGroups[brandGroup].brands_bidding[b.name].spend += b.est_spend;
            });
        }
    });

    // Sort sample_keywords by clicks (descending) within each group
    Object.values(topicGroups).forEach(group => {
        group.sample_keywords.sort((a, b) => b.clicks - a.clicks);
    });
    Object.values(brandGroups).forEach(group => {
        group.sample_keywords.sort((a, b) => b.clicks - a.clicks);
    });

    // Calculate global average CPC
    const totalSpend = keywordsArray.reduce((sum, kw) => sum + kw.total_spend, 0);
    const totalClicks = keywordsArray.reduce((sum, kw) => sum + kw.total_clicks, 0);
    const globalAvgCpc = totalClicks > 0 ? totalSpend / totalClicks : 2.50;

    // Build output object matching both keyword-tool.html and projection-tool.html formats
    const output = {
        total_keywords: keywordsArray.length,
        brands: uniqueBrands,
        category_counts: categoryCounts,
        keyword_groups: {
            topics: topicGroups,
            brands: brandGroups
        },
        global_avg_cpc: Math.round(globalAvgCpc * 100) / 100,
        keywords: keywordsArray
    };

    console.log(`\nBrands found: ${uniqueBrands.join(', ')}`);
    console.log(`Categories: ${Object.entries(categoryCounts).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
    console.log(`Global avg CPC: $${output.global_avg_cpc.toFixed(2)}`);
    console.log(`Topic groups: ${Object.keys(topicGroups).length}`);

    // Write to JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\nSaved ${keywordsArray.length} keywords to ${OUTPUT_FILE}`);

    // Also log file size
    const stats = fs.statSync(OUTPUT_FILE);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);

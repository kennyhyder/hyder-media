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
const BRAND_MAP = {
    'awin.com': 'awin',
    'clickbank.com': 'clickbank',
    'impact.com': 'impact',
    'maxweb.com': 'maxweb',
    'realize.com': 'realize',
    'samcart.com': 'samcart',
    'stripe.com': 'stripe'
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
    const words = keyword.toLowerCase().split(/\s+/);
    if (words.length <= 2) return words[0];
    return words.slice(0, 2).join(' ');
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

    // Write to JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(keywordsArray, null, 2));
    console.log(`\nSaved ${keywordsArray.length} keywords to ${OUTPUT_FILE}`);

    // Also log file size
    const stats = fs.statSync(OUTPUT_FILE);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);

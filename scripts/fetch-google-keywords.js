/**
 * Fetch Google Keyword Planner data for all keywords
 *
 * Usage: node scripts/fetch-google-keywords.js
 *
 * This script:
 * 1. Reads keywords from keywords-combined.json
 * 2. Batches requests to /api/google-ads/keywords (100 at a time)
 * 3. Merges Google data (volume, CPC, competition) into the JSON
 * 4. Saves the updated file
 */

const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = process.env.API_URL || 'https://hyder.me/api/google-ads/keywords';
const BATCH_SIZE = 15; // Smaller batches work better with Google API
const DELAY_MS = 1500; // Delay between batches to avoid rate limits
const INPUT_FILE = path.join(__dirname, '../clients/digistore24/data/keywords-combined.json');
const OUTPUT_FILE = INPUT_FILE; // Overwrite the same file

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchKeywordBatch(keywords) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords, exactOnly: true })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`API error: ${response.status} - ${errorText.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error(`Fetch error: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('Loading keywords...');

    // Read existing data
    const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
    const data = JSON.parse(rawData);

    console.log(`Found ${data.keywords.length} keywords`);

    // Count existing Google data
    const withGoogle = data.keywords.filter(kw => kw.google).length;
    console.log(`${withGoogle} already have Google data`);

    // Extract keywords that DON'T have Google data yet
    const keywordsNeedingGoogle = data.keywords.filter(kw => !kw.google).map(kw => kw.keyword);
    const allKeywords = [...new Set(keywordsNeedingGoogle)];
    console.log(`${allKeywords.length} unique keywords need Google data`);

    // Create a map for quick lookup
    const googleDataMap = new Map();

    // Batch processing
    const totalBatches = Math.ceil(allKeywords.length / BATCH_SIZE);
    console.log(`Processing in ${totalBatches} batches of ${BATCH_SIZE}...\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < allKeywords.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = allKeywords.slice(i, i + BATCH_SIZE);

        process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} keywords)... `);

        const results = await fetchKeywordBatch(batch);

        if (results) {
            results.forEach(r => {
                googleDataMap.set(r.keyword.toLowerCase(), {
                    annual_volume: r.avgMonthlySearches * 12,
                    avg_monthly_searches: r.avgMonthlySearches,
                    competition: r.competition,
                    competition_index: r.competitionIndex,
                    low_top_of_page_bid: r.lowTopOfPageBid,
                    high_top_of_page_bid: r.highTopOfPageBid,
                    average_cpc: r.averageCpc
                });
            });
            successCount += results.length;
            console.log(`✓ Got ${results.length} results`);
        } else {
            failCount += batch.length;
            console.log(`✗ Failed`);
        }

        // Rate limit delay (skip on last batch)
        if (i + BATCH_SIZE < allKeywords.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\nFetched data for ${successCount} keywords, ${failCount} failed`);

    // Merge Google data into keywords
    console.log('Merging data...');
    let mergedCount = 0;

    data.keywords = data.keywords.map(kw => {
        const googleData = googleDataMap.get(kw.keyword.toLowerCase());
        if (googleData) {
            mergedCount++;
            return { ...kw, google: googleData };
        }
        return kw;
    });

    console.log(`Merged Google data into ${mergedCount} keywords`);

    // Save updated file
    console.log('Saving...');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));

    const stats = fs.statSync(OUTPUT_FILE);
    console.log(`\nSaved to ${OUTPUT_FILE}`);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Sample output
    const sample = data.keywords.find(kw => kw.google);
    if (sample) {
        console.log('\nSample keyword with Google data:');
        console.log(JSON.stringify({ keyword: sample.keyword, google: sample.google }, null, 2));
    }
}

main().catch(console.error);

/**
 * Fetch Google Keyword Planner data for PageWheel keywords
 *
 * Usage: node scripts/fetch-google-keywords-pagewheel.js
 *
 * Mirrors fetch-google-keywords.js but operates on the PageWheel keyword
 * dataset. Strips any pre-existing google block (so synthetic estimates
 * get replaced by real Google data) and refetches everything.
 */

const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'https://hyder.me/api/google-ads/keywords';
const BATCH_SIZE = 15;
const DELAY_MS = 1500;
const INPUT_FILE = path.join(__dirname, '../clients/digistore24/data/pagewheel-keywords-combined.json');
const OUTPUT_FILE = INPUT_FILE;

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
    console.log('Loading PageWheel keywords...');
    const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
    console.log(`Found ${data.keywords.length} keywords`);

    // Build map of keywords that ALREADY have real google data, so we can resume
    const alreadyFetched = new Map();
    for (const kw of data.keywords) {
        if (kw.google && typeof kw.google.avg_monthly_searches === 'number') {
            alreadyFetched.set(kw.keyword.toLowerCase(), kw.google);
        }
    }
    console.log(`Already have Google data for ${alreadyFetched.size} keywords — skipping those`);

    const allKeywords = [...new Set(data.keywords.map(kw => kw.keyword))]
        .filter(k => !alreadyFetched.has(k.toLowerCase()));

    const googleDataMap = new Map(alreadyFetched);
    const totalBatches = Math.ceil(allKeywords.length / BATCH_SIZE);
    const CHECKPOINT_EVERY = 50; // batches
    console.log(`Processing ${allKeywords.length} new keywords in ${totalBatches} batches of ${BATCH_SIZE}...\n`);

    let successCount = 0;
    let failCount = 0;

    const checkpoint = () => {
        // Merge what we have so far back into data + write to disk (without indent)
        const snapshot = JSON.parse(JSON.stringify(data));
        snapshot.keywords = snapshot.keywords.map(kw => {
            const g = googleDataMap.get(kw.keyword.toLowerCase());
            return g ? { ...kw, google: g } : kw;
        });
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(snapshot));
    };

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
                    average_cpc: r.averageCpc,
                });
            });
            successCount += results.length;
            console.log(`✓ Got ${results.length} results`);
        } else {
            failCount += batch.length;
            console.log(`✗ Failed`);
        }

        if (batchNum % CHECKPOINT_EVERY === 0) {
            checkpoint();
            console.log(`  → checkpoint saved (${googleDataMap.size} keywords cached)`);
        }

        if (i + BATCH_SIZE < allKeywords.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\nFetched data for ${successCount} keywords, ${failCount} failed`);

    // Merge real Google data + update keyword-level volume/cpc fields
    let mergedCount = 0;
    let updatedVolumeCount = 0;
    data.keywords = data.keywords.map(kw => {
        const googleData = googleDataMap.get(kw.keyword.toLowerCase());
        if (googleData) {
            mergedCount++;
            // Also update the top-level volume + cpc to reflect real Google data
            // (these fields are what the keyword tool's pivot table reads)
            const realVolume = googleData.avg_monthly_searches;
            const realCpc = googleData.average_cpc || googleData.high_top_of_page_bid || kw.cpc;
            const updated = { ...kw, google: googleData };
            if (realVolume && realVolume > 0) {
                updated.volume = realVolume;
                // Recompute downstream metrics based on real volume
                const ctr = 0.025;
                updated.total_clicks = Math.round(realVolume * ctr);
                updated.cpc = realCpc;
                updated.total_spend = Math.round(updated.total_clicks * realCpc * 100) / 100;
                updatedVolumeCount++;
            }
            return updated;
        }
        return kw;
    });

    console.log(`Merged Google data into ${mergedCount} keywords (${updatedVolumeCount} got real volumes)`);

    // Recompute global_avg_cpc from real data
    const withGoogle = data.keywords.filter(k => k.google?.average_cpc > 0);
    if (withGoogle.length > 0) {
        const avgCpc = withGoogle.reduce((s, k) => s + (k.google.average_cpc || 0), 0) / withGoogle.length;
        data.global_avg_cpc = Math.round(avgCpc * 100) / 100;
        console.log(`Updated global_avg_cpc: $${data.global_avg_cpc} (from ${withGoogle.length} real data points)`);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data));
    const stats = fs.statSync(OUTPUT_FILE);
    console.log(`\nSaved to ${OUTPUT_FILE}`);
    console.log(`File size: ${(stats.size / 1024).toFixed(1)} KB`);

    // Top 10 keywords by real volume
    const ranked = data.keywords.filter(k => k.google?.avg_monthly_searches > 0)
        .sort((a, b) => (b.google.avg_monthly_searches || 0) - (a.google.avg_monthly_searches || 0))
        .slice(0, 10);
    console.log('\nTop 10 keywords by real monthly search volume:');
    ranked.forEach((k, i) => {
        const v = k.google.avg_monthly_searches.toLocaleString();
        const cpc = k.google.average_cpc != null ? `$${k.google.average_cpc.toFixed(2)}` : 'n/a';
        const comp = k.google.competition || 'n/a';
        console.log(`  ${(i+1).toString().padStart(2)}. ${k.keyword.padEnd(45)} ${v.padStart(8)} searches/mo · CPC ${cpc} · ${comp}`);
    });
}

main().catch(console.error);

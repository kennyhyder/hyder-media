#!/usr/bin/env node
/**
 * Check organic rank #1 for branded keywords — runs from your local machine.
 *
 * Source: Brave Search API (preferred) or DuckDuckGo HTML scrape (fallback).
 * DDG tends to IP-ban after a handful of requests even from residential IPs,
 * so Brave is the reliable path. Free tier = 2000 queries/month, 1 query/sec.
 * Key from https://api.search.brave.com/app/dashboard → add BRAVE_SEARCH_API_KEY
 * to .env.local.
 *
 * Usage:
 *   node scripts/check-brand-ranks.mjs                 # top 500 kws, 3mo lookback
 *   node scripts/check-brand-ranks.mjs --limit 100 --lookback 1mo
 *   node scripts/check-brand-ranks.mjs --account BUR
 *   node scripts/check-brand-ranks.mjs --force         # re-check cached kws too
 *   node scripts/check-brand-ranks.mjs --source ddg    # force DDG fallback
 *
 * Env: reads .env.local for SUPABASE_URL, SUPABASE_SERVICE_KEY, BRAVE_SEARCH_API_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const CACHE_TTL_DAYS = 7;
const API_BASE = process.env.API_BASE || 'https://hyder.me';

const args = parseArgs(process.argv.slice(2));
const limit = parseInt(args.limit) || 500;
const lookback = args.lookback || '3mo';
const accountFilter = args.account || '';
const forceRefresh = !!args.force;

// Pick a source: 'brave' (preferred) or 'ddg' (fallback)
const sourceArg = (args.source || '').toLowerCase();
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
let SOURCE, CONCURRENCY, DELAY_MS;
if (sourceArg === 'ddg' || (!BRAVE_KEY && sourceArg !== 'brave')) {
    SOURCE = 'duckduckgo';
    CONCURRENCY = 1;
    DELAY_MS = 3000;
} else {
    SOURCE = 'brave';
    CONCURRENCY = 1;       // Brave free tier: 1 req/sec
    DELAY_MS = 1100;       // small buffer above 1s
}

const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

async function main() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
        process.exit(1);
    }
    if (SOURCE === 'brave' && !BRAVE_KEY) {
        console.error('Missing BRAVE_SEARCH_API_KEY in .env.local');
        console.error('Get a key (free 2000/mo) at https://api.search.brave.com/app/dashboard');
        process.exit(1);
    }
    console.log(`Source: ${SOURCE} · concurrency: ${CONCURRENCY} · delay: ${DELAY_MS}ms`);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Fetch branded keywords from the production API
    const qs = new URLSearchParams({ limit, lookback });
    if (accountFilter) qs.set('account', accountFilter);
    const url = `${API_BASE}/api/google-ads/omicron-branded-keywords?${qs}`;
    console.log(`Fetching branded keywords: ${url}`);

    const resp = await fetch(url);
    if (!resp.ok) {
        console.error(`API returned ${resp.status}`);
        process.exit(1);
    }
    const data = await resp.json();

    if (!data.keywords?.length) {
        console.error('No keywords returned.');
        process.exit(1);
    }

    const uniqueKeywords = [...new Set(data.keywords.map(k => k.keyword.toLowerCase()))];
    console.log(`Got ${data.keywords.length} keyword rows (${uniqueKeywords.length} unique). Lookback: ${data.lookback}`);

    // Load cache to skip recent entries unless --force
    const cached = new Set();
    if (!forceRefresh) {
        const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400 * 1000).toISOString();
        const batchSize = 100;
        for (let i = 0; i < uniqueKeywords.length; i += batchSize) {
            const batch = uniqueKeywords.slice(i, i + batchSize);
            const { data: rows } = await supabase
                .from('serp_rankings')
                .select('keyword, error')
                .in('keyword', batch)
                .eq('source', SOURCE)
                .gte('checked_at', cutoff);
            if (rows) {
                // Only treat as cached if NOT errored (retry errored ones)
                for (const r of rows) {
                    if (!r.error) cached.add(r.keyword);
                }
            }
        }
    }

    const toFetch = uniqueKeywords.filter(k => !cached.has(k));
    console.log(`Cached (fresh, non-error): ${cached.size}. To fetch: ${toFetch.length}.`);

    // Concurrency-limited queue
    const queue = [...toFetch];
    let done = 0;
    const started = Date.now();
    const pending = [];

    async function worker(id) {
        while (queue.length > 0) {
            const kw = queue.shift();
            if (!kw) break;
            try {
                const result = SOURCE === 'brave'
                    ? await fetchBraveSerp(kw)
                    : await fetchDuckDuckGoSerp(kw);
                await upsertResult(supabase, result);
                done++;
                const elapsed = ((Date.now() - started) / 1000).toFixed(0);
                const rate = (done / (Date.now() - started) * 1000).toFixed(2);
                process.stdout.write(`\r[${done}/${toFetch.length}] ${elapsed}s · ${rate} kw/s · last: ${kw.slice(0, 40).padEnd(40)} → ${result.top_domain || '—'}`);
            } catch (e) {
                await upsertResult(supabase, {
                    keyword: kw,
                    error: e.message,
                    top_results: []
                });
                done++;
                process.stdout.write(`\r[${done}/${toFetch.length}] err: ${kw} → ${e.message}\n`);
            }
            await sleep(DELAY_MS + Math.random() * 200);
        }
    }

    for (let i = 0; i < CONCURRENCY; i++) pending.push(worker(i));
    await Promise.all(pending);

    console.log(`\n\nDone. ${done} keywords processed in ${((Date.now() - started) / 1000).toFixed(0)}s.`);

    // Summary: classify each keyword row by match type and compute projected savings
    const { data: rankedRows } = await supabase
        .from('serp_rankings')
        .select('keyword, top_domain, error')
        .in('keyword', uniqueKeywords);
    const rankedMap = new Map();
    for (const r of (rankedRows || [])) {
        const existing = rankedMap.get(r.keyword);
        if (!existing || (existing.error && !r.error)) rankedMap.set(r.keyword, r);
    }

    let exact = 0, portfolio = 0, external = 0, errors = 0;
    const exactByAccount = {}, portfolioByAccount = {};
    for (const row of data.keywords) {
        const r = rankedMap.get(row.keyword.toLowerCase());
        if (!r || r.error || !r.top_domain) { errors++; continue; }
        const cls = classifyMatchCli(row.ownedDomain, r.top_domain);
        if (cls === 'exact') {
            exact++;
            exactByAccount[row.account] = (exactByAccount[row.account] || 0) + row.cost;
            portfolioByAccount[row.account] = (portfolioByAccount[row.account] || 0) + row.cost;
        } else if (cls === 'portfolio') {
            portfolio++;
            portfolioByAccount[row.account] = (portfolioByAccount[row.account] || 0) + row.cost;
        } else {
            external++;
        }
    }
    console.log(`\nMatches: ${exact} exact · ${portfolio} portfolio · ${external} external · ${errors} unranked`);

    function printSavings(title, byAccount) {
        console.log(`\n${title}:`);
        let total = 0;
        for (const [acct, cost] of Object.entries(byAccount).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${acct.padEnd(16)} $${cost.toFixed(2)}`);
            total += cost;
        }
        console.log(`  ${'TOTAL'.padEnd(16)} $${total.toFixed(2)}`);
    }
    printSavings('Savings — Exact (account domain = #1)', exactByAccount);
    printSavings('Savings — Portfolio (any Omicron domain = #1)', portfolioByAccount);
}

const OMICRON_PORTFOLIO_DOMAINS = [
    'eweka.nl', 'easynews.com', 'newshosting.com', 'usenetserver.com',
    'tweaknews.eu', 'pureusenet.nl', 'sunnyusenet.com',
    'bestusenetreviews.com', 'top10usenet.com', 'privadovpn.com'
];

function classifyMatchCli(accountOwnedDomain, rankDomain) {
    if (!rankDomain) return null;
    if (accountOwnedDomain && ownedMatches(accountOwnedDomain, rankDomain)) return 'exact';
    for (const d of OMICRON_PORTFOLIO_DOMAINS) {
        if (ownedMatches(d, rankDomain)) return 'portfolio';
    }
    return 'external';
}

async function fetchBraveSerp(keyword) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(keyword)}&count=10&country=us&safesearch=off`;
    const resp = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': BRAVE_KEY
        }
    });
    if (resp.status === 429) throw new Error('rate limited (429)');
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}${body ? ' · ' + body.slice(0, 100) : ''}`);
    }
    const data = await resp.json();
    const webResults = data.web?.results || [];
    if (webResults.length === 0) {
        throw new Error('no web results');
    }
    const results = webResults.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        url: r.url,
        domain: extractDomain(r.url),
        title: r.title || ''
    })).filter(r => r.domain);
    if (results.length === 0) throw new Error('no parseable results');
    const top = results[0];
    return {
        keyword,
        top_domain: top.domain,
        top_url: top.url,
        top_title: top.title,
        top_results: results.slice(0, 5)
    };
}

async function fetchDuckDuckGoSerp(keyword) {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const resp = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://duckduckgo.com/'
        },
        body: new URLSearchParams({ q: keyword }).toString()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const results = parseDdgHtml(html);
    if (results.length === 0) {
        if (/unusual traffic|captcha|anomaly/i.test(html)) throw new Error('captcha/block');
        throw new Error('no results parsed');
    }
    const top = results[0];
    return {
        keyword,
        top_domain: top.domain,
        top_url: top.url,
        top_title: top.title,
        top_results: results.slice(0, 5)
    };
}

function parseDdgHtml(html) {
    const results = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (results.length >= 10) break;
        let href = decodeEntities(m[1]);
        const title = stripTags(m[2]).trim();
        try {
            if (href.includes('duckduckgo.com/l/')) {
                const u = new URL(href.startsWith('//') ? 'https:' + href : href);
                const uddg = u.searchParams.get('uddg');
                if (uddg) href = decodeURIComponent(uddg);
            } else if (href.startsWith('//')) {
                href = 'https:' + href;
            }
        } catch (_) { }
        const domain = extractDomain(href);
        if (!domain || domain.includes('duckduckgo.com')) continue;
        results.push({ rank: results.length + 1, url: href, domain, title });
    }
    return results;
}

async function upsertResult(supabase, result) {
    const { error } = await supabase.from('serp_rankings').upsert({
        keyword: result.keyword,
        source: SOURCE,  // column now holds 'brave' or 'duckduckgo'
        top_domain: result.top_domain || null,
        top_url: result.top_url || null,
        top_title: result.top_title || null,
        top_results: result.top_results || [],
        error: result.error || null,
        checked_at: new Date().toISOString()
    }, { onConflict: 'keyword,source' });
    if (error) console.error('\nSupabase upsert error:', error.message);
}

function ownedMatches(ownedDomain, rankDomain) {
    if (!ownedDomain || !rankDomain) return false;
    const a = String(ownedDomain).toLowerCase().replace(/^www\./, '');
    const b = String(rankDomain).toLowerCase().replace(/^www\./, '');
    return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

function extractDomain(url) {
    try {
        const u = new URL(url.startsWith('//') ? 'https:' + url : url);
        return u.hostname.replace(/^www\./, '');
    } catch (_) { return ''; }
}

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '); }
function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/g, '/');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) { out[key] = true; }
            else { out[key] = next; i++; }
        }
    }
    return out;
}

main().catch(e => { console.error('\nFatal:', e); process.exit(1); });

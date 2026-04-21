/**
 * SERP (organic search) rank lookup
 * POST /api/serp/rank
 *
 * Body:
 *   { keywords: string[], forceRefresh?: boolean }
 *
 * Fetches the top organic result for each keyword via DuckDuckGo HTML
 * (more scrape-friendly than Google), caches results in Supabase for
 * 7 days, and returns the rank-1 domain / URL / title per keyword.
 *
 * The client should batch requests (~15–20 keywords per call) to stay
 * within the serverless function timeout.
 */

import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_DAYS = 7;
const CONCURRENCY = 3;
const SOURCE = 'duckduckgo';

const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { keywords = [], forceRefresh = false } = req.body || {};

    if (!Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: 'keywords array required' });
    }
    if (keywords.length > 50) {
        return res.status(400).json({ error: 'max 50 keywords per request' });
    }

    const cleanKeywords = [...new Set(
        keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
    )];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Load cached results
    const cached = new Map();
    if (!forceRefresh) {
        const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400 * 1000).toISOString();
        const { data: cachedRows } = await supabase
            .from('serp_rankings')
            .select('*')
            .in('keyword', cleanKeywords)
            .eq('source', SOURCE)
            .gte('checked_at', cutoff);

        if (cachedRows) {
            for (const row of cachedRows) cached.set(row.keyword, row);
        }
    }

    const toFetch = cleanKeywords.filter(k => !cached.has(k));
    const fetched = new Map();

    // Concurrency-limited queue
    const queue = [...toFetch];
    async function worker() {
        while (queue.length > 0) {
            const kw = queue.shift();
            if (!kw) break;
            try {
                const result = await fetchDuckDuckGoSerp(kw);
                fetched.set(kw, result);
            } catch (e) {
                fetched.set(kw, { keyword: kw, error: e.message, top_results: [] });
            }
            // Polite delay to reduce block risk
            await sleep(300 + Math.random() * 300);
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Persist fetched results to Supabase (upsert on keyword + source)
    if (fetched.size > 0) {
        const rows = Array.from(fetched.values()).map(r => ({
            keyword: r.keyword,
            source: SOURCE,
            top_domain: r.top_domain || null,
            top_url: r.top_url || null,
            top_title: r.top_title || null,
            top_results: r.top_results || [],
            error: r.error || null,
            checked_at: new Date().toISOString()
        }));

        const { error: upsertErr } = await supabase
            .from('serp_rankings')
            .upsert(rows, { onConflict: 'keyword,source' });

        if (upsertErr) {
            console.error('Supabase upsert error:', upsertErr);
        }
    }

    // Build response — one entry per requested keyword
    const resultsByKeyword = {};
    for (const kw of cleanKeywords) {
        const row = fetched.get(kw) || cached.get(kw);
        if (!row) {
            resultsByKeyword[kw] = { keyword: kw, error: 'not fetched', top_results: [] };
            continue;
        }
        resultsByKeyword[kw] = {
            keyword: kw,
            top_domain: row.top_domain,
            top_url: row.top_url,
            top_title: row.top_title,
            top_results: row.top_results || [],
            error: row.error || null,
            cached: cached.has(kw),
            checked_at: row.checked_at
        };
    }

    return res.status(200).json({
        source: SOURCE,
        requested: cleanKeywords.length,
        from_cache: cached.size,
        fetched_now: fetched.size,
        results: resultsByKeyword
    });
}

/**
 * Fetch DuckDuckGo HTML SERP and extract top 5 organic results.
 * DuckDuckGo's /html/ endpoint returns JS-free HTML that's easy to parse.
 */
async function fetchDuckDuckGoSerp(keyword) {
    const url = 'https://html.duckduckgo.com/html/';
    const body = new URLSearchParams({ q: keyword }).toString();
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://duckduckgo.com/'
        },
        body
    });

    if (!response.ok) {
        throw new Error(`DuckDuckGo returned ${response.status}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoHtml(html);

    if (results.length === 0) {
        // Check for anti-bot block
        if (html.toLowerCase().includes('unusual traffic') || html.toLowerCase().includes('captcha')) {
            throw new Error('DuckDuckGo blocked request (captcha)');
        }
        throw new Error('No organic results parsed');
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

/**
 * Parse DuckDuckGo HTML SERP.
 * Structure (simplified):
 *   <div class="result results_links results_links_deep web-result">
 *     <a class="result__a" href="//duckduckgo.com/l/?uddg=<ENCODED_REAL_URL>&rut=...">Title</a>
 *     <a class="result__url" href="...">example.com/page</a>
 *   </div>
 */
function parseDuckDuckGoHtml(html) {
    const results = [];
    // Match each result block's anchor + title
    // result__a pattern
    const anchorRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    let rank = 0;
    while ((match = anchorRegex.exec(html)) !== null) {
        rank += 1;
        if (rank > 10) break;

        const hrefRaw = decodeEntities(match[1]);
        const titleRaw = stripTags(match[2]).trim();

        // DuckDuckGo wraps outbound URLs: //duckduckgo.com/l/?uddg=<urlencoded>&rut=...
        let realUrl = hrefRaw;
        try {
            if (hrefRaw.startsWith('//duckduckgo.com/l/') || hrefRaw.includes('duckduckgo.com/l/')) {
                const u = new URL(hrefRaw.startsWith('//') ? 'https:' + hrefRaw : hrefRaw);
                const uddg = u.searchParams.get('uddg');
                if (uddg) realUrl = decodeURIComponent(uddg);
            } else if (hrefRaw.startsWith('//')) {
                realUrl = 'https:' + hrefRaw;
            }
        } catch (_) { /* keep hrefRaw */ }

        const domain = extractDomain(realUrl);
        if (!domain) continue;

        // Skip DDG sponsored/ad results (rare on /html/ but be safe)
        if (domain.includes('duckduckgo.com')) continue;

        results.push({ rank: results.length + 1, url: realUrl, domain, title: titleRaw });
    }
    return results;
}

function extractDomain(url) {
    try {
        const u = new URL(url.startsWith('//') ? 'https:' + url : url);
        return u.hostname.replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

function stripTags(s) {
    return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, '/');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

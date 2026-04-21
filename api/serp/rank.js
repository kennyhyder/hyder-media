/**
 * SERP (organic search) rank lookup — CACHE READER
 * POST /api/serp/rank
 *
 * Body:
 *   { keywords: string[] }
 *
 * Returns cached rank-1 domain / URL / title per keyword from
 * the Supabase `serp_rankings` table.
 *
 * NOTE: Server-side scraping was removed because DuckDuckGo (and
 * Bing/Google) block Vercel datacenter IPs at the TCP level. To
 * refresh the cache, run `node scripts/check-brand-ranks.mjs`
 * from a residential IP (your local machine). The script scrapes
 * DDG and upserts into the same serp_rankings table this endpoint
 * reads from.
 */

import { createClient } from '@supabase/supabase-js';

const SOURCE = 'duckduckgo';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { keywords = [] } = req.body || {};

    if (!Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: 'keywords array required' });
    }
    if (keywords.length > 500) {
        return res.status(400).json({ error: 'max 500 keywords per request' });
    }

    const cleanKeywords = [...new Set(
        keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
    )];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Look up cached rows (chunked — Supabase .in() limit is around 1000)
    const cached = new Map();
    const CHUNK = 200;
    for (let i = 0; i < cleanKeywords.length; i += CHUNK) {
        const batch = cleanKeywords.slice(i, i + CHUNK);
        const { data: rows, error } = await supabase
            .from('serp_rankings')
            .select('*')
            .in('keyword', batch)
            .eq('source', SOURCE);
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        if (rows) for (const r of rows) cached.set(r.keyword, r);
    }

    const resultsByKeyword = {};
    let missing = 0;
    for (const kw of cleanKeywords) {
        const row = cached.get(kw);
        if (!row) {
            missing++;
            resultsByKeyword[kw] = {
                keyword: kw,
                error: 'not in cache — run scripts/check-brand-ranks.mjs locally to populate',
                top_results: []
            };
            continue;
        }
        resultsByKeyword[kw] = {
            keyword: kw,
            top_domain: row.top_domain,
            top_url: row.top_url,
            top_title: row.top_title,
            top_results: row.top_results || [],
            error: row.error || null,
            cached: true,
            checked_at: row.checked_at
        };
    }

    return res.status(200).json({
        source: SOURCE,
        requested: cleanKeywords.length,
        from_cache: cached.size,
        missing,
        results: resultsByKeyword
    });
}


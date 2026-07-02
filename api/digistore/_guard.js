/**
 * Digistore24 API guard — protection against unauthenticated cost abuse.
 *
 * Context: api/digistore/weekly-signups.js was hammered by a zombie curl loop
 * (no Referer, ~1 req/2s for days) → $425 in BigQuery charges. The dashboard
 * pages (clients/digistore24/*.html) are sessionStorage-password-gated static
 * pages served from hyder.me that fetch these APIs same-origin, so the APIs
 * can't require secrets the browser doesn't have. Protection model instead:
 *
 *   1. Bearer CRON_SECRET bypass (internal/testing use).
 *   2. Same-origin Referer check — same-origin fetches send the full referrer
 *      under the default strict-origin-when-cross-origin policy. curl/bots
 *      send none → 403.
 *   3. In-memory per-IP sliding-window rate limit → 429. Per-instance only,
 *      but that's exactly what stops the tight-loop class of abuse.
 *   4. In-memory TTL response cache helper so repeated hits within the TTL
 *      don't re-trigger expensive upstream calls (BigQuery / Google Ads).
 *
 * Usage (top of every handler in api/digistore/):
 *   import { guard, getCached, setCached } from './_guard.js';
 *   export default async function handler(req, res) {
 *       if (!guard(req, res)) return; // guard already sent 403/429
 *       ...
 *   }
 *
 * Underscore prefix keeps Vercel from routing this file as an endpoint
 * (same convention as api/ag2020/_autodial-lib.js).
 */

const ALLOWED_REFERER_PREFIXES = [
    'https://hyder.me/',
    'https://www.hyder.me/',
    // Local dev (vercel dev / static file server)
    'http://localhost',
    'http://127.0.0.1',
];

// ---------------------------------------------------------------------------
// Rate limiter state (per serverless instance — resets on cold start, which
// is fine: the goal is stopping sustained loops, not perfect global limits).
// ---------------------------------------------------------------------------
const rateState = new Map(); // ip -> array of request timestamps (ms)
const RATE_MAX_IPS = 5000;   // memory bound

function clientIp(req) {
    // First hop of x-forwarded-for (set by Vercel; first entry = client)
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        return xff.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function bearerSecretOk(req) {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret) return false;
    const auth = req.headers['authorization'] || '';
    return auth === `Bearer ${secret}`;
}

function refererOk(req) {
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    return ALLOWED_REFERER_PREFIXES.some((p) => referer.startsWith(p));
}

/**
 * Returns true if the request may proceed. Otherwise sends a 403/429 JSON
 * response itself and returns false (caller should just `return`).
 *
 * opts: { windowMs = 300000, maxRequests = 60 }
 *
 * Default is 60/5min per IP: reporting.html fires 9 parallel fetches per
 * load / date-range change, so 30 would 429 a real user on their 4th
 * interaction inside 5 minutes. 60 still stops loop-class abuse (the $425
 * incident ran ~150 req/5min — and curl loops fail the Referer check first).
 */
export function guard(req, res, opts = {}) {
    const windowMs = opts.windowMs || 5 * 60 * 1000;
    const maxRequests = opts.maxRequests || 60;

    // Internal/testing bypass
    if (bearerSecretOk(req)) return true;

    // CORS preflight is harmless (no handler work happens) — let the handler
    // answer it so browser flows aren't broken.
    if (req.method === 'OPTIONS') return true;

    // Same-origin Referer check
    if (!refererOk(req)) {
        res.status(403).json({ error: 'forbidden' });
        return false;
    }

    // Per-IP sliding-window rate limit
    const ip = clientIp(req);
    const now = Date.now();
    let hits = rateState.get(ip) || [];
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= maxRequests) {
        rateState.set(ip, hits);
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        res.status(429).json({ error: 'rate_limited' });
        return false;
    }
    hits.push(now);
    rateState.set(ip, hits);

    // Bound memory: drop stale IPs occasionally
    if (rateState.size > RATE_MAX_IPS) {
        for (const [k, v] of rateState) {
            if (v.length === 0 || now - v[v.length - 1] > windowMs) rateState.delete(k);
            if (rateState.size <= RATE_MAX_IPS / 2) break;
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// TTL response cache (per instance). Keyed by path + normalized query.
// The dashboard appends a `_t=<Date.now()>` cache-bust param intended to
// defeat CDN/browser caching — strip it (and sort keys) so it doesn't defeat
// THIS cache, whose whole point is shielding BigQuery/Google Ads.
// ---------------------------------------------------------------------------
const responseCache = new Map(); // key -> { expiresAt, payload }
const CACHE_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function cacheKey(req) {
    const url = req.url || '';
    const qIdx = url.indexOf('?');
    const path = qIdx === -1 ? url : url.slice(0, qIdx);
    const query = qIdx === -1 ? '' : url.slice(qIdx + 1);
    const params = new URLSearchParams(query);
    params.delete('_t'); // client cache-bust — not meaningful to the response
    params.sort();
    return `${path}?${params.toString()}`;
}

export function getCached(req) {
    const key = cacheKey(req);
    const entry = responseCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        responseCache.delete(key);
        return null;
    }
    return entry.payload;
}

export function setCached(req, payload, ttlMs = DEFAULT_TTL_MS) {
    if (payload === undefined || payload === null) return;
    // Bound memory: prune expired, then oldest, before inserting
    if (responseCache.size >= CACHE_MAX_ENTRIES) {
        const now = Date.now();
        for (const [k, v] of responseCache) {
            if (now > v.expiresAt) responseCache.delete(k);
        }
        while (responseCache.size >= CACHE_MAX_ENTRIES) {
            const oldest = responseCache.keys().next().value;
            responseCache.delete(oldest);
        }
    }
    responseCache.set(cacheKey(req), { expiresAt: Date.now() + ttlMs, payload });
}

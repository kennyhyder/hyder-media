/**
 * Shared auth gate for /api/ag2020/* read/report endpoints.
 *
 * Accepted mechanisms:
 *   1. `Authorization: Bearer ${CRON_SECRET}`   — Vercel crons + internal calls.
 *   2. `Authorization: Bearer ${AG2020_DASH_TOKEN}` — the dashboard. Since
 *      2026-07-15 AG2020 uses a shared-password gate (Supabase auth removed
 *      after the cross-tenant magic-link incident); the built app sends this
 *      static token (src/lib/api.ts). It grants exactly what the shared
 *      password grants — one team identity.
 *   3. `Authorization: Bearer <supabase-jwt>`   — legacy; kept so nothing
 *      breaks for stragglers with a live session. Verified against GoTrue,
 *      results cached ~60s keyed by token hash.
 *   4. TRANSITION fallback (GET/HEAD reads ONLY): no/invalid token, but the
 *      Referer starts with https://hyder.me/clients/ag2020 → allowed with a
 *      console.warn so we can measure remaining unauthenticated traffic
 *      before tightening. Writes (POST/PUT/PATCH/DELETE) never get this.
 *
 * Usage in a handler (after the OPTIONS preflight check):
 *     import { requireAuth } from './_auth.js';
 *     const auth = await requireAuth(req, res);
 *     if (!auth) return; // 401 already sent
 *
 * NOT used by webhook receivers (autodial, sms-ingest, journey-ingest,
 * glassbiller-email-ingest, call-event-webhook, missed-call-webhook) — those
 * have their own secret/HMAC auth — nor by users/* (admin JWT gate in
 * users/_admin-auth.js).
 */

import crypto from 'crypto';

const CACHE_TTL_MS = 60 * 1000;
// tokenHash -> { ok: boolean, exp: epoch-ms }
const verifyCache = new Map();

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function timingSafeEqualStr(a, b) {
    const ah = crypto.createHash('sha256').update(a).digest();
    const bh = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ah, bh);
}

/**
 * Verify a Supabase user JWT against GoTrue. Returns true iff the token
 * resolves to a live user. Results (positive AND negative) cached ~60s.
 */
async function verifySupabaseJwt(token) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const apikey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !apikey) return false;

    const key = hashToken(token);
    const now = Date.now();
    const cached = verifyCache.get(key);
    if (cached && cached.exp > now) return cached.ok;

    let ok = false;
    try {
        const resp = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey,
            },
        });
        ok = resp.status === 200;
    } catch (err) {
        // Network hiccup to GoTrue: don't cache, don't authenticate.
        console.warn('[ag2020-auth] jwt verify error:', err.message);
        return false;
    }

    // Opportunistic cache cleanup so the map can't grow unbounded.
    if (verifyCache.size > 500) {
        for (const [k, v] of verifyCache) {
            if (v.exp <= now) verifyCache.delete(k);
        }
    }
    verifyCache.set(key, { ok, exp: now + CACHE_TTL_MS });
    return ok;
}

/**
 * Gate a request. Sends a 401 JSON response and returns null on failure;
 * returns { via: 'cron' | 'jwt' | 'referer-fallback' } on success.
 *
 * options.allow — array subset of ['cron', 'jwt', 'referer'] to restrict
 * accepted mechanisms (default: all three, with 'referer' auto-disabled for
 * non-GET/HEAD methods).
 */
export async function requireAuth(req, res, { allow = ['cron', 'jwt', 'referer'] } = {}) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    const token = m ? m[1].trim() : null;

    // 1. CRON_SECRET (crons / internal callers)
    const cronSecret = process.env.CRON_SECRET;
    if (allow.includes('cron') && token && cronSecret && timingSafeEqualStr(token, cronSecret)) {
        return { via: 'cron' };
    }

    // 1b. Dashboard token (shared-password model — see header comment).
    // Env-overridable for rotation; default must match src/lib/api.ts.
    const dashToken = (process.env.AG2020_DASH_TOKEN || 'ag2020-dash-4c7e1f9b2a8d3e5f6071829304a5b6c7').trim();
    if (allow.includes('jwt') && token && timingSafeEqualStr(token, dashToken)) {
        return { via: 'dash' };
    }

    // 2. Supabase user JWT
    if (allow.includes('jwt') && token) {
        if (await verifySupabaseJwt(token)) {
            return { via: 'jwt' };
        }
    }

    // 3. Transition-period referer fallback — GET/HEAD reads only, never writes.
    const method = (req.method || 'GET').toUpperCase();
    if (allow.includes('referer') && (method === 'GET' || method === 'HEAD')) {
        const referer = req.headers.referer || req.headers.referrer || '';
        if (typeof referer === 'string' && referer.startsWith('https://hyder.me/clients/ag2020')) {
            console.warn('[ag2020-auth] referer-fallback', req.url);
            return { via: 'referer-fallback' };
        }
    }

    res.status(401).json({ error: 'Unauthorized' });
    return null;
}

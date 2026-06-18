// Edge-resident redirect lookup. Used by middleware before any auth or
// route resolution. The hot path is a single Supabase REST GET keyed on
// from_path. Misses fall through to the regular route handler.
//
// Smart fallback (enabled by default): for paths that match common
// auto-generated patterns we lost (e.g. /sports/<league>/<year>/<slug>),
// suggest a redirect target without requiring a DB row.

import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// In-memory micro-cache, per edge isolate. The Next Data Cache
// (`next: { revalidate }`) does NOT apply to fetches inside middleware, so
// without this every single page load would do a live Supabase round-trip on
// the hot path. NEGATIVE caching matters most: the vast majority of paths have
// no redirect row, and we must not re-hit Supabase for every live URL. TTL is
// short so newly-added redirect rows take effect within ~a minute.
type RedirectResult = { to: string; status: number } | null;
const _cache = new Map<string, { value: RedirectResult; expires: number }>();
const CACHE_TTL_MS = 60_000;
const NEG_CACHE_ON_ERROR_MS = 5_000; // shorter, so a transient Supabase blip recovers fast
const LOOKUP_TIMEOUT_MS = 1_200;     // fail-open ceiling — never hang the middleware
const CACHE_MAX = 4_000;             // crude cap so an isolate can't grow unbounded

// The redirect table is an edge-case surface (only dead URLs need a row), so a
// slow Supabase must NEVER stall page rendering. We hard-timeout the lookup and
// fail OPEN (treat as "no redirect"). This is the fix for the site-wide 504s:
// previously this fetch had no timeout, so a slow Supabase hung the middleware
// on EVERY request and the gateway 504'd before the page could render.
async function lookupExact(fromPath: string): Promise<RedirectResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const cached = _cache.get(fromPath);
  if (cached && cached.expires > Date.now()) return cached.value;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const url = `${SUPABASE_URL}/rest/v1/sb_url_redirects?from_path=eq.${encodeURIComponent(fromPath)}&select=to_path,status_code&limit=1`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      setCache(fromPath, null, CACHE_TTL_MS);
      return null;
    }
    const rows = await r.json();
    const value: RedirectResult = rows?.[0] ? { to: rows[0].to_path, status: rows[0].status_code || 301 } : null;
    setCache(fromPath, value, CACHE_TTL_MS);
    return value;
  } catch {
    // Timeout or network error → fail OPEN. Brief negative cache so we don't
    // hammer a struggling Supabase on every request.
    setCache(fromPath, null, NEG_CACHE_ON_ERROR_MS);
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function setCache(key: string, value: RedirectResult, ttlMs: number): void {
  if (_cache.size >= CACHE_MAX) _cache.clear();
  _cache.set(key, { value, expires: Date.now() + ttlMs });
}

// Smart pattern fallback is DISABLED. Earlier version hijacked every live
// /sports/<league>/<year>/<slug>, /golf/<year>/<slug>, /sports/<league>/
// players/<slug>, /teams/<slug>, /event/<id> URL → 301 to parent. Catastrophic
// for SEO + UX because we have valid live routes at all those shapes.
//
// We can't know in middleware whether a route 404s without actually rendering
// it, so any pattern-based "smart" rule risks killing live URLs. The DB-backed
// exact-match table (sb_url_redirects) handles known-dead URLs explicitly,
// which is the correct surface for this. The sitemap-diff cron registers
// exact redirects (also fine), not patterns.
function smartFallback(_fromPath: string): string | null {
  return null;
}

// Track that the redirect was actually hit. Fire-and-forget — no await.
function recordHit(fromPath: string): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    // Use the RPC pattern via PostgREST: a custom function increments
    // hits + sets last_hit_at. If the RPC doesn't exist, this is a
    // best-effort no-op (call swallows errors silently).
    fetch(`${SUPABASE_URL}/rest/v1/rpc/sb_url_redirects_record_hit`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_from: fromPath }),
    }).catch(() => {});
  } catch {}
}

// Should this path be considered for redirect lookup? Skip noisy/static
// paths to keep middleware overhead minimal.
function shouldConsider(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  if (pathname.startsWith("/_vercel/")) return false;
  if (pathname.startsWith("/favicon")) return false;
  if (/\.(ico|png|jpg|jpeg|gif|webp|svg|css|js|map|txt|xml|webmanifest|woff2?|ttf)$/i.test(pathname)) return false;
  return true;
}

export async function checkRedirect(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (!shouldConsider(pathname)) return null;

  // 1. Exact match table lookup
  const exact = await lookupExact(pathname);
  if (exact) {
    recordHit(pathname);
    const target = new URL(exact.to, request.url);
    target.search = request.nextUrl.search; // preserve query params
    return NextResponse.redirect(target, exact.status);
  }
  // 2. Smart pattern fallback — only for legacy URL shapes we know are dead
  if (process.env.SB_SMART_404_FALLBACK !== "0") {
    const smart = smartFallback(pathname);
    if (smart) {
      const target = new URL(smart, request.url);
      target.search = request.nextUrl.search;
      return NextResponse.redirect(target, 301);
    }
  }
  return null;
}

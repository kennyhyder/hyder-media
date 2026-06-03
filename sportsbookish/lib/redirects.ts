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

// We DO need a fresh fetch per request so the cache is current after
// new redirect rows are added. To keep latency low, the middleware only
// consults this for paths that match patterns where we've previously
// shipped a 404 (sports/* paths) — skipped for static + API routes.
async function lookupExact(fromPath: string): Promise<{ to: string; status: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/sb_url_redirects?from_path=eq.${encodeURIComponent(fromPath)}&select=to_path,status_code&limit=1`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      // 60s edge cache — new redirects propagate within a minute.
      next: { revalidate: 60 },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[0]) return null;
    return { to: rows[0].to_path, status: rows[0].status_code || 301 };
  } catch {
    return null;
  }
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

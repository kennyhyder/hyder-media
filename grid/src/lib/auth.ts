// Server-only GridCensus auth + account data layer.
//
// NEVER import this into a "use client" file — it reads the service key.
//
// Design notes
// ------------
// - Session: the browser client (@supabase/ssr createBrowserClient) writes the
//   session into chunked first-party cookies (sb-<ref>-auth-token[.N]).
//   getServerSupabase() reads those cookies via @supabase/ssr's
//   createServerClient and getCurrentUser() calls supabase.auth.getUser() to
//   validate the session against Supabase Auth, then loads the gc_users row for
//   role/capabilities.
// - Token refresh happens in middleware (src/middleware.ts → updateSession),
//   which re-issues the auth cookie on every request so sessions don't silently
//   expire mid-session.
// - Graceful degradation: gc_ tables may not exist yet (DDL is owner-applied).
//   Every gc_ read is try/caught and returns a safe empty value, and
//   accountsEnabled() lets pages skip account UI entirely when unconfigured.

import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Public auth config present? Gates whether account UI renders at all. */
export function accountsEnabled(): boolean {
  return Boolean(SUPABASE_URL && ANON_KEY);
}

// ── Roles + capabilities ─────────────────────────────────────────────────────

export type GcRole = "member" | "contributor" | "owner" | "enterprise" | "moderator" | "staff";

export interface Capabilities {
  canContribute: boolean;   // submit edits/reports
  canClaim: boolean;        // claim owned profiles
  canModerate: boolean;     // approve/reject contributions + claims
  canAutoMerge: boolean;    // trusted contributor — edits fast-track
  canUseApi: boolean;       // issue + use API tokens
  exportRows: number;       // CSV export cap (tier hook)
}

/** Reputation threshold above which a contributor's edits auto-merge. */
export const AUTO_MERGE_REPUTATION = 100;

export function resolveCapabilities(role: GcRole, reputation = 0, overrides: Partial<Capabilities> = {}): Capabilities {
  const base: Capabilities = {
    canContribute: true,            // any logged-in member can suggest edits
    canClaim: true,
    canModerate: role === "staff" || role === "moderator",
    canAutoMerge:
      role === "staff" || role === "moderator" || reputation >= AUTO_MERGE_REPUTATION,
    canUseApi: true,
    exportRows: role === "enterprise" ? 100000 : role === "owner" ? 5000 : 1000,
  };
  return { ...base, ...overrides };
}

export interface GcUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: GcRole;
  reputation: number;
  capabilities: Capabilities;
  avatarUrl: string | null;
}

// ── REST helpers (service key) ───────────────────────────────────────────────

function svcHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Generic gc_ table read via PostgREST with the service key. Returns [] on any
 * failure (missing table, network, bad config) so callers never crash. This is
 * the graceful-degradation backbone for the whole account layer.
 */
export async function gcRead<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  // `revalidate` (seconds) lets ISR/static pages cache gc_ reads instead of
  // forcing themselves dynamic. Omit (undefined) for per-request reads (route
  // handlers, force-dynamic pages) — those default to no-store.
  revalidate?: number,
): Promise<T[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const init: RequestInit =
      revalidate === undefined
        ? { headers: svcHeaders(), cache: "no-store" }
        : { headers: svcHeaders(), next: { revalidate } };
    const res = await fetch(url.toString(), init);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

/** Generic gc_ write (POST/PATCH/DELETE). Returns the response rows or null. */
export async function gcWrite<T = Record<string, unknown>>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  params: Record<string, string> = {},
): Promise<T[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      method,
      headers: svcHeaders({ Prefer: "return=representation" }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T[]) : [];
  } catch {
    return null;
  }
}

// ── Server Supabase client (reads the @supabase/ssr auth cookies) ────────────

/**
 * Build a request-scoped Supabase server client that reads the auth session
 * from the sb-<ref>-auth-token cookies the browser client wrote. In a Server
 * Component (read-only cookie store) the setAll() is a no-op — token refresh is
 * handled by middleware, not here. Returns null when unconfigured.
 *
 * Use this anywhere you need the authenticated user server-side (pages, route
 * handlers). For mutations against gc_ tables we still use the service-key REST
 * helpers (gcRead/gcWrite) below, gated behind getCurrentUser().
 */
export async function getServerSupabase(): Promise<SupabaseClient | null> {
  if (!SUPABASE_URL || !ANON_KEY) return null;
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        // In Server Components the cookie store is read-only and will throw.
        // Middleware (updateSession) owns refresh; swallow here so reads work.
        try {
          for (const { name, value, options } of cookiesToSet) {
            jar.set(name, value, options);
          }
        } catch {
          /* read-only cookie store (Server Component) — ignore */
        }
      },
    },
  });
}

// ── Current user ─────────────────────────────────────────────────────────────

/**
 * Validate the session cookie against Supabase Auth (supabase.auth.getUser())
 * and load the gc_users row. Returns null when not signed in / unconfigured /
 * any failure. No-flash: this runs server-side, so the page renders the correct
 * signed-in state on first paint.
 */
export async function getCurrentUser(): Promise<GcUser | null> {
  if (!accountsEnabled() || !SUPABASE_URL || !ANON_KEY) return null;

  const supabase = await getServerSupabase();
  if (!supabase) return null;

  // 1) Validate the session against Supabase Auth. getUser() re-checks the JWT
  //    with GoTrue (not just decoding it locally), so a revoked/expired token
  //    fails closed.
  let authUser: { id: string; email?: string } | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    authUser = { id: data.user.id, email: data.user.email ?? undefined };
  } catch {
    return null;
  }
  if (!authUser?.id) return null;

  // 2) Load the gc_users profile row (graceful if table missing).
  const rows = await gcRead<{
    id: string;
    email: string | null;
    display_name: string | null;
    role: GcRole;
    capabilities: Partial<Capabilities> | null;
    avatar_url: string | null;
  }>("gc_users", { id: `eq.${authUser.id}`, select: "*", limit: "1" });

  const profile = rows[0];
  const role: GcRole = (profile?.role as GcRole) || "member";

  // 3) Reputation (graceful empty).
  const repRows = await gcRead<{ points: number }>("gc_reputation", {
    user_id: `eq.${authUser.id}`,
    select: "points",
    limit: "1",
  });
  const reputation = repRows[0]?.points ?? 0;

  return {
    id: authUser.id,
    email: profile?.email ?? authUser.email ?? null,
    displayName:
      profile?.display_name ??
      (authUser.email ? authUser.email.split("@")[0] : null),
    role,
    reputation,
    capabilities: resolveCapabilities(role, reputation, profile?.capabilities ?? {}),
    avatarUrl: profile?.avatar_url ?? null,
  };
}

/** Lightweight "is anyone signed in?" without loading the full profile. */
export async function getCurrentUserId(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.id ?? null;
}

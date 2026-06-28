// Server-only GridCensus auth + account data layer.
//
// NEVER import this into a "use client" file — it reads the service key.
//
// Design notes
// ------------
// - Session: the browser client mirrors the access token into a first-party
//   cookie (gc-access-token, see supabase-browser.ts). getCurrentUser() reads
//   that cookie and validates it against Supabase Auth, then loads the gc_users
//   row for role/capabilities.
// - Graceful degradation: gc_ tables may not exist yet (DDL is owner-applied).
//   Every gc_ read is try/caught and returns a safe empty value, and
//   accountsEnabled() lets pages skip account UI entirely when unconfigured.

import "server-only";

import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "./supabase-browser";

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

// ── Current user ─────────────────────────────────────────────────────────────

interface AuthUserResponse {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

/**
 * Validate the gc-access-token cookie against Supabase Auth and load the
 * gc_users row. Returns null when not signed in / unconfigured / any failure.
 * No-flash: this runs server-side, so the page renders the correct signed-in
 * state on first paint.
 */
export async function getCurrentUser(): Promise<GcUser | null> {
  if (!accountsEnabled() || !SUPABASE_URL || !ANON_KEY) return null;
  let token: string | undefined;
  try {
    const jar = await cookies();
    token = jar.get(ACCESS_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;

  // 1) Validate the JWT against Supabase Auth (GoTrue /user).
  let authUser: AuthUserResponse | null = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    authUser = (await res.json()) as AuthUserResponse;
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

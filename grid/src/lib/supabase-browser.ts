"use client";

// Browser-side Supabase client for GridCensus auth.
//
// We don't depend on @supabase/ssr. Instead the browser client persists its
// session (localStorage by default) AND we mirror the access token into a
// first-party cookie (`gc-access-token`) on every auth state change, so the
// server (src/lib/auth.ts → getCurrentUser) can read + validate it. Logout
// clears the cookie.
//
// Feature-flagged: if the public env vars are missing, getBrowserSupabase()
// returns null and the account UI degrades gracefully (no crash).

import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** True when public Supabase config is present (auth UI can render). */
export function authConfigured(): boolean {
  return Boolean(URL && ANON);
}

export const ACCESS_COOKIE = "gc-access-token";

let client: SupabaseClient | null = null;

function writeCookie(session: Session | null) {
  if (typeof document === "undefined") return;
  if (session?.access_token) {
    // Session-length-ish cookie; refreshed on every auth change. Lax so it
    // survives top-level navigations (the server needs it on page loads).
    const maxAge = 60 * 60 * 24 * 7; // 7d ceiling; token itself is short-lived
    document.cookie = `${ACCESS_COOKIE}=${session.access_token}; path=/; max-age=${maxAge}; samesite=lax`;
  } else {
    document.cookie = `${ACCESS_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

export function getBrowserSupabase(): SupabaseClient | null {
  if (!authConfigured()) return null;
  if (client) return client;
  client = createClient(URL, ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  // Mirror the access token into the readable cookie on every change.
  client.auth.onAuthStateChange((_event, session) => writeCookie(session));
  // Also sync the current session once on init (covers refresh-on-load).
  client.auth.getSession().then(({ data }) => writeCookie(data.session));
  return client;
}

/** Product flag baked into every GridCensus signup (shared-project trigger gate). */
export const GC_PRODUCT_META = { product: "gridcensus" as const };

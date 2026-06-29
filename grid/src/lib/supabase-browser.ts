"use client";

// Browser-side Supabase client for GridCensus auth.
//
// Uses @supabase/ssr's createBrowserClient, which manages the auth session in
// chunked, first-party cookies (`sb-<ref>-auth-token[.N]`) that the server can
// read directly. The cookie is written SYNCHRONOUSLY on sign-in, so a full
// page navigation to /account immediately after signInWithPassword() lands on a
// request the server can authenticate — no race with an async cookie mirror.
//
// Feature-flagged: if the public env vars are missing, getBrowserSupabase()
// returns null and the account UI degrades gracefully (no crash).

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** True when public Supabase config is present (auth UI can render). */
export function authConfigured(): boolean {
  return Boolean(URL && ANON);
}

let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (!authConfigured()) return null;
  if (client) return client;
  // createBrowserClient persists the session into the cookie store (the same
  // sb-<ref>-auth-token cookies the server reads via createServerClient). It
  // also auto-refreshes tokens and detects the session in the URL for OAuth /
  // magic-link callbacks.
  client = createBrowserClient(URL, ANON);
  return client;
}

/**
 * Resolve whether a Supabase session currently exists, client-side. Replaces
 * the old synchronous cookie sniff — with @supabase/ssr the session lives in
 * chunked cookies the client manages, so ask the client directly. Returns false
 * when auth isn't configured.
 */
export async function hasBrowserSession(): Promise<boolean> {
  const sb = getBrowserSupabase();
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/** Product flag baked into every GridCensus signup (shared-project trigger gate). */
export const GC_PRODUCT_META = { product: "gridcensus" as const };

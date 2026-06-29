// Supabase auth-token refresh middleware (standard @supabase/ssr pattern).
//
// Runs on every matched request. It rebuilds the session from the request
// cookies, calls supabase.auth.getUser() (which transparently refreshes an
// expiring access token), and writes any refreshed auth cookies back onto the
// response. Without this, an expired access token would silently log the user
// out instead of being refreshed.
//
// This does NOT gate routes — page/route handlers still call getCurrentUser().
// It only keeps the session cookie fresh. If Supabase isn't configured, it's a
// no-op pass-through.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Auth not configured in this environment — pass through untouched.
  if (!SUPABASE_URL || !ANON_KEY) return response;

  const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to BOTH the request (so downstream reads see fresh values) and
        // the response (so the browser persists the refreshed cookie).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser() — it
  // refreshes the session and must control the cookie write path.
  try {
    await supabase.auth.getUser();
  } catch {
    /* refresh failed — leave cookies as-is, let the page handle no-session */
  }

  return response;
}

export const config = {
  // Run on everything except static assets, the favicon, and image-gen routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|opengraph-image|twitter-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

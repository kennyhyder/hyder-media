// OAuth / PKCE / email-confirm callback.
//
// Supabase redirects here after Google OAuth, after an email-confirmation link,
// and after a magic-link click — as <site>/auth/callback?code=<pkce_code>. This
// route exchanges that code for a session and writes the auth cookie, THEN
// redirects to the app. Without this route the code is never exchanged, so the
// session is never established and the user bounces straight back to /login —
// which is exactly the "nothing happens after sign-in / confirm" symptom.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` lets callers land somewhere other than /account (defends against
  // open-redirect by only honoring same-origin relative paths).
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/account";

  // Surface provider errors (e.g. user denied OAuth) back on the login page.
  const errorDescription = searchParams.get("error_description");
  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (code && SUPABASE_URL && ANON_KEY) {
    const jar = await cookies();
    const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll() {
          return jar.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            jar.set(name, value, options);
          }
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // No code (or unconfigured) — nothing to exchange; send home to /login.
  return NextResponse.redirect(`${origin}/login`);
}

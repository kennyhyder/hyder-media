// Server-side sign-out: clears the @supabase/ssr auth cookies.
// The browser client also calls supabase.auth.signOut() to clear its own
// in-memory session; this route guarantees the cookies are gone server-side
// so the next SSR render of /account sees no session.
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/auth";

export async function POST() {
  try {
    const supabase = await getServerSupabase();
    // signOut() expires the sb-<ref>-auth-token cookies via the setAll() bridge.
    await supabase?.auth.signOut();
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}

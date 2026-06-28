// Clear the server-readable access cookie. The browser client also calls
// supabase.auth.signOut() to clear its own persisted session.
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/supabase-browser";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}

// Admin authorization. Admins are identified by their email being present
// in the ADMIN_EMAILS env var (comma-separated). Default: kenny@hyder.me.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "kenny@hyder.me")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

// Server-side helper for API routes. Returns either { user, supabase } on
// success or { error: NextResponse } when the request should be rejected.
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!isAdminEmail(user.email)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, supabase };
}

// Server component variant — for pages, returns null if non-admin so the page
// can call notFound() or redirect.
export async function isAdminRequest(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return isAdminEmail(user?.email);
}

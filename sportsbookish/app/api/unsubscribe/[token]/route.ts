import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// RFC 8058 one-click unsubscribe handler. Gmail/Yahoo POST here when the
// user clicks "Unsubscribe" in the inbox header. Must respond 200 within
// 30 seconds and honor within 48h (we honor immediately).
//
// List-Unsubscribe-Post header in outbound mail points here; the human
// confirmation page lives at /unsubscribe/[token]/page.tsx.

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 20) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "server config" }, { status: 503 });
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  const newToken = crypto.randomBytes(18).toString("hex");
  const { error } = await client
    .from("sb_email_preferences")
    .update({
      unsubscribed_all: true,
      unsubscribed_at: new Date().toISOString(),
      marketing_drip: false,
      product_updates: false,
      unsub_token: newToken,
      updated_at: new Date().toISOString(),
    })
    .eq("unsub_token", token);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

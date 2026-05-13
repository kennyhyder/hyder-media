import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

// GET /api/admin/invites — list every invite code + redemption count
// POST /api/admin/invites — body { tier, label?, max_uses?, expires_at?, code? }
//   If `code` provided, use it verbatim; else generate a 10-char alphanumeric.

function makeCode(prefix?: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return prefix ? `${prefix.toUpperCase()}-${out}` : out;
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const service = createServiceClient();
  const { data: codes, error } = await service
    .from("sb_invite_codes")
    .select("code, tier, label, max_uses, uses, expires_at, disabled, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: codes || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const tier = body.tier || "elite";
  if (!["free", "pro", "elite"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  const row = {
    code: body.code?.toString().toUpperCase().trim() || makeCode(body.prefix),
    tier,
    label: body.label || null,
    max_uses: body.max_uses || 1,
    expires_at: body.expires_at || null,
  };
  const service = createServiceClient();
  const { data, error } = await service.from("sb_invite_codes").insert(row).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ code: data });
}

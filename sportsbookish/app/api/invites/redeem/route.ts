import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redeemInvite } from "@/lib/invites";

// POST /api/invites/redeem — body: { code }
// Applies the invite to the currently signed-in user.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = (body.code || "").toString().trim();
  if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });

  const result = await redeemInvite(code, user.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });

  return NextResponse.json({ ok: true, tier: result.tier });
}

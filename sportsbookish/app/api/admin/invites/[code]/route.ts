import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";

// PATCH /api/admin/invites/[code] — body { disabled?, max_uses?, expires_at?, label? }
// DELETE /api/admin/invites/[code]
export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ["disabled", "max_uses", "expires_at", "label", "tier"]) {
    if (k in body) patch[k] = body[k];
  }
  const service = createServiceClient();
  const { data, error } = await service
    .from("sb_invite_codes")
    .update(patch)
    .eq("code", code)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ code: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const service = createServiceClient();
  const { error } = await service.from("sb_invite_codes").delete().eq("code", code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

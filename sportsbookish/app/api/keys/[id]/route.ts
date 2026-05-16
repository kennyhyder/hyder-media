import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// DELETE /api/keys/[id] — revoke a key the user owns.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (!Number.isFinite(keyId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const service = createServiceClient();
  const { data: existing } = await service
    .from("sb_api_keys")
    .select("id, user_id, status")
    .eq("id", keyId)
    .maybeSingle();
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  if (existing.status === "revoked") return NextResponse.json({ ok: true, already: true });

  const { error } = await service
    .from("sb_api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

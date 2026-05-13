import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";

// PATCH /api/admin/users/[id] — change a user's tier (and optionally status).
// Body: { tier?: 'free'|'pro'|'elite', status?: string }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (body.tier && !["free", "pro", "elite"].includes(body.tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const service = createServiceClient();

  // Upsert the subscription so users created before the trigger existed still work
  const patch: Record<string, unknown> = {};
  if (body.tier) patch.tier = body.tier;
  if (body.status) patch.status = body.status;

  // If granting paid tier without a Stripe sub, set a far-future period end
  // so the dashboard shows "active" instead of "renews never".
  if (body.tier && body.tier !== "free") {
    patch.current_period_end = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
  }

  const { data, error } = await service
    .from("sb_subscriptions")
    .upsert({ user_id: id, ...patch }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, subscription: data });
}

// DELETE /api/admin/users/[id] — delete the auth.users row entirely.
// Cascades to all sb_* tables via FK.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  if (auth.user.id === id) {
    return NextResponse.json({ error: "Can't delete yourself" }, { status: 400 });
  }
  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

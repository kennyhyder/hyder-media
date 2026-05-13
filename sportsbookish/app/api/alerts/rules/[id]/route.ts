import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRuleInput } from "@/lib/alert-rules";

// PATCH /api/alerts/rules/[id] — update fields on a rule
// DELETE /api/alerts/rules/[id] — delete a rule
// Both require the rule to be owned by the current user.

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { user, supabase };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // If name or min_delta is being changed, validate
  if (body.name !== undefined || body.min_delta !== undefined) {
    const v = validateRuleInput({
      name: body.name ?? "x",
      min_delta: body.min_delta,
      direction: body.direction,
      channels: body.channels,
      alert_types: body.alert_types,
    });
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "enabled", "sports", "leagues", "alert_types", "direction", "min_delta", "min_kalshi_prob", "max_kalshi_prob", "channels"]) {
    if (k in body) patch[k] = body[k];
  }

  const { data, error } = await supabase
    .from("sb_alert_rules")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const { error } = await supabase
    .from("sb_alert_rules")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

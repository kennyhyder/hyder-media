import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeProfit } from "@/lib/bet-score";

// PATCH /api/bets/[id] — update bet (typically settle: { status: 'won' | 'lost' | 'push' })
// DELETE /api/bets/[id]

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

  // Load the existing bet so we can compute profit if status changes
  const { data: existing } = await supabase
    .from("sb_bets")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  for (const k of ["status", "user_stated_prob", "closing_implied_prob", "notes", "event_start_at", "result_at"]) {
    if (k in body) patch[k] = body[k];
  }

  // If status is being updated to a settled state, compute profit_units + result_at
  if (body.status && ["won", "lost", "push", "void"].includes(body.status)) {
    const americanOdds = existing.line_american;
    if (americanOdds != null) {
      patch.profit_units = computeProfit(existing.stake_units, americanOdds, body.status);
    }
    if (!patch.result_at) patch.result_at = new Date().toISOString();

    // If closing line is provided, compute CLV
    if (body.closing_implied_prob != null && existing.line_implied_prob != null) {
      patch.clv = Number((Number(body.closing_implied_prob) - Number(existing.line_implied_prob)).toFixed(5));
    }
  }

  const { data, error } = await supabase
    .from("sb_bets")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bet: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const { error } = await supabase
    .from("sb_bets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRuleInput } from "@/lib/alert-rules";

// GET /api/alerts/rules — list current user's rules
// POST /api/alerts/rules — create a new rule for current user

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { user, supabase };
}

async function requireElite() {
  const auth = await requireUser();
  if ("error" in auth) return auth;
  const { user, supabase } = auth;
  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier")
    .eq("user_id", user.id)
    .maybeSingle();
  if (sub?.tier !== "elite") {
    return { error: NextResponse.json({ error: "Elite tier required" }, { status: 403 }) };
  }
  return { user, supabase };
}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const { data, error } = await supabase
    .from("sb_alert_rules")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireElite();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const validated = validateRuleInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const row = {
    user_id: user.id,
    name: body.name,
    enabled: body.enabled ?? true,
    sports: body.sports || null,
    leagues: body.leagues || null,
    alert_types: body.alert_types || null,
    direction: body.direction || null,
    min_delta: body.min_delta ?? 0.03,
    min_kalshi_prob: body.min_kalshi_prob ?? null,
    max_kalshi_prob: body.max_kalshi_prob ?? null,
    channels: body.channels && body.channels.length > 0 ? body.channels : ["email"],
  };

  const { data, error } = await supabase
    .from("sb_alert_rules")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRuleInput, SMART_PRESETS } from "@/lib/alert-rules";

// GET /api/alerts/rules — list current user's rules
// POST /api/alerts/rules — create a new rule for current user
//   body { ...rule } — manual rule (Pro+ allowed; Pro restricted to email-only)
//   body { preset_key } — Elite-only smart preset; clones from SMART_PRESETS

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { user, supabase };
}

async function getTier(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<"free" | "pro" | "elite"> {
  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();
  return (sub?.tier || "free") as "free" | "pro" | "elite";
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
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const tier = await getTier(supabase, user.id);
  if (tier === "free") {
    return NextResponse.json({ error: "Alert rules require Pro or Elite. Upgrade at /pricing." }, { status: 403 });
  }

  // --- Smart preset branch (Elite only) ---
  if (body.preset_key) {
    if (tier !== "elite") {
      return NextResponse.json({ error: "Smart presets are Elite-only. Upgrade at /pricing." }, { status: 403 });
    }
    const preset = SMART_PRESETS.find((p) => p.key === body.preset_key);
    if (!preset) return NextResponse.json({ error: "Unknown preset" }, { status: 400 });

    // Prevent duplicate preset for same user
    const { data: existing } = await supabase
      .from("sb_alert_rules")
      .select("id")
      .eq("user_id", user.id)
      .eq("preset_key", preset.key)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "You already have this preset enabled" }, { status: 409 });
    }

    const row = {
      user_id: user.id,
      name: preset.defaults.name || preset.name,
      enabled: preset.defaults.enabled ?? true,
      sports: preset.defaults.sports ?? null,
      leagues: preset.defaults.leagues ?? null,
      alert_types: preset.defaults.alert_types ?? null,
      direction: preset.defaults.direction ?? null,
      min_delta: preset.defaults.min_delta ?? 0.05,
      min_kalshi_prob: preset.defaults.min_kalshi_prob ?? null,
      max_kalshi_prob: preset.defaults.max_kalshi_prob ?? null,
      channels: preset.defaults.channels ?? ["email"],
      preset_key: preset.key,
      watchlist_only: preset.defaults.watchlist_only ?? false,
    };
    const { data, error } = await supabase.from("sb_alert_rules").insert(row).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rule: data });
  }

  // --- Manual rule branch ---
  const validated = validateRuleInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  // Tier-gated channel restriction
  let channels: string[] = body.channels && body.channels.length > 0 ? body.channels : ["email"];
  if (tier === "pro") {
    // Pro: email only. Strip any SMS/other channels with a clear message
    const filtered = channels.filter((c) => c === "email");
    if (filtered.length === 0) filtered.push("email");
    channels = filtered;
  }

  // Pro can't use watchlist_only (Elite feature)
  const watchlistOnly = tier === "elite" ? (body.watchlist_only === true) : false;

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
    channels,
    preset_key: null,
    watchlist_only: watchlistOnly,
  };

  const { data, error } = await supabase
    .from("sb_alert_rules")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

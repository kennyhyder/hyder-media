import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { americanToImplied, americanToDecimal, computeProfit, type Bet } from "@/lib/bet-score";

// GET  /api/bets — list current user's bets
// POST /api/bets — create a new bet
//
// Body for POST: {
//   event_label, contestant_label, market_type?,
//   line_american, book, stake_units,
//   league?, event_id?, sport?, spread_point?, total_point?,
//   user_stated_prob?, notes?
// }

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
    .from("sb_bets")
    .select("*")
    .eq("user_id", user.id)
    .order("placed_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bets: (data || []) as Bet[] });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  // Bet tracker is Elite-only for now (will be a Pro add-on later)
  const tier = await getTier(supabase, user.id);
  if (tier !== "elite") {
    return NextResponse.json({ error: "Bet tracker is Elite-only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // Basic validation
  if (!body.event_label || !body.contestant_label || !body.book) {
    return NextResponse.json({ error: "event_label, contestant_label, and book required" }, { status: 400 });
  }
  if (typeof body.stake_units !== "number" || body.stake_units <= 0) {
    return NextResponse.json({ error: "stake_units must be a positive number" }, { status: 400 });
  }
  if (body.line_american != null && (typeof body.line_american !== "number" || body.line_american === 0)) {
    return NextResponse.json({ error: "line_american must be a non-zero integer (e.g. -110, +200)" }, { status: 400 });
  }

  const americanOdds = body.line_american != null ? Math.round(Number(body.line_american)) : null;
  const lineImplied = americanOdds != null ? Number(americanToImplied(americanOdds).toFixed(5)) : null;
  const lineDecimal = americanOdds != null ? Number(americanToDecimal(americanOdds).toFixed(4)) : null;

  const row = {
    user_id: user.id,
    source: body.source || "manual",
    league: body.league || null,
    sport: body.sport || null,
    event_id: body.event_id || null,
    event_label: body.event_label,
    contestant_label: body.contestant_label,
    market_type: body.market_type || "moneyline",
    line_american: americanOdds,
    line_decimal: lineDecimal,
    line_implied_prob: lineImplied,
    spread_point: body.spread_point ?? null,
    total_point: body.total_point ?? null,
    book: body.book,
    stake_units: Number(body.stake_units),
    stake_currency: body.stake_currency || "units",
    placed_at: body.placed_at ? new Date(body.placed_at).toISOString() : new Date().toISOString(),
    event_start_at: body.event_start_at ? new Date(body.event_start_at).toISOString() : null,
    status: "pending",
    user_stated_prob: body.user_stated_prob != null ? Number(body.user_stated_prob) : null,
    notes: body.notes || null,
  };

  const { data, error } = await supabase
    .from("sb_bets")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bet: data });
}

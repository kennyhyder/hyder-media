import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Force-refresh a golf tournament's Kalshi + DataGolf data. Elite-gated.
//
// Cost model: Kalshi is free, DataGolf is a flat subscription (no per-call
// cost), so unlike the sports refresh this is essentially free for us — but
// we still rate-limit per user to prevent abuse + give the UI sane feedback.
//   - 50 refreshes per UTC day per user (higher than sports' 25 since cost is zero)
//   - 90-second cooldown per tournament (shorter than sports' 5 min)
//
// Records every attempt in sb_force_refreshes for analytics + quota enforcement.
// Reuses the same table as sports refreshes; source='golf' distinguishes them.

const DAILY_QUOTA = 50;
const COOLDOWN_SECONDS = 90;
const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

interface QuotaState {
  used_today: number;
  remaining: number;
  cooldown_until: string | null;
}

async function getQuotaState(userId: string, tournamentId?: string): Promise<QuotaState> {
  const service = createServiceClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: today } = await service
    .from("sb_force_refreshes")
    .select("id", { count: "exact" })
    .eq("user_id", userId)
    .gte("requested_at", todayStart.toISOString());
  const usedToday = today?.length ?? 0;

  let cooldownUntil: string | null = null;
  if (tournamentId) {
    const { data: last } = await service
      .from("sb_force_refreshes")
      .select("requested_at")
      .eq("user_id", userId)
      .eq("source", "golf")
      .eq("event_id", tournamentId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.requested_at) {
      const ageMs = Date.now() - new Date(last.requested_at).getTime();
      if (ageMs < COOLDOWN_SECONDS * 1000) {
        cooldownUntil = new Date(new Date(last.requested_at).getTime() + COOLDOWN_SECONDS * 1000).toISOString();
      }
    }
  }
  return { used_today: usedToday, remaining: Math.max(0, DAILY_QUOTA - usedToday), cooldown_until: cooldownUntil };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tournamentId = url.searchParams.get("tournament_id") || undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const state = await getQuotaState(user.id, tournamentId);
  return NextResponse.json({ ...state, daily_quota: DAILY_QUOTA });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier")
    .eq("user_id", user.id)
    .maybeSingle();
  if ((sub?.tier || "free") !== "elite") {
    return NextResponse.json({ error: "Force-refresh is Elite-only. Upgrade at /pricing." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const tournamentId = body.tournament_id;
  if (!tournamentId) return NextResponse.json({ error: "tournament_id required" }, { status: 400 });

  const state = await getQuotaState(user.id, tournamentId);
  if (state.remaining <= 0) {
    return NextResponse.json({ error: `Daily limit (${DAILY_QUOTA}) reached. Resets at midnight UTC.`, ...state, daily_quota: DAILY_QUOTA }, { status: 429 });
  }
  if (state.cooldown_until) {
    return NextResponse.json({ error: "On cooldown — wait a moment before refreshing again", ...state, daily_quota: DAILY_QUOTA }, { status: 429 });
  }

  // Insert pending record (claims quota)
  const service = createServiceClient();
  const { data: refreshRow, error: insertErr } = await service
    .from("sb_force_refreshes")
    .insert({ user_id: user.id, source: "golf", event_id: tournamentId, league: "pga", credits_used: 0, status: "pending" })
    .select("id")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  try {
    const r = await fetch(`${DATA_HOST}/api/golfodds/refresh-tournament?tournament_id=${encodeURIComponent(tournamentId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const data = await r.json();
    const success = r.ok && data.ok;
    await service
      .from("sb_force_refreshes")
      .update({
        status: success ? "success" : "failed",
        error: success ? null : (data.error || `HTTP ${r.status}`),
        finished_at: new Date().toISOString(),
      })
      .eq("id", refreshRow.id);
    const newState = await getQuotaState(user.id, tournamentId);
    if (!success) {
      return NextResponse.json({ ok: false, error: data.error || `HTTP ${r.status}`, ...newState, daily_quota: DAILY_QUOTA }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      kalshi_quotes: data.kalshi?.total_quotes ?? 0,
      dg_inserted: data.datagolf?.summary_total ?? 0,
      elapsed_ms: data.elapsed_ms,
      ...newState,
      daily_quota: DAILY_QUOTA,
    });
  } catch (e) {
    await service
      .from("sb_force_refreshes")
      .update({ status: "failed", error: e instanceof Error ? e.message : "unknown", finished_at: new Date().toISOString() })
      .eq("id", refreshRow.id);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

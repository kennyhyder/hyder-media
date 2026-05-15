import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Force-refresh a single sports event's book lines. Elite-gated with:
//   - 25 refreshes per UTC day per user (daily quota)
//   - 5-minute cooldown per event per user
//
// Proxies the Odds API call through the hyder.me data plane (which holds the
// ODDS_API_KEY). Records every attempt in sb_force_refreshes for analytics
// + quota enforcement.

const DAILY_QUOTA = 25;
const COOLDOWN_SECONDS = 5 * 60;
const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

interface QuotaState {
  used_today: number;
  remaining: number;
  cooldown_until: string | null;   // ISO if currently cooling on this event
}

async function getQuotaState(userId: string, eventId?: string): Promise<QuotaState> {
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
  if (eventId) {
    const { data: last } = await service
      .from("sb_force_refreshes")
      .select("requested_at")
      .eq("user_id", userId)
      .eq("event_id", eventId)
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
  const eventId = url.searchParams.get("event_id") || undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const state = await getQuotaState(user.id, eventId);
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
  const eventId = body.event_id;
  const league = body.league;
  if (!eventId) return NextResponse.json({ error: "event_id required" }, { status: 400 });

  // Enforce quota + cooldown
  const state = await getQuotaState(user.id, eventId);
  if (state.remaining <= 0) {
    return NextResponse.json({ error: `Daily limit (${DAILY_QUOTA}) reached. Resets at midnight UTC.`, ...state, daily_quota: DAILY_QUOTA }, { status: 429 });
  }
  if (state.cooldown_until) {
    return NextResponse.json({ error: "On cooldown — wait a few minutes before refreshing this game again", ...state, daily_quota: DAILY_QUOTA }, { status: 429 });
  }

  // Insert pending record (claims quota)
  const service = createServiceClient();
  const { data: refreshRow, error: insertErr } = await service
    .from("sb_force_refreshes")
    .insert({ user_id: user.id, source: "sports", event_id: eventId, league: league || null, credits_used: 3, status: "pending" })
    .select("id")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Proxy to data plane
  try {
    const r = await fetch(`${DATA_HOST}/api/sports/refresh-event?event_id=${encodeURIComponent(eventId)}`, {
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
        credits_used: data.credits_used ?? 3,
        finished_at: new Date().toISOString(),
      })
      .eq("id", refreshRow.id);
    const newState = await getQuotaState(user.id, eventId);
    if (!success) {
      return NextResponse.json({ ok: false, error: data.error || `HTTP ${r.status}`, ...newState, daily_quota: DAILY_QUOTA }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      credits_used: data.credits_used,
      credits_remaining: data.credits_remaining,
      quotes_inserted: data.quotes_inserted,
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

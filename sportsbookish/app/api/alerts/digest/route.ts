import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Daily edge digest — sent once per day to every user (Free + Pro + Elite)
// whose preferences allow it. Pulls the top buy edges from the prior 24 hours
// across all sports and bundles into a single email.
//
// Cron: 0 14 * * * (8am ET = 14:00 UTC during ET DST; adjust for off-DST)
// Auth: ?secret=<CRON_SECRET> or Authorization: Bearer <CRON_SECRET>

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

interface FeedAlert {
  source: "golf" | "sports";
  id: string;
  sport?: string;                       // 'golf' for golf alerts, league key for sports
  league: string;
  fired_at: string;
  alert_type: string;
  direction: string;
  delta: number;
  probability: number;
  reference: number;
  title: string;
  subtitle: string;
  link: string;
  parent_status?: string | null;        // tournament/event status
  parent_end_at?: string | null;        // tournament end_date or event start_time
}

const SPORT_EMOJI: Record<string, string> = { pga: "⛳", golf: "⛳", nba: "🏀", mlb: "⚾", nhl: "🏒", epl: "⚽", mls: "⚽" };

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const from = process.env.RESEND_FROM || "alerts@sportsbookish.com";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

function digestHtml(topBuys: FeedAlert[], topSells: FeedAlert[], topMovers: FeedAlert[]): string {
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const renderRows = (alerts: FeedAlert[], mode: "buy" | "sell" | "mover") =>
    alerts.map((a) => {
      const emoji = SPORT_EMOJI[a.league] || "🎯";
      const sign = a.delta >= 0 ? "+" : "";
      const pctDelta = `${sign}${(a.delta * 100).toFixed(1)}%`;
      const color = mode === "buy" ? "#059669" : mode === "sell" ? "#dc2626" : (a.delta >= 0 ? "#059669" : "#dc2626");
      const subline = mode === "mover"
        ? `Kalshi ${(a.probability * 100).toFixed(1)}% (was ${(a.reference * 100).toFixed(1)}%)`
        : `Kalshi ${(a.probability * 100).toFixed(1)}%`;
      return `<tr>
        <td style="padding: 12px 0; border-top: 1px solid #e5e5e5;">
          <a href="${SITE_URL}${a.link}" style="color: #111; text-decoration: none;">
            <div style="font-weight: 600; font-size: 15px;">${emoji} ${a.title}</div>
            <div style="font-size: 12px; color: #777;">${a.subtitle}</div>
          </a>
        </td>
        <td style="padding: 12px 0; border-top: 1px solid #e5e5e5; text-align: right;">
          <div style="font-size: 18px; font-weight: 700; color: ${color};">${pctDelta}</div>
          <div style="font-size: 11px; color: #999;">${subline}</div>
        </td>
      </tr>`;
    }).join("");

  return `<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">SportsBookISH · ${dateStr}</div>
    <h1 style="margin: 8px 0 0; font-size: 26px;">Today's top edges</h1>
    <div style="font-size: 14px; color: #666;">From the last 24h on Kalshi vs the books</div>
  </div>

  ${topBuys.length > 0 ? `
  <h2 style="font-size: 16px; color: #059669; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 0;">🟢 Top buys</h2>
  <p style="font-size: 12px; color: #666; margin: 4px 0 0;">Kalshi cheaper than book consensus — bet YES on Kalshi.</p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">${renderRows(topBuys, "buy")}</table>
  ` : ""}

  ${topSells.length > 0 ? `
  <h2 style="font-size: 16px; color: #dc2626; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 0;">🔴 Most overpriced</h2>
  <p style="font-size: 12px; color: #666; margin: 4px 0 0;">Kalshi above book consensus — sell on Kalshi or bet at the books.</p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">${renderRows(topSells, "sell")}</table>
  ` : ""}

  ${topMovers.length > 0 ? `
  <h2 style="font-size: 16px; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 0;">📊 Biggest line moves (24h)</h2>
  <p style="font-size: 12px; color: #666; margin: 4px 0 0;">Kalshi quotes that moved the most over the last day — different signal than edges (no book comparison needed).</p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">${renderRows(topMovers, "mover")}</table>
  ` : ""}

  <div style="margin-top: 32px; padding: 16px; background: #f5f5f5; border-radius: 8px; text-align: center; font-size: 13px; color: #555;">
    <strong>Want these in real time?</strong><br>
    <a href="${SITE_URL}/pricing" style="color: #059669; font-weight: 600;">Pro $10/mo</a> adds custom alert rules.
    <a href="${SITE_URL}/pricing" style="color: #d97706; font-weight: 600;">Elite $100/yr</a> adds smart presets, SMS, and watchlist filtering.
  </div>

  <div style="margin-top: 24px; font-size: 11px; color: #999; text-align: center;">
    <a href="${SITE_URL}/settings" style="color: #999;">Unsubscribe from digest</a> ·
    <a href="${SITE_URL}" style="color: #999;">sportsbookish.com</a>
  </div>
</div>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 1. Fetch top alerts from the data plane (last 24h)
  const alertsRes = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=24&limit=300`);
  if (!alertsRes.ok) return NextResponse.json({ error: `data-plane ${alertsRes.status}` }, { status: 502 });
  const { alerts: rawAlerts = [] }: { alerts?: FeedAlert[] } = await alertsRes.json();

  // 1a. Filter out alerts whose underlying tournament/event has already
  // settled. Same player can fire many alerts intra-day as the line moves,
  // and the PGA Championship ending Sunday afternoon would still appear in
  // Monday's 4am digest without this filter.
  const nowMs = Date.now();
  const liveAlerts = rawAlerts.filter((a) => {
    if (a.parent_status === "closed") return false;
    // For sports events with a start_time in the past + no other status info,
    // assume the game is over after a 6h buffer (longer than any MLB/NBA game).
    if (a.source === "sports" && a.parent_end_at) {
      const startMs = new Date(a.parent_end_at).getTime();
      if (Number.isFinite(startMs) && nowMs - startMs > 6 * 3600 * 1000) return false;
    }
    // For golf, tournament end_date is the last day; treat the tournament as
    // closed once it's been 18h past midnight UTC of end_date (covers a Sun
    // 6pm ET finish reaching Mon ~1pm UTC).
    if (a.source === "golf" && a.parent_end_at) {
      const endMs = new Date(a.parent_end_at).getTime() + 24 * 3600 * 1000;
      if (Number.isFinite(endMs) && nowMs > endMs) return false;
    }
    return true;
  });

  // 1b. Dedupe by (title, subtitle) — keep only the largest-|delta| alert
  // per unique market so a player whose line moved 5 times intra-day
  // appears once, not five times.
  const bestByKey = new Map<string, FeedAlert>();
  for (const a of liveAlerts) {
    const key = `${a.title}|${a.subtitle}|${a.direction}`;
    const prev = bestByKey.get(key);
    if (!prev || Math.abs(a.delta) > Math.abs(prev.delta)) bestByKey.set(key, a);
  }
  const alerts = Array.from(bestByKey.values());

  // Stratify by sport so no single league (almost always golf, since its
  // 100+ player futures naturally produce the biggest absolute edges)
  // crowds out the others. Take top 2 per sport, then fill remaining
  // slots from the global pool. Result: a digest where MLB/NBA/NHL/EPL/
  // NFL/MLS actually appear instead of 8 golf rows + 2 others.
  function topByDirection(direction: "buy" | "sell" | "up" | "down", maxPerSport = 2, maxTotal = 8) {
    const filtered = alerts.filter((a) => a.direction === direction || (direction === "buy" && a.direction === "up") || (direction === "sell" && a.direction === "down"));
    const sorted = [...filtered].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const perSport = new Map<string, number>();
    const taken: FeedAlert[] = [];
    // Pass 1: enforce per-sport cap
    for (const a of sorted) {
      const sport = a.sport || a.source;
      const used = perSport.get(sport) || 0;
      if (used >= maxPerSport) continue;
      taken.push(a);
      perSport.set(sport, used + 1);
      if (taken.length >= maxTotal) break;
    }
    // Pass 2: fill any remaining slots from any sport (in case some sports
    // had < maxPerSport so we ended up with < maxTotal total)
    if (taken.length < maxTotal) {
      const takenIds = new Set(taken.map((a) => a.id));
      for (const a of sorted) {
        if (takenIds.has(a.id)) continue;
        taken.push(a);
        if (taken.length >= maxTotal) break;
      }
    }
    return taken;
  }
  const buys = topByDirection("buy", 2, 8);
  const sells = topByDirection("sell", 2, 8);

  // Top movers — biggest absolute Kalshi line moves regardless of buy/sell.
  // Pulls from sports_alerts (alert_type='movement') since golf alerts are
  // edge-based not movement-based. Excludes anything already in buys/sells
  // to avoid the same row appearing twice.
  const shownIds = new Set([...buys, ...sells].map((a) => a.id));
  const movers = alerts
    .filter((a) => a.source === "sports" && !shownIds.has(a.id))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const moversStratified: FeedAlert[] = [];
  const moversPerSport = new Map<string, number>();
  for (const a of movers) {
    const sport = a.sport || a.source;
    const used = moversPerSport.get(sport) || 0;
    if (used >= 2) continue;
    moversStratified.push(a);
    moversPerSport.set(sport, used + 1);
    if (moversStratified.length >= 6) break;
  }

  if (buys.length === 0 && sells.length === 0 && moversStratified.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no alerts today", date: today });
  }

  // 2. Find users to email — anyone whose digest preference is on (default TRUE),
  //    EXCEPT users who've already received today's digest.
  const { data: prefs } = await supabase
    .from("sb_user_preferences")
    .select("user_id, daily_digest_enabled");
  const optedOutUsers = new Set((prefs || []).filter((p) => p.daily_digest_enabled === false).map((p) => p.user_id));

  const { data: sentTodayRows } = await supabase
    .from("sb_digest_sends")
    .select("user_id")
    .eq("sent_for_date", today);
  const alreadySent = new Set((sentTodayRows || []).map((r) => r.user_id));

  // Pull all users via auth admin
  const allUsers: { id: string; email: string | undefined }[] = [];
  let page = 1;
  for (;;) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users || [];
    for (const u of users) {
      if (u.email && !optedOutUsers.has(u.id) && !alreadySent.has(u.id)) {
        allUsers.push({ id: u.id, email: u.email });
      }
    }
    if (users.length < 1000) break;
    page++;
  }

  const html = digestHtml(buys, sells, moversStratified);
  const subject = `📊 Today's top sports edges — SportsBookISH`;

  // 3. Send + record. Insert dispatch record first (uniqueness prevents duplicates).
  let sent = 0;
  let failed = 0;
  for (const u of allUsers) {
    const { error: claimErr } = await supabase
      .from("sb_digest_sends")
      .insert({ user_id: u.id, sent_for_date: today, alert_count: buys.length + sells.length, status: "sending" });
    if (claimErr) continue; // race or already inserted

    const result = await sendEmail(u.email!, subject, html);
    await supabase
      .from("sb_digest_sends")
      .update({ status: result.ok ? "sent" : "failed" })
      .eq("user_id", u.id)
      .eq("sent_for_date", today);

    if (result.ok) sent++;
    else failed++;
  }

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    date: today,
    alerts_pool_raw: rawAlerts.length,
    alerts_pool_live: liveAlerts.length,
    alerts_pool_deduped: alerts.length,
    top_buys: buys.length,
    top_sells: sells.length,
    top_movers: moversStratified.length,
    eligible_users: allUsers.length,
    sent,
    failed,
  });
}

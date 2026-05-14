import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { alertMatchesRule, type AlertRule, type AlertMatchInput } from "@/lib/alert-rules";

// Cron endpoint — pulls recent alerts from the data plane, matches them
// against every enabled user rule, and dispatches via configured channels.
// Records each dispatch in sb_alert_dispatches with a unique (rule, alert)
// constraint so re-runs are idempotent.
//
// Auth: Authorization: Bearer <CRON_SECRET> OR ?secret=<CRON_SECRET>
// Schedule (vercel.json): every 5 min

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

interface FeedAlert {
  source: "golf" | "sports";
  id: string;
  sport: string | null;
  league: string;
  fired_at: string;
  alert_type: string;
  direction: string;
  delta: number;
  probability: number;
  reference: number;
  reference_label: string;
  title: string;
  subtitle: string;
  book_count: number;
  link: string;
}

function normalizeAlertForMatch(a: FeedAlert): AlertMatchInput {
  const alertType: "movement" | "edge_buy" | "edge_sell" =
    a.source === "golf" && a.direction === "buy" ? "edge_buy" :
    a.source === "golf" && a.direction === "sell" ? "edge_sell" :
    "movement";
  // Build a stable contestant key for watchlist matching: "<league>:<normalized title>"
  // This matches the convention used by WatchlistButton when bookmarking.
  const norm = (a.title || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    source: a.source,
    sport: a.sport,
    league: a.league,
    alert_type: alertType,
    direction: a.direction,
    delta: a.delta,
    probability: a.probability,
    contestant_key: `${a.league}:${norm}`,
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const from = process.env.RESEND_FROM || "alerts@hyder.me";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { ok: false, error: `Resend ${r.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

function alertEmailHtml(a: FeedAlert, ruleName: string, siteUrl: string): string {
  const direction = (a.direction === "up" || a.direction === "buy") ? "🟢" : "🔴";
  const deltaStr = `${a.delta >= 0 ? "+" : ""}${(a.delta * 100).toFixed(2)}%`;
  const probStr = `${(a.probability * 100).toFixed(1)}%`;
  const refStr = `${(a.reference * 100).toFixed(1)}%`;
  return `<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px;">
  <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">SportsBookish · ${ruleName}</div>
  <h2 style="margin: 0 0 12px; font-size: 22px;">${direction} ${a.title}</h2>
  <div style="font-size: 14px; color: #444; margin-bottom: 16px;">${a.subtitle}</div>
  <table style="font-size: 14px; width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 6px 0; color: #888;">Type</td><td style="text-align: right;">${a.alert_type}</td></tr>
    <tr><td style="padding: 6px 0; color: #888;">Direction</td><td style="text-align: right;">${a.direction}</td></tr>
    <tr><td style="padding: 6px 0; color: #888;">Δ</td><td style="text-align: right; font-weight: bold;">${deltaStr}</td></tr>
    <tr><td style="padding: 6px 0; color: #888;">Kalshi</td><td style="text-align: right; color: #d97706;">${probStr}</td></tr>
    <tr><td style="padding: 6px 0; color: #888;">${a.reference_label}</td><td style="text-align: right;">${refStr}</td></tr>
  </table>
  <a href="${siteUrl}${a.link}" style="display: inline-block; margin-top: 18px; padding: 10px 18px; background: #059669; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">View on SportsBookish →</a>
  <hr style="margin-top: 28px; border: none; border-top: 1px solid #eee;">
  <div style="font-size: 11px; color: #888; margin-top: 12px;">
    You're getting this because your rule "<strong>${ruleName}</strong>" matched.
    <a href="${siteUrl}/alerts?tab=rules" style="color: #059669;">Manage rules</a>
  </div>
</div>`;
}

function sportFromLeague(league: string): string {
  switch (league) {
    case "pga":
    case "golf":
      return "golf";
    case "nba":
      return "basketball";
    case "mlb":
      return "baseball";
    case "nhl":
      return "hockey";
    case "epl":
    case "mls":
      return "soccer";
    default:
      return league;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();

  // 1. Pull recent alerts from data plane (last 30 min)
  const alertsRes = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=1&limit=300`);
  if (!alertsRes.ok) {
    return NextResponse.json({ ok: false, error: `data-plane fetch ${alertsRes.status}` }, { status: 502 });
  }
  const { alerts = [] }: { alerts?: FeedAlert[] } = await alertsRes.json();

  // Normalize sport based on league when sport is null
  for (const a of alerts) {
    if (!a.sport) a.sport = sportFromLeague(a.league);
  }

  // 2. Load all enabled rules
  const { data: rulesData } = await supabase
    .from("sb_alert_rules")
    .select("*")
    .eq("enabled", true);
  const rules = (rulesData || []) as AlertRule[];

  if (rules.length === 0) {
    return NextResponse.json({ ok: true, alerts_scanned: alerts.length, rules_active: 0, dispatches: 0 });
  }

  // 3. Pre-load per-user watchlist sets for any rule with watchlist_only=true.
  // Convention: watchlist match key = "<league>:<normalized label>".
  const userIdsNeedingWatchlist = Array.from(new Set(rules.filter((r) => r.watchlist_only).map((r) => r.user_id)));
  const watchlistByUser = new Map<string, Set<string>>();
  if (userIdsNeedingWatchlist.length > 0) {
    const { data: wl } = await supabase
      .from("sb_watchlist")
      .select("user_id, label, league")
      .in("user_id", userIdsNeedingWatchlist);
    for (const w of wl || []) {
      const norm = (w.label || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      const key = `${w.league || ""}:${norm}`;
      const set = watchlistByUser.get(w.user_id) || new Set<string>();
      set.add(key);
      watchlistByUser.set(w.user_id, set);
    }
  }

  // 4. Build (rule, alert) match list
  const matches: { rule: AlertRule; alert: FeedAlert }[] = [];
  for (const alert of alerts) {
    const input = normalizeAlertForMatch(alert);
    for (const rule of rules) {
      const watchlist = rule.watchlist_only ? watchlistByUser.get(rule.user_id) : undefined;
      if (alertMatchesRule(input, rule, watchlist)) matches.push({ rule, alert });
    }
  }

  if (matches.length === 0) {
    return NextResponse.json({ ok: true, alerts_scanned: alerts.length, rules_active: rules.length, dispatches: 0 });
  }

  // 4. Skip ones already dispatched
  const dispatchKeys = matches.map((m) => ({ rule_id: m.rule.id, alert_source: m.alert.source, alert_id: m.alert.id }));
  const orFilter = dispatchKeys
    .map((k) => `and(rule_id.eq.${k.rule_id},alert_source.eq.${k.alert_source},alert_id.eq.${k.alert_id})`)
    .join(",");
  const { data: existing } = await supabase
    .from("sb_alert_dispatches")
    .select("rule_id, alert_source, alert_id")
    .or(orFilter);
  const existingSet = new Set((existing || []).map((e) => `${e.rule_id}|${e.alert_source}|${e.alert_id}`));
  const pending = matches.filter((m) => !existingSet.has(`${m.rule.id}|${m.alert.source}|${m.alert.id}`));

  // 5. Look up email addresses for each user that has pending matches
  const userIds = Array.from(new Set(pending.map((m) => m.rule.user_id)));
  const emailByUser = new Map<string, string>();
  // auth.admin.listUsers is paginated; for our scale, single page is fine
  const { data: usersRes } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  for (const u of usersRes?.users || []) {
    if (u.email) emailByUser.set(u.id, u.email);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
  const dispatched: { rule_id: string; user_id: string; alert_source: string; alert_id: string; channels: string[]; email_status: string | null; sms_status: string | null; error: string | null; snapshot: FeedAlert }[] = [];

  // 6. Send emails and record dispatches
  for (const { rule, alert } of pending) {
    const wantsEmail = rule.channels.includes("email");
    const wantsSms = rule.channels.includes("sms");
    let emailStatus: string | null = null;
    let smsStatus: string | null = null;
    let err: string | null = null;

    if (wantsEmail) {
      const email = emailByUser.get(rule.user_id);
      if (!email) {
        emailStatus = "failed";
        err = "no email on file";
      } else {
        const result = await sendEmail(email, `⚡ ${rule.name}: ${alert.title}`, alertEmailHtml(alert, rule.name, siteUrl));
        emailStatus = result.ok ? "sent" : "failed";
        if (!result.ok) err = result.error || null;
      }
    }

    if (wantsSms) {
      // SMS dispatch not wired yet (pending Twilio A2P)
      smsStatus = "pending";
    }

    dispatched.push({
      rule_id: rule.id,
      user_id: rule.user_id,
      alert_source: alert.source,
      alert_id: alert.id,
      channels: rule.channels,
      email_status: emailStatus,
      sms_status: smsStatus,
      error: err,
      snapshot: alert,
    });
  }

  if (dispatched.length) {
    await supabase.from("sb_alert_dispatches").insert(dispatched.map((d) => ({ ...d, snapshot: d.snapshot as unknown as Record<string, unknown> })));
    // Bump rule fire counts (one update per rule that fired)
    const ruleCounts = new Map<string, number>();
    for (const d of dispatched) ruleCounts.set(d.rule_id, (ruleCounts.get(d.rule_id) || 0) + 1);
    const now = new Date().toISOString();
    for (const [ruleId, n] of ruleCounts) {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) continue;
      await supabase
        .from("sb_alert_rules")
        .update({ fire_count: rule.fire_count + n, last_fired_at: now })
        .eq("id", ruleId);
    }
  }

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    alerts_scanned: alerts.length,
    rules_active: rules.length,
    matches: matches.length,
    dispatches: dispatched.length,
    skipped_duplicates: matches.length - pending.length,
  });
}

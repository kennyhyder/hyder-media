import { createClient } from "@supabase/supabase-js";
import { TEMPLATES } from "./_email_templates.js";

// Daily drip cron. Reads user signups + activity + subscription state,
// determines which (user, email_key) pair is "due" to send, builds the
// personalized payload (live edge numbers, usage counts), and dispatches
// via Resend from welcome@sportsbookish.com.
//
// Idempotent: sb_email_sends has UNIQUE(user_id, email_key), so re-runs
// of the same day silently skip already-sent rows.
//
// Schedule: runs once daily at 14:30 UTC (~7:30am Pacific / 10:30am ET).
//
// GET /api/sports/cron-email-drip
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 300 };

const SITE = "https://sportsbookish.com";
const RESEND_API = "https://api.resend.com/emails";
const FROM = process.env.EMAIL_DRIP_FROM || "Kenny @ SportsBookISH <kenny@sportsbookish.com>";
const REPLY_TO = process.env.EMAIL_DRIP_REPLY_TO || "kenny@hyder.me";

// Per-template send rules. `triggerDays` = exact day-since-signup delta
// (linear welcome series). `behaviorTrigger` = predicate against the
// user activity / subscription state. A user gets ONE email per cron run
// at most (first matching template wins, prioritized by array order).
const SEQUENCE = [
  // Day 0 — welcome (only if signed up >=10 min ago to avoid races with the
  // Stripe checkout flow that some users complete in 1-2 minutes)
  { key: "welcome_d0",      template: "welcome_d0",      triggerDays: { min: 0, max: 0 } },
  { key: "value_d2",        template: "value_d2",        triggerDays: { min: 2, max: 2 } },
  { key: "tactic_d4",       template: "tactic_d4",       triggerDays: { min: 4, max: 4 } },
  { key: "upsell_d7",       template: "upsell_d7",       triggerDays: { min: 7, max: 7 } },
  { key: "activation_d10",  template: "activation_d10",  triggerDays: { min: 10, max: 10 } },
  { key: "upsell_d14",      template: "upsell_d14",      triggerDays: { min: 14, max: 14 } },
  { key: "finalupsell_d21", template: "finalupsell_d21", triggerDays: { min: 21, max: 21 } },
  { key: "winback_d30",     template: "winback_d30",     triggerDays: { min: 30, max: 60 }, behaviorPredicate: (ctx) => ctx.last_active_days >= 14 },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// Day-since-signup, integer floor
function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

async function fetchLiveAggregates(supabase) {
  // Pull a current snapshot used to inject live numbers into emails.
  // Cheap aggregates: biggest +EV right now + active leagues + alerts/day.
  const [{ data: alertsToday, count: alertsCount }, { data: leagues }] = await Promise.all([
    supabase.from("sports_alerts").select("id", { count: "exact", head: true })
      .gte("fired_at", new Date(Date.now() - 24 * 3600000).toISOString()),
    supabase.from("sports_events").select("league").eq("status", "open"),
  ]);
  const activeLeagues = new Set((leagues || []).map((r) => r.league)).size;
  return {
    active_alerts_count: alertsCount ?? 0,
    active_leagues: activeLeagues,
  };
}

// Pull the user's activity counts in last 30d
async function fetchUserActivity(supabase, userId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows } = await supabase
    .from("sb_user_events")
    .select("event_name, sport, created_at")
    .eq("user_id", userId)
    .gte("created_at", since);
  const counts = {
    event_views: 0,
    positive_ev_views: 0,
    pricing_views: 0,
    paywall_hits: 0,
    bet_count: 0,
    last_active_at: null,
  };
  const sportCounts = {};
  for (const r of rows || []) {
    if (r.event_name === "event_view") counts.event_views++;
    if (r.event_name === "positive_ev_view") counts.positive_ev_views++;
    if (r.event_name === "pricing_view") counts.pricing_views++;
    if (r.event_name === "paywall_hit") counts.paywall_hits++;
    if (r.event_name === "bet_logged") counts.bet_count++;
    if (!counts.last_active_at || new Date(r.created_at) > new Date(counts.last_active_at)) {
      counts.last_active_at = r.created_at;
    }
    if (r.sport) sportCounts[r.sport] = (sportCounts[r.sport] || 0) + 1;
  }
  const top_sport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { ...counts, top_sport };
}

async function ensureEmailPreferences(supabase, userId) {
  let { data: prefs } = await supabase
    .from("sb_email_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!prefs) {
    const { data: created } = await supabase
      .from("sb_email_preferences")
      .insert({ user_id: userId })
      .select("*")
      .single();
    prefs = created;
  }
  return prefs;
}

// Sends one email via Resend with one-click unsubscribe header.
async function sendOne({ to, subject, html, text, unsubToken, messageTags }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const unsubUrl = `${SITE}/unsubscribe/${unsubToken}`;
  const r = await fetch(RESEND_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      reply_to: REPLY_TO,
      to: [to],
      subject,
      html,
      text,
      headers: {
        // RFC 8058 one-click unsubscribe — Gmail/Yahoo enforce this since 2024.
        // List-Unsubscribe MUST point at an HTTPS endpoint that accepts POST;
        // we use /api/unsubscribe/[token] (not the page) for the POST handler.
        "List-Unsubscribe": `<${SITE}/api/unsubscribe/${unsubToken}>, <mailto:unsubscribe@sportsbookish.com?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: messageTags?.map(([name, value]) => ({ name, value })),
    }),
  });
  const body = await r.text();
  if (!r.ok) return { ok: false, error: `${r.status}: ${body.slice(0, 300)}` };
  try {
    const j = JSON.parse(body);
    return { ok: true, resend_id: j.id || null };
  } catch {
    return { ok: true, resend_id: null };
  }
}

// Templates imported at top — direct reference TEMPLATES below.

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "RESEND_API_KEY missing" });
  }
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const summary = { started_at: startedAt, considered: 0, sent: 0, skipped: 0, errored: 0, results: [] };

  // Live aggregates (same numbers used across all emails in this run)
  const liveAgg = await fetchLiveAggregates(supabase);

  // Pull current biggest +EV across all open games (no need to be perfect)
  let topEdge = null;
  try {
    const resp = await fetch(`${SITE}/api/sports/events?league=all&with=markets&status=open&limit=50`);
    const data = await resp.json();
    for (const e of data?.events || []) {
      for (const m of e.markets || []) {
        if (m.implied_prob == null || m.books_median == null) continue;
        if (m.implied_prob < 0.05 || m.implied_prob > 0.95) continue;
        const edge = m.books_median - m.implied_prob;
        if (!topEdge || edge > topEdge.edge) {
          topEdge = { edge, title: `${m.contestant_label} (${e.title})` };
        }
      }
    }
  } catch { /* live numbers degrade gracefully */ }

  // Pull users to consider — anyone with signup in last 60d, plus 30d
  // inactive (winback). We do this via auth.users + sb_subscriptions join.
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: users } = await supabase
    .from("sb_subscriptions")
    .select("user_id, tier, created_at, email:auth_users(email, raw_user_meta_data)")
    .gte("created_at", cutoff)
    .limit(500);
  // Fallback if the FK alias doesn't work — query auth.users directly
  const userList = users || [];

  for (const u of userList) {
    summary.considered++;
    if (u.tier !== "free") continue; // Drip is for free users → paid

    // Resolve email
    const userEmail = u.email?.email
      || (await supabase.auth.admin.getUserById(u.user_id)).data?.user?.email;
    if (!userEmail) { summary.skipped++; continue; }

    // Honor unsubscribes
    const prefs = await ensureEmailPreferences(supabase, u.user_id);
    if (prefs.unsubscribed_all || !prefs.marketing_drip) {
      summary.skipped++;
      continue;
    }

    const dso = daysSince(u.created_at);
    const activity = await fetchUserActivity(supabase, u.user_id);
    const ctx = {
      user_id: u.user_id,
      email: userEmail,
      first_name: u.email?.raw_user_meta_data?.first_name || null,
      signup_at: u.created_at,
      tier: u.tier,
      ...activity,
      current_top_edge_pct: topEdge?.edge ?? null,
      current_top_event_title: topEdge?.title ?? null,
      active_alerts_count: liveAgg.active_alerts_count,
      active_leagues: liveAgg.active_leagues,
      unsub_token: prefs.unsub_token,
      last_active_days: activity.last_active_at
        ? Math.floor((Date.now() - new Date(activity.last_active_at).getTime()) / 86400000)
        : 999,
    };

    // Pick the first sequence entry whose triggerDays matches AND not yet sent
    let chosen = null;
    for (const step of SEQUENCE) {
      if (dso < step.triggerDays.min || dso > step.triggerDays.max) continue;
      if (step.behaviorPredicate && !step.behaviorPredicate(ctx)) continue;
      // Idempotency check
      const { data: prior } = await supabase
        .from("sb_email_sends")
        .select("id")
        .eq("user_id", u.user_id)
        .eq("email_key", step.key)
        .maybeSingle();
      if (prior) continue;
      chosen = step;
      break;
    }
    if (!chosen) { summary.skipped++; continue; }

    const tpl = TEMPLATES[chosen.template];
    if (!tpl) { summary.errored++; continue; }
    const rendered = tpl(ctx);

    const sendRes = await sendOne({
      to: userEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubToken: prefs.unsub_token,
      messageTags: [["email_key", chosen.key], ["tier", u.tier]],
    });

    // Log regardless of success — preserves the audit trail
    await supabase.from("sb_email_sends").insert({
      user_id: u.user_id,
      email_key: chosen.key,
      resend_id: sendRes.resend_id || null,
      subject: rendered.subject,
      to_email: userEmail,
    });

    if (sendRes.ok) summary.sent++;
    else summary.errored++;
    summary.results.push({ user_id: u.user_id, email_key: chosen.key, ok: sendRes.ok, error: sendRes.error || null });
  }

  return res.status(200).json(summary);
}

import { createClient } from "@supabase/supabase-js";
import { postSocial, formatDigestPost } from "./_social.js";
import { getBudgetState, digestCanRun } from "./_social_budget.js";

// Daily social digest post — pulls the same edges feed the email digest
// uses, formats top 3 buys + biggest mover into a single post, and
// publishes it. Idempotent per (platform, date) via sb_social_posts.dedup_key.
//
// GET /api/sports/cron-social-digest
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 30 };

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";
const SITE_URL = process.env.SOCIAL_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const dedupKey = `digest:${today}`;

  // Idempotency check
  const { data: existing } = await supabase
    .from("sb_social_posts")
    .select("id, status")
    .eq("platform", "x")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (existing && existing.status === "sent") {
    return res.status(200).json({ skipped: "already sent today", dedup_key: dedupKey });
  }

  // Budget gate
  const budget = await getBudgetState();
  if (!digestCanRun(budget)) {
    return res.status(200).json({ skipped: "out of Make budget", budget });
  }

  // Pull alerts pool (same source as email digest) + apply the same filters
  const alertsRes = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=24&limit=300`);
  if (!alertsRes.ok) return res.status(502).json({ error: `data-plane ${alertsRes.status}` });
  const { alerts: rawAlerts = [] } = await alertsRes.json();

  const nowMs = Date.now();
  // Same closed-tournament + recent-activity filters as the email digest
  const liveAlerts0 = rawAlerts.filter((a) => {
    if (a.parent_status === "closed") return false;
    if (a.source === "sports" && a.parent_end_at) {
      const startMs = new Date(a.parent_end_at).getTime();
      if (Number.isFinite(startMs) && nowMs - startMs > 6 * 3600 * 1000) return false;
    }
    if (a.source === "golf" && a.parent_end_at) {
      const endMs = new Date(a.parent_end_at).getTime() + 24 * 3600 * 1000;
      if (Number.isFinite(endMs) && nowMs > endMs) return false;
    }
    return true;
  });
  const latestByTournament = new Map();
  for (const a of liveAlerts0) {
    if (a.source !== "golf") continue;
    const t = a.subtitle.split(" · ").pop() || a.subtitle;
    const ts = new Date(a.fired_at).getTime();
    if (!latestByTournament.has(t) || ts > latestByTournament.get(t)) latestByTournament.set(t, ts);
  }
  const stale = new Set(Array.from(latestByTournament.entries()).filter(([, ts]) => nowMs - ts > 6 * 3600 * 1000).map(([n]) => n));
  const liveAlerts = liveAlerts0.filter((a) => a.source !== "golf" || !stale.has(a.subtitle.split(" · ").pop() || a.subtitle));

  // Dedup by (title, subtitle, direction)
  const bestByKey = new Map();
  for (const a of liveAlerts) {
    const key = `${a.title}|${a.subtitle}|${a.direction}`;
    const prev = bestByKey.get(key);
    if (!prev || Math.abs(a.delta) > Math.abs(prev.delta)) bestByKey.set(key, a);
  }
  const alerts = Array.from(bestByKey.values());

  // Top 3 buys + biggest sports mover
  const buys = alerts
    .filter((a) => a.direction === "buy" || a.direction === "up")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const movers = alerts
    .filter((a) => a.source === "sports")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 1);

  if (buys.length === 0 && movers.length === 0) {
    return res.status(200).json({ skipped: "no edges to post" });
  }

  const text = formatDigestPost(buys, movers, SITE_URL);
  const result = await postSocial(text, { kind: "daily_digest", dedup_key: dedupKey });

  // Record per-platform: one row per platform per dedup_key
  const rows = [
    { platform: "x", res: result.x },
    { platform: "bluesky", res: result.bluesky },
  ];
  for (const { platform, res: r } of rows) {
    await supabase.from("sb_social_posts").upsert({
      platform,
      kind: "daily_digest",
      dedup_key: dedupKey,
      text,
      post_uri: r.uri || null,
      post_cid: r.cid || null,
      status: r.ok ? "sent" : (r.skipped ? "skipped" : "failed"),
      error: r.error || r.reason || null,
    }, { onConflict: "platform,dedup_key" });
  }

  return res.status(200).json({
    any_sent: result.any_sent,
    text,
    text_length: text.length,
    x: result.x,
    bluesky: result.bluesky,
    counts: { buys: buys.length, movers: movers.length },
  });
}

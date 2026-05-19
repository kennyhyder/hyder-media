import { createClient } from "@supabase/supabase-js";
import { postBluesky, formatMoveAlert } from "./_social.js";

// Threshold-gated Bluesky alert posting. Runs frequently and posts when a
// Kalshi line moves >= MIN_DELTA in the configured lookback window AND we
// haven't posted about that alert before.
//
// Rate-limited per (event_id, direction) via sb_social_posts.dedup_key so
// a market that whipsaws doesn't flood the feed.
//
// GET /api/sports/cron-social-alerts
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 30 };

const MIN_DELTA = 0.07;                  // 7% move — rarer than the 2% detection threshold
const SINCE_MIN = 15;                    // only fire on fresh alerts (last 15 min)
const MAX_POSTS_PER_RUN = 3;             // protect from spammy slates
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

  const sinceISO = new Date(Date.now() - SINCE_MIN * 60 * 1000).toISOString();
  const alertsRes = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=1&limit=100`);
  if (!alertsRes.ok) return res.status(502).json({ error: `data-plane ${alertsRes.status}` });
  const { alerts: raw = [] } = await alertsRes.json();

  // Same closed-tournament filter as the digest
  const nowMs = Date.now();
  const live = raw.filter((a) => {
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

  // Filter to fresh, large-move sports alerts
  const candidates = live
    .filter((a) => a.source === "sports")
    .filter((a) => new Date(a.fired_at).toISOString() >= sinceISO)
    .filter((a) => Math.abs(a.delta) >= MIN_DELTA)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  if (candidates.length === 0) {
    return res.status(200).json({ skipped: "no qualifying alerts", checked: live.length });
  }

  // Dedup check — only post each (alert.id) once. We use the alert id (a UUID
  // per fire) as the natural dedup key. Same line whipsawing fires a new
  // alert id each time so we'd post the new one, but only if it's also
  // dedup-clear at the (event, direction) level — that's what posted_by_event
  // takes care of within this run.
  const postedByEvent = new Set();
  const results = [];
  for (const a of candidates) {
    if (results.length >= MAX_POSTS_PER_RUN) break;
    const eventKey = `${a.id || ""}`;
    const eventDir = `${a.title}|${a.subtitle}|${a.direction}`;
    if (postedByEvent.has(eventDir)) continue;
    const dedupKey = `move:${eventKey}`;

    // Skip if already in DB
    const { data: existing } = await supabase
      .from("sb_social_posts")
      .select("id")
      .eq("platform", "bluesky")
      .eq("dedup_key", dedupKey)
      .maybeSingle();
    if (existing) continue;

    // Also skip if we posted ANY move alert for this (event, direction) in the last 2h
    // (prevents whipsawing markets from spamming)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data: recentSame } = await supabase
      .from("sb_social_posts")
      .select("id")
      .eq("platform", "bluesky")
      .eq("kind", "move_alert")
      .like("text", `%${a.title}%`)
      .gte("posted_at", twoHoursAgo)
      .limit(1);
    if (recentSame && recentSame.length > 0) continue;

    const text = formatMoveAlert(a, SITE_URL);
    const result = await postBluesky(text);

    await supabase.from("sb_social_posts").upsert({
      platform: "bluesky",
      kind: "move_alert",
      dedup_key: dedupKey,
      text,
      post_uri: result.uri || null,
      post_cid: result.cid || null,
      status: result.ok ? "sent" : (result.skipped ? "skipped" : "failed"),
      error: result.error || result.reason || null,
    }, { onConflict: "platform,dedup_key" });

    postedByEvent.add(eventDir);
    results.push({ ok: result.ok, title: a.title, delta: a.delta, text });
  }

  return res.status(200).json({
    posted: results.length,
    candidates: candidates.length,
    results,
  });
}

import { createClient } from "@supabase/supabase-js";
import { postSocial } from "./_social.js";
import { getBudgetState, alertCanRun } from "./_social_budget.js";
import {
  fetchCandidates, attachContext, passesInsightGate,
  composeSharp, validateTweet,
} from "./_sharp_alert.js";

// SHARP move-alert poster. Replaces the old template-driven cron that fired
// on raw delta — that flow tweeted post-settlement noise (e.g. "Schwarber HR
// market +32% to 99%" after he hit the HR). Now:
//
//   1. Hard filters drop settled / illiquid / mid-game-resolution alerts.
//   2. Cross-source + ladder + volume context is joined per survivor.
//   3. Insight gate requires at least one of: cross-source gap ≥5pp,
//      volume concentration on this ladder rung ≥70%, pre-event drift
//      ≥5pp on liquid market, or ladder consistency violation.
//   4. Claude composes the tweet with full context — no templates.
//   5. Output is validated against forbidden phrases + template fingerprints.
//
// Kill switch: SOCIAL_ALERTS_DISABLED=1 disables this entire path.
//
// GET /api/sports/cron-social-alerts
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const MAX_POSTS_PER_RUN = 1;
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

  if (process.env.SOCIAL_ALERTS_DISABLED === "1") {
    return res.status(200).json({ skipped: "SOCIAL_ALERTS_DISABLED=1" });
  }

  const supabase = getSupabase();
  const budget = await getBudgetState();
  if (!alertCanRun(budget)) {
    return res.status(200).json({ skipped: "out of Make budget", budget });
  }
  const dailySlotsLeft = Math.min(budget.day_remaining - 1, MAX_POSTS_PER_RUN);

  // 1+2. Pull candidates + apply hard filters
  let candidates;
  try {
    candidates = await fetchCandidates({ sinceMin: 60 });
  } catch (e) {
    return res.status(500).json({ error: `fetchCandidates: ${e.message}` });
  }
  if (!candidates.length) {
    return res.status(200).json({ skipped: "no candidates after hard filter", checked: 0 });
  }

  // 3. Attach cross-source + ladder + volume context
  let withCtx;
  try {
    withCtx = await attachContext(candidates);
  } catch (e) {
    return res.status(500).json({ error: `attachContext: ${e.message}` });
  }

  // 4. Insight gate — drop anything without a real signal beyond "% moved"
  const gated = [];
  for (const c of withCtx) {
    const g = passesInsightGate(c);
    if (g.pass) {
      c.insight_reasons = g.reasons;
      gated.push(c);
    }
  }
  // Sort by sharpest signal strength (cross_source_gap magnitude as proxy)
  gated.sort((a, b) => Math.abs(b.cross_source_gap || 0) - Math.abs(a.cross_source_gap || 0));

  if (!gated.length) {
    return res.status(200).json({
      skipped: "no candidates passed insight gate",
      candidates_before_gate: candidates.length,
      candidates_with_context: withCtx.length,
      example_skipped: withCtx.slice(0, 3).map((c) => ({
        contestant: c.market.contestant_label,
        kalshi_now: c.kalshi_now,
        volume: c.kalshi_volume_24h,
      })),
    });
  }

  // 5. Compose via Claude, validate, dedup, post
  const results = [];
  for (const c of gated) {
    if (results.filter((r) => r.posted).length >= dailySlotsLeft) break;

    // Per-event 24h dedup (same as before — avoid spamming same event)
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const eventLink = `/sports/${c.league}/event/${c.event.id}`;
    const { data: recentSame } = await supabase
      .from("sb_social_posts")
      .select("id")
      .eq("platform", "x")
      .eq("kind", "move_alert")
      .like("text", `%${eventLink}%`)
      .gte("posted_at", dayAgo)
      .limit(1);
    if (recentSame?.length) {
      results.push({ contestant: c.market.contestant_label, skipped: "event_dedup_24h" });
      continue;
    }

    const composed = await composeSharp(c, SITE_URL);
    if (!composed.tweet_text) {
      results.push({
        contestant: c.market.contestant_label,
        signals: c.insight_reasons,
        skipped: "Claude returned null",
        reasoning: composed.reasoning,
      });
      continue;
    }
    const vErr = validateTweet(composed.tweet_text);
    if (vErr) {
      results.push({
        contestant: c.market.contestant_label,
        skipped: `validation:${vErr}`,
        attempted_text: composed.tweet_text,
      });
      continue;
    }
    if (composed.confidence < 0.7) {
      results.push({
        contestant: c.market.contestant_label,
        skipped: `confidence_${composed.confidence.toFixed(2)}`,
        attempted_text: composed.tweet_text,
        reasoning: composed.reasoning,
      });
      continue;
    }

    const dedupKey = `sharp:${c.alert_id}`;
    const postRes = await postSocial(composed.tweet_text, { kind: "move_alert", dedup_key: dedupKey });
    for (const { platform, r } of [{ platform: "x", r: postRes.x }, { platform: "bluesky", r: postRes.bluesky }]) {
      await supabase.from("sb_social_posts").upsert({
        platform,
        kind: "move_alert",
        dedup_key: dedupKey,
        text: composed.tweet_text,
        post_uri: r.uri || null,
        post_cid: r.cid || null,
        status: r.ok ? "sent" : (r.skipped ? "skipped" : "failed"),
        error: r.error || r.reason || null,
      }, { onConflict: "platform,dedup_key" });
    }

    results.push({
      contestant: c.market.contestant_label,
      tweet: composed.tweet_text,
      confidence: composed.confidence,
      signals: c.insight_reasons,
      posted: !!postRes.x?.ok,
    });
  }

  return res.status(200).json({
    candidates_before_gate: candidates.length,
    candidates_with_context: withCtx.length,
    gated: gated.length,
    posted: results.filter((r) => r.posted).length,
    budget,
    results,
  });
}

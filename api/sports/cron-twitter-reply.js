import { createClient } from "@supabase/supabase-js";
import { postReply, hasWriteCreds } from "./_twitter.js";
import {
  shouldSkipTweet, replyPassesFilters, generateReply, lookupPlayerStat,
} from "./_reply_gen.js";

// Process unprocessed sb_twitter_seen rows. For each:
//   1. Filter on tweet-level skip patterns (capper sales, giveaways, etc).
//   2. Quick lookup: extract candidate (player, stat) hints from the text
//      via regex; pull our DB market data for them.
//   3. Send tweet (+image if present) + market context to Claude → JSON
//      reply candidate.
//   4. Validate reply (length, numeric anchor, forbidden phrases).
//   5. Apply rate limits (daily total, per-account 24h).
//   6. Post via Twitter API. Write back posted_at + reply_tweet_id.
//
// Cadence: every 15 min, offset 5 min from watch cron.
//
// GET /api/sports/cron-twitter-reply
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 300 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// Cheap regex player-stat hints. We look for known stat words near a
// capitalized "First Last" or "F. Last" token. If nothing matches → empty
// hints array → reply gen still runs but will likely score low.
const STAT_WORDS = [
  "steals","assists","rebounds","points","threes","blocks","turnovers",
  "hits","home runs","hrs","strikeouts","total bases","rbis","runs","singles","doubles",
  "yards","tds","touchdowns","receptions","completions","interceptions",
  "goals","saves","shots","sog",
  "birdies","eagles","top 5","top 10","top 20","make cut",
];
function extractHints(text) {
  const hints = new Set();
  const lower = (text || "").toLowerCase();
  for (const stat of STAT_WORDS) {
    if (!lower.includes(stat)) continue;
    // Pull capitalized name tokens — generous match
    const nameRx = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,2})\b/g;
    let m;
    while ((m = nameRx.exec(text || "")) !== null) {
      // Skip team-name false-positives like "New York", "Los Angeles"
      const n = m[1];
      if (/^(New|Los|San|Las|St|North|South|East|West|Tampa|Kansas|Oklahoma)\b/.test(n)) continue;
      if (n.length < 5) continue;
      hints.add(JSON.stringify({ player: n, stat }));
    }
  }
  return Array.from(hints).slice(0, 6).map((s) => JSON.parse(s));
}

async function getConfig(supabase) {
  const { data } = await supabase.from("sb_twitter_rate_config").select("k, v_int");
  const cfg = {};
  for (const row of data || []) cfg[row.k] = row.v_int;
  return {
    max_replies_per_day: cfg.max_replies_per_day ?? 8,
    min_hours_between_replies_same_account: cfg.min_hours_between_replies_same_account ?? 24,
    min_confidence_to_post: (cfg.min_confidence_to_post ?? 70) / 100,
    min_reply_length_chars: cfg.min_reply_length_chars ?? 60,
    timeline_lookback_minutes: cfg.timeline_lookback_minutes ?? 90,
  };
}

async function dailyRepliesPosted(supabase) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("sb_twitter_seen")
    .select("tweet_id", { count: "exact", head: true })
    .gte("posted_at", since);
  return count ?? 0;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const cfg = await getConfig(supabase);
  const startedAt = new Date().toISOString();
  const summary = {
    started_at: startedAt,
    write_creds: hasWriteCreds(),
    kill_switch: process.env.TWITTER_KILL_SWITCH === "1",
    processed: 0, posted: 0, skipped: 0, shadowed: 0, errored: 0,
    results: [],
  };

  // Daily budget check
  const repliesToday = await dailyRepliesPosted(supabase);
  summary.replies_today = repliesToday;
  summary.daily_remaining = cfg.max_replies_per_day - repliesToday;
  if (summary.daily_remaining <= 0) {
    return res.status(200).json({ ...summary, skipped: "daily reply budget exhausted" });
  }

  // Pull unprocessed tweets within lookback window, prioritize newer
  const sinceTime = new Date(Date.now() - cfg.timeline_lookback_minutes * 60 * 1000).toISOString();
  const { data: tweets, error: qErr } = await supabase
    .from("sb_twitter_seen")
    .select("tweet_id, author_id, author_handle, text, created_at, has_media, media_urls")
    .is("processed_at", null)
    .gte("created_at", sinceTime)
    .order("created_at", { ascending: false })
    .limit(20);
  if (qErr) return res.status(500).json({ error: qErr.message });
  if (!tweets?.length) return res.status(200).json({ ...summary, skipped: "no unprocessed tweets in window" });

  for (const t of tweets) {
    if (summary.daily_remaining <= 0) break;
    summary.processed++;
    const updates = { processed_at: new Date().toISOString() };
    const result = { tweet_id: t.tweet_id, author: t.author_handle };

    // Cheap tweet-level skip filter
    const skipReason = shouldSkipTweet(t.text);
    if (skipReason) {
      updates.reply_status = `skipped:${skipReason}`;
      updates.skip_reason = skipReason;
      await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
      result.outcome = `skip: ${skipReason}`;
      summary.skipped++; summary.results.push(result);
      continue;
    }

    // Per-account rate limit
    const { data: lastReply } = await supabase
      .from("sb_twitter_seen")
      .select("posted_at")
      .eq("author_id", t.author_id)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: false })
      .limit(1);
    if (lastReply?.[0]) {
      const ageH = (Date.now() - new Date(lastReply[0].posted_at).getTime()) / 3600000;
      if (ageH < cfg.min_hours_between_replies_same_account) {
        updates.reply_status = `skipped:account_cooldown_${ageH.toFixed(1)}h`;
        updates.skip_reason = `Posted to ${t.author_handle} ${ageH.toFixed(1)}h ago`;
        await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
        result.outcome = "skip: account cooldown";
        summary.skipped++; summary.results.push(result);
        continue;
      }
    }

    // Quick hints from regex
    const hints = extractHints(t.text);
    const lookups = [];
    for (const h of hints) {
      try {
        const ms = await lookupPlayerStat(h.player, h.stat, 24);
        for (const m of ms) lookups.push(m);
      } catch { /* keep going */ }
    }

    // Generate via Claude
    const gen = await generateReply({
      tweet: {
        text: t.text,
        media_url: (t.media_urls || [])[0] || null,
        author_handle: t.author_handle,
        created_at: t.created_at,
      },
      market_context: lookups,
    });
    updates.parsed_legs = hints.length ? hints : null;
    updates.reply_confidence = gen.confidence;
    updates.reply_reasoning = gen.reasoning;
    updates.reply_text = gen.reply_text;

    if (!gen.reply_text) {
      updates.reply_status = "skipped:no_reply_generated";
      updates.skip_reason = gen.reasoning || "Claude returned null";
      await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
      result.outcome = "skip: no reply"; result.reasoning = gen.reasoning;
      summary.skipped++; summary.results.push(result);
      continue;
    }
    const validationErr = replyPassesFilters(gen.reply_text);
    if (validationErr) {
      updates.reply_status = `skipped:validation_${validationErr}`;
      updates.skip_reason = validationErr;
      await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
      result.outcome = `skip: ${validationErr}`;
      summary.skipped++; summary.results.push(result);
      continue;
    }
    if (gen.confidence < cfg.min_confidence_to_post) {
      updates.reply_status = `skipped:low_confidence_${gen.confidence.toFixed(2)}`;
      updates.skip_reason = `confidence ${gen.confidence.toFixed(2)} < ${cfg.min_confidence_to_post}`;
      await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
      result.outcome = "skip: low confidence"; result.confidence = gen.confidence;
      summary.skipped++; summary.results.push(result);
      continue;
    }

    // POST it
    const postRes = await postReply({
      text: gen.reply_text,
      in_reply_to_tweet_id: t.tweet_id,
    });
    if (postRes.ok) {
      updates.reply_status = "posted";
      updates.reply_tweet_id = postRes.tweet_id;
      updates.posted_at = new Date().toISOString();
      summary.posted++;
      summary.daily_remaining--;
      result.outcome = "POSTED";
      result.reply_text = gen.reply_text;
      result.confidence = gen.confidence;
      // Bump target stats
      await supabase
        .from("sb_twitter_targets")
        .update({
          last_replied_at: updates.posted_at,
          replies_total: 1,  // overwritten below
        })
        .eq("twitter_id", t.author_id);
      // Increment replies_total via raw SQL
      await supabase.rpc("sb_twitter_targets_inc_replies", { tid: t.author_id }).catch(() => {});
    } else if (postRes.skipped) {
      updates.reply_status = `shadow:${postRes.reason}`;
      summary.shadowed++;
      result.outcome = `SHADOW (${postRes.reason})`;
      result.reply_text = gen.reply_text;
      result.confidence = gen.confidence;
    } else {
      updates.reply_status = "failed";
      updates.twitter_error = postRes.error;
      summary.errored++;
      result.outcome = "ERROR";
      result.error = postRes.error;
    }
    await supabase.from("sb_twitter_seen").update(updates).eq("tweet_id", t.tweet_id);
    summary.results.push(result);
  }

  return res.status(200).json(summary);
}

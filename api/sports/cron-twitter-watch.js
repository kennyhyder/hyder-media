import { createClient } from "@supabase/supabase-js";
import { fetchUserTweets, hasReadCreds } from "./_twitter.js";

// Pull recent tweets from every active sb_twitter_targets row + write to
// sb_twitter_seen. Skips replies + retweets (we want original posts).
//
// Cadence: every 15 min. Twitter Basic gives 10k reads/mo; with ~60 active
// targets × 4 fetches/hr × ~3 new tweets per fetch on average = ~4.3k reads/mo.
// since_id is the cheap part — only NEW tweets count toward the limit.
//
// GET /api/sports/cron-twitter-watch
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 300 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!hasReadCreds()) {
    return res.status(503).json({ error: "TWITTER_BEARER_TOKEN not configured" });
  }
  const supabase = getSupabase();

  // Pull active, non-blocklisted targets
  const { data: targets, error: tErr } = await supabase
    .from("sb_twitter_targets")
    .select("twitter_id, handle, category")
    .eq("active", true)
    .eq("blocklist", false);
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!targets?.length) return res.status(200).json({ skipped: "no active targets" });

  const startedAt = new Date().toISOString();
  const results = [];
  let totalNew = 0;
  let rateLimited = false;

  for (const target of targets) {
    if (rateLimited) {
      results.push({ handle: target.handle, skipped: "rate-limited earlier in run" });
      continue;
    }
    // Find latest tweet_id we've already stored for this author
    const { data: latest } = await supabase
      .from("sb_twitter_seen")
      .select("tweet_id")
      .eq("author_id", target.twitter_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const sinceId = latest?.[0]?.tweet_id || null;

    let resp;
    try {
      resp = await fetchUserTweets(target.twitter_id, { maxResults: 10, sinceId });
    } catch (e) {
      results.push({ handle: target.handle, error: e.message });
      continue;
    }
    if (resp.rate_limited) {
      rateLimited = true;
      results.push({ handle: target.handle, skipped: "rate-limited", reset_at: resp.reset_at });
      continue;
    }
    if (!resp.tweets.length) {
      results.push({ handle: target.handle, new_tweets: 0 });
      continue;
    }
    // Drop replies — we want original posts to engage with
    const fresh = resp.tweets.filter((t) => !t.is_reply);
    if (!fresh.length) {
      results.push({ handle: target.handle, new_tweets: 0, filtered: resp.tweets.length });
      continue;
    }
    // Upsert into sb_twitter_seen
    const rows = fresh.map((t) => ({
      tweet_id: t.tweet_id,
      author_id: target.twitter_id,
      author_handle: target.handle,
      text: t.text,
      created_at: t.created_at,
      has_media: t.has_media,
      media_urls: t.media_urls,
      is_reply: t.is_reply,
      is_quote: t.is_quote,
    }));
    const { error: insErr, count } = await supabase
      .from("sb_twitter_seen")
      .upsert(rows, { onConflict: "tweet_id", ignoreDuplicates: true, count: "exact" });
    if (insErr) {
      results.push({ handle: target.handle, error: `upsert: ${insErr.message}` });
      continue;
    }
    totalNew += rows.length;
    results.push({ handle: target.handle, new_tweets: rows.length });
  }

  return res.status(200).json({
    started_at: startedAt,
    targets_checked: targets.length,
    total_new_tweets: totalNew,
    rate_limited: rateLimited,
    results: results.slice(0, 60),
  });
}

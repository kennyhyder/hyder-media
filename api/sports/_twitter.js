// Twitter / X API v2 client for the auto-reply system.
//
// READ (timeline pulls) uses App-only Bearer Token (TWITTER_BEARER_TOKEN).
// WRITE (post reply) uses OAuth 1.0a User Context — requires 4 env vars
// from the @sportsbookish app's "Keys & Tokens" page:
//   TWITTER_API_KEY            (Consumer Key)
//   TWITTER_API_SECRET         (Consumer Secret)
//   TWITTER_ACCESS_TOKEN       (Access Token for @sportsbookish)
//   TWITTER_ACCESS_TOKEN_SECRET (Access Token Secret for @sportsbookish)
//
// If WRITE creds are missing the system runs in SHADOW MODE — generates +
// scores replies but doesn't actually post. Useful for tuning the scoring
// model without burning brand reputation.
//
// Kill switch: TWITTER_KILL_SWITCH=1 disables ALL posting (read still runs
// so the audit log keeps building; flip to 0 to resume).
//
// API tier required: Basic ($200/mo). Free tier doesn't include /2/users/:id/tweets
// reads.

import crypto from "node:crypto";

const TW_BASE = "https://api.twitter.com";

// ---- READ side ----

export function hasReadCreds() {
  return Boolean(process.env.TWITTER_BEARER_TOKEN);
}

// Fetch the most recent N tweets for a single user. Returns array of
// normalized tweet objects.
//
// Twitter API v2 /2/users/:id/tweets — Basic tier gives ~10k reads/mo. Use
// max_results=10 and only call for each target every 15-30 min.
export async function fetchUserTweets(twitterId, { maxResults = 10, sinceId = null } = {}) {
  if (!hasReadCreds()) throw new Error("TWITTER_BEARER_TOKEN missing");
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 5), 100)),
    "tweet.fields": "created_at,attachments,referenced_tweets,public_metrics,entities",
    "expansions": "attachments.media_keys",
    "media.fields": "url,preview_image_url,type",
    exclude: "retweets",
  });
  if (sinceId) params.set("since_id", sinceId);
  const url = `${TW_BASE}/2/users/${twitterId}/tweets?${params.toString()}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN.trim()}`,
      "User-Agent": "sportsbookish-reply-bot/1.0",
    },
  });
  if (r.status === 429) {
    // Rate limited — return empty with retry-after hint
    return { tweets: [], rate_limited: true, reset_at: r.headers.get("x-rate-limit-reset") };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Twitter /users/:id/tweets ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  const mediaById = new Map((data.includes?.media || []).map((m) => [m.media_key, m]));
  const tweets = (data.data || []).map((t) => {
    const mediaKeys = t.attachments?.media_keys || [];
    const mediaUrls = mediaKeys.map((k) => {
      const m = mediaById.get(k);
      return m?.url || m?.preview_image_url || null;
    }).filter(Boolean);
    const refs = t.referenced_tweets || [];
    return {
      tweet_id: t.id,
      text: t.text || "",
      created_at: t.created_at,
      has_media: mediaUrls.length > 0,
      media_urls: mediaUrls,
      is_reply: refs.some((r) => r.type === "replied_to"),
      is_quote: refs.some((r) => r.type === "quoted"),
      metrics: t.public_metrics || null,
      entities: t.entities || null,
    };
  });
  return { tweets, rate_limited: false };
}

// Resolve a handle to a user_id. Used by the seed script. Cheap (1 read).
export async function resolveHandle(handle) {
  if (!hasReadCreds()) throw new Error("TWITTER_BEARER_TOKEN missing");
  const cleanHandle = handle.replace(/^@/, "");
  const r = await fetch(`${TW_BASE}/2/users/by/username/${cleanHandle}?user.fields=public_metrics`, {
    headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN.trim()}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Twitter resolve ${cleanHandle} ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  if (!d.data) throw new Error(`Handle not found: ${cleanHandle}`);
  return {
    twitter_id: d.data.id,
    handle: d.data.username,
    follower_count: d.data.public_metrics?.followers_count || 0,
  };
}

// ---- WRITE side (OAuth 1.0a — Twitter still requires this for POST /2/tweets
// in many tier configs; works for both Basic and Free) ----

export function hasWriteCreds() {
  return Boolean(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_TOKEN_SECRET
  );
}

function percentEncode(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// OAuth 1.0a signature for POST /2/tweets. Body is JSON but OAuth signs
// only the URL + the oauth_ params (NOT the JSON body for v2 endpoints).
function oauth1Header(method, url) {
  const consumerKey = process.env.TWITTER_API_KEY.trim();
  const consumerSecret = process.env.TWITTER_API_SECRET.trim();
  const token = process.env.TWITTER_ACCESS_TOKEN.trim();
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET.trim();

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: "1.0",
  };

  // Signature base string
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  return "OAuth " + Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");
}

// Post a reply via Twitter API v2. Returns { ok, tweet_id?, error? }.
export async function postReply({ text, in_reply_to_tweet_id }) {
  if (process.env.TWITTER_KILL_SWITCH === "1") {
    return { ok: false, skipped: true, reason: "TWITTER_KILL_SWITCH=1" };
  }
  if (!hasWriteCreds()) {
    return { ok: false, skipped: true, reason: "TWITTER_API_* creds missing — shadow mode" };
  }
  if (!text || !in_reply_to_tweet_id) {
    return { ok: false, error: "text + in_reply_to_tweet_id required" };
  }
  // X reply payload (v2). The reply.in_reply_to_tweet_id field is what
  // makes the new tweet show up under the original instead of as a top-
  // level tweet.
  const url = `${TW_BASE}/2/tweets`;
  const body = JSON.stringify({
    text: text.length > 280 ? text.slice(0, 277) + "..." : text,
    reply: { in_reply_to_tweet_id },
  });
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: oauth1Header("POST", url),
        "Content-Type": "application/json",
        "User-Agent": "sportsbookish-reply-bot/1.0",
      },
      body,
    });
    const respText = await r.text();
    if (!r.ok) {
      return { ok: false, error: `${r.status}: ${respText.slice(0, 300)}` };
    }
    const parsed = JSON.parse(respText);
    return { ok: true, tweet_id: parsed.data?.id || null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// Sharp reply generation via Claude. Two-pass:
//
// 1) PARSE — extract any betting "facts" from the tweet (text + first
//    media image): players, stats, lines, odds, books. If we can't parse,
//    bail early — no reply.
// 2) LOOKUP — for each parsed leg, query our Kalshi/books data for the
//    current implied probability + recent movement.
// 3) DRAFT — Claude composes a reply that's grounded in those lookups.
//    It returns JSON with reply_text + confidence + reasoning. If
//    confidence < threshold or the reply doesn't contain a concrete number,
//    we skip.
//
// Hard rules (encoded in the system prompt + post-validated):
//   - Never sycophantic ("great pick", "love this", "💰💰")
//   - Never claim a position ("I'm on this too")
//   - Always lead with a concrete number (% / pp / dollars / american odds)
//   - No link unless we explicitly compute one referencing the same market
//   - Max 240 chars (leaves room for engagement decoration)
//   - Skip when tweet text is mocking a losing slip, asking for picks, or
//     selling a service

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

// Forbidden patterns in the generated reply text — if any match, drop the
// reply rather than post it. Belt-and-suspenders since the system prompt
// also forbids them.
const FORBIDDEN_PATTERNS = [
  /great pick/i,
  /love this/i,
  /tail/i,
  /i'?m on this/i,
  /\b(let'?s go|lfg)\b/i,
  /\b(lock|smash|hammer)\b/i,
  /\bjuice\b.*\bright\b/i,           // "the juice is right" tout phrasing
  /💰💰|🚀🚀|🔥🔥/,                    // emoji spam
  /check out (my|our) (site|tool|app)/i,
  /sign up/i,
];

// Hard skip-the-tweet patterns. These tweets are not worth replying to
// regardless of whether we have data:
//   - Pure result posts (already settled, no edge available)
//   - Pick-sales / Discord funnels
//   - Sycophancy bait
const TWEET_SKIP_PATTERNS = [
  /\b(discord|telegram)\b.*\b(join|link|free)\b/i,
  /\b(plays?|picks?)\b.*\b(in|on)\s+(bio|profile|comments?)\b/i,
  /\b(promo\s+code|use\s+code)\b/i,
  /\bdubclub|whop|underdog\s+code\b/i,
  /\$\d+\s+(giving away|giveaway|venmo|cashapp)/i,
  /\b(rt|like)\s+(this|to)\b.*\b(enter|win|free)\b/i,
  /^great catch/i,                  // our own bot's previous reply pattern, don't loop
];

export function shouldSkipTweet(text) {
  const t = text || "";
  for (const p of TWEET_SKIP_PATTERNS) {
    if (p.test(t)) return `tweet matches skip pattern ${p.source.slice(0, 30)}`;
  }
  // Very short tweets are usually emoji reactions, not bet content
  if (t.trim().length < 20) return "tweet too short";
  return null;
}

export function replyPassesFilters(replyText) {
  if (!replyText || replyText.length < 50) return "too short";
  if (replyText.length > 270) return "too long";
  // Must contain a numeric anchor (%, +/-NNN, $, "pp", "ev")
  if (!/(\d+%|\d+\s*pp|\+\d+|-\d+|\d+¢|\d+\s*cents|\bev\b)/i.test(replyText)) {
    return "no concrete numeric anchor";
  }
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(replyText)) return `forbidden phrase: ${p.source}`;
  }
  return null;
}

// ---- Lookup helpers: query our own DB for relevant market data ----

import { createClient } from "@supabase/supabase-js";
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Look up market data for a {player, stat, threshold?} hint. Returns the
// freshest Kalshi probability + books median + recent movement, or null if
// we don't track the market.
//
// Coarse matching: pull all markets where contestant_label ILIKE the player
// AND the parent event title hints at the stat. This is intentionally loose
// — we trust Claude to verify relevance in the next pass.
export async function lookupPlayerStat(player, stat, hoursBack = 24) {
  if (!player || !stat) return [];
  const supabase = getSupabase();
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  // Players appear as contestant_label on sports_markets; events titled
  // with the stat (e.g. "New York at Cleveland: Steals"). Combine them.
  const { data: markets } = await supabase
    .from("sports_markets")
    .select(`
      id, contestant_label, point,
      event:sports_events(id, title, event_type, start_time, status, slug, season_year, league)
    `)
    .ilike("contestant_label", `%${player}%`)
    .limit(40);

  if (!markets?.length) return [];

  // Filter to markets whose parent event title contains the stat
  const statRx = new RegExp(stat.replace(/[^a-z0-9]/gi, ""), "i");
  const matched = markets.filter((m) =>
    m.event && statRx.test((m.event.title || "").replace(/[^a-z0-9]/gi, ""))
  );
  if (!matched.length) return [];

  const marketIds = matched.map((m) => m.id);
  // Latest Kalshi quotes per market
  const { data: latestKalshi } = await supabase
    .from("sports_quotes_latest")
    .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
    .in("market_id", marketIds);

  // Reference quote for movement: 4h ago
  const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const refByMarket = new Map();
  for (const mid of marketIds) {
    const { data } = await supabase
      .from("sports_quotes")
      .select("implied_prob, fetched_at")
      .eq("market_id", mid)
      .lte("fetched_at", fourHoursAgo)
      .order("fetched_at", { ascending: false })
      .limit(1);
    if (data?.[0]) refByMarket.set(mid, data[0]);
  }

  const kalshiByMarket = new Map((latestKalshi || []).map((q) => [q.market_id, q]));

  return matched.map((m) => {
    const k = kalshiByMarket.get(m.id);
    const ref = refByMarket.get(m.id);
    return {
      market_id: m.id,
      contestant: m.contestant_label,
      point: m.point,
      event: m.event,
      kalshi_now: k?.implied_prob ?? null,
      kalshi_yes_bid: k?.yes_bid ?? null,
      kalshi_yes_ask: k?.yes_ask ?? null,
      kalshi_4h_ago: ref?.implied_prob ?? null,
      kalshi_delta_4h: k?.implied_prob != null && ref?.implied_prob != null
        ? Number((k.implied_prob - ref.implied_prob).toFixed(4))
        : null,
      kalshi_fresh_min: k?.fetched_at
        ? Math.round((Date.now() - new Date(k.fetched_at).getTime()) / 60000)
        : null,
    };
  });
}

// ---- Claude generation ----

const SYSTEM_PROMPT = `You write sharp, brief replies to sports-betting tweets on behalf of @sportsbookish — a tool that compares Kalshi (event-contracts exchange) to US sportsbooks + Polymarket.

Your reply is GROUNDED in real data we provide you. If you can't ground it, return reply_text = null. Never invent numbers.

Voice:
- Quant peer, not promoter
- Always lead with a concrete number (Kalshi implied %, pp delta, american odds, ¢)
- Direct, no hype, no emojis except sparingly (max 1)
- Match the brevity of the original — usually 1-2 short sentences

Hard NO:
- Never sycophantic ("great pick", "love this", "tail this")
- Never claim a position ("I'm on it too", "I have this")
- Never sell anything ("check out our tool", "sign up")
- Never reply to losing-slip mockery or to capper pick-selling threads — return reply_text = null
- Never use emojis like 💰 🚀 🔥 multiple times
- Never use the words "lock", "smash", "hammer", "lfg"
- Never link unless we provide an explicit relevant URL in the context

Confidence rubric (0.0-1.0):
- 0.9+: precise pp/¢/% number on this exact market + non-obvious context (ladder rung movement, EV vs the odds in the slip, recent steam)
- 0.75-0.89: relevant Kalshi number on a directly related market
- 0.6-0.74: tangentially relevant but adds context
- <0.6: skip — return reply_text = null

Output format (JSON only, no prose around it):
{
  "reply_text": "string or null",
  "confidence": 0.0,
  "reasoning": "one sentence why you chose this reply or why you skipped"
}`;

// Generate a reply. tweet = { text, media_url, author_handle, created_at }.
// market_context = array of lookup results (may be empty).
// Returns { reply_text, confidence, reasoning } or { reply_text: null, ... }.
export async function generateReply({ tweet, market_context = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { reply_text: null, confidence: 0, reasoning: "ANTHROPIC_API_KEY missing" };
  }

  // Build a compact data block. Trim aggressively — Claude doesn't need
  // every field, just the numbers that matter.
  const contextBlock = market_context.slice(0, 6).map((m) => {
    const parts = [
      `event: ${m.event?.title || ""} [${m.event?.event_type || ""}]`,
      `contestant: ${m.contestant}`,
      m.point != null ? `point: ${m.point}` : null,
      m.kalshi_now != null ? `kalshi_now: ${(m.kalshi_now * 100).toFixed(1)}%` : null,
      m.kalshi_yes_bid != null && m.kalshi_yes_ask != null
        ? `kalshi_bid_ask: ${(m.kalshi_yes_bid * 100).toFixed(0)}¢ / ${(m.kalshi_yes_ask * 100).toFixed(0)}¢`
        : null,
      m.kalshi_delta_4h != null
        ? `4h_delta: ${m.kalshi_delta_4h >= 0 ? "+" : ""}${(m.kalshi_delta_4h * 100).toFixed(1)}pp`
        : null,
      m.kalshi_fresh_min != null ? `freshness_min: ${m.kalshi_fresh_min}` : null,
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");

  const userBlock = [
    `Tweet author: @${tweet.author_handle}`,
    `Tweet text:\n${tweet.text}`,
    tweet.media_url ? `Has media: ${tweet.media_url}` : "Has media: no",
    "",
    "Market context (from our Kalshi/books index):",
    contextBlock || "(no related markets in our index)",
  ].join("\n");

  const messages = [{ role: "user", content: userBlock }];
  // If there's media, include it for ladder/leg parsing
  if (tweet.media_url) {
    try {
      // Download + base64 the image so Claude can see it
      const imgResp = await fetch(tweet.media_url);
      if (imgResp.ok) {
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const mediaType = imgResp.headers.get("content-type") || "image/jpeg";
        messages[0].content = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
          { type: "text", text: userBlock },
        ];
      }
    } catch { /* skip image on download failure */ }
  }

  try {
    const r = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY.trim(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { reply_text: null, confidence: 0, reasoning: `Claude ${r.status}: ${body.slice(0, 150)}` };
    }
    const data = await r.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    if (!textBlock) return { reply_text: null, confidence: 0, reasoning: "no text content from Claude" };

    // Extract JSON from response (sometimes wrapped in markdown ```json blocks)
    let jsonStr = textBlock.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1];
    else {
      const firstBrace = jsonStr.indexOf("{");
      const lastBrace = jsonStr.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
    }
    const parsed = JSON.parse(jsonStr);
    return {
      reply_text: parsed.reply_text ?? null,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      reasoning: parsed.reasoning || "",
    };
  } catch (e) {
    return { reply_text: null, confidence: 0, reasoning: `gen error: ${e.message}` };
  }
}

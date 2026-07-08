// Sharp-alert pipeline for @sportsbookish move tweets.
//
// REPLACES the dumb "📈 +24% move!" template flow. The old detector fired
// on raw delta and posted as soon as 7% was crossed. Result: most tweets
// were post-settlement noise (player hits a HR → 1+HR market jumps to 99%
// → bot tweets "Schwarber +32% on Kalshi" as if the market discovered
// something). Embarrassing.
//
// New pipeline:
//
//   1. PULL CANDIDATES — last 60 min of sports_alerts above 5% delta.
//
//   2. HARD FILTERS — drop anything that:
//      - kalshi_now ∉ (0.18, 0.82)    [post-settlement / pre-resolution]
//      - kalshi_volume_24h < 250      [illiquid; one trader noise]
//      - delta same-direction as settlement extreme
//      - event already in progress AND prop is "first-occurrence" stat
//        (1+ hits, 1+ steals, etc — these settle mid-game on the first
//        play and the % move is just confirmation)
//
//   3. CONTEXT JOIN — for every survivor, attach:
//      - Cross-source: books_median, polymarket_now (same event/market)
//      - Volume: 24h volume on this rung
//      - Ladder: same player + same stat, all rungs, with their volumes
//      - Pre-event delta: 4h ago vs now
//
//   4. INSIGHT GATE — must have AT LEAST ONE of:
//      - Cross-source disagreement ≥ 5pp (Kalshi vs books_median)
//      - Volume concentration (this rung carries >70% of ladder volume)
//      - Pre-event move with no obvious news catalyst
//      - Adjacent-rung mispricing (ladder consistency violation)
//
//   5. COMPOSE — Claude writes the tweet given the full context.
//      System prompt enforces: lead with the insight, not the move.
//      No "📈 Move alert" templates. No emoji headers.
//
//   6. POST.

import { createClient } from "@supabase/supabase-js";

export const HARD_NOW_MIN = 0.18;
export const HARD_NOW_MAX = 0.82;
export const MIN_VOLUME_24H = 250;
export const MIN_DELTA = 0.05;
export const INSIGHT_CROSS_SOURCE_GAP = 0.05;
export const INSIGHT_VOLUME_CONCENTRATION = 0.70;

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// First-occurrence prop patterns that resolve mid-event on a single play.
// When the event is in-progress, skip these — the move is just settlement.
const FIRST_OCCURRENCE_PATTERNS = [
  /\b1\+\s*(hit|home run|hr|steal|block|assist|reception|td|touchdown|sack|interception|goal|save|birdie|eagle)\b/i,
  /\bfirst\s+(hit|home run|hr|td|touchdown|goal|score)\b/i,
  /\bany\s+(home run|hr|td|touchdown)\b/i,
  /\bto\s+(hit|record|score|get)\s+(a|an|1)\b/i,
];

function isFirstOccurrenceProp(eventTitle, contestantLabel) {
  const combined = `${eventTitle || ""} | ${contestantLabel || ""}`;
  return FIRST_OCCURRENCE_PATTERNS.some((rx) => rx.test(combined));
}

// Stat family extracted from event title — used for ladder grouping.
// e.g. "Houston vs Texas: Hits" → "hits". Returns null if unmatched (e.g. game ML).
const STAT_PATTERNS = {
  hits: /\bhits?\b/i,
  home_runs: /\bhome\s*runs?\b|\bhrs?\b/i,
  steals: /\bsteals?\b/i,
  rebounds: /\brebounds?\b/i,
  assists: /\bassists?\b/i,
  points: /\bpoints?\b/i,
  threes: /\bthrees?\b|\b3\s*ptr\b|\b3\s*pt\b/i,
  blocks: /\bblocks?\b/i,
  total_bases: /\btotal\s+bases?\b/i,
  strikeouts: /\bstrikeouts?\b|\bks?\b/i,
  receptions: /\breceptions?\b/i,
  yards: /\byards?\b/i,
};
function statFamily(eventTitle) {
  if (!eventTitle) return null;
  for (const [k, rx] of Object.entries(STAT_PATTERNS)) {
    if (rx.test(eventTitle)) return k;
  }
  return null;
}

// ---- Step 1 + 2: pull + hard-filter candidates ----

export async function fetchCandidates({ sinceMin = 60 } = {}) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - sinceMin * 60000).toISOString();
  // Pull movement alerts with attached event + market info
  const { data: alerts } = await supabase
    .from("sports_alerts")
    .select(`
      id, league, event_id, market_id, alert_type, direction, delta,
      kalshi_prob_now, kalshi_prob_baseline, baseline_minutes_ago, fired_at,
      sports_events!inner(id, title, status, start_time, league, slug, season_year, event_type),
      sports_markets!inner(id, contestant_label, prop_line, prop_side, contestant_id)
    `)
    .eq("alert_type", "movement")
    .gte("fired_at", since)
    .order("fired_at", { ascending: false })
    .limit(120);
  if (!alerts?.length) return [];

  const candidates = [];
  for (const a of alerts) {
    const e = a.sports_events;
    const m = a.sports_markets;
    if (!e || !m) continue;

    // Hard 1: not in extreme zones
    if (a.kalshi_prob_now == null) continue;
    if (a.kalshi_prob_now < HARD_NOW_MIN || a.kalshi_prob_now > HARD_NOW_MAX) continue;

    // Hard 2: delta must be at least MIN_DELTA
    if (Math.abs(a.delta) < MIN_DELTA) continue;

    // Hard 3: first-occurrence props that are likely mid-event settlements
    const eventStarted = e.start_time ? new Date(e.start_time).getTime() <= Date.now() : true;
    if (eventStarted && isFirstOccurrenceProp(e.title, m.contestant_label)) continue;

    // Hard 4: event status must still be "open"
    if (e.status !== "open") continue;

    candidates.push({
      alert_id: a.id,
      league: a.league,
      event: e,
      market: m,
      kalshi_now: a.kalshi_prob_now,
      kalshi_was: a.kalshi_prob_baseline,
      delta: a.delta,
      baseline_minutes_ago: a.baseline_minutes_ago,
      fired_at: a.fired_at,
      direction: a.direction,
      stat_family: statFamily(e.title),
    });
  }
  return candidates;
}

// ---- Step 3: context join — volume + cross-source + ladder ----

export async function attachContext(candidates) {
  if (!candidates.length) return [];
  const supabase = getSupabase();
  const marketIds = Array.from(new Set(candidates.map((c) => c.market.id)));
  const eventIds = Array.from(new Set(candidates.map((c) => c.event.id)));

  // Latest Kalshi quote with volume
  const { data: latestK } = await supabase
    .from("sports_quotes_latest")
    .select("market_id, implied_prob, yes_bid, yes_ask, volume, fetched_at")
    .in("market_id", marketIds);
  const kByMarket = new Map((latestK || []).map((r) => [r.market_id, r]));

  // Latest book consensus per market (from sports_book_quotes — pivot to median)
  const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: bookRows } = await supabase
    .from("sports_book_quotes")
    .select("sports_event_id, contestant_norm, implied_prob_novig, book, fetched_at")
    .in("sports_event_id", eventIds)
    .gte("fetched_at", since24h);
  const bookKey = (eventId, contestantLabel) => `${eventId}|${(contestantLabel || "").toLowerCase().replace(/[^a-z]/g, "")}`;
  const booksByKey = new Map();
  for (const r of bookRows || []) {
    if (r.implied_prob_novig == null) continue;
    const key = `${r.sports_event_id}|${(r.contestant_norm || "").toLowerCase().replace(/[^a-z]/g, "")}`;
    if (!booksByKey.has(key)) booksByKey.set(key, []);
    booksByKey.get(key).push(r);
  }

  // Latest Polymarket quote per event (poly is event-level, not market-level for many)
  const { data: polyRows } = await supabase
    .from("sports_polymarket_quotes")
    .select("sports_event_id, contestant_label, implied_prob, volume_usd, fetched_at")
    .in("sports_event_id", eventIds)
    .gte("fetched_at", since24h);
  const polyByKey = new Map();
  for (const r of polyRows || []) {
    const key = `${r.sports_event_id}|${(r.contestant_label || "").toLowerCase().replace(/[^a-z]/g, "")}`;
    const existing = polyByKey.get(key);
    if (!existing || new Date(r.fetched_at) > new Date(existing.fetched_at)) {
      polyByKey.set(key, r);
    }
  }

  // 4h-ago Kalshi for pre-event move context
  const fourHoursAgo = new Date(Date.now() - 4 * 3600000).toISOString();
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

  // Ladder context: for player props with prop_line, pull ALL rungs of same player+stat
  const ladderByMarket = new Map();
  for (const c of candidates) {
    if (!c.market.contestant_id || !c.stat_family) continue;
    const { data: rungs } = await supabase
      .from("sports_markets")
      .select(`
        id, contestant_label, prop_line, prop_side,
        sports_events!inner(id, title),
        sports_quotes_latest(market_id, implied_prob, volume)
      `)
      .eq("contestant_id", c.market.contestant_id)
      .not("prop_line", "is", null)
      .limit(30);
    if (!rungs) continue;
    // Filter to same stat family by event title
    const sameStat = rungs.filter((r) => statFamily(r.sports_events?.title) === c.stat_family);
    if (sameStat.length <= 1) continue;
    const cleaned = sameStat.map((r) => {
      const q = Array.isArray(r.sports_quotes_latest) ? r.sports_quotes_latest[0] : r.sports_quotes_latest;
      return {
        market_id: r.id,
        prop_line: r.prop_line,
        prop_side: r.prop_side,
        prob: q?.implied_prob ?? null,
        volume_24h: q?.volume ?? null,
      };
    }).sort((a, b) => Number(a.prop_line) - Number(b.prop_line));
    ladderByMarket.set(c.market.id, cleaned);
  }

  return candidates.map((c) => {
    const k = kByMarket.get(c.market.id);
    const cKey = bookKey(c.event.id, c.market.contestant_label);
    const books = booksByKey.get(cKey) || [];
    const bookProbs = books.map((b) => Number(b.implied_prob_novig)).filter((n) => Number.isFinite(n));
    bookProbs.sort((a, b) => a - b);
    const books_median = bookProbs.length
      ? (bookProbs.length % 2 ? bookProbs[(bookProbs.length - 1) / 2] : (bookProbs[bookProbs.length / 2 - 1] + bookProbs[bookProbs.length / 2]) / 2)
      : null;
    const poly = polyByKey.get(cKey) || null;
    const ref = refByMarket.get(c.market.id);
    const ladder = ladderByMarket.get(c.market.id) || null;

    const ladderVolTotal = ladder?.reduce((s, r) => s + (Number(r.volume_24h) || 0), 0) || 0;
    const thisVol = Number(k?.volume || 0);
    const volume_share = ladderVolTotal > 0 ? thisVol / ladderVolTotal : null;

    return {
      ...c,
      kalshi_volume_24h: thisVol,
      kalshi_yes_bid: k?.yes_bid ?? null,
      kalshi_yes_ask: k?.yes_ask ?? null,
      kalshi_freshness_min: k?.fetched_at ? Math.round((Date.now() - new Date(k.fetched_at).getTime()) / 60000) : null,
      books_median,
      book_count: bookProbs.length,
      cross_source_gap: books_median != null ? c.kalshi_now - books_median : null,
      polymarket_now: poly ? Number(poly.implied_prob) : null,
      polymarket_volume_usd: poly ? Number(poly.volume_usd) : null,
      kalshi_4h_ago: ref?.implied_prob ?? null,
      kalshi_4h_delta: ref?.implied_prob != null ? c.kalshi_now - Number(ref.implied_prob) : null,
      ladder,
      volume_share_of_ladder: volume_share,
    };
  });
}

// ---- Step 4: insight gate ----

export function passesInsightGate(c) {
  // Volume floor — only apply when we have meaningful volume data.
  // sports_quotes_latest.volume is currently null/0 for the entire table
  // (Kalshi ingest mapping issue — separate fix). Treating that as "fail"
  // would block every tweet forever. So: if volume > 0, enforce the floor;
  // if volume is 0/null/unknown, fall through to the other signal gates.
  if (c.kalshi_volume_24h > 0 && c.kalshi_volume_24h < MIN_VOLUME_24H) {
    return { pass: false, reason: `volume too low (${c.kalshi_volume_24h})` };
  }

  const reasons = [];
  // (A) Cross-source disagreement
  if (c.cross_source_gap != null && Math.abs(c.cross_source_gap) >= INSIGHT_CROSS_SOURCE_GAP) {
    reasons.push(`cross_source_gap=${(c.cross_source_gap * 100).toFixed(1)}pp`);
  }
  // (B) Polymarket disagreement
  if (c.polymarket_now != null && Math.abs(c.polymarket_now - c.kalshi_now) >= INSIGHT_CROSS_SOURCE_GAP) {
    reasons.push(`poly_gap=${((c.polymarket_now - c.kalshi_now) * 100).toFixed(1)}pp`);
  }
  // (C) Volume concentration: this rung carries most of the ladder volume
  if (c.volume_share_of_ladder != null && c.volume_share_of_ladder >= INSIGHT_VOLUME_CONCENTRATION) {
    reasons.push(`vol_concentration=${(c.volume_share_of_ladder * 100).toFixed(0)}%`);
  }
  // (D) Pre-event move >5pp in 4h on liquid market
  const eventStarted = c.event.start_time ? new Date(c.event.start_time).getTime() <= Date.now() : false;
  if (!eventStarted && c.kalshi_4h_delta != null && Math.abs(c.kalshi_4h_delta) >= 0.05 && c.kalshi_volume_24h >= 500) {
    reasons.push(`pre_event_drift=${(c.kalshi_4h_delta * 100).toFixed(1)}pp`);
  }
  // (E) Ladder consistency violation — adjacent rung has higher prob despite stricter threshold
  if (c.ladder && c.ladder.length >= 2 && c.market.prop_line != null) {
    for (let i = 0; i < c.ladder.length - 1; i++) {
      const a = c.ladder[i], b = c.ladder[i + 1];
      // For "over" props, higher line should have LOWER prob. If violated → mispricing.
      if (c.market.prop_side === "over" && a.prob != null && b.prob != null && b.prob > a.prob + 0.03) {
        reasons.push(`ladder_violation:${a.prop_line}=${(a.prob*100).toFixed(0)}<${b.prop_line}=${(b.prob*100).toFixed(0)}`);
        break;
      }
    }
  }

  if (reasons.length === 0) return { pass: false, reason: "no insight signal" };
  return { pass: true, reasons };
}

// ---- Step 5: Claude-driven sharp composer ----

// ============================================================
// MARKET-STRUCTURE LENS LIBRARY
// ============================================================
//
// Curated explanations of WHY a particular data pattern shows up in
// betting markets. The composer picks the most relevant lens for the
// triggered signal + market state and weaves a 1-sentence structural
// note into the tweet. Elevates output from "look at this number" to
// "look at this number AND here's the microstructure reason it exists" —
// the difference between a data-bot post and a peer-trader post.
//
// Each lens has: a `key` (for selection logic), an `applies_when`
// predicate function over context, and a `frame` string with the
// crisp 1-sentence claim. The composer picks the highest-priority
// applicable lens and includes its frame as guidance.
export const STRUCTURE_LENSES = [
  {
    key: "settlement_risk_in_play",
    priority: 10,
    applies_when: (c) => c.event_started === true && (c.kalshi_yes_ask_cents - c.kalshi_yes_bid_cents) >= 4,
    frame: "Mid-game Kalshi lines carry a settlement-risk premium that sportsbook lines don't — cancellation/suspension risk gets baked in once leverage shifts. The exchange isn't just pricing outcome, it's pricing payout-reliability too.",
  },
  {
    key: "leverage_shift_drift",
    priority: 9,
    applies_when: (c) => c.event_started === true && Math.abs(c.kalshi_4h_delta_pp || 0) >= 5 && c.kalshi_volume_24h >= 1000,
    frame: "Mid-game drift on liquid markets reflects both score state AND leverage exit — once a side's contracts go deep, holders pay a discount to unwind. The line moves more than the win probability strictly justifies.",
  },
  {
    key: "books_lag_sharp_money",
    priority: 8,
    applies_when: (c) => c.event_started === false && Math.abs(c.cross_source_gap_pp || 0) >= 6 && c.kalshi_volume_24h >= 500,
    frame: "Books target balanced action; Kalshi targets fair price. When the exchange has moved on volume but the book consensus hasn't, sharp money has located the right side faster than the bookmaker's risk desk has reacted.",
  },
  {
    key: "ladder_volume_concentration",
    priority: 7,
    applies_when: (c) => (c.volume_share_of_ladder_pct || 0) >= 70 && c.ladder?.length >= 3,
    frame: "Volume concentration on one threshold means price discovery is happening there alone — adjacent rungs trade light enough that their prices are statistical noise, not signal.",
  },
  {
    key: "ladder_consistency_violation",
    priority: 7,
    applies_when: (c) => (c.insight_signals || []).some((s) => String(s).startsWith("ladder_violation")),
    frame: "Adjacent ladder rungs failing the monotonicity check (T20 ≤ T10 prob) is a pure market-maker mistake, not a real signal — but real enough to arb if liquidity supports it.",
  },
  {
    key: "polymarket_vs_kalshi_divergence",
    priority: 6,
    applies_when: (c) => c.polymarket_pct != null && Math.abs((c.polymarket_pct - c.kalshi_now_pct)) >= 5,
    frame: "Kalshi/Polymarket disagreements of this size are unusual — both are CFTC-regulated peer-to-peer exchanges, so the gap is liquidity-induced (one venue has thinner activity) more than information-induced.",
  },
  {
    key: "early_pregame_consensus_lag",
    priority: 5,
    applies_when: (c) => c.event_started === false && Math.abs(c.cross_source_gap_pp || 0) >= 5,
    frame: "Pre-event gaps this wide usually close in the final 60 min before tip as books reprice on closing volume. The exchange tends to anchor closer to the true number earlier in the cycle.",
  },
  {
    key: "default_no_lens",
    priority: 0,
    applies_when: () => true,
    frame: "",
  },
];

function pickLens(context) {
  const candidates = STRUCTURE_LENSES.filter((l) => {
    try { return l.applies_when(context); }
    catch { return false; }
  });
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

const COMPOSER_SYSTEM = `You write betting-market analysis tweets for @sportsbookish. Voice: quant peer who actually understands market microstructure — not a data-bot reading off numbers.

You'll get JSON with one market move + its full context (Kalshi price, cross-source comparison vs sportsbook fair, Polymarket, volume on this rung, the ladder of related rungs, and what insight signal triggered this candidate). You'll ALSO get a "structure_lens" field with a 1-sentence frame explaining WHY this pattern shows up — settlement risk, leverage exit, books-lag-sharp-money, ladder volume concentration, etc.

Hard rules:
- NEVER announce the move as the headline. Lead with the INSIGHT.
- WEAVE the structural lens into your tweet when it's non-empty. The lens tells the READER why the data matters — it's the difference between reporting and analysis. Do not copy the lens verbatim; integrate its concept naturally into your tweet as the second sentence (or as a sentence-fragment trailing the data).
- NEVER use templated emoji-header structures like "📈 Move alert" or "🔴 Heads up". One emoji max anywhere.
- NEVER use words: "lock", "smash", "hammer", "lfg", "tail", "watching", "live", "fade"
- Lead with a concrete number (¢, %, pp, x volume ratio)
- 2-3 short sentences. Under 270 characters.
- Include the URL provided at the end with nothing after it.
- If the data is genuinely uninteresting (you don't see why the move matters), return tweet_text = null. Better to skip than post junk.

Examples of the voice you're aiming for (note the second sentence: structural reasoning):

GOOD: "Kalshi has Minnesota mid-game at 66.5%; 158-book consensus prices the spot at 50%. 16.5pp gap on $361k of in-play volume. That kind of mid-game drift is the exchange pricing settlement + leverage-exit risk, not just outcome — Kalshi typically lags book lines once contracts go deep."

GOOD: "Schwarber HR ladder: 2+ rung at 18¢ on 1.3k contracts; the 1+ rung carries 92% of volume but trades at 84. Volume concentration means price discovery is happening only on the headline threshold — adjacent rungs are statistical noise."

GOOD: "Cross-source gap: Kalshi has Wemby blocks 2+ at 31% on 2.1k contracts, sportsbook fair sits at 24%. Books target balanced action; exchanges target fair price. The 7pp gap is sharp money locating the right side ahead of the risk desk."

BAD: "🔴 Move alert: Wemby blocks +12% to 31%"  (template, no insight, no structure)
BAD: "📈 Cross-source gap on Wemby blocks: Kalshi 31% / books 24%. 7pp."  (data without the microstructure reason)

Output JSON only:
{
  "tweet_text": "string or null",
  "confidence": 0.0,
  "reasoning": "one sentence: why this is sharp, what lens you used, or why you skipped"
}`;

export async function composeSharp(context, siteUrl) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { tweet_text: null, confidence: 0, reasoning: "ANTHROPIC_API_KEY missing" };
  }
  const url = `${siteUrl}/sports/${context.league}/event/${context.event.id}`;
  const payload = {
    event_title: context.event.title,
    contestant: context.market.contestant_label,
    prop_line: context.market.prop_line,
    prop_side: context.market.prop_side,
    kalshi_now_pct: Number((context.kalshi_now * 100).toFixed(1)),
    kalshi_was_pct: Number((context.kalshi_was * 100).toFixed(1)),
    delta_pp: Number((context.delta * 100).toFixed(1)),
    kalshi_yes_bid_cents: context.kalshi_yes_bid != null ? Math.round(context.kalshi_yes_bid * 100) : null,
    kalshi_yes_ask_cents: context.kalshi_yes_ask != null ? Math.round(context.kalshi_yes_ask * 100) : null,
    kalshi_volume_24h: context.kalshi_volume_24h,
    sportsbook_fair_pct: context.books_median != null ? Number((context.books_median * 100).toFixed(1)) : null,
    sportsbook_book_count: context.book_count,
    cross_source_gap_pp: context.cross_source_gap != null ? Number((context.cross_source_gap * 100).toFixed(1)) : null,
    polymarket_pct: context.polymarket_now != null ? Number((context.polymarket_now * 100).toFixed(1)) : null,
    polymarket_volume_usd: context.polymarket_volume_usd,
    kalshi_4h_delta_pp: context.kalshi_4h_delta != null ? Number((context.kalshi_4h_delta * 100).toFixed(1)) : null,
    ladder: context.ladder?.map((r) => ({
      line: Number(r.prop_line), side: r.prop_side,
      kalshi_pct: r.prob != null ? Number((r.prob * 100).toFixed(1)) : null,
      vol_24h: r.volume_24h ?? null,
    })) || null,
    volume_share_of_ladder_pct: context.volume_share_of_ladder != null
      ? Number((context.volume_share_of_ladder * 100).toFixed(0)) : null,
    event_started: context.event.start_time ? new Date(context.event.start_time).getTime() <= Date.now() : null,
    insight_signals: context.insight_reasons || [],
    // Structural lens — the highest-priority applicable microstructure
    // frame for this context. Gives Claude the "why" behind the data.
    structure_lens: (() => {
      const ctxForLens = {
        event_started: context.event.start_time ? new Date(context.event.start_time).getTime() <= Date.now() : false,
        kalshi_yes_bid_cents: context.kalshi_yes_bid != null ? Math.round(context.kalshi_yes_bid * 100) : 0,
        kalshi_yes_ask_cents: context.kalshi_yes_ask != null ? Math.round(context.kalshi_yes_ask * 100) : 100,
        kalshi_4h_delta_pp: context.kalshi_4h_delta != null ? Number((context.kalshi_4h_delta * 100).toFixed(1)) : 0,
        kalshi_volume_24h: context.kalshi_volume_24h || 0,
        cross_source_gap_pp: context.cross_source_gap != null ? Number((context.cross_source_gap * 100).toFixed(1)) : 0,
        polymarket_pct: context.polymarket_now != null ? Number((context.polymarket_now * 100).toFixed(1)) : null,
        kalshi_now_pct: Number((context.kalshi_now * 100).toFixed(1)),
        volume_share_of_ladder_pct: context.volume_share_of_ladder != null ? Number((context.volume_share_of_ladder * 100).toFixed(0)) : 0,
        ladder: context.ladder,
        insight_signals: context.insight_reasons || [],
      };
      const lens = pickLens(ctxForLens);
      return { key: lens.key, frame: lens.frame };
    })(),
    site_url_for_event: url,
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY.trim(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: COMPOSER_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { tweet_text: null, confidence: 0, reasoning: `Claude ${r.status}: ${body.slice(0, 150)}` };
    }
    const data = await r.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    if (!textBlock) return { tweet_text: null, confidence: 0, reasoning: "no text from Claude" };
    let json = textBlock.text.trim();
    const fence = json.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fence) json = fence[1];
    else {
      const f = json.indexOf("{"), l = json.lastIndexOf("}");
      if (f >= 0 && l > f) json = json.slice(f, l + 1);
    }
    const parsed = JSON.parse(json);
    return {
      tweet_text: parsed.tweet_text || null,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      reasoning: parsed.reasoning || "",
    };
  } catch (e) {
    return { tweet_text: null, confidence: 0, reasoning: `compose error: ${e.message}` };
  }
}

// Final validation — even Claude's output is checked.
const TEMPLATE_PHRASES = [
  /^[🔴🟢🟡📈📉🚨⚠️]\s*move/i,
  /^heads up:/i,
  /^watching:/i,
  /^sharp move/i,
  /just (climbed|dropped|jumped|fell)/i,
  /move alert/i,
];
const FORBIDDEN = [
  /\b(lock|smash|hammer|lfg|tail|fade)\b/i,
  /\b(juice|chalk|lean)\b\s*(is|gettin)/i,
];

export function validateTweet(text) {
  if (!text || text.length < 50) return "too short";
  if (text.length > 270) return "too long";
  for (const p of TEMPLATE_PHRASES) if (p.test(text)) return `template phrase: ${p.source.slice(0, 30)}`;
  for (const p of FORBIDDEN) if (p.test(text)) return `forbidden phrase: ${p.source.slice(0, 30)}`;
  if (!/\d/.test(text)) return "no numeric content";
  return null;
}

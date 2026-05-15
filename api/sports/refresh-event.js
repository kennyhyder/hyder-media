import { getSupabase, normalizeName, computeImplied, toUnit, toBigInt, KALSHI_BASE } from "./_lib.js";
import {
  LEAGUE_TO_SPORT, fetchOddsApi, americanToProb, devigOutcomes,
  softLabelMatch, normalizeBookKey, normalizeForMatch,
} from "./_books.js";

// Per-event force-refresh. Works for EVERY event type (game, championship,
// conference, division, playoffs, MVP, awards, win totals, etc.).
//
//   - Always re-pulls Kalshi markets for the event_ticker (free, fast)
//   - For "game" event_type ONLY, additionally hits The Odds API for book
//     lines (3 credits). Futures-style events have no equivalent at the
//     sportsbooks, so we skip that step rather than waste credits.
//
// Auth via CRON_SECRET (so only the sportsbookish refresh proxy + our own
// crons can hit it).
//
// GET /api/sports/refresh-event?event_id=<sports_events.id>&secret=<CRON_SECRET>
//
// Returns:
//   {
//     ok: true, event_type, credits_used: N,
//     kalshi: { markets_seen, quotes_inserted },
//     books:  { events_matched, quotes_inserted } | null,
//   }

export const config = { maxDuration: 30 };

function checkAuth(req) {
  const provided = req.query?.secret || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return true;
  return provided === process.env.CRON_SECRET;
}

function groupByPoint(outcomes) {
  const byPoint = new Map();
  for (const o of outcomes) {
    const k = String(o.point);
    if (!byPoint.has(k)) byPoint.set(k, []);
    byPoint.get(k).push(o);
  }
  return Array.from(byPoint.values()).filter((g) => g.length === 2);
}

// Re-fetch Kalshi markets for a single event_ticker and insert fresh quotes.
// Idempotent — multiple calls within seconds just append duplicate-timestamp
// rows. Returns { markets_seen, quotes_inserted }.
async function refreshKalshiForEvent(supabase, event) {
  if (!event.kalshi_event_ticker) return { markets_seen: 0, quotes_inserted: 0 };

  // Pull all markets for this event from Kalshi
  let cursor = null;
  const allMarkets = [];
  do {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("event_ticker", event.kalshi_event_ticker);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Kalshi ${r.status}`);
    const data = await r.json();
    allMarkets.push(...(data.markets || []));
    cursor = data.cursor || null;
  } while (cursor);

  if (!allMarkets.length) return { markets_seen: 0, quotes_inserted: 0 };

  // Load the sports_markets rows for this event so we can map kalshi_ticker -> market_id.
  const { data: ourMarkets } = await supabase
    .from("sports_markets")
    .select("id, kalshi_ticker")
    .eq("event_id", event.id)
    .not("kalshi_ticker", "is", null);
  const idByTicker = new Map((ourMarkets || []).map((m) => [m.kalshi_ticker, m.id]));

  const rows = [];
  for (const km of allMarkets) {
    const mid = idByTicker.get(km.ticker);
    if (!mid) continue;
    const yesBid = toUnit(km.yes_bid_dollars ?? km.yes_bid);
    const yesAsk = toUnit(km.yes_ask_dollars ?? km.yes_ask);
    const last = toUnit(km.last_price_dollars ?? km.last_price);
    rows.push({
      market_id: mid,
      yes_bid: yesBid,
      yes_ask: yesAsk,
      last_price: last,
      implied_prob: computeImplied(yesBid, yesAsk, last),
      volume: toBigInt(km.volume ?? km.volume_24h),
      open_interest: toBigInt(km.open_interest_fp ?? km.open_interest),
      status: km.status || null,
    });
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await supabase.from("sports_quotes").insert(slice);
    if (!error) inserted += slice.length;
  }
  return { markets_seen: rows.length, quotes_inserted: inserted };
}

// Re-pull Odds API book lines for a game event. Only valid for event_type="game".
// Returns { events_matched, quotes_inserted, credits_used } or { error }.
async function refreshBooksForGame(supabase, event) {
  const sport = LEAGUE_TO_SPORT[event.league];
  if (!sport) return { error: `league ${event.league} not Odds-API-supported`, credits_used: 0 };

  // Find the matching Odds API event id (cached) or discover it.
  const { data: mapRow } = await supabase
    .from("sports_book_events_map")
    .select("odds_api_event_id")
    .eq("sports_event_id", event.id)
    .maybeSingle();

  let oddsApiEventId = mapRow?.odds_api_event_id;
  let creditsUsed = 0;

  if (!oddsApiEventId) {
    let listing;
    try {
      listing = await fetchOddsApi(`/sports/${sport}/events`, { dateFormat: "iso" });
      creditsUsed += 1;
    } catch (e) {
      return { error: `odds api events lookup: ${e.message}`, credits_used: creditsUsed };
    }
    const { data: markets } = await supabase
      .from("sports_markets")
      .select("contestant_label")
      .eq("event_id", event.id)
      .eq("market_type", "winner");
    const labels = (markets || []).map((m) => m.contestant_label);
    const cand = (listing.body || []).find((e) => {
      const homeMatch = labels.some((l) => softLabelMatch(e.home_team, l, event.league));
      const awayMatch = labels.some((l) => softLabelMatch(e.away_team, l, event.league));
      return homeMatch && awayMatch;
    });
    if (cand) oddsApiEventId = cand.id;
  }
  if (!oddsApiEventId) return { error: "no Odds API event match for this game", credits_used: creditsUsed };

  let api;
  try {
    api = await fetchOddsApi(`/sports/${sport}/events/${oddsApiEventId}/odds`, {
      regions: "us", markets: "h2h,spreads,totals",
      oddsFormat: "american", dateFormat: "iso",
    });
    creditsUsed += 3;
  } catch (e) {
    return { error: e.message, credits_used: creditsUsed };
  }
  const oaEvent = api.body;

  const { data: kMarkets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label")
    .eq("event_id", event.id)
    .eq("market_type", "winner");
  const homeMarket = (kMarkets || []).find((m) => softLabelMatch(oaEvent.home_team, m.contestant_label, event.league));
  const awayMarket = (kMarkets || []).find((m) => softLabelMatch(oaEvent.away_team, m.contestant_label, event.league));

  const insertQuoteRows = [];
  const now = new Date().toISOString();
  for (const bm of oaEvent.bookmakers || []) {
    const bookNorm = normalizeBookKey(bm.key);
    for (const market of bm.markets || []) {
      const key = market.key;
      if (!["h2h", "spreads", "totals"].includes(key)) continue;
      if (!market.outcomes?.length) continue;
      const grouped = key === "totals" ? groupByPoint(market.outcomes) : [market.outcomes];
      for (const group of grouped) {
        const outcomes = group.map((o) => ({
          name: o.name,
          point: o.point != null ? Number(o.point) : null,
          american: Math.round(Number(o.price)),
          prob_raw: americanToProb(o.price),
        }));
        const devigged = devigOutcomes(outcomes);
        for (const o of devigged) {
          let label, labelNorm;
          if (key === "totals") {
            label = o.name;
            labelNorm = normalizeName(o.name);
          } else {
            const targetIsHome = homeMarket && softLabelMatch(o.name, homeMarket.contestant_label, event.league);
            const targetIsAway = awayMarket && softLabelMatch(o.name, awayMarket.contestant_label, event.league);
            if (!targetIsHome && !targetIsAway) continue;
            const target = targetIsHome ? homeMarket : awayMarket;
            label = target.contestant_label;
            labelNorm = normalizeForMatch(label);
          }
          insertQuoteRows.push({
            sports_event_id: event.id,
            odds_api_event_id: oddsApiEventId,
            league: event.league,
            contestant_label: label,
            contestant_norm: labelNorm,
            market_type: key,
            book: bookNorm,
            point: o.point,
            american: o.american,
            implied_prob_raw: o.prob_raw,
            implied_prob_novig: o.prob_novig,
            fetched_at: now,
          });
        }
      }
    }
  }
  let inserted = 0;
  for (let i = 0; i < insertQuoteRows.length; i += 500) {
    const slice = insertQuoteRows.slice(i, i + 500);
    const { error } = await supabase.from("sports_book_quotes").insert(slice);
    if (!error) inserted += slice.length;
  }
  await supabase
    .from("sports_book_events_map")
    .upsert({
      odds_api_event_id: oddsApiEventId,
      sports_event_id: event.id,
      league: event.league,
      sport_key: sport,
      home_team: oaEvent.home_team,
      away_team: oaEvent.away_team,
      home_team_norm: normalizeName(oaEvent.home_team),
      away_team_norm: normalizeName(oaEvent.away_team),
      commence_time: oaEvent.commence_time || null,
      last_seen_at: now,
    }, { onConflict: "odds_api_event_id" });

  return {
    events_matched: 1,
    quotes_inserted: inserted,
    credits_used: creditsUsed,
    credits_remaining: api.credits.remaining,
  };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const sportsEventId = req.query.event_id;
  if (!sportsEventId) return res.status(400).json({ error: "event_id required" });

  const supabase = getSupabase();
  const { data: event } = await supabase
    .from("sports_events")
    .select("id, league, title, event_type, start_time, status, kalshi_event_ticker")
    .eq("id", sportsEventId)
    .maybeSingle();
  if (!event) return res.status(404).json({ error: "event not found" });

  const t0 = Date.now();
  let kalshi, books = null;

  try {
    kalshi = await refreshKalshiForEvent(supabase, event);
  } catch (e) {
    kalshi = { error: e.message, markets_seen: 0, quotes_inserted: 0 };
  }

  // Books are only relevant for "game" event types. Skip for futures, awards,
  // championships, division winners, etc. (saves credits, avoids 404 noise).
  if (event.event_type === "game") {
    books = await refreshBooksForGame(supabase, event);
  }

  const creditsUsed = books?.credits_used ?? 0;
  // Preserve legacy shape for the existing sportsbookish proxy:
  //   { ok, credits_used, quotes_inserted } — quotes_inserted now reflects
  //   the COMBINED total (kalshi + books) so the toast message stays correct.
  const totalQuotes = (kalshi.quotes_inserted || 0) + (books?.quotes_inserted || 0);

  return res.status(200).json({
    ok: true,
    event_type: event.event_type,
    credits_used: creditsUsed,
    credits_remaining: books?.credits_remaining ?? null,
    quotes_inserted: totalQuotes,
    kalshi,
    books,
    elapsed_ms: Date.now() - t0,
  });
}

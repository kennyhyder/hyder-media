import {
  getSupabase, checkAuth, normalizeName, slugify, toUnit, toBigInt, computeImplied,
  listEventsForSeries, fetchMarketsForEvent, mapLimit, PROP_SERIES,
} from "./_lib.js";

// Player-prop ingester.
//
// Each Kalshi prop event = one (game × stat) combo, e.g.
// KXNBASTL-26MAY18SASOKC = "San Antonio at Oklahoma City: Steals".
// Each market inside = one (player × threshold), e.g. ticker
// KXNBASTL-26MAY18SASOKC-OKCSGILGEOUSALEXA-2 = "Shai Gilgeous-Alexander: 2+".
//
// We parse player name from `yes_sub_title` (format "<Player>: <line>+")
// and the threshold integer from the same string. Each market becomes one
// sports_markets row keyed by kalshi_ticker (NOT the legacy
// event/contestant/market_type triplet, which collapses multiple
// thresholds for the same player).
//
// GET /api/sports/cron-ingest-props
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 300 };

// Parse "<Player Name>: <N>+" or "<Player Name>: <N>" from yes_sub_title
function parsePropMarket(yesSub, title) {
  const src = yesSub || title || "";
  // Format examples:
  //   "Shai Gilgeous-Alexander: 1+"
  //   "Stephon Castle: 3+"
  //   "Anthony Edwards: 30+"
  // Anytime goal/TD often just lists the player name with no number.
  const numMatch = src.match(/^(.+?):\s*(\d+(?:\.\d+)?)\+?\s*$/);
  if (numMatch) {
    return { player: numMatch[1].trim(), line: parseFloat(numMatch[2]), side: "over" };
  }
  // Anytime-goal / anytime-TD markets — no threshold; the market itself is
  // a binary yes/no on "did this player score?"
  const playerOnly = src.replace(/:.*$/, "").trim();
  if (playerOnly && playerOnly.length < 50) {
    return { player: playerOnly, line: 0.5, side: "over" }; // treat 0.5 over as "any"
  }
  return null;
}

async function ingestPropSeries(supabase, series) {
  const summary = { ticker: series.ticker, events: 0, markets: 0, quotes: 0, errors: 0 };

  let events;
  try {
    events = await listEventsForSeries(series.ticker);
  } catch (e) {
    summary.errors++;
    summary.error = `events: ${e.message}`;
    return summary;
  }
  if (!events.length) return summary;

  const eventsWithMarkets = await mapLimit(events, 8, async (e) => ({
    event: e,
    markets: await fetchMarketsForEvent(e.event_ticker).catch(() => []),
  }));

  // 1) Upsert events (one per game × stat)
  const eventRows = events.map((e) => {
    const title = e.title || e.sub_title || e.event_ticker;
    const startTime = e.expected_expiration_time ? new Date(e.expected_expiration_time) : null;
    const year = startTime ? startTime.getUTCFullYear() : new Date().getUTCFullYear();
    return {
      league: series.league,
      event_type: series.market_type,         // e.g. "player_prop_steals"
      title,
      short_title: e.sub_title || null,
      kalshi_event_ticker: e.event_ticker,
      start_time: startTime ? startTime.toISOString() : null,
      season_year: year,
      slug: slugify(title),
      status: "open",
    };
  });
  const { data: eventsResult, error: evErr } = await supabase
    .from("sports_events")
    .upsert(eventRows, { onConflict: "kalshi_event_ticker" })
    .select("id, kalshi_event_ticker");
  if (evErr) { summary.errors++; summary.error = `upsert events: ${evErr.message}`; return summary; }
  const eventByTicker = new Map(eventsResult.map((r) => [r.kalshi_event_ticker, r.id]));
  summary.events = eventsResult.length;

  // 2) Parse all player names + thresholds; bulk-upsert player contestants
  const parsedMarkets = [];
  for (const { event, markets } of eventsWithMarkets) {
    const eventId = eventByTicker.get(event.event_ticker);
    if (!eventId) continue;
    for (const m of markets) {
      const parsed = parsePropMarket(m.yes_sub_title, m.title);
      if (!parsed) continue;
      parsedMarkets.push({ ticker: m.ticker, eventId, ...parsed, raw: m });
    }
  }

  const playerMap = new Map();
  for (const pm of parsedMarkets) {
    const norm = normalizeName(pm.player);
    if (!playerMap.has(norm)) {
      playerMap.set(norm, { league: series.league, name: pm.player, normalized_name: norm, slug: slugify(pm.player) });
    }
  }
  const playerIdByNorm = new Map();
  if (playerMap.size > 0) {
    const rows = Array.from(playerMap.values());
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase
        .from("sports_contestants")
        .upsert(rows.slice(i, i + 500), { onConflict: "league,normalized_name" })
        .select("id, normalized_name");
      if (error) { summary.errors++; summary.error = `contestants: ${error.message}`; return summary; }
      for (const c of data) playerIdByNorm.set(c.normalized_name, c.id);
    }
  }

  // 3) Upsert markets (one row per Kalshi ticker)
  const marketRows = [];
  const validParsed = [];
  for (const pm of parsedMarkets) {
    const contestantId = playerIdByNorm.get(normalizeName(pm.player));
    if (!contestantId) continue;
    marketRows.push({
      event_id: pm.eventId,
      contestant_id: contestantId,
      contestant_label: pm.player,
      market_type: series.market_type,
      kalshi_ticker: pm.ticker,
      prop_line: pm.line,
      prop_side: pm.side,
    });
    validParsed.push(pm);
  }
  const marketIdByTicker = new Map();
  for (let i = 0; i < marketRows.length; i += 500) {
    const { data, error } = await supabase
      .from("sports_markets")
      .upsert(marketRows.slice(i, i + 500), { onConflict: "kalshi_ticker" })
      .select("id, kalshi_ticker");
    if (error) { summary.errors++; summary.error = `markets: ${error.message}`; return summary; }
    for (const m of data) marketIdByTicker.set(m.kalshi_ticker, m.id);
  }
  summary.markets = marketIdByTicker.size;

  // 4) Bulk insert quotes
  const quoteRows = [];
  for (const pm of validParsed) {
    const marketId = marketIdByTicker.get(pm.ticker);
    if (!marketId) continue;
    const m = pm.raw;
    const yesBid = toUnit(m.yes_bid_dollars ?? m.yes_bid);
    const yesAsk = toUnit(m.yes_ask_dollars ?? m.yes_ask);
    const last = toUnit(m.last_price_dollars ?? m.last_price);
    quoteRows.push({
      market_id: marketId,
      yes_bid: yesBid,
      yes_ask: yesAsk,
      last_price: last,
      implied_prob: computeImplied(yesBid, yesAsk, last),
      volume: toBigInt(m.volume ?? m.volume_24h),
      open_interest: toBigInt(m.open_interest_fp ?? m.open_interest),
      status: m.status || null,
    });
  }
  for (let i = 0; i < quoteRows.length; i += 1000) {
    const { error } = await supabase.from("sports_quotes").insert(quoteRows.slice(i, i + 1000));
    if (error) { summary.errors++; summary.error = `quotes: ${error.message}`; }
    else summary.quotes += Math.min(1000, quoteRows.length - i);
  }

  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const results = [];
  for (const series of PROP_SERIES) {
    try {
      results.push(await ingestPropSeries(supabase, series));
    } catch (e) {
      results.push({ ticker: series.ticker, error: e.message, events: 0, markets: 0, quotes: 0, errors: 1 });
    }
  }

  const totals = results.reduce((acc, r) => ({
    events: acc.events + (r.events || 0),
    markets: acc.markets + (r.markets || 0),
    quotes: acc.quotes + (r.quotes || 0),
    errors: acc.errors + (r.errors || 0),
  }), { events: 0, markets: 0, quotes: 0, errors: 0 });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ started_at: startedAt, completed_at: new Date().toISOString(), totals, by_series: results });
}

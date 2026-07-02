import { createClient } from "@supabase/supabase-js";

// Kalshi golf props ingester.
//
// Outright finisher markets (win/t5/t10/t20/mc/r1lead/r2lead/r3lead) are
// already pulled by cron-ingest-kalshi.js into the golfodds_markets table
// — those are player×market_type bets that compare cleanly against
// DataGolf and sportsbook outrights.
//
// THIS ingester handles event-style props that don't fit that shape:
//   - Winning score (under 270 / 270-274 / 275+ / ...)
//   - Win margin (1 / 2 / 3+ strokes)
//   - Cut line (over/under X)
//   - Hole-in-one (yes/no per round)
//   - Bogey-free round (yes/no per player/round)
//   - Eagle in round (yes/no)
//   - Birdies in round (over/under N)
//   - Other one-off propositions
//
// Each Kalshi event = one tournament-wide prop question with multiple
// mutually-exclusive outcomes. Mirrors the existing schema:
//   golfodds_props (one row per question)
//   golfodds_prop_outcomes (one row per choice)
//   golfodds_prop_quotes (per-outcome Kalshi price)
//
// GET /api/golfodds/cron-ingest-props
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi series ticker → prop_type slug stored in golfodds_props.prop_type.
// All currently-open Kalshi golf prop series that aren't already covered
// by the outrights ingester. Add new series here as Kalshi opens them.
const PROP_SERIES = [
  { ticker: "KXPGAWINNINGSCORE",   propType: "winning_score",   question: "Winning score" },
  { ticker: "KXPGAWINMARGIN",      propType: "win_margin",      question: "Win margin (strokes)" },
  { ticker: "KXPGACUTLINE",        propType: "cut_line",        question: "Cut line score" },
  { ticker: "KXPGAHOLEINONE",      propType: "hole_in_one",     question: "Hole in one in round" },
  { ticker: "KXPGABOGEYFREE",      propType: "bogey_free",      question: "Bogey-free round by player" },
  { ticker: "KXPGAEAGLE",          propType: "eagle_in_round",  question: "Eagle in round by player" },
  { ticker: "KXPGABIRDIES",        propType: "round_birdies",   question: "Birdies in round by player" },
  { ticker: "KXPGAGOLFERSCORE",    propType: "golfer_score",    question: "Golfer round score" },
  { ticker: "KXPGAROUNDBIRDIES",   propType: "round_birdies_player", question: "Player birdies in round" },
  { ticker: "KXPGAROUNDSCORE",     propType: "round_score",     question: "Round scores" },
  { ticker: "KXPGAHOLESCORE",      propType: "hole_score",      question: "Hole score" },
  { ticker: "KXPGAREGION",         propType: "winner_region",   question: "Tournament winner region" },
  { ticker: "KXPGAWINNERWITHOUT",  propType: "winner_without",  question: "Winner without favorite" },
  { ticker: "KXPGAPLAYOFF",        propType: "playoff",         question: "Tournament ends in playoff" },
  { ticker: "KXPGACATR",           propType: "category_leader", question: "Category leader" },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return false; // fail closed if secret missing
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function toUnit(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function computeImplied(yesBid, yesAsk, last) {
  // Same dust-quote-safe logic as the sports ingester.
  if (yesBid != null && yesAsk != null
      && yesBid > 0 && yesAsk > yesBid
      && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
  if (last != null && last > 0 && last < 1) return last;
  return null;
}

async function fetchJSON(url, attempt = 0) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (r.status === 429 && attempt < 4) {
    await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
    return fetchJSON(url, attempt + 1);
  }
  if (!r.ok) throw new Error(`Kalshi ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function listOpenEvents(seriesTicker) {
  const events = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/events`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON(url.toString());
    events.push(...(data.events || []));
    cursor = data.cursor || null;
  } while (cursor);
  return events;
}

async function fetchMarketsForEvent(eventTicker) {
  const markets = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("event_ticker", eventTicker);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON(url.toString());
    markets.push(...(data.markets || []));
    cursor = data.cursor || null;
  } while (cursor);
  return markets;
}

async function ingestSeries(supabase, series) {
  const summary = { ticker: series.ticker, events: 0, outcomes: 0, quotes: 0, skipped: null };

  let events;
  try { events = await listOpenEvents(series.ticker); } catch (e) { summary.error = e.message; return summary; }
  if (!events.length) { summary.skipped = "no open events"; return summary; }

  // Match each Kalshi event to a tournament we already have. Use the event's
  // sub_title which usually contains the tournament name, fall back to the
  // event ticker for fuzzy lookup.
  const { data: tournaments } = await supabase
    .from("golfodds_tournaments")
    .select("id, name, kalshi_event_ticker, slug");

  for (const evt of events) {
    // Try direct ticker match first
    let tournament = (tournaments || []).find((t) => t.kalshi_event_ticker && evt.event_ticker.includes(t.kalshi_event_ticker.replace(/^KX/, "")));
    if (!tournament) {
      // Fallback: title/sub_title text contains tournament name
      const text = `${evt.title || ""} ${evt.sub_title || ""}`.toLowerCase();
      tournament = (tournaments || []).find((t) => t.name && text.includes(t.name.toLowerCase()));
    }
    if (!tournament) continue;  // no matching tournament — skip silently

    // Upsert the prop row (one per tournament × prop_type)
    const { data: propRow, error: propErr } = await supabase
      .from("golfodds_props")
      .upsert({
        tournament_id: tournament.id,
        prop_type: series.propType,
        question: series.question,
        kalshi_event_ticker: evt.event_ticker,
      }, { onConflict: "kalshi_event_ticker" })
      .select("id")
      .single();
    if (propErr) { summary.error = `props upsert: ${propErr.message}`; continue; }
    summary.events++;

    // Fetch every market under this event — each is one outcome
    let markets;
    try { markets = await fetchMarketsForEvent(evt.event_ticker); } catch (e) { summary.error = `markets: ${e.message}`; continue; }
    if (!markets.length) continue;

    // Upsert outcomes
    const outcomeRows = markets.map((m, idx) => ({
      prop_id: propRow.id,
      outcome_label: m.yes_sub_title || m.subtitle || m.title || m.ticker,
      outcome_key: m.ticker.split("-").pop() || m.ticker,
      display_order: idx,
      kalshi_ticker: m.ticker,
    }));
    const outcomeIdByTicker = new Map();
    for (let i = 0; i < outcomeRows.length; i += 200) {
      const slice = outcomeRows.slice(i, i + 200);
      const { data, error } = await supabase
        .from("golfodds_prop_outcomes")
        .upsert(slice, { onConflict: "prop_id,outcome_key" })
        .select("id, kalshi_ticker");
      if (error) { summary.error = `outcomes: ${error.message}`; continue; }
      for (const o of data) outcomeIdByTicker.set(o.kalshi_ticker, o.id);
      summary.outcomes += data.length;
    }

    // Insert quote rows
    const quoteRows = [];
    for (const m of markets) {
      const oid = outcomeIdByTicker.get(m.ticker);
      if (!oid) continue;
      const yesBid = toUnit(m.yes_bid_dollars ?? m.yes_bid);
      const yesAsk = toUnit(m.yes_ask_dollars ?? m.yes_ask);
      const last = toUnit(m.last_price_dollars ?? m.last_price);
      quoteRows.push({
        outcome_id: oid,
        yes_bid: yesBid,
        yes_ask: yesAsk,
        last_price: last,
        implied_prob: computeImplied(yesBid, yesAsk, last),
        volume: m.volume ?? m.volume_24h ?? null,
        open_interest: m.open_interest_fp ?? m.open_interest ?? null,
        status: m.status || null,
      });
    }
    for (let i = 0; i < quoteRows.length; i += 1000) {
      const slice = quoteRows.slice(i, i + 1000);
      const { error } = await supabase.from("golfodds_prop_quotes").insert(slice);
      if (error) { summary.error = `quotes: ${error.message}`; continue; }
      summary.quotes += slice.length;
    }
  }

  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const results = [];
  for (const series of PROP_SERIES) {
    try { results.push(await ingestSeries(supabase, series)); }
    catch (e) { results.push({ ticker: series.ticker, error: e.message }); }
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    totals: {
      events: results.reduce((s, r) => s + (r.events || 0), 0),
      outcomes: results.reduce((s, r) => s + (r.outcomes || 0), 0),
      quotes: results.reduce((s, r) => s + (r.quotes || 0), 0),
    },
    by_series: results,
  });
}

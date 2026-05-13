#!/usr/bin/env node
/**
 * Kalshi ingester for KXPGATOUR series (PGA Tour golf markets).
 *
 * What this does (V1 — single snapshot, idempotent):
 *   1. Fetch all open events under series_ticker=KXPGATOUR
 *   2. For each event, fetch nested markets (per-golfer Yes/No binaries)
 *   3. Upsert tournament / players / markets, then INSERT a fresh quote row
 *
 * Kalshi market data is public — no auth required.
 *
 * Run:  node --env-file=../.env.local scripts/ingest-kalshi.mjs
 * Or:   npm run ingest:kalshi
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi splits golf markets across distinct series per market type.
// `KXPGATOUR` is just the outright winner; every other line lives in its own
// series. Each event has per-golfer Yes/No binaries, and the event_ticker
// for the same tournament shares a suffix (e.g. `-PGC26`).
//
// All series here are per-golfer binary in shape (Yes = the named golfer
// achieves the outcome). Multi-outcome markets (cut line, winning score,
// matchups) need a separate data model and are handled elsewhere.
const KALSHI_SERIES = [
  // Pre-tournament outrights
  { ticker: "KXPGATOUR",      marketType: "win",     isWinner: true  },
  { ticker: "KXPGATOP5",      marketType: "t5",      isWinner: false },
  { ticker: "KXPGATOP10",     marketType: "t10",     isWinner: false },
  { ticker: "KXPGATOP20",     marketType: "t20",     isWinner: false },
  { ticker: "KXPGATOP40",     marketType: "t40",     isWinner: false },
  { ticker: "KXPGAMAKECUT",   marketType: "mc",      isWinner: false },
  // Per-round leaders (sum-to-1 like Win, just for that round)
  { ticker: "KXPGAR1LEAD",    marketType: "r1lead",  isWinner: false },
  { ticker: "KXPGAR2LEAD",    marketType: "r2lead",  isWinner: false },
  { ticker: "KXPGAR3LEAD",    marketType: "r3lead",  isWinner: false },
  // Per-round Top N (sum-to-N)
  { ticker: "KXPGAR1TOP5",    marketType: "r1t5",    isWinner: false },
  { ticker: "KXPGAR1TOP10",   marketType: "r1t10",   isWinner: false },
  { ticker: "KXPGAR1TOP20",   marketType: "r1t20",   isWinner: false },
  { ticker: "KXPGAR2TOP5",    marketType: "r2t5",    isWinner: false },
  { ticker: "KXPGAR2TOP10",   marketType: "r2t10",   isWinner: false },
  { ticker: "KXPGAR3TOP5",    marketType: "r3t5",    isWinner: false },
  { ticker: "KXPGAR3TOP10",   marketType: "r3t10",   isWinner: false },
  // Per-golfer props (binary, no field-sum constraint)
  { ticker: "KXPGAEAGLE",     marketType: "eagle",   isWinner: false },
  { ticker: "KXPGALOWSCORE",  marketType: "low_score", isWinner: false },
];

// Matchup series — different data shape (2 or 3 players per "event").
// Each event has 2 markets (H2H) or 3 markets (3-ball), one per player.
const KALSHI_MATCHUP_SERIES = [
  { ticker: "KXPGAH2H",   matchupType: "h2h",   scope: "tournament" },
  { ticker: "KXPGA3BALL", matchupType: "3ball", scope: "round" },
  { ticker: "KXPGA5BALL", matchupType: "5ball", scope: "round" },
];

// Multi-outcome prop series — each event has N markets covering mutually
// exclusive outcomes (or cumulative thresholds for hole-in-one).
const KALSHI_PROP_SERIES = [
  { ticker: "KXPGAWINNINGSCORE", propType: "winning_score",  outcomeKind: "mutually_exclusive", question: "What will the winning score be?" },
  { ticker: "KXPGASTROKEMARGIN", propType: "stroke_margin",  outcomeKind: "mutually_exclusive", question: "What will the winner's stroke margin be?" },
  { ticker: "KXPGAWINNERREGION", propType: "winner_region",  outcomeKind: "mutually_exclusive", question: "What region will the winner come from?" },
  { ticker: "KXPGAHOLEINONE",    propType: "hole_in_one",    outcomeKind: "cumulative_threshold", question: "How many holes-in-one this week?" },
];

// Node 20 lacks native WebSocket; supply `ws` so Supabase client constructs.
// We don't use realtime here, but the SDK initializes it eagerly.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

// --- Helpers ---------------------------------------------------------------

const normalizeName = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Extract the tournament suffix from an event ticker. e.g.:
//   KXPGATOUR-PGC26      -> PGC26
//   KXPGATOP5-PGC26      -> PGC26
//   KXPGAMAKECUT-PGC26   -> PGC26
function tournamentSuffix(eventTicker) {
  const i = eventTicker.indexOf("-");
  return i > -1 ? eventTicker.slice(i + 1) : eventTicker;
}

/**
 * Extract a golfer's name from a Kalshi market.
 * Kalshi exposes `yes_sub_title` like "Scottie Scheffler" for per-golfer markets.
 */
function extractPlayerName(market) {
  return (
    market.yes_sub_title ||
    market.subtitle ||
    market.title ||
    null
  );
}

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Kalshi ${r.status}: ${await r.text()}`);
  return r.json();
}

async function listEventsForSeries(seriesTicker) {
  const events = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/events`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON(url.toString());
    events.push(...(data.events || []));
    cursor = data.cursor || null;
  } while (cursor);
  return events;
}

async function fetchEvent(eventTicker) {
  const url = `${KALSHI_BASE}/events/${eventTicker}`;
  return fetchJSON(url);
}

// `with_nested_markets=true` returns 0 markets in practice for these events;
// use the /markets endpoint with event_ticker filter and paginate via cursor.
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

// --- Upserters -------------------------------------------------------------

// Strip Kalshi-isms from event titles so DataGolf's event_name converges on
// the same canonical tournament row. e.g. "PGA Championship Winner" -> "PGA Championship"
function canonicalTournamentName(title) {
  if (!title) return title;
  return title.replace(/\s+winner$/i, "").trim();
}

async function upsertTournament(event) {
  const row = {
    tour: "pga",
    name: canonicalTournamentName(event.title || event.sub_title || event.event_ticker),
    short_name: event.sub_title || null,
    kalshi_event_ticker: event.event_ticker,
    status: "upcoming",
  };
  const { data, error } = await supabase
    .from("golfodds_tournaments")
    .upsert(row, { onConflict: "kalshi_event_ticker" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert tournament ${event.event_ticker}: ${error.message}`);
  return data.id;
}

// For non-winner series (Top-N, Make Cut, etc.), the tournament was created by
// the winner series with kalshi_event_ticker = `KXPGATOUR-<suffix>`. Look it up
// by suffix. Returns null if not found (e.g. winner series hasn't run yet).
async function findTournamentBySuffix(suffix) {
  const { data, error } = await supabase
    .from("golfodds_tournaments")
    .select("id")
    .eq("kalshi_event_ticker", `KXPGATOUR-${suffix}`)
    .maybeSingle();
  if (error) throw new Error(`lookup tournament -${suffix}: ${error.message}`);
  return data?.id || null;
}

async function upsertPlayer(rawName) {
  const name = rawName.trim();
  const normalized = normalizeName(name);
  const { data, error } = await supabase
    .from("golfodds_players")
    .upsert({ name, normalized_name: normalized }, { onConflict: "normalized_name" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert player "${name}": ${error.message}`);
  return data.id;
}

async function upsertMarket(tournamentId, playerId, marketType) {
  const { data, error } = await supabase
    .from("golfodds_markets")
    .upsert(
      { tournament_id: tournamentId, player_id: playerId, market_type: marketType },
      { onConflict: "tournament_id,player_id,market_type" }
    )
    .select("id")
    .single();
  if (error) throw new Error(`upsert market ${marketType}: ${error.message}`);
  return data.id;
}

async function insertQuote(marketId, market) {
  // Kalshi returns `_dollars` fields as STRINGS like "0.1700" (not numbers).
  // Older API also exposed integer cents (yes_bid: 17). Coerce to Number and
  // normalize to 0-1 range. NaN -> null so the DB stores NULL rather than 0.
  const toUnit = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n;
  };
  const toBigInt = (v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const yesBid = toUnit(market.yes_bid_dollars ?? market.yes_bid);
  const yesAsk = toUnit(market.yes_ask_dollars ?? market.yes_ask);
  const last = toUnit(market.last_price_dollars ?? market.last_price);
  // Implied probability: prefer bid/ask mid when the spread is tight (real
  // market). On illiquid markets Kalshi quotes bid=0 / ask=1.0 — the mid
  // (0.5) is garbage. Fall back to last_price, then to null.
  let implied = null;
  if (yesBid != null && yesAsk != null && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    implied = Number(((yesBid + yesAsk) / 2).toFixed(4));
  } else if (last != null && last > 0 && last < 1) {
    implied = last;
  }

  const { error } = await supabase.from("golfodds_kalshi_quotes").insert({
    market_id: marketId,
    kalshi_ticker: market.ticker,
    yes_bid: yesBid,
    yes_ask: yesAsk,
    last_price: last,
    implied_prob: implied,
    volume: toBigInt(market.volume ?? market.volume_24h),
    open_interest: toBigInt(market.open_interest_fp ?? market.open_interest),
    status: market.status || null,
  });
  if (error) throw new Error(`insert quote ${market.ticker}: ${error.message}`);
}

// --- Main ------------------------------------------------------------------

async function processEvent({ event, marketType, tournamentId }) {
  const markets = await fetchMarketsForEvent(event.event_ticker);
  let inserted = 0;
  let errors = 0;
  for (const m of markets) {
    const playerName = extractPlayerName(m);
    if (!playerName) continue;
    // Skip non-per-golfer markets that occasionally appear (cut line, win margin, etc.)
    if (playerName.length > 40 || /\b(rain|weather|cut\s*line|delay|playoff|margin|stroke|hole|score)\b/i.test(playerName)) {
      continue;
    }
    try {
      const playerId = await upsertPlayer(playerName);
      const marketId = await upsertMarket(tournamentId, playerId, marketType);
      await insertQuote(marketId, m);
      inserted++;
    } catch (e) {
      errors++;
      console.error(`    ${m.ticker}: ${e.message}`);
    }
  }
  return { inserted, errors, totalMarkets: markets.length };
}

// ---- Matchup ingestion ---------------------------------------------------

// Build map of tournament_code -> tournament_id from existing winner tournaments
async function loadTournamentMap() {
  const { data, error } = await supabase
    .from("golfodds_tournaments")
    .select("id, kalshi_event_ticker")
    .like("kalshi_event_ticker", "KXPGATOUR-%");
  if (error) throw new Error(`load tournaments: ${error.message}`);
  const map = new Map();
  for (const t of data || []) {
    const code = t.kalshi_event_ticker.replace(/^KXPGATOUR-/, "");
    map.set(code, t.id);
  }
  return map;
}

// Find tournament for matchup ticker by longest prefix match on the suffix
// e.g. suffix "PGC26SSCHRMCI" → match tournament code "PGC26"
function tournamentForMatchupSuffix(suffix, tournamentMap) {
  const codes = Array.from(tournamentMap.keys()).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (suffix.startsWith(code)) return { id: tournamentMap.get(code), code };
  }
  return null;
}

// Extract round number from matchup ticker. Examples:
//   PGC26SSCHRMCI -> null (tournament scope)
//   PGC26R1JROSSSCHMFIT -> 1
function extractRound(suffixAfterCode) {
  const m = suffixAfterCode.match(/^R(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

// Player from yes_sub_title — "Scottie Scheffler beats Rory McIlroy" -> "Scottie Scheffler"
function extractMatchupPlayer(market) {
  const sub = market.yes_sub_title || "";
  const i = sub.toLowerCase().indexOf(" beats ");
  if (i < 0) return null;
  return sub.slice(0, i).trim();
}

async function upsertMatchup(row) {
  const { data, error } = await supabase
    .from("golfodds_matchups")
    .upsert(row, { onConflict: "kalshi_event_ticker" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert matchup ${row.kalshi_event_ticker}: ${error.message}`);
  return data.id;
}

async function upsertMatchupPlayer(matchupId, playerId, ticker) {
  const { data, error } = await supabase
    .from("golfodds_matchup_players")
    .upsert({ matchup_id: matchupId, player_id: playerId, kalshi_ticker: ticker }, { onConflict: "matchup_id,player_id" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert matchup_player: ${error.message}`);
  return data.id;
}

async function insertMatchupQuote(matchupPlayerId, market) {
  const toUnit = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n;
  };
  const toBigInt = (v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const yesBid = toUnit(market.yes_bid_dollars ?? market.yes_bid);
  const yesAsk = toUnit(market.yes_ask_dollars ?? market.yes_ask);
  const last = toUnit(market.last_price_dollars ?? market.last_price);
  let implied = null;
  if (yesBid != null && yesAsk != null && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    implied = Number(((yesBid + yesAsk) / 2).toFixed(4));
  } else if (last != null && last > 0 && last < 1) {
    implied = last;
  }
  const { error } = await supabase.from("golfodds_matchup_kalshi_quotes").insert({
    matchup_player_id: matchupPlayerId,
    yes_bid: yesBid, yes_ask: yesAsk, last_price: last, implied_prob: implied,
    volume: toBigInt(market.volume ?? market.volume_24h),
    open_interest: toBigInt(market.open_interest_fp ?? market.open_interest),
    status: market.status || null,
  });
  if (error) throw new Error(`insert matchup quote: ${error.message}`);
}

async function ingestMatchupSeries(series, tournamentMap) {
  console.log(`\nFetching Kalshi ${series.ticker} matchup events (type=${series.matchupType})…`);
  const events = await listEventsForSeries(series.ticker);
  console.log(`  Found ${events.length} open events`);

  let totalQuotes = 0;
  let totalErrors = 0;
  let skipped = 0;

  for (const evt of events) {
    try {
      const suffix = tournamentSuffix(evt.event_ticker);
      const match = tournamentForMatchupSuffix(suffix, tournamentMap);
      if (!match) {
        skipped++;
        continue;
      }
      const matchupTail = suffix.slice(match.code.length);
      const round = series.scope === "round" ? extractRound(matchupTail) : null;
      const markets = await fetchMarketsForEvent(evt.event_ticker);

      const matchupId = await upsertMatchup({
        tournament_id: match.id,
        matchup_type: series.matchupType,
        scope: series.scope,
        round_number: round,
        kalshi_event_ticker: evt.event_ticker,
        title: evt.title || null,
      });

      let inserted = 0;
      for (const m of markets) {
        const playerName = extractMatchupPlayer(m);
        if (!playerName) continue;
        try {
          const playerId = await upsertPlayer(playerName);
          const matchupPlayerId = await upsertMatchupPlayer(matchupId, playerId, m.ticker);
          await insertMatchupQuote(matchupPlayerId, m);
          inserted++;
        } catch (e) {
          totalErrors++;
          console.error(`    ${m.ticker}: ${e.message}`);
        }
      }
      totalQuotes += inserted;
    } catch (e) {
      totalErrors++;
      console.error(`  event ${evt.event_ticker}: ${e.message}`);
    }
  }

  console.log(`  ${series.ticker}: ${totalQuotes} matchup quotes inserted, ${totalErrors} errors, ${skipped} events without matching tournament`);
  return { totalQuotes, totalErrors };
}

// ---- Prop ingestion ------------------------------------------------------

async function upsertProp(row) {
  const { data, error } = await supabase
    .from("golfodds_props")
    .upsert(row, { onConflict: "tournament_id,prop_type" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert prop ${row.kalshi_event_ticker}: ${error.message}`);
  return data.id;
}

async function upsertPropOutcome(propId, label, key, displayOrder, ticker) {
  const { data, error } = await supabase
    .from("golfodds_prop_outcomes")
    .upsert({ prop_id: propId, outcome_label: label, outcome_key: key, display_order: displayOrder, kalshi_ticker: ticker }, { onConflict: "prop_id,outcome_key" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert prop outcome ${key}: ${error.message}`);
  return data.id;
}

async function insertPropQuote(outcomeId, market) {
  const toUnit = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n;
  };
  const toBigInt = (v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const yesBid = toUnit(market.yes_bid_dollars ?? market.yes_bid);
  const yesAsk = toUnit(market.yes_ask_dollars ?? market.yes_ask);
  const last = toUnit(market.last_price_dollars ?? market.last_price);
  let implied = null;
  if (yesBid != null && yesAsk != null && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    implied = Number(((yesBid + yesAsk) / 2).toFixed(4));
  } else if (last != null && last > 0 && last < 1) {
    implied = last;
  }
  const { error } = await supabase.from("golfodds_prop_quotes").insert({
    outcome_id: outcomeId,
    yes_bid: yesBid, yes_ask: yesAsk, last_price: last, implied_prob: implied,
    volume: toBigInt(market.volume ?? market.volume_24h),
    open_interest: toBigInt(market.open_interest_fp ?? market.open_interest),
    status: market.status || null,
  });
  if (error) throw new Error(`insert prop quote: ${error.message}`);
}

// Derive a numeric display order from the outcome key. Best-effort: parses
// the first number to sort. Falls back to alpha.
function displayOrderFromKey(key) {
  const m = key.match(/^-?(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

async function ingestPropSeries(series, tournamentMap) {
  console.log(`\nFetching Kalshi ${series.ticker} prop events (type=${series.propType})…`);
  const events = await listEventsForSeries(series.ticker);
  console.log(`  Found ${events.length} open events`);

  let totalQuotes = 0;
  let totalErrors = 0;
  let skipped = 0;

  for (const evt of events) {
    try {
      const suffix = tournamentSuffix(evt.event_ticker);
      const match = tournamentForMatchupSuffix(suffix, tournamentMap);
      if (!match) {
        skipped++;
        continue;
      }
      const markets = await fetchMarketsForEvent(evt.event_ticker);

      const propId = await upsertProp({
        tournament_id: match.id,
        prop_type: series.propType,
        question: series.question,
        outcome_kind: series.outcomeKind,
        kalshi_event_ticker: evt.event_ticker,
      });

      let inserted = 0;
      for (const m of markets) {
        const label = (m.yes_sub_title || m.title || "").trim();
        if (!label) continue;
        // outcome_key = ticker portion after the event_ticker prefix
        const key = m.ticker.startsWith(evt.event_ticker + "-")
          ? m.ticker.slice(evt.event_ticker.length + 1)
          : m.ticker;
        try {
          const outcomeId = await upsertPropOutcome(propId, label, key, displayOrderFromKey(key), m.ticker);
          await insertPropQuote(outcomeId, m);
          inserted++;
        } catch (e) {
          totalErrors++;
          console.error(`    ${m.ticker}: ${e.message}`);
        }
      }
      totalQuotes += inserted;
      console.log(`  ${evt.event_ticker}: ${inserted} outcomes inserted`);
    } catch (e) {
      totalErrors++;
      console.error(`  event ${evt.event_ticker}: ${e.message}`);
    }
  }

  console.log(`  ${series.ticker}: ${totalQuotes} prop quotes inserted, ${totalErrors} errors, ${skipped} events without matching tournament`);
  return { totalQuotes, totalErrors };
}

async function main() {
  let totalQuotes = 0;
  let totalErrors = 0;

  for (const series of KALSHI_SERIES) {
    console.log(`\nFetching Kalshi ${series.ticker} events (market_type=${series.marketType})…`);
    const events = await listEventsForSeries(series.ticker);
    console.log(`  Found ${events.length} open events`);

    for (const evt of events) {
      try {
        let tournamentId;
        if (series.isWinner) {
          const full = await fetchEvent(evt.event_ticker);
          tournamentId = await upsertTournament(full.event || evt);
        } else {
          const suffix = tournamentSuffix(evt.event_ticker);
          tournamentId = await findTournamentBySuffix(suffix);
          if (!tournamentId) {
            console.warn(`  skip ${evt.event_ticker}: no winner tournament for suffix ${suffix} — run winner series first`);
            continue;
          }
        }
        const r = await processEvent({ event: evt, marketType: series.marketType, tournamentId });
        console.log(`  ${evt.event_ticker}: ${r.totalMarkets} markets, ${r.inserted} inserted, ${r.errors} errors`);
        totalQuotes += r.inserted;
        totalErrors += r.errors;
      } catch (e) {
        totalErrors++;
        console.error(`  event ${evt.event_ticker}: ${e.message}`);
      }
    }
  }

  // Matchups (different data model) — run after binaries so tournaments exist
  const tournamentMap = await loadTournamentMap();
  for (const series of KALSHI_MATCHUP_SERIES) {
    try {
      const r = await ingestMatchupSeries(series, tournamentMap);
      totalQuotes += r.totalQuotes;
      totalErrors += r.totalErrors;
    } catch (e) {
      totalErrors++;
      console.error(`! ${series.ticker}: ${e.message}`);
    }
  }

  // Props (multi-outcome events)
  for (const series of KALSHI_PROP_SERIES) {
    try {
      const r = await ingestPropSeries(series, tournamentMap);
      totalQuotes += r.totalQuotes;
      totalErrors += r.totalErrors;
    } catch (e) {
      totalErrors++;
      console.error(`! ${series.ticker}: ${e.message}`);
    }
  }

  await supabase
    .from("golfodds_data_sources")
    .update({ last_import: new Date().toISOString(), record_count: totalQuotes })
    .eq("name", "kalshi");

  console.log(`\nDone. ${totalQuotes} total quotes inserted, ${totalErrors} errors across ${KALSHI_SERIES.length} binary + ${KALSHI_MATCHUP_SERIES.length} matchup + ${KALSHI_PROP_SERIES.length} prop series.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

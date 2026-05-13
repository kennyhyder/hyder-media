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
const SERIES_TICKER = "KXPGATOUR";

// Node 20 lacks native WebSocket; supply `ws` so Supabase client constructs.
// We don't use realtime here, but the SDK initializes it eagerly.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

// --- Helpers ---------------------------------------------------------------

const normalizeName = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Classify a Kalshi market into our taxonomy.
 * Kalshi's golf markets are predominantly per-golfer outright winner contracts.
 * Top 5/10/20 and make-cut markets appear inconsistently — usually only on majors.
 * We look at the event's title / market subtitle to infer the type.
 */
function classifyMarketType(eventTitle, marketSubtitle, marketTicker) {
  const haystack = `${eventTitle || ""} ${marketSubtitle || ""} ${marketTicker || ""}`.toLowerCase();
  if (/\btop\s*5\b/.test(haystack)) return "t5";
  if (/\btop\s*10\b/.test(haystack)) return "t10";
  if (/\btop\s*20\b/.test(haystack)) return "t20";
  if (/\bmake.*cut\b|\bmiss.*cut\b|\bmade.*cut\b/.test(haystack)) return "mc";
  if (/\bfirst\s*round\s*lead\b|\bfrl\b/.test(haystack)) return "frl";
  // Default: per-golfer winner binary
  return "win";
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

async function listGolfEvents() {
  // status=open returns active events; we paginate via cursor
  const events = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/events`);
    url.searchParams.set("series_ticker", SERIES_TICKER);
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

async function main() {
  console.log(`Fetching Kalshi ${SERIES_TICKER} events...`);
  const events = await listGolfEvents();
  console.log(`  Found ${events.length} open events`);

  let totalMarkets = 0;
  let totalQuotes = 0;
  let errors = 0;

  for (const evt of events) {
    try {
      const full = await fetchEvent(evt.event_ticker);
      const tournamentId = await upsertTournament(full.event || evt);
      const markets = await fetchMarketsForEvent(evt.event_ticker);
      console.log(`  ${evt.event_ticker}: ${markets.length} markets`);

      for (const m of markets) {
        const playerName = extractPlayerName(m);
        if (!playerName) continue;
        // Skip markets that aren't per-golfer (e.g. "Will rain delay play?")
        if (playerName.length > 40 || /\b(rain|weather|cut|delay|playoff)\b/i.test(playerName)) {
          continue;
        }
        try {
          const playerId = await upsertPlayer(playerName);
          const marketType = classifyMarketType(evt.title, m.subtitle, m.ticker);
          const marketId = await upsertMarket(tournamentId, playerId, marketType);
          await insertQuote(marketId, m);
          totalMarkets++;
          totalQuotes++;
        } catch (e) {
          errors++;
          console.error(`    ${m.ticker}: ${e.message}`);
        }
      }
    } catch (e) {
      errors++;
      console.error(`  event ${evt.event_ticker}: ${e.message}`);
    }
  }

  // Update data source stats
  await supabase
    .from("golfodds_data_sources")
    .update({ last_import: new Date().toISOString(), record_count: totalQuotes })
    .eq("name", "kalshi");

  console.log(`\nDone. ${totalMarkets} markets, ${totalQuotes} quotes inserted, ${errors} errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Shared helpers used by cron-ingest-sports.js and cron-detect-movements.js.
// Not deployed as an endpoint despite living in api/ (Vercel deploys every .js
// here, but underscore-prefixed conventionally indicates "library").

import { createClient } from "@supabase/supabase-js";

export const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// League config: which Kalshi series to pull per league, and what event_type
// each one represents in our sports_events.event_type column.
//
// event_type values used across UI + tier-gating:
//   game            single game money line
//   series          playoff series winner (best-of-N)
//   championship    overall season title (World Series, Stanley Cup, NBA Finals, etc.)
//   conference      conference / league title (AFC, NFC, EC, WC, AL, NL)
//   division        division winner (AL East, NFC West, etc.)
//   playoffs        make / miss playoffs (binary per-team)
//   record_best     best regular-season record
//   record_worst    worst regular-season record
//   win_total       team win total over/under
//   award           generic award (Cy Young, Hart, Norris, Vezina, CoY, RoY, DPoY)
//   mvp             MVP (kept as its own type so it ranks above generic awards)
//   trade           trade-related futures (one-off events; rarely book-comparable)
// Player-prop series — one entry per stat per league. Each Kalshi event
// is a (game × stat) combo; markets inside are (player × threshold). The
// props ingester upserts each market by kalshi_ticker and parses
// player + line + side from the market title/sub_title.
export const PROP_SERIES = [
  // NBA
  { league: "nba", ticker: "KXNBAPTS",  market_type: "player_prop_points",   stat_label: "Points" },
  { league: "nba", ticker: "KXNBAAST",  market_type: "player_prop_assists",  stat_label: "Assists" },
  { league: "nba", ticker: "KXNBASTL",  market_type: "player_prop_steals",   stat_label: "Steals" },
  { league: "nba", ticker: "KXNBAREB",  market_type: "player_prop_rebounds", stat_label: "Rebounds" },
  { league: "nba", ticker: "KXNBABLK",  market_type: "player_prop_blocks",   stat_label: "Blocks" },
  { league: "nba", ticker: "KXNBA3PM",  market_type: "player_prop_threes",   stat_label: "3-pointers made" },
  // MLB
  { league: "mlb", ticker: "KXMLBHIT",   market_type: "player_prop_hits",      stat_label: "Hits" },
  { league: "mlb", ticker: "KXMLBHR",    market_type: "player_prop_home_runs", stat_label: "Home runs" },
  { league: "mlb", ticker: "KXMLBSO",    market_type: "player_prop_strikeouts",stat_label: "Strikeouts (pitcher)" },
  { league: "mlb", ticker: "KXMLBRBI",   market_type: "player_prop_rbis",      stat_label: "RBIs" },
  // NHL
  { league: "nhl", ticker: "KXNHLPTS",   market_type: "player_prop_points",   stat_label: "Points" },
  { league: "nhl", ticker: "KXNHLSAVES", market_type: "player_prop_saves",    stat_label: "Saves" },
  { league: "nhl", ticker: "KXNHLANYGOAL", market_type: "player_prop_anytime_goal", stat_label: "Anytime goalscorer" },
  // NFL (game-time touchdown markets — player-level)
  { league: "nfl", ticker: "KXNFLGAMETD",       market_type: "player_prop_anytime_td", stat_label: "Anytime touchdown" },
  { league: "nfl", ticker: "KXNFLTEAMFIRSTTD",  market_type: "player_prop_first_td",   stat_label: "First touchdown scorer" },
  // EPL
  { league: "epl", ticker: "KXEPLANYGOAL",   market_type: "player_prop_anytime_goal", stat_label: "Anytime goalscorer" },
  { league: "epl", ticker: "KXEPLFIRSTGOAL", market_type: "player_prop_first_goal",   stat_label: "First goalscorer" },
];

// Series entries can specify either a literal `ticker` or a `prefix` that
// the ingester expands to every matching series via Kalshi's /series list
// (used for per-team season win totals like KXMLBWINS-BOS, KXMLBWINS-NYY, ...).
export const LEAGUES = [
  {
    key: "nba",
    series: [
      { ticker: "KXNBA",            event_type: "championship" },
      { ticker: "KXNBAGAME",        event_type: "game" },
      { ticker: "KXNBASERIES",      event_type: "series" },
      { ticker: "KXNBAEAST",        event_type: "conference" },
      { ticker: "KXNBAWEST",        event_type: "conference" },
      { ticker: "KXNBAEAST1SEED",   event_type: "division" },
      { ticker: "KXNBAWEST1SEED",   event_type: "division" },
      { ticker: "KXNBAMVP",         event_type: "mvp" },
      { ticker: "KXNBAFINMVP",      event_type: "mvp" },
      { ticker: "KXNBAFINALSMVP",   event_type: "mvp" },
      { ticker: "KXNBAEFINMVP",     event_type: "mvp" },
      { ticker: "KXNBAWFINMVP",     event_type: "mvp" },
      { ticker: "KXNBACOY",         event_type: "award" },
      { ticker: "KXNBADPOY",        event_type: "award" },
      { ticker: "KXNBAROY",         event_type: "award" },
      { ticker: "KXNBACLUTCH",      event_type: "award" },
      { ticker: "KXNBA1STTEAM",     event_type: "award" },
      { ticker: "KXNBADRAFTTEAM",   event_type: "trade" },
      { ticker: "KXNBADRAFTPICK",   event_type: "award" },
      { ticker: "KXNBADRAFTMATCHUP",event_type: "trade" },
      { ticker: "KXNBAWINS",        event_type: "win_total" },
      { ticker: "KXNBAPLAYOFFWINS", event_type: "win_total" },
      { ticker: "KXNBAPLAYOFF",     event_type: "playoffs" },
      { ticker: "KXNBAECFQUAL",     event_type: "playoffs" },
      { ticker: "KXNBAUNBEATEN",    event_type: "playoffs" },
      { ticker: "KXNBAMATCHUP",     event_type: "series" },
    ],
  },
  {
    key: "mlb",
    series: [
      { ticker: "KXMLB",              event_type: "championship" },
      { ticker: "KXMLBGAME",          event_type: "game" },
      { ticker: "KXMLBPLAYOFFS",      event_type: "playoffs" },
      { ticker: "KXMLBBESTRECORD",    event_type: "record_best" },
      { ticker: "KXMLBWORSTRECORD",   event_type: "record_worst" },
      { ticker: "KXMLBALMVP",         event_type: "mvp" },
      { ticker: "KXMLBNLMVP",         event_type: "mvp" },
      { ticker: "KXMLBALCY",          event_type: "award" },
      { ticker: "KXMLBNLCY",          event_type: "award" },
      { ticker: "KXMLBALCPOTY",       event_type: "award" },
      { ticker: "KXMLBNLCPOTY",       event_type: "award" },
      { ticker: "KXMLBWSMVP",         event_type: "mvp" },
      { ticker: "KXMLBALEAST",        event_type: "division" },
      { ticker: "KXMLBALWEST",        event_type: "division" },
      { ticker: "KXMLBNLEAST",        event_type: "division" },
      { ticker: "KXMLBNLWEST",        event_type: "division" },
      { ticker: "KXMLBTRADE",         event_type: "trade" },
      { prefix: "KXMLBWINS-",         event_type: "win_total" },
    ],
  },
  {
    key: "nhl",
    series: [
      { ticker: "KXNHL",              event_type: "championship" },
      { ticker: "KXNHLGAME",          event_type: "game" },
      { ticker: "KXNHLSERIES",        event_type: "series" },
      { ticker: "KXNHLEAST",          event_type: "conference" },
      { ticker: "KXNHLWEST",          event_type: "conference" },
      { ticker: "KXNHLPACIFIC",       event_type: "division" },
      { ticker: "KXNHLCENTRAL",       event_type: "division" },
      { ticker: "KXNHLATLANTIC",      event_type: "division" },
      { ticker: "KXNHLMETROPOLITAN",  event_type: "division" },
      { ticker: "KXNHLHART",          event_type: "mvp" },
      { ticker: "KXNHLNORRIS",        event_type: "award" },
      { ticker: "KXNHLVEZINA",        event_type: "award" },
      { ticker: "KXNHLROSS",          event_type: "award" },
      { ticker: "KXNHLRICHARD",       event_type: "award" },
      { ticker: "KXNHL1STTEAM",       event_type: "award" },
      { ticker: "KXNHLWINS",          event_type: "win_total" },
    ],
  },
  {
    key: "nfl",
    series: [
      { ticker: "KXNFLGAME",      event_type: "game" },
      { ticker: "KXNFLMVP",       event_type: "mvp" },
      { ticker: "KXNFLSBMVP",     event_type: "mvp" },
      { ticker: "KXNFLDPOY",      event_type: "award" },
      { ticker: "KXNFLOPOY",      event_type: "award" },
      { ticker: "KXNFLAFCCHAMP",  event_type: "conference" },
      { ticker: "KXNFLNFCCHAMP",  event_type: "conference" },
      { ticker: "KXNFLAFCEAST",   event_type: "division" },
      { ticker: "KXNFLAFCWEST",   event_type: "division" },
      { ticker: "KXNFLAFCNORTH",  event_type: "division" },
      { ticker: "KXNFLAFCSOUTH",  event_type: "division" },
      { ticker: "KXNFLNFCEAST",   event_type: "division" },
      { ticker: "KXNFLNFCWEST",   event_type: "division" },
      { ticker: "KXNFLNFCNORTH",  event_type: "division" },
      { ticker: "KXNFLNFCSOUTH",  event_type: "division" },
      { prefix: "KXNFLWINS-",     event_type: "win_total" },
    ],
  },
  {
    key: "epl",
    series: [
      { ticker: "KXEPLGAME",        event_type: "game" },
      { ticker: "KXEPLTOP2",        event_type: "playoffs" },
      { ticker: "KXEPLTOP4",        event_type: "playoffs" },
      { ticker: "KXEPLTOP6",        event_type: "playoffs" },
      { ticker: "KXEPLRELEGATION",  event_type: "playoffs" },
      { ticker: "KXEPLPOY",         event_type: "award" },
    ],
  },
  {
    key: "mls",
    series: [
      { ticker: "KXMLSGAME",    event_type: "game" },
      { ticker: "KXMLSCUP",     event_type: "championship" },
      { ticker: "KXMLSEAST",    event_type: "conference" },
      { ticker: "KXMLSWEST",    event_type: "conference" },
    ],
  },
  {
    key: "ucl",
    series: [
      { ticker: "KXUCL",        event_type: "championship" },
      { ticker: "KXUCLGAME",    event_type: "game" },
    ],
  },
  {
    key: "wc",
    series: [
      { ticker: "KXWCGAME",     event_type: "game" },
    ],
  },
];

export function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export const normalizeName = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

// URL-safe slug for SEO permalinks. Mirrors the sb_slugify() Postgres function
// so cron writes and DB backfill produce identical slugs.
export function slugify(s) {
  if (!s) return null;
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || null;
}

export function toUnit(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function toBigInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function computeImplied(yesBid, yesAsk, last) {
  // Trust bid/ask midpoint ONLY when both sides have real liquidity:
  //   - yesBid > 0 (someone wants to buy)
  //   - yesAsk < 1 (someone wants to sell below ceiling)
  //   - spread <= 10¢ (tight market — bid and ask agree)
  // A one-sided dust quote (bid=0, ask=$0.02) is NOT a price — averaging it
  // produces 1% phantom edges that don't exist. Return null and let the UI
  // show "—" rather than fabricate a number.
  if (yesBid != null && yesAsk != null
      && yesBid > 0 && yesAsk > yesBid
      && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
  if (last != null && last > 0 && last < 1) return last;
  return null;
}

// Throttled fetch helper with 429 backoff
async function fetchJSON(url, attempt = 0) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (r.status === 429 && attempt < 4) {
    await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
    return fetchJSON(url, attempt + 1);
  }
  if (!r.ok) throw new Error(`Kalshi ${r.status} ${url}: ${await r.text().catch(() => "")}`);
  return r.json();
}

// Given a series-ticker prefix (e.g. "KXMLBWINS-"), return every matching
// series ticker on Kalshi. Used to expand per-team configs into the full
// roster (KXMLBWINS-BOS, KXMLBWINS-NYY, ...) without hardcoding 30 entries.
// Cached in-process for the lifetime of one cron run.
let _seriesCache = null;
export async function listSeriesByPrefix(prefix) {
  if (!_seriesCache) {
    const url = new URL(`${KALSHI_BASE}/series`);
    url.searchParams.set("category", "Sports");
    url.searchParams.set("limit", "200");
    const data = await fetchJSON(url.toString());
    _seriesCache = (data.series || []).map((s) => s.ticker);
  }
  return _seriesCache.filter((t) => t.startsWith(prefix));
}

export async function listEventsForSeries(seriesTicker) {
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

export async function fetchMarketsForEvent(eventTicker) {
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

// Bounded-concurrency fetch
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Shared helpers used by cron-ingest-sports.js and cron-detect-movements.js.
// Not deployed as an endpoint despite living in api/ (Vercel deploys every .js
// here, but underscore-prefixed conventionally indicates "library").

import { createClient } from "@supabase/supabase-js";

export const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// League config: which Kalshi series to pull per league, and what event_type
// each one represents in our sports_events.event_type column.
export const LEAGUES = [
  {
    key: "nba",
    series: [
      { ticker: "KXNBA",        event_type: "championship" },
      { ticker: "KXNBAGAME",    event_type: "game" },
      { ticker: "KXNBASERIES",  event_type: "series" },
      { ticker: "KXNBAMVP",     event_type: "mvp" },
    ],
  },
  {
    key: "mlb",
    series: [
      { ticker: "KXMLB",        event_type: "championship" },
      { ticker: "KXMLBGAME",    event_type: "game" },
    ],
  },
  {
    key: "nhl",
    series: [
      { ticker: "KXNHL",        event_type: "championship" },
      { ticker: "KXNHLGAME",    event_type: "game" },
    ],
  },
  {
    key: "epl",
    series: [
      { ticker: "KXEPLGAME",    event_type: "game" },
    ],
  },
  {
    key: "mls",
    series: [
      { ticker: "KXMLSGAME",    event_type: "game" },
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
  // Same logic as golfodds — only trust bid/ask midpoint when BOTH sides have
  // real liquidity. Otherwise fall back to last trade. Prevents 0/1¢ dust
  // asks (no real buyer) from being read as 0.5% probability.
  if (yesBid != null && yesAsk != null
      && yesBid > 0 && yesAsk > yesBid
      && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
  if (last != null && last > 0 && last < 1) return last;
  if (yesBid != null && yesAsk != null && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
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

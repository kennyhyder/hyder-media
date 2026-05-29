// Live-data fetcher for the /sportsbooks/[slug] comparison pages.
// Pulls the freshest events across leagues, attaches per-book quotes
// (or per-exchange overlay) so the comparison page can render a real
// table instead of a stale stub.

import { createClient } from "@supabase/supabase-js";
import { isRegulatedUS, bucketBookPriceMap } from "./books";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export interface ComparisonEvent {
  event_id: string;
  league: string;
  league_display: string;
  title: string;
  start_time: string | null;
  slug: string | null;
  season_year: number | null;
  contestants: Array<{
    contestant: string;
    kalshi_pct: number | null;
    polymarket_pct: number | null;
    book_prices: Record<string, { american: number | null; novig: number | null }>;
  }>;
}

const LEAGUE_DISPLAY: Record<string, string> = {
  nba: "NBA", mlb: "MLB", nhl: "NHL", nfl: "NFL", ncaaf: "College Football",
  epl: "EPL", mls: "MLS", ucl: "Champions League", wc: "World Cup",
};

// Pulls the next N events per league for a given comparison context.
// For book-vs-book pages we need quotes from BOTH books per event; for
// kalshi-vs-X we need Kalshi quote + that book's quote. The query is
// the same — we let the page filter the per-row book_prices to only
// the relevant subset.
export async function fetchComparisonEvents({
  bookKeys,         // which sportsbook keys to include in book_prices (already filtered to regulated)
  perLeagueLimit = 5,
  leagues = ["mlb", "nba", "nfl", "nhl", "ncaaf"],
}: {
  bookKeys: string[];
  perLeagueLimit?: number;
  leagues?: string[];
}): Promise<ComparisonEvent[]> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  // Next 72h of open games — anything further out has thin book coverage.
  const horizon = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

  // Pull open game events across requested leagues, sorted by start_time ASC
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, league, title, start_time, slug, season_year, event_type, status")
    .in("league", leagues)
    .eq("status", "open")
    .eq("event_type", "game")
    .gte("start_time", now)
    .lte("start_time", horizon)
    .order("start_time", { ascending: true })
    .limit(perLeagueLimit * leagues.length);
  if (!events?.length) return [];

  // Cap per-league
  const byLeague = new Map<string, typeof events>();
  for (const e of events) {
    if (!byLeague.has(e.league)) byLeague.set(e.league, []);
    if (byLeague.get(e.league)!.length < perLeagueLimit) byLeague.get(e.league)!.push(e);
  }
  const capped = Array.from(byLeague.values()).flat();
  if (!capped.length) return [];

  const eventIds = capped.map((e) => e.id);

  // Pull winner markets per event
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_label, contestant_norm")
    .in("event_id", eventIds)
    .eq("market_type", "winner")
    .limit(eventIds.length * 4);
  if (!markets?.length) return [];

  const marketIds = markets.map((m) => m.id);
  const marketByKey = new Map(markets.map((m) => [`${m.event_id}|${m.contestant_norm}`, m]));

  // Kalshi latest per market
  const { data: kQuotes } = await supabase
    .from("sports_quotes_latest")
    .select("market_id, implied_prob")
    .in("market_id", marketIds);
  const kByMarket = new Map((kQuotes || []).map((q) => [q.market_id, q]));

  // Book quotes — only requested books (regulated keys) plus any offshore
  // for "other" aggregation. Pull last 24h, dedupe by latest fetched_at per
  // (event, contestant, book).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: bookQuotes } = await supabase
    .from("sports_book_quotes")
    .select("sports_event_id, contestant_norm, book, american, implied_prob_novig, fetched_at")
    .in("sports_event_id", eventIds)
    .eq("market_type", "h2h")
    .gte("fetched_at", since);

  // Polymarket overlay
  const { data: polyQuotes } = await supabase
    .from("sports_polymarket_quotes")
    .select("sports_event_id, contestant_norm, implied_prob, fetched_at")
    .in("sports_event_id", eventIds)
    .gte("fetched_at", since);
  const polyByKey = new Map<string, number>();
  for (const p of polyQuotes || []) {
    const key = `${p.sports_event_id}|${p.contestant_norm}`;
    if (!polyByKey.has(key)) polyByKey.set(key, Number(p.implied_prob));
  }

  // Pivot book quotes: latest per (event_id|contestant_norm|book)
  type BookPriceRow = { american: number | null; novig: number | null };
  const bookPivot = new Map<string, Map<string, BookPriceRow>>();
  for (const b of bookQuotes || []) {
    const ckey = `${b.sports_event_id}|${b.contestant_norm}`;
    if (!bookPivot.has(ckey)) bookPivot.set(ckey, new Map());
    const inner = bookPivot.get(ckey)!;
    inner.set(b.book, { american: b.american, novig: b.implied_prob_novig ? Number(b.implied_prob_novig) : null });
  }

  // Build the rows
  const out: ComparisonEvent[] = capped.map((e) => {
    const eventMarkets = markets.filter((m) => m.event_id === e.id);
    const contestants = eventMarkets.map((m) => {
      const ckey = `${e.id}|${m.contestant_norm}`;
      const rawBook = bookPivot.get(ckey) || new Map();
      const rawBookObj: Record<string, BookPriceRow> = {};
      for (const [k, v] of rawBook) rawBookObj[k] = v;
      // Bucket so offshore quotes contribute as "other"
      const bucketed = bucketBookPriceMap(rawBookObj);
      // Filter book_prices to only the requested books + always keep "other"
      const filtered: Record<string, BookPriceRow> = {};
      for (const k of Object.keys(bucketed)) {
        if (k === "other" || bookKeys.includes(k)) filtered[k] = bucketed[k];
      }
      const kq = kByMarket.get(m.id);
      return {
        contestant: m.contestant_label,
        kalshi_pct: kq?.implied_prob != null ? Number(kq.implied_prob) : null,
        polymarket_pct: polyByKey.get(ckey) ?? null,
        book_prices: filtered,
      };
    });
    return {
      event_id: e.id,
      league: e.league,
      league_display: LEAGUE_DISPLAY[e.league] || e.league.toUpperCase(),
      title: e.title,
      start_time: e.start_time,
      slug: e.slug,
      season_year: e.season_year,
      contestants,
    };
  });

  // Drop rows where neither requested book has data + no kalshi (low signal)
  return out.filter((r) =>
    r.contestants.some((c) =>
      c.kalshi_pct != null ||
      Object.keys(c.book_prices).some((k) => k !== "other" && c.book_prices[k]?.novig != null)
    )
  );
}

// 30-day Kalshi price spark for an arbitrary market (used in the historical
// chart section of comparison pages). Returns daily-averaged implied_prob
// for the latest market the page chose to feature.
export async function fetchKalshiHistoricalSpark(marketId: string): Promise<Array<{ day: string; prob: number }>> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("sports_quotes")
    .select("implied_prob, fetched_at")
    .eq("market_id", marketId)
    .gte("fetched_at", since)
    .order("fetched_at", { ascending: true });
  if (!data?.length) return [];
  // Daily-average
  const byDay = new Map<string, number[]>();
  for (const q of data) {
    const day = (q.fetched_at as string).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(Number(q.implied_prob));
  }
  return Array.from(byDay.entries())
    .map(([day, arr]) => ({ day, prob: arr.reduce((a, b) => a + b, 0) / arr.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

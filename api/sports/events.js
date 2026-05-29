import { createClient } from "@supabase/supabase-js";
import { bucketBookPriceMap, bucketBookEntries, isRegulatedUS } from "./_book_classification.js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/events?league=nba&status=open&with=markets
// When ?with=markets is passed, each event includes its winner markets with
// Kalshi probs + book consensus inline (books_median, book_count, edges).
// League listing pages use this so users see all games on one screen
// without having to drill in.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const league = req.query.league;
  const status = req.query.status || "open";
  const withMarkets = req.query.with === "markets";
  if (!league) return res.status(400).json({ error: "league required" });

  try {
    const supabase = getSupabase();
    const { data: events } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker")
      .eq("league", league)
      .eq("status", status)
      .order("start_time", { ascending: true, nullsFirst: false })
      .range(0, 199);

    if (!withMarkets || !events?.length) {
      return res.status(200).json({ events: events || [] });
    }

    const eventIds = events.map((e) => e.id);

    // Explicit ranges — PostgREST defaults to 1000 rows per request. The
    // markets query for NBA alone returns ~1200 winner markets, so without
    // .range() the championship's 30 contestants got silently dropped and
    // the card rendered "No markets yet". 10000 is a safe ceiling: a busy
    // league won't exceed it short-term, and a single Supabase response of
    // ~10K rows is still well under the 6MB body limit.
    const [{ data: markets }, { data: bookQuotes }, { data: polymarketQuotes }] = await Promise.all([
      supabase
        .from("sports_markets")
        .select("id, event_id, contestant_label, market_type")
        .in("event_id", eventIds)
        .eq("market_type", "winner")
        .range(0, 9999),
      supabase
        .from("sports_book_v_latest")
        // fetched_at is required for the staleness filter on line ~121.
        // Without it `b.fetched_at` is undefined → freshBook short-circuits
        // to true → stale (e.g. 3h-old) offshore quotes get mixed with
        // fresh in-game regulated quotes, producing misleading "Other"
        // median (saw 56.9% on Texas when fresh offshore would be ~12%).
        .select("sports_event_id, contestant_norm, book, implied_prob_novig, american, market_type, fetched_at")
        .in("sports_event_id", eventIds)
        .in("market_type", ["h2h", "outrights"])
        .range(0, 9999),
      supabase
        .from("sports_polymarket_v_latest")
        .select("sports_event_id, contestant_norm, implied_prob, volume_usd")
        .in("sports_event_id", eventIds)
        .range(0, 9999),
    ]);

    // 30-min staleness filter — drop quotes that haven't refreshed in one
    // cron cycle. Prevents stale book/polymarket data from creating fake edges
    // when the actual market has moved (books update live during games).
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    const nowMs = Date.now();
    const freshBook = (row) => !row?.fetched_at || (nowMs - new Date(row.fetched_at).getTime()) <= STALE_THRESHOLD_MS;

    // Index polymarket by (event_id, contestant_norm) — age-filtered
    const polyByEventContestant = new Map();
    for (const p of polymarketQuotes || []) {
      if (freshBook(p)) polyByEventContestant.set(`${p.sports_event_id}|${p.contestant_norm}`, p);
    }

    // Chunk the kalshi-quotes lookup — a single .in() with 969 UUIDs
    // produces a ~36KB URL that Supabase's gateway rejects with HTTP 400,
    // silently returning no rows and leaving every market with
    // implied_prob=null. 150 IDs per batch keeps each URL under ~6KB.
    const marketIds = (markets || []).map((m) => m.id);
    const kalshiQuotes = [];
    const CHUNK = 150;
    for (let i = 0; i < marketIds.length; i += CHUNK) {
      const slice = marketIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("sports_quotes_latest")
        .select("market_id, implied_prob, yes_bid, yes_ask, fetched_at")
        .in("market_id", slice);
      if (data) kalshiQuotes.push(...data);
    }

    // Track page-level freshness across all data sources for the response.
    // Used by the league index page header + dateModified JSON-LD.
    let pageFreshest = 0;
    for (const q of kalshiQuotes) {
      if (q.fetched_at) {
        const t = new Date(q.fetched_at).getTime();
        if (t > pageFreshest) pageFreshest = t;
      }
    }
    for (const b of bookQuotes || []) {
      if (b.fetched_at) {
        const t = new Date(b.fetched_at).getTime();
        if (t > pageFreshest) pageFreshest = t;
      }
    }
    for (const p of polymarketQuotes || []) {
      if (p.fetched_at) {
        const t = new Date(p.fetched_at).getTime();
        if (t > pageFreshest) pageFreshest = t;
      }
    }

    const qByMarket = new Map(kalshiQuotes.map((q) => [q.market_id, q]));
    // Group book quotes by (event_id, contestant_norm) — age-filtered
    const booksByEventContestant = new Map();
    for (const b of bookQuotes || []) {
      if (!freshBook(b)) continue;
      const key = `${b.sports_event_id}|${b.contestant_norm}`;
      const arr = booksByEventContestant.get(key) || [];
      arr.push({
        book: b.book,
        implied_prob_novig: b.implied_prob_novig != null ? Number(b.implied_prob_novig) : null,
        american: b.american,
      });
      booksByEventContestant.set(key, arr);
    }

    const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

    // Collect the union of books seen across all events for this league
    const booksSeen = new Set();

    // Group markets by event
    const marketsByEvent = new Map();
    for (const m of markets || []) {
      const arr = marketsByEvent.get(m.event_id) || [];
      const q = qByMarket.get(m.id);
      const norm = normalize(m.contestant_label);
      const bookList = booksByEventContestant.get(`${m.event_id}|${norm}`) || [];
      const novigs = bookList.map((b) => b.implied_prob_novig).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const median = novigs.length ? novigs[Math.floor(novigs.length / 2)] : null;
      const minProb = novigs.length ? novigs[0] : null;
      const kalshi = q?.implied_prob ?? null;
      const edge = (kalshi != null && median != null) ? Number((median - kalshi).toFixed(5)) : null;
      // best book = lowest no-vig prob (cheapest YES → longest American).
      // Bucket offshore books into "other" so we don't surface offshore
      // brand names as the "best" pointer.
      let bestBook = null;
      const sourceForBest = bucketBookEntries(bookList.map((b) => ({ book: b.book, implied_prob_novig: b.implied_prob_novig, american: b.american })));
      const sorted = sourceForBest.filter((b) => b.implied_prob_novig != null).sort((a, b) => a.implied_prob_novig - b.implied_prob_novig);
      if (sorted.length) bestBook = sorted[0];
      const edgeBest = (kalshi != null && bestBook?.implied_prob_novig != null) ? Number((bestBook.implied_prob_novig - kalshi).toFixed(5)) : null;

      // book_prices: stable map by book key, lookup at render time. Bucket
      // offshore brands into a single aggregated "other" entry — never named.
      const rawBookPrices = {};
      for (const b of bookList) rawBookPrices[b.book] = { american: b.american, novig: b.implied_prob_novig };
      const bookPrices = bucketBookPriceMap(rawBookPrices);

      // booksSeen tracks the columns the frontend renders in the table.
      // Populate from BUCKETED keys (regulated names + a single "other"),
      // not from raw — otherwise each offshore book name produced its own
      // "Other" column because they all bookLabel() → "Other".
      for (const k of Object.keys(bookPrices)) booksSeen.add(k);

      // Polymarket overlay for this contestant on this event
      const poly = polyByEventContestant.get(`${m.event_id}|${norm}`);
      const polyProb = poly?.implied_prob != null ? Number(poly.implied_prob) : null;
      const edgeKalshiVsPoly = (kalshi != null && polyProb != null) ? Number((polyProb - kalshi).toFixed(5)) : null;

      arr.push({
        id: m.id,
        contestant_label: m.contestant_label,
        implied_prob: kalshi,
        yes_bid: q?.yes_bid ?? null,
        yes_ask: q?.yes_ask ?? null,
        books_count: novigs.length,
        books_median: median,
        books_min: minProb,
        edge_vs_books_median: edge,
        edge_vs_best_book: edgeBest,
        best_book: bestBook,
        book_prices: bookPrices,
        polymarket_prob: polyProb,
        polymarket_volume_usd: poly?.volume_usd != null ? Number(poly.volume_usd) : null,
        edge_kalshi_vs_polymarket: edgeKalshiVsPoly,
      });
      marketsByEvent.set(m.event_id, arr);
    }

    const enriched = events.map((e) => ({
      ...e,
      markets: marketsByEvent.get(e.id) || [],
    }));

    return res.status(200).json({
      events: enriched,
      books: Array.from(booksSeen).sort(),
      freshest_at: pageFreshest ? new Date(pageFreshest).toISOString() : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

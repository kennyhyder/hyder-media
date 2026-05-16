import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Extract (date, teams) from a Kalshi ticker so we can match a game event
// to its related player-prop events. Game tickers carry a 4-char HHMM time
// that prop tickers omit, so we strip it.
//   game:  KXNBAGAME-26MAY161810CINCLE  → 26MAY16 + CINCLE
//   prop:  KXNBASTL-26MAY16CINCLE        → 26MAY16 + CINCLE
function gameTickerMatchKey(ticker) {
  if (!ticker) return null;
  const m = ticker.match(/-(\d{2}[A-Z]{3}\d{2})\d{4}([A-Z]+)$/);
  return m ? m[1] + m[2] : null;
}
function propTickerMatchKey(ticker) {
  if (!ticker) return null;
  const m = ticker.match(/-(\d{2}[A-Z]{3}\d{2})([A-Z]+)$/);
  return m ? m[1] + m[2] : null;
}

async function fetchRelatedProps(supabase, gameEvent) {
  const key = gameTickerMatchKey(gameEvent.kalshi_event_ticker);
  if (!key) return [];
  // Get every open prop event in this league whose ticker matches the same
  // date+teams pattern. With ~150-200 prop events per league we can fetch
  // and filter in memory rather than constructing a regex query.
  const { data: candidates } = await supabase
    .from("sports_events")
    .select("id, event_type, title, kalshi_event_ticker")
    .eq("league", gameEvent.league)
    .like("event_type", "player_prop_%")
    .eq("status", "open");
  const matches = (candidates || []).filter((e) => propTickerMatchKey(e.kalshi_event_ticker) === key);
  if (!matches.length) return [];

  // Pull markets + Kalshi quotes for the matched prop events
  const propEventIds = matches.map((e) => e.id);
  const { data: propMarkets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_label, market_type, prop_line, prop_side, kalshi_ticker")
    .in("event_id", propEventIds);
  const marketIds = (propMarkets || []).map((m) => m.id);
  let kalshiQuotes = [];
  const CHUNK = 150;
  for (let i = 0; i < marketIds.length; i += CHUNK) {
    const slice = marketIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("sports_quotes_latest")
      .select("market_id, implied_prob, yes_bid, yes_ask")
      .in("market_id", slice);
    if (data) kalshiQuotes.push(...data);
  }
  const qByMarket = new Map(kalshiQuotes.map((q) => [q.market_id, q]));

  // Group markets by prop event, then by player within each event so the
  // UI can render "Player → list of thresholds" cleanly.
  const out = [];
  for (const evt of matches) {
    const evtMarkets = (propMarkets || []).filter((m) => m.event_id === evt.id);
    const byPlayer = new Map();
    for (const m of evtMarkets) {
      const q = qByMarket.get(m.id);
      const ip = q?.implied_prob != null ? Number(q.implied_prob) : null;
      if (!byPlayer.has(m.contestant_label)) byPlayer.set(m.contestant_label, []);
      byPlayer.get(m.contestant_label).push({
        prop_line: m.prop_line != null ? Number(m.prop_line) : null,
        prop_side: m.prop_side,
        implied_prob: ip,
        kalshi_ticker: m.kalshi_ticker,
      });
    }
    // Sort each player's thresholds low → high
    for (const list of byPlayer.values()) {
      list.sort((a, b) => (a.prop_line ?? 0) - (b.prop_line ?? 0));
    }
    // Sort players by their highest implied_prob (most interesting first)
    const players = Array.from(byPlayer.entries())
      .map(([name, thresholds]) => ({
        name,
        thresholds,
        max_prob: thresholds.reduce((mx, t) => Math.max(mx, t.implied_prob ?? 0), 0),
      }))
      .sort((a, b) => b.max_prob - a.max_prob);
    out.push({
      id: evt.id,
      event_type: evt.event_type,
      title: evt.title,
      kalshi_event_ticker: evt.kalshi_event_ticker,
      players,
    });
  }
  return out;
}

// GET /api/sports/event?id=<uuid>
// Returns event + each Kalshi market overlaid with sportsbook consensus
// (h2h) AND separate spreads/totals tables aggregated from
// sports_book_v_latest for that event.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const { data: event } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker")
      .eq("id", id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "not found" });

    const { data: markets } = await supabase
      .from("sports_markets")
      .select("id, contestant_label, market_type, kalshi_ticker")
      .eq("event_id", id);

    // Pull all book quotes for this event in one query, then split by market_type
    const [{ data: allBookQuotes }, { data: polymarketQuotes }] = await Promise.all([
      supabase
        .from("sports_book_v_latest")
        .select("contestant_label, contestant_norm, market_type, book, implied_prob_novig, american, point, fetched_at")
        .eq("sports_event_id", id),
      supabase
        .from("sports_polymarket_v_latest")
        .select("contestant_label, contestant_norm, yes_price, no_price, implied_prob, volume_usd, fetched_at")
        .eq("sports_event_id", id),
    ]);

    // Drop any book or polymarket quote older than 30 min — books update
    // live during games and our cron is 30 min, so anything beyond one
    // cycle is likely stale (e.g. game ended, book closed market) and
    // shouldn't drive an edge calculation against the moving Kalshi tick.
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    const nowMs = Date.now();
    const fresh = (row) => !row?.fetched_at || (nowMs - new Date(row.fetched_at).getTime()) <= STALE_THRESHOLD_MS;

    const h2hQuotes = (allBookQuotes || []).filter((b) => b.market_type === "h2h" && fresh(b));
    const spreadsQuotes = (allBookQuotes || []).filter((b) => b.market_type === "spreads" && fresh(b));
    const totalsQuotes = (allBookQuotes || []).filter((b) => b.market_type === "totals" && fresh(b));

    // Index polymarket quotes by contestant (also age-filtered)
    const polyByContestant = new Map();
    for (const p of polymarketQuotes || []) {
      if (fresh(p)) polyByContestant.set(p.contestant_norm, p);
    }

    // Kalshi quotes for each market
    let marketsWithQuotes = markets || [];
    if (marketsWithQuotes.length > 0) {
      const ids = marketsWithQuotes.map((m) => m.id);
      const { data: kalshiQuotes } = await supabase
        .from("sports_quotes_latest")
        .select("market_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at")
        .in("market_id", ids);

      const qByMarket = new Map((kalshiQuotes || []).map((q) => [q.market_id, q]));
      const booksByContestant = new Map();
      for (const b of h2hQuotes) {
        const arr = booksByContestant.get(b.contestant_norm) || [];
        arr.push(b);
        booksByContestant.set(b.contestant_norm, arr);
      }

      marketsWithQuotes = marketsWithQuotes.map((m) => {
        const q = qByMarket.get(m.id);
        const labelNorm = (m.contestant_label || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const books = (booksByContestant.get(labelNorm) || []).map((b) => ({
          book: b.book,
          implied_prob_novig: b.implied_prob_novig != null ? Number(b.implied_prob_novig) : null,
          american: b.american,
          fetched_at: b.fetched_at,
        }));
        const novigs = books.map((b) => b.implied_prob_novig).filter((v) => v != null).sort((a, b) => a - b);
        const median = novigs.length ? novigs[Math.floor(novigs.length / 2)] : null;
        let bestBook = null;
        const sortedBest = [...books].filter((b) => b.implied_prob_novig != null).sort((a, b) => a.implied_prob_novig - b.implied_prob_novig);
        if (sortedBest.length) bestBook = { book: sortedBest[0].book, implied_prob_novig: sortedBest[0].implied_prob_novig, american: sortedBest[0].american };
        const kalshi = q?.implied_prob ?? null;
        const edge_vs_median = (kalshi != null && median != null) ? Number((median - kalshi).toFixed(5)) : null;
        const edge_vs_best = (kalshi != null && bestBook?.implied_prob_novig != null) ? Number((bestBook.implied_prob_novig - kalshi).toFixed(5)) : null;

        // Polymarket quote (if any) for this contestant
        const poly = polyByContestant.get(labelNorm);
        const polyProb = poly?.implied_prob != null ? Number(poly.implied_prob) : null;
        const edge_kalshi_vs_polymarket = (kalshi != null && polyProb != null) ? Number((polyProb - kalshi).toFixed(5)) : null;
        const edge_polymarket_vs_books = (polyProb != null && median != null) ? Number((median - polyProb).toFixed(5)) : null;

        return {
          id: m.id,
          contestant_label: m.contestant_label,
          market_type: m.market_type,
          kalshi_ticker: m.kalshi_ticker,
          implied_prob: kalshi,
          yes_bid: q?.yes_bid ?? null,
          yes_ask: q?.yes_ask ?? null,
          last_price: q?.last_price ?? null,
          fetched_at: q?.fetched_at ?? null,
          books_count: books.length,
          books_median: median,
          books_min: novigs.length ? novigs[0] : null,
          books_max: novigs.length ? novigs[novigs.length - 1] : null,
          book_prices: books,
          best_book: bestBook,
          edge_vs_books_median: edge_vs_median,
          edge_vs_best_book: edge_vs_best,
          // Polymarket — second peer-to-peer exchange comparison
          polymarket_prob: polyProb,
          polymarket_volume_usd: poly?.volume_usd ? Number(poly.volume_usd) : null,
          edge_kalshi_vs_polymarket,   // positive = Polymarket sees it as more likely than Kalshi
          edge_polymarket_vs_books,    // positive = books see it as more likely than Polymarket
        };
      });
      marketsWithQuotes.sort((a, b) => (b.implied_prob ?? 0) - (a.implied_prob ?? 0));
    }

    // Build spreads table: group by team label, then for each team list each
    // book's spread + price. UI renders two rows (home / away) with per-book columns.
    const spreadsByTeam = {};
    for (const b of spreadsQuotes) {
      if (!spreadsByTeam[b.contestant_norm]) {
        spreadsByTeam[b.contestant_norm] = { label: b.contestant_label, books: {} };
      }
      spreadsByTeam[b.contestant_norm].books[b.book] = {
        point: b.point != null ? Number(b.point) : null,
        american: b.american,
        implied_prob_novig: b.implied_prob_novig != null ? Number(b.implied_prob_novig) : null,
      };
    }
    const spreads = Object.values(spreadsByTeam);

    // Totals: group by (point, side). Each book has its own primary line
    // — pick the median point as the "consensus line" and show all books at
    // that line + ±0.5 from it.
    const totalsByPointSide = {};
    for (const b of totalsQuotes) {
      const k = `${b.point}|${b.contestant_norm}`;
      if (!totalsByPointSide[k]) {
        totalsByPointSide[k] = { point: b.point != null ? Number(b.point) : null, side: b.contestant_label, books: {} };
      }
      totalsByPointSide[k].books[b.book] = {
        american: b.american,
        implied_prob_novig: b.implied_prob_novig != null ? Number(b.implied_prob_novig) : null,
      };
    }
    const totals = Object.values(totalsByPointSide).sort((a, b) => {
      if (a.point !== b.point) return (a.point ?? 0) - (b.point ?? 0);
      return a.side.localeCompare(b.side);
    });

    // For game events, fetch related player-prop events keyed on date+teams
    // so the UI can show "props for THIS game" under the H2H/spreads/totals.
    let propEvents = [];
    if (event.event_type === "game") {
      propEvents = await fetchRelatedProps(supabase, event).catch(() => []);
    }

    return res.status(200).json({
      event,
      markets: marketsWithQuotes,
      spreads,
      totals,
      prop_events: propEvents,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

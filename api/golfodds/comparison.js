import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Supabase REST caps at 1000 rows per query AND has a URL-length ceiling that
// caps `.in()` lists at ~100-200 IDs. Chunk the IDs into small batches, then
// paginate within each batch to bypass the row cap.
async function fetchAllIn(query, marketIds, idChunkSize = 100, rowPageSize = 1000) {
  const out = [];
  for (let i = 0; i < marketIds.length; i += idChunkSize) {
    const chunk = marketIds.slice(i, i + idChunkSize);
    let page = 0;
    while (true) {
      const start = page * rowPageSize;
      const { data, error } = await query().in("market_id", chunk).range(start, start + rowPageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      out.push(...data);
      if (data.length < rowPageSize) break;
      page++;
    }
  }
  return out;
}

function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * GET /api/golfodds/comparison?tournament_id=<uuid>&market_type=win
 *
 * Per-player Kalshi vs DataGolf-model vs per-book no-vig probabilities for one
 * (tournament, market_type) pair, with edge calculations and best-book signals.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tournamentId = req.query.tournament_id;
  const marketType = req.query.market_type || "win";
  if (!tournamentId) return res.status(400).json({ error: "tournament_id required" });

  try {
    const supabase = getSupabase();

    const { data: markets, error: mErr } = await supabase
      .from("golfodds_markets")
      .select("id, player_id, market_type, golfodds_players(id, name, dg_id, owgr_rank)")
      .eq("tournament_id", tournamentId)
      .eq("market_type", marketType)
      .range(0, 9999);
    if (mErr) return res.status(500).json({ error: mErr.message });
    if (!markets?.length) return res.status(200).json({ market_type: marketType, players: [], books: [] });

    const marketIds = markets.map((m) => m.id);

    // Use pagination helper to bypass the 1000-row cap on view queries.
    const [kalshiRows, dgRows, bookRows] = await Promise.all([
      fetchAllIn(() => supabase.from("golfodds_v_latest_kalshi").select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at"), marketIds),
      fetchAllIn(() => supabase.from("golfodds_v_latest_dg").select("market_id, dg_prob, dg_fit_prob, fetched_at"), marketIds),
      fetchAllIn(() => supabase.from("golfodds_v_latest_books").select("market_id, book, price_american, price_decimal, implied_prob, novig_prob, fetched_at"), marketIds),
    ]);

    const kalshiByMarket = new Map(kalshiRows.map((r) => [r.market_id, r]));
    const dgByMarket = new Map(dgRows.map((r) => [r.market_id, r]));
    const booksByMarket = new Map();
    const bookSet = new Set();
    for (const r of bookRows) {
      if (!booksByMarket.has(r.market_id)) booksByMarket.set(r.market_id, []);
      booksByMarket.get(r.market_id).push(r);
      bookSet.add(r.book);
    }
    const allBooks = Array.from(bookSet).sort();

    // Staleness threshold: when a reference (DG model OR book consensus) is
    // significantly older than the Kalshi quote, the reference is no longer
    // tracking reality. DataGolf closes some markets mid-tournament (make_cut
    // after R2, r1lead after R1) and our cached snapshot then sits unchanged
    // for 12+ hours while Kalshi keeps moving. Treat anything more than
    // STALE_THRESHOLD_MS older than the current Kalshi tick as "no data".
    const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    const isStale = (refFetched, kalshiFetched) => {
      if (!refFetched) return false;
      if (!kalshiFetched) return false;
      const ageDelta = new Date(kalshiFetched).getTime() - new Date(refFetched).getTime();
      return ageDelta > STALE_THRESHOLD_MS;
    };

    const players = markets.map((m) => {
      const k = kalshiByMarket.get(m.id);
      const dg = dgByMarket.get(m.id);
      let books = booksByMarket.get(m.id) || [];
      const kalshiFetchedAt = k?.fetched_at || null;
      // Drop DG/books quotes that are stale relative to Kalshi
      const dgStale = dg && isStale(dg.fetched_at, kalshiFetchedAt);
      const dgEffective = dgStale ? null : dg;
      books = books.filter((b) => !isStale(b.fetched_at, kalshiFetchedAt));
      const novigVals = books.map((b) => b.novig_prob).filter((p) => p != null);
      const booksMedian = median(novigVals);
      const booksMin = novigVals.length ? Math.min(...novigVals) : null;
      const booksMax = novigVals.length ? Math.max(...novigVals) : null;
      const kalshiProb = k?.implied_prob ?? null;
      // "Best alternative book": where can the bettor get the longest payout
      // (= lowest implied prob = longest American odds) outside Kalshi? This
      // is the book to compare Kalshi against — if Kalshi's price is lower
      // still, Kalshi is the place; if it's higher, the bettor should use
      // that book instead.
      let bestBookForBet = null;
      if (books.length) {
        const sorted = [...books].filter((b) => b.novig_prob != null).sort((a, b) => a.novig_prob - b.novig_prob);
        if (sorted.length) bestBookForBet = { book: sorted[0].book, novig_prob: sorted[0].novig_prob, price_american: sorted[0].price_american };
      }
      const bookMap = {};
      for (const b of books) {
        bookMap[b.book] = {
          american: b.price_american,
          decimal: b.price_decimal,
          implied: b.implied_prob,
          novig: b.novig_prob,
        };
      }
      // Edge convention: positive = Kalshi's YES price is CHEAPER than the
      // reference → good buy on Kalshi. Negative = Kalshi is overpriced.
      //   edge = reference_prob - kalshi_prob
      return {
        player_id: m.player_id,
        player: m.golfodds_players,
        market_type: m.market_type,
        kalshi: k ? { implied_prob: kalshiProb, yes_bid: k.yes_bid, yes_ask: k.yes_ask, last_price: k.last_price, fetched_at: k.fetched_at } : null,
        datagolf: dgEffective ? { dg_prob: dgEffective.dg_prob, dg_fit_prob: dgEffective.dg_fit_prob, fetched_at: dgEffective.fetched_at } : null,
        dg_stale: dgStale,
        book_prices: bookMap,
        book_count: books.length,
        books_median: booksMedian,
        books_min: booksMin,
        books_max: booksMax,
        best_book_for_bet: bestBookForBet,
        edge_vs_books_median: kalshiProb != null && booksMedian != null ? Number((booksMedian - kalshiProb).toFixed(4)) : null,
        // edge vs best book: how much cheaper is Kalshi than the cheapest book?
        edge_vs_best_book: kalshiProb != null && booksMin != null ? Number((booksMin - kalshiProb).toFixed(4)) : null,
        edge_vs_dg: kalshiProb != null && dgEffective?.dg_prob != null ? Number((dgEffective.dg_prob - kalshiProb).toFixed(4)) : null,
      };
    });

    return res.status(200).json({
      tournament_id: tournamentId,
      market_type: marketType,
      books: allBooks,
      player_count: players.length,
      players,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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
        .from("sports_v_latest_quotes")
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

    return res.status(200).json({
      event,
      markets: marketsWithQuotes,
      spreads,
      totals,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

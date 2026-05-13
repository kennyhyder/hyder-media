import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/event?id=<uuid>
// Returns event + each Kalshi market overlaid with sportsbook consensus from
// sports_book_v_latest: per-book no-vig probs, median, best book, edge vs Kalshi.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const { data: event } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
      .eq("id", id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "not found" });

    const { data: markets } = await supabase
      .from("sports_markets")
      .select("id, contestant_label, market_type, kalshi_ticker")
      .eq("event_id", id);

    let marketsWithQuotes = markets || [];
    if (marketsWithQuotes.length > 0) {
      const ids = marketsWithQuotes.map((m) => m.id);
      const [{ data: kalshiQuotes }, { data: bookQuotes }] = await Promise.all([
        supabase
          .from("sports_v_latest_quotes")
          .select("market_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at")
          .in("market_id", ids),
        // Map sports_book_quotes via the event_id + contestant_norm join
        supabase
          .from("sports_book_v_latest")
          .select("contestant_norm, book, implied_prob_novig, american, fetched_at")
          .eq("sports_event_id", id)
          .eq("market_type", "h2h"),
      ]);

      const qByMarket = new Map((kalshiQuotes || []).map((q) => [q.market_id, q]));
      // Group book quotes by contestant_norm
      const booksByContestant = new Map();
      for (const b of bookQuotes || []) {
        const arr = booksByContestant.get(b.contestant_norm) || [];
        arr.push(b);
        booksByContestant.set(b.contestant_norm, arr);
      }

      marketsWithQuotes = marketsWithQuotes.map((m) => {
        const q = qByMarket.get(m.id);
        const labelNorm = (m.contestant_label || "")
          .toLowerCase()
          .replace(/[^a-z0-9 ]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const books = (booksByContestant.get(labelNorm) || []).map((b) => ({
          book: b.book,
          implied_prob_novig: b.implied_prob_novig != null ? Number(b.implied_prob_novig) : null,
          american: b.american,
          fetched_at: b.fetched_at,
        }));
        const novigs = books.map((b) => b.implied_prob_novig).filter((v) => v != null).sort((a, b) => a - b);
        const median = novigs.length ? novigs[Math.floor(novigs.length / 2)] : null;
        // best book = lowest no-vig prob (cheapest YES → longest American on YES)
        let bestBook = null;
        if (books.length) {
          const sortedBest = [...books].filter((b) => b.implied_prob_novig != null).sort((a, b) => a.implied_prob_novig - b.implied_prob_novig);
          if (sortedBest.length) bestBook = { book: sortedBest[0].book, implied_prob_novig: sortedBest[0].implied_prob_novig, american: sortedBest[0].american };
        }
        const kalshi = q?.implied_prob ?? null;
        const edge_vs_median = (kalshi != null && median != null) ? Number((median - kalshi).toFixed(5)) : null;
        const edge_vs_best = (kalshi != null && bestBook?.implied_prob_novig != null) ? Number((bestBook.implied_prob_novig - kalshi).toFixed(5)) : null;

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
          // Book overlay
          books_count: books.length,
          books_median: median,
          books_min: novigs.length ? novigs[0] : null,
          books_max: novigs.length ? novigs[novigs.length - 1] : null,
          book_prices: books,
          best_book: bestBook,
          edge_vs_books_median: edge_vs_median,
          edge_vs_best_book: edge_vs_best,
        };
      });
      marketsWithQuotes.sort((a, b) => (b.implied_prob ?? 0) - (a.implied_prob ?? 0));
    }

    return res.status(200).json({ event, markets: marketsWithQuotes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

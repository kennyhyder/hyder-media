import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

/**
 * GET /api/golfodds/tournament-info?id=<uuid>
 *
 * Metadata for one tournament: player count, books seen, which market_types
 * have data on each source side. Used to dim/disable empty tabs in the UI.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const [tRes, mRes] = await Promise.all([
      supabase.from("golfodds_tournaments").select("*").eq("id", id).single(),
      supabase.from("golfodds_markets").select("id, market_type, player_id").eq("tournament_id", id),
    ]);
    if (tRes.error) return res.status(404).json({ error: tRes.error.message });

    const markets = mRes.data || [];
    const marketIds = markets.map((m) => m.id);
    const marketsByType = markets.reduce((acc, m) => {
      acc[m.market_type] = (acc[m.market_type] || 0) + 1;
      return acc;
    }, {});

    let booksSeen = [];
    let kalshiCount = 0;
    let dgCount = 0;
    let bookCount = 0;
    const kalshiCountByType = {};

    if (marketIds.length) {
      const [kalshiRes, dgRes, bookRes] = await Promise.all([
        supabase.from("golfodds_v_latest_kalshi").select("market_id").in("market_id", marketIds),
        supabase.from("golfodds_v_latest_dg").select("market_id").in("market_id", marketIds),
        supabase.from("golfodds_v_latest_books").select("market_id, book").in("market_id", marketIds),
      ]);
      kalshiCount = (kalshiRes.data || []).length;
      dgCount = (dgRes.data || []).length;
      bookCount = (bookRes.data || []).length;
      booksSeen = Array.from(new Set((bookRes.data || []).map((r) => r.book))).sort();
      const kalshiMarketIds = new Set((kalshiRes.data || []).map((r) => r.market_id));
      for (const m of markets) {
        if (kalshiMarketIds.has(m.id)) kalshiCountByType[m.market_type] = (kalshiCountByType[m.market_type] || 0) + 1;
      }
    }

    return res.status(200).json({
      tournament: tRes.data,
      stats: {
        total_markets: markets.length,
        unique_players: new Set(markets.map((m) => m.player_id)).size,
        markets_by_type: marketsByType,
        kalshi_markets_by_type: kalshiCountByType,
        kalshi_quote_count: kalshiCount,
        dg_quote_count: dgCount,
        book_quote_count: bookCount,
      },
      books: booksSeen,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

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

/**
 * GET /api/golfodds/tournament-info?id=<uuid>
 *
 * Metadata for one tournament: player count, books seen, which market_types
 * have data on each source side. Used to dim/disable empty tabs in the UI.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const [tRes, mRes, muRes, ppRes] = await Promise.all([
      supabase.from("golfodds_tournaments").select("*").eq("id", id).single(),
      supabase.from("golfodds_markets").select("id, market_type, player_id").eq("tournament_id", id).range(0, 9999),
      supabase.from("golfodds_matchups").select("id, matchup_type").eq("tournament_id", id).range(0, 9999),
      supabase.from("golfodds_props").select("id, prop_type").eq("tournament_id", id).range(0, 999),
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
      const [kalshiRows, dgRows, bookRows] = await Promise.all([
        fetchAllIn(() => supabase.from("golfodds_kalshi_latest").select("market_id"), marketIds),
        fetchAllIn(() => supabase.from("golfodds_dg_latest").select("market_id"), marketIds),
        fetchAllIn(() => supabase.from("golfodds_book_latest").select("market_id, book"), marketIds),
      ]);
      kalshiCount = kalshiRows.length;
      dgCount = dgRows.length;
      bookCount = bookRows.length;
      booksSeen = Array.from(new Set(bookRows.map((r) => r.book))).sort();
      const kalshiMarketIds = new Set(kalshiRows.map((r) => r.market_id));
      for (const m of markets) {
        if (kalshiMarketIds.has(m.id)) kalshiCountByType[m.market_type] = (kalshiCountByType[m.market_type] || 0) + 1;
      }
    }

    const matchups = muRes.data || [];
    const matchupsByType = matchups.reduce((acc, m) => {
      acc[m.matchup_type] = (acc[m.matchup_type] || 0) + 1;
      return acc;
    }, {});

    const propsRows = ppRes.data || [];

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
        total_matchups: matchups.length,
        matchups_by_type: matchupsByType,
        total_props: propsRows.length,
        prop_types: propsRows.map((p) => p.prop_type),
      },
      books: booksSeen,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

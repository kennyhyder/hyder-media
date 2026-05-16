import { createClient } from "@supabase/supabase-js";

// Look up a golf player by slug + return their markets across every active
// tournament. Used for /golf/players/[slug] hub pages.
//
// GET /api/golfodds/player-by-slug?slug=scottie-scheffler
//   → {
//       player: { id, name, slug, dg_id, owgr_rank, country },
//       tournaments: [
//         {
//           tournament: { id, name, slug, season_year, start_date, is_major },
//           markets: [
//             { market_id, market_type, kalshi: {...}|null, dg: {...}|null,
//               books: { count, median, best } | null }
//           ]
//         }
//       ]
//     }
//
// Public read (no auth).

export const config = { maxDuration: 15 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug required" });

  const supabase = getSupabase();

  const { data: player } = await supabase
    .from("golfodds_players")
    .select("id, name, slug, dg_id, owgr_rank, country")
    .eq("slug", slug)
    .maybeSingle();
  if (!player) return res.status(404).json({ error: "player not found" });

  // All markets for this player. Join to tournament.
  const { data: markets } = await supabase
    .from("golfodds_markets")
    .select("id, market_type, tournament:golfodds_tournaments(id, name, short_name, slug, season_year, start_date, is_major, status)")
    .eq("player_id", player.id);

  const openMarkets = (markets || []).filter((m) => m.tournament?.status !== "closed");
  if (openMarkets.length === 0) {
    return res.status(200).json({ player, tournaments: [] });
  }

  const marketIds = openMarkets.map((m) => m.id);

  // Latest Kalshi quotes (use the view)
  const { data: kalshi } = await supabase
    .from("golfodds_v_latest_kalshi")
    .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
    .in("market_id", marketIds);
  const kByMarket = new Map((kalshi || []).map((k) => [k.market_id, k]));

  const { data: dg } = await supabase
    .from("golfodds_v_latest_dg")
    .select("market_id, dg_prob, dg_fit_prob, fetched_at")
    .in("market_id", marketIds);
  const dgByMarket = new Map((dg || []).map((d) => [d.market_id, d]));

  const { data: books } = await supabase
    .from("golfodds_v_latest_books")
    .select("market_id, book, price_american, novig_prob");
  const booksByMarket = new Map();
  for (const b of books || []) {
    if (!marketIds.includes(b.market_id)) continue;
    const arr = booksByMarket.get(b.market_id) || [];
    arr.push(b);
    booksByMarket.set(b.market_id, arr);
  }

  // Group markets by tournament
  const byTournament = new Map();
  for (const m of openMarkets) {
    if (!m.tournament) continue;
    const tid = m.tournament.id;
    if (!byTournament.has(tid)) byTournament.set(tid, { tournament: m.tournament, markets: [] });
    const bArr = booksByMarket.get(m.id) || [];
    const novigs = bArr.map((b) => b.novig_prob).filter((v) => v != null).sort((a, b) => a - b);
    const median = novigs.length
      ? (novigs.length % 2 ? novigs[Math.floor(novigs.length / 2)] : (novigs[novigs.length / 2 - 1] + novigs[novigs.length / 2]) / 2)
      : null;
    const best = bArr.reduce((acc, b) => {
      if (b.price_american == null) return acc;
      if (!acc || b.price_american > acc.price_american) return b;
      return acc;
    }, null);
    byTournament.get(tid).markets.push({
      market_id: m.id,
      market_type: m.market_type,
      kalshi: kByMarket.get(m.id) || null,
      dg: dgByMarket.get(m.id) || null,
      books: bArr.length ? {
        count: bArr.length,
        median: median != null ? Number(median.toFixed(4)) : null,
        best: best ? { book: best.book, american: best.price_american } : null,
      } : null,
    });
  }

  const tournaments = Array.from(byTournament.values()).sort((a, b) => {
    const da = a.tournament.start_date || "";
    const db = b.tournament.start_date || "";
    return db.localeCompare(da);
  });

  return res.status(200).json({ player, tournaments });
}

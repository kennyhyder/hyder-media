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
//             { market_id, market_type,
//               kalshi: { implied_prob, yes_bid, yes_ask, last_price, fetched_at } | null,
//               dg: { dg_prob, dg_fit_prob, fetched_at } | null,
//               books: {
//                 count, median, min, max,
//                 best: { book, american } | null,
//                 per_book: [{ book, american, novig }, ...]   // NEW
//               } | null,
//               data_status: 'full' | 'kalshi_dg' | 'kalshi_only' | 'dg_only' | 'no_data',
//               freshest_at: ISO datetime                              // NEW
//             }
//           ],
//           freshest_at: ISO                                            // NEW
//         }
//       ],
//       freshest_at: ISO                                                // NEW
//     }
//
// Public read (no auth). Used by SEO-ranked /golf/players/[slug] pages —
// data_status drives explicit "data not yet available" messaging vs blank
// rows that hurt rank.

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

  const { data: markets } = await supabase
    .from("golfodds_markets")
    .select("id, market_type, tournament:golfodds_tournaments(id, name, short_name, slug, season_year, start_date, is_major, status)")
    .eq("player_id", player.id);

  const openMarkets = (markets || []).filter((m) => m.tournament?.status !== "closed");
  if (openMarkets.length === 0) {
    return res.status(200).json({ player, tournaments: [], freshest_at: null });
  }

  const marketIds = openMarkets.map((m) => m.id);

  const [kRes, dgRes, booksRes] = await Promise.all([
    supabase
      .from("golfodds_kalshi_latest")
      .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
      .in("market_id", marketIds),
    supabase
      .from("golfodds_dg_latest")
      .select("market_id, dg_prob, dg_fit_prob, fetched_at")
      .in("market_id", marketIds),
    supabase
      .from("golfodds_book_latest")
      .select("market_id, book, price_american, novig_prob, fetched_at")
      .in("market_id", marketIds),
  ]);

  const kByMarket = new Map((kRes.data || []).map((k) => [k.market_id, k]));
  const dgByMarket = new Map((dgRes.data || []).map((d) => [d.market_id, d]));
  const booksByMarket = new Map();
  for (const b of booksRes.data || []) {
    const arr = booksByMarket.get(b.market_id) || [];
    arr.push(b);
    booksByMarket.set(b.market_id, arr);
  }

  let pageFreshest = 0;
  const byTournament = new Map();

  for (const m of openMarkets) {
    if (!m.tournament) continue;
    const tid = m.tournament.id;
    if (!byTournament.has(tid)) byTournament.set(tid, { tournament: m.tournament, markets: [], _freshest: 0 });

    const k = kByMarket.get(m.id) || null;
    const dg = dgByMarket.get(m.id) || null;
    const bArr = booksByMarket.get(m.id) || [];

    let books = null;
    let booksFreshest = 0;
    if (bArr.length) {
      const novigs = bArr.map((b) => b.novig_prob).filter((v) => v != null).sort((a, b) => a - b);
      const median = novigs.length
        ? (novigs.length % 2 ? novigs[Math.floor(novigs.length / 2)] : (novigs[novigs.length / 2 - 1] + novigs[novigs.length / 2]) / 2)
        : null;
      const sortedBooks = [...bArr]
        .filter((b) => b.price_american != null || b.novig_prob != null)
        .sort((a, b) => (b.price_american || -99999) - (a.price_american || -99999));
      const best = sortedBooks[0] && sortedBooks[0].price_american != null
        ? { book: sortedBooks[0].book, american: sortedBooks[0].price_american }
        : null;
      books = {
        count: bArr.length,
        median: median != null ? Number(median.toFixed(4)) : null,
        min: novigs.length ? Number(novigs[0].toFixed(4)) : null,
        max: novigs.length ? Number(novigs[novigs.length - 1].toFixed(4)) : null,
        best,
        per_book: sortedBooks.map((b) => ({
          book: b.book,
          american: b.price_american,
          novig: b.novig_prob != null ? Number(b.novig_prob.toFixed(4)) : null,
        })),
      };
      for (const b of bArr) {
        if (b.fetched_at) {
          const t = new Date(b.fetched_at).getTime();
          if (t > booksFreshest) booksFreshest = t;
        }
      }
    }

    // data_status — what data sources actually exist for this market
    const hasK = k?.implied_prob != null;
    const hasDg = dg?.dg_prob != null;
    const hasBooks = books != null;
    let data_status = "no_data";
    if (hasK && hasDg && hasBooks) data_status = "full";
    else if (hasK && hasDg) data_status = "kalshi_dg";
    else if (hasK && hasBooks) data_status = "kalshi_books";
    else if (hasDg && hasBooks) data_status = "dg_books";
    else if (hasK) data_status = "kalshi_only";
    else if (hasDg) data_status = "dg_only";
    else if (hasBooks) data_status = "books_only";

    // Freshness — max across all sources
    let marketFreshest = 0;
    for (const ts of [k?.fetched_at, dg?.fetched_at, booksFreshest ? new Date(booksFreshest).toISOString() : null]) {
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (t > marketFreshest) marketFreshest = t;
      if (t > pageFreshest) pageFreshest = t;
    }
    const tEntry = byTournament.get(tid);
    if (marketFreshest > tEntry._freshest) tEntry._freshest = marketFreshest;

    tEntry.markets.push({
      market_id: m.id,
      market_type: m.market_type,
      kalshi: k,
      dg,
      books,
      data_status,
      freshest_at: marketFreshest ? new Date(marketFreshest).toISOString() : null,
    });
  }

  // Sort: NEXT event first chronologically. Prefer end_date (when the
  // tournament resolves on Kalshi); fall back to start_date; in-progress
  // tournaments (end_date in past or today) come BEFORE future ones.
  // Without this, multiple upcoming tournaments render in arbitrary
  // order — Tom Kim's US Open showed before this week's CJ Cup.
  const todayISO = new Date().toISOString().slice(0, 10);
  const tournaments = Array.from(byTournament.values())
    .map((t) => ({
      tournament: t.tournament,
      markets: t.markets,
      freshest_at: t._freshest ? new Date(t._freshest).toISOString() : null,
    }))
    .sort((a, b) => {
      // Use end_date (Kalshi resolution date) as primary; falls back to
      // start_date if end_date is null
      const dateA = a.tournament.end_date || a.tournament.start_date || "9999-12-31";
      const dateB = b.tournament.end_date || b.tournament.start_date || "9999-12-31";
      // In-progress (end >= today but with fresh market data) ranks first
      // Pure date ASC handles both in-progress and future correctly.
      return dateA.localeCompare(dateB);
    });

  return res.status(200).json({
    player,
    tournaments,
    freshest_at: pageFreshest ? new Date(pageFreshest).toISOString() : null,
  });
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

async function fetchAllIn(query, ids, idCol = "market_id", idChunkSize = 100, rowPageSize = 1000) {
  const out = [];
  for (let i = 0; i < ids.length; i += idChunkSize) {
    const chunk = ids.slice(i, i + idChunkSize);
    let page = 0;
    while (true) {
      const start = page * rowPageSize;
      const { data, error } = await query().in(idCol, chunk).range(start, start + rowPageSize - 1);
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
 * GET /api/golfodds/player?player_id=<uuid>&tournament_id=<uuid>
 *
 * Returns every market and matchup for a given player at a given tournament,
 * with Kalshi quote, DG model, book median + edges. Used for the player
 * detail page (one screen showing all the player's available bets).
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const playerId = req.query.player_id;
  const tournamentId = req.query.tournament_id;
  if (!playerId || !tournamentId) return res.status(400).json({ error: "player_id and tournament_id required" });

  try {
    const supabase = getSupabase();
    const [pRes, tRes] = await Promise.all([
      supabase.from("golfodds_players").select("*").eq("id", playerId).single(),
      supabase.from("golfodds_tournaments").select("id, name, kalshi_event_ticker, is_major, start_date, end_date").eq("id", tournamentId).single(),
    ]);
    if (pRes.error) return res.status(404).json({ error: pRes.error.message });
    if (tRes.error) return res.status(404).json({ error: tRes.error.message });

    // ---- Per-golfer binary markets for this player ----
    const { data: markets, error: mErr } = await supabase
      .from("golfodds_markets")
      .select("id, market_type")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .range(0, 999);
    if (mErr) return res.status(500).json({ error: mErr.message });

    const marketIds = (markets || []).map((m) => m.id);
    let kalshiRows = [], dgRows = [], bookRows = [];
    if (marketIds.length) {
      [kalshiRows, dgRows, bookRows] = await Promise.all([
        fetchAllIn(() => supabase.from("golfodds_kalshi_latest").select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at"), marketIds),
        fetchAllIn(() => supabase.from("golfodds_dg_latest").select("market_id, dg_prob, dg_fit_prob, fetched_at"), marketIds),
        fetchAllIn(() => supabase.from("golfodds_book_latest").select("market_id, book, price_american, implied_prob, novig_prob, fetched_at"), marketIds),
      ]);
    }
    const kalshiByMarket = new Map(kalshiRows.map((r) => [r.market_id, r]));
    const dgByMarket = new Map(dgRows.map((r) => [r.market_id, r]));
    const booksByMarket = new Map();
    for (const r of bookRows) {
      if (!booksByMarket.has(r.market_id)) booksByMarket.set(r.market_id, []);
      booksByMarket.get(r.market_id).push(r);
    }

    const marketsOut = (markets || []).map((m) => {
      const k = kalshiByMarket.get(m.id);
      const dg = dgByMarket.get(m.id);
      const books = booksByMarket.get(m.id) || [];
      const novigVals = books.map((b) => b.novig_prob).filter((v) => v != null);
      const booksMedian = median(novigVals);
      const booksMin = novigVals.length ? Math.min(...novigVals) : null;
      const kalshiProb = k?.implied_prob ?? null;
      const bookMap = {};
      for (const b of books) bookMap[b.book] = { american: b.price_american, novig: b.novig_prob, implied: b.implied_prob };
      return {
        market_id: m.id,
        market_type: m.market_type,
        kalshi: k ? { implied_prob: kalshiProb, yes_bid: k.yes_bid, yes_ask: k.yes_ask, last_price: k.last_price } : null,
        datagolf: dg ? { dg_prob: dg.dg_prob, dg_fit_prob: dg.dg_fit_prob } : null,
        book_prices: bookMap,
        book_count: books.length,
        books_median: booksMedian,
        books_min: booksMin,
        edge_vs_books_median: kalshiProb != null && booksMedian != null ? Number((booksMedian - kalshiProb).toFixed(4)) : null,
        edge_vs_best_book: kalshiProb != null && booksMin != null ? Number((booksMin - kalshiProb).toFixed(4)) : null,
        edge_vs_dg: kalshiProb != null && dg?.dg_prob != null ? Number((dg.dg_prob - kalshiProb).toFixed(4)) : null,
      };
    });

    // ---- Matchups this player is in ----
    const { data: mpRows, error: mpErr } = await supabase
      .from("golfodds_matchup_players")
      .select("id, matchup_id, kalshi_ticker, golfodds_matchups!inner(id, tournament_id, matchup_type, scope, round_number, title)")
      .eq("player_id", playerId)
      .eq("golfodds_matchups.tournament_id", tournamentId)
      .range(0, 999);
    if (mpErr) return res.status(500).json({ error: mpErr.message });

    const matchupIds = Array.from(new Set((mpRows || []).map((p) => p.matchup_id)));
    let allMatchupPlayers = [];
    if (matchupIds.length) {
      for (let i = 0; i < matchupIds.length; i += 100) {
        const chunk = matchupIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("golfodds_matchup_players")
          .select("id, matchup_id, player_id, kalshi_ticker, golfodds_players(id, name, dg_id)")
          .in("matchup_id", chunk)
          .range(0, 9999);
        if (error) return res.status(500).json({ error: error.message });
        allMatchupPlayers.push(...(data || []));
      }
    }
    const mpAllIds = allMatchupPlayers.map((p) => p.id);
    const [mKalshi, mBooks] = mpAllIds.length
      ? await Promise.all([
          fetchAllIn(() => supabase.from("golfodds_v_latest_matchup_kalshi").select("matchup_player_id, yes_bid, yes_ask, last_price, implied_prob"), mpAllIds, "matchup_player_id"),
          fetchAllIn(() => supabase.from("golfodds_v_latest_matchup_books").select("matchup_player_id, book, price_american, novig_prob, implied_prob"), mpAllIds, "matchup_player_id"),
        ])
      : [[], []];
    const mKalshiByMp = new Map(mKalshi.map((r) => [r.matchup_player_id, r]));
    const mBooksByMp = new Map();
    for (const r of mBooks) {
      if (!mBooksByMp.has(r.matchup_player_id)) mBooksByMp.set(r.matchup_player_id, []);
      mBooksByMp.get(r.matchup_player_id).push(r);
    }

    const matchupsByMatchup = new Map();
    for (const p of allMatchupPlayers) {
      if (!matchupsByMatchup.has(p.matchup_id)) matchupsByMatchup.set(p.matchup_id, []);
      matchupsByMatchup.get(p.matchup_id).push(p);
    }

    const matchupsOut = (mpRows || []).map((mp) => {
      const matchup = mp.golfodds_matchups;
      const allLegs = (matchupsByMatchup.get(matchup.id) || []).map((p) => {
        const k = mKalshiByMp.get(p.id);
        const books = mBooksByMp.get(p.id) || [];
        const novigVals = books.map((b) => b.novig_prob).filter((v) => v != null);
        const booksMedian = median(novigVals);
        const booksMin = novigVals.length ? Math.min(...novigVals) : null;
        const kalshiProb = k?.implied_prob ?? null;
        return {
          matchup_player_id: p.id,
          player_id: p.player_id,
          player: p.golfodds_players,
          is_self: p.player_id === playerId,
          kalshi: k ? { implied_prob: kalshiProb, yes_bid: k.yes_bid, yes_ask: k.yes_ask, last_price: k.last_price } : null,
          books_median: booksMedian,
          books_min: booksMin,
          book_count: books.length,
          edge_vs_books_median: kalshiProb != null && booksMedian != null ? Number((booksMedian - kalshiProb).toFixed(4)) : null,
        };
      });
      return {
        matchup_id: matchup.id,
        matchup_type: matchup.matchup_type,
        scope: matchup.scope,
        round_number: matchup.round_number,
        title: matchup.title,
        legs: allLegs,
      };
    });

    return res.status(200).json({
      player: pRes.data,
      tournament: tRes.data,
      markets: marketsOut,
      matchups: matchupsOut,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

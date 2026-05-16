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

async function fetchAllIn(query, ids, idChunkSize = 100, rowPageSize = 1000) {
  const out = [];
  for (let i = 0; i < ids.length; i += idChunkSize) {
    const chunk = ids.slice(i, i + idChunkSize);
    let page = 0;
    while (true) {
      const start = page * rowPageSize;
      const { data, error } = await query().in("matchup_player_id", chunk).range(start, start + rowPageSize - 1);
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
 * GET /api/golfodds/matchups?tournament_id=<uuid>&type=h2h|3ball|5ball
 *
 * Returns matchup-style markets for one tournament. Each matchup has 2-5
 * player legs with Kalshi quote, per-book quotes, and buy-edge vs book median.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tournamentId = req.query.tournament_id;
  const filterType = req.query.type;
  if (!tournamentId) return res.status(400).json({ error: "tournament_id required" });

  try {
    const supabase = getSupabase();
    let mq = supabase
      .from("golfodds_matchups")
      .select("id, matchup_type, scope, round_number, kalshi_event_ticker, title")
      .eq("tournament_id", tournamentId)
      .range(0, 9999);
    if (filterType) mq = mq.eq("matchup_type", filterType);
    const { data: matchups, error: mErr } = await mq;
    if (mErr) return res.status(500).json({ error: mErr.message });
    if (!matchups?.length) return res.status(200).json({ matchups: [], books: [] });

    const matchupIds = matchups.map((m) => m.id);

    // Pull all matchup_players for these matchups
    const playersOut = [];
    for (let i = 0; i < matchupIds.length; i += 100) {
      const chunk = matchupIds.slice(i, i + 100);
      const { data, error } = await supabase
        .from("golfodds_matchup_players")
        .select("id, matchup_id, player_id, kalshi_ticker, golfodds_players(id, name, dg_id)")
        .in("matchup_id", chunk)
        .range(0, 9999);
      if (error) return res.status(500).json({ error: error.message });
      playersOut.push(...(data || []));
    }
    const mpIds = playersOut.map((p) => p.id);

    const [kalshiRows, bookRows] = await Promise.all([
      fetchAllIn(() => supabase.from("golfodds_matchup_kalshi_latest").select("matchup_player_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at"), mpIds),
      fetchAllIn(() => supabase.from("golfodds_matchup_book_latest").select("matchup_player_id, book, price_american, price_decimal, implied_prob, novig_prob, fetched_at"), mpIds),
    ]);

    const kalshiByMp = new Map(kalshiRows.map((r) => [r.matchup_player_id, r]));
    const booksByMp = new Map();
    const bookSet = new Set();
    for (const r of bookRows) {
      if (!booksByMp.has(r.matchup_player_id)) booksByMp.set(r.matchup_player_id, []);
      booksByMp.get(r.matchup_player_id).push(r);
      bookSet.add(r.book);
    }

    // Index matchup_players by matchup_id
    const playersByMatchup = new Map();
    for (const p of playersOut) {
      if (!playersByMatchup.has(p.matchup_id)) playersByMatchup.set(p.matchup_id, []);
      playersByMatchup.get(p.matchup_id).push(p);
    }

    const out = matchups.map((m) => {
      const players = (playersByMatchup.get(m.id) || []).map((p) => {
        const k = kalshiByMp.get(p.id);
        const books = booksByMp.get(p.id) || [];
        const novigVals = books.map((b) => b.novig_prob).filter((v) => v != null);
        const booksMedian = median(novigVals);
        const booksMin = novigVals.length ? Math.min(...novigVals) : null;
        const kalshiProb = k?.implied_prob ?? null;
        const bookMap = {};
        for (const b of books) bookMap[b.book] = { american: b.price_american, novig: b.novig_prob, implied: b.implied_prob };
        return {
          matchup_player_id: p.id,
          player_id: p.player_id,
          player: p.golfodds_players,
          kalshi_ticker: p.kalshi_ticker,
          kalshi: k ? { implied_prob: kalshiProb, yes_bid: k.yes_bid, yes_ask: k.yes_ask, last_price: k.last_price } : null,
          book_prices: bookMap,
          book_count: books.length,
          books_median: booksMedian,
          books_min: booksMin,
          edge_vs_books_median: kalshiProb != null && booksMedian != null ? Number((booksMedian - kalshiProb).toFixed(4)) : null,
          edge_vs_best_book: kalshiProb != null && booksMin != null ? Number((booksMin - kalshiProb).toFixed(4)) : null,
        };
      });
      return {
        id: m.id,
        matchup_type: m.matchup_type,
        scope: m.scope,
        round_number: m.round_number,
        title: m.title,
        kalshi_event_ticker: m.kalshi_event_ticker,
        players,
      };
    });

    return res.status(200).json({
      tournament_id: tournamentId,
      matchups: out,
      books: Array.from(bookSet).sort(),
      type_filter: filterType || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

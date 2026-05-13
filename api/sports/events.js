import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/events?league=nba&status=open&with=markets
// When ?with=markets is passed, each event includes its winner markets with
// Kalshi probs + book consensus inline (books_median, book_count, edges).
// League listing pages use this so users see all games on one screen
// without having to drill in.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const league = req.query.league;
  const status = req.query.status || "open";
  const withMarkets = req.query.with === "markets";
  if (!league) return res.status(400).json({ error: "league required" });

  try {
    const supabase = getSupabase();
    const { data: events } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
      .eq("league", league)
      .eq("status", status)
      .order("start_time", { ascending: true, nullsFirst: false })
      .range(0, 199);

    if (!withMarkets || !events?.length) {
      return res.status(200).json({ events: events || [] });
    }

    const eventIds = events.map((e) => e.id);

    const [{ data: markets }, { data: bookQuotes }] = await Promise.all([
      supabase
        .from("sports_markets")
        .select("id, event_id, contestant_label, market_type")
        .in("event_id", eventIds)
        .eq("market_type", "winner"),
      supabase
        .from("sports_book_v_latest")
        .select("sports_event_id, contestant_norm, implied_prob_novig")
        .in("sports_event_id", eventIds)
        .eq("market_type", "h2h"),
    ]);

    const marketIds = (markets || []).map((m) => m.id);
    const { data: kalshiQuotes } = marketIds.length
      ? await supabase
          .from("sports_v_latest_quotes")
          .select("market_id, implied_prob, yes_bid, yes_ask")
          .in("market_id", marketIds)
      : { data: [] };

    const qByMarket = new Map((kalshiQuotes || []).map((q) => [q.market_id, q]));
    // Group book quotes by (event_id, contestant_norm)
    const booksByEventContestant = new Map();
    for (const b of bookQuotes || []) {
      const key = `${b.sports_event_id}|${b.contestant_norm}`;
      const arr = booksByEventContestant.get(key) || [];
      arr.push(Number(b.implied_prob_novig));
      booksByEventContestant.set(key, arr);
    }

    const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

    // Group markets by event
    const marketsByEvent = new Map();
    for (const m of markets || []) {
      const arr = marketsByEvent.get(m.event_id) || [];
      const q = qByMarket.get(m.id);
      const norm = normalize(m.contestant_label);
      const novigs = (booksByEventContestant.get(`${m.event_id}|${norm}`) || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const median = novigs.length ? novigs[Math.floor(novigs.length / 2)] : null;
      const kalshi = q?.implied_prob ?? null;
      const edge = (kalshi != null && median != null) ? Number((median - kalshi).toFixed(5)) : null;

      arr.push({
        id: m.id,
        contestant_label: m.contestant_label,
        implied_prob: kalshi,
        yes_bid: q?.yes_bid ?? null,
        yes_ask: q?.yes_ask ?? null,
        books_count: novigs.length,
        books_median: median,
        edge_vs_books_median: edge,
      });
      marketsByEvent.set(m.event_id, arr);
    }

    const enriched = events.map((e) => ({
      ...e,
      markets: marketsByEvent.get(e.id) || [],
    }));

    return res.status(200).json({ events: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

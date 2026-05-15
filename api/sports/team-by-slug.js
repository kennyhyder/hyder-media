import { createClient } from "@supabase/supabase-js";

// Look up a sports team / contestant by (league, slug) and return all current
// markets that include this team across every event type (games, futures,
// championship, division, etc.).
//
// GET /api/sports/team-by-slug?league=nba&slug=los-angeles-lakers
//   → {
//       team: { id, league, name, slug, abbreviation },
//       markets: [
//         {
//           market_id, contestant_label,
//           event: { id, title, event_type, slug, season_year, start_time },
//           kalshi: { implied_prob, fetched_at },
//           books: { median, min, max, count, best: { book, american } } | null
//         }, …
//       ],
//       counts: { games, futures, total }
//     }
//
// Public read (no auth). All fields are non-sensitive.

export const config = { maxDuration: 15 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  const { league, slug } = req.query;
  if (!league || !slug) return res.status(400).json({ error: "league + slug required" });

  const supabase = getSupabase();

  // 1. Resolve the contestant row
  const { data: team } = await supabase
    .from("sports_contestants")
    .select("id, league, name, slug, abbreviation, normalized_name")
    .eq("league", league)
    .eq("slug", slug)
    .maybeSingle();
  if (!team) return res.status(404).json({ error: "team not found" });

  // 2. All markets where this team is the contestant. Join to events for
  //    title + slug + event_type.
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label, market_type, event:sports_events(id, title, event_type, slug, season_year, start_time, status, kalshi_event_ticker)")
    .eq("contestant_id", team.id);

  const openMarkets = (markets || []).filter((m) => m.event?.status === "open");

  // 3. Latest Kalshi quote per market (use the view for efficiency)
  const marketIds = openMarkets.map((m) => m.id);
  let kalshiByMarket = new Map();
  if (marketIds.length) {
    const { data: kalshi } = await supabase
      .from("sports_v_latest_quotes")
      .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
      .in("market_id", marketIds);
    kalshiByMarket = new Map((kalshi || []).map((k) => [k.market_id, k]));
  }

  // 4. Latest book quotes per market (aggregate min/median/max/best across books)
  //    Group by sports_event_id + contestant_norm to find matching book quotes
  const eventIds = [...new Set(openMarkets.map((m) => m.event?.id).filter(Boolean))];
  let bookAgg = new Map(); // event_id|contestant_norm -> { values: [], best }
  if (eventIds.length) {
    const { data: books } = await supabase
      .from("sports_book_quotes")
      .select("sports_event_id, contestant_label, contestant_norm, market_type, book, american, implied_prob_novig, fetched_at")
      .in("sports_event_id", eventIds)
      .eq("market_type", "h2h")
      .order("fetched_at", { ascending: false });
    // Most-recent-per (event, norm, book)
    const seen = new Set();
    const filtered = [];
    for (const b of books || []) {
      const k = `${b.sports_event_id}|${b.contestant_norm}|${b.book}`;
      if (seen.has(k)) continue;
      seen.add(k);
      filtered.push(b);
    }
    // Aggregate
    for (const b of filtered) {
      const key = `${b.sports_event_id}|${b.contestant_norm}`;
      const cur = bookAgg.get(key) || { vals: [], best: null };
      if (b.implied_prob_novig != null) cur.vals.push({ book: b.book, novig: b.implied_prob_novig, american: b.american });
      if (b.american != null && (cur.best == null || b.american > cur.best.american)) cur.best = { book: b.book, american: b.american };
      bookAgg.set(key, cur);
    }
  }

  function aggToSummary(agg) {
    if (!agg || !agg.vals.length) return null;
    const sorted = agg.vals.map((v) => v.novig).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
      count: sorted.length,
      median: Number(median.toFixed(4)),
      min: Number(sorted[0].toFixed(4)),
      max: Number(sorted[sorted.length - 1].toFixed(4)),
      best: agg.best,
    };
  }

  function normalizeForMatch(s) {
    return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  const out = openMarkets.map((m) => {
    const k = kalshiByMarket.get(m.id);
    const bookKey = `${m.event?.id}|${normalizeForMatch(m.contestant_label)}`;
    return {
      market_id: m.id,
      contestant_label: m.contestant_label,
      market_type: m.market_type,
      event: m.event,
      kalshi: k ? {
        implied_prob: k.implied_prob,
        yes_bid: k.yes_bid,
        yes_ask: k.yes_ask,
        last_price: k.last_price,
        fetched_at: k.fetched_at,
      } : null,
      books: aggToSummary(bookAgg.get(bookKey)),
    };
  });

  // Sort: games first (by start_time), then futures (by event_type alphabetical)
  out.sort((a, b) => {
    const ta = a.event?.event_type === "game" ? 0 : 1;
    const tb = b.event?.event_type === "game" ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (a.event?.event_type === "game" && b.event?.event_type === "game") {
      return (a.event?.start_time || "").localeCompare(b.event?.start_time || "");
    }
    return (a.event?.event_type || "").localeCompare(b.event?.event_type || "");
  });

  const games = out.filter((m) => m.event?.event_type === "game").length;
  return res.status(200).json({
    team,
    markets: out,
    counts: { games, futures: out.length - games, total: out.length },
  });
}

import { createClient } from "@supabase/supabase-js";

// Look up a sports team / contestant by (league, slug) and return all current
// markets with FULL pricing data: Kalshi + per-book + Polymarket overlay.
//
// GET /api/sports/team-by-slug?league=nba&slug=los-angeles-lakers
//   → {
//       team: { id, league, name, slug, abbreviation, kind },
//       markets: [
//         {
//           market_id, contestant_label, market_type,
//           event: { id, title, event_type, slug, season_year, start_time },
//           kalshi: { implied_prob, yes_bid, yes_ask, last_price, fetched_at } | null,
//           books: {
//             median, min, max, count,
//             best: { book, american } | null,
//             per_book: [{ book, american, novig, fetched_at }, ...]    // NEW: full breakdown
//           } | null,
//           polymarket: { implied_prob, volume_usd, fetched_at } | null,  // NEW
//           data_status: 'full' | 'kalshi_only' | 'books_only' | 'polymarket_only' | 'no_data',
//           freshest_at: ISO datetime (max across all data sources)        // NEW: freshness
//         }, …
//       ],
//       counts: { games, futures, total },
//       freshest_at: ISO datetime (max across the whole page)              // NEW
//     }
//
// Public read (no auth). All fields are non-sensitive. SEO-pages depend on
// the data_status field to render explicit "data not tracked" messages
// rather than blank cells — Google ranks pages with real content higher
// than apparent-stub pages with empty rows.

export const config = { maxDuration: 15 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function normalizeForMatch(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  const { league, slug } = req.query;
  if (!league || !slug) return res.status(400).json({ error: "league + slug required" });

  const supabase = getSupabase();

  // 1. Resolve the contestant row
  const { data: team } = await supabase
    .from("sports_contestants")
    .select("id, league, name, slug, kind, abbreviation, normalized_name")
    .eq("league", league)
    .eq("slug", slug)
    .maybeSingle();
  if (!team) return res.status(404).json({ error: "team not found" });

  // 2. All markets where this team is the contestant (joined to events)
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label, market_type, event:sports_events(id, title, event_type, slug, season_year, start_time, status, kalshi_event_ticker)")
    .eq("contestant_id", team.id);

  const openMarkets = (markets || []).filter((m) => m.event?.status === "open");

  if (openMarkets.length === 0) {
    return res.status(200).json({
      team,
      markets: [],
      counts: { games: 0, futures: 0, total: 0 },
      freshest_at: null,
    });
  }

  const marketIds = openMarkets.map((m) => m.id);
  const eventIds = [...new Set(openMarkets.map((m) => m.event?.id).filter(Boolean))];

  // 3. Pull Kalshi + book + Polymarket data in parallel
  const [kalshiRes, booksRes, polyRes] = await Promise.all([
    supabase
      .from("sports_quotes_latest")
      .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
      .in("market_id", marketIds),

    // ALL market_types now (was h2h-only). Books table may also have
    // totals/spreads which are not contestant-specific but are useful
    // page-level signal — we still filter to ones that match the
    // contestant by normalized name below.
    supabase
      .from("sports_book_quotes")
      .select("sports_event_id, contestant_label, contestant_norm, market_type, book, american, implied_prob_novig, fetched_at")
      .in("sports_event_id", eventIds)
      .order("fetched_at", { ascending: false }),

    supabase
      .from("sports_polymarket_v_latest")
      .select("sports_event_id, contestant_norm, implied_prob, volume_usd, fetched_at")
      .in("sports_event_id", eventIds),
  ]);

  const kalshiByMarket = new Map((kalshiRes.data || []).map((k) => [k.market_id, k]));

  // 4. Aggregate book quotes per (event, normalized contestant). Only h2h /
  //    outrights are contestant-side; totals/spreads are event-level and
  //    don't tie to one contestant.
  const bookAgg = new Map(); // event_id|contestant_norm -> { per_book: [], best }
  const seen = new Set();
  for (const b of booksRes.data || []) {
    if (b.market_type !== "h2h" && b.market_type !== "outrights") continue;
    const dedupKey = `${b.sports_event_id}|${b.contestant_norm}|${b.book}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const key = `${b.sports_event_id}|${b.contestant_norm}`;
    const cur = bookAgg.get(key) || { per_book: [], best: null, latest: 0 };
    if (b.implied_prob_novig != null) {
      cur.per_book.push({
        book: b.book,
        american: b.american,
        novig: Number(b.implied_prob_novig.toFixed(4)),
        fetched_at: b.fetched_at,
      });
    }
    if (b.american != null && (cur.best == null || b.american > cur.best.american)) {
      cur.best = { book: b.book, american: b.american };
    }
    const ts = b.fetched_at ? new Date(b.fetched_at).getTime() : 0;
    if (ts > cur.latest) cur.latest = ts;
    bookAgg.set(key, cur);
  }

  // 5. Polymarket lookup
  const polyByKey = new Map();
  for (const p of polyRes.data || []) {
    const key = `${p.sports_event_id}|${p.contestant_norm}`;
    polyByKey.set(key, p);
  }

  function aggToSummary(agg) {
    if (!agg || !agg.per_book.length) return null;
    const novigs = agg.per_book.map((v) => v.novig).filter((v) => v != null).sort((a, b) => a - b);
    if (!novigs.length) return null;
    const mid = Math.floor(novigs.length / 2);
    const median = novigs.length % 2 ? novigs[mid] : (novigs[mid - 1] + novigs[mid]) / 2;
    // Sort per_book by best price (longest american) descending
    const sortedBooks = [...agg.per_book].sort((a, b) => (b.american || -99999) - (a.american || -99999));
    return {
      count: novigs.length,
      median: Number(median.toFixed(4)),
      min: Number(novigs[0].toFixed(4)),
      max: Number(novigs[novigs.length - 1].toFixed(4)),
      best: agg.best,
      per_book: sortedBooks,
      latest_fetched_at: agg.latest ? new Date(agg.latest).toISOString() : null,
    };
  }

  // 6. Build the response
  let pageFreshest = 0;

  const out = openMarkets.map((m) => {
    const k = kalshiByMarket.get(m.id);
    const bookKey = `${m.event?.id}|${normalizeForMatch(m.contestant_label)}`;
    const books = aggToSummary(bookAgg.get(bookKey));
    const polyRaw = polyByKey.get(bookKey);
    // Filter out dust Polymarket prices (settled markets at 0% or 100%)
    const polymarket = (polyRaw && polyRaw.implied_prob != null
                       && polyRaw.implied_prob > 0.005 && polyRaw.implied_prob < 0.995)
      ? {
          implied_prob: Number(polyRaw.implied_prob.toFixed(4)),
          volume_usd: polyRaw.volume_usd != null ? Number(polyRaw.volume_usd) : null,
          fetched_at: polyRaw.fetched_at,
        }
      : null;

    const hasKalshi = k?.implied_prob != null;
    const hasBooks = books != null;
    const hasPoly = polymarket != null;
    let data_status = "no_data";
    if (hasKalshi && hasBooks) data_status = hasPoly ? "full" : "kalshi_books";
    else if (hasKalshi) data_status = hasPoly ? "kalshi_polymarket" : "kalshi_only";
    else if (hasBooks) data_status = "books_only";
    else if (hasPoly) data_status = "polymarket_only";

    // Per-market freshness — max of all sources
    let marketFreshest = 0;
    for (const ts of [k?.fetched_at, books?.latest_fetched_at, polymarket?.fetched_at]) {
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (t > marketFreshest) marketFreshest = t;
      if (t > pageFreshest) pageFreshest = t;
    }

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
      books,
      polymarket,
      data_status,
      freshest_at: marketFreshest ? new Date(marketFreshest).toISOString() : null,
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
    freshest_at: pageFreshest ? new Date(pageFreshest).toISOString() : null,
  });
}

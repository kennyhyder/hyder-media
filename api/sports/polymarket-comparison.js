import { createClient } from "@supabase/supabase-js";

// Kalshi vs Polymarket comparison feed.
//
// Returns rows for every (event, contestant) that has BOTH a current Kalshi
// quote and a current Polymarket quote, with edge = polymarket - kalshi
// (positive = Kalshi is cheaper → buy on Kalshi).
//
// GET /api/sports/polymarket-comparison?league=nba   (optional league filter)
//   → { rows: [{ league, event_id, event_title, event_slug, season_year,
//                contestant_label, kalshi_prob, polymarket_prob,
//                polymarket_volume_usd, edge_pct, abs_edge_pct }] }
//
// Sorted by |edge| desc so the biggest mispricings come first. Public; no auth.

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  const league = req.query.league || null;
  const minEdge = parseFloat(req.query.min_edge || "0");
  const supabase = getSupabase();

  try {
    // Pull all open events (optionally filtered by league)
    let eventsQ = supabase
      .from("sports_events")
      .select("id, league, event_type, title, slug, season_year, kalshi_event_ticker, status")
      .eq("status", "open");
    if (league) eventsQ = eventsQ.eq("league", league);
    const { data: events, error: evErr } = await eventsQ.range(0, 4999);
    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!events?.length) return res.status(200).json({ rows: [] });

    const eventIds = events.map((e) => e.id);
    const eventById = new Map(events.map((e) => [e.id, e]));

    // Pull markets + polymarket in chunks (avoid 1000-row + URL-length limits)
    const markets = [];
    const polyQuotes = [];
    const CHUNK = 150;
    for (let i = 0; i < eventIds.length; i += CHUNK) {
      const slice = eventIds.slice(i, i + CHUNK);
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase
          .from("sports_markets")
          .select("id, event_id, contestant_label, market_type")
          .in("event_id", slice)
          .eq("market_type", "winner")
          .range(0, 9999),
        supabase
          .from("sports_polymarket_v_latest")
          .select("sports_event_id, contestant_label, contestant_norm, implied_prob, volume_usd")
          .in("sports_event_id", slice)
          .range(0, 9999),
      ]);
      if (m) markets.push(...m);
      if (p) polyQuotes.push(...p);
    }

    // Pull Kalshi quotes per market in chunks
    const marketIds = markets.map((m) => m.id);
    const kalshiQuotes = [];
    for (let i = 0; i < marketIds.length; i += CHUNK) {
      const slice = marketIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("sports_quotes_latest")
        .select("market_id, implied_prob")
        .in("market_id", slice);
      if (data) kalshiQuotes.push(...data);
    }
    const qByMarket = new Map(kalshiQuotes.map((q) => [q.market_id, q]));

    // Index polymarket by (event_id, contestant_norm) — only freshest per side
    const polyByEventContestant = new Map();
    for (const p of polyQuotes) {
      const key = `${p.sports_event_id}|${p.contestant_norm}`;
      polyByEventContestant.set(key, p);
    }

    // Build comparison rows
    const rows = [];
    for (const m of markets) {
      const evt = eventById.get(m.event_id);
      if (!evt) continue;
      const q = qByMarket.get(m.id);
      const k = q?.implied_prob != null ? Number(q.implied_prob) : null;
      if (k == null) continue;
      const norm = normalize(m.contestant_label);
      const poly = polyByEventContestant.get(`${m.event_id}|${norm}`);
      if (!poly?.implied_prob) continue;
      const polyP = Number(poly.implied_prob);
      const edge = polyP - k;  // positive = Kalshi cheaper than Polymarket → buy Kalshi
      if (Math.abs(edge) < minEdge) continue;
      rows.push({
        league: evt.league,
        event_id: evt.id,
        event_title: evt.title,
        event_slug: evt.slug,
        season_year: evt.season_year,
        event_type: evt.event_type,
        contestant_label: m.contestant_label,
        kalshi_prob: Number(k.toFixed(4)),
        polymarket_prob: Number(polyP.toFixed(4)),
        polymarket_volume_usd: poly.volume_usd != null ? Number(poly.volume_usd) : null,
        edge_pct: Number(edge.toFixed(4)),
        abs_edge_pct: Number(Math.abs(edge).toFixed(4)),
      });
    }

    rows.sort((a, b) => b.abs_edge_pct - a.abs_edge_pct);
    return res.status(200).json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

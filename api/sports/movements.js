import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/movements?since_hours=24&league=nba&min_delta=0.02
// Aggregates sports_alerts (movement-type) with denormalized event/market info.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sinceHours = Math.min(Number(req.query.since_hours) || 24, 24 * 7);
  const league = req.query.league;
  const minDelta = req.query.min_delta != null ? Number(req.query.min_delta) : 0;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const sinceISO = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  try {
    const supabase = getSupabase();
    let q = supabase
      .from("sports_alerts")
      .select("id, league, event_id, market_id, alert_type, direction, delta, kalshi_prob_now, kalshi_prob_baseline, baseline_minutes_ago, fired_at, sports_events(title, event_type), sports_markets(contestant_label)")
      .eq("alert_type", "movement")
      .gte("fired_at", sinceISO)
      .order("fired_at", { ascending: false })
      .limit(limit);
    if (league) q = q.eq("league", league);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const filtered = (data || []).filter((a) => Math.abs(a.delta) >= minDelta);
    return res.status(200).json({
      movements: filtered.map((a) => ({
        id: a.id,
        league: a.league,
        event_id: a.event_id,
        market_id: a.market_id,
        event_title: a.sports_events?.title,
        event_type: a.sports_events?.event_type,
        contestant_label: a.sports_markets?.contestant_label,
        direction: a.direction,
        delta: a.delta,
        prob_now: a.kalshi_prob_now,
        prob_baseline: a.kalshi_prob_baseline,
        minutes_ago: a.baseline_minutes_ago,
        fired_at: a.fired_at,
      })),
      count: filtered.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

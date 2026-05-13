import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/golfodds/all-alerts?since_hours=24&limit=200
// Returns golf edge alerts + sports movement alerts in one chronological feed.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sinceHours = Math.min(Number(req.query.since_hours) || 24, 24 * 14);
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const sinceISO = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const supabase = getSupabase();

  try {
    const [golfRes, sportsRes] = await Promise.all([
      supabase
        .from("golfodds_alerts")
        .select("id, tournament_id, player_id, market_id, market_type, alert_type, direction, edge_value, kalshi_prob, reference_prob, book_count, fired_at, notified_at, golfodds_players(name), golfodds_tournaments(name)")
        .gte("fired_at", sinceISO)
        .order("fired_at", { ascending: false })
        .limit(limit),
      supabase
        .from("sports_alerts")
        .select("id, league, event_id, market_id, alert_type, direction, delta, kalshi_prob_now, kalshi_prob_baseline, baseline_minutes_ago, fired_at, sports_events(title, league), sports_markets(contestant_label)")
        .gte("fired_at", sinceISO)
        .order("fired_at", { ascending: false })
        .limit(limit),
    ]);

    const golfAlerts = (golfRes.data || []).map((a) => ({
      source: "golf",
      id: a.id,
      sport: "golf",
      league: "pga",
      fired_at: a.fired_at,
      alert_type: a.alert_type,
      direction: a.direction,
      delta: a.edge_value,
      probability: a.kalshi_prob,
      reference: a.reference_prob,
      reference_label: "books_median",
      title: a.golfodds_players?.name || "Unknown",
      subtitle: `${a.market_type} · ${a.golfodds_tournaments?.name || ""}`,
      book_count: a.book_count,
      link: `/golf/tournament/player?id=${a.tournament_id}&player_id=${a.player_id}`,
    }));
    const sportsAlerts = (sportsRes.data || []).map((a) => ({
      source: "sports",
      id: a.id,
      sport: a.sports_events?.league,
      league: a.league,
      fired_at: a.fired_at,
      alert_type: a.alert_type,
      direction: a.direction,
      delta: a.delta,
      probability: a.kalshi_prob_now,
      reference: a.kalshi_prob_baseline,
      reference_label: `${a.baseline_minutes_ago}m ago`,
      title: a.sports_markets?.contestant_label || "Unknown",
      subtitle: `${a.sports_events?.title || ""}`,
      book_count: 0,
      link: `/sports/${a.league}/event/${a.event_id}`,
    }));
    const merged = [...golfAlerts, ...sportsAlerts]
      .sort((a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime())
      .slice(0, limit);

    return res.status(200).json({ alerts: merged, counts: { golf: golfAlerts.length, sports: sportsAlerts.length } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

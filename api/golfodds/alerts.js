import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

/**
 * GET /api/golfodds/alerts?tournament_id=<uuid>&since_hours=24&direction=buy|sell&limit=100
 *
 * Returns recent alerts (with player + tournament denormalized for display).
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sinceHours = Math.min(Number(req.query.since_hours) || 24, 24 * 14);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const direction = req.query.direction;
  const tournamentId = req.query.tournament_id;

  try {
    const supabase = getSupabase();
    let query = supabase
      .from("golfodds_alerts")
      .select("id, tournament_id, player_id, market_id, market_type, alert_type, direction, edge_value, kalshi_prob, reference_prob, reference_source, book_count, fired_at, notified_at, golfodds_players(name), golfodds_tournaments(name, kalshi_event_ticker)")
      .gte("fired_at", new Date(Date.now() - sinceHours * 3600_000).toISOString())
      .order("fired_at", { ascending: false })
      .limit(limit);
    if (tournamentId) query = query.eq("tournament_id", tournamentId);
    if (direction) query = query.eq("direction", direction);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Cron runs summary (last 50)
    const { data: runs } = await supabase
      .from("golfodds_cron_runs")
      .select("job_name, started_at, finished_at, rows_inserted, errors")
      .order("started_at", { ascending: false })
      .limit(50);

    return res.status(200).json({
      alerts: data,
      cron_runs: runs || [],
      counts_by_direction: (data || []).reduce((acc, a) => {
        acc[a.direction] = (acc[a.direction] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

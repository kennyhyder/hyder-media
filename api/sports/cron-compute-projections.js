import { createClient } from "@supabase/supabase-js";

// Compute rolling-average player-prop projections nightly. Reads from
// sb_player_game_log (populated by separate ESPN/Stats ingest), groups
// per (player, sport, stat), takes the last N games' average, writes to
// sb_prop_projections.
//
// Why rolling average baseline: it's the simplest model that beats
// "use the sportsbook line as the projection" — it captures recency
// (last 10 games > season average for in-form players) without
// overfitting. Real model upgrades (Bayesian shrinkage, opponent
// adjustment, matchup-specific) can be added later by computing
// additional `model` values.
//
// Schedule: 09:00 UTC daily (after ESPN feeds finalize previous day's
// game logs).
//
// GET /api/sports/cron-compute-projections
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 120 };

const ROLLING_WINDOW = 10;
const MIN_GAMES_REQUIRED = 5;

const STAT_COLS = [
  "points", "rebounds", "assists", "steals", "blocks", "threes",
  "hits", "home_runs", "total_bases", "strikeouts",
  "receiving_yards", "rushing_yards", "passing_yards",
  "goals", "saves",
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function meanVar(arr) {
  if (!arr.length) return { mean: null, variance: null };
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return { mean: Number(mean.toFixed(2)), variance: Number(Math.sqrt(variance).toFixed(2)) };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  // Pull all unique (player_id, sport) pairs with at least MIN_GAMES_REQUIRED games
  const { data: pairs } = await supabase.rpc("sb_distinct_player_sport_with_games", {
    min_games: MIN_GAMES_REQUIRED,
  }).then((r) => r.error ? { data: null } : r);

  // Fallback: query player_game_log directly when RPC isn't installed
  let candidates = pairs;
  if (!candidates) {
    const { data: rows } = await supabase
      .from("sb_player_game_log")
      .select("player_id, sport, player_name")
      .limit(50000);
    const set = new Map();
    for (const r of rows || []) {
      const key = `${r.player_id}|${r.sport}`;
      if (!set.has(key)) set.set(key, r);
    }
    candidates = Array.from(set.values());
  }

  if (!candidates?.length) {
    return res.status(200).json({
      skipped: "no game log data yet — ingest ESPN feed first via /api/sports/ingest-player-stats",
      started_at: startedAt,
    });
  }

  const summary = { started_at: startedAt, considered: candidates.length, written: 0, results: [] };
  const today = new Date().toISOString().slice(0, 10);

  for (const c of candidates) {
    const { data: games } = await supabase
      .from("sb_player_game_log")
      .select("*")
      .eq("player_id", c.player_id)
      .eq("sport", c.sport)
      .order("game_date", { ascending: false })
      .limit(ROLLING_WINDOW);
    if (!games || games.length < MIN_GAMES_REQUIRED) continue;

    for (const stat of STAT_COLS) {
      const values = games.map((g) => g[stat]).filter((v) => v != null).map(Number);
      if (values.length < MIN_GAMES_REQUIRED) continue;
      const { mean, variance } = meanVar(values);
      if (mean == null) continue;
      const { error } = await supabase
        .from("sb_prop_projections")
        .upsert({
          player_id: c.player_id,
          player_name: c.player_name || null,
          sport: c.sport,
          stat_name: stat,
          projection: mean,
          baseline_avg: mean,
          baseline_n: values.length,
          variance,
          model: `rolling_avg_${ROLLING_WINDOW}`,
          computed_for: today,
        }, { onConflict: "player_id,sport,stat_name,model,computed_for" });
      if (!error) summary.written++;
    }
  }

  return res.status(200).json(summary);
}

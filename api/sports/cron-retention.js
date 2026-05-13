import { getSupabase, checkAuth } from "./_lib.js";

// Daily: purge quote rows older than 14 days across all sports.
// Keeps the time-series tables lean while preserving 2 weeks of history
// for line-movement charts and back-testing.

const RETENTION_DAYS = 14;

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000).toISOString();
  const startedAt = new Date().toISOString();

  const { data: runRow } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-retention", started_at: startedAt })
    .select("id").single();

  const tables = [
    "golfodds_kalshi_quotes",
    "golfodds_book_quotes",
    "golfodds_dg_model",
    "golfodds_matchup_kalshi_quotes",
    "golfodds_matchup_book_quotes",
    "golfodds_prop_quotes",
    "sports_quotes",
  ];

  const results = {};
  for (const t of tables) {
    const { error, count } = await supabase
      .from(t)
      .delete({ count: "exact" })
      .lt("fetched_at", cutoff);
    if (error) results[t] = `err: ${error.message}`;
    else results[t] = count || 0;
  }

  if (runRow?.id) {
    await supabase.from("golfodds_cron_runs").update({
      finished_at: new Date().toISOString(),
      rows_inserted: -Object.values(results).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0),
      errors: Object.values(results).filter((v) => typeof v === "string").length,
      notes: JSON.stringify({ cutoff, results }),
    }).eq("id", runRow.id);
  }

  return res.status(200).json({ cutoff, results });
}

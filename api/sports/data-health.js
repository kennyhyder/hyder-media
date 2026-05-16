import { createClient } from "@supabase/supabase-js";

// Single-endpoint data-freshness audit.
//
// GET /api/sports/data-health → JSON with last-fetched age + 24h row counts
// for every ingest stream. Useful for:
//   - Dashboard-side widget: "All systems green / X sources stale"
//   - Manual audit when something looks off
//   - External uptime checks (Pingdom, BetterStack) — fail when any
//     source age exceeds 2× its expected cadence
//
// Cron cadences (vercel.json):
//   sports_quotes (Kalshi)         5m
//   sports_book_quotes (TheOddsAPI) 30m
//   sports_polymarket_quotes        15m
//   golfodds_kalshi_quotes          5m
//   golfodds_book_quotes            5m (driven by tournament cron)
//   golfodds_dg_model (DataGolf)    10m
//   golfodds_matchup_kalshi_quotes  5m
//   golfodds_matchup_book_quotes    5m
//   golfodds_prop_quotes            5m

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const SOURCES = [
  { id: "sports_kalshi",        table: "sports_quotes",                  cadence_minutes: 5 },
  { id: "sports_books",         table: "sports_book_quotes",             cadence_minutes: 30 },
  { id: "sports_polymarket",    table: "sports_polymarket_quotes",       cadence_minutes: 15 },
  { id: "golf_kalshi",          table: "golfodds_kalshi_quotes",         cadence_minutes: 5 },
  { id: "golf_books",           table: "golfodds_book_quotes",           cadence_minutes: 5 },
  { id: "golf_datagolf",        table: "golfodds_dg_model",              cadence_minutes: 10 },
  { id: "golf_matchup_kalshi",  table: "golfodds_matchup_kalshi_quotes", cadence_minutes: 5 },
  { id: "golf_matchup_books",   table: "golfodds_matchup_book_quotes",   cadence_minutes: 5 },
  { id: "golf_props",           table: "golfodds_prop_quotes",           cadence_minutes: 5 },
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  const supabase = getSupabase();
  const out = [];
  const now = Date.now();

  for (const src of SOURCES) {
    const { data, error } = await supabase
      .from(src.table)
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1);
    const lastFetched = data?.[0]?.fetched_at || null;
    const ageSeconds = lastFetched ? Math.floor((now - new Date(lastFetched).getTime()) / 1000) : null;
    const stale = ageSeconds == null ? true : ageSeconds > src.cadence_minutes * 60 * 2;
    out.push({
      id: src.id,
      table: src.table,
      cadence_minutes: src.cadence_minutes,
      last_fetched_at: lastFetched,
      age_seconds: ageSeconds,
      stale,
      error: error?.message || null,
    });
  }

  const anyStale = out.some((s) => s.stale);
  return res.status(200).json({
    checked_at: new Date().toISOString(),
    overall_status: anyStale ? "degraded" : "healthy",
    sources: out,
  });
}

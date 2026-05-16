import { createClient } from "@supabase/supabase-js";

// Single-endpoint data-freshness audit.
//
// GET /api/sports/data-health → JSON with last-fetched age + 24h row count
// for every ingest stream. Useful for:
//   - Dashboard widget: "All systems green / X sources stale"
//   - Manual audit when something looks off
//   - External uptime checks (Pingdom, BetterStack) — fail when any
//     source age exceeds 2× its expected cadence
//
// Reads from the precomputed _latest tables when present (low row count,
// instant query). Falls back to the raw quote table with an explicit ORDER
// BY DESC LIMIT 1 — but a 1M+ row table without a fetched_at index will
// time out, so prefer _latest wherever possible.

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const SOURCES = [
  // _latest tables (fast lookups)
  { id: "sports_kalshi",         table: "sports_quotes_latest",           cadence_minutes: 5,  category: "live" },
  { id: "golf_kalshi",           table: "golfodds_kalshi_latest",         cadence_minutes: 5,  category: "live" },
  { id: "golf_datagolf",         table: "golfodds_dg_latest",             cadence_minutes: 10, category: "live" },
  { id: "golf_matchup_kalshi",   table: "golfodds_matchup_kalshi_latest", cadence_minutes: 5,  category: "live" },
  // Tables without _latest but small enough that ORDER BY fetched_at LIMIT 1 works
  { id: "sports_books",          table: "sports_book_quotes",             cadence_minutes: 30, category: "live", small: true },
  { id: "sports_polymarket",     table: "sports_polymarket_quotes",       cadence_minutes: 15, category: "live", small: true },
  { id: "golf_books",            table: "golfodds_book_quotes",           cadence_minutes: 5,  category: "live", small: true },
  // Recently-built ingesters — go live as soon as they pull matching data.
  // Both use 10-min crons. Initial loads may take a few cycles to populate;
  // both also need overlap with existing Kalshi matchups/prop series so they
  // can be empty even when running (no false alarm — just no matched data).
  { id: "golf_matchup_books",    table: "golfodds_matchup_book_latest",   cadence_minutes: 10, category: "live" },
  { id: "golf_props",            table: "golfodds_prop_latest",           cadence_minutes: 10, category: "live" },
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  const supabase = getSupabase();
  const out = [];
  const now = Date.now();

  for (const src of SOURCES) {
    let lastFetched = null;
    let error = null;
    try {
      const q = supabase
        .from(src.table)
        .select("fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1);
      const { data, error: qErr } = await q;
      lastFetched = data?.[0]?.fetched_at || null;
      if (qErr) error = qErr.message;
    } catch (e) {
      error = e instanceof Error ? e.message : "query failed";
    }

    const ageSeconds = lastFetched ? Math.floor((now - new Date(lastFetched).getTime()) / 1000) : null;
    let status;
    if (src.category === "not_implemented") status = "not_implemented";
    else if (ageSeconds == null) status = error ? "error" : "empty";
    else if (ageSeconds > src.cadence_minutes * 60 * 2) status = "stale";
    else status = "fresh";

    out.push({
      id: src.id,
      table: src.table,
      cadence_minutes: src.cadence_minutes,
      category: src.category,
      last_fetched_at: lastFetched,
      age_seconds: ageSeconds,
      status,
      ...(src.note && { note: src.note }),
      ...(error && { error }),
    });
  }

  const liveStreams = out.filter((s) => s.category === "live");
  // 'empty' is informational (ingester configured + running but source has
  // no data right now — e.g. DG only offers matchups during certain rounds).
  // Only true 'error' or 'stale' impacts overall_status.
  const overall = liveStreams.every((s) => s.status === "fresh" || s.status === "empty") ? "healthy"
                : liveStreams.some((s) => s.status === "error") ? "error"
                : "degraded";
  return res.status(200).json({
    checked_at: new Date().toISOString(),
    overall_status: overall,
    sources: out,
  });
}

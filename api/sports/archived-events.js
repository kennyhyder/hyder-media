import { createClient } from "@supabase/supabase-js";

// List archived (status=closed) events for a league, optionally filtered by year.
// Used by:
//   - sitemap to enumerate every archived URL
//   - /sports/{league}/{year} year-index pages
//   - aggregate stats / pSEO coverage tracking
//
// GET /api/sports/archived-events?league=mlb&year=2026&limit=500
//   → { events: [{ id, league, title, slug, season_year, start_time, closed_at, has_archive }] }
//
// No auth — public read fields.

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const league = req.query.league;
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const limit = Math.min(parseInt(req.query.limit || "500", 10), 2000);

  if (!league) return res.status(400).json({ error: "league required" });

  const supabase = getSupabase();
  let q = supabase
    .from("sports_events")
    .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker, closed_at")
    .eq("league", league)
    .eq("status", "closed")
    .order("start_time", { ascending: false })
    .limit(limit);

  if (year != null && Number.isFinite(year)) q = q.eq("season_year", year);

  const { data: events, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Mark which have a snapshot row (most should, since archive cron writes both)
  const ids = (events || []).map((e) => e.id);
  let withArchive = new Set();
  if (ids.length) {
    const { data: archived } = await supabase
      .from("sports_event_archive")
      .select("sports_event_id")
      .in("sports_event_id", ids);
    withArchive = new Set((archived || []).map((a) => a.sports_event_id));
  }

  const enriched = (events || []).map((e) => ({ ...e, has_archive: withArchive.has(e.id) }));
  return res.status(200).json({ events: enriched });
}

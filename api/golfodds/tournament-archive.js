import { createClient } from "@supabase/supabase-js";

// Returns the closing snapshot for an archived golf tournament.
//
// GET /api/golfodds/tournament-archive?id=<uuid>
// GET /api/golfodds/tournament-archive?year=2026&slug=pga-championship
//   → { tournament: {...}, archive: { closed_at, final_snapshot } | null }
//
// No auth — public read fields.

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  const supabase = getSupabase();
  const { id, year, slug } = req.query;

  let row = null;
  if (id) {
    const { data } = await supabase
      .from("golfodds_tournaments")
      .select("id, tour, name, short_name, season_year, start_date, end_date, course_name, location, is_major, kalshi_event_ticker, dg_event_id, status, slug, closed_at")
      .eq("id", id)
      .maybeSingle();
    row = data;
  } else if (year && slug) {
    const yearInt = parseInt(year, 10);
    if (!Number.isFinite(yearInt)) return res.status(400).json({ error: "year must be integer" });
    const { data } = await supabase
      .from("golfodds_tournaments")
      .select("id, tour, name, short_name, season_year, start_date, end_date, course_name, location, is_major, kalshi_event_ticker, dg_event_id, status, slug, closed_at")
      .eq("season_year", yearInt)
      .eq("slug", slug)
      .maybeSingle();
    row = data;
  } else {
    return res.status(400).json({ error: "id OR (year + slug) required" });
  }

  if (!row) return res.status(404).json({ tournament: null, archive: null });

  const { data: arch } = await supabase
    .from("golfodds_tournament_archive")
    .select("closed_at, final_snapshot")
    .eq("tournament_id", row.id)
    .maybeSingle();

  return res.status(200).json({ tournament: row, archive: arch || null });
}

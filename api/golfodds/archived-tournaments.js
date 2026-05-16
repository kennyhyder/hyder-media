import { createClient } from "@supabase/supabase-js";

// List archived (status=closed) golf tournaments, optionally filtered by year.
//
// GET /api/golfodds/archived-tournaments?year=2026
//   → { tournaments: [{ id, name, slug, season_year, start_date, end_date, is_major, closed_at, has_archive }] }

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const supabase = getSupabase();

  let q = supabase
    .from("golfodds_tournaments")
    .select("id, tour, name, short_name, season_year, start_date, end_date, is_major, slug, closed_at")
    .eq("status", "closed")
    .order("end_date", { ascending: false });

  if (year != null && Number.isFinite(year)) q = q.eq("season_year", year);

  const { data: tournaments, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const ids = (tournaments || []).map((t) => t.id);
  let withArchive = new Set();
  if (ids.length) {
    const { data: arch } = await supabase
      .from("golfodds_tournament_archive")
      .select("tournament_id")
      .in("tournament_id", ids);
    withArchive = new Set((arch || []).map((a) => a.tournament_id));
  }

  const enriched = (tournaments || []).map((t) => ({ ...t, has_archive: withArchive.has(t.id) }));
  return res.status(200).json({ tournaments: enriched });
}

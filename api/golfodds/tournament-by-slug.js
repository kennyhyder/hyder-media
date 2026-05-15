import { createClient } from "@supabase/supabase-js";

// Lookup a golf tournament by its canonical (season_year, slug) pair.
//
// GET /api/golfodds/tournament-by-slug?year=2026&slug=pga-championship
//   → { tournament: { id, name, ... } }
// GET /api/golfodds/tournament-by-slug?id=<uuid>
//   → { tournament: { id, season_year, slug } }     (reverse-resolve for redirects)
//
// No auth required — these are all public read fields.

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  const { year, slug, id } = req.query;
  const supabase = getSupabase();

  if (id) {
    const { data } = await supabase
      .from("golfodds_tournaments")
      .select("id, name, short_name, season_year, slug, start_date, is_major, status, kalshi_event_ticker, dg_event_id")
      .eq("id", id)
      .maybeSingle();
    return res.status(200).json({ tournament: data || null });
  }

  if (!year || !slug) return res.status(400).json({ error: "year + slug required" });
  const yearInt = parseInt(year, 10);
  if (!Number.isFinite(yearInt)) return res.status(400).json({ error: "year must be integer" });

  const { data } = await supabase
    .from("golfodds_tournaments")
    .select("id, name, short_name, season_year, slug, start_date, is_major, status, kalshi_event_ticker, dg_event_id")
    .eq("season_year", yearInt)
    .eq("slug", slug)
    .maybeSingle();
  return res.status(200).json({ tournament: data || null });
}

import { createClient } from "@supabase/supabase-js";

// List all teams for a league (or across all leagues if none specified).
// Used by the sitemap generator + future team-index pages.
//
// GET /api/sports/teams?league=nba           → [{ id, league, name, slug, abbreviation }, …]
// GET /api/sports/teams                       → all teams across all leagues

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  const { league, kind } = req.query;
  const supabase = getSupabase();

  let q = supabase
    .from("sports_contestants")
    .select("id, league, name, slug, kind, abbreviation")
    .not("slug", "is", null)
    .order("name", { ascending: true });
  if (league) q = q.eq("league", league);
  if (kind) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ teams: data || [] });
}

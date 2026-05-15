import { createClient } from "@supabase/supabase-js";

// Lookup a sports event by its canonical (league, season_year, slug) tuple.
//
// GET /api/sports/event-by-slug?league=nba&year=2026&slug=lakers-vs-celtics-game-3
//   → { event: { id, league, title, ... } }
// GET /api/sports/event-by-slug?id=<uuid>
//   → { event: { id, league, season_year, slug } }   (reverse-resolve for redirects)
//
// No auth required — public read fields.

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  const { league, year, slug, id } = req.query;
  const supabase = getSupabase();

  if (id) {
    const { data } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker")
      .eq("id", id)
      .maybeSingle();
    return res.status(200).json({ event: data || null });
  }

  if (!league || !year || !slug) return res.status(400).json({ error: "league + year + slug required" });
  const yearInt = parseInt(year, 10);
  if (!Number.isFinite(yearInt)) return res.status(400).json({ error: "year must be integer" });

  const { data } = await supabase
    .from("sports_events")
    .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker")
    .eq("league", league)
    .eq("season_year", yearInt)
    .eq("slug", slug)
    .maybeSingle();
  return res.status(200).json({ event: data || null });
}

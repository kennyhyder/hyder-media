import { createClient } from "@supabase/supabase-js";

// Returns the closing snapshot for an archived sports event.
//
// GET /api/sports/event-archive?id=<uuid>
//   → { archive: { closed_at, final_snapshot } | null, event: {...} }
//
// GET /api/sports/event-archive?league=nba&year=2025&slug=lakers-vs-celtics
//   (convenience: resolve slug → id → archive)
//
// No auth — public read fields.

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  const supabase = getSupabase();
  const { id, league, year, slug } = req.query;

  let eventRow = null;
  if (id) {
    const { data } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker, closed_at")
      .eq("id", id)
      .maybeSingle();
    eventRow = data;
  } else if (league && year && slug) {
    const yearInt = parseInt(year, 10);
    if (!Number.isFinite(yearInt)) return res.status(400).json({ error: "year must be integer" });
    const { data } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, season_year, slug, start_time, status, kalshi_event_ticker, closed_at")
      .eq("league", league)
      .eq("season_year", yearInt)
      .eq("slug", slug)
      .maybeSingle();
    eventRow = data;
  } else {
    return res.status(400).json({ error: "id OR (league + year + slug) required" });
  }

  if (!eventRow) return res.status(404).json({ event: null, archive: null });

  const { data: arch } = await supabase
    .from("sports_event_archive")
    .select("closed_at, final_snapshot")
    .eq("sports_event_id", eventRow.id)
    .maybeSingle();

  return res.status(200).json({ event: eventRow, archive: arch || null });
}

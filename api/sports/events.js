import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/events?league=nba&status=open — events grouped for league pages
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const league = req.query.league;
  const status = req.query.status || "open";
  if (!league) return res.status(400).json({ error: "league required" });

  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
      .eq("league", league)
      .eq("status", status)
      .order("start_time", { ascending: true, nullsFirst: false })
      .range(0, 199);
    return res.status(200).json({ events: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

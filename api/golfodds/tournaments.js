import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("golfodds_tournaments")
      .select("id, tour, name, short_name, season_year, slug, start_date, end_date, is_major, status, kalshi_event_ticker, dg_event_id")
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tournaments: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

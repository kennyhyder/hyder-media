import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/leagues — list of active leagues for the UI
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("sports_leagues")
      .select("key, display_name, sport_category, icon, accent_color, active, display_order")
      .eq("active", true)
      .order("display_order", { ascending: true });
    return res.status(200).json({ leagues: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();

    // Single RPC call replaces 55+ sequential queries
    const [statsResult, sourcesResult] = await Promise.all([
      supabase.rpc("solar_dashboard_stats"),
      supabase.from("solar_data_sources").select("name, record_count, last_import"),
    ]);

    if (statsResult.error) return res.status(500).json({ error: statsResult.error.message });

    const stats = statsResult.data;
    stats.data_sources = sourcesResult.data || [];

    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

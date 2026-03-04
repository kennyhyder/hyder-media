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

    // Read pre-computed stats from cache table (instant) + data sources list
    const [cacheResult, sourcesResult] = await Promise.all([
      supabase.from("solar_stats_cache").select("stats").eq("id", 1).single(),
      supabase.from("solar_data_sources").select("name, record_count, last_import"),
    ]);

    if (cacheResult.error) return res.status(500).json({ error: cacheResult.error.message });

    const stats = cacheResult.data.stats;
    stats.data_sources = sourcesResult.data || [];

    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

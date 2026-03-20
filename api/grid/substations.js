import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Escape special PostgREST characters for use in .ilike() filters */
function sanitizeSearch(str) {
  if (!str) return "";
  return str.replace(/[%_.*()]/g, (ch) => "\\" + ch);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;

    const { state, min_voltage, search, limit, offset } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return res.status(400).json({ error: "state must be a 2-letter code" });
    if (min_voltage && (isNaN(parseFloat(min_voltage)) || parseFloat(min_voltage) < 0))
      return res.status(400).json({ error: "min_voltage must be a non-negative number" });

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let query = supabase
      .from("grid_substations")
      .select("id,name,state,county,latitude,longitude,max_voltage_kv,hifld_id,created_at", { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (min_voltage)
      query = query.gte("max_voltage_kv", parseFloat(min_voltage));
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.ilike("name", `%${safe}%`);
    }

    query = query
      .order("max_voltage_kv", { ascending: false, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      data: data || [],
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();
    const { state, min_voltage, search, limit, offset } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = parseInt(offset) || 0;

    let query = supabase
      .from("grid_substations")
      .select("*", { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (min_voltage)
      query = query.gte("max_voltage_kv", parseFloat(min_voltage));
    if (search) query = query.ilike("name", `%${search}%`);

    query = query
      .order("max_voltage_kv", { ascending: false, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

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

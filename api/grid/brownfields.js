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
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();
    const {
      state,
      site_type,
      cleanup_status,
      has_substation,
      search,
      sort,
      order,
      limit,
      offset,
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = parseInt(offset) || 0;

    let query = supabase
      .from("grid_brownfield_sites")
      .select("*", { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (cleanup_status) query = query.eq("cleanup_status", cleanup_status);
    if (has_substation === "true")
      query = query.not("nearest_substation_id", "is", null);
    if (has_substation === "false")
      query = query.is("nearest_substation_id", null);
    if (search)
      query = query.or(
        `name.ilike.%${search}%,former_use.ilike.%${search}%,city.ilike.%${search}%`
      );

    const validSorts = [
      "existing_capacity_mw", "acreage", "nearest_substation_distance_km",
      "state", "retirement_date", "created_at",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "existing_capacity_mw";
    const ascending = order === "asc";

    query = query
      .order(sortCol, { ascending, nullsFirst: false })
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

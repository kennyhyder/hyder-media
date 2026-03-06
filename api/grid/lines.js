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
    const {
      state,
      min_voltage,
      max_voltage,
      min_capacity,
      max_capacity,
      upgrade_only,
      owner,
      search,
      sort,
      order,
      limit,
      offset,
      with_geometry,
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, with_geometry === "true" ? 500 : 200);
    const offsetNum = parseInt(offset) || 0;

    // Include geometry_wkt only when explicitly requested (for map rendering)
    const columns = with_geometry === "true"
      ? "id,hifld_id,geometry_wkt,voltage_kv,capacity_mw,upgrade_candidate,owner,state,sub_1,sub_2,naession"
      : "id,hifld_id,source_record_id,voltage_kv,volt_class,owner,status,line_type,sub_1,sub_2,naession,static_rating_amps,capacity_mw,upgrade_candidate,ercot_shadow_price,ercot_binding_count,ercot_mw_limit,state,county,length_miles,data_source_id,created_at,updated_at";

    let query = supabase
      .from("grid_transmission_lines")
      .select(columns, { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (min_voltage) query = query.gte("voltage_kv", parseFloat(min_voltage));
    if (max_voltage) query = query.lte("voltage_kv", parseFloat(max_voltage));
    if (min_capacity)
      query = query.gte("capacity_mw", parseFloat(min_capacity));
    if (max_capacity)
      query = query.lte("capacity_mw", parseFloat(max_capacity));
    if (upgrade_only === "true") query = query.eq("upgrade_candidate", true);
    if (owner) query = query.ilike("owner", `%${owner}%`);
    if (search)
      query = query.or(
        `naession.ilike.%${search}%,sub_1.ilike.%${search}%,sub_2.ilike.%${search}%`
      );

    // Sort
    const validSorts = [
      "voltage_kv",
      "capacity_mw",
      "length_miles",
      "state",
      "owner",
      "created_at",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "voltage_kv";
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

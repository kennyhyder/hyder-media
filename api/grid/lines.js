import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Escape special PostgREST characters for use in .or() / .ilike() filters */
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

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return res.status(400).json({ error: "state must be a 2-letter code" });
    if (min_voltage && (isNaN(parseFloat(min_voltage)) || parseFloat(min_voltage) < 0))
      return res.status(400).json({ error: "min_voltage must be a non-negative number" });
    if (max_voltage && (isNaN(parseFloat(max_voltage)) || parseFloat(max_voltage) < 0))
      return res.status(400).json({ error: "max_voltage must be a non-negative number" });
    if (min_capacity && (isNaN(parseFloat(min_capacity)) || parseFloat(min_capacity) < 0))
      return res.status(400).json({ error: "min_capacity must be a non-negative number" });
    if (max_capacity && (isNaN(parseFloat(max_capacity)) || parseFloat(max_capacity) < 0))
      return res.status(400).json({ error: "max_capacity must be a non-negative number" });

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), with_geometry === "true" ? 500 : 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

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
    if (owner) {
      const safeOwner = sanitizeSearch(owner);
      query = query.ilike("owner", `%${safeOwner}%`);
    }
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `naession.ilike.%${safe}%,sub_1.ilike.%${safe}%,sub_2.ilike.%${safe}%`
      );
    }

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

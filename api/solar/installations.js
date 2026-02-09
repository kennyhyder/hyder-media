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
    const {
      page = "1",
      limit = "50",
      sort = "install_date",
      order = "desc",
      // Search filters
      state,
      site_type,
      installer,
      owner,
      min_size,
      max_size,
      start_date,
      end_date,
      module_manufacturer,
      has_battery,
      site_status,
      near_lat,
      near_lng,
      radius_miles,
      q, // text search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from("solar_installations")
      .select("*", { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (site_status) query = query.eq("site_status", site_status);
    if (installer) query = query.ilike("installer_name", `%${installer}%`);
    if (owner) query = query.ilike("owner_name", `%${owner}%`);
    if (min_size) query = query.gte("capacity_dc_kw", parseFloat(min_size));
    if (max_size) query = query.lte("capacity_dc_kw", parseFloat(max_size));
    if (start_date) query = query.gte("install_date", start_date);
    if (end_date) query = query.lte("install_date", end_date);
    if (has_battery === "true") query = query.eq("has_battery_storage", true);
    if (q) query = query.or(`site_name.ilike.%${q}%,county.ilike.%${q}%,installer_name.ilike.%${q}%`);

    // Geospatial search
    if (near_lat && near_lng && radius_miles) {
      const meters = parseFloat(radius_miles) * 1609.34;
      query = query.rpc("solar_nearby", {
        lat: parseFloat(near_lat),
        lng: parseFloat(near_lng),
        radius_m: meters,
      });
    }

    // Sort and paginate
    const validSorts = ["install_date", "capacity_dc_kw", "state", "site_name", "created_at"];
    const sortCol = validSorts.includes(sort) ? sort : "install_date";
    query = query
      .order(sortCol, { ascending: order === "asc", nullsFirst: false })
      .range(offset, offset + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({
      data: data || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
      manufacturer,
      model,
      equipment_type,
      min_age_years,
      state,
      status,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Query equipment with installation join
    let query = supabase
      .from("solar_equipment")
      .select(
        `
        *,
        installation:solar_installations!inner(
          id, site_name, state, city, county, capacity_dc_kw, capacity_mw,
          install_date, site_type, site_status, latitude, longitude
        )
      `,
        { count: "exact" }
      );

    // Equipment filters
    if (manufacturer) query = query.ilike("manufacturer", `%${manufacturer}%`);
    if (model) query = query.ilike("model", `%${model}%`);
    if (equipment_type) query = query.eq("equipment_type", equipment_type);
    if (status) query = query.eq("equipment_status", status);

    // Installation filters via join
    if (state) query = query.eq("installation.state", state.toUpperCase());

    // Age filter (equipment installed more than N years ago)
    if (min_age_years) {
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - parseInt(min_age_years));
      query = query.lte("installation.install_date", cutoffDate.toISOString().split("T")[0]);
    }

    const { data, error, count } = await query
      .order("manufacturer", { ascending: true })
      .range(offset, offset + limitNum - 1);

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

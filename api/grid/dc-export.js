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
      min_score,
      max_score,
      min_capacity,
      iso_region,
      format,
    } = req.query;

    const columns = [
      "name", "site_type", "state", "county", "fips_code",
      "latitude", "longitude",
      "nearest_substation_name", "nearest_substation_distance_km",
      "substation_voltage_kv", "available_capacity_mw",
      "nearest_ixp_name", "nearest_ixp_distance_km",
      "nearest_dc_name", "nearest_dc_distance_km",
      "former_use", "existing_capacity_mw", "acreage",
      "dc_score", "score_power", "score_speed_to_power", "score_fiber",
      "score_water", "score_hazard", "score_labor", "score_existing_dc",
      "score_land", "score_tax", "score_climate",
      "iso_region"
    ].join(",");

    let query = supabase
      .from("grid_dc_sites")
      .select(columns);

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (min_score) query = query.gte("dc_score", parseFloat(min_score));
    if (max_score) query = query.lte("dc_score", parseFloat(max_score));
    if (min_capacity) query = query.gte("available_capacity_mw", parseFloat(min_capacity));
    if (iso_region) query = query.eq("iso_region", iso_region);

    query = query
      .order("dc_score", { ascending: false, nullsFirst: false })
      .limit(10000);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];

    if (format === "json") {
      return res.status(200).json({ data: rows, total: rows.length });
    }

    // CSV export
    const headers = [
      "Name", "Site Type", "State", "County", "FIPS",
      "Latitude", "Longitude",
      "Nearest Substation", "Substation Distance (km)",
      "Voltage (kV)", "Available Capacity (MW)",
      "Nearest IXP", "IXP Distance (km)",
      "Nearest DC", "DC Distance (km)",
      "Former Use", "Existing Capacity (MW)", "Acreage",
      "DC Score", "Power", "Speed to Power", "Fiber",
      "Water", "Hazard", "Labor", "Existing DC",
      "Land", "Tax", "Climate",
      "ISO Region"
    ];

    const csvRows = [headers.join(",")];
    for (const row of rows) {
      csvRows.push([
        csvEscape(row.name),
        row.site_type,
        row.state,
        csvEscape(row.county),
        row.fips_code,
        row.latitude,
        row.longitude,
        csvEscape(row.nearest_substation_name),
        row.nearest_substation_distance_km,
        row.substation_voltage_kv,
        row.available_capacity_mw,
        csvEscape(row.nearest_ixp_name),
        row.nearest_ixp_distance_km,
        csvEscape(row.nearest_dc_name),
        row.nearest_dc_distance_km,
        csvEscape(row.former_use),
        row.existing_capacity_mw,
        row.acreage,
        row.dc_score,
        row.score_power,
        row.score_speed_to_power,
        row.score_fiber,
        row.score_water,
        row.score_hazard,
        row.score_labor,
        row.score_existing_dc,
        row.score_land,
        row.score_tax,
        row.score_climate,
        row.iso_region,
      ].join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="gridscout-dc-sites.csv"`);
    return res.status(200).send(csvRows.join("\n"));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function csvEscape(val) {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

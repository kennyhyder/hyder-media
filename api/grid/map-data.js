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
      include_dcs,
      include_ixps,
      bounds, // "sw_lat,sw_lng,ne_lat,ne_lng"
    } = req.query;

    // Columns for map markers + sub-scores for client-side custom scoring
    const siteColumns = "id,name,site_type,state,county,latitude,longitude,dc_score,available_capacity_mw,former_use,substation_voltage_kv,nearest_ixp_distance_km,nearest_dc_distance_km,acreage,score_power,score_speed_to_power,score_fiber,score_water,score_hazard,score_labor,score_existing_dc,score_land,score_tax,score_climate";

    let query = supabase
      .from("grid_dc_sites")
      .select(siteColumns);

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (min_score) query = query.gte("dc_score", parseFloat(min_score));
    if (max_score) query = query.lte("dc_score", parseFloat(max_score));

    // Bounding box filter
    if (bounds) {
      const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
      if (!isNaN(swLat) && !isNaN(swLng) && !isNaN(neLat) && !isNaN(neLng)) {
        query = query
          .gte("latitude", swLat)
          .lte("latitude", neLat)
          .gte("longitude", swLng)
          .lte("longitude", neLng);
      }
    }

    // Supabase max 1000 per request — paginate
    const allSites = [];
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await query
        .range(offset, offset + pageSize - 1)
        .order("dc_score", { ascending: false, nullsFirst: false });

      if (error) throw error;
      if (data && data.length > 0) {
        allSites.push(...data);
        offset += data.length;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    const result = { sites: allSites, total: allSites.length };

    // Optionally include existing datacenters
    if (include_dcs === "true" || include_dcs === "1") {
      const { data: dcs } = await supabase
        .from("grid_datacenters")
        .select("id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built")
        .order("capacity_mw", { ascending: false, nullsFirst: true });
      result.datacenters = dcs || [];
    }

    // Optionally include IXPs
    if (include_ixps === "true" || include_ixps === "1") {
      const { data: ixps } = await supabase
        .from("grid_ixp_facilities")
        .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count")
        .order("network_count", { ascending: false, nullsFirst: true });
      result.ixps = ixps || [];
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("Map data error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

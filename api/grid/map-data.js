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
      include_lines,
      include_substations,
      bounds, // "sw_lat,sw_lng,ne_lat,ne_lng"
      lite, // "1" for minimal columns (faster initial load)
      limit, // max sites to return (default 5000)
    } = req.query;

    const maxSites = Math.min(parseInt(limit) || 5000, 20000);

    // Lite mode: minimal columns for fast initial map render
    const siteColumns = lite === "1"
      ? "id,name,site_type,state,latitude,longitude,dc_score"
      : "id,name,site_type,state,county,latitude,longitude,dc_score,available_capacity_mw,former_use,substation_voltage_kv,nearest_ixp_distance_km,nearest_dc_distance_km,acreage,score_power,score_speed_to_power,score_fiber,score_water,score_hazard,score_labor,score_existing_dc,score_land,score_tax,score_climate";

    let query = supabase
      .from("grid_dc_sites")
      .select(siteColumns, { count: "exact" });

    // Must have coordinates
    query = query.not("latitude", "is", null).not("longitude", "is", null);

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

    // Paginate up to maxSites (ordered by score desc — best sites first)
    const allSites = [];
    let offset = 0;
    const pageSize = 1000;
    let totalCount = 0;

    while (allSites.length < maxSites) {
      const remaining = maxSites - allSites.length;
      const batchSize = Math.min(pageSize, remaining);
      const { data, error, count } = await query
        .range(offset, offset + batchSize - 1)
        .order("dc_score", { ascending: false, nullsFirst: false });

      if (error) throw error;
      if (!data || data.length === 0) break;

      allSites.push(...data);
      offset += data.length;

      if (count != null) totalCount = count;
      if (data.length < batchSize) break;
    }

    if (!totalCount) totalCount = allSites.length;
    const result = { sites: allSites, total: totalCount, returned: allSites.length };

    // Optionally include existing datacenters
    if (include_dcs === "true" || include_dcs === "1") {
      const dcColumns = lite === "1"
        ? "id,name,state,latitude,longitude,dc_type"
        : "id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built";

      let dcQuery = supabase
        .from("grid_datacenters")
        .select(dcColumns)
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (bounds) {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if (!isNaN(swLat)) {
          dcQuery = dcQuery
            .gte("latitude", swLat).lte("latitude", neLat)
            .gte("longitude", swLng).lte("longitude", neLng);
        }
      }

      const { data: dcs } = await dcQuery
        .order("capacity_mw", { ascending: false, nullsFirst: true })
        .limit(1000);
      result.datacenters = dcs || [];
    }

    // Optionally include IXPs
    if (include_ixps === "true" || include_ixps === "1") {
      const ixpColumns = lite === "1"
        ? "id,name,state,latitude,longitude"
        : "id,name,org_name,city,state,latitude,longitude,ix_count,network_count";

      let ixpQuery = supabase
        .from("grid_ixp_facilities")
        .select(ixpColumns)
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (bounds) {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if (!isNaN(swLat)) {
          ixpQuery = ixpQuery
            .gte("latitude", swLat).lte("latitude", neLat)
            .gte("longitude", swLng).lte("longitude", neLng);
        }
      }

      const { data: ixps } = await ixpQuery
        .order("network_count", { ascending: false, nullsFirst: true })
        .limit(1000);
      result.ixps = ixps || [];
    }

    // Optionally include transmission lines (with geometry for polylines)
    if (include_lines === "true" || include_lines === "1") {
      let lineQuery = supabase
        .from("grid_transmission_lines")
        .select("id,voltage_kv,owner,sub_1,sub_2,geometry_wkt")
        .not("geometry_wkt", "is", null);

      // Only load lines at higher zoom levels (require bounds)
      if (bounds) {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if (!isNaN(swLat)) {
          // Filter lines whose substations fall within bounds (approximate)
          // Lines table doesn't have lat/lng directly, but we can use sub coords
          // For now, return top lines by voltage within limit
        }
      }

      const { data: lines } = await lineQuery
        .order("voltage_kv", { ascending: false, nullsFirst: true })
        .limit(2000);
      result.lines = lines || [];
    }

    // Optionally include substations
    if (include_substations === "true" || include_substations === "1") {
      let subQuery = supabase
        .from("grid_substations")
        .select("id,name,state,latitude,longitude,max_voltage_kv")
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (bounds) {
        const [swLat, swLng, neLat, neLng] = bounds.split(",").map(Number);
        if (!isNaN(swLat)) {
          subQuery = subQuery
            .gte("latitude", swLat).lte("latitude", neLat)
            .gte("longitude", swLng).lte("longitude", neLng);
        }
      }

      const { data: subs } = await subQuery
        .order("max_voltage_kv", { ascending: false, nullsFirst: true })
        .limit(2000);
      result.substations = subs || [];
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("Map data error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

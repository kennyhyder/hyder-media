import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;
    const {
      state,
      site_type,
      min_score,
      max_score,
      include_dcs,
      include_ixps,
      include_lines,
      include_substations,
      include_fiber,
      bounds, // "sw_lat,sw_lng,ne_lat,ne_lng"
      lite, // "1" for minimal columns (faster initial load)
      limit, // max sites to return (default 5000)
    } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return res.status(400).json({ error: "state must be a 2-letter code" });
    if (site_type && !["substation", "brownfield", "greenfield", "industrial", "federal_excess", "mine", "military_brac"].includes(site_type))
      return res.status(400).json({ error: "Invalid site_type" });
    if (min_score && (isNaN(parseFloat(min_score)) || parseFloat(min_score) < 0 || parseFloat(min_score) > 100))
      return res.status(400).json({ error: "min_score must be a number between 0 and 100" });
    if (max_score && (isNaN(parseFloat(max_score)) || parseFloat(max_score) < 0 || parseFloat(max_score) > 100))
      return res.status(400).json({ error: "max_score must be a number between 0 and 100" });

    const maxSites = Math.min(Math.max(parseInt(limit) || 5000, 1), 20000);

    // Parse bounds ONCE and reuse everywhere
    let parsedBounds = null;
    if (bounds) {
      const parts = bounds.split(",").map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        const [swLat, swLng, neLat, neLng] = parts;
        if (swLat >= -90 && swLat <= 90 && neLat >= -90 && neLat <= 90 &&
            swLng >= -180 && swLng <= 180 && neLng >= -180 && neLng <= 180) {
          parsedBounds = { swLat, swLng, neLat, neLng };
        }
      }
      if (!parsedBounds) {
        return res.status(400).json({ error: "bounds must be sw_lat,sw_lng,ne_lat,ne_lng with valid coordinates" });
      }
    }

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
    if (parsedBounds) {
      query = query
        .gte("latitude", parsedBounds.swLat)
        .lte("latitude", parsedBounds.neLat)
        .gte("longitude", parsedBounds.swLng)
        .lte("longitude", parsedBounds.neLng);
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

      if (error) return res.status(500).json({ error: error.message });
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

      if (parsedBounds) {
        dcQuery = dcQuery
          .gte("latitude", parsedBounds.swLat).lte("latitude", parsedBounds.neLat)
          .gte("longitude", parsedBounds.swLng).lte("longitude", parsedBounds.neLng);
      }

      const { data: dcs, error: dcErr } = await dcQuery
        .order("capacity_mw", { ascending: false, nullsFirst: true })
        .limit(1000);
      if (dcErr) return res.status(500).json({ error: dcErr.message });
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

      if (parsedBounds) {
        ixpQuery = ixpQuery
          .gte("latitude", parsedBounds.swLat).lte("latitude", parsedBounds.neLat)
          .gte("longitude", parsedBounds.swLng).lte("longitude", parsedBounds.neLng);
      }

      const { data: ixps, error: ixpErr } = await ixpQuery
        .order("network_count", { ascending: false, nullsFirst: true })
        .limit(1000);
      if (ixpErr) return res.status(500).json({ error: ixpErr.message });
      result.ixps = ixps || [];
    }

    // Optionally include transmission lines (with geometry for polylines)
    // Note: lines lack lat/lng columns — filter by state if provided, otherwise return top by voltage
    if (include_lines === "true" || include_lines === "1") {
      let lineQuery = supabase
        .from("grid_transmission_lines")
        .select("id,voltage_kv,owner,sub_1,sub_2,geometry_wkt,state")
        .not("geometry_wkt", "is", null);

      if (state) {
        lineQuery = lineQuery.eq("state", state.toUpperCase());
      }

      const { data: lines, error: lineErr } = await lineQuery
        .order("voltage_kv", { ascending: false, nullsFirst: true })
        .limit(2000);
      if (!lineErr) result.lines = lines || [];
    }

    // Optionally include fiber routes
    if (include_fiber === "true" || include_fiber === "1") {
      let fiberQuery = supabase
        .from("grid_fiber_routes")
        .select("id,name,operator,fiber_type,location_type,geometry_json,state")
        .not("geometry_json", "is", null);

      if (state) {
        fiberQuery = fiberQuery.eq("state", state.toUpperCase());
      }

      if (parsedBounds) {
        fiberQuery = fiberQuery
          .gte("centroid_lat", parsedBounds.swLat).lte("centroid_lat", parsedBounds.neLat)
          .gte("centroid_lng", parsedBounds.swLng).lte("centroid_lng", parsedBounds.neLng);
      }

      const { data: fiber, error: fiberErr } = await fiberQuery.limit(5000);
      if (!fiberErr) result.fiber = fiber || [];
    }

    // Optionally include substations
    if (include_substations === "true" || include_substations === "1") {
      let subQuery = supabase
        .from("grid_substations")
        .select("id,name,state,latitude,longitude,max_voltage_kv")
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (parsedBounds) {
        subQuery = subQuery
          .gte("latitude", parsedBounds.swLat).lte("latitude", parsedBounds.neLat)
          .gte("longitude", parsedBounds.swLng).lte("longitude", parsedBounds.neLng);
      }

      const { data: subs, error: subErr } = await subQuery
        .order("max_voltage_kv", { ascending: false, nullsFirst: true })
        .limit(2000);
      if (subErr) return res.status(500).json({ error: subErr.message });
      result.substations = subs || [];
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(result);
  } catch (err) {
    console.error("Map data error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess, demoLimitsPayload } from "./_demo.js";

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
    const access = await checkDemoAccess(req, res);
    if (!access) return; // Response already sent (401/429/403)
    const {
      state,
      site_type,
      min_score,
      max_score,
      min_capacity,
      iso_region,
      flood,
      search,
      near_lat,
      near_lng,
      radius_miles,
      sort,
      order,
      limit,
      offset,
    } = req.query;

    // Input validation
    const maxLimit = access.mode === "demo" ? 10 : 200;
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), maxLimit);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    if (state && !/^[A-Za-z]{2}$/.test(state))
      return res.status(400).json({ error: "state must be a 2-letter code" });
    if (site_type && !["substation", "brownfield", "greenfield"].includes(site_type))
      return res.status(400).json({ error: "site_type must be substation, brownfield, or greenfield" });
    if (min_score && (isNaN(parseFloat(min_score)) || parseFloat(min_score) < 0 || parseFloat(min_score) > 100))
      return res.status(400).json({ error: "min_score must be a number between 0 and 100" });
    if (max_score && (isNaN(parseFloat(max_score)) || parseFloat(max_score) < 0 || parseFloat(max_score) > 100))
      return res.status(400).json({ error: "max_score must be a number between 0 and 100" });
    if (min_capacity && (isNaN(parseFloat(min_capacity)) || parseFloat(min_capacity) < 0))
      return res.status(400).json({ error: "min_capacity must be a non-negative number" });
    if (near_lat && (isNaN(parseFloat(near_lat)) || parseFloat(near_lat) < -90 || parseFloat(near_lat) > 90))
      return res.status(400).json({ error: "near_lat must be between -90 and 90" });
    if (near_lng && (isNaN(parseFloat(near_lng)) || parseFloat(near_lng) < -180 || parseFloat(near_lng) > 180))
      return res.status(400).json({ error: "near_lng must be between -180 and 180" });
    if (radius_miles && (isNaN(parseFloat(radius_miles)) || parseFloat(radius_miles) <= 0 || parseFloat(radius_miles) > 500))
      return res.status(400).json({ error: "radius_miles must be between 0 and 500" });

    const columns = [
      "id", "source_record_id", "name", "site_type", "state", "county",
      "fips_code", "latitude", "longitude",
      "nearest_substation_name", "nearest_substation_distance_km",
      "substation_voltage_kv", "available_capacity_mw",
      "nearest_ixp_name", "nearest_ixp_distance_km",
      "nearest_dc_name", "nearest_dc_distance_km",
      "brownfield_id", "former_use", "existing_capacity_mw",
      "dc_score", "score_power", "score_speed_to_power", "score_fiber",
      "score_water", "score_hazard", "score_labor", "score_existing_dc",
      "score_land", "score_tax", "score_climate",
      "score_energy_cost", "score_gas_pipeline", "score_buildability", "score_construction_cost",
      "iso_region", "acreage",
      "energy_price_mwh", "buildability_score", "construction_cost_index",
      "nearest_gas_pipeline_km", "nlcd_class", "fcc_fiber_pct",
      "flood_zone", "flood_zone_sfha"
    ].join(",");

    let query = supabase
      .from("grid_dc_sites")
      .select(columns, { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (min_score) query = query.gte("dc_score", parseFloat(min_score));
    if (max_score) query = query.lte("dc_score", parseFloat(max_score));
    if (min_capacity) query = query.gte("available_capacity_mw", parseFloat(min_capacity));
    if (iso_region) query = query.eq("iso_region", iso_region);
    if (flood === "no_sfha") query = query.or("flood_zone_sfha.is.null,flood_zone_sfha.eq.false");
    if (flood === "sfha") query = query.eq("flood_zone_sfha", true);
    if (flood === "X") query = query.eq("flood_zone", "X");
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,county.ilike.%${safe}%,former_use.ilike.%${safe}%`
      );
    }

    // Geospatial bounding box filter
    const hasGeo = near_lat && near_lng;
    if (hasGeo) {
      const lat = parseFloat(near_lat);
      const lng = parseFloat(near_lng);
      const radius = parseFloat(radius_miles) || 50;
      const latDelta = radius / 69.0;
      const lngDelta = radius / (69.0 * Math.cos((lat * Math.PI) / 180));
      query = query
        .gte("latitude", lat - latDelta)
        .lte("latitude", lat + latDelta)
        .gte("longitude", lng - lngDelta)
        .lte("longitude", lng + lngDelta);
    }

    const validSorts = [
      "dc_score", "available_capacity_mw", "substation_voltage_kv",
      "nearest_ixp_distance_km", "nearest_dc_distance_km", "state", "name", "site_type",
      "energy_price_mwh", "buildability_score", "construction_cost_index",
      "nearest_gas_pipeline_km", "fcc_fiber_pct",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "dc_score";
    const ascending = order === "asc";

    // When geospatial search is active, skip DB sort (JS will re-sort by distance)
    if (!hasGeo) {
      query = query.order(sortCol, { ascending, nullsFirst: false });
    }

    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    // Compute distance if geospatial search
    let results = data || [];
    if (hasGeo) {
      const lat = parseFloat(near_lat);
      const lng = parseFloat(near_lng);
      results = results.map((site) => ({
        ...site,
        distance_miles: haversine(lat, lng, site.latitude, site.longitude),
      }));
      results.sort((a, b) => a.distance_miles - b.distance_miles);
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      data: results,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
      demo_limits: demoLimitsPayload(access),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

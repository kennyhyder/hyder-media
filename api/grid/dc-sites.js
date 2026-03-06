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
      search,
      near_lat,
      near_lng,
      radius_miles,
      sort,
      order,
      limit,
      offset,
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = parseInt(offset) || 0;

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
      "iso_region", "acreage"
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
    if (search)
      query = query.or(
        `name.ilike.%${search}%,county.ilike.%${search}%,former_use.ilike.%${search}%`
      );

    // Geospatial bounding box filter
    if (near_lat && near_lng) {
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
      "nearest_ixp_distance_km", "nearest_dc_distance_km", "state",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "dc_score";
    const ascending = order === "asc";

    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    // Compute distance if geospatial search
    let results = data || [];
    if (near_lat && near_lng) {
      const lat = parseFloat(near_lat);
      const lng = parseFloat(near_lng);
      results = results.map((site) => ({
        ...site,
        distance_miles: haversine(lat, lng, site.latitude, site.longitude),
      }));
      results.sort((a, b) => a.distance_miles - b.distance_miles);
    }

    return res.status(200).json({
      data: results,
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

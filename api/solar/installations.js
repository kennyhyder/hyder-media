import { createClient } from "@supabase/supabase-js";
import { InstallationsQuery, validate } from "./_validate.js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// Haversine distance in miles between two lat/lng pairs
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const params = validate(InstallationsQuery, req.query, res);
  if (!params) return;

  try {
    const supabase = getSupabase();
    const {
      page: pageNum,
      limit: limitNum,
      sort,
      order,
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
      q,
      deduplicate,
    } = params;

    const offset = (pageNum - 1) * limitNum;
    const isGeoSearch = near_lat && near_lng && radius_miles;

    let query = supabase
      .from("solar_installations")
      .select("*", { count: "estimated" });

    // Deduplicate by default (show only canonical records to avoid duplicate physical sites)
    if (deduplicate !== "false") query = query.eq("is_canonical", true);

    // Apply filters
    if (state) query = query.eq("state", state);
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

    // Geospatial search: bounding box filter + Haversine distance
    if (isGeoSearch) {
      const lat = parseFloat(near_lat);
      const lng = parseFloat(near_lng);
      const radius = parseFloat(radius_miles);
      // Bounding box approximation (1 degree lat ≈ 69 miles)
      const latRange = radius / 69;
      const lngRange = radius / (69 * Math.cos((lat * Math.PI) / 180));
      query = query
        .not("latitude", "is", null)
        .gte("latitude", lat - latRange)
        .lte("latitude", lat + latRange)
        .gte("longitude", lng - lngRange)
        .lte("longitude", lng + lngRange);

      // For geo search, fetch more results for distance filtering, then paginate in JS
      const { data: geoData, error: geoError } = await query
        .order("capacity_dc_kw", { ascending: false, nullsFirst: false })
        .range(0, 4999);

      if (geoError) return res.status(500).json({ error: geoError.message });

      // Calculate exact Haversine distances and filter
      const withDistance = (geoData || [])
        .map((row) => ({
          ...row,
          distance_miles: haversineDistance(lat, lng, parseFloat(row.latitude), parseFloat(row.longitude)),
        }))
        .filter((row) => row.distance_miles <= radius)
        .sort((a, b) => a.distance_miles - b.distance_miles);

      const total = withDistance.length;
      const paged = withDistance.slice(offset, offset + limitNum);

      return res.status(200).json({
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }

    // Sort and paginate (non-geo search)
    const validSorts = ["install_date", "capacity_dc_kw", "capacity_mw", "state", "site_name", "site_status", "created_at"];
    const sortCol = validSorts.includes(sort) ? sort : "install_date";

    // When sorting by capacity, exclude NULL/zero values so users see real data
    if (sortCol === "capacity_mw" || sortCol === "capacity_dc_kw") {
      query = query.not(sortCol, "is", null).gt(sortCol, 0);
    }

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

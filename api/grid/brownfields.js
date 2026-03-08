import { createClient } from "@supabase/supabase-js";
import { sanitizeSearch, validatePagination, setCacheHeaders, handleError } from "./_utils.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return handleError(res, "Method not allowed", 405);

  try {
    const {
      state,
      site_type,
      cleanup_status,
      has_substation,
      search,
      sort,
      order,
    } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError(res, "state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(req.query);

    let query = supabase
      .from("grid_brownfield_sites")
      .select("id,name,site_type,state,city,county,latitude,longitude,acreage,existing_capacity_mw,former_use,cleanup_status,retirement_date,nearest_substation_id,nearest_substation_distance_km,created_at", { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (cleanup_status) query = query.eq("cleanup_status", cleanup_status);
    if (has_substation === "true")
      query = query.not("nearest_substation_id", "is", null);
    if (has_substation === "false")
      query = query.is("nearest_substation_id", null);
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,former_use.ilike.%${safe}%,city.ilike.%${safe}%`
      );
    }

    const validSorts = [
      "existing_capacity_mw", "acreage", "nearest_substation_distance_km",
      "state", "retirement_date", "created_at",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "existing_capacity_mw";
    const ascending = order === "asc";

    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return handleError(res, error);

    setCacheHeaders(res);
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
    return handleError(res, err);
  }
}

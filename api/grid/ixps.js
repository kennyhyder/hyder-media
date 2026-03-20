import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";
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
    const access = await checkDemoAccess(req, res);
    if (!access) return;

    const { state, search, sort, order } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError(res, "state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(req.query);

    let query = supabase
      .from("grid_ixp_facilities")
      .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count,website,created_at", { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,city.ilike.%${safe}%`
      );
    }

    const validSorts = ["network_count", "ix_count", "state", "city", "name"];
    const sortCol = validSorts.includes(sort) ? sort : "network_count";
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

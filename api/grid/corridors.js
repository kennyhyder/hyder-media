import { createClient } from "@supabase/supabase-js";
import { validatePagination, setCacheHeaders, handleError } from "./_utils.js";

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
    const { type, state } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError(res, "state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(req.query);

    let query = supabase
      .from("grid_corridors")
      .select("id,corridor_type,name,states,transmission_line_count,total_capacity_mw,upgrade_candidate_count,created_at", { count: "exact" });

    // Apply filters
    if (type) query = query.eq("corridor_type", type);
    if (state) query = query.ilike("states", `%${state.toUpperCase()}%`);

    query = query
      .order("corridor_type", { ascending: true, nullsFirst: false })
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

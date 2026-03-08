import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Escape special PostgREST characters for use in .ilike() filters */
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
    const { fips, state, search, limit, offset } = req.query;

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return res.status(400).json({ error: "state must be a 2-letter code" });
    if (fips && !/^\d{5}$/.test(fips))
      return res.status(400).json({ error: "fips must be a 5-digit FIPS code" });

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let query = supabase
      .from("grid_county_data")
      .select("id,fips_code,county_name,state,population,median_income,labor_force,unemployment_rate,avg_electricity_rate,water_stress_score,fiber_availability,hazard_risk_score,dc_tax_incentives,created_at", { count: "exact" });

    if (fips) query = query.eq("fips_code", fips);
    if (state) query = query.eq("state", state.toUpperCase());
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.ilike("county_name", `%${safe}%`);
    }

    query = query
      .order("state", { ascending: true })
      .order("county_name", { ascending: true })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";
import { InstallersQuery, validate } from "./_validate.js";

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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const params = validate(InstallersQuery, req.query, res);
  if (!params) return;

  try {
    const supabase = getSupabase();
    const { page: pageNum, limit: limitNum, state, name, min_installations, sort } = params;
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from("solar_installers")
      .select("*", { count: "estimated" });

    if (state) query = query.eq("state", state);
    if (name) query = query.ilike("name", `%${name}%`);
    if (min_installations) query = query.gte("installation_count", parseInt(min_installations));

    const validSorts = ["installation_count", "total_capacity_kw", "name", "last_seen"];
    const sortCol = validSorts.includes(sort) ? sort : "installation_count";

    const { data, error, count } = await query
      .order(sortCol, { ascending: sort === "name", nullsFirst: false })
      .range(offset, offset + limitNum - 1);

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

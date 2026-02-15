import { createClient } from "@supabase/supabase-js";
import { EquipmentQuery, validate } from "./_validate.js";

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

  const params = validate(EquipmentQuery, req.query, res);
  if (!params) return;

  try {
    const supabase = getSupabase();
    const { page: pageNum, limit: limitNum, sort, order, manufacturer, model, equipment_type, min_age_years, state, status, include_empty } = params;
    const offset = (pageNum - 1) * limitNum;

    // Use RPC function for proper JOIN + ORDER BY (avoids PostgREST timeout on join sorts)
    let minAgeDate = null;
    if (min_age_years) {
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - parseInt(min_age_years));
      minAgeDate = cutoffDate.toISOString().split("T")[0];
    }

    const { data: rpcResult, error } = await supabase.rpc("solar_equipment_search", {
      p_sort: sort || "manufacturer",
      p_order: order || "asc",
      p_limit: limitNum,
      p_offset: offset,
      p_manufacturer: manufacturer || null,
      p_model: model || null,
      p_equipment_type: equipment_type || null,
      p_status: status || null,
      p_state: state || null,
      p_min_age_date: minAgeDate,
      p_include_empty: include_empty === "true",
    });

    if (error) return res.status(500).json({ error: error.message });

    const total = rpcResult?.total || 0;
    return res.status(200).json({
      data: rpcResult?.data || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

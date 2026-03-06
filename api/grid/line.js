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
    const { id, hifld_id } = req.query;

    if (!id && !hifld_id) {
      return res
        .status(400)
        .json({ error: "Either id (UUID) or hifld_id (integer) is required" });
    }

    let query = supabase.from("grid_transmission_lines").select("*");

    if (id) {
      query = query.eq("id", id);
    } else {
      query = query.eq("hifld_id", parseInt(hifld_id));
    }

    const { data, error } = await query.single();

    if (error)
      return res.status(404).json({ error: "Transmission line not found" });

    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

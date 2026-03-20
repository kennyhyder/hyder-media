import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;
    const { id, hifld_id } = req.query;

    if (!id && !hifld_id) {
      return res
        .status(400)
        .json({ error: "Either id (UUID) or hifld_id (integer) is required" });
    }

    if (hifld_id && (isNaN(parseInt(hifld_id)) || parseInt(hifld_id) < 0))
      return res.status(400).json({ error: "hifld_id must be a positive integer" });
    if (id && (typeof id !== "string" || id.length > 100))
      return res.status(400).json({ error: "id must be a valid identifier" });

    let query = supabase.from("grid_transmission_lines").select("*");

    if (id) {
      query = query.eq("id", id);
    } else {
      query = query.eq("hifld_id", parseInt(hifld_id));
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Transmission line not found" });
      return res.status(500).json({ error: error.message });
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

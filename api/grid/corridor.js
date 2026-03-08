import { createClient } from "@supabase/supabase-js";

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
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "id parameter required" });
    if (typeof id !== "string" || id.length > 100)
      return res.status(400).json({ error: "id must be a valid identifier" });

    // Get corridor with all fields
    const { data: corridor, error } = await supabase
      .from("grid_corridors")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Corridor not found" });
      return res.status(500).json({ error: error.message });
    }

    // Get transmission lines that belong to this corridor (via transmission_line_ids array)
    let lines = [];
    if (
      corridor.transmission_line_ids &&
      corridor.transmission_line_ids.length > 0
    ) {
      const { data: lineData, error: lineErr } = await supabase
        .from("grid_transmission_lines")
        .select(
          "id,hifld_id,voltage_kv,capacity_mw,owner,sub_1,sub_2,naession,state,length_miles,geometry_wkt"
        )
        .in("hifld_id", corridor.transmission_line_ids)
        .order("voltage_kv", { ascending: false })
        .limit(50);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
      lines = lineData || [];
    }

    // Get nearby DC sites — use corridor states to filter, then sort by score
    let nearbySites = [];
    const states = corridor.states || [];
    if (states.length > 0) {
      const { data: sites, error: siteErr } = await supabase
        .from("grid_dc_sites")
        .select(
          "id,name,state,county,dc_score,site_type,substation_voltage_kv,available_capacity_mw,latitude,longitude"
        )
        .in("state", states)
        .not("dc_score", "is", null)
        .order("dc_score", { ascending: false })
        .limit(20);
      if (siteErr) return res.status(500).json({ error: siteErr.message });
      nearbySites = sites || [];
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      corridor,
      lines,
      nearbySites,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

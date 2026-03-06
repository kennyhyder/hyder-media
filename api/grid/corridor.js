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
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "id parameter required" });

    // Get corridor with all fields
    const { data: corridor, error } = await supabase
      .from("grid_corridors")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: "Corridor not found" });

    // Get transmission lines that belong to this corridor (via transmission_line_ids array)
    let lines = [];
    if (
      corridor.transmission_line_ids &&
      corridor.transmission_line_ids.length > 0
    ) {
      const { data: lineData } = await supabase
        .from("grid_transmission_lines")
        .select(
          "id,hifld_id,voltage_kv,capacity_mw,owner,sub_1,sub_2,naession,state,length_miles"
        )
        .in("hifld_id", corridor.transmission_line_ids)
        .order("voltage_kv", { ascending: false })
        .limit(50);
      lines = lineData || [];
    }

    // Get nearby DC sites — use corridor states to filter, then sort by score
    let nearbySites = [];
    const states = corridor.states || [];
    if (states.length > 0) {
      const { data: sites } = await supabase
        .from("grid_dc_sites")
        .select(
          "id,name,state,county,dc_score,site_type,substation_voltage_kv,available_capacity_mw,latitude,longitude"
        )
        .in("state", states)
        .not("dc_score", "is", null)
        .order("dc_score", { ascending: false })
        .limit(20);
      nearbySites = sites || [];
    }

    return res.status(200).json({
      corridor,
      lines,
      nearbySites,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

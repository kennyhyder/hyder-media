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

    // Get brownfield with all fields
    const { data: brownfield, error } = await supabase
      .from("grid_brownfield_sites")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Brownfield not found" });
      return res.status(500).json({ error: error.message });
    }

    // Get matched DC site if one exists (via brownfield_id FK)
    let dcSite = null;
    const { data: dcSites, error: dcErr } = await supabase
      .from("grid_dc_sites")
      .select("*")
      .eq("brownfield_id", id)
      .limit(1);
    if (dcErr) return res.status(500).json({ error: dcErr.message });
    if (dcSites && dcSites.length > 0) {
      dcSite = dcSites[0];
    }

    // Get county data if we have coordinates
    let county = null;
    if (dcSite && dcSite.fips_code) {
      const { data: countyData, error: countyErr } = await supabase
        .from("grid_county_data")
        .select("*")
        .eq("fips_code", dcSite.fips_code)
        .single();
      if (countyErr && countyErr.code !== "PGRST116") {
        return res.status(500).json({ error: countyErr.message });
      }
      county = countyData;
    }

    // Get nearby transmission lines (within ~25km)
    let nearbyLines = [];
    if (brownfield.latitude && brownfield.longitude) {
      const latDelta = 25 / 69.0;
      const lngDelta =
        25 / (69.0 * Math.cos((brownfield.latitude * Math.PI) / 180));
      const { data: lines, error: lineErr } = await supabase
        .from("grid_transmission_lines")
        .select(
          "id,hifld_id,voltage_kv,capacity_mw,owner,sub_1,sub_2,naession,state,geometry_wkt"
        )
        .gte("latitude", brownfield.latitude - latDelta)
        .lte("latitude", brownfield.latitude + latDelta)
        .gte("longitude", brownfield.longitude - lngDelta)
        .lte("longitude", brownfield.longitude + lngDelta)
        .order("voltage_kv", { ascending: false })
        .limit(20);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
      nearbyLines = lines || [];
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      brownfield,
      dcSite,
      county,
      nearbyLines,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

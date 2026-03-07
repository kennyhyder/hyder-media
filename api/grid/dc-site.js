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

    // Get site with all fields
    const { data: site, error } = await supabase
      .from("grid_dc_sites")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: "Site not found" });

    // Get county data if fips_code exists
    let countyData = null;
    if (site.fips_code) {
      const { data: county } = await supabase
        .from("grid_county_data")
        .select("*")
        .eq("fips_code", site.fips_code)
        .single();
      countyData = county;
    }

    // Get nearby transmission lines (within ~25km of site)
    let nearbyLines = [];
    if (site.latitude && site.longitude) {
      const latDelta = 25 / 69.0;
      const lngDelta = 25 / (69.0 * Math.cos((site.latitude * Math.PI) / 180));
      const { data: lines } = await supabase
        .from("grid_transmission_lines")
        .select("id,hifld_id,voltage_kv,capacity_mw,owner,sub_1,sub_2,naession,geometry_wkt")
        .gte("latitude", site.latitude - latDelta)
        .lte("latitude", site.latitude + latDelta)
        .gte("longitude", site.longitude - lngDelta)
        .lte("longitude", site.longitude + lngDelta)
        .order("voltage_kv", { ascending: false })
        .limit(20);
      nearbyLines = lines || [];
    }

    // Get brownfield details if applicable
    let brownfield = null;
    if (site.brownfield_id) {
      const { data: bf } = await supabase
        .from("grid_brownfield_sites")
        .select("*")
        .eq("id", site.brownfield_id)
        .single();
      brownfield = bf;
    }

    // Get nearby IXPs and DCs with contact info (within ~50km)
    let nearbyFacilities = [];
    if (site.latitude && site.longitude) {
      const latDelta = 50 / 69.0;
      const lngDelta = 50 / (69.0 * Math.cos((site.latitude * Math.PI) / 180));

      const { data: ixps } = await supabase
        .from("grid_ixp_facilities")
        .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
        .gte("latitude", site.latitude - latDelta)
        .lte("latitude", site.latitude + latDelta)
        .gte("longitude", site.longitude - lngDelta)
        .lte("longitude", site.longitude + lngDelta)
        .limit(20);

      const { data: dcs } = await supabase
        .from("grid_datacenters")
        .select("id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
        .gte("latitude", site.latitude - latDelta)
        .lte("latitude", site.latitude + latDelta)
        .gte("longitude", site.longitude - lngDelta)
        .lte("longitude", site.longitude + lngDelta)
        .limit(20);

      nearbyFacilities = [
        ...(ixps || []).map(f => ({ ...f, facility_type: "ixp" })),
        ...(dcs || []).map(f => ({ ...f, facility_type: "datacenter" })),
      ];
    }

    return res.status(200).json({
      site,
      county: countyData,
      nearbyLines,
      brownfield,
      nearbyFacilities,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess, demoLimitsPayload } from "./_demo.js";

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
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "id parameter required" });
    if (typeof id !== "string" || id.length > 100)
      return res.status(400).json({ error: "id must be a valid identifier" });

    // Get site with all fields
    const { data: site, error } = await supabase
      .from("grid_dc_sites")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Site not found" });
      return res.status(500).json({ error: error.message });
    }

    // Get county data if fips_code exists
    let countyData = null;
    if (site.fips_code) {
      const { data: county, error: countyErr } = await supabase
        .from("grid_county_data")
        .select("*")
        .eq("fips_code", site.fips_code)
        .single();
      if (countyErr && countyErr.code !== "PGRST116") {
        return res.status(500).json({ error: countyErr.message });
      }
      countyData = county;
    }

    // Get nearby transmission lines via nearby substations (lines lack lat/lng columns)
    let nearbyLines = [];
    if (site.latitude && site.longitude) {
      const latDeltaLines = 50 / 69.0;
      const lngDeltaLines = 50 / (69.0 * Math.cos((site.latitude * Math.PI) / 180));

      const { data: nearbySubs } = await supabase
        .from("grid_substations")
        .select("name")
        .gte("latitude", site.latitude - latDeltaLines)
        .lte("latitude", site.latitude + latDeltaLines)
        .gte("longitude", site.longitude - lngDeltaLines)
        .lte("longitude", site.longitude + lngDeltaLines)
        .limit(50);

      if (nearbySubs && nearbySubs.length > 0) {
        const subNames = nearbySubs.map(s => s.name).filter(Boolean);
        if (subNames.length > 0) {
          const { data: lines1 } = await supabase
            .from("grid_transmission_lines")
            .select("id,hifld_id,voltage_kv,capacity_mw,estimated_capacity_mva,capacity_band,owner,sub_1,sub_2,naession,geometry_wkt,state")
            .not("geometry_wkt", "is", null)
            .in("sub_1", subNames.slice(0, 30))
            .order("voltage_kv", { ascending: false })
            .limit(20);

          const { data: lines2 } = await supabase
            .from("grid_transmission_lines")
            .select("id,hifld_id,voltage_kv,capacity_mw,estimated_capacity_mva,capacity_band,owner,sub_1,sub_2,naession,geometry_wkt,state")
            .not("geometry_wkt", "is", null)
            .in("sub_2", subNames.slice(0, 30))
            .order("voltage_kv", { ascending: false })
            .limit(20);

          const lineMap = new Map();
          for (const l of [...(lines1 || []), ...(lines2 || [])]) {
            lineMap.set(l.id, l);
          }
          nearbyLines = [...lineMap.values()]
            .sort((a, b) => (b.voltage_kv || 0) - (a.voltage_kv || 0))
            .slice(0, 30);
        }
      }

      // Fallback: if no lines found via substations, get top lines in state
      if (nearbyLines.length === 0 && site.state) {
        const { data: fallbackLines } = await supabase
          .from("grid_transmission_lines")
          .select("id,hifld_id,voltage_kv,capacity_mw,estimated_capacity_mva,capacity_band,owner,sub_1,sub_2,naession,geometry_wkt,state")
          .not("geometry_wkt", "is", null)
          .eq("state", site.state)
          .order("voltage_kv", { ascending: false })
          .limit(10);
        if (fallbackLines) nearbyLines = fallbackLines;
      }
    } else if (site.state) {
      // No coordinates — fall back to state query
      const { data: lines } = await supabase
        .from("grid_transmission_lines")
        .select("id,hifld_id,voltage_kv,capacity_mw,estimated_capacity_mva,capacity_band,owner,sub_1,sub_2,naession,geometry_wkt,state")
        .not("geometry_wkt", "is", null)
        .eq("state", site.state)
        .order("voltage_kv", { ascending: false })
        .limit(10);
      if (lines) nearbyLines = lines;
    }

    // Get nearby fiber routes (using centroid_lat/centroid_lng bounding box)
    let nearbyFiber = [];
    if (site.latitude && site.longitude) {
      const latDeltaFiber = 50 / 69.0;
      const lngDeltaFiber = 50 / (69.0 * Math.cos((site.latitude * Math.PI) / 180));

      const { data: fiber, error: fiberErr } = await supabase
        .from("grid_fiber_routes")
        .select("id,name,operator,fiber_type,location_type,geometry_json,state")
        .not("geometry_json", "is", null)
        .gte("centroid_lat", site.latitude - latDeltaFiber)
        .lte("centroid_lat", site.latitude + latDeltaFiber)
        .gte("centroid_lng", site.longitude - lngDeltaFiber)
        .lte("centroid_lng", site.longitude + lngDeltaFiber)
        .limit(100);
      if (!fiberErr && fiber) nearbyFiber = fiber;
    }

    // Get brownfield details if applicable
    let brownfield = null;
    if (site.brownfield_id) {
      const { data: bf, error: bfErr } = await supabase
        .from("grid_brownfield_sites")
        .select("*")
        .eq("id", site.brownfield_id)
        .single();
      if (bfErr && bfErr.code !== "PGRST116") {
        return res.status(500).json({ error: bfErr.message });
      }
      brownfield = bf;
    }

    // Get nearby IXPs and DCs with contact info — expand radius until results found
    let nearbyFacilities = [];
    if (site.latitude && site.longitude) {
      const radii = [50, 100, 200]; // miles
      for (const radius of radii) {
        const latDelta = radius / 69.0;
        const lngDelta = radius / (69.0 * Math.cos((site.latitude * Math.PI) / 180));

        const { data: ixps, error: ixpErr } = await supabase
          .from("grid_ixp_facilities")
          .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
          .gte("latitude", site.latitude - latDelta)
          .lte("latitude", site.latitude + latDelta)
          .gte("longitude", site.longitude - lngDelta)
          .lte("longitude", site.longitude + lngDelta)
          .limit(20);
        if (ixpErr) return res.status(500).json({ error: ixpErr.message });

        const { data: dcs, error: dcErr } = await supabase
          .from("grid_datacenters")
          .select("id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
          .gte("latitude", site.latitude - latDelta)
          .lte("latitude", site.latitude + latDelta)
          .gte("longitude", site.longitude - lngDelta)
          .lte("longitude", site.longitude + lngDelta)
          .limit(20);
        if (dcErr) return res.status(500).json({ error: dcErr.message });

        nearbyFacilities = [
          ...(ixps || []).map(f => ({ ...f, facility_type: "ixp" })),
          ...(dcs || []).map(f => ({ ...f, facility_type: "datacenter" })),
        ];
        if (nearbyFacilities.length > 0) break;
      }
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      site,
      county: countyData,
      nearbyLines,
      nearbyFiber,
      brownfield,
      nearbyFacilities,
      demo_limits: demoLimitsPayload(access),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

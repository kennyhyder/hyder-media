import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess, demoLimitsPayload } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, handleError, internalError } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;
    const access = result.access;

    const supabase = getSupabase();
    const id = searchParams.get("id");

    if (!id) return handleError("id parameter required", 400);
    if (typeof id !== "string" || id.length > 100)
      return handleError("id must be a valid identifier", 400);

    // Get site with all fields
    const { data: site, error } = await supabase
      .from("grid_dc_sites")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return handleError("Site not found", 404);
      console.error("Grid dc-site query error:", error.message);
      return internalError();
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
        console.error("Grid dc-site county query error:", countyErr.message);
        return internalError();
      }
      countyData = county;
    }

    // Get nearby transmission lines via nearby substations (lines lack lat/lng columns)
    let nearbyLines: Array<Record<string, unknown> & { id: string; voltage_kv?: number }> = [];
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
        const subNames = nearbySubs.map((s) => s.name).filter(Boolean);
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

          const lineMap = new Map<string, Record<string, unknown> & { id: string; voltage_kv?: number }>();
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
    let nearbyFiber: unknown[] = [];
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
        console.error("Grid dc-site brownfield query error:", bfErr.message);
        return internalError();
      }
      brownfield = bf;
    }

    // Get nearby IXPs and DCs with contact info — expand radius until results found
    let nearbyFacilities: unknown[] = [];
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
        if (ixpErr) { console.error("Grid dc-site ixp query error:", ixpErr.message); return internalError(); }

        const { data: dcs, error: dcErr } = await supabase
          .from("grid_datacenters")
          .select("id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
          .gte("latitude", site.latitude - latDelta)
          .lte("latitude", site.latitude + latDelta)
          .gte("longitude", site.longitude - lngDelta)
          .lte("longitude", site.longitude + lngDelta)
          .limit(20);
        if (dcErr) { console.error("Grid dc-site datacenters query error:", dcErr.message); return internalError(); }

        nearbyFacilities = [
          ...(ixps || []).map((f) => ({ ...f, facility_type: "ixp" })),
          ...(dcs || []).map((f) => ({ ...f, facility_type: "datacenter" })),
        ];
        if (nearbyFacilities.length > 0) break;
      }
    }

    return NextResponse.json(
      {
        site,
        county: countyData,
        nearbyLines,
        nearbyFiber,
        brownfield,
        nearbyFacilities,
        demo_limits: demoLimitsPayload(access),
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid dc-site error:", err);
    return internalError();
  }
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
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

    const supabase = getSupabase();
    const id = searchParams.get("id");

    if (!id) return handleError("id parameter required", 400);
    if (typeof id !== "string" || id.length > 100)
      return handleError("id must be a valid identifier", 400);

    // Get brownfield with all fields
    const { data: brownfield, error } = await supabase
      .from("grid_brownfield_sites")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return handleError("Brownfield not found", 404);
      console.error("Grid brownfield query error:", error.message);
      return internalError();
    }

    // Get matched DC site if one exists (via brownfield_id FK)
    let dcSite = null;
    const { data: dcSites, error: dcErr } = await supabase
      .from("grid_dc_sites")
      .select("*")
      .eq("brownfield_id", id)
      .limit(1);
    if (dcErr) { console.error("Grid brownfield dc-sites query error:", dcErr.message); return internalError(); }
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
        console.error("Grid brownfield county query error:", countyErr.message);
        return internalError();
      }
      county = countyData;
    }

    // Get nearby transmission lines by state (lines lack lat/lng columns)
    let nearbyLines: unknown[] = [];
    if (brownfield.state) {
      const { data: lines, error: lineErr } = await supabase
        .from("grid_transmission_lines")
        .select(
          "id,hifld_id,voltage_kv,capacity_mw,owner,sub_1,sub_2,naession,state,geometry_wkt"
        )
        .eq("state", brownfield.state)
        .order("voltage_kv", { ascending: false })
        .limit(20);
      if (!lineErr) nearbyLines = lines || [];
    }

    // Get nearby IXPs and DCs — expand radius until results found
    let nearbyFacilities: unknown[] = [];
    if (brownfield.latitude && brownfield.longitude) {
      const radii = [50, 100, 200];
      for (const radius of radii) {
        const latDelta = radius / 69.0;
        const lngDelta = radius / (69.0 * Math.cos((brownfield.latitude * Math.PI) / 180));

        const { data: ixps, error: ixpErr } = await supabase
          .from("grid_ixp_facilities")
          .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
          .gte("latitude", brownfield.latitude - latDelta)
          .lte("latitude", brownfield.latitude + latDelta)
          .gte("longitude", brownfield.longitude - lngDelta)
          .lte("longitude", brownfield.longitude + lngDelta)
          .limit(20);
        if (ixpErr) { console.error("Grid brownfield ixp query error:", ixpErr.message); return internalError(); }

        const { data: dcs, error: dcErr2 } = await supabase
          .from("grid_datacenters")
          .select("id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,website,sales_email,sales_phone,tech_email,tech_phone,address,zipcode")
          .gte("latitude", brownfield.latitude - latDelta)
          .lte("latitude", brownfield.latitude + latDelta)
          .gte("longitude", brownfield.longitude - lngDelta)
          .lte("longitude", brownfield.longitude + lngDelta)
          .limit(20);
        if (dcErr2) { console.error("Grid brownfield datacenters query error:", dcErr2.message); return internalError(); }

        nearbyFacilities = [
          ...(ixps || []).map((f) => ({ ...f, facility_type: "ixp" })),
          ...(dcs || []).map((f) => ({ ...f, facility_type: "datacenter" })),
        ];
        if (nearbyFacilities.length > 0) break;
      }
    }

    return NextResponse.json(
      {
        brownfield,
        dcSite,
        county,
        nearbyLines,
        nearbyFacilities,
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid brownfield error:", err);
    return internalError();
  }
}

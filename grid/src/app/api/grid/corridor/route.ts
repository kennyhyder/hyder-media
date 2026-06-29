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

    // Get corridor with all fields
    const { data: corridor, error } = await supabase
      .from("grid_corridors")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return handleError("Corridor not found", 404);
      console.error("Grid corridor query error:", error.message);
      return internalError();
    }

    // Get transmission lines that belong to this corridor (via transmission_line_ids array)
    let lines: unknown[] = [];
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
      if (lineErr) { console.error("Grid corridor lines query error:", lineErr.message); return internalError(); }
      lines = lineData || [];
    }

    // Get nearby DC sites — use corridor states to filter, then sort by score
    let nearbySites: unknown[] = [];
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
      if (siteErr) { console.error("Grid corridor sites query error:", siteErr.message); return internalError(); }
      nearbySites = sites || [];
    }

    return NextResponse.json(
      {
        corridor,
        lines,
        nearbySites,
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid corridor error:", err);
    return internalError();
  }
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess, demoLimitsPayload } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, internalError } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

interface DcRow {
  id: string;
  source_record_id: string | null;
  name: string | null;
  operator: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  year_built: number | null;
  created_at: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;
    const access = result.access;

    const supabase = getSupabase();

    // Fetch all hyperscale datacenters
    const { data: dcs, error } = await supabase
      .from("grid_datacenters")
      .select("id,source_record_id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,created_at")
      .eq("dc_type", "hyperscale")
      .order("capacity_mw", { ascending: false, nullsFirst: false });

    if (error) { console.error("Grid hyperscale query error:", error.message); return internalError(); }

    // Infer status from source_record_id prefix and name patterns
    const records = ((dcs || []) as DcRow[]).map((dc) => {
      let status = "announced";
      const srcId = dc.source_record_id || "";

      if (srcId.startsWith("epoch_ai_")) {
        const opNames = [
          "amazon us east", "microsoft quincy", "google the dalles",
          "meta prineville", "google council bluffs", "meta new albany",
          "microsoft san antonio", "microsoft des moines", "google midlothian",
          "amazon us west", "microsoft cheyenne", "xai memphis",
          "oracle nashville", "apple mesa",
        ];
        const constructNames = [
          "google papillion", "meta dekalb", "meta eagle mountain", "coreweave plano",
        ];
        const plannedNames = [
          "microsoft stargate",
        ];
        const nameLower = (dc.name || "").toLowerCase();
        if (opNames.some((n) => nameLower.includes(n))) status = "operational";
        else if (constructNames.some((n) => nameLower.includes(n))) status = "under_construction";
        else if (plannedNames.some((n) => nameLower.includes(n))) status = "planned";
      } else if (srcId.startsWith("epoch_")) {
        const yearNow = new Date().getFullYear();
        if (dc.year_built && dc.year_built <= yearNow - 1) {
          status = "operational";
        } else if (dc.year_built && dc.year_built <= yearNow) {
          status = "under_construction";
        } else {
          status = "announced";
        }
      }

      return { ...dc, status };
    });

    // Compute aggregate stats
    const totalProjects = records.length;
    const totalCapacityMw = records.reduce((sum, dc) => sum + (Number(dc.capacity_mw) || 0), 0);
    const operational = records.filter((dc) => dc.status === "operational").length;
    const underConstruction = records.filter((dc) => dc.status === "under_construction").length;
    const announced = records.filter((dc) => dc.status === "announced" || dc.status === "planned").length;

    // Group by operator
    const operatorMap: Record<string, { count: number; capacity_mw: number }> = {};
    for (const dc of records) {
      const op = dc.operator || "Unknown";
      if (!operatorMap[op]) operatorMap[op] = { count: 0, capacity_mw: 0 };
      operatorMap[op].count++;
      operatorMap[op].capacity_mw += Number(dc.capacity_mw) || 0;
    }
    const operatorBreakdown = Object.entries(operatorMap)
      .map(([operator, stats]) => ({ operator, ...stats }))
      .sort((a, b) => b.capacity_mw - a.capacity_mw);

    // Group by state
    const stateMap: Record<string, { count: number; capacity_mw: number }> = {};
    for (const dc of records) {
      const st = dc.state || "Unknown";
      if (!stateMap[st]) stateMap[st] = { count: 0, capacity_mw: 0 };
      stateMap[st].count++;
      stateMap[st].capacity_mw += Number(dc.capacity_mw) || 0;
    }
    const stateBreakdown = Object.entries(stateMap)
      .map(([state, stats]) => ({ state, ...stats }))
      .sort((a, b) => b.capacity_mw - a.capacity_mw);

    // Status breakdown
    const statusBreakdown = {
      operational,
      under_construction: underConstruction,
      announced,
    };

    return NextResponse.json(
      {
        data: records,
        stats: {
          total_projects: totalProjects,
          total_capacity_mw: Math.round(totalCapacityMw * 10) / 10,
          total_capacity_gw: Math.round(totalCapacityMw / 100) / 10,
          status: statusBreakdown,
        },
        operatorBreakdown,
        stateBreakdown,
        demo_limits: demoLimitsPayload(access),
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid hyperscale error:", err);
    return internalError();
  }
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, handleError, internalError, sanitizeSearch } from "@/lib/grid-api/utils";

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

    const state = searchParams.get("state");
    const min_voltage = searchParams.get("min_voltage");
    const search = searchParams.get("search");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);
    if (min_voltage && (isNaN(parseFloat(min_voltage)) || parseFloat(min_voltage) < 0))
      return handleError("min_voltage must be a non-negative number", 400);

    const limitNum = Math.min(Math.max(parseInt(limit || "") || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset || "") || 0, 0);

    let query = supabase
      .from("grid_substations")
      .select("id,name,state,county,latitude,longitude,max_voltage_kv,hifld_id,created_at", { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (min_voltage)
      query = query.gte("max_voltage_kv", parseFloat(min_voltage));
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.ilike("name", `%${safe}%`);
    }

    query = query
      .order("max_voltage_kv", { ascending: false, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) { console.error("Grid substations query error:", error.message); return internalError(); }

    return NextResponse.json(
      {
        data: data || [],
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid substations error:", err);
    return internalError();
  }
}

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
    const max_voltage = searchParams.get("max_voltage");
    const min_capacity = searchParams.get("min_capacity");
    const max_capacity = searchParams.get("max_capacity");
    const upgrade_only = searchParams.get("upgrade_only");
    const owner = searchParams.get("owner");
    const search = searchParams.get("search");
    const sort = searchParams.get("sort") || "";
    const order = searchParams.get("order");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const with_geometry = searchParams.get("with_geometry");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);
    if (min_voltage && (isNaN(parseFloat(min_voltage)) || parseFloat(min_voltage) < 0))
      return handleError("min_voltage must be a non-negative number", 400);
    if (max_voltage && (isNaN(parseFloat(max_voltage)) || parseFloat(max_voltage) < 0))
      return handleError("max_voltage must be a non-negative number", 400);
    if (min_capacity && (isNaN(parseFloat(min_capacity)) || parseFloat(min_capacity) < 0))
      return handleError("min_capacity must be a non-negative number", 400);
    if (max_capacity && (isNaN(parseFloat(max_capacity)) || parseFloat(max_capacity) < 0))
      return handleError("max_capacity must be a non-negative number", 400);

    const limitNum = Math.min(Math.max(parseInt(limit || "") || 50, 1), with_geometry === "true" ? 2500 : 200);
    const offsetNum = Math.max(parseInt(offset || "") || 0, 0);

    // Include geometry_wkt only when explicitly requested (for map rendering)
    const columns: string = with_geometry === "true"
      ? "id,hifld_id,geometry_wkt,voltage_kv,capacity_mw,estimated_capacity_mva,capacity_band,upgrade_candidate,owner,state,sub_1,sub_2,naession"
      : "id,hifld_id,source_record_id,voltage_kv,volt_class,owner,status,line_type,sub_1,sub_2,naession,static_rating_amps,capacity_mw,estimated_capacity_mva,capacity_band,upgrade_candidate,ercot_shadow_price,ercot_binding_count,ercot_mw_limit,state,county,length_miles,data_source_id,created_at,updated_at";

    let query = supabase
      .from("grid_transmission_lines")
      .select(columns, { count: "exact" });

    // Apply filters
    if (state) query = query.eq("state", state.toUpperCase());
    if (min_voltage) query = query.gte("voltage_kv", parseFloat(min_voltage));
    if (max_voltage) query = query.lte("voltage_kv", parseFloat(max_voltage));
    if (min_capacity)
      query = query.gte("capacity_mw", parseFloat(min_capacity));
    if (max_capacity)
      query = query.lte("capacity_mw", parseFloat(max_capacity));
    if (upgrade_only === "true") query = query.eq("upgrade_candidate", true);
    if (owner) {
      const safeOwner = sanitizeSearch(owner);
      query = query.ilike("owner", `%${safeOwner}%`);
    }
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `naession.ilike.%${safe}%,sub_1.ilike.%${safe}%,sub_2.ilike.%${safe}%`
      );
    }

    // Sort
    const validSorts = [
      "voltage_kv",
      "capacity_mw",
      "length_miles",
      "state",
      "owner",
      "created_at",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "voltage_kv";
    const ascending = order === "asc";

    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) { console.error("Grid lines query error:", error.message); return internalError(); }

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
    console.error("Grid lines error:", err);
    return internalError();
  }
}

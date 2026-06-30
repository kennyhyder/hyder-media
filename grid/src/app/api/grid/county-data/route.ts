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

    const fips = searchParams.get("fips");
    const state = searchParams.get("state");
    const search = searchParams.get("search");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);
    if (fips && !/^\d{5}$/.test(fips))
      return handleError("fips must be a 5-digit FIPS code", 400);

    const limitNum = Math.min(Math.max(parseInt(limit || "") || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset || "") || 0, 0);

    let query = supabase
      .from("grid_county_data")
      .select("id,fips_code,county_name,state,population,median_income,labor_force,unemployment_rate,avg_electricity_rate,water_stress_score,fiber_availability,hazard_risk_score,dc_tax_incentives,land_price_per_acre,land_price_source,land_price_year,created_at", { count: "exact" });

    if (fips) query = query.eq("fips_code", fips);
    if (state) query = query.eq("state", state.toUpperCase());
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.ilike("county_name", `%${safe}%`);
    }

    query = query
      .order("state", { ascending: true })
      .order("county_name", { ascending: true })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) { console.error("Grid county-data query error:", error.message); return internalError(); }

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
    console.error("Grid county-data error:", err);
    return internalError();
  }
}

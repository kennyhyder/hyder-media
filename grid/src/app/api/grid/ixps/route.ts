import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, handleError, sanitizeSearch, validatePagination } from "@/lib/grid-api/utils";

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
    const search = searchParams.get("search");
    const sort = searchParams.get("sort") || "";
    const order = searchParams.get("order");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(searchParams);

    let query = supabase
      .from("grid_ixp_facilities")
      .select("id,name,org_name,city,state,latitude,longitude,ix_count,network_count,website,created_at", { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,city.ilike.%${safe}%`
      );
    }

    const validSorts = ["network_count", "ix_count", "state", "city", "name"];
    const sortCol = validSorts.includes(sort) ? sort : "network_count";
    const ascending = order === "asc";

    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) return handleError(error);

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
    return handleError(err);
  }
}

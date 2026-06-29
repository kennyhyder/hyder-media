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
    const site_type = searchParams.get("site_type");
    const cleanup_status = searchParams.get("cleanup_status");
    const has_substation = searchParams.get("has_substation");
    const search = searchParams.get("search");
    const sort = searchParams.get("sort") || "";
    const order = searchParams.get("order");
    const near_lat = searchParams.get("near_lat");
    const near_lng = searchParams.get("near_lng");
    const radius_miles = searchParams.get("radius_miles");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(searchParams);

    let query = supabase
      .from("grid_brownfield_sites")
      .select("id,name,site_type,state,city,county,latitude,longitude,acreage,existing_capacity_mw,former_use,cleanup_status,retirement_date,nearest_substation_id,nearest_substation_distance_km,created_at", { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (cleanup_status) query = query.eq("cleanup_status", cleanup_status);
    if (has_substation === "true")
      query = query.not("nearest_substation_id", "is", null);
    if (has_substation === "false")
      query = query.is("nearest_substation_id", null);
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,former_use.ilike.%${safe}%,city.ilike.%${safe}%`
      );
    }

    // Geospatial bounding-box filter
    if (near_lat && near_lng) {
      const lat = parseFloat(near_lat);
      const lng = parseFloat(near_lng);
      const radius = parseFloat(radius_miles || "") || 50;
      if (isNaN(lat) || isNaN(lng)) return handleError("Invalid near_lat/near_lng", 400);
      const latDelta = radius / 69.0;
      const lngDelta = radius / (69.0 * Math.cos((lat * Math.PI) / 180));
      query = query
        .gte("latitude", lat - latDelta)
        .lte("latitude", lat + latDelta)
        .gte("longitude", lng - lngDelta)
        .lte("longitude", lng + lngDelta);
    }

    const validSorts = [
      "existing_capacity_mw", "acreage", "nearest_substation_distance_km",
      "state", "retirement_date", "created_at",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "existing_capacity_mw";
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

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess, demoLimitsPayload } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, handleError, internalError, sanitizeSearch } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;
    const access = result.access;

    const supabase = getSupabase();

    const state = searchParams.get("state");
    const site_type = searchParams.get("site_type");
    const min_score = searchParams.get("min_score");
    const max_score = searchParams.get("max_score");
    const min_capacity = searchParams.get("min_capacity");
    const iso_region = searchParams.get("iso_region");
    const flood = searchParams.get("flood");
    const search = searchParams.get("search");
    const near_lat = searchParams.get("near_lat");
    const near_lng = searchParams.get("near_lng");
    const radius_miles = searchParams.get("radius_miles");
    const sort = searchParams.get("sort") || "";
    const order = searchParams.get("order");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    // Input validation
    // C2: anonymous (no-token) callers get a tighter per-page ceiling than
    // authenticated full-access callers, to blunt offset-paginated scraping.
    const isAnon = access.mode === "full" && !searchParams.get("demo_token") && !request.headers.get("authorization");
    const maxLimit = access.mode === "demo" ? 10 : (isAnon ? 100 : 200);
    const limitNum = Math.min(Math.max(parseInt(limit || "") || 50, 1), maxLimit);
    const offsetNum = Math.max(parseInt(offset || "") || 0, 0);

    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);
    if (site_type && !["substation", "brownfield", "greenfield", "industrial", "federal_excess", "mine", "military_brac", "shovel_ready"].includes(site_type))
      return handleError("Invalid site_type", 400);
    if (min_score && (isNaN(parseFloat(min_score)) || parseFloat(min_score) < 0 || parseFloat(min_score) > 100))
      return handleError("min_score must be a number between 0 and 100", 400);
    if (max_score && (isNaN(parseFloat(max_score)) || parseFloat(max_score) < 0 || parseFloat(max_score) > 100))
      return handleError("max_score must be a number between 0 and 100", 400);
    if (min_capacity && (isNaN(parseFloat(min_capacity)) || parseFloat(min_capacity) < 0))
      return handleError("min_capacity must be a non-negative number", 400);
    if (near_lat && (isNaN(parseFloat(near_lat)) || parseFloat(near_lat) < -90 || parseFloat(near_lat) > 90))
      return handleError("near_lat must be between -90 and 90", 400);
    if (near_lng && (isNaN(parseFloat(near_lng)) || parseFloat(near_lng) < -180 || parseFloat(near_lng) > 180))
      return handleError("near_lng must be between -180 and 180", 400);
    if (radius_miles && (isNaN(parseFloat(radius_miles)) || parseFloat(radius_miles) <= 0 || parseFloat(radius_miles) > 500))
      return handleError("radius_miles must be between 0 and 500", 400);

    const columns = [
      "id", "source_record_id", "name", "site_type", "state", "county",
      "fips_code", "latitude", "longitude",
      "nearest_substation_name", "nearest_substation_distance_km",
      "substation_voltage_kv", "available_capacity_mw",
      "nearest_ixp_name", "nearest_ixp_distance_km",
      "nearest_dc_name", "nearest_dc_distance_km",
      "brownfield_id", "former_use", "existing_capacity_mw",
      "dc_score", "score_power", "score_speed_to_power", "score_fiber",
      "score_water", "score_hazard", "score_labor", "score_existing_dc",
      "score_land", "score_tax", "score_climate",
      "score_energy_cost", "score_gas_pipeline", "score_buildability", "score_construction_cost",
      "iso_region", "acreage",
      "energy_price_mwh", "buildability_score", "construction_cost_index",
      "nearest_gas_pipeline_km", "nlcd_class", "fcc_fiber_pct",
      "flood_zone", "flood_zone_sfha"
    ].join(",");

    let query = supabase
      .from("grid_dc_sites")
      .select(columns, { count: "exact" });

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (min_score) query = query.gte("dc_score", parseFloat(min_score));
    if (max_score) query = query.lte("dc_score", parseFloat(max_score));
    if (min_capacity) query = query.gte("available_capacity_mw", parseFloat(min_capacity));
    if (iso_region) query = query.eq("iso_region", iso_region);
    if (flood === "no_sfha") query = query.or("flood_zone_sfha.is.null,flood_zone_sfha.eq.false");
    if (flood === "sfha") query = query.eq("flood_zone_sfha", true);
    if (flood === "X") query = query.eq("flood_zone", "X");
    if (search) {
      const safe = sanitizeSearch(search);
      query = query.or(
        `name.ilike.%${safe}%,county.ilike.%${safe}%,former_use.ilike.%${safe}%`
      );
    }

    // Geospatial bounding box filter
    const hasGeo = near_lat && near_lng;
    if (hasGeo) {
      const lat = parseFloat(near_lat!);
      const lng = parseFloat(near_lng!);
      const radius = parseFloat(radius_miles || "") || 50;
      const latDelta = radius / 69.0;
      const lngDelta = radius / (69.0 * Math.cos((lat * Math.PI) / 180));
      query = query
        .gte("latitude", lat - latDelta)
        .lte("latitude", lat + latDelta)
        .gte("longitude", lng - lngDelta)
        .lte("longitude", lng + lngDelta);
    }

    const validSorts = [
      "dc_score", "available_capacity_mw", "substation_voltage_kv",
      "nearest_ixp_distance_km", "nearest_dc_distance_km", "state", "name", "site_type",
      "energy_price_mwh", "buildability_score", "construction_cost_index",
      "nearest_gas_pipeline_km", "fcc_fiber_pct",
    ];
    const sortCol = validSorts.includes(sort) ? sort : "dc_score";
    const ascending = order === "asc";

    // When geospatial search is active, skip DB sort (JS will re-sort by distance)
    if (!hasGeo) {
      query = query.order(sortCol, { ascending, nullsFirst: false });
    }

    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) { console.error("DC sites query error:", error.message); return internalError(); }

    // Compute distance if geospatial search
    let results = (data || []) as unknown as Array<Record<string, unknown> & { latitude: number; longitude: number; distance_miles?: number }>;
    if (hasGeo) {
      const lat = parseFloat(near_lat!);
      const lng = parseFloat(near_lng!);
      results = results.map((site) => ({
        ...site,
        distance_miles: haversine(lat, lng, site.latitude, site.longitude),
      }));
      results.sort((a, b) => (a.distance_miles || 0) - (b.distance_miles || 0));
    }

    return NextResponse.json(
      {
        data: results,
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
        demo_limits: demoLimitsPayload(access),
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("DC sites error:", err);
    return internalError();
  }
}

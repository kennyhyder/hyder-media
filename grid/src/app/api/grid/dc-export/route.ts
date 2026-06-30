import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, CACHE_HEADER, cacheHeaders, handleError, internalError } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

function csvEscape(val: unknown): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    // Demo users cannot export data
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;
    const access = result.access;
    if (access.mode === "demo") {
      return NextResponse.json(
        { error: "Export is not available in demo mode", contact: "kenny@hyder.me" },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const supabase = getSupabase();

    const state = searchParams.get("state");
    const site_type = searchParams.get("site_type");
    const min_score = searchParams.get("min_score");
    const max_score = searchParams.get("max_score");
    const min_capacity = searchParams.get("min_capacity");
    const iso_region = searchParams.get("iso_region");
    const format = searchParams.get("format");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);
    if (site_type && !["substation", "brownfield", "greenfield"].includes(site_type))
      return handleError("site_type must be substation, brownfield, or greenfield", 400);
    if (min_score && (isNaN(parseFloat(min_score)) || parseFloat(min_score) < 0 || parseFloat(min_score) > 100))
      return handleError("min_score must be a number between 0 and 100", 400);
    if (max_score && (isNaN(parseFloat(max_score)) || parseFloat(max_score) < 0 || parseFloat(max_score) > 100))
      return handleError("max_score must be a number between 0 and 100", 400);
    if (min_capacity && (isNaN(parseFloat(min_capacity)) || parseFloat(min_capacity) < 0))
      return handleError("min_capacity must be a non-negative number", 400);

    const columns = [
      "name", "site_type", "state", "county", "fips_code",
      "latitude", "longitude",
      "nearest_substation_name", "nearest_substation_distance_km",
      "substation_voltage_kv", "available_capacity_mw",
      "nearest_ixp_name", "nearest_ixp_distance_km",
      "nearest_dc_name", "nearest_dc_distance_km",
      "former_use", "existing_capacity_mw", "acreage",
      "dc_score", "score_power", "score_speed_to_power", "score_fiber",
      "score_water", "score_hazard", "score_labor", "score_existing_dc",
      "score_land", "score_tax", "score_climate",
      "iso_region"
    ].join(",");

    let query = supabase
      .from("grid_dc_sites")
      .select(columns);

    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (min_score) query = query.gte("dc_score", parseFloat(min_score));
    if (max_score) query = query.lte("dc_score", parseFloat(max_score));
    if (min_capacity) query = query.gte("available_capacity_mw", parseFloat(min_capacity));
    if (iso_region) query = query.eq("iso_region", iso_region);

    // C2: anonymous (no-token) callers get a much lower export ceiling to blunt
    // bulk exfiltration. Authenticated full-access callers keep the 10k cap.
    const isAnon = !searchParams.get("demo_token") && !request.headers.get("authorization");
    const exportLimit = isAnon ? 1000 : 10000;
    query = query
      .order("dc_score", { ascending: false, nullsFirst: false })
      .limit(exportLimit);

    const { data, error } = await query;

    if (error) { console.error("DC export query error:", error.message); return internalError(); }

    const rows = (data || []) as unknown as Array<Record<string, unknown>>;

    if (format === "json") {
      return NextResponse.json(
        { data: rows, total: rows.length },
        { headers: cacheHeaders() }
      );
    }

    // CSV export
    const headers = [
      "Name", "Site Type", "State", "County", "FIPS",
      "Latitude", "Longitude",
      "Nearest Substation", "Substation Distance (km)",
      "Voltage (kV)", "Available Capacity (MW)",
      "Nearest IXP", "IXP Distance (km)",
      "Nearest DC", "DC Distance (km)",
      "Former Use", "Existing Capacity (MW)", "Acreage",
      "DC Score", "Power", "Speed to Power", "Fiber",
      "Water", "Hazard", "Labor", "Existing DC",
      "Land", "Tax", "Climate",
      "ISO Region"
    ];

    const csvRows = [headers.join(",")];
    for (const row of rows) {
      csvRows.push([
        csvEscape(row.name),
        row.site_type,
        row.state,
        csvEscape(row.county),
        row.fips_code,
        row.latitude,
        row.longitude,
        csvEscape(row.nearest_substation_name),
        row.nearest_substation_distance_km,
        row.substation_voltage_kv,
        row.available_capacity_mw,
        csvEscape(row.nearest_ixp_name),
        row.nearest_ixp_distance_km,
        csvEscape(row.nearest_dc_name),
        row.nearest_dc_distance_km,
        csvEscape(row.former_use),
        row.existing_capacity_mw,
        row.acreage,
        row.dc_score,
        row.score_power,
        row.score_speed_to_power,
        row.score_fiber,
        row.score_water,
        row.score_hazard,
        row.score_labor,
        row.score_existing_dc,
        row.score_land,
        row.score_tax,
        row.score_climate,
        row.iso_region,
      ].join(","));
    }

    return new NextResponse(csvRows.join("\n"), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="gridscout-dc-sites.csv"`,
        "Cache-Control": CACHE_HEADER,
      },
    });
  } catch (err) {
    console.error("DC export error:", err);
    return internalError();
  }
}

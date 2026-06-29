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
    const hifld_id = searchParams.get("hifld_id");

    if (!id && !hifld_id) {
      return handleError("Either id (UUID) or hifld_id (integer) is required", 400);
    }

    if (hifld_id && (isNaN(parseInt(hifld_id)) || parseInt(hifld_id) < 0))
      return handleError("hifld_id must be a positive integer", 400);
    if (id && (typeof id !== "string" || id.length > 100))
      return handleError("id must be a valid identifier", 400);

    let query = supabase.from("grid_transmission_lines").select("*");

    if (id) {
      query = query.eq("id", id);
    } else {
      query = query.eq("hifld_id", parseInt(hifld_id!));
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return handleError("Transmission line not found", 404);
      console.error("Grid line query error:", error.message);
      return internalError();
    }

    return NextResponse.json({ data }, { headers: cacheHeaders() });
  } catch (err) {
    console.error("Grid line error:", err);
    return internalError();
  }
}

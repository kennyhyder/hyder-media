import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { CORS_HEADERS } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token)
    return NextResponse.json(
      { valid: false, error: "Token required" },
      { status: 400, headers: CORS_HEADERS }
    );

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("grid_demo_tokens")
      .select("label, expires_at, is_active, lifetime_limit")
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ valid: false }, { status: 200, headers: CORS_HEADERS });
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return NextResponse.json(
        { valid: false, error: "Token expired" },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Check lifetime limit
    if (data.lifetime_limit) {
      const { count } = await supabase
        .from("grid_demo_usage")
        .select("id", { count: "exact", head: true })
        .eq("token", token);
      if ((count ?? 0) >= data.lifetime_limit) {
        return NextResponse.json(
          { valid: false, error: "Demo access expired (lifetime limit reached)" },
          { status: 200, headers: CORS_HEADERS }
        );
      }
    }

    return NextResponse.json(
      { valid: true, label: data.label },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("Grid demo-validate error:", err);
    return NextResponse.json(
      { valid: false, error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

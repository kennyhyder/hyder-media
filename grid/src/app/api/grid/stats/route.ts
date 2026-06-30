import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, internalError } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

/**
 * Paginated fetch: Supabase max_rows=1000, so we must paginate to get all rows.
 * Returns all rows matching the query.
 */
async function fetchAllRows<T extends Record<string, unknown>>(
  table: string,
  column: string
): Promise<T[]> {
  const supabase = getSupabase();
  const allRows: T[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(offset, offset + pageSize - 1)
      .order("id", { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return allRows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;

    const supabase = getSupabase();

    // Run count queries and paginated data fetches in parallel
    const [
      linesCount,
      upgradeCount,
      blmCount,
      corridorCount,
      substationCount,
      weccCount,
      stateRows,
      voltageRows,
      capacityRows,
      ownerRows,
    ] = await Promise.all([
      supabase
        .from("grid_transmission_lines")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("grid_transmission_lines")
        .select("id", { count: "exact", head: true })
        .eq("upgrade_candidate", true),
      supabase
        .from("grid_blm_row")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("grid_corridors")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("grid_substations")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("grid_wecc_paths")
        .select("id", { count: "exact", head: true }),
      fetchAllRows<{ state: string | null }>("grid_transmission_lines", "state"),
      fetchAllRows<{ voltage_kv: number | null }>("grid_transmission_lines", "voltage_kv"),
      fetchAllRows<{ capacity_mw: number | null }>("grid_transmission_lines", "capacity_mw"),
      fetchAllRows<{ owner: string | null }>("grid_transmission_lines", "owner"),
    ]);

    // Check for Supabase errors on count queries
    for (const r of [linesCount, upgradeCount, blmCount, corridorCount, substationCount, weccCount]) {
      if (r.error) { console.error("Grid stats count query error:", r.error.message); return internalError(); }
    }

    // Aggregate lines by state
    const stateMap: Record<string, number> = {};
    stateRows.forEach((row) => {
      if (row.state) stateMap[row.state] = (stateMap[row.state] || 0) + 1;
    });
    const lines_by_state = Object.entries(stateMap)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Aggregate voltage distribution into buckets
    const voltageBuckets: Record<string, number> = { "0-100": 0, "100-230": 0, "230-345": 0, "345-500": 0, "500+": 0 };
    voltageRows.forEach((row) => {
      const v = parseFloat(String(row.voltage_kv));
      if (v < 100) voltageBuckets["0-100"]++;
      else if (v < 230) voltageBuckets["100-230"]++;
      else if (v < 345) voltageBuckets["230-345"]++;
      else if (v < 500) voltageBuckets["345-500"]++;
      else voltageBuckets["500+"]++;
    });

    // Aggregate capacity distribution into buckets
    const capacityBuckets: Record<string, number> = { "0-100": 0, "100-500": 0, "500-1000": 0, "1000-2000": 0, "2000+": 0 };
    capacityRows.forEach((row) => {
      const c = parseFloat(String(row.capacity_mw));
      if (c < 100) capacityBuckets["0-100"]++;
      else if (c < 500) capacityBuckets["100-500"]++;
      else if (c < 1000) capacityBuckets["500-1000"]++;
      else if (c < 2000) capacityBuckets["1000-2000"]++;
      else capacityBuckets["2000+"]++;
    });

    // Aggregate top owners
    const ownerMap: Record<string, number> = {};
    ownerRows.forEach((row) => {
      if (row.owner) ownerMap[row.owner] = (ownerMap[row.owner] || 0) + 1;
    });
    const top_owners = Object.entries(ownerMap)
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return NextResponse.json(
      {
        total_lines: linesCount.count || 0,
        total_upgrade_candidates: upgradeCount.count || 0,
        total_blm_rows: blmCount.count || 0,
        total_corridors: corridorCount.count || 0,
        total_substations: substationCount.count || 0,
        total_wecc_paths: weccCount.count || 0,
        lines_by_state,
        voltage_distribution: voltageBuckets,
        capacity_distribution: capacityBuckets,
        top_owners,
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    console.error("Grid stats error:", err);
    return internalError();
  }
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, handleError, validatePagination } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

interface CorridorGroup {
  id: string;
  corridor_type: string | null;
  corridor_id: string | null;
  name: string | null;
  states: string | string[] | null;
  agency: string | null;
  width_miles: number | string | null;
  acreage: number;
  environmental_status: string | null;
  transmission_line_count: number;
  total_capacity_mw: number;
  upgrade_candidate_count: number;
  parcel_count: number;
  sub_ids: string[];
  created_at: string | null;
  _max_acreage?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;

    const supabase = getSupabase();

    const type = searchParams.get("type");
    const state = searchParams.get("state");

    // Input validation
    if (state && !/^[A-Za-z]{2}$/.test(state))
      return handleError("state must be a 2-letter code", 400);

    const { limit: limitNum, offset: offsetNum } = validatePagination(searchParams);

    // Fetch ALL corridors (small dataset, ~164 records) to consolidate by name
    let query = supabase
      .from("grid_corridors")
      .select("id,corridor_type,corridor_id,name,states,agency,width_miles,acreage,environmental_status,transmission_line_count,total_capacity_mw,upgrade_candidate_count,created_at");

    if (type) query = query.eq("corridor_type", type);
    if (state) query = query.ilike("states", `%${state.toUpperCase()}%`);

    query = query.order("name", { ascending: true });

    const { data, error } = await query;

    if (error) return handleError(error);

    // Consolidate records with the same name+type into single entries
    const groups = new Map<string, CorridorGroup>();
    for (const row of (data || []) as Array<Record<string, unknown>> as Array<{
      id: string; corridor_type: string | null; corridor_id: string | null; name: string | null;
      states: string | string[] | null; agency: string | null; width_miles: number | string | null;
      acreage: number | string | null; environmental_status: string | null;
      transmission_line_count: number | null; total_capacity_mw: number | null;
      upgrade_candidate_count: number | null; created_at: string | null;
    }>) {
      const key = `${row.name || row.corridor_id || row.id}::${row.corridor_type}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: row.id, // primary record ID (largest parcel)
          corridor_type: row.corridor_type,
          corridor_id: row.corridor_id,
          name: row.name,
          states: row.states,
          agency: row.agency,
          width_miles: row.width_miles,
          acreage: row.acreage ? Number(row.acreage) : 0,
          environmental_status: row.environmental_status,
          transmission_line_count: row.transmission_line_count || 0,
          total_capacity_mw: row.total_capacity_mw || 0,
          upgrade_candidate_count: row.upgrade_candidate_count || 0,
          parcel_count: 1,
          sub_ids: [row.id],
          created_at: row.created_at,
        });
      } else {
        const g = groups.get(key)!;
        g.parcel_count += 1;
        g.sub_ids.push(row.id);
        g.acreage += row.acreage ? Number(row.acreage) : 0;
        g.transmission_line_count += row.transmission_line_count || 0;
        g.total_capacity_mw += row.total_capacity_mw || 0;
        g.upgrade_candidate_count += row.upgrade_candidate_count || 0;
        // Keep the largest parcel's ID as the primary
        if (row.acreage && Number(row.acreage) > (g._max_acreage || 0)) {
          g.id = row.id;
          g._max_acreage = Number(row.acreage);
        }
        // Merge states arrays
        if (row.states) {
          const existing = Array.isArray(g.states) ? g.states : (g.states ? [g.states] : []);
          const incoming = Array.isArray(row.states) ? row.states : [row.states];
          g.states = [...new Set([...existing, ...incoming])];
        }
        // Keep wider width
        if (row.width_miles && (!g.width_miles || Number(row.width_miles) > Number(g.width_miles))) {
          g.width_miles = row.width_miles;
        }
      }
    }

    // Sort by acreage descending, then name
    const consolidated = [...groups.values()]
      .map(({ _max_acreage, sub_ids, ...rest }) => {
        void _max_acreage;
        void sub_ids;
        return rest;
      })
      .sort((a, b) => {
        // Sort by type first, then acreage desc
        if (a.corridor_type !== b.corridor_type) return (a.corridor_type || "").localeCompare(b.corridor_type || "");
        return (b.acreage || 0) - (a.acreage || 0);
      });

    const total = consolidated.length;
    const paged = consolidated.slice(offsetNum, offsetNum + limitNum);

    return NextResponse.json(
      {
        data: paged,
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      { headers: cacheHeaders() }
    );
  } catch (err) {
    return handleError(err);
  }
}

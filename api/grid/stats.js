import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Paginated fetch: Supabase max_rows=1000, so we must paginate to get all rows.
 * Returns all rows matching the query.
 */
async function fetchAllRows(table, column) {
  const allRows = [];
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
    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return allRows;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
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
      fetchAllRows("grid_transmission_lines", "state"),
      fetchAllRows("grid_transmission_lines", "voltage_kv"),
      fetchAllRows("grid_transmission_lines", "capacity_mw"),
      fetchAllRows("grid_transmission_lines", "owner"),
    ]);

    // Check for Supabase errors on count queries
    for (const r of [linesCount, upgradeCount, blmCount, corridorCount, substationCount, weccCount]) {
      if (r.error) return res.status(500).json({ error: r.error.message });
    }

    // Aggregate lines by state
    const stateMap = {};
    stateRows.forEach((row) => {
      if (row.state) stateMap[row.state] = (stateMap[row.state] || 0) + 1;
    });
    const lines_by_state = Object.entries(stateMap)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Aggregate voltage distribution into buckets
    const voltageBuckets = { "0-100": 0, "100-230": 0, "230-345": 0, "345-500": 0, "500+": 0 };
    voltageRows.forEach((row) => {
      const v = parseFloat(row.voltage_kv);
      if (v < 100) voltageBuckets["0-100"]++;
      else if (v < 230) voltageBuckets["100-230"]++;
      else if (v < 345) voltageBuckets["230-345"]++;
      else if (v < 500) voltageBuckets["345-500"]++;
      else voltageBuckets["500+"]++;
    });

    // Aggregate capacity distribution into buckets
    const capacityBuckets = { "0-100": 0, "100-500": 0, "500-1000": 0, "1000-2000": 0, "2000+": 0 };
    capacityRows.forEach((row) => {
      const c = parseFloat(row.capacity_mw);
      if (c < 100) capacityBuckets["0-100"]++;
      else if (c < 500) capacityBuckets["100-500"]++;
      else if (c < 1000) capacityBuckets["500-1000"]++;
      else if (c < 2000) capacityBuckets["1000-2000"]++;
      else capacityBuckets["2000+"]++;
    });

    // Aggregate top owners
    const ownerMap = {};
    ownerRows.forEach((row) => {
      if (row.owner) ownerMap[row.owner] = (ownerMap[row.owner] || 0) + 1;
    });
    const top_owners = Object.entries(ownerMap)
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
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
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();

    // Run all stat queries in parallel
    const [
      linesCount,
      upgradeCount,
      blmCount,
      corridorCount,
      substationCount,
      weccCount,
      linesByState,
      voltageDistribution,
      capacityDistribution,
      topOwners,
    ] = await Promise.all([
      // Total transmission lines
      supabase
        .from("grid_transmission_lines")
        .select("id", { count: "exact", head: true }),

      // Upgrade candidates
      supabase
        .from("grid_transmission_lines")
        .select("id", { count: "exact", head: true })
        .eq("upgrade_candidate", true),

      // BLM ROWs
      supabase
        .from("grid_blm_row")
        .select("id", { count: "exact", head: true }),

      // Corridors
      supabase
        .from("grid_corridors")
        .select("id", { count: "exact", head: true }),

      // Substations
      supabase
        .from("grid_substations")
        .select("id", { count: "exact", head: true }),

      // WECC paths
      supabase
        .from("grid_wecc_paths")
        .select("id", { count: "exact", head: true }),

      // Lines by state (top 20)
      supabase
        .from("grid_transmission_lines")
        .select("state")
        .not("state", "is", null)
        .limit(50000),

      // Voltage distribution
      supabase
        .from("grid_transmission_lines")
        .select("voltage_kv")
        .not("voltage_kv", "is", null)
        .limit(50000),

      // Capacity distribution
      supabase
        .from("grid_transmission_lines")
        .select("capacity_mw")
        .not("capacity_mw", "is", null)
        .limit(50000),

      // Top owners
      supabase
        .from("grid_transmission_lines")
        .select("owner")
        .not("owner", "is", null)
        .limit(50000),
    ]);

    // Aggregate lines by state
    const stateMap = {};
    (linesByState.data || []).forEach((row) => {
      if (row.state) stateMap[row.state] = (stateMap[row.state] || 0) + 1;
    });
    const lines_by_state = Object.entries(stateMap)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Aggregate voltage distribution into buckets
    const voltageBuckets = { "0-100": 0, "100-230": 0, "230-345": 0, "345-500": 0, "500+": 0 };
    (voltageDistribution.data || []).forEach((row) => {
      const v = parseFloat(row.voltage_kv);
      if (v < 100) voltageBuckets["0-100"]++;
      else if (v < 230) voltageBuckets["100-230"]++;
      else if (v < 345) voltageBuckets["230-345"]++;
      else if (v < 500) voltageBuckets["345-500"]++;
      else voltageBuckets["500+"]++;
    });

    // Aggregate capacity distribution into buckets
    const capacityBuckets = { "0-100": 0, "100-500": 0, "500-1000": 0, "1000-2000": 0, "2000+": 0 };
    (capacityDistribution.data || []).forEach((row) => {
      const c = parseFloat(row.capacity_mw);
      if (c < 100) capacityBuckets["0-100"]++;
      else if (c < 500) capacityBuckets["100-500"]++;
      else if (c < 1000) capacityBuckets["500-1000"]++;
      else if (c < 2000) capacityBuckets["1000-2000"]++;
      else capacityBuckets["2000+"]++;
    });

    // Aggregate top owners
    const ownerMap = {};
    (topOwners.data || []).forEach((row) => {
      if (row.owner) ownerMap[row.owner] = (ownerMap[row.owner] || 0) + 1;
    });
    const top_owners = Object.entries(ownerMap)
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

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

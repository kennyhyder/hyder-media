import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();

    // Total installations and capacity
    const { count: totalInstallations } = await supabase
      .from("solar_installations")
      .select("*", { count: "exact", head: true });

    // Installations by type
    const { data: byType } = await supabase.rpc("solar_count_by_type");

    // Installations by state (top 20)
    const { data: byState } = await supabase.rpc("solar_count_by_state");

    // If RPCs don't exist, fall back to manual queries
    let installationsByType = {};
    let installationsByState = {};
    let totalCapacityMw = 0;

    if (byType) {
      byType.forEach((row) => { installationsByType[row.site_type] = row.count; });
    } else {
      // Fallback: query directly
      for (const type of ["utility", "commercial", "community"]) {
        const { count } = await supabase
          .from("solar_installations")
          .select("*", { count: "exact", head: true })
          .eq("site_type", type);
        if (count) installationsByType[type] = count;
      }
    }

    if (byState) {
      byState.forEach((row) => { installationsByState[row.state] = row.count; });
    } else {
      // Fallback: get states with most installations
      const { data: states } = await supabase
        .from("solar_installations")
        .select("state")
        .not("state", "is", null);
      if (states) {
        const counts = {};
        states.forEach((s) => { counts[s.state] = (counts[s.state] || 0) + 1; });
        // Sort by count desc, take top 20
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .forEach(([state, count]) => { installationsByState[state] = count; });
      }
    }

    // Total capacity
    const { data: capData } = await supabase
      .from("solar_installations")
      .select("capacity_mw");
    if (capData) {
      totalCapacityMw = capData.reduce((sum, row) => sum + (parseFloat(row.capacity_mw) || 0), 0);
    }

    // Equipment stats
    const { count: totalEquipment } = await supabase
      .from("solar_equipment")
      .select("*", { count: "exact", head: true });

    // Top module technologies
    const { data: techData } = await supabase
      .from("solar_equipment")
      .select("module_technology")
      .eq("equipment_type", "module")
      .not("module_technology", "is", null);
    const techCounts = {};
    if (techData) {
      techData.forEach((row) => {
        techCounts[row.module_technology] = (techCounts[row.module_technology] || 0) + 1;
      });
    }

    // Data sources
    const { data: dataSources } = await supabase
      .from("solar_data_sources")
      .select("name, record_count, last_import");

    // Equipment aging
    const currentYear = new Date().getFullYear();
    let over10Years = 0;
    let over15Years = 0;
    let over20Years = 0;

    const { data: dateData } = await supabase
      .from("solar_installations")
      .select("install_date")
      .not("install_date", "is", null);
    if (dateData) {
      dateData.forEach((row) => {
        const year = new Date(row.install_date).getFullYear();
        const age = currentYear - year;
        if (age >= 10) over10Years++;
        if (age >= 15) over15Years++;
        if (age >= 20) over20Years++;
      });
    }

    return res.status(200).json({
      total_installations: totalInstallations || 0,
      total_capacity_mw: Math.round(totalCapacityMw * 100) / 100,
      total_equipment: totalEquipment || 0,
      installations_by_type: installationsByType,
      installations_by_state: installationsByState,
      top_technologies: Object.entries(techCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
      data_sources: dataSources || [],
      equipment_aging: {
        over_10_years: over10Years,
        over_15_years: over15Years,
        over_20_years: over20Years,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

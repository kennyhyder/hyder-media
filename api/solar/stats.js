import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// All US states and territories
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","PR","RI","SC","SD","TN","TX",
  "UT","VT","VA","WA","WV","WI","WY"
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();

    // Total installations
    const { count: totalInstallations } = await supabase
      .from("solar_installations")
      .select("*", { count: "exact", head: true });

    // Installations by type - individual count queries (fast, no row limit)
    const installationsByType = {};
    for (const type of ["utility", "commercial", "community"]) {
      const { count } = await supabase
        .from("solar_installations")
        .select("*", { count: "exact", head: true })
        .eq("site_type", type);
      if (count) installationsByType[type] = count;
    }

    // Installations by state - individual count queries per state (avoids 1000-row limit)
    const installationsByState = {};
    const statePromises = US_STATES.map(async (state) => {
      const { count } = await supabase
        .from("solar_installations")
        .select("*", { count: "exact", head: true })
        .eq("state", state);
      return { state, count: count || 0 };
    });
    const stateResults = await Promise.all(statePromises);
    stateResults
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 25)
      .forEach(r => { installationsByState[r.state] = r.count; });

    // Total capacity - paginated sum to avoid 1000-row limit
    let totalCapacityMw = 0;
    let capOffset = 0;
    while (true) {
      const { data: capData } = await supabase
        .from("solar_installations")
        .select("capacity_mw")
        .not("capacity_mw", "is", null)
        .range(capOffset, capOffset + 4999);
      if (!capData || capData.length === 0) break;
      totalCapacityMw += capData.reduce((sum, row) => sum + (parseFloat(row.capacity_mw) || 0), 0);
      capOffset += 5000;
      if (capData.length < 5000) break;
    }

    // Equipment stats
    const { count: totalEquipment } = await supabase
      .from("solar_equipment")
      .select("*", { count: "exact", head: true });

    // Top module technologies - paginated to avoid 1000-row limit
    const techCounts = {};
    let techOffset = 0;
    while (true) {
      const { data: techData } = await supabase
        .from("solar_equipment")
        .select("module_technology")
        .eq("equipment_type", "module")
        .not("module_technology", "is", null)
        .range(techOffset, techOffset + 4999);
      if (!techData || techData.length === 0) break;
      techData.forEach((row) => {
        techCounts[row.module_technology] = (techCounts[row.module_technology] || 0) + 1;
      });
      techOffset += 5000;
      if (techData.length < 5000) break;
    }

    // Data sources
    const { data: dataSources } = await supabase
      .from("solar_data_sources")
      .select("name, record_count, last_import");

    // Equipment aging - use date range count queries (no row limit)
    const currentYear = new Date().getFullYear();
    const cutoff10 = `${currentYear - 10}-01-01`;
    const cutoff15 = `${currentYear - 15}-01-01`;
    const cutoff20 = `${currentYear - 20}-01-01`;

    const [age10, age15, age20] = await Promise.all([
      supabase.from("solar_installations").select("*", { count: "exact", head: true })
        .not("install_date", "is", null).lt("install_date", cutoff10),
      supabase.from("solar_installations").select("*", { count: "exact", head: true })
        .not("install_date", "is", null).lt("install_date", cutoff15),
      supabase.from("solar_installations").select("*", { count: "exact", head: true })
        .not("install_date", "is", null).lt("install_date", cutoff20),
    ]);

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
        over_10_years: age10.count || 0,
        over_15_years: age15.count || 0,
        over_20_years: age20.count || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

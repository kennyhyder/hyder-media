import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess, demoLimitsPayload } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;

    // Fetch all hyperscale datacenters
    const { data: dcs, error } = await supabase
      .from("grid_datacenters")
      .select("id,source_record_id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,created_at")
      .eq("dc_type", "hyperscale")
      .order("capacity_mw", { ascending: false, nullsFirst: false });

    if (error) return res.status(500).json({ error: error.message });

    // Infer status from source_record_id prefix and name patterns
    const records = (dcs || []).map((dc) => {
      let status = "announced";
      const srcId = dc.source_record_id || "";

      // epoch_ai_ records have hardcoded statuses in the ingestion script
      // We need to infer from the data we have
      if (srcId.startsWith("epoch_ai_")) {
        // These were set with explicit status in ingest-epoch-ai-dcs.py
        // Check the known operational/construction/planned from that script
        const opNames = [
          "amazon us east", "microsoft quincy", "google the dalles",
          "meta prineville", "google council bluffs", "meta new albany",
          "microsoft san antonio", "microsoft des moines", "google midlothian",
          "amazon us west", "microsoft cheyenne", "xai memphis",
          "oracle nashville", "apple mesa",
        ];
        const constructNames = [
          "google papillion", "meta dekalb", "meta eagle mountain", "coreweave plano",
        ];
        const plannedNames = [
          "microsoft stargate",
        ];
        const nameLower = (dc.name || "").toLowerCase();
        if (opNames.some((n) => nameLower.includes(n))) status = "operational";
        else if (constructNames.some((n) => nameLower.includes(n))) status = "under_construction";
        else if (plannedNames.some((n) => nameLower.includes(n))) status = "planned";
      } else if (srcId.startsWith("epoch_")) {
        // epoch_ (from ingest-epoch-datacenters.py) — infer from construction clues
        // These records have no explicit status field in DB, but the ingestion script
        // inferred it. We'll use simple heuristics on year_built.
        const yearNow = new Date().getFullYear();
        if (dc.year_built && dc.year_built <= yearNow - 1) {
          status = "operational";
        } else if (dc.year_built && dc.year_built <= yearNow) {
          status = "under_construction";
        } else {
          status = "announced";
        }
      }

      return { ...dc, status };
    });

    // Compute aggregate stats
    const totalProjects = records.length;
    const totalCapacityMw = records.reduce((sum, dc) => sum + (Number(dc.capacity_mw) || 0), 0);
    const operational = records.filter((dc) => dc.status === "operational").length;
    const underConstruction = records.filter((dc) => dc.status === "under_construction").length;
    const announced = records.filter((dc) => dc.status === "announced" || dc.status === "planned").length;

    // Group by operator
    const operatorMap = {};
    for (const dc of records) {
      const op = dc.operator || "Unknown";
      if (!operatorMap[op]) operatorMap[op] = { count: 0, capacity_mw: 0 };
      operatorMap[op].count++;
      operatorMap[op].capacity_mw += Number(dc.capacity_mw) || 0;
    }
    const operatorBreakdown = Object.entries(operatorMap)
      .map(([operator, stats]) => ({ operator, ...stats }))
      .sort((a, b) => b.capacity_mw - a.capacity_mw);

    // Group by state
    const stateMap = {};
    for (const dc of records) {
      const st = dc.state || "Unknown";
      if (!stateMap[st]) stateMap[st] = { count: 0, capacity_mw: 0 };
      stateMap[st].count++;
      stateMap[st].capacity_mw += Number(dc.capacity_mw) || 0;
    }
    const stateBreakdown = Object.entries(stateMap)
      .map(([state, stats]) => ({ state, ...stats }))
      .sort((a, b) => b.capacity_mw - a.capacity_mw);

    // Status breakdown
    const statusBreakdown = {
      operational,
      under_construction: underConstruction,
      announced,
    };

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      data: records,
      stats: {
        total_projects: totalProjects,
        total_capacity_mw: Math.round(totalCapacityMw * 10) / 10,
        total_capacity_gw: Math.round(totalCapacityMw / 100) / 10,
        status: statusBreakdown,
      },
      operatorBreakdown,
      stateBreakdown,
      demo_limits: demoLimitsPayload(access),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

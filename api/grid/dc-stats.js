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
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();

    // Totals
    const [sitesRes, linesRes, subsRes, ixpRes, dcRes, bfRes, countyRes] = await Promise.all([
      supabase.from("grid_dc_sites").select("id", { count: "exact", head: true }),
      supabase.from("grid_transmission_lines").select("id", { count: "exact", head: true }),
      supabase.from("grid_substations").select("id", { count: "exact", head: true }),
      supabase.from("grid_ixp_facilities").select("id", { count: "exact", head: true }),
      supabase.from("grid_datacenters").select("id", { count: "exact", head: true }),
      supabase.from("grid_brownfield_sites").select("id", { count: "exact", head: true }),
      supabase.from("grid_county_data").select("id", { count: "exact", head: true }),
    ]);

    // Top 25 sites by score
    const { data: topSites } = await supabase
      .from("grid_dc_sites")
      .select("id,name,site_type,state,county,dc_score,score_power,score_fiber,substation_voltage_kv,available_capacity_mw,latitude,longitude")
      .order("dc_score", { ascending: false, nullsFirst: false })
      .limit(25);

    // Score distribution
    const { data: allScores } = await supabase
      .from("grid_dc_sites")
      .select("dc_score")
      .not("dc_score", "is", null);

    const distribution = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
    let totalScore = 0;
    const scores = [];
    for (const s of allScores || []) {
      const score = s.dc_score;
      scores.push(score);
      totalScore += score;
      if (score < 20) distribution["0-20"]++;
      else if (score < 40) distribution["20-40"]++;
      else if (score < 60) distribution["40-60"]++;
      else if (score < 80) distribution["60-80"]++;
      else distribution["80-100"]++;
    }
    scores.sort((a, b) => a - b);

    // State averages
    const stateScores = {};
    const stateCounts = {};
    for (const s of allScores || []) {
      // We need state for this — fetch separately
    }

    // State summary from top sites data + a dedicated query
    const { data: stateSummary } = await supabase
      .from("grid_dc_sites")
      .select("state,dc_score")
      .not("dc_score", "is", null);

    const stateAverages = {};
    for (const s of stateSummary || []) {
      if (!stateAverages[s.state]) stateAverages[s.state] = { total: 0, count: 0 };
      stateAverages[s.state].total += s.dc_score;
      stateAverages[s.state].count++;
    }
    const stateAvgList = Object.entries(stateAverages)
      .map(([state, { total, count }]) => ({
        state,
        avg_score: Math.round((total / count) * 10) / 10,
        site_count: count,
      }))
      .sort((a, b) => b.avg_score - a.avg_score);

    // Site type breakdown
    const typeBreakdown = {};
    const { data: typeSummary } = await supabase
      .from("grid_dc_sites")
      .select("site_type");
    for (const s of typeSummary || []) {
      typeBreakdown[s.site_type] = (typeBreakdown[s.site_type] || 0) + 1;
    }

    return res.status(200).json({
      totals: {
        dc_sites: sitesRes.count || 0,
        transmission_lines: linesRes.count || 0,
        substations: subsRes.count || 0,
        ixp_facilities: ixpRes.count || 0,
        datacenters: dcRes.count || 0,
        brownfield_sites: bfRes.count || 0,
        counties: countyRes.count || 0,
      },
      topSites: topSites || [],
      scoreDistribution: distribution,
      scoreStats: {
        average: scores.length ? Math.round((totalScore / scores.length) * 10) / 10 : 0,
        median: scores.length ? scores[Math.floor(scores.length / 2)] : 0,
        min: scores.length ? scores[0] : 0,
        max: scores.length ? scores[scores.length - 1] : 0,
      },
      stateAverages: stateAvgList,
      siteTypeBreakdown: typeBreakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

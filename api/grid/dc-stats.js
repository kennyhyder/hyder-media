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
    // Totals (head:true = count only, no data transfer)
    const [sitesRes, linesRes, subsRes, ixpRes, dcRes, bfRes, countyRes] = await Promise.all([
      supabase.from("grid_dc_sites").select("id", { count: "exact", head: true }),
      supabase.from("grid_transmission_lines").select("id", { count: "exact", head: true }),
      supabase.from("grid_substations").select("id", { count: "exact", head: true }),
      supabase.from("grid_ixp_facilities").select("id", { count: "exact", head: true }),
      supabase.from("grid_datacenters").select("id", { count: "exact", head: true }),
      supabase.from("grid_brownfield_sites").select("id", { count: "exact", head: true }),
      supabase.from("grid_county_data").select("id", { count: "exact", head: true }),
    ]);

    // Check for Supabase errors on totals
    for (const r of [sitesRes, linesRes, subsRes, ixpRes, dcRes, bfRes, countyRes]) {
      if (r.error) return res.status(500).json({ error: r.error.message });
    }

    // Top 25 sites by score
    const { data: topSites, error: topErr } = await supabase
      .from("grid_dc_sites")
      .select("id,name,site_type,state,county,dc_score,score_power,score_fiber,substation_voltage_kv,available_capacity_mw,latitude,longitude")
      .order("dc_score", { ascending: false, nullsFirst: false })
      .limit(25);

    if (topErr) return res.status(500).json({ error: topErr.message });

    // Fetch score + state + site_type — parallel pages for speed
    const totalSites = sitesRes.count || 0;
    const pageSize = 1000;
    const pageCount = Math.ceil(totalSites / pageSize);
    const pagePromises = [];
    for (let i = 0; i < pageCount; i++) {
      pagePromises.push(
        supabase
          .from("grid_dc_sites")
          .select("dc_score,state,site_type")
          .not("dc_score", "is", null)
          .range(i * pageSize, (i + 1) * pageSize - 1)
          .order("id", { ascending: true })
      );
    }
    const pageResults = await Promise.all(pagePromises);
    const allRows = [];
    for (const pr of pageResults) {
      if (pr.error) return res.status(500).json({ error: pr.error.message });
      if (pr.data) allRows.push(...pr.data);
    }

    // Score distribution + stats
    const distribution = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
    let totalScore = 0;
    const scores = [];
    const stateAgg = {};
    const typeBreakdown = {};

    for (const s of allRows) {
      const score = s.dc_score;
      scores.push(score);
      totalScore += score;
      if (score < 20) distribution["0-20"]++;
      else if (score < 40) distribution["20-40"]++;
      else if (score < 60) distribution["40-60"]++;
      else if (score < 80) distribution["60-80"]++;
      else distribution["80-100"]++;

      // State averages
      if (s.state) {
        if (!stateAgg[s.state]) stateAgg[s.state] = { total: 0, count: 0 };
        stateAgg[s.state].total += score;
        stateAgg[s.state].count++;
      }

      // Site type breakdown
      if (s.site_type) {
        typeBreakdown[s.site_type] = (typeBreakdown[s.site_type] || 0) + 1;
      }
    }

    scores.sort((a, b) => a - b);

    const stateAvgList = Object.entries(stateAgg)
      .map(([state, { total, count }]) => ({
        state,
        avg_score: Math.round((total / count) * 10) / 10,
        site_count: count,
      }))
      .sort((a, b) => b.avg_score - a.avg_score);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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

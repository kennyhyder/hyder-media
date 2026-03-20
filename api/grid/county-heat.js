import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Returns county-level heat map data: centroid lat/lng + average DC readiness score
 * for all ~3,222 US counties. Used to create a continuous heat surface across the US,
 * not just at existing site locations.
 *
 * For counties WITH scored sites: uses average dc_score from grid_dc_sites
 * For counties WITHOUT sites: computes proxy from county_data fields
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;

    // Step 1: Get all counties with their centroid coordinates and scoring-relevant fields
    const allCounties = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("grid_county_data")
        .select("fips_code,state,latitude,longitude,nri_score,water_stress_score,has_fiber,fiber_provider_count,construction_employment,it_employment,population,cooling_degree_days,has_dc_tax_incentive,avg_electricity_rate")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .range(offset, offset + pageSize - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (!data || data.length === 0) break;
      allCounties.push(...data);
      if (data.length < pageSize) break;
      offset += data.length;
    }

    // Step 2: Get average dc_score per county from scored sites
    // Use a simple approach: fetch site scores grouped by fips
    const siteScores = [];
    offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("grid_dc_sites")
        .select("fips_code,dc_score")
        .not("dc_score", "is", null)
        .not("fips_code", "is", null)
        .range(offset, offset + pageSize - 1);
      if (error) break; // Non-fatal, we'll use proxy scores
      if (!data || data.length === 0) break;
      siteScores.push(...data);
      if (data.length < pageSize) break;
      offset += data.length;
    }

    // Aggregate site scores by county
    const countyAvgScores = {};
    const countyCounts = {};
    for (const s of siteScores) {
      const fips = s.fips_code;
      if (!fips) continue;
      countyAvgScores[fips] = (countyAvgScores[fips] || 0) + (s.dc_score || 0);
      countyCounts[fips] = (countyCounts[fips] || 0) + 1;
    }
    for (const fips of Object.keys(countyAvgScores)) {
      countyAvgScores[fips] /= countyCounts[fips];
    }

    // Step 3: Build heat data — use site average when available, otherwise compute proxy
    const heatData = [];
    for (const county of allCounties) {
      const fips = county.fips_code;
      const lat = county.latitude;
      const lng = county.longitude;

      let score;
      if (countyAvgScores[fips] !== undefined) {
        score = countyAvgScores[fips];
      } else {
        // Compute proxy score from available county fields
        score = computeCountyProxyScore(county);
      }

      heatData.push([lat, lng, Math.round(score * 10) / 10]);
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      counties: heatData,
      total: heatData.length,
      withSites: Object.keys(countyAvgScores).length,
      withProxy: heatData.length - Object.keys(countyAvgScores).length,
    });
  } catch (err) {
    console.error("County heat error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

/**
 * Compute a DC readiness proxy score (0-100) from county-level data.
 * Weights are redistributed so ALL weight goes to factors we can actually measure,
 * creating real differentiation between counties instead of flat neutral values.
 */
function computeCountyProxyScore(county) {
  // Fiber: has_fiber + provider count (strong differentiator)
  let fiberScore = 30;
  if (county.has_fiber === true) {
    const providers = county.fiber_provider_count || 0;
    fiberScore = Math.min(100, 50 + providers * 5);
  } else if (county.has_fiber === false) {
    fiberScore = 10;
  }

  // Water: stress score (0=low stress=good, 5=extreme=bad)
  let waterScore = 50;
  if (county.water_stress_score != null) {
    waterScore = Math.max(0, Math.min(100, 100 - (county.water_stress_score / 5) * 100));
  }

  // Hazard: NRI score (0=low risk=good, 100=high risk=bad)
  let hazardScore = 50;
  if (county.nri_score != null) {
    hazardScore = Math.max(0, 100 - county.nri_score);
  }

  // Labor: construction + IT employment density
  let laborScore = 30;
  const pop = county.population || 1;
  const construction = county.construction_employment || 0;
  const it = county.it_employment || 0;
  const laborDensity = ((construction + it) / pop) * 1000;
  if (laborDensity > 80) laborScore = 100;
  else if (laborDensity > 50) laborScore = 85;
  else if (laborDensity > 30) laborScore = 65;
  else if (laborDensity > 15) laborScore = 45;
  else laborScore = 20;

  // Climate: CDD (lower is better for DC cooling)
  let climateScore = 50;
  if (county.cooling_degree_days != null) {
    const cdd = county.cooling_degree_days;
    if (cdd < 500) climateScore = 100;
    else if (cdd < 1000) climateScore = 85;
    else if (cdd < 2000) climateScore = 60;
    else if (cdd < 3000) climateScore = 35;
    else climateScore = 15;
  }

  // Tax: binary incentive (strong differentiator)
  const taxScore = county.has_dc_tax_incentive ? 100 : 20;

  // Energy cost: lower is better (strong differentiator)
  let energyScore = 50;
  if (county.avg_electricity_rate != null) {
    const rate = county.avg_electricity_rate; // cents/kWh
    if (rate < 6) energyScore = 100;
    else if (rate < 8) energyScore = 85;
    else if (rate < 10) energyScore = 65;
    else if (rate < 14) energyScore = 40;
    else energyScore = 15;
  }

  // Population density as proxy for "developable land" — mid-range is ideal
  // (too rural = no labor/fiber, too urban = no land/expensive)
  let landScore = 50;
  if (county.population != null) {
    const popDensity = county.population / 600; // rough per-sq-mile estimate
    if (popDensity < 10) landScore = 35;         // too rural
    else if (popDensity < 50) landScore = 70;    // semi-rural — good
    else if (popDensity < 200) landScore = 90;   // suburban — ideal
    else if (popDensity < 1000) landScore = 65;  // urban — land constrained
    else landScore = 30;                          // dense urban — very constrained
  }

  // Weighted composite — ALL weight on measurable factors, no neutral defaults
  return (
    0.25 * fiberScore +     // fiber connectivity (most critical for DC)
    0.20 * energyScore +    // energy cost
    0.15 * waterScore +     // water availability
    0.12 * hazardScore +    // natural hazard risk
    0.10 * laborScore +     // workforce availability
    0.08 * landScore +      // land availability proxy
    0.05 * taxScore +       // tax incentives
    0.05 * climateScore     // cooling climate
  );
}

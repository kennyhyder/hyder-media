import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { checkDemoAccess } from "@/lib/grid-api/demo";
import { CORS_HEADERS, cacheHeaders, internalError } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

interface County {
  fips_code: string;
  state: string | null;
  latitude: number;
  longitude: number;
  nri_score: number | null;
  water_stress_score: number | null;
  has_fiber: boolean | null;
  fiber_provider_count: number | null;
  construction_employment: number | null;
  it_employment: number | null;
  population: number | null;
  cooling_degree_days: number | null;
  has_dc_tax_incentive: boolean | null;
}

/**
 * Returns county-level heat map data: centroid lat/lng + average DC readiness score
 * for all ~3,222 US counties. Used to create a continuous heat surface across the US,
 * not just at existing site locations.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await checkDemoAccess(request, searchParams);
    if ("response" in result) return result.response;

    const supabase = getSupabase();

    // Step 1: Get all counties with their centroid coordinates and scoring-relevant fields
    const allCounties: County[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("grid_county_data")
        .select("fips_code,state,latitude,longitude,nri_score,water_stress_score,has_fiber,fiber_provider_count,construction_employment,it_employment,population,cooling_degree_days,has_dc_tax_incentive")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .range(offset, offset + pageSize - 1);
      if (error) { console.error("Grid county-heat counties query error:", error.message); return internalError(); }
      if (!data || data.length === 0) break;
      allCounties.push(...(data as County[]));
      if (data.length < pageSize) break;
      offset += data.length;
    }

    // Step 2: Get average dc_score per county from scored sites
    const siteScores: Array<{ fips_code: string; dc_score: number }> = [];
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
      siteScores.push(...(data as Array<{ fips_code: string; dc_score: number }>));
      if (data.length < pageSize) break;
      offset += data.length;
    }

    // Aggregate site scores by county
    const countyAvgScores: Record<string, number> = {};
    const countyCounts: Record<string, number> = {};
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
    const heatData: Array<[number, number, number]> = [];
    for (const county of allCounties) {
      const fips = county.fips_code;
      const lat = county.latitude;
      const lng = county.longitude;

      let score: number;
      if (countyAvgScores[fips] !== undefined) {
        score = countyAvgScores[fips];
      } else {
        score = computeCountyProxyScore(county);
      }

      heatData.push([lat, lng, Math.round(score * 10) / 10]);
    }

    return NextResponse.json(
      {
        counties: heatData,
        total: heatData.length,
        withSites: Object.keys(countyAvgScores).length,
        withProxy: heatData.length - Object.keys(countyAvgScores).length,
      },
      { headers: cacheHeaders("public, s-maxage=3600, stale-while-revalidate=7200") }
    );
  } catch (err) {
    console.error("County heat error:", err);
    return internalError();
  }
}

/**
 * Compute a DC readiness proxy score (0-100) from county-level data.
 */
function computeCountyProxyScore(county: County): number {
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

  // Population density as proxy for "developable land" — mid-range is ideal
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
    0.30 * fiberScore +     // fiber connectivity (most critical for DC)
    0.20 * waterScore +     // water availability
    0.15 * hazardScore +    // natural hazard risk
    0.12 * laborScore +     // workforce availability
    0.10 * landScore +      // land availability proxy
    0.06 * taxScore +       // tax incentives
    0.07 * climateScore     // cooling climate
  );
}

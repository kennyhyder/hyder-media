import { createClient } from "@supabase/supabase-js";
import { checkDemoAccess } from "./_demo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Hardcoded LBNL ISO average wait times (years)
const ISO_WAIT_TIMES = {
  ERCOT: 2.5,
  SPP: 3.0,
  MISO: 3.5,
  NYISO: 3.5,
  "ISO-NE": 4.0,
  PJM: 4.5,
  CAISO: 5.0,
};

// Color coding by wait time severity
function waitColor(years) {
  if (years <= 2.5) return "#22c55e";   // green — short
  if (years <= 3.5) return "#eab308";   // yellow — medium
  if (years <= 4.5) return "#f97316";   // orange — long
  return "#ef4444";                      // red — very long
}

// Approximate ISO territory boundaries as lat/lng polygon arrays
// These are simplified state-level approximations
const ISO_BOUNDARIES = {
  PJM: [
    [42.3, -88.0], [42.3, -73.7], [36.5, -73.7], [36.5, -84.8], [39.0, -88.0]
  ],
  MISO: [
    [49.0, -104.0], [49.0, -83.5], [35.0, -83.5], [29.0, -94.0], [33.0, -97.0], [36.5, -104.0]
  ],
  ERCOT: [
    [36.5, -106.6], [36.5, -93.5], [25.8, -93.5], [25.8, -106.6]
  ],
  CAISO: [
    [42.0, -124.4], [42.0, -114.1], [32.5, -114.1], [32.5, -124.4]
  ],
  SPP: [
    [49.0, -104.5], [49.0, -94.5], [33.5, -94.5], [31.5, -104.0]
  ],
  NYISO: [
    [45.0, -79.8], [45.0, -71.8], [40.5, -71.8], [40.5, -79.8]
  ],
  "ISO-NE": [
    [47.5, -73.7], [47.5, -66.9], [41.0, -66.9], [41.0, -73.7]
  ],
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const access = await checkDemoAccess(req, res);
    if (!access) return;

    // Aggregate queue stats per ISO from grid_queue_summary
    const { data: queueData, error: queueErr } = await supabase
      .from("grid_queue_summary")
      .select("iso,total_projects,total_capacity_mw,solar_projects,wind_projects,storage_projects");

    if (queueErr) {
      console.error("Queue overlay error:", queueErr);
      return res.status(500).json({ error: queueErr.message });
    }

    // Aggregate by ISO region
    const isoAgg = {};
    for (const row of (queueData || [])) {
      const iso = row.iso;
      if (!isoAgg[iso]) {
        isoAgg[iso] = { total_projects: 0, total_gw: 0, solar_projects: 0, wind_projects: 0, storage_projects: 0 };
      }
      isoAgg[iso].total_projects += row.total_projects || 0;
      isoAgg[iso].total_gw += (row.total_capacity_mw || 0) / 1000; // MW to GW
      isoAgg[iso].solar_projects += row.solar_projects || 0;
      isoAgg[iso].wind_projects += row.wind_projects || 0;
      isoAgg[iso].storage_projects += row.storage_projects || 0;
    }

    // Build response regions
    const regions = Object.entries(ISO_WAIT_TIMES).map(([iso, wait_years]) => {
      const boundary = ISO_BOUNDARIES[iso];
      if (!boundary) return null;

      const stats = isoAgg[iso] || { total_projects: 0, total_gw: 0 };

      // Estimate completion rate from wait time (inverse relationship)
      // ERCOT (2.5yr) ~65%, CAISO (5yr) ~25%
      const completion_rate = Math.max(0.2, Math.min(0.7, 1.0 - (wait_years / 8)));

      return {
        iso,
        wait_years,
        completion_rate: Math.round(completion_rate * 100) / 100,
        total_projects: stats.total_projects,
        total_gw: Math.round(stats.total_gw * 10) / 10,
        solar_projects: stats.solar_projects || 0,
        color: waitColor(wait_years),
        polygon: {
          type: "Polygon",
          coordinates: [
            // GeoJSON polygons need [lng, lat] and must close the ring
            [...boundary.map(([lat, lng]) => [lng, lat]), [boundary[0][1], boundary[0][0]]]
          ],
        },
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    res.status(200).json({ regions });
  } catch (err) {
    console.error("Queue overlay error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

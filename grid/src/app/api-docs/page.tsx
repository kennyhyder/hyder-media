"use client";

import { useEffect } from "react";
import { isDemoMode } from "@/lib/demoAccess";

export default function APIDocsPage() {
  useEffect(() => {
    if (isDemoMode()) {
      window.location.href = "/grid/";
    }
  }, []);

  if (typeof window !== "undefined" && isDemoMode()) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">API documentation is not available in demo mode.</p>
        <a href="/grid/" className="text-purple-600 underline mt-2 inline-block">Back to Dashboard</a>
      </div>
    );
  }

  const endpoints = [
    {
      method: "GET",
      path: "/api/grid/dc-sites",
      description: "List scored datacenter candidate sites with filters and pagination.",
      params: [
        { name: "state", type: "string", desc: "Filter by US state code (e.g. TX, VA)" },
        { name: "site_type", type: "string", desc: "substation | brownfield | greenfield" },
        { name: "min_score", type: "number", desc: "Minimum DC readiness score (0-100)" },
        { name: "max_score", type: "number", desc: "Maximum DC readiness score (0-100)" },
        { name: "iso_region", type: "string", desc: "Filter by ISO: PJM, MISO, ERCOT, CAISO, SPP, ISO-NE, NYISO, SERC, WECC" },
        { name: "flood", type: "string", desc: "Filter by flood zone: no_sfha | sfha | X" },
        { name: "search", type: "string", desc: "Search site name (case-insensitive)" },
        { name: "sort", type: "string", desc: "Sort field (default: dc_score)" },
        { name: "order", type: "string", desc: "asc | desc (default: desc)" },
        { name: "limit", type: "number", desc: "Max results (default: 50, max: 200)" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: DCsite[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/dc-site",
      description: "Get full details for a single DC site including nearby infrastructure.",
      params: [
        { name: "id", type: "string", desc: "Site UUID (required)" },
      ],
      response: "{ site, county, nearbyLines[], brownfield, nearbyFacilities[] }",
    },
    {
      method: "GET",
      path: "/api/grid/dc-stats",
      description: "Aggregate statistics: totals, score distribution, state averages, top 25 sites.",
      params: [],
      response: "{ totals, topSites[], scoreDistribution, scoreStats, stateAverages[], siteTypeBreakdown }",
    },
    {
      method: "GET",
      path: "/api/grid/dc-export",
      description: "Export filtered sites as CSV for download.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "site_type", type: "string", desc: "Filter by site type" },
        { name: "min_score", type: "number", desc: "Minimum score" },
        { name: "limit", type: "number", desc: "Max rows (default: 1000, max: 10000)" },
      ],
      response: "CSV file download",
    },
    {
      method: "GET",
      path: "/api/grid/map-data",
      description: "Optimized endpoint for map rendering with optional infrastructure overlays.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "site_type", type: "string", desc: "Filter by site type" },
        { name: "min_score", type: "number", desc: "Minimum score" },
        { name: "bounds", type: "string", desc: "Viewport: sw_lat,sw_lng,ne_lat,ne_lng" },
        { name: "lite", type: "1", desc: "Minimal columns for fast rendering" },
        { name: "include_dcs", type: "1", desc: "Include existing datacenter markers" },
        { name: "include_ixps", type: "1", desc: "Include IXP facility markers" },
        { name: "include_lines", type: "1", desc: "Include transmission line polylines" },
        { name: "include_substations", type: "1", desc: "Include substation markers" },
        { name: "include_fiber", type: "1", desc: "Include fiber route polylines" },
        { name: "limit", type: "number", desc: "Max sites (default: 5000, max: 20000)" },
      ],
      response: "{ sites[], total, returned, datacenters[]?, ixps[]?, lines[]?, substations[]? }",
    },
    {
      method: "GET",
      path: "/api/grid/lines",
      description: "Query transmission lines with optional geometry for map rendering.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "min_voltage", type: "number", desc: "Minimum voltage (kV)" },
        { name: "max_voltage", type: "number", desc: "Maximum voltage (kV)" },
        { name: "upgrade_only", type: "true", desc: "Only upgrade candidate lines" },
        { name: "with_geometry", type: "true", desc: "Include WKT geometry for map rendering" },
        { name: "search", type: "string", desc: "Search line name/substations" },
        { name: "limit", type: "number", desc: "Max results (default: 50)" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: Line[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/line",
      description: "Get full details for a single transmission line.",
      params: [
        { name: "id", type: "string", desc: "Line UUID (required)" },
      ],
      response: "{ line, nearbySites[] }",
    },
    {
      method: "GET",
      path: "/api/grid/substations",
      description: "Query substations with voltage and location filters.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "min_voltage", type: "number", desc: "Minimum max voltage (kV)" },
        { name: "search", type: "string", desc: "Search substation name" },
        { name: "limit", type: "number", desc: "Max results (default: 50, max: 200)" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: Substation[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/brownfields",
      description: "List retired power plant sites available for redevelopment.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "search", type: "string", desc: "Search plant name" },
        { name: "limit", type: "number", desc: "Max results" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: Brownfield[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/brownfield",
      description: "Get full details for a single brownfield site.",
      params: [
        { name: "id", type: "string", desc: "Brownfield UUID (required)" },
      ],
      response: "{ brownfield, nearbySubstations[], dcSite }",
    },
    {
      method: "GET",
      path: "/api/grid/corridors",
      description: "List transmission corridor opportunities.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "limit", type: "number", desc: "Max results" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: Corridor[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/ixps",
      description: "List internet exchange point (IXP) facilities.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "search", type: "string", desc: "Search IXP name" },
        { name: "limit", type: "number", desc: "Max results" },
        { name: "offset", type: "number", desc: "Pagination offset" },
      ],
      response: "{ data: IXP[], total: number }",
    },
    {
      method: "GET",
      path: "/api/grid/stats",
      description: "Infrastructure statistics: line counts, voltage ranges, capacity totals.",
      params: [
        { name: "state", type: "string", desc: "Filter stats by state" },
      ],
      response: "{ lines, substations, counties, ixps }",
    },
    {
      method: "GET",
      path: "/api/grid/county-data",
      description: "County-level market intelligence data.",
      params: [
        { name: "state", type: "string", desc: "Filter by state" },
        { name: "county", type: "string", desc: "Filter by county name" },
      ],
      response: "{ data: CountyData[], total: number }",
    },
  ];

  const scoreWeights = [
    { factor: "Power Availability", weight: "20%", desc: "Substation distance, voltage, available capacity" },
    { factor: "Speed to Power", weight: "15%", desc: "ISO queue depth, brownfield grid bonus, existing capacity" },
    { factor: "Fiber Connectivity", weight: "12%", desc: "IXP distance, fiber route proximity, county fiber providers" },
    { factor: "Energy Cost", weight: "10%", desc: "EIA state-level commercial electricity price ($/MWh)" },
    { factor: "Water Risk", weight: "8%", desc: "WRI Aqueduct baseline water stress (inverted)" },
    { factor: "Natural Hazard", weight: "8%", desc: "FEMA NRI composite risk + flood zone SFHA penalty" },
    { factor: "Buildability", weight: "7%", desc: "NLCD land cover suitability + flood zone constraints" },
    { factor: "Labor Market", weight: "4%", desc: "Construction + IT employment per capita (BLS QCEW)" },
    { factor: "DC Cluster", weight: "4%", desc: "Proximity to existing operational datacenters" },
    { factor: "Land Cost", weight: "3%", desc: "USDA county-level land values" },
    { factor: "Construction Cost", weight: "3%", desc: "RSMeans regional construction cost index" },
    { factor: "Gas Pipeline", weight: "2%", desc: "Distance to nearest natural gas pipeline (backup power)" },
    { factor: "Tax Incentives", weight: "2%", desc: "State DC tax incentive programs" },
    { factor: "Climate", weight: "2%", desc: "NOAA cooling degree days (lower CDD = cheaper cooling)" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">API Documentation</h1>
      <p className="text-gray-600 mb-8">
        GridScout REST API endpoints for datacenter site selection intelligence.
        All endpoints return JSON and support CORS.
      </p>

      {/* Base URL */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-8">
        <div className="text-xs font-medium text-purple-600 uppercase tracking-wide mb-1">Base URL</div>
        <code className="text-sm font-mono text-purple-800">https://hyder.me/api/grid</code>
      </div>

      {/* Scoring Methodology */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">DC Readiness Score (0-100)</h2>
        <p className="text-sm text-gray-600 mb-4">
          Each candidate site is scored using a weighted combination of 14 factors.
          Higher scores indicate better suitability for datacenter development.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Factor</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Weight</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Description</th>
              </tr>
            </thead>
            <tbody>
              {scoreWeights.map((w) => (
                <tr key={w.factor} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium text-gray-700">{w.factor}</td>
                  <td className="py-2 px-3 text-right font-mono text-purple-600">{w.weight}</td>
                  <td className="py-2 px-3 text-gray-600">{w.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Endpoints */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Endpoints</h2>
      <div className="space-y-6 mb-8">
        {endpoints.map((ep) => (
          <div key={ep.path} className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">{ep.method}</span>
              <code className="text-sm font-mono text-gray-800">{ep.path}</code>
            </div>
            <p className="text-sm text-gray-600 mb-3">{ep.description}</p>

            {ep.params.length > 0 && (
              <>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Query Parameters</div>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {ep.params.map((p) => (
                        <tr key={p.name} className="border-b border-gray-100 last:border-0">
                          <td className="py-1.5 px-3 font-mono text-purple-600 w-40">{p.name}</td>
                          <td className="py-1.5 px-3 text-gray-400 text-xs w-20">{p.type}</td>
                          <td className="py-1.5 px-3 text-gray-600">{p.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="mt-3 text-xs text-gray-500">
              <span className="font-medium">Response:</span>{" "}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded">{ep.response}</code>
            </div>
          </div>
        ))}
      </div>

      {/* Data Sources */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[
            { source: "HIFLD", desc: "Transmission lines, substations (50 states)", url: "https://hifld-geoplatform.opendata.arcgis.com/" },
            { source: "FEMA NRI", desc: "National Risk Index — county hazard scores", url: "https://hazards.fema.gov/nri/" },
            { source: "WRI Aqueduct 4.0", desc: "Water stress at sub-basin level", url: "https://www.wri.org/aqueduct" },
            { source: "BLS QCEW", desc: "Quarterly Census of Employment & Wages", url: "https://www.bls.gov/qcew/" },
            { source: "NOAA Climate", desc: "30-year climate normals", url: "https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals" },
            { source: "PeeringDB", desc: "Internet exchange points and colocation", url: "https://www.peeringdb.com/" },
            { source: "FCC", desc: "National Broadband Map — fiber availability", url: "https://broadbandmap.fcc.gov/" },
            { source: "OSM + PNNL", desc: "Existing datacenter locations", url: "https://www.openstreetmap.org/" },
            { source: "EIA-860", desc: "Retired generators — brownfield sites", url: "https://www.eia.gov/electricity/data/eia860/" },
            { source: "USDA NASS", desc: "County land values for cost estimation", url: "https://www.nass.usda.gov/" },
            { source: "FEMA NFHL", desc: "Flood zone mapping", url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer" },
            { source: "BLM", desc: "Federal land solar/energy ROWs", url: "https://www.blm.gov/" },
          ].map((s) => (
            <div key={s.source} className="flex items-start gap-2 py-1">
              <span className="font-medium text-purple-700 w-32 shrink-0">{s.source}</span>
              <span className="text-gray-600">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rate Limits */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Rate Limits &amp; Notes</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li>All endpoints run on Vercel Serverless Functions with a 60-second timeout.</li>
          <li>Map data endpoint returns up to 20,000 sites per request; use viewport bounds for optimal performance.</li>
          <li>Transmission line geometry (WKT) is only returned when <code className="bg-gray-100 px-1 rounded">with_geometry=true</code> is set.</li>
          <li>CSV export is limited to 10,000 rows per request.</li>
          <li>Data is refreshed on varying schedules: PeeringDB monthly, HIFLD/QCEW quarterly, EIA/FEMA/NOAA annually.</li>
        </ul>
      </div>
    </div>
  );
}

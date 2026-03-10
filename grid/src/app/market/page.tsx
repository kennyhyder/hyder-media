"use client";

import { useEffect, useState } from "react";

interface DCStats {
  totals: Record<string, number>;
  stateAverages: { state: string; avg_score: number; site_count: number }[];
  scoreDistribution: Record<string, number>;
  scoreStats: { average: number; median: number; min: number; max: number };
  siteTypeBreakdown: Record<string, number>;
}

interface IXP {
  id: string;
  name: string;
  city: string;
  state: string;
  network_count: number;
  ix_count: number;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function MarketPage() {
  const [stats, setStats] = useState<DCStats | null>(null);
  const [ixps, setIxps] = useState<IXP[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const baseUrl = window.location.origin;
    Promise.all([
      fetch(`${baseUrl}/api/grid/dc-stats`).then((r) => r.json()),
      fetch(`${baseUrl}/api/grid/ixps?limit=200&sort=network_count&order=desc`).then((r) => r.json()),
    ])
      .then(([statsData, ixpData]) => {
        setStats(statsData);
        setIxps(ixpData.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Market Analysis</h1>
        <p className="text-gray-600 mb-8">Loading market data...</p>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Group IXPs by state for density analysis
  const ixpByState: Record<string, { count: number; totalNetworks: number }> = {};
  for (const ixp of ixps) {
    if (!ixpByState[ixp.state]) ixpByState[ixp.state] = { count: 0, totalNetworks: 0 };
    ixpByState[ixp.state].count++;
    ixpByState[ixp.state].totalNetworks += ixp.network_count || 0;
  }
  const ixpDensity = Object.entries(ixpByState)
    .map(([state, d]) => ({ state, ...d }))
    .sort((a, b) => b.totalNetworks - a.totalNetworks);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Market Analysis</h1>
      <p className="text-gray-600 mb-8">
        Datacenter market intelligence: state comparisons, IXP density, and scoring methodology.
      </p>

      {/* State comparison table (all 50 states) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">State Comparison</h2>
        <p className="text-sm text-gray-500 mb-4">
          Average DC Readiness Score by state, ranked by score. Higher = better datacenter development conditions.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Sites</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase w-1/3">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {stats.stateAverages.map((s, i) => (
                <tr key={s.state} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-400">{i + 1}</td>
                  <td className="py-2 px-3 font-medium">
                    <a
                      href={`/grid/sites/?state=${s.state}`}
                      className="text-purple-600 hover:text-purple-800 hover:underline"
                    >
                      {s.state}
                    </a>
                  </td>
                  <td className={`py-2 px-3 text-right font-bold ${
                    s.avg_score >= 50 ? "text-green-600" :
                    s.avg_score >= 40 ? "text-yellow-600" : "text-orange-600"
                  }`}>
                    {Number(s.avg_score).toFixed(1)}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">{fmt(s.site_count)}</td>
                  <td className="py-2 px-3">
                    <div className="h-3 bg-gray-100 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${
                          s.avg_score >= 50 ? "bg-green-400" :
                          s.avg_score >= 40 ? "bg-yellow-400" : "bg-orange-400"
                        }`}
                        style={{ width: `${s.avg_score}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* IXP density */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">IXP Density by State</h2>
        <p className="text-sm text-gray-500 mb-4">
          Internet Exchange Points concentrate fiber connectivity. States with more IXPs and networks
          offer better latency and peering options for datacenter operators.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">By Total Networks</h3>
            <div className="space-y-2">
              {ixpDensity.slice(0, 15).map((s) => (
                <div key={s.state} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-600 w-6 text-right">{s.state}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 rounded"
                      style={{ width: `${(s.totalNetworks / (ixpDensity[0]?.totalNetworks || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{fmt(s.totalNetworks)} nets</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Top IXP Facilities</h3>
            <div className="space-y-1">
              {ixps.slice(0, 15).map((ixp) => (
                <div key={ixp.id} className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <div>
                    <span className="text-sm text-gray-900">{ixp.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{ixp.city}, {ixp.state}</span>
                  </div>
                  <span className="text-xs font-medium text-indigo-600">{ixp.network_count} networks</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Score distribution */}
      {stats.scoreDistribution && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h2>
          <p className="text-sm text-gray-500 mb-4">
            Distribution of DC Readiness Scores across all {fmt(Object.values(stats.scoreDistribution).reduce((a, b) => a + b, 0))} evaluated sites.
          </p>
          <div className="flex items-end gap-1 h-32">
            {Object.entries(stats.scoreDistribution).sort(([a], [b]) => Number(a) - Number(b)).map(([bucket, count]) => {
              const maxCount = Math.max(...Object.values(stats.scoreDistribution));
              const pct = (count / maxCount) * 100;
              const score = Number(bucket);
              const color = score >= 70 ? "bg-green-400" : score >= 50 ? "bg-yellow-400" : score >= 30 ? "bg-orange-400" : "bg-red-400";
              return (
                <div key={bucket} className="flex-1 flex flex-col items-center gap-1" title={`${bucket}: ${fmt(count)} sites`}>
                  <div className={`w-full ${color} rounded-t`} style={{ height: `${pct}%`, minHeight: count > 0 ? "2px" : "0" }} />
                  <span className="text-[9px] text-gray-400">{bucket}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>Avg: {stats.scoreStats.average.toFixed(1)}</span>
            <span>Median: {stats.scoreStats.median.toFixed(1)}</span>
            <span>Range: {stats.scoreStats.min.toFixed(0)}–{stats.scoreStats.max.toFixed(0)}</span>
          </div>
        </div>
      )}

      {/* Score methodology */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Scoring Methodology</h2>
        <p className="text-sm text-gray-600 mb-4">
          Each candidate site receives a DC Readiness Score (0-100) based on 14 weighted factors:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { factor: "Power Availability", weight: "20%", desc: "Substation distance, voltage, available capacity" },
            { factor: "Speed to Power", weight: "15%", desc: "ISO queue depth, brownfield grid bonus, existing capacity" },
            { factor: "Fiber Connectivity", weight: "12%", desc: "IXP distance, fiber route proximity, county fiber providers" },
            { factor: "Energy Cost", weight: "10%", desc: "EIA state-level commercial electricity price ($/MWh)" },
            { factor: "Water Risk", weight: "8%", desc: "WRI Aqueduct water stress score" },
            { factor: "Natural Hazard", weight: "8%", desc: "FEMA NRI composite risk + flood zone SFHA penalty" },
            { factor: "Buildability", weight: "7%", desc: "NLCD land cover suitability + flood zone constraints" },
            { factor: "Labor Market", weight: "4%", desc: "Construction + IT employment per capita (BLS QCEW)" },
            { factor: "DC Cluster", weight: "4%", desc: "Proximity to existing operational datacenters" },
            { factor: "Land / Acreage", weight: "3%", desc: "Available acreage and site type (brownfield bonus)" },
            { factor: "Construction Cost", weight: "3%", desc: "RSMeans regional construction cost index" },
            { factor: "Gas Pipeline", weight: "2%", desc: "Distance to nearest natural gas pipeline (backup power)" },
            { factor: "Tax Incentive", weight: "2%", desc: "State datacenter-specific tax incentive programs" },
            { factor: "Climate / Cooling", weight: "2%", desc: "NOAA cooling degree days (lower CDD = cheaper cooling)" },
          ].map((f) => (
            <div key={f.factor} className="flex gap-3 p-3 bg-gray-50 rounded">
              <span className="text-xs font-bold text-purple-600 w-8 shrink-0">{f.weight}</span>
              <div>
                <div className="text-sm font-medium text-gray-900">{f.factor}</div>
                <div className="text-xs text-gray-500">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface DCStats {
  totals: Record<string, number>;
  topSites: {
    id: string;
    name: string;
    site_type: string;
    state: string;
    county: string;
    dc_score: number;
    score_power: number;
    score_fiber: number;
    substation_voltage_kv: number;
    available_capacity_mw: number;
  }[];
  stateAverages: { state: string; avg_score: number; site_count: number }[];
  scoreDistribution: Record<string, number>;
  scoreStats: { average: number; median: number; min: number; max: number };
  siteTypeBreakdown: Record<string, number>;
}

interface HyperscaleStats {
  stats: {
    total_projects: number;
    total_capacity_mw: number;
    total_capacity_gw: number;
    status: { operational: number; under_construction: number; announced: number };
  };
  stateBreakdown: { state: string; count: number; capacity_mw: number }[];
  operatorBreakdown: { operator: string; count: number; capacity_mw: number }[];
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  if (score >= 30) return "text-orange-600";
  return "text-red-600";
}

function scoreBg(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-700";
  if (score >= 50) return "bg-yellow-100 text-yellow-700";
  if (score >= 30) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function siteTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    substation: "Substation",
    greenfield: "Greenfield",
    brownfield: "Industrial Brownfield",
  };
  return labels[type] || type;
}

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q} ${now.getFullYear()}`;
}

export default function ReportsPage() {
  const [stats, setStats] = useState<DCStats | null>(null);
  const [hyperscale, setHyperscale] = useState<HyperscaleStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const baseUrl = window.location.origin;
    Promise.all([
      fetch(withDemoToken(`${baseUrl}/api/grid/dc-stats`)).then((r) => r.json()),
      fetch(withDemoToken(`${baseUrl}/api/grid/hyperscale`)).then((r) => r.json()),
    ])
      .then(([statsData, hyperscaleData]) => {
        setStats(statsData);
        setHyperscale(hyperscaleData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Market Report</h1>
        <p className="text-gray-600 mb-8">Generating report...</p>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!stats || !hyperscale) return null;

  const quarter = getCurrentQuarter();
  const totalSites = stats.totals.dc_sites || 0;
  const totalScored = Object.values(stats.scoreDistribution).reduce((a, b) => a + b, 0);
  const excellentCount = stats.scoreDistribution["60-80"] + stats.scoreDistribution["80-100"];
  const topStates = stats.stateAverages.slice(0, 3);
  const totalHyperscaleGw = hyperscale.stats.total_capacity_gw;
  const totalHyperscaleProjects = hyperscale.stats.total_projects;
  const topState = stats.stateAverages[0];

  // Compute excellent sites per state (score >= 60 from state averages as proxy,
  // or use the top sites list). We'll use stateAverages + score distribution.
  // For market hotspots, merge hyperscale state data with state averages.
  const hyperscaleByState: Record<string, { count: number; capacity_mw: number }> = {};
  for (const s of hyperscale.stateBreakdown) {
    hyperscaleByState[s.state] = { count: s.count, capacity_mw: s.capacity_mw };
  }

  const marketHotspots = stats.stateAverages.slice(0, 10).map((s) => ({
    ...s,
    hyperscale_count: hyperscaleByState[s.state]?.count || 0,
    hyperscale_mw: hyperscaleByState[s.state]?.capacity_mw || 0,
  }));

  // Site type breakdown with avg score estimation
  const siteTypeEntries = Object.entries(stats.siteTypeBreakdown)
    .sort(([, a], [, b]) => b - a);

  // IXP density leaders from state averages (states with highest scores tend to have best fiber)
  const fiberLeaders = stats.stateAverages.slice(0, 5);

  // Transmission capacity leaders (states with most sites tend to have most grid infra)
  const transmissionLeaders = stats.stateAverages
    .sort((a, b) => b.site_count - a.site_count)
    .slice(0, 5);

  // Re-sort stateAverages by score for subsequent use
  const statesByScore = [...stats.stateAverages].sort((a, b) => b.avg_score - a.avg_score);

  return (
    <div>
      {/* Print header */}
      <div className="hidden print:block mb-6">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-xl font-bold text-purple-600">GridScout</span>
        </div>
        <div className="text-xs text-gray-400">Datacenter Site Selection Intelligence</div>
      </div>

      {/* Screen header */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a href="/grid/market/" className="text-sm text-purple-600 hover:text-purple-800">
              &larr; Market Analysis
            </a>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{quarter} DC Site Selection Report</h1>
          <p className="text-gray-600 text-sm mt-1">
            Auto-generated from GridScout database &mdash; {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Print title */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{quarter} DC Site Selection Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* --- Section A: Executive Summary --- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
          Executive Summary
        </h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          GridScout has identified <strong>{fmt(totalSites)}</strong> potential datacenter sites across{" "}
          <strong>{stats.stateAverages.length} states</strong>, with{" "}
          <strong>{fmt(excellentCount)}</strong> sites scoring 60+ (Good to Excellent).
          The strongest markets are{" "}
          <strong>{topStates.map((s) => s.state).join(", ")}</strong>{" "}
          based on average DC Readiness Score.{" "}
          <strong>{fmt(totalHyperscaleProjects)}</strong> hyperscale projects totaling{" "}
          <strong>{totalHyperscaleGw} GW</strong> are tracked in the pipeline.
          The national average DC Readiness Score is{" "}
          <strong>{stats.scoreStats.average.toFixed(1)}</strong> (median{" "}
          {stats.scoreStats.median.toFixed(1)}, range {stats.scoreStats.min.toFixed(0)}&ndash;{stats.scoreStats.max.toFixed(0)}).
        </p>
      </div>

      {/* --- Section B: Key Metrics Dashboard --- */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Scored Sites", value: fmt(totalScored), sub: `of ${fmt(totalSites)} total` },
          { label: "High-Scoring Sites (60+)", value: fmt(excellentCount), sub: `${((excellentCount / totalScored) * 100).toFixed(1)}% of scored` },
          { label: "States Covered", value: String(stats.stateAverages.length), sub: "contiguous + AK/HI" },
          { label: "Avg DC Score", value: stats.scoreStats.average.toFixed(1), sub: `median ${stats.scoreStats.median.toFixed(1)}` },
          { label: "Hyperscale Pipeline", value: `${totalHyperscaleGw} GW`, sub: `${fmt(totalHyperscaleProjects)} projects tracked` },
          { label: "Top Scoring State", value: topState?.state || "N/A", sub: `avg ${topState?.avg_score.toFixed(1)} (${fmt(topState?.site_count || 0)} sites)` },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{card.label}</div>
            <div className="text-2xl font-bold text-gray-900">{card.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* --- Section C: Top 10 Sites --- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
          Top 10 Highest-Scoring Sites
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Site Name</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Voltage (kV)</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Avail. MW</th>
              </tr>
            </thead>
            <tbody>
              {stats.topSites.slice(0, 10).map((site, i) => (
                <tr key={site.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                  <td className="py-2 px-3">
                    <a
                      href={`/grid/site/?id=${site.id}`}
                      className="text-purple-600 hover:text-purple-800 hover:underline font-medium"
                    >
                      {site.name}
                    </a>
                    {site.county && (
                      <span className="text-xs text-gray-400 ml-1">({site.county})</span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{site.state}</td>
                  <td className="py-2 px-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {siteTypeLabel(site.site_type)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-bold ${scoreColor(site.dc_score)}`}>
                      {Number(site.dc_score).toFixed(1)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">
                    {site.substation_voltage_kv ? `${fmt(Math.round(site.substation_voltage_kv))}` : "--"}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">
                    {site.available_capacity_mw ? `${fmt(Math.round(site.available_capacity_mw))}` : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Section D: Market Hotspots --- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 page-break">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
          Market Hotspots &mdash; Top 10 States
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          States ranked by average DC Readiness Score, with site count and hyperscale activity.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Total Sites</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Hyperscale</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">HS Capacity (MW)</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase w-1/5">Score</th>
              </tr>
            </thead>
            <tbody>
              {marketHotspots.map((s, i) => (
                <tr key={s.state} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                  <td className="py-2 px-3 font-medium">
                    <a
                      href={`/grid/sites/?state=${s.state}`}
                      className="text-purple-600 hover:text-purple-800 hover:underline"
                    >
                      {s.state}
                    </a>
                  </td>
                  <td className={`py-2 px-3 text-right font-bold ${scoreColor(s.avg_score)}`}>
                    {Number(s.avg_score).toFixed(1)}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">{fmt(s.site_count)}</td>
                  <td className="py-2 px-3 text-right">
                    {s.hyperscale_count > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                        {s.hyperscale_count}
                      </span>
                    ) : (
                      <span className="text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">
                    {s.hyperscale_mw > 0 ? fmt(Math.round(s.hyperscale_mw)) : "--"}
                  </td>
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

      {/* --- Section E: Site Type Distribution --- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold">4</span>
          Site Type Distribution
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {siteTypeEntries.map(([type, count]) => {
            const pct = ((count / totalScored) * 100).toFixed(1);
            return (
              <div key={type} className="border border-gray-200 rounded-lg p-4">
                <div className="text-sm font-medium text-gray-900 mb-1">{siteTypeLabel(type)}</div>
                <div className="text-2xl font-bold text-gray-900">{fmt(count)}</div>
                <div className="text-xs text-gray-500 mb-2">{pct}% of all sites</div>
                <div className="h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className="h-full bg-purple-400 rounded"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* --- Section F: Infrastructure Highlights --- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 page-break">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold">5</span>
          Infrastructure Highlights
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Grid Infrastructure Leaders */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Most Evaluated Sites by State</h3>
            <p className="text-xs text-gray-500 mb-3">
              States with the most grid infrastructure produce the most candidate sites.
            </p>
            <div className="space-y-2">
              {transmissionLeaders.map((s) => (
                <div key={s.state} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-600 w-6">{s.state}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-purple-400 rounded"
                      style={{ width: `${(s.site_count / transmissionLeaders[0].site_count) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{fmt(s.site_count)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hyperscale Operators */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Hyperscale Operator Pipeline</h3>
            <p className="text-xs text-gray-500 mb-3">
              Leading operators by announced or operational capacity.
            </p>
            <div className="space-y-2">
              {hyperscale.operatorBreakdown.slice(0, 7).map((op) => (
                <div key={op.operator} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24 truncate" title={op.operator}>{op.operator}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 rounded"
                      style={{ width: `${(op.capacity_mw / hyperscale.operatorBreakdown[0].capacity_mw) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-20 text-right">{fmt(Math.round(op.capacity_mw))} MW</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hyperscale Status */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Hyperscale Project Status</h3>
            <div className="flex gap-4">
              <div className="flex-1 bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-green-700">{hyperscale.stats.status.operational}</div>
                <div className="text-xs text-green-600">Operational</div>
              </div>
              <div className="flex-1 bg-yellow-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-yellow-700">{hyperscale.stats.status.under_construction}</div>
                <div className="text-xs text-yellow-600">Under Construction</div>
              </div>
              <div className="flex-1 bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-700">{hyperscale.stats.status.announced}</div>
                <div className="text-xs text-purple-600">Announced</div>
              </div>
            </div>
          </div>

          {/* Score Distribution Summary */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Score Distribution</h3>
            <div className="space-y-1.5">
              {Object.entries(stats.scoreDistribution)
                .sort(([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
                .map(([bucket, count]) => {
                  const pct = ((count / totalScored) * 100).toFixed(1);
                  const score = Number(bucket.split("-")[0]);
                  const color = score >= 60 ? "bg-green-400" : score >= 40 ? "bg-yellow-400" : score >= 20 ? "bg-orange-400" : "bg-red-400";
                  return (
                    <div key={bucket} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">{bucket}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                        <div className={`h-full ${color} rounded`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-20 text-right">{fmt(count)} ({pct}%)</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* --- Methodology Note --- */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Methodology</h2>
        <p className="text-xs text-gray-500 leading-relaxed">
          Sites are scored on a 0&ndash;100 DC Readiness Scale using 14 weighted factors including
          power availability (20%), speed to power (15%), fiber connectivity (12%), energy cost (10%),
          water risk (8%), natural hazard risk (8%), buildability (7%), labor market (4%), DC cluster
          proximity (4%), land (3%), construction cost (3%), gas pipeline (2%), tax incentives (2%),
          and climate/cooling (2%). Data sourced from HIFLD, FEMA NRI, BLS QCEW, NOAA, WRI Aqueduct,
          PeeringDB, PNNL, EIA, and FCC. Report auto-generated from GridScout database.
        </p>
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t border-gray-300">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-medium">GridScout</span> &mdash; Datacenter Site Selection Intelligence
          </div>
          <div>Confidential &mdash; {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
      </div>
    </div>
  );
}

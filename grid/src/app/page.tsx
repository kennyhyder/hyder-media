"use client";

import { useEffect, useState } from "react";

interface DCStats {
  totals: {
    dc_sites: number;
    transmission_lines: number;
    substations: number;
    ixp_facilities: number;
    datacenters: number;
    brownfield_sites: number;
    counties: number;
  };
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
    latitude: number;
    longitude: number;
  }[];
  scoreDistribution: Record<string, number>;
  scoreStats: { average: number; median: number; min: number; max: number };
  stateAverages: { state: string; avg_score: number; site_count: number }[];
  siteTypeBreakdown: Record<string, number>;
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
  if (score >= 70) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  if (score >= 30) return "bg-orange-500";
  return "bg-red-500";
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DCStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const baseUrl = window.location.origin;
    fetch(`${baseUrl}/api/grid/dc-stats`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">GridScout DC Intelligence</h1>
        <p className="text-gray-600 mb-8">Loading datacenter site selection data...</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">GridScout DC Intelligence</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load: {error}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const t = stats.totals;
  const distEntries = Object.entries(stats.scoreDistribution);
  const maxDist = Math.max(...distEntries.map(([, v]) => v), 1);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">GridScout DC Intelligence</h1>
      <p className="text-gray-600 mb-8">
        Datacenter site selection intelligence across the United States. Scored {fmt(t.dc_sites)} candidate sites
        using power availability, fiber proximity, hazard risk, water stress, and more.
      </p>

      {/* Hero stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="text-xs font-medium text-purple-600 uppercase tracking-wide">DC Sites</div>
          <div className="text-2xl font-bold text-purple-700 mt-1">{fmt(t.dc_sites)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lines</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.transmission_lines)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Substations</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.substations)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">IXPs</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.ixp_facilities)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Datacenters</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.datacenters)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Brownfields</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.brownfield_sites)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Counties</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmt(t.counties)}</div>
        </div>
      </div>

      {/* Score overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Score distribution */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h2>
          <div className="space-y-3">
            {distEntries.map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-12 text-right">{bucket}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded transition-all ${
                      bucket === "80-100" ? "bg-green-500" :
                      bucket === "60-80" ? "bg-green-400" :
                      bucket === "40-60" ? "bg-yellow-400" :
                      bucket === "20-40" ? "bg-orange-400" : "bg-red-400"
                    }`}
                    style={{ width: `${(count / maxDist) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-14 text-right">{fmt(count)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div>Avg: <span className="font-semibold text-gray-900">{stats.scoreStats.average}</span></div>
            <div>Median: <span className="font-semibold text-gray-900">{stats.scoreStats.median}</span></div>
            <div>Min: <span className="font-semibold text-gray-900">{stats.scoreStats.min}</span></div>
            <div>Max: <span className="font-semibold text-gray-900">{stats.scoreStats.max}</span></div>
          </div>
        </div>

        {/* Site type breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Site Types</h2>
          {Object.entries(stats.siteTypeBreakdown).map(([type, count]) => (
            <div key={type} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm capitalize text-gray-700">{type}</span>
              <span className="text-sm font-semibold text-gray-900">{fmt(count)}</span>
            </div>
          ))}
        </div>

        {/* State averages (top 15) */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top States by Avg Score</h2>
          <div className="space-y-2">
            {stats.stateAverages.slice(0, 15).map((s) => (
              <div key={s.state} className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-600 w-6 text-right">{s.state}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${scoreBg(s.avg_score)}`}
                    style={{ width: `${s.avg_score}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">{s.avg_score}</span>
                <span className="text-xs text-gray-400 w-12 text-right">({fmt(s.site_count)})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 25 sites table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Top 25 Sites</h2>
          <a
            href="/grid/sites/"
            className="text-sm text-purple-600 hover:text-purple-800 hover:underline"
          >
            View all sites &rarr;
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Site</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Power</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Fiber</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Voltage</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">MW</th>
              </tr>
            </thead>
            <tbody>
              {stats.topSites.map((site, i) => (
                <tr key={site.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-400">{i + 1}</td>
                  <td className="py-2 px-3">
                    <a
                      href={`/grid/site/?id=${site.id}`}
                      className="text-purple-600 hover:text-purple-800 hover:underline font-medium"
                    >
                      {site.name}
                    </a>
                    {site.county && (
                      <span className="text-xs text-gray-400 ml-2">{site.county}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-600">{site.state}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      site.site_type === "brownfield"
                        ? "bg-amber-100 text-amber-700"
                        : site.site_type === "greenfield"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {site.site_type}
                    </span>
                  </td>
                  <td className={`py-2 px-3 text-right font-bold ${scoreColor(site.dc_score)}`}>
                    {site.dc_score}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">{site.score_power}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{site.score_fiber}</td>
                  <td className="py-2 px-3 text-right text-gray-600">
                    {site.substation_voltage_kv ? `${site.substation_voltage_kv} kV` : "—"}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">
                    {site.available_capacity_mw || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

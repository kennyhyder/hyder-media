"use client";

import { useEffect, useState } from "react";
import { withDemoToken } from "@/lib/demoAccess";

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

const TYPE_COLORS: Record<string, string> = {
  substation: "#7c3aed",
  brownfield: "#d97706",
  greenfield: "#059669",
};

function SiteTypeDonut({ breakdown, total }: { breakdown: Record<string, number>; total: number }) {
  const entries = Object.entries(breakdown);
  const r = 70, cx = 90, cy = 90, strokeWidth = 28;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={180} height={180} viewBox="0 0 180 180">
        {entries.map(([type, count]) => {
          const pct = count / Math.max(total, 1);
          const dash = pct * circumference;
          const currentOffset = offset;
          offset += dash;
          return (
            <circle
              key={type}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={TYPE_COLORS[type] || "#6b7280"}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-currentOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" className="text-2xl font-bold" fill="#1f2937" fontSize="22">{fmt(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#6b7280" fontSize="11">total sites</text>
      </svg>
      <div className="space-y-2">
        {entries.map(([type, count]) => (
          <div key={type} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: TYPE_COLORS[type] || "#6b7280" }} />
            <span className="text-sm capitalize text-gray-700">{type}</span>
            <span className="text-sm font-semibold text-gray-900 ml-auto">{fmt(count)}</span>
            <span className="text-xs text-gray-400 w-10 text-right">{((count / Math.max(total, 1)) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DCStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const baseUrl = window.location.origin;
    fetch(withDemoToken(`${baseUrl}/api/grid/dc-stats`))
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
        {[
          { label: "Greenfield Sites", value: t.dc_sites, large: true },
          { label: "Transmission", value: t.transmission_lines },
          { label: "Substations", value: t.substations },
          { label: "IXPs", value: t.ixp_facilities },
          { label: "Datacenters", value: t.datacenters },
          { label: "Industrial Sites", value: t.brownfield_sites },
          { label: "Counties", value: t.counties },
        ].map((card) => (
          <div key={card.label} className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-xs font-medium text-purple-600 uppercase tracking-wide">{card.label}</div>
            <div className={`${card.large ? "text-2xl" : "text-xl"} font-bold text-purple-700 mt-1`}>{fmt(card.value)}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <a href="/grid/map/" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all group">
          <div className="text-purple-600 mb-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">Interactive Map</div>
          <div className="text-xs text-gray-500 mt-0.5">Explore all sites on a national map</div>
        </a>
        <a href="/grid/sites/?min_score=70" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all group">
          <div className="text-green-600 mb-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">Top Rated Sites</div>
          <div className="text-xs text-gray-500 mt-0.5">Score 70+ — ready for deep evaluation</div>
        </a>
        <a href="/grid/brownfields/" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all group">
          <div className="text-amber-600 mb-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">Industrial Sites</div>
          <div className="text-xs text-gray-500 mt-0.5">Retired plants with grid connections</div>
        </a>
        <a href="/grid/market/" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all group">
          <div className="text-blue-600 mb-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">Market Analysis</div>
          <div className="text-xs text-gray-500 mt-0.5">County-level market intelligence</div>
        </a>
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

        {/* Site type donut chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Site Types</h2>
          <SiteTypeDonut breakdown={stats.siteTypeBreakdown} total={t.dc_sites} />
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
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
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
                      site.site_type === "brownfield" || site.site_type === "industrial"
                        ? "bg-amber-100 text-amber-700"
                        : site.site_type === "greenfield"
                        ? "bg-emerald-100 text-emerald-700"
                        : site.site_type === "federal_excess"
                        ? "bg-purple-100 text-purple-700"
                        : site.site_type === "mine"
                        ? "bg-orange-100 text-orange-700"
                        : site.site_type === "military_brac"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {site.site_type === "brownfield" ? "industrial" : site.site_type === "federal_excess" ? "federal" : site.site_type === "military_brac" ? "military" : site.site_type}
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
      {/* Data Sources */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Sources</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Transmission</div>
            <div className="text-gray-700">HIFLD — DHS Homeland Infrastructure</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Hazard Risk</div>
            <div className="text-gray-700">FEMA National Risk Index</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Water Stress</div>
            <div className="text-gray-700">WRI Aqueduct 4.0</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Labor Market</div>
            <div className="text-gray-700">BLS Quarterly Census (QCEW)</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Fiber / IXP</div>
            <div className="text-gray-700">FCC + PeeringDB</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Industrial Sites</div>
            <div className="text-gray-700">EIA-860 Retired Generators</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Datacenters</div>
            <div className="text-gray-700">OSM + PNNL IM3</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Climate</div>
            <div className="text-gray-700">NOAA Climate Normals</div>
          </div>
        </div>
      </div>
    </div>
  );
}

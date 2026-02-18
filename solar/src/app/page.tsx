"use client";

import { useEffect, useState } from "react";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

interface Stats {
  total_installations: number;
  total_capacity_mw: number;
  total_equipment: number;
  installations_by_type: Record<string, number>;
  installations_by_state: Record<string, number>;
  top_technologies: { name: string; count: number }[];
  data_sources: { name: string; record_count: number; last_import: string }[];
  equipment_aging: {
    over_10_years: number;
    over_15_years: number;
    over_20_years: number;
  };
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="text-sm text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-sm text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function HomePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (!stats) return null;

  const stateEntries = Object.entries(stats.installations_by_state).sort(
    (a, b) => b[1] - a[1]
  );
  const maxStateCount = stateEntries[0]?.[1] || 1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">SolarTrack Dashboard</h1>
        <p className="text-gray-500 mt-1">
          U.S. commercial and utility-scale solar installation database
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Sites"
          value={stats.total_installations.toLocaleString()}
        />
        <StatCard
          label="Total Capacity"
          value={`${(stats.total_capacity_mw / 1000).toFixed(1)} GW`}
          sub={`${stats.total_capacity_mw.toLocaleString()} MW`}
        />
        <StatCard
          label="Equipment Records"
          value={stats.total_equipment.toLocaleString()}
        />
        <StatCard
          label="Sites >10 Years Old"
          value={stats.equipment_aging.over_10_years.toLocaleString()}
          sub={`${stats.equipment_aging.over_15_years.toLocaleString()} over 15 years`}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">By Site Type</h2>
          {Object.entries(stats.installations_by_type).map(([type, count]) => (
            <div key={type} className="flex justify-between py-2 border-b last:border-0">
              <span className="capitalize">{type}</span>
              <span className="font-mono font-bold">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Top Technologies</h2>
          {stats.top_technologies.slice(0, 8).map((tech) => (
            <div key={tech.name} className="flex justify-between py-2 border-b last:border-0">
              <span>{tech.name}</span>
              <span className="font-mono font-bold">{tech.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Top States</h2>
        <div className="space-y-2">
          {stateEntries.slice(0, 15).map(([state, count]) => (
            <div key={state} className="flex items-center gap-3">
              <span className="w-8 text-sm font-bold text-gray-600">{state}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full"
                  style={{ width: `${(count / maxStateCount) * 100}%` }}
                />
              </div>
              <span className="text-sm font-mono w-16 text-right">
                {count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Data Sources</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Source</th>
              <th className="pb-2">Records</th>
              <th className="pb-2">Last Import</th>
            </tr>
          </thead>
          <tbody>
            {stats.data_sources.map((src) => (
              <tr key={src.name} className="border-b last:border-0">
                <td className="py-2 font-medium">{src.name}</td>
                <td className="py-2 font-mono">
                  {src.record_count?.toLocaleString() || "0"}
                </td>
                <td className="py-2 text-gray-500">
                  {src.last_import
                    ? new Date(src.last_import).toLocaleDateString()
                    : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <a
          href="/solar/search/"
          className="bg-blue-600 text-white rounded-lg p-6 hover:bg-blue-700 transition"
        >
          <h3 className="font-bold text-lg">Search Sites</h3>
          <p className="text-blue-100 text-sm mt-1">
            Filter by state, capacity, date, and equipment
          </p>
        </a>
        <a
          href="/solar/equipment/"
          className="bg-green-600 text-white rounded-lg p-6 hover:bg-green-700 transition"
        >
          <h3 className="font-bold text-lg">Equipment Search</h3>
          <p className="text-green-100 text-sm mt-1">
            Find sites by manufacturer, model, and age
          </p>
        </a>
        <a
          href="/solar/directory/"
          className="bg-amber-600 text-white rounded-lg p-6 hover:bg-amber-700 transition"
        >
          <h3 className="font-bold text-lg">Business Directory</h3>
          <p className="text-amber-100 text-sm mt-1">
            Browse installers, owners, and manufacturers
          </p>
        </a>
        <a
          href="/solar/search/?min_size=1000"
          className="bg-purple-600 text-white rounded-lg p-6 hover:bg-purple-700 transition"
        >
          <h3 className="font-bold text-lg">Utility Scale</h3>
          <p className="text-purple-100 text-sm mt-1">Browse all sites over 1 MW</p>
        </a>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface Corridor {
  id: string;
  corridor_id: string | null;
  corridor_type: string | null;
  name: string | null;
  width_miles: number | null;
  states: string | string[] | null;
  agency: string | null;
  environmental_status: string | null;
  acreage: number | null;
  transmission_line_count: number;
  total_capacity_mw: number;
  upgrade_candidate_count: number;
  parcel_count: number;
  created_at: string;
}

interface PaginationInfo {
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}

const CORRIDOR_TYPES = [
  { label: "All Types", value: "" },
  { label: "Section 368", value: "section_368" },
  { label: "NIETC", value: "nietc" },
  { label: "BLM Solar DLA", value: "blm_solar_dla" },
];

const STATES = [
  "AZ", "CA", "CO", "ID", "MT", "NM", "NV", "OR", "TX", "UT", "WA", "WY",
];

const PAGE_SIZE = 50;

export default function CorridorsPage() {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [page, setPage] = useState(0);

  const fetchCorridors = useCallback(() => {
    setLoading(true);
    setError(null);

    const baseUrl = window.location.origin;
    const params = new URLSearchParams();

    if (typeFilter) params.set("type", typeFilter);
    if (stateFilter) params.set("state", stateFilter);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    fetch(withDemoToken(`${baseUrl}/api/grid/corridors?${params.toString()}`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setCorridors(json.data || []);
        setPagination(json.pagination || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [typeFilter, stateFilter, page]);

  useEffect(() => {
    fetchCorridors();
  }, [fetchCorridors]);

  const totalPages = pagination ? pagination.totalPages : 0;

  // Count by type from current data (displayed as summary cards)
  const typeCounts: Record<string, number> = {};
  if (pagination) {
    // Only meaningful if no type filter is active
    corridors.forEach((c) => {
      const t = c.corridor_type || "unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
  }

  const typeLabels: Record<string, string> = {
    section_368: "Section 368 Corridors",
    nietc: "NIETC Corridors",
    blm_solar_dla: "BLM Solar DLA",
  };

  const typeDescriptions: Record<string, string> = {
    section_368: "Pre-approved federal energy corridors across western states. Environmental review completed.",
    nietc: "National Interest Electric Transmission Corridors with FERC backstop siting authority.",
    blm_solar_dla: "BLM Designated Leasing Areas pre-screened for solar energy development on federal land.",
  };

  const typeColors: Record<string, string> = {
    section_368: "border-purple-200 bg-purple-50",
    nietc: "border-blue-200 bg-blue-50",
    blm_solar_dla: "border-amber-200 bg-amber-50",
  };

  const typeBadgeColors: Record<string, string> = {
    section_368: "bg-purple-100 text-purple-700",
    nietc: "bg-blue-100 text-blue-700",
    blm_solar_dla: "bg-amber-100 text-amber-700",
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Energy Corridors</h1>
      <p className="text-gray-600 mb-6">
        Federal pre-approved energy corridors, BLM right-of-way grants, and NIETC designated areas.
      </p>

      {/* Type summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Object.entries(typeLabels).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTypeFilter(typeFilter === key ? "" : key); setPage(0); }}
            className={`rounded-lg border p-5 text-left transition-all ${
              typeFilter === key
                ? typeColors[key] + " ring-2 ring-purple-400"
                : typeFilter === ""
                ? typeColors[key]
                : "border-gray-200 bg-white opacity-60"
            }`}
          >
            <h3 className="font-semibold text-gray-900 mb-1">{label}</h3>
            <p className="text-xs text-gray-500">{typeDescriptions[key]}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Corridor Type</label>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              aria-label="Filter by corridor type"
            >
              {CORRIDOR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">State</label>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setPage(0); }}
              aria-label="Filter by state"
            >
              <option value="">All States</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {pagination && (
            <div className="ml-auto text-sm text-gray-500">
              <span className="font-medium text-gray-700">{pagination.total.toLocaleString()}</span> corridors found
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
          Failed to load corridors: {error}
        </div>
      )}

      {/* Results table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Name / ID</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">States</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-gray-500 uppercase">Acreage</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-gray-500 uppercase">Capacity (MW)</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-gray-500 uppercase">Lines</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Env. Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100 animate-pulse">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="py-3 px-3">
                        <div className="h-4 bg-gray-100 rounded w-16" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : corridors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No corridors found matching your filters.
                  </td>
                </tr>
              ) : (
                corridors.map((c) => {
                  const statesDisplay = Array.isArray(c.states) ? c.states.join(", ") : (c.states || "--");
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/grid/corridor/?id=${c.id}`}
                    >
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          typeBadgeColors[c.corridor_type || ""] || "bg-gray-100 text-gray-600"
                        }`}>
                          {typeLabels[c.corridor_type || ""] || c.corridor_type || "--"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 max-w-72">
                        <a href={`/grid/corridor/?id=${c.id}`} className="text-purple-600 hover:underline font-medium">
                          {c.name || c.corridor_id || "--"}
                        </a>
                        {c.parcel_count > 1 && (
                          <span className="ml-2 text-xs text-gray-400">{c.parcel_count} parcels</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 font-mono text-xs">
                        {statesDisplay}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600">
                        {c.acreage != null && c.acreage > 0 ? Math.round(c.acreage).toLocaleString() : "--"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600">
                        {c.total_capacity_mw > 0 ? c.total_capacity_mw.toLocaleString() : "--"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600">
                        {c.transmission_line_count > 0 ? c.transmission_line_count.toLocaleString() : "--"}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 text-xs max-w-40 truncate" title={c.environmental_status || ""}>
                        {c.environmental_status || "--"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

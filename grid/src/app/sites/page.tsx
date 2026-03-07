"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface DCSite {
  id: string;
  name: string;
  site_type: string;
  state: string;
  county: string;
  latitude: number;
  longitude: number;
  dc_score: number;
  score_power: number;
  score_speed_to_power: number;
  score_fiber: number;
  score_water: number;
  score_hazard: number;
  nearest_substation_name: string;
  nearest_substation_distance_km: number;
  substation_voltage_kv: number;
  available_capacity_mw: number;
  nearest_ixp_name: string;
  nearest_ixp_distance_km: number;
  nearest_dc_name: string;
  nearest_dc_distance_km: number;
  former_use: string;
  iso_region: string;
  acreage: number;
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY"
];

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  if (score >= 30) return "text-orange-600";
  return "text-red-600";
}

export default function DCSitesPage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-64 mb-4" /><div className="h-48 bg-gray-200 rounded" /></div>}>
      <DCSitesContent />
    </Suspense>
  );
}

function DCSitesContent() {
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<DCSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("gridscout_compare") || "[]"); } catch { return []; }
    }
    return [];
  });

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev;
      localStorage.setItem("gridscout_compare", JSON.stringify(next));
      return next;
    });
  };

  const [stateFilter, setStateFilter] = useState(searchParams.get("state") || "");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [minScore, setMinScore] = useState(searchParams.get("min_score") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [sortBy, setSortBy] = useState("dc_score");
  const [sortOrder, setSortOrder] = useState("desc");

  const pageSize = 50;

  const fetchSites = useCallback(() => {
    setLoading(true);
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    if (stateFilter) params.set("state", stateFilter);
    if (typeFilter) params.set("site_type", typeFilter);
    if (minScore) params.set("min_score", minScore);
    if (search) params.set("search", search);
    params.set("sort", sortBy);
    params.set("order", sortOrder);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));

    fetch(`${baseUrl}/api/grid/dc-sites?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setSites(data.data || []);
        setTotal(data.pagination?.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [stateFilter, typeFilter, minScore, search, sortBy, sortOrder, page]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const handleExport = () => {
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    if (stateFilter) params.set("state", stateFilter);
    if (typeFilter) params.set("site_type", typeFilter);
    if (minScore) params.set("min_score", minScore);
    window.open(`${baseUrl}/api/grid/dc-export?${params}`, "_blank");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">DC Site Search</h1>
          <p className="text-gray-600 text-sm mt-1">
            {total > 0 ? `${total.toLocaleString()} scored datacenter candidate sites` : "Search scored sites"}
          </p>
        </div>
        <div className="flex gap-2">
          {compareIds.length > 0 && (
            <a
              href={`/grid/compare/?ids=${compareIds.join(",")}`}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
            >
              Compare ({compareIds.length})
            </a>
          )}
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Search name, county..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-purple-500 focus:border-purple-500"
          />
          <select
            value={stateFilter}
            onChange={(e) => { setStateFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All States</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Types</option>
            <option value="substation">Substation</option>
            <option value="brownfield">Brownfield</option>
            <option value="greenfield">Greenfield</option>
          </select>
          <select
            value={minScore}
            onChange={(e) => { setMinScore(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">Min Score</option>
            <option value="30">30+</option>
            <option value="40">40+</option>
            <option value="50">50+</option>
            <option value="60">60+</option>
            <option value="70">70+</option>
          </select>
          <button
            onClick={() => { setSearch(""); setStateFilter(""); setTypeFilter(""); setMinScore(""); setPage(0); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="py-2 px-2 w-8"></th>
                {[
                  { key: "dc_score", label: "Score" },
                  { key: "name", label: "Site" },
                  { key: "state", label: "State" },
                  { key: "site_type", label: "Type" },
                  { key: "substation_voltage_kv", label: "Voltage" },
                  { key: "available_capacity_mw", label: "MW" },
                  { key: "nearest_ixp_distance_km", label: "IXP Dist" },
                  { key: "nearest_dc_distance_km", label: "DC Dist" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-purple-600"
                  >
                    {col.label}
                    {sortBy === col.key && (
                      <span className="ml-1">{sortOrder === "desc" ? "↓" : "↑"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : sites.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">No sites found</td></tr>
              ) : (
                sites.map((site) => (
                  <tr key={site.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-2">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(site.id)}
                        onChange={() => toggleCompare(site.id)}
                        className="accent-purple-600"
                        title={compareIds.includes(site.id) ? "Remove from compare" : compareIds.length >= 5 ? "Max 5 sites" : "Add to compare"}
                      />
                    </td>
                    <td className={`py-2 px-3 font-bold ${scoreColor(site.dc_score)}`}>
                      {site.dc_score}
                    </td>
                    <td className="py-2 px-3">
                      <a
                        href={`/grid/site/?id=${site.id}`}
                        className="text-purple-600 hover:text-purple-800 hover:underline font-medium"
                      >
                        {site.name}
                      </a>
                      {site.county && (
                        <span className="text-xs text-gray-400 ml-1">{site.county}</span>
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
                    <td className="py-2 px-3 text-gray-600">
                      {site.substation_voltage_kv ? `${site.substation_voltage_kv} kV` : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {site.available_capacity_mw || "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {site.nearest_ixp_distance_km != null
                        ? `${(site.nearest_ixp_distance_km * 0.621371).toFixed(1)} mi`
                        : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {site.nearest_dc_distance_km != null
                        ? `${(site.nearest_dc_distance_km * 0.621371).toFixed(1)} mi`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-500">
              Page {page + 1} of {totalPages} ({total.toLocaleString()} results)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

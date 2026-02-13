"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { Installation, Pagination } from "@/types/solar";

const InstallationMap = dynamic(() => import("@/components/InstallationMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
      Loading map...
    </div>
  ),
});

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

type SortKey = "site_name" | "state" | "site_type" | "capacity_mw" | "install_date" | "site_status" | "owner_name";
type SortDir = "asc" | "desc";

function SortHeader({ label, sortKey, currentSort, currentDir, onSort, align }: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-4 py-3 font-medium text-gray-500 cursor-pointer hover:text-gray-900 select-none`}
      onClick={() => onSort(sortKey)}
    >
      {label}{" "}
      <span className={active ? "text-blue-600" : "text-gray-300"}>
        {active ? (currentDir === "asc" ? "\u25B2" : "\u25BC") : "\u25B4"}
      </span>
    </th>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const [results, setResults] = useState<Installation[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [filters, setFilters] = useState({
    state: searchParams.get("state") || "",
    min_size: searchParams.get("min_size") || "",
    max_size: searchParams.get("max_size") || "",
    start_date: searchParams.get("start_date") || "",
    end_date: searchParams.get("end_date") || "",
    site_type: searchParams.get("site_type") || "",
    site_status: searchParams.get("site_status") || "active",
    installer: searchParams.get("installer") || "",
    owner: searchParams.get("owner") || "",
    q: searchParams.get("q") || "",
    near_lat: searchParams.get("near_lat") || "",
    near_lng: searchParams.get("near_lng") || "",
    radius_miles: searchParams.get("radius_miles") || "",
  });
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("capacity_mw");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Map frontend sort keys to API column names
  const sortColMap: Record<SortKey, string> = {
    site_name: "site_name",
    state: "state",
    site_type: "site_type",
    capacity_mw: "capacity_mw",
    install_date: "install_date",
    site_status: "site_status",
    owner_name: "site_name", // fallback, owner sort is client-side
  };

  const search = useCallback(async (pageNum: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pageNum), limit: "25" });
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    // Server-side sorting
    const apiSort = sortColMap[sortKey] || "capacity_mw";
    params.set("sort", apiSort);
    params.set("order", sortDir);

    try {
      const res = await fetch(`${API_BASE}/installations?${params}`);
      const data = await res.json();
      setResults(data.data || []);
      setPagination(data.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters, sortKey, sortDir]);

  useEffect(() => {
    search(page);
  }, [page, search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    if (filters.near_lat) setShowMap(true);
    search(1);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "capacity_mw" ? "desc" : "asc");
    }
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    params.set("limit", "10000");

    try {
      const res = await fetch(`${API_BASE}/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `solar_installations_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortKey) {
        case "site_name": av = a.site_name || a.county || ""; bv = b.site_name || b.county || ""; break;
        case "state": av = a.state || ""; bv = b.state || ""; break;
        case "site_type": av = a.site_type; bv = b.site_type; break;
        case "capacity_mw": av = Number(a.capacity_mw) || 0; bv = Number(b.capacity_mw) || 0; break;
        case "install_date": av = a.install_date || ""; bv = b.install_date || ""; break;
        case "site_status": av = a.site_status || ""; bv = b.site_status || ""; break;
        case "owner_name": av = a.owner_name || ""; bv = b.owner_name || ""; break;
      }
      if (av === null) av = "";
      if (bv === null) bv = "";
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [results, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search Installations</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Text Search
            </label>
            <input
              type="text"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Site name, county..."
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select
              value={filters.state}
              onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All States</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Site Type</label>
            <select
              value={filters.site_type}
              onChange={(e) => setFilters({ ...filters, site_type: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="utility">Utility</option>
              <option value="commercial">Commercial</option>
              <option value="community">Community</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.site_status}
              onChange={(e) => setFilters({ ...filters, site_status: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="proposed">Proposed / Planned</option>
              <option value="under_construction">Under Construction</option>
              <option value="retired">Retired</option>
              <option value="decommissioned">Decommissioned</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Size (kW)
            </label>
            <input
              type="number"
              value={filters.min_size}
              onChange={(e) => setFilters({ ...filters, min_size: e.target.value })}
              placeholder="e.g. 1000"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Size (kW)
            </label>
            <input
              type="number"
              value={filters.max_size}
              onChange={(e) => setFilters({ ...filters, max_size: e.target.value })}
              placeholder="e.g. 50000"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Installer</label>
            <input
              type="text"
              value={filters.installer}
              onChange={(e) => setFilters({ ...filters, installer: e.target.value })}
              placeholder="Installer name..."
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <input
              type="text"
              value={filters.owner}
              onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
              placeholder="Owner name..."
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              Search
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Near Me</label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={geoLoading}
                onClick={() => {
                  if (!navigator.geolocation) return;
                  setGeoLoading(true);
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setFilters((f) => ({
                        ...f,
                        near_lat: pos.coords.latitude.toFixed(4),
                        near_lng: pos.coords.longitude.toFixed(4),
                        radius_miles: f.radius_miles || "50",
                      }));
                      setGeoLoading(false);
                    },
                    () => setGeoLoading(false),
                    { timeout: 10000 }
                  );
                }}
                className="flex-1 bg-gray-100 border rounded-md px-3 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
              >
                {geoLoading ? "Locating..." : filters.near_lat ? `${filters.near_lat}, ${filters.near_lng}` : "Use Location"}
              </button>
              {filters.near_lat && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, near_lat: "", near_lng: "", radius_miles: "" }))}
                  className="px-2 text-gray-400 hover:text-gray-600"
                >
                  x
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Radius (miles)</label>
            <select
              value={filters.radius_miles}
              onChange={(e) => setFilters({ ...filters, radius_miles: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
              disabled={!filters.near_lat}
            >
              <option value="">-</option>
              <option value="10">10 miles</option>
              <option value="25">25 miles</option>
              <option value="50">50 miles</option>
              <option value="100">100 miles</option>
              <option value="200">200 miles</option>
            </select>
          </div>
        </div>
      </form>

      {/* Map + Export controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <button
            onClick={() => setShowMap(!showMap)}
            className={`px-4 py-2 rounded-md text-sm font-medium border transition ${
              showMap
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {showMap ? "Hide Map" : "Show Map"}
          </button>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || !pagination?.total}
          className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {exporting ? "Exporting..." : `Export CSV${pagination?.total ? ` (${Math.min(pagination.total, 10000).toLocaleString()})` : ""}`}
        </button>
      </div>

      {showMap && results.length > 0 && (
        <InstallationMap installations={results} />
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Searching...</div>
      ) : (
        <>
          {pagination && (
            <div className="text-sm text-gray-500">
              {pagination.total.toLocaleString()} results found
            </div>
          )}

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader label="Site" sortKey="site_name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="State" sortKey="state" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Type" sortKey="site_type" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Owner" sortKey="owner_name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Capacity" sortKey="capacity_mw" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Year" sortKey="install_date" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status" sortKey="site_status" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  {filters.near_lat && (
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Distance</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((inst) => (
                  <tr key={inst.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <a
                        href={`/solar/site/?id=${inst.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {inst.site_name || inst.county || "Unknown"}
                      </a>
                      {inst.county && inst.site_name && (
                        <div className="text-xs text-gray-400">{inst.county}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{inst.state}</td>
                    <td className="px-4 py-3 capitalize">{inst.site_type}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {inst.owner_name || <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {inst.capacity_mw
                        ? `${Number(inst.capacity_mw).toFixed(1)} MW`
                        : inst.capacity_dc_kw
                        ? `${Number(inst.capacity_dc_kw).toLocaleString()} kW`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {inst.install_date?.substring(0, 4) || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        inst.site_status === "active" ? "bg-green-100 text-green-700" :
                        inst.site_status === "proposed" ? "bg-yellow-100 text-yellow-700" :
                        inst.site_status === "under_construction" ? "bg-blue-100 text-blue-700" :
                        inst.site_status === "retired" || inst.site_status === "decommissioned" ? "bg-red-100 text-red-700" :
                        inst.site_status === "canceled" ? "bg-gray-100 text-gray-500" :
                        "bg-gray-100 text-gray-500"
                      }`}>
                        {inst.site_status === "under_construction" ? "building" : inst.site_status || "-"}
                      </span>
                    </td>
                    {filters.near_lat && (
                      <td className="px-4 py-3 text-right text-gray-500 font-mono">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(inst as any).distance_miles != null
                          ? `${Number((inst as any).distance_miles).toFixed(1)} mi`
                          : "-"}
                      </td>
                    )}
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      No results found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border rounded-md text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page} of {pagination.totalPages.toLocaleString()}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="px-4 py-2 border rounded-md text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading search...</div>}>
      <SearchContent />
    </Suspense>
  );
}

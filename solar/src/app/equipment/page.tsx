"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Pagination } from "@/types/solar";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

interface EquipmentResult {
  id: string;
  equipment_type: string;
  manufacturer: string | null;
  model: string | null;
  quantity: number;
  module_technology: string | null;
  module_wattage_w: number | null;
  inverter_capacity_kw: number | null;
  equipment_status: string;
  specs: Record<string, unknown>;
  installation: {
    id: string;
    site_name: string | null;
    state: string | null;
    city: string | null;
    county: string | null;
    capacity_dc_kw: number | null;
    capacity_mw: number | null;
    install_date: string | null;
    site_type: string;
  };
}

type SortKey = "equipment_type" | "manufacturer" | "technology" | "site" | "location" | "capacity" | "year";
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

function EquipmentContent() {
  const searchParams = useSearchParams();
  const [results, setResults] = useState<EquipmentResult[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    manufacturer: searchParams.get("manufacturer") || "",
    model: searchParams.get("model") || "",
    equipment_type: searchParams.get("equipment_type") || "",
    min_age_years: searchParams.get("min_age_years") || "",
    state: searchParams.get("state") || "",
  });
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("manufacturer");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Map frontend sort keys to API column names (RPC handles join sorts)
  const sortColMap: Record<SortKey, string> = {
    equipment_type: "equipment_type",
    manufacturer: "manufacturer",
    technology: "manufacturer", // fallback — no sortable tech column
    site: "manufacturer", // fallback — no sortable site name column
    location: "state",
    capacity: "capacity_mw",
    year: "install_date",
  };

  const search = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: "25",
      });
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      // Server-side sorting
      const apiSort = sortColMap[sortKey] || "manufacturer";
      params.set("sort", apiSort);
      params.set("order", sortDir);

      try {
        const res = await fetch(`${API_BASE}/equipment?${params}`);
        const data = await res.json();
        setResults(data.data || []);
        setPagination(data.pagination);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [filters, sortKey, sortDir]
  );

  useEffect(() => {
    search(page);
  }, [page, search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    search(1);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "capacity" ? "desc" : "asc");
    }
    setPage(1);
  };

  // Server handles sorting — just use results directly
  const sorted = results;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipment Search</h1>
        <p className="text-gray-500 mt-1">
          Search solar equipment across all installations by manufacturer, model, and age
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Manufacturer
            </label>
            <input
              type="text"
              value={filters.manufacturer}
              onChange={(e) =>
                setFilters({ ...filters, manufacturer: e.target.value })
              }
              placeholder="e.g. First Solar"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <input
              type="text"
              value={filters.model}
              onChange={(e) =>
                setFilters({ ...filters, model: e.target.value })
              }
              placeholder="e.g. Series 6"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              value={filters.equipment_type}
              onChange={(e) =>
                setFilters({ ...filters, equipment_type: e.target.value })
              }
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="module">Module/Panel</option>
              <option value="inverter">Inverter</option>
              <option value="battery">Battery</option>
              <option value="tracker">Tracker</option>
              <option value="racking">Racking</option>
              <option value="transformer">Transformer</option>
            </select>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Age (years)
            </label>
            <input
              type="number"
              value={filters.min_age_years}
              onChange={(e) =>
                setFilters({ ...filters, min_age_years: e.target.value })
              }
              placeholder="e.g. 10"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-green-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-green-700"
            >
              Search Equipment
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Searching...</div>
      ) : (
        <>
          {pagination && (
            <div className="text-sm text-gray-500">
              {pagination.total.toLocaleString()} equipment records found
            </div>
          )}

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader label="Type" sortKey="equipment_type" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Manufacturer" sortKey="manufacturer" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Technology" sortKey="technology" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Site" sortKey="site" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Location" sortKey="location" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Capacity" sortKey="capacity" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Year" sortKey="year" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((eq) => (
                  <tr key={eq.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 capitalize">{eq.equipment_type}</td>
                    <td className="px-4 py-3">
                      {eq.manufacturer || <span className="text-gray-300">-</span>}
                      {eq.model && (
                        <div className="text-xs text-gray-400">{eq.model}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {eq.module_technology || <span className="text-gray-300">-</span>}
                      {eq.module_wattage_w && (
                        <div className="text-xs text-gray-400">{eq.module_wattage_w}W</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/solar/site/?id=${eq.installation.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {eq.installation.site_name || "Unknown"}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {eq.installation.state}
                      {eq.installation.county && (
                        <span className="text-gray-400 ml-1">
                          ({eq.installation.county})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {eq.installation.capacity_mw
                        ? `${Number(eq.installation.capacity_mw).toFixed(1)} MW`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {eq.installation.install_date?.substring(0, 4) || "-"}
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-gray-400"
                    >
                      No equipment found. Try adjusting your search.
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
                onClick={() =>
                  setPage((p) => Math.min(pagination.totalPages, p + 1))
                }
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

export default function EquipmentPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading equipment search...</div>}>
      <EquipmentContent />
    </Suspense>
  );
}

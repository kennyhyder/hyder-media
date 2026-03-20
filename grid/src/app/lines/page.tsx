"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { withDemoToken } from "@/lib/demoAccess";

const TransmissionMap = dynamic(() => import("../../components/TransmissionMap"), { ssr: false });

interface TransmissionLine {
  id: string;
  hifld_id: number;
  voltage_kv: number | null;
  volt_class: string | null;
  owner: string | null;
  status: string | null;
  line_type: string | null;
  sub_1: string | null;
  sub_2: string | null;
  naession: string | null;
  capacity_mw: number | null;
  estimated_capacity_mva: number | null;
  capacity_band: string | null;
  upgrade_candidate: boolean;
  ercot_shadow_price: number | null;
  ercot_binding_count: number | null;
  ercot_mw_limit: number | null;
  state: string | null;
  county: string | null;
  length_miles: number | null;
  created_at: string;
  geometry_wkt?: string | null;
}

interface MapLine {
  id: string;
  hifld_id: number;
  geometry_wkt: string | null;
  voltage_kv: number | null;
  capacity_mw: number | null;
  upgrade_candidate: boolean;
  owner: string | null;
  state: string | null;
  sub_1: string | null;
  sub_2: string | null;
  naession: string | null;
}

interface PaginationInfo {
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

const VOLTAGE_RANGES = [
  { label: "All Voltages", min: "", max: "" },
  { label: "0-100 kV", min: "0", max: "100" },
  { label: "100-230 kV", min: "100", max: "230" },
  { label: "230-345 kV", min: "230", max: "345" },
  { label: "345-500 kV", min: "345", max: "500" },
  { label: "500+ kV", min: "500", max: "" },
];

const CAPACITY_RANGES = [
  { label: "All Capacities", min: "", max: "" },
  { label: "0-100 MW", min: "0", max: "100" },
  { label: "50-100 MW (Upgrade)", min: "50", max: "100" },
  { label: "100-500 MW", min: "100", max: "500" },
  { label: "500-1000 MW", min: "500", max: "1000" },
  { label: "1000+ MW", min: "1000", max: "" },
];

const SORT_OPTIONS = [
  { label: "Voltage (high-low)", sort: "voltage_kv", order: "desc" },
  { label: "Voltage (low-high)", sort: "voltage_kv", order: "asc" },
  { label: "Capacity (high-low)", sort: "capacity_mw", order: "desc" },
  { label: "Capacity (low-high)", sort: "capacity_mw", order: "asc" },
  { label: "Length (longest)", sort: "length_miles", order: "desc" },
  { label: "State (A-Z)", sort: "state", order: "asc" },
  { label: "Owner (A-Z)", sort: "owner", order: "asc" },
];

const PAGE_SIZE = 50;

export default function SearchPage() {
  const [lines, setLines] = useState<TransmissionLine[]>([]);
  const [mapLines, setMapLines] = useState<MapLine[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);

  // Filter state
  const [state, setState] = useState("");
  const [voltageRange, setVoltageRange] = useState(0);
  const [capacityRange, setCapacityRange] = useState(0);
  const [upgradeOnly, setUpgradeOnly] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [sortIndex, setSortIndex] = useState(0);
  const [page, setPage] = useState(0);

  // Read initial filters from URL params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("owner")) setOwnerSearch(params.get("owner") || "");
    if (params.get("state")) setState(params.get("state") || "");
    if (params.get("upgrade_only") === "true") setUpgradeOnly(true);
  }, []);

  const fetchLines = useCallback(() => {
    setLoading(true);
    setError(null);

    const baseUrl = window.location.origin;
    const params = new URLSearchParams();

    if (state) params.set("state", state);

    const vr = VOLTAGE_RANGES[voltageRange];
    if (vr.min) params.set("min_voltage", vr.min);
    if (vr.max) params.set("max_voltage", vr.max);

    const cr = CAPACITY_RANGES[capacityRange];
    if (cr.min) params.set("min_capacity", cr.min);
    if (cr.max) params.set("max_capacity", cr.max);

    if (upgradeOnly) params.set("upgrade_only", "true");
    if (ownerSearch.trim()) params.set("owner", ownerSearch.trim());
    if (textSearch.trim()) params.set("search", textSearch.trim());

    const so = SORT_OPTIONS[sortIndex];
    params.set("sort", so.sort);
    params.set("order", so.order);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    fetch(withDemoToken(`${baseUrl}/api/grid/lines?${params.toString()}`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setLines(json.data || []);
        setPagination(json.pagination || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [state, voltageRange, capacityRange, upgradeOnly, ownerSearch, textSearch, sortIndex, page]);

  // Fetch on filter/page change
  useEffect(() => {
    fetchLines();
  }, [fetchLines]);

  // Fetch map data when map is toggled on or filters change
  const fetchMapLines = useCallback(() => {
    if (!showMap) return;
    setMapLoading(true);

    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    params.set("with_geometry", "true");
    params.set("limit", "2500");

    if (state) params.set("state", state);
    const vr = VOLTAGE_RANGES[voltageRange];
    if (vr.min) params.set("min_voltage", vr.min);
    if (vr.max) params.set("max_voltage", vr.max);
    const cr = CAPACITY_RANGES[capacityRange];
    if (cr.min) params.set("min_capacity", cr.min);
    if (cr.max) params.set("max_capacity", cr.max);
    if (upgradeOnly) params.set("upgrade_only", "true");
    if (ownerSearch.trim()) params.set("owner", ownerSearch.trim());
    if (textSearch.trim()) params.set("search", textSearch.trim());

    fetch(withDemoToken(`${baseUrl}/api/grid/lines?${params.toString()}`))
      .then((res) => res.json())
      .then((json) => {
        setMapLines(json.data || []);
        setMapLoading(false);
      })
      .catch(() => setMapLoading(false));
  }, [showMap, state, voltageRange, capacityRange, upgradeOnly, ownerSearch, textSearch]);

  useEffect(() => {
    fetchMapLines();
  }, [fetchMapLines]);

  // Reset to page 0 when filters change
  const applyFilters = () => {
    setPage(0);
  };

  const totalPages = pagination ? pagination.totalPages : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Transmission Lines</h1>
      <p className="text-gray-600 mb-6">
        Search and filter transmission lines by voltage, capacity, state, owner, and upgrade status.
      </p>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">State</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={state}
              onChange={(e) => { setState(e.target.value); setPage(0); }}
              aria-label="Filter lines by state"
            >
              <option value="">All States</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Voltage Class</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={voltageRange}
              onChange={(e) => { setVoltageRange(parseInt(e.target.value)); setPage(0); }}
              aria-label="Filter by voltage class"
            >
              {VOLTAGE_RANGES.map((v, i) => (
                <option key={i} value={i}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Capacity Range</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={capacityRange}
              onChange={(e) => { setCapacityRange(parseInt(e.target.value)); setPage(0); }}
              aria-label="Filter by capacity range"
            >
              {CAPACITY_RANGES.map((c, i) => (
                <option key={i} value={i}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Owner</label>
            <input
              type="text"
              placeholder="Search by owner..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              aria-label="Search by line owner"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-48">
            <input
              type="text"
              placeholder="Search line name, substation..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={textSearch}
              onChange={(e) => setTextSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              aria-label="Search by line name or substation"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
              checked={upgradeOnly}
              onChange={(e) => { setUpgradeOnly(e.target.checked); setPage(0); }}
            />
            Upgrade candidates only
          </label>
          <div>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
              value={sortIndex}
              onChange={(e) => { setSortIndex(parseInt(e.target.value)); setPage(0); }}
              aria-label="Sort order"
            >
              {SORT_OPTIONS.map((s, i) => (
                <option key={i} value={i}>Sort: {s.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {/* Map toggle + Results count */}
      <div className="flex items-center justify-between mb-3">
        {pagination && !loading ? (
          <p className="text-sm text-gray-500">
            Showing {lines.length > 0 ? page * PAGE_SIZE + 1 : 0}
            {" "}-{" "}
            {Math.min((page + 1) * PAGE_SIZE, pagination.total)} of{" "}
            <span className="font-medium text-gray-700">{pagination.total.toLocaleString()}</span> lines
          </p>
        ) : <div />}
        <button
          onClick={() => setShowMap(!showMap)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            showMap
              ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          {showMap ? "Hide Map" : "Show Map"}
        </button>
      </div>

      {/* Transmission Map */}
      {showMap && (
        <div className="mb-6">
          {mapLoading ? (
            <div className="bg-gray-800 rounded-lg flex items-center justify-center text-gray-400" style={{ height: "500px" }}>
              Loading map data...
            </div>
          ) : (
            <TransmissionMap
              lines={mapLines}
              height="500px"
              boldLines
              onLineClick={(id) => { window.location.href = `/grid/line/?id=${id}`; }}
            />
          )}
          <p className="text-xs text-gray-400 mt-1">
            Showing up to 2,500 lines matching current filters. Purple = upgrade candidates (50-100 MW). Blue = other lines.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
          Failed to load lines: {error}
        </div>
      )}

      {/* Results table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-gray-500 uppercase">Voltage (kV)</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-gray-500 uppercase">Capacity (MW)</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Route</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-center py-3 px-3 text-xs font-medium text-gray-500 uppercase">Upgrade?</th>
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
              ) : lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No transmission lines found matching your filters.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr
                    key={line.id}
                    className="border-b border-gray-100 hover:bg-purple-50 transition-colors cursor-pointer"
                    onClick={() => { window.location.href = `/grid/line/?id=${line.id}`; }}
                  >
                    <td className="py-2.5 px-3 font-mono text-gray-700">{line.state || "--"}</td>
                    <td className="py-2.5 px-3 text-right text-gray-700">
                      {line.voltage_kv != null ? line.voltage_kv.toFixed(0) : "--"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-700">
                      {line.estimated_capacity_mva != null
                        ? `${line.estimated_capacity_mva} MVA`
                        : line.capacity_mw != null ? `${line.capacity_mw.toFixed(1)} MW` : "--"}
                    </td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-48 truncate" title={line.owner || ""}>
                      {line.owner || "--"}
                    </td>
                    <td className="py-2.5 px-3 max-w-56 truncate" title={`${line.sub_1 || "?"} → ${line.sub_2 || "?"}`}>
                      <a href={`/grid/line/?id=${line.id}`} className="text-purple-600 hover:underline">
                        {line.sub_1 || "?"} <span className="text-gray-400 mx-1">&rarr;</span> {line.sub_2 || "?"}
                      </a>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        line.status === "IN SERVICE"
                          ? "bg-green-100 text-green-700"
                          : line.status === "PROPOSED" || line.status === "UNDER CONSTRUCTION"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-600"
                      }`}>
                        {line.status || "--"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {line.upgrade_candidate ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-600" title="Upgrade candidate (50-100 MW)">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      ) : (
                        <span className="text-gray-300">--</span>
                      )}
                    </td>
                  </tr>
                ))
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
            <div className="flex items-center gap-1">
              {generatePageNumbers(page, totalPages).map((p, i) =>
                p === -1 ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-gray-400">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                      p === page
                        ? "bg-purple-600 text-white font-medium"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {p + 1}
                  </button>
                )
              )}
            </div>
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

// Generate smart page number array with ellipsis
function generatePageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);

  const pages: number[] = [];
  // Always show first page
  pages.push(0);

  if (current > 2) pages.push(-1); // ellipsis

  // Window around current page
  for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) {
    pages.push(i);
  }

  if (current < total - 3) pages.push(-1); // ellipsis

  // Always show last page
  pages.push(total - 1);

  return pages;
}

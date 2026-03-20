"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { withDemoToken } from "@/lib/demoAccess";
import LocationFilter from "@/components/LocationFilter";

const ResultsMap = dynamic(() => import("@/components/ResultsMap"), { ssr: false });

interface Brownfield {
  id: string;
  name: string;
  site_type: string;
  former_use: string;
  state: string;
  county: string;
  city: string;
  latitude: number;
  longitude: number;
  acreage: number;
  existing_capacity_mw: number;
  retirement_date: string;
  cleanup_status: string;
  nearest_substation_id: string;
  nearest_substation_distance_km: number;
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY"
];

export default function BrownfieldsPage() {
  const [sites, setSites] = useState<Brownfield[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [hasSubstation, setHasSubstation] = useState("");
  const [sortBy, setSortBy] = useState("existing_capacity_mw");
  const [sortOrder, setSortOrder] = useState("desc");
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoRadius, setGeoRadius] = useState<number>(50);
  const [showMap, setShowMap] = useState(false);

  const pageSize = 50;

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    if (stateFilter) params.set("state", stateFilter);
    if (search) params.set("search", search);
    if (hasSubstation) params.set("has_substation", hasSubstation);
    if (geoLat !== null && geoLng !== null) {
      params.set("near_lat", String(geoLat));
      params.set("near_lng", String(geoLng));
      params.set("radius_miles", String(geoRadius));
    }
    params.set("sort", sortBy);
    params.set("order", sortOrder);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));

    fetch(withDemoToken(`${baseUrl}/api/grid/brownfields?${params}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSites(data.data || []);
        setTotal(data.pagination?.total || 0);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [stateFilter, search, hasSubstation, sortBy, sortOrder, page, geoLat, geoLng, geoRadius]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Retired Power Plants &amp; Industrial Sites</h1>
          <p className="text-gray-600 text-sm">
            {total > 0 ? `${total.toLocaleString()} decommissioned power plants with existing grid connections` : "Loading..."}
          </p>
        </div>
        <button
          onClick={() => setShowMap(!showMap)}
          className={`px-4 py-2 text-sm rounded-lg border ${showMap ? "text-purple-700 border-purple-400 bg-purple-50" : "text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          {showMap ? "Hide Map" : "Show Map"}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Search name, use..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            aria-label="Search industrial sites by name or former use"
          />
          <select
            value={stateFilter}
            onChange={(e) => { setStateFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            aria-label="Filter by state"
          >
            <option value="">All States</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={hasSubstation}
            onChange={(e) => { setHasSubstation(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            aria-label="Filter by substation proximity"
          >
            <option value="">Substation Link</option>
            <option value="true">Has Nearby Substation</option>
            <option value="false">No Nearby Substation</option>
          </select>
          <button
            onClick={() => { setSearch(""); setStateFilter(""); setHasSubstation(""); setGeoLat(null); setGeoLng(null); setPage(0); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
          >
            Clear
          </button>
        </div>
        <div className="mt-3 max-w-md">
          <LocationFilter
            onLocationChange={(lat, lng, radius) => { setGeoLat(lat); setGeoLng(lng); setGeoRadius(radius); setPage(0); }}
            onClear={() => { setGeoLat(null); setGeoLng(null); }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
          Failed to load industrial sites: {error}
        </div>
      )}

      {/* Map view */}
      {showMap && (
        <div className="mb-6">
          <ResultsMap
            points={sites.filter(s => s.latitude && s.longitude).map(s => ({
              id: s.id,
              name: s.name,
              latitude: s.latitude,
              longitude: s.longitude,
              label: s.former_use ? `Retired ${s.former_use} plant` : s.state,
              href: `/grid/brownfield/?id=${s.id}`,
            }))}
            geoCenter={geoLat != null && geoLng != null ? { lat: geoLat, lng: geoLng, radius: geoRadius } : null}
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {[
                  { key: "name", label: "Site" },
                  { key: "state", label: "State" },
                  { key: "former_use", label: "Former Use" },
                  { key: "existing_capacity_mw", label: "Capacity" },
                  { key: "acreage", label: "Acres" },
                  { key: "retirement_date", label: "Retired" },
                  { key: "nearest_substation_distance_km", label: "Nearest Sub." },
                  { key: "cleanup_status", label: "Cleanup" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-purple-600"
                  >
                    {col.label}
                    {sortBy === col.key && <span className="ml-1">{sortOrder === "desc" ? "↓" : "↑"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : sites.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center">
                  <p className="text-gray-400 mb-2">No industrial sites found matching your filters.</p>
                  <p className="text-gray-400 text-xs">Try adjusting your search criteria or clearing filters.</p>
                </td></tr>
              ) : (
                sites.map((site) => (
                  <tr
                    key={site.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => window.location.href = `/grid/brownfield/?id=${site.id}`}
                  >
                    <td className="py-2 px-3">
                      <a href={`/grid/brownfield/?id=${site.id}`} className="text-purple-600 hover:underline font-medium">
                        {site.name}
                      </a>
                      {site.city && <span className="text-xs text-gray-400 ml-1">{site.city}</span>}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{site.state}</td>
                    <td className="py-2 px-3 text-gray-600 text-xs capitalize">
                      {site.former_use ? `Retired ${site.former_use} plant` : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {site.existing_capacity_mw ? `${site.existing_capacity_mw} MW` : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{site.acreage || "—"}</td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{site.retirement_date || "—"}</td>
                    <td className="py-2 px-3 text-gray-600">
                      {site.nearest_substation_distance_km != null
                        ? `${(site.nearest_substation_distance_km * 0.621371).toFixed(1)} mi`
                        : "—"}
                    </td>
                    <td className="py-2 px-3">
                      {site.cleanup_status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          site.cleanup_status === "completed" ? "bg-green-100 text-green-700" :
                          site.cleanup_status === "in_progress" ? "bg-yellow-100 text-yellow-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {site.cleanup_status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-500">
              Page {page + 1} of {totalPages} ({total.toLocaleString()} results)
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50">Prev</button>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

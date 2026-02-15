"use client";

import { useEffect, useState, useCallback } from "react";
import type { Installer, Pagination } from "@/types/solar";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export default function InstallersPage() {
  const [results, setResults] = useState<Installer[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    name: "",
    state: "",
    min_installations: "",
    sort: "installation_count",
  });
  const [page, setPage] = useState(1);

  const search = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: "50",
      });
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });

      try {
        const res = await fetch(`${API_BASE}/installers?${params}`);
        const data = await res.json();
        setResults(data.data || []);
        setPagination(data.pagination);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    search(page);
  }, [page, search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    search(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Installer Directory</h1>
        <p className="text-gray-500 mt-1">
          Browse solar installers with portfolio stats and installation history
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company Name
            </label>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
              placeholder="Search installers..."
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Installations
            </label>
            <input
              type="number"
              value={filters.min_installations}
              onChange={(e) =>
                setFilters({ ...filters, min_installations: e.target.value })
              }
              placeholder="e.g. 5"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
            <select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="installation_count">Installation Count</option>
              <option value="total_capacity_kw">Total Capacity</option>
              <option value="name">Name (A-Z)</option>
              <option value="last_seen">Most Recent</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              Search
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading installers...</div>
      ) : (
        <>
          {pagination && (
            <div className="text-sm text-gray-500">
              {pagination.total.toLocaleString()} installers found
            </div>
          )}

          <div className="grid gap-4">
            {results.map((inst) => {
              const capacity = inst.total_capacity_kw
                ? inst.total_capacity_kw >= 1000
                  ? `${(inst.total_capacity_kw / 1000).toFixed(1)} MW`
                  : `${Math.round(inst.total_capacity_kw)} kW`
                : null;
              const years = inst.first_seen && inst.last_seen
                ? `${inst.first_seen.substring(0, 4)}\u2013${inst.last_seen.substring(0, 4)}`
                : inst.last_seen
                ? inst.last_seen.substring(0, 4)
                : null;

              return (
                <div key={inst.id} className="bg-white rounded-lg shadow p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-lg truncate">{inst.name}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                        {(inst.city || inst.state) && (
                          <span>{[inst.city, inst.state].filter(Boolean).join(", ")}</span>
                        )}
                        {inst.phone && <span>{inst.phone}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {inst.website && (
                          <a
                            href={inst.website.startsWith("http") ? inst.website : `https://${inst.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Website
                          </a>
                        )}
                        <a
                          href={`/solar/search/?installer=${encodeURIComponent(inst.name)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          View Installations
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-4 shrink-0 text-center">
                      <div>
                        <div className="text-2xl font-bold text-gray-900">
                          {inst.installation_count.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500 uppercase">installs</div>
                      </div>
                      {capacity && (
                        <div>
                          <div className="text-2xl font-bold text-gray-900">{capacity}</div>
                          <div className="text-xs text-gray-500 uppercase">capacity</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {years && (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                      Active {years}
                    </div>
                  )}
                </div>
              );
            })}
            {results.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No installers found. Try adjusting your search.
              </div>
            )}
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
                onClick={() => setPage((p) => Math.min(pagination!.totalPages, p + 1))}
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

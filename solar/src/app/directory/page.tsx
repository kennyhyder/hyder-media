"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import EntityBadge from "@/components/EntityBadge";
import type { DirectoryEntity, Pagination } from "@/types/solar";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "installer", label: "Installers" },
  { value: "owner", label: "Owners" },
  { value: "developer", label: "Developers" },
  { value: "operator", label: "Operators" },
  { value: "manufacturer", label: "Manufacturers" },
];

function DirectoryContent() {
  const searchParams = useSearchParams();
  const [results, setResults] = useState<DirectoryEntity[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    type: searchParams.get("type") || "all",
    name: searchParams.get("name") || "",
    state: searchParams.get("state") || "",
    sort: searchParams.get("sort") || "site_count",
    min_sites: searchParams.get("min_sites") || "",
  });
  const [page, setPage] = useState(1);

  const search = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(pageNum), limit: "50" });
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      try {
        const res = await fetch(`${API_BASE}/directory?${params}`);
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

  const setType = (type: string) => {
    setFilters({ ...filters, type });
    setPage(1);
  };

  const formatCapacity = (mw: number) => {
    if (!mw) return null;
    if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
    if (mw >= 1) return `${mw.toFixed(1)} MW`;
    return `${Math.round(mw * 1000)} kW`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Business Directory</h1>
        <p className="text-gray-500 mt-1">
          Browse installers, owners, developers, operators, and equipment manufacturers
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
              placeholder="Search by name..."
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
            <select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="site_count">Most Sites</option>
              <option value="capacity">Largest Capacity</option>
              <option value="name">Name (A-Z)</option>
              <option value="recent">Most Recent</option>
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

      {/* Type pills */}
      <div className="flex flex-wrap gap-2">
        {TYPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setType(o.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
              filters.type === o.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border hover:bg-gray-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading directory...</div>
      ) : (
        <>
          {pagination && (
            <div className="text-sm text-gray-500">
              {pagination.total.toLocaleString()} entities found
            </div>
          )}

          <div className="grid gap-4">
            {results.map((entity, i) => {
              const capacity = formatCapacity(entity.capacity_mw);
              const profileLink = entity.id
                ? `/solar/company/?id=${entity.id}&role=${entity.role}`
                : `/solar/company/?name=${encodeURIComponent(entity.name)}&role=${entity.role}`;

              return (
                <div key={`${entity.role}-${entity.id || entity.name}-${i}`} className="bg-white rounded-lg shadow p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg truncate">
                          <a href={profileLink} className="hover:text-blue-600">
                            {entity.name}
                          </a>
                        </h3>
                        <EntityBadge role={entity.role} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                        {(entity.city || entity.state) && (
                          <span>{[entity.city, entity.state].filter(Boolean).join(", ")}</span>
                        )}
                        {entity.phone && <span>{entity.phone}</span>}
                        {entity.equipment_types && (
                          <span className="text-gray-400">
                            {entity.equipment_types.join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {entity.website && (
                          <a
                            href={entity.website.startsWith("http") ? entity.website : `https://${entity.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition"
                          >
                            Website
                          </a>
                        )}
                        <a
                          href={profileLink}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                        >
                          View Profile
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-4 shrink-0 text-center">
                      <div>
                        <div className="text-2xl font-bold text-gray-900">
                          {entity.site_count.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500 uppercase">sites</div>
                      </div>
                      {capacity && (
                        <div>
                          <div className="text-2xl font-bold text-gray-900">{capacity}</div>
                          <div className="text-xs text-gray-500 uppercase">capacity</div>
                        </div>
                      )}
                      {entity.equipment_count && (
                        <div>
                          <div className="text-2xl font-bold text-gray-900">
                            {entity.equipment_count.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500 uppercase">equipment</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {results.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No entities found. Try adjusting your search.
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

export default function DirectoryPage() {
  return (
    <Suspense fallback={<div className="text-gray-500 py-12 text-center">Loading directory...</div>}>
      <DirectoryContent />
    </Suspense>
  );
}

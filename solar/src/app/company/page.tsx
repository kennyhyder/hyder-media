"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import EntityBadge from "@/components/EntityBadge";
import StarRating from "@/components/StarRating";
import type { CompanyProfile } from "@/types/solar";
import { isDemoMode, withDemoToken } from "@/lib/demoAccess";
import DemoBanner from "@/components/DemoBanner";
import DemoContactModal from "@/components/DemoContactModal";
import LoadingSpinner from "@/components/LoadingSpinner";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

type InstSortKey = "name" | "location" | "type" | "capacity" | "date";
type SortDir = "asc" | "desc";

function SortHeader({ label, sortKey, currentSort, currentDir, onSort, align }: {
  label: string;
  sortKey: InstSortKey;
  currentSort: InstSortKey;
  currentDir: SortDir;
  onSort: (key: InstSortKey) => void;
  align?: "right";
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} pb-2 pr-4 font-medium text-gray-500 cursor-pointer hover:text-gray-900 select-none`}
      onClick={() => onSort(sortKey)}
    >
      {label}{" "}
      <span className={active ? "text-blue-600" : "text-gray-300"}>
        {active ? (currentDir === "asc" ? "\u25B2" : "\u25BC") : "\u25B4"}
      </span>
    </th>
  );
}

function CompanyContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const name = searchParams.get("name");
  const role = searchParams.get("role") || "installer";
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Installations table state
  const [sortKey, setSortKey] = useState<InstSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterState, setFilterState] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterText, setFilterText] = useState("");
  const [showContactModal, setShowContactModal] = useState(false);
  const isDemo = isDemoMode();

  useEffect(() => {
    if (!id && !name) return;
    const params = new URLSearchParams();
    if (id) params.set("id", id);
    if (name) params.set("name", name);
    params.set("role", role);

    fetch(withDemoToken(`${API_BASE}/company?${params}`))
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompany(data.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, name, role]);

  // Compute filtered + sorted installations
  const filteredInstallations = useMemo(() => {
    if (!company) return [];
    let list = [...company.installations];

    // Apply filters (only for non-demo)
    if (!isDemo) {
      if (filterState) list = list.filter(i => i.state === filterState);
      if (filterType) list = list.filter(i => i.site_type === filterType);
      if (filterText) {
        const q = filterText.toLowerCase();
        list = list.filter(i =>
          (i.site_name || "").toLowerCase().includes(q) ||
          (i.city || "").toLowerCase().includes(q)
        );
      }
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = (a.site_name || "").localeCompare(b.site_name || "");
          break;
        case "location":
          cmp = (a.state || "").localeCompare(b.state || "") || (a.city || "").localeCompare(b.city || "");
          break;
        case "type":
          cmp = (a.site_type || "").localeCompare(b.site_type || "");
          break;
        case "capacity":
          cmp = (Number(a.capacity_mw) || 0) - (Number(b.capacity_mw) || 0);
          break;
        case "date":
          cmp = (a.install_date || "").localeCompare(b.install_date || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [company, sortKey, sortDir, filterState, filterType, filterText, isDemo]);

  // Get unique states and types for filter dropdowns
  const uniqueStates = useMemo(() => {
    if (!company) return [];
    const s = new Set(company.installations.map(i => i.state).filter(Boolean));
    return [...s].sort() as string[];
  }, [company]);

  const uniqueTypes = useMemo(() => {
    if (!company) return [];
    const t = new Set(company.installations.map(i => i.site_type).filter(Boolean));
    return [...t].sort() as string[];
  }, [company]);

  const handleSort = (key: InstSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "capacity" ? "desc" : "asc");
    }
  };

  if (!id && !name) return <div className="text-gray-500">No entity ID or name provided</div>;
  if (loading) return <LoadingSpinner text="Loading profile..." />;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!company) return <div className="text-gray-500">Entity not found</div>;

  const maxStateCount = company.states[0]?.count || 1;
  const maxTimelineCount = Math.max(...(company.timeline.map(t => t.count) || [1]), 1);
  const yearsActive = company.timeline.length > 0
    ? `${company.timeline[0].year}\u2013${company.timeline[company.timeline.length - 1].year}`
    : null;

  const formatCapacity = (mw: number) => {
    if (!mw) return "0";
    if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
    if (mw >= 1) return `${mw.toFixed(1)} MW`;
    return `${Math.round(mw * 1000)} kW`;
  };

  return (
    <div className="space-y-6">
      <DemoBanner />
      {showContactModal && <DemoContactModal onClose={() => setShowContactModal(false)} />}

      {/* Breadcrumb */}
      <div className="text-sm">
        <a href="/solar/directory/" className="text-blue-600 hover:underline">Directory</a>
        <span className="text-gray-400 mx-2">/</span>
        <span className="text-gray-600">{company.name}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{company.name}</h1>
              <EntityBadge role={company.role} />
              {Object.entries(company.cross_roles || {}).map(([r]) => (
                <EntityBadge key={r} role={r} />
              ))}
              {company.business_status && company.business_status !== "OPERATIONAL" && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                  {company.business_status.replace(/_/g, " ")}
                </span>
              )}
            </div>
            {company.rating && (
              <div className="mt-2">
                <StarRating rating={company.rating} count={company.review_count} />
              </div>
            )}
            {company.description && (
              <p className="mt-2 text-sm text-gray-600 max-w-2xl">{company.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
              {(company.city || company.state) && (
                <span>{[company.city, company.state].filter(Boolean).join(", ")}</span>
              )}
              {company.phone && (
                <a href={`tel:${company.phone}`} className="hover:text-blue-600">{company.phone}</a>
              )}
              {company.license_number && <span>License: {company.license_number}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {company.website && (
                <a
                  href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Visit Website
                </a>
              )}
              {company.phone && (
                <a
                  href={`tel:${company.phone}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Call
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 uppercase tracking-wide">
            {company.role === "manufacturer" ? "Equipment Records" : "Installations"}
          </div>
          <div className="text-3xl font-bold mt-1">{company.site_count.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Total Capacity</div>
          <div className="text-3xl font-bold mt-1">{formatCapacity(company.capacity_mw)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Equipment Records</div>
          <div className="text-3xl font-bold mt-1">
            {company.top_equipment.reduce((sum, e) => sum + e.count, 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Years Active</div>
          <div className="text-3xl font-bold mt-1">{yearsActive || "N/A"}</div>
        </div>
      </div>

      {/* Portfolio Analytics */}
      {(company.avg_project_size_kw || company.primary_equipment_brands || company.geographic_focus || company.project_type_distribution) && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Portfolio Analytics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {company.avg_project_size_kw && (
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Avg Project Size</div>
                <div className="text-2xl font-bold mt-1">
                  {company.avg_project_size_kw >= 1000
                    ? `${(company.avg_project_size_kw / 1000).toFixed(1)} MW`
                    : `${Math.round(company.avg_project_size_kw)} kW`}
                </div>
              </div>
            )}
            {company.geographic_focus && company.geographic_focus.length > 0 && (
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Geographic Focus</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {company.geographic_focus.map((s) => (
                    <span key={s} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm font-medium">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {company.primary_equipment_brands && company.primary_equipment_brands.length > 0 && (
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Top Equipment Brands</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {company.primary_equipment_brands.map((b) => (
                    <a
                      key={b}
                      href={`/solar/company/?name=${encodeURIComponent(b)}&role=manufacturer`}
                      className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200"
                    >
                      {b}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {company.project_type_distribution && Object.keys(company.project_type_distribution).length > 0 && (
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Project Types</div>
                <div className="space-y-1 mt-2">
                  {Object.entries(company.project_type_distribution)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, pct]) => (
                      <div key={type} className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              type === "utility" ? "bg-blue-500" : type === "community" ? "bg-purple-500" : "bg-green-500"
                            }`}
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 w-20 capitalize">{type} {Math.round(pct * 100)}%</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cross-roles */}
      {Object.keys(company.cross_roles || {}).length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-3">Also Appears As</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(company.cross_roles).map(([r, count]) => (
              <div key={r} className="flex items-center gap-2">
                <EntityBadge role={r} />
                <span className="text-sm text-gray-600">
                  on {Number(count).toLocaleString()} site{Number(count) !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* State distribution + Activity timeline */}
      <div className="grid md:grid-cols-2 gap-6">
        {company.states.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">State Distribution</h2>
            <div className="space-y-2">
              {company.states.slice(0, 12).map((s) => (
                <div key={s.state} className="flex items-center gap-3">
                  <span className="w-8 text-sm font-bold text-gray-600">{s.state}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${(s.count / maxStateCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono w-16 text-right">{s.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {company.timeline.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
            <div className="space-y-1">
              {company.timeline.map((t) => (
                <div key={t.year} className="flex items-center gap-3">
                  <span className="w-12 text-sm text-gray-600">{t.year}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-green-500 h-full rounded-full"
                      style={{ width: `${(t.count / maxTimelineCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono w-12 text-right">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top equipment */}
      {company.top_equipment.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            {company.role === "manufacturer" ? "Top Models" : "Top Equipment Brands"}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">{company.role === "manufacturer" ? "Model" : "Brand"}</th>
                  {company.role === "manufacturer" && <th className="pb-2 pr-4">Type</th>}
                  <th className="pb-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {company.top_equipment.map((eq, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {company.role === "manufacturer" ? (
                        eq.name || <span className="text-gray-300">Unknown</span>
                      ) : (
                        <a
                          href={`/solar/company/?name=${encodeURIComponent(eq.name)}&role=manufacturer`}
                          className="text-blue-600 hover:underline"
                        >
                          {eq.name}
                        </a>
                      )}
                    </td>
                    {company.role === "manufacturer" && (
                      <td className="py-2 pr-4 capitalize text-gray-500">{eq.type || "-"}</td>
                    )}
                    <td className="py-2 text-right font-mono">{eq.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Installations table with sort + filter */}
      {company.installations.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Installations ({filteredInstallations.length}{filterState || filterType || filterText ? ` of ${company.installations.length}` : ""})
            </h2>
            {company.role !== "manufacturer" && company.id && (
              <a
                href={`/solar/search/?${company.role === "installer" ? "installer" : company.role === "owner" ? "owner" : "q"}=${encodeURIComponent(company.name)}`}
                className="text-sm text-blue-600 hover:underline"
              >
                View all {company.site_count.toLocaleString()} &rarr;
              </a>
            )}
          </div>

          {/* Filters (hidden for demo users) */}
          {!isDemo ? (
            <div className="flex flex-wrap gap-3 mb-4">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Search by name or city..."
                className="border rounded-md px-3 py-1.5 text-sm w-48"
              />
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm"
              >
                <option value="">All States</option>
                {uniqueStates.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm"
              >
                <option value="">All Types</option>
                {uniqueTypes.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              {(filterState || filterType || filterText) && (
                <button
                  onClick={() => { setFilterState(""); setFilterType(""); setFilterText(""); }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-4 text-sm text-amber-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <button onClick={() => setShowContactModal(true)} className="underline hover:text-amber-700">
                Filters available with full access
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <SortHeader label="Name" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Location" sortKey="location" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Type" sortKey="type" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Capacity" sortKey="capacity" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Date" sortKey="date" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filteredInstallations.map((inst) => (
                  <tr key={inst.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <a href={`/solar/site/?id=${inst.id}`} className="text-blue-600 hover:underline">
                        {inst.site_name || "Unknown"}
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {[inst.city, inst.state].filter(Boolean).join(", ") || "-"}
                    </td>
                    <td className="py-2 pr-4 capitalize">{inst.site_type}</td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {inst.capacity_mw ? `${Number(inst.capacity_mw).toFixed(1)} MW` : "-"}
                    </td>
                    <td className="py-2 text-gray-500">{inst.install_date?.substring(0, 4) || "-"}</td>
                  </tr>
                ))}
                {filteredInstallations.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      No installations match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompanyPage() {
  return (
    <Suspense fallback={<LoadingSpinner text="Loading profile..." />}>
      <CompanyContent />
    </Suspense>
  );
}

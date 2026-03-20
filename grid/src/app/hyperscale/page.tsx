"use client";

import { useEffect, useState } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface HyperscaleDC {
  id: string;
  name: string;
  operator: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  capacity_mw: number | null;
  sqft: number | null;
  year_built: number | null;
  status: string;
}

interface OperatorBreakdown {
  operator: string;
  count: number;
  capacity_mw: number;
}

interface StateBreakdown {
  state: string;
  count: number;
  capacity_mw: number;
}

interface HyperscaleStats {
  total_projects: number;
  total_capacity_mw: number;
  total_capacity_gw: number;
  status: {
    operational: number;
    under_construction: number;
    announced: number;
  };
}

interface HyperscaleData {
  data: HyperscaleDC[];
  stats: HyperscaleStats;
  operatorBreakdown: OperatorBreakdown[];
  stateBreakdown: StateBreakdown[];
}

type SortField = "operator" | "name" | "capacity_mw" | "state" | "status" | "year_built";

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  operational: { label: "Operational", bg: "bg-green-100", text: "text-green-700" },
  under_construction: { label: "Under Construction", bg: "bg-yellow-100", text: "text-yellow-700" },
  announced: { label: "Announced", bg: "bg-blue-100", text: "text-blue-700" },
  planned: { label: "Planned", bg: "bg-blue-100", text: "text-blue-700" },
};

const OPERATOR_COLORS: Record<string, string> = {
  Microsoft: "#00a4ef",
  Google: "#4285f4",
  Meta: "#0668e1",
  Amazon: "#ff9900",
  xAI: "#1a1a1a",
  CoreWeave: "#6d28d9",
  Oracle: "#c74634",
  Apple: "#555555",
  Crusoe: "#059669",
  "OpenAI / Oracle": "#10b981",
  "Anthropic / Amazon": "#d97706",
  Fluidstack: "#8b5cf6",
  QTS: "#0ea5e9",
  Coreweave: "#6d28d9",
};

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtMW(n: number | null): string {
  if (n == null) return "--";
  return `${fmt(Math.round(n))} MW`;
}

export default function HyperscalePage() {
  const [data, setData] = useState<HyperscaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("capacity_mw");
  const [sortAsc, setSortAsc] = useState(false);
  const [filterOperator, setFilterOperator] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    const baseUrl = window.location.origin;
    fetch(withDemoToken(`${baseUrl}/api/grid/hyperscale`))
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Hyperscale Deployments</h1>
        <p className="text-gray-600 mb-8">Loading hyperscale datacenter data...</p>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded-lg" />
          <div className="h-96 bg-gray-200 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, operatorBreakdown, stateBreakdown } = data;
  const maxOperatorMW = operatorBreakdown[0]?.capacity_mw || 1;
  const maxStateMW = stateBreakdown[0]?.capacity_mw || 1;

  // Filter and sort records
  let filtered = [...data.data];
  if (filterOperator) {
    filtered = filtered.filter((dc) => dc.operator === filterOperator);
  }
  if (filterStatus) {
    filtered = filtered.filter((dc) => dc.status === filterStatus);
  }

  filtered.sort((a, b) => {
    let av: string | number | null, bv: string | number | null;
    switch (sortField) {
      case "operator":
        av = (a.operator || "").toLowerCase();
        bv = (b.operator || "").toLowerCase();
        break;
      case "name":
        av = (a.name || "").toLowerCase();
        bv = (b.name || "").toLowerCase();
        break;
      case "capacity_mw":
        av = a.capacity_mw ?? -1;
        bv = b.capacity_mw ?? -1;
        break;
      case "state":
        av = a.state || "";
        bv = b.state || "";
        break;
      case "status":
        av = a.status || "";
        bv = b.status || "";
        break;
      case "year_built":
        av = a.year_built ?? 9999;
        bv = b.year_built ?? 9999;
        break;
      default:
        av = a.capacity_mw ?? -1;
        bv = b.capacity_mw ?? -1;
    }
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : 1;
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "operator" || field === "name" || field === "state");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-300 ml-1">&#8597;</span>;
    return <span className="text-purple-600 ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>;
  };

  const uniqueOperators = [...new Set(data.data.map((dc) => dc.operator))].sort();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Hyperscale Deployments</h1>
        <p className="text-gray-600">
          Tracking frontier AI and cloud datacenter construction across the United States.
          Data sourced from Epoch AI satellite monitoring and public announcements.
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Projects"
          value={fmt(stats.total_projects)}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
        <StatCard
          label="Planned Capacity"
          value={`${stats.total_capacity_gw} GW`}
          subtext={`${fmt(stats.total_capacity_mw)} MW`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="Under Construction"
          value={fmt(stats.status.under_construction)}
          color="text-yellow-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          }
        />
        <StatCard
          label="Operational"
          value={fmt(stats.status.operational)}
          color="text-green-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Two-column: Operator breakdown + State breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Operator Breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">By Operator</h2>
          <p className="text-sm text-gray-500 mb-4">Total planned capacity per hyperscale operator</p>
          <div className="space-y-3">
            {operatorBreakdown.map((op) => (
              <div key={op.operator} className="group">
                <div className="flex items-center justify-between mb-1">
                  <button
                    onClick={() => setFilterOperator(filterOperator === op.operator ? "" : op.operator)}
                    className={`text-sm font-medium hover:text-purple-600 transition-colors ${
                      filterOperator === op.operator ? "text-purple-600 underline" : "text-gray-800"
                    }`}
                  >
                    {op.operator}
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{op.count} project{op.count !== 1 ? "s" : ""}</span>
                    <span className="text-sm font-bold text-gray-900">{fmtMW(op.capacity_mw)}</span>
                  </div>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(op.capacity_mw / maxOperatorMW) * 100}%`,
                      backgroundColor: OPERATOR_COLORS[op.operator] || "#7c3aed",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* State Breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">By State</h2>
          <p className="text-sm text-gray-500 mb-4">Hyperscale capacity by state (MW)</p>
          <div className="space-y-3">
            {stateBreakdown.slice(0, 15).map((st) => (
              <div key={st.state}>
                <div className="flex items-center justify-between mb-1">
                  <a
                    href={`/grid/sites/?state=${st.state}`}
                    className="text-sm font-medium text-purple-600 hover:text-purple-800 hover:underline"
                  >
                    {st.state}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{st.count} project{st.count !== 1 ? "s" : ""}</span>
                    <span className="text-sm font-bold text-gray-900">{fmtMW(st.capacity_mw)}</span>
                  </div>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${(st.capacity_mw / maxStateMW) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {stateBreakdown.length > 15 && (
              <p className="text-xs text-gray-400 pt-1">
                + {stateBreakdown.length - 15} more state{stateBreakdown.length - 15 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Status overview strip */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Status</h2>
        <div className="flex rounded-lg overflow-hidden h-8 mb-3">
          {stats.status.operational > 0 && (
            <div
              className="bg-green-500 flex items-center justify-center text-white text-xs font-semibold"
              style={{ width: `${(stats.status.operational / stats.total_projects) * 100}%` }}
              title={`${stats.status.operational} operational`}
            >
              {stats.status.operational}
            </div>
          )}
          {stats.status.under_construction > 0 && (
            <div
              className="bg-yellow-400 flex items-center justify-center text-yellow-900 text-xs font-semibold"
              style={{ width: `${(stats.status.under_construction / stats.total_projects) * 100}%` }}
              title={`${stats.status.under_construction} under construction`}
            >
              {stats.status.under_construction}
            </div>
          )}
          {stats.status.announced > 0 && (
            <div
              className="bg-blue-400 flex items-center justify-center text-white text-xs font-semibold"
              style={{ width: `${(stats.status.announced / stats.total_projects) * 100}%` }}
              title={`${stats.status.announced} announced/planned`}
            >
              {stats.status.announced}
            </div>
          )}
        </div>
        <div className="flex gap-6 text-sm">
          <button
            onClick={() => setFilterStatus(filterStatus === "operational" ? "" : "operational")}
            className={`flex items-center gap-2 ${filterStatus === "operational" ? "font-bold" : ""}`}
          >
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-gray-600">Operational ({stats.status.operational})</span>
          </button>
          <button
            onClick={() => setFilterStatus(filterStatus === "under_construction" ? "" : "under_construction")}
            className={`flex items-center gap-2 ${filterStatus === "under_construction" ? "font-bold" : ""}`}
          >
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <span className="text-gray-600">Under Construction ({stats.status.under_construction})</span>
          </button>
          <button
            onClick={() => setFilterStatus(filterStatus === "announced" ? "" : "announced")}
            className={`flex items-center gap-2 ${filterStatus === "announced" ? "font-bold" : ""}`}
          >
            <div className="w-3 h-3 rounded-full bg-blue-400" />
            <span className="text-gray-600">Announced ({stats.status.announced})</span>
          </button>
        </div>
      </div>

      {/* Project table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">All Projects</h2>
            <p className="text-sm text-gray-500">
              {filtered.length === data.data.length
                ? `${fmt(filtered.length)} hyperscale datacenters`
                : `${fmt(filtered.length)} of ${fmt(data.data.length)} projects`}
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={filterOperator}
              onChange={(e) => setFilterOperator(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-700"
            >
              <option value="">All Operators</option>
              {uniqueOperators.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-700"
            >
              <option value="">All Status</option>
              <option value="operational">Operational</option>
              <option value="under_construction">Under Construction</option>
              <option value="announced">Announced</option>
            </select>
            {(filterOperator || filterStatus) && (
              <button
                onClick={() => { setFilterOperator(""); setFilterStatus(""); }}
                className="text-sm text-purple-600 hover:text-purple-800 px-2"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <ThSort field="operator" current={sortField} asc={sortAsc} onSort={handleSort}>Operator</ThSort>
                <ThSort field="name" current={sortField} asc={sortAsc} onSort={handleSort}>Project</ThSort>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Location</th>
                <ThSort field="capacity_mw" current={sortField} asc={sortAsc} onSort={handleSort} align="right">Capacity</ThSort>
                <ThSort field="status" current={sortField} asc={sortAsc} onSort={handleSort}>Status</ThSort>
                <ThSort field="year_built" current={sortField} asc={sortAsc} onSort={handleSort} align="right">Year</ThSort>
              </tr>
            </thead>
            <tbody>
              {filtered.map((dc) => {
                const statusCfg = STATUS_CONFIG[dc.status] || STATUS_CONFIG.announced;
                return (
                  <tr key={dc.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: OPERATOR_COLORS[dc.operator] || "#7c3aed" }}
                        />
                        <span className="font-medium text-gray-900">{dc.operator}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-[240px] truncate" title={dc.name}>
                      {dc.name}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                      {dc.city ? `${dc.city}, ` : ""}{dc.state}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                      {dc.capacity_mw ? `${fmt(Math.round(Number(dc.capacity_mw)))}` : "--"}
                      {dc.capacity_mw && <span className="text-gray-400 font-normal ml-1">MW</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-600">
                      {dc.year_built || "--"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No projects match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer with capacity sum */}
        {filtered.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center text-sm text-gray-500">
            <span>{fmt(filtered.length)} project{filtered.length !== 1 ? "s" : ""}</span>
            <span className="font-semibold text-gray-700">
              Total: {fmtMW(filtered.reduce((sum, dc) => sum + (Number(dc.capacity_mw) || 0), 0))}
            </span>
          </div>
        )}
      </div>

      {/* Data source note */}
      <div className="mt-6 text-xs text-gray-400">
        Data sourced from{" "}
        <a
          href="https://epoch.ai/data/data_centers"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-500 hover:underline"
        >
          Epoch AI Data Center Tracker
        </a>{" "}
        and public announcements. Capacity figures represent planned or total campus power.
        Last updated March 2026.
      </div>
    </div>
  );
}

/* ─── Subcomponents ─── */

function StatCard({
  label,
  value,
  subtext,
  color,
  icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-purple-500">{icon}</div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color || "text-gray-900"}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-0.5">{subtext}</div>}
    </div>
  );
}

function ThSort({
  field,
  current,
  asc,
  onSort,
  align,
  children,
}: {
  field: SortField;
  current: SortField;
  asc: boolean;
  onSort: (f: SortField) => void;
  align?: "right";
  children: React.ReactNode;
}) {
  const active = current === field;
  return (
    <th
      className={`py-2 px-3 text-xs font-medium uppercase cursor-pointer select-none hover:text-purple-600 transition-colors ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-purple-600" : "text-gray-500"}`}
      onClick={() => onSort(field)}
    >
      {children}
      {active ? (
        <span className="ml-1">{asc ? "\u25B2" : "\u25BC"}</span>
      ) : (
        <span className="text-gray-300 ml-1">&#8597;</span>
      )}
    </th>
  );
}

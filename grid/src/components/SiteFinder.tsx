"use client";

// "Size your build" site finder — Jon De Pena's Phase-1 ask: pick a target
// megawatt size (and optionally a state / site type) and get the candidate
// sites that can support it, ranked by DC Readiness. Drives the existing
// /api/grid/dc-sites endpoint (min_capacity + sort). Power capacity here is a
// screening estimate, not deliverable power.

import { useEffect, useState, useCallback } from "react";
import { STATES, siteTypeLabel } from "@/lib/geo";
import { fmtInt, fmtScore, scoreColor } from "@/lib/format";
import { regulatoryClimate, type Posture } from "@/lib/dc-policy";

const POSTURE_CLS: Record<Posture, string> = {
  favorable: "bg-green-100 text-green-800",
  moderate: "bg-amber-100 text-amber-800",
  restrictive: "bg-red-100 text-red-800",
};

interface FinderSite {
  id: string;
  path: string | null;
  name: string | null;
  state: string | null;
  county: string | null;
  site_type: string | null;
  dc_score: number | null;
  available_capacity_mw: number | null;
  iso_region: string | null;
}

const MW_TIERS: Array<{ label: string; value: string }> = [
  { label: "Any size", value: "" },
  { label: "≥ 25 MW", value: "25" },
  { label: "≥ 50 MW", value: "50" },
  { label: "≥ 150 MW", value: "150" },
  { label: "≥ 350 MW", value: "350" },
  { label: "≥ 500 MW", value: "500" },
  { label: "≥ 1 GW", value: "1000" },
  { label: "≥ 2 GW", value: "2000" },
];

const SITE_TYPES = [
  "brownfield", "greenfield", "industrial", "substation",
  "federal_excess", "mine", "shovel_ready", "military_brac",
];

function fmtMw(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)} GW` : `${fmtInt(n)} MW`;
}

export default function SiteFinder() {
  const [mw, setMw] = useState("350");
  const [state, setState] = useState("");
  const [siteType, setSiteType] = useState("");
  const [existing, setExisting] = useState(false);
  const [sites, setSites] = useState<FinderSite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const p = new URLSearchParams({ sort: "dc_score", order: "desc", limit: "50" });
    if (mw) p.set("min_capacity", mw);
    if (state) p.set("state", state);
    if (siteType) p.set("site_type", siteType);
    if (existing) p.set("existing", "true");
    fetch(`${window.location.origin}/api/grid/dc-sites?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setSites((d.data ?? []) as FinderSite[]);
        setTotal(d.pagination?.total ?? 0);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [mw, state, siteType, existing]);

  useEffect(() => { load(); }, [load]);

  const selCls =
    "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500";

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Target build size</span>
          <select className={selCls} value={mw} onChange={(e) => setMw(e.target.value)}>
            {MW_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">State</span>
          <select className={selCls} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Site type</span>
          <select className={selCls} value={siteType} onChange={(e) => setSiteType(e.target.value)}>
            <option value="">All types</option>
            {SITE_TYPES.map((t) => <option key={t} value={t}>{siteTypeLabel(t)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={existing}
            onChange={(e) => setExisting(e.target.checked)}
            className="h-4 w-4 accent-purple-600"
          />
          <span title="Retired-plant / substation sites with existing grid interconnection — the fastest speed to power">
            Existing interconnection <span className="text-gray-400">(fastest power)</span>
          </span>
        </label>
        <div className="ml-auto text-sm text-gray-500">
          {loading ? "Searching…" : `${fmtInt(total)} site${total === 1 ? "" : "s"} match`}
        </div>
      </div>

      {/* Results */}
      <div className="mt-4">
        {error ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Site search is temporarily unavailable. Please try again.
          </p>
        ) : loading && sites.length === 0 ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : sites.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No candidate sites match a build of this size with the current filters. Try a smaller
            target size or a different state.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="w-8 py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium text-right">Est. capacity</th>
                  <th className="py-2 pr-3 font-medium">Grid</th>
                  <th className="py-2 pr-3 font-medium">Regulatory</th>
                  <th className="py-2 font-medium text-right">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s, i) => (
                  <tr key={s.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-2 tabular-nums text-gray-400">{i + 1}</td>
                    <td className="py-2 pr-3">
                      {s.path ? (
                        <a href={s.path} className="font-medium text-purple-700 hover:underline">{s.name}</a>
                      ) : (
                        <span className="font-medium text-gray-900">{s.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {[s.county, s.state].filter(Boolean).join(", ")}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{s.site_type ? siteTypeLabel(s.site_type) : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-800">{fmtMw(s.available_capacity_mw)}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.iso_region ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {(() => {
                        const rc = regulatoryClimate(s.state, mw ? Number(mw) : null);
                        return (
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${POSTURE_CLS[rc.effective]}`}
                            title={rc.gated ?? rc.summary}
                          >
                            {rc.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2 text-right">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreColor(s.dc_score)}`}>
                        {fmtScore(s.dc_score)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Estimated capacity is a screening figure (power-availability proxy), not deliverable power —
        confirm with an interconnection study. Sites ranked by DC Readiness score.
      </p>
    </div>
  );
}

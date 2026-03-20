"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isDemoMode, withDemoToken } from "@/lib/demoAccess";

interface SiteData {
  site: Record<string, number | string | null>;
  county: Record<string, number | string | null> | null;
}

const SCORE_FACTORS = [
  { key: "score_power", label: "Power Availability", weight: "20%" },
  { key: "score_speed_to_power", label: "Speed to Power", weight: "15%" },
  { key: "score_fiber", label: "Fiber Connectivity", weight: "12%" },
  { key: "score_energy_cost", label: "Energy Cost", weight: "10%" },
  { key: "score_water", label: "Water Risk", weight: "8%" },
  { key: "score_hazard", label: "Natural Hazard", weight: "8%" },
  { key: "score_buildability", label: "Buildability", weight: "7%" },
  { key: "score_labor", label: "Labor Market", weight: "4%" },
  { key: "score_existing_dc", label: "DC Cluster", weight: "4%" },
  { key: "score_land", label: "Land / Acreage", weight: "3%" },
  { key: "score_construction_cost", label: "Construction Cost", weight: "3%" },
  { key: "score_gas_pipeline", label: "Gas Pipeline", weight: "2%" },
  { key: "score_tax", label: "Tax Incentive", weight: "2%" },
  { key: "score_climate", label: "Climate / Cooling", weight: "2%" },
];

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  if (score >= 30) return "text-orange-600";
  return "text-red-600";
}

function barColor(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  if (score >= 30) return "bg-orange-500";
  return "bg-red-500";
}

function typeBadge(type: string) {
  const cls =
    type === "brownfield"
      ? "bg-amber-100 text-amber-700"
      : type === "greenfield"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-blue-100 text-blue-700";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{type}</span>;
}

function kmToMi(km: number | string | null): string {
  if (km == null) return "—";
  return `${(Number(km) * 0.621371).toFixed(1)} mi`;
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-64 mb-4" /><div className="h-48 bg-gray-200 rounded" /></div>}>
      <CompareContent />
    </Suspense>
  );
}

function CompareContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") || "";
  const ids = idsParam.split(",").filter(Boolean).slice(0, 5);

  const [sites, setSites] = useState<SiteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    const baseUrl = window.location.origin;
    Promise.all(
      ids.map((id) =>
        fetch(withDemoToken(`${baseUrl}/api/grid/dc-site?id=${id}`))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => {
      setSites(results.filter(Boolean));
      setLoading(false);
    });
  }, [idsParam]);

  const handleRemove = (idx: number) => {
    const newIds = [...ids];
    newIds.splice(idx, 1);
    if (newIds.length === 0) {
      // Clear localStorage and go back
      localStorage.removeItem("gridscout_compare");
      window.location.href = "/grid/sites/";
    } else {
      window.location.href = `/grid/compare/?ids=${newIds.join(",")}`;
    }
  };

  const handleClearAll = () => {
    localStorage.removeItem("gridscout_compare");
    window.location.href = "/grid/sites/";
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShareLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  };

  const handleExportCSV = () => {
    if (sites.length === 0) return;
    const siteRecs = sites.map((d) => d.site as Record<string, number | string | null>);
    const countyRecs = sites.map((d) => d.county as Record<string, number | string | null> | null);
    const headers = [
      "Name", "State", "County", "Site Type", "DC Score",
      ...SCORE_FACTORS.map(f => f.label),
      "Nearest Substation", "Substation Distance (mi)", "Voltage (kV)", "Available Capacity (MW)",
      "Nearest IXP", "IXP Distance (mi)", "Nearest DC", "DC Distance (mi)",
      "ISO Region", "Queue Depth", "Acreage",
      "NRI Score", "NRI Rating", "Water Stress", "Land Value ($/acre)", "DC Tax Incentive",
    ];
    const rows = siteRecs.map((s, i) => {
      const c = countyRecs[i];
      return [
        s.name, s.state, s.county, s.site_type, s.dc_score,
        ...SCORE_FACTORS.map(f => s[f.key] ?? ""),
        s.nearest_substation_name, s.nearest_substation_distance_km ? (Number(s.nearest_substation_distance_km) * 0.621371).toFixed(1) : "",
        s.substation_voltage_kv, s.available_capacity_mw,
        s.nearest_ixp_name, s.nearest_ixp_distance_km ? (Number(s.nearest_ixp_distance_km) * 0.621371).toFixed(1) : "",
        s.nearest_dc_name, s.nearest_dc_distance_km ? (Number(s.nearest_dc_distance_km) * 0.621371).toFixed(1) : "",
        s.iso_region, s.queue_depth, s.acreage,
        c?.nri_score, c?.nri_rating, c?.water_stress_label,
        c?.avg_land_value_per_acre_usd, c?.has_dc_tax_incentive ? "Yes" : "No",
      ].map(v => {
        const str = String(v ?? "");
        return str.includes(",") ? `"${str}"` : str;
      });
    });
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gridscout-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Site Comparison</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (ids.length === 0 || sites.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Site Comparison</h1>
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-600 mb-4">No sites selected for comparison.</p>
          <p className="text-sm text-gray-500 mb-6">
            Go to <a href="/grid/sites/" className="text-purple-600 hover:underline">Greenfield Sites</a> and
            click the checkbox next to sites you want to compare, then click &ldquo;Compare&rdquo;.
          </p>
          <a href="/grid/sites/" className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700">
            Browse Sites
          </a>
        </div>
      </div>
    );
  }

  const siteRecords = sites.map((d) => d.site as Record<string, number | string | null>);
  const countyRecords = sites.map((d) => d.county as Record<string, number | string | null> | null);

  // Find best score for each factor to highlight
  const bestForFactor = (key: string) => {
    let best = -1;
    let bestIdx = -1;
    siteRecords.forEach((s, i) => {
      const v = Number(s[key]) || 0;
      if (v > best) { best = v; bestIdx = i; }
    });
    return bestIdx;
  };

  return (
    <div className="print:p-0">
      {/* Print-only branded header */}
      <div className="hidden print:flex print:items-center print:justify-between print:mb-6 print:pb-4 print:border-b print:border-gray-300">
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-lg font-bold text-purple-600">GridScout</span>
          <span className="text-sm text-gray-500 ml-2">Greenfield Site Comparison Report</span>
        </div>
        <div className="text-xs text-gray-400">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 print:mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Site Comparison</h1>
          <p className="text-gray-600 text-sm mt-1">{sites.length} sites compared side-by-side</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            onClick={handleShareLink}
            className="px-4 py-2 text-sm text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50"
          >
            {shareCopied ? "Link Copied!" : "Share Link"}
          </button>
          {!isDemoMode() && (
            <>
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
              >
                Export PDF
              </button>
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 text-sm text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50"
              >
                Export CSV
              </button>
            </>
          )}
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Overview cards */}
      <div className={`grid gap-4 mb-6 ${sites.length <= 2 ? "grid-cols-2" : sites.length === 3 ? "grid-cols-3" : sites.length === 4 ? "grid-cols-4" : "grid-cols-5"}`}>
        {siteRecords.map((s, i) => (
          <div key={ids[i]} className="bg-white rounded-lg border border-gray-200 p-4 relative">
            <button
              onClick={() => handleRemove(i)}
              className="absolute top-2 right-2 text-gray-400 hover:text-red-500 text-xs print:hidden"
              title="Remove from comparison"
            >
              &#10005;
            </button>
            <div className={`text-3xl font-bold mb-1 ${scoreColor(Number(s.dc_score) || 0)}`}>
              {Number(s.dc_score) || 0}
            </div>
            <a href={`/grid/site/?id=${ids[i]}`} className="text-sm font-semibold text-purple-600 hover:underline print:text-gray-900 print:no-underline">
              {String(s.name)}
            </a>
            <div className="text-xs text-gray-500 mt-0.5">
              {s.county && `${s.county}, `}{s.state}
            </div>
            <div className="mt-2">{typeBadge(String(s.site_type))}</div>
          </div>
        ))}
      </div>

      {/* Score Breakdown — horizontal bars */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Breakdown</h2>
        <div className="space-y-4">
          {SCORE_FACTORS.map((factor) => {
            const bestIdx = bestForFactor(factor.key);
            return (
              <div key={factor.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">{factor.label}</span>
                  <span className="text-xs text-gray-400">{factor.weight}</span>
                </div>
                <div className="space-y-1">
                  {siteRecords.map((s, i) => {
                    const val = Number(s[factor.key]) || 0;
                    const isBest = i === bestIdx && sites.length > 1;
                    return (
                      <div key={ids[i]} className="flex items-center gap-2">
                        <span className={`text-xs w-20 truncate ${isBest ? "font-bold text-gray-900" : "text-gray-500"}`}>
                          {String(s.name).slice(0, 12)}
                        </span>
                        <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${barColor(val)} ${isBest ? "opacity-100" : "opacity-70"}`}
                            style={{ width: `${val}%` }}
                          />
                        </div>
                        <span className={`text-xs w-8 text-right font-mono ${isBest ? "font-bold" : ""} ${scoreColor(val)}`}>
                          {val}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Infrastructure Details Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Infrastructure Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Metric</th>
                {siteRecords.map((s, i) => (
                  <th key={ids[i]} className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                    {String(s.name).slice(0, 15)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Nearest Substation", fn: (s: Record<string, number | string | null>) => String(s.nearest_substation_name || "—") },
                { label: "Substation Distance", fn: (s: Record<string, number | string | null>) => kmToMi(s.nearest_substation_distance_km) },
                { label: "Voltage", fn: (s: Record<string, number | string | null>) => s.substation_voltage_kv ? `${s.substation_voltage_kv} kV` : "—" },
                { label: "Available Capacity", fn: (s: Record<string, number | string | null>) => s.available_capacity_mw ? `${s.available_capacity_mw} MW` : "—" },
                { label: "Nearest IXP", fn: (s: Record<string, number | string | null>) => String(s.nearest_ixp_name || "—") },
                { label: "IXP Distance", fn: (s: Record<string, number | string | null>) => kmToMi(s.nearest_ixp_distance_km) },
                { label: "Nearest Datacenter", fn: (s: Record<string, number | string | null>) => String(s.nearest_dc_name || "—") },
                { label: "DC Distance", fn: (s: Record<string, number | string | null>) => kmToMi(s.nearest_dc_distance_km) },
                { label: "ISO Region", fn: (s: Record<string, number | string | null>) => String(s.iso_region || "—") },
                { label: "Queue Depth", fn: (s: Record<string, number | string | null>) => s.queue_depth != null ? String(s.queue_depth) : "—" },
                { label: "Energy Price", fn: (s: Record<string, number | string | null>) => s.energy_price_mwh ? `$${Number(s.energy_price_mwh).toFixed(2)}/MWh` : "—" },
                { label: "Buildability", fn: (s: Record<string, number | string | null>) => s.buildability_score != null ? `${Number(s.buildability_score).toFixed(0)}/100` : "—" },
                { label: "Flood Zone", fn: (s: Record<string, number | string | null>) => s.flood_zone ? `${s.flood_zone}${s.flood_zone_sfha ? " (SFHA)" : ""}` : "—" },
                { label: "Gas Pipeline", fn: (s: Record<string, number | string | null>) => s.nearest_gas_pipeline_km != null ? `${(Number(s.nearest_gas_pipeline_km) * 0.621371).toFixed(1)} mi` : "> 50 mi" },
                { label: "Acreage", fn: (s: Record<string, number | string | null>) => s.acreage ? String(s.acreage) : "—" },
              ].map((row) => (
                <tr key={row.label} className="border-b border-gray-100">
                  <td className="py-2 px-3 text-gray-600">{row.label}</td>
                  {siteRecords.map((s, i) => (
                    <td key={ids[i]} className="py-2 px-3 text-right text-gray-900 font-medium">
                      {row.fn(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* County Risk Comparison */}
      {countyRecords.some(Boolean) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">County Risk Profile</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Metric</th>
                  {siteRecords.map((s, i) => (
                    <th key={ids[i]} className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                      {String(s.name).slice(0, 15)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "County", fn: (c: Record<string, number | string | null> | null) => c ? String(c.county_name || "—") : "—" },
                  { label: "NRI Score", fn: (c: Record<string, number | string | null> | null) => c?.nri_score != null ? String(c.nri_score) : "—" },
                  { label: "NRI Rating", fn: (c: Record<string, number | string | null> | null) => c ? String(c.nri_rating || "—") : "—" },
                  { label: "Water Stress", fn: (c: Record<string, number | string | null> | null) => c ? String(c.water_stress_label || "—") : "—" },
                  { label: "Cooling Degree Days", fn: (c: Record<string, number | string | null> | null) => c?.cooling_degree_days != null ? String(c.cooling_degree_days) : "—" },
                  { label: "Fiber Providers", fn: (c: Record<string, number | string | null> | null) => c?.fiber_provider_count != null ? String(c.fiber_provider_count) : "—" },
                  { label: "Land Value", fn: (c: Record<string, number | string | null> | null) => c?.avg_land_value_per_acre_usd != null ? `$${Number(c.avg_land_value_per_acre_usd).toLocaleString()}/acre` : "—" },
                  { label: "DC Tax Incentive", fn: (c: Record<string, number | string | null> | null) => c?.has_dc_tax_incentive ? "Yes" : "No" },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-gray-100">
                    <td className="py-2 px-3 text-gray-600">{row.label}</td>
                    {countyRecords.map((c, i) => (
                      <td key={ids[i]} className="py-2 px-3 text-right text-gray-900 font-medium">
                        {row.fn(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t border-gray-300">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span className="font-medium">GridScout</span> — Datacenter Site Selection Intelligence
          </div>
          <div>Confidential — {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
      </div>
    </div>
  );
}

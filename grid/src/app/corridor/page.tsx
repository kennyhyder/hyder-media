"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { withDemoToken } from "@/lib/demoAccess";

const TransmissionMap = dynamic(() => import("../../components/TransmissionMap"), { ssr: false });

interface CorridorDetail {
  corridor: Record<string, unknown>;
  lines: Record<string, unknown>[];
  nearbySites: Record<string, unknown>[];
}

function infoRow(label: string, value: unknown) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{String(value)}</span>
    </div>
  );
}

export default function CorridorDetailPage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-64 mb-4" /><div className="h-48 bg-gray-200 rounded" /></div>}>
      <CorridorDetailContent />
    </Suspense>
  );
}

function CorridorDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [data, setData] = useState<CorridorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const baseUrl = window.location.origin;
    fetch(withDemoToken(`${baseUrl}/api/grid/corridor?id=${id}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (!id) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Corridor Detail</h1>
        <p className="text-gray-600">No corridor ID provided. <a href="/grid/corridors/" className="text-purple-600 hover:underline">Browse corridors</a></p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Loading corridor...</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Corridor Not Found</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || "Corridor not found"}
        </div>
      </div>
    );
  }

  const c = data.corridor as Record<string, string | number | string[] | null>;

  const typeLabels: Record<string, string> = {
    section_368: "Section 368 Corridor",
    nietc: "NIETC Corridor",
    blm_solar_dla: "BLM Solar DLA",
  };

  const typeBadgeColors: Record<string, string> = {
    section_368: "bg-purple-100 text-purple-700",
    nietc: "bg-blue-100 text-blue-700",
    blm_solar_dla: "bg-amber-100 text-amber-700",
  };

  const typeContextTitle: Record<string, string> = {
    section_368: "What Section 368 Means for Developers",
    nietc: "What NIETC Designation Means",
    blm_solar_dla: "What BLM Solar DLA Means",
  };

  const typeContextBody: Record<string, string> = {
    section_368: "Section 368 corridors were designated by the Department of Energy under the Energy Policy Act of 2005. Environmental review has been completed at the programmatic level, meaning new transmission projects within these corridors face a streamlined NEPA process. Developers can leverage existing ROW grants and environmental documentation to accelerate permitting timelines by 2-4 years compared to greenfield routes.",
    nietc: "National Interest Electric Transmission Corridors are designated by DOE when transmission congestion constrains reliability or economic growth. FERC has backstop siting authority in NIETCs — if a state denies or delays a transmission permit for more than one year, FERC can issue a federal construction permit. This dramatically reduces regulatory risk for transmission developers and makes interconnection more predictable for datacenter loads.",
    blm_solar_dla: "BLM Designated Leasing Areas (DLAs) are pre-screened federal lands identified as suitable for solar energy development. Environmental review, cultural resource surveys, and wildlife assessments have already been completed at the landscape level. Projects on DLAs benefit from streamlined permitting, reduced bonding requirements, and priority processing. Co-locating datacenter power supply (solar + battery) on adjacent DLA land can reduce energy costs and accelerate grid connection.",
  };

  const states = Array.isArray(c.states) ? c.states : [];
  const corridorType = String(c.corridor_type || "");

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900">{String(c.name || c.corridor_id || "Unnamed Corridor")}</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
            typeBadgeColors[corridorType] || "bg-gray-100 text-gray-700"
          }`}>
            {typeLabels[corridorType] || corridorType}
          </span>
        </div>
        <p className="text-gray-600">
          {c.agency && `${c.agency} · `}
          {states.length > 0 ? states.join(", ") : ""}
        </p>
      </div>

      {/* Map */}
      {data.lines.length > 0 && data.lines.some((l) => l.geometry_wkt) && (
        <div className="mb-6 rounded-lg overflow-hidden border border-gray-200">
          <TransmissionMap
            lines={data.lines.filter((l) => l.geometry_wkt) as Array<{ id: string; hifld_id: number; geometry_wkt: string | null; voltage_kv: number | null; capacity_mw: number | null; upgrade_candidate: boolean; owner: string | null; state: string | null; sub_1: string | null; sub_2: string | null; naession: string | null }>}
            height="350px"
            onLineClick={(id) => { window.location.href = `/grid/line/?id=${id}`; }}
          />
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Width</div>
          <div className="text-2xl font-bold text-gray-900">
            {c.width_miles ? `${c.width_miles} mi` : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Acreage</div>
          <div className="text-2xl font-bold text-gray-900">
            {c.acreage ? Number(c.acreage).toLocaleString() : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">States</div>
          <div className="text-2xl font-bold text-gray-900">
            {states.length > 0 ? states.length : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Lines in Corridor</div>
          <div className="text-2xl font-bold text-gray-900">
            {data.lines.length || "—"}
          </div>
        </div>
      </div>

      {/* What This Corridor Means */}
      {typeContextBody[corridorType] && (
        <div className={`rounded-lg border p-6 mb-6 ${
          corridorType === "section_368" ? "bg-purple-50 border-purple-200" :
          corridorType === "nietc" ? "bg-blue-50 border-blue-200" :
          "bg-amber-50 border-amber-200"
        }`}>
          <h2 className={`text-lg font-semibold mb-3 ${
            corridorType === "section_368" ? "text-purple-800" :
            corridorType === "nietc" ? "text-blue-800" :
            "text-amber-800"
          }`}>
            {typeContextTitle[corridorType]}
          </h2>
          <p className={`text-sm leading-relaxed ${
            corridorType === "section_368" ? "text-purple-900" :
            corridorType === "nietc" ? "text-blue-900" :
            "text-amber-900"
          }`}>
            {typeContextBody[corridorType]}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Corridor Details */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Corridor Details</h2>
          {infoRow("Corridor ID", c.corridor_id)}
          {infoRow("Type", typeLabels[corridorType] || corridorType)}
          {infoRow("Agency", c.agency)}
          {infoRow("States", states.join(", "))}
          {infoRow("Width", c.width_miles ? `${c.width_miles} miles` : null)}
          {infoRow("Acreage", c.acreage ? Number(c.acreage).toLocaleString() : null)}
          {infoRow("Environmental Status", c.environmental_status)}
        </div>

        {/* External Resources */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">External Resources</h2>
          <div className="space-y-2">
            {corridorType === "section_368" && (
              <a
                href="https://corridoreis.anl.gov/documents/fpeis/index.cfm"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline"
              >
                <span>&#8599;</span> DOE Section 368 Corridor Programmatic EIS
              </a>
            )}
            {corridorType === "nietc" && (
              <a
                href="https://www.energy.gov/gdo/national-interest-electric-transmission-corridors"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline"
              >
                <span>&#8599;</span> DOE NIETC Designation Page
              </a>
            )}
            {corridorType === "blm_solar_dla" && (
              <a
                href="https://www.blm.gov/programs/energy-and-minerals/renewable-energy/solar-energy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline"
              >
                <span>&#8599;</span> BLM Solar Energy Program
              </a>
            )}
            <a
              href="https://www.ferc.gov/industries-data/electric/electric-transmission/transmission-planning"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-purple-600 hover:underline"
            >
              <span>&#8599;</span> FERC Transmission Planning
            </a>
          </div>
        </div>
      </div>

      {/* Lines in Corridor */}
      {data.lines.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Transmission Lines in Corridor</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Line</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Owner</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Voltage</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Capacity</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Length</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">To</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={String(line.id)} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <a href={`/grid/line/?id=${line.id}`} className="text-purple-600 hover:underline text-xs">
                        {String(line.naession || line.hifld_id || line.id)}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.owner || "—")}</td>
                    <td className="py-2 px-3 text-right text-gray-600">
                      {line.voltage_kv ? `${line.voltage_kv} kV` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600">
                      {line.capacity_mw ? `${line.capacity_mw} MW` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600">
                      {line.length_miles ? `${Number(line.length_miles).toFixed(1)} mi` : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.sub_1 || "—")}</td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.sub_2 || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nearby DC Sites */}
      {data.nearbySites.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top DC Sites in Corridor States</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Site</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">State</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Score</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Voltage</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Capacity</th>
                </tr>
              </thead>
              <tbody>
                {data.nearbySites.map((site) => {
                  const score = Number(site.dc_score) || 0;
                  const scoreColor =
                    score >= 70 ? "text-green-600" :
                    score >= 50 ? "text-yellow-600" :
                    score >= 30 ? "text-orange-600" : "text-red-600";
                  return (
                    <tr key={String(site.id)} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3">
                        <a href={`/grid/site/?id=${site.id}`} className="text-purple-600 hover:underline text-xs font-medium">
                          {String(site.name || "—")}
                        </a>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{String(site.state || "—")}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          site.site_type === "brownfield" ? "bg-amber-100 text-amber-700" : site.site_type === "greenfield" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {String(site.site_type)}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right font-bold ${scoreColor}`}>{score}</td>
                      <td className="py-2 px-3 text-right text-gray-600">
                        {site.substation_voltage_kv ? `${site.substation_voltage_kv} kV` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-600">
                        {site.available_capacity_mw ? `${site.available_capacity_mw} MW` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

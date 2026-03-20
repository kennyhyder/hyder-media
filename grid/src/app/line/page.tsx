"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { withDemoToken } from "@/lib/demoAccess";

const TransmissionMap = dynamic(() => import("../../components/TransmissionMap"), { ssr: false });

interface LineDetail {
  id: string;
  hifld_id: number;
  source_record_id: string;
  voltage_kv: number | null;
  volt_class: string | null;
  owner: string | null;
  status: string | null;
  line_type: string | null;
  sub_1: string | null;
  sub_2: string | null;
  naession: string | null;
  static_rating_amps: number | null;
  capacity_mw: number | null;
  upgrade_candidate: boolean;
  ercot_shadow_price: number | null;
  ercot_binding_count: number | null;
  ercot_mw_limit: number | null;
  state: string | null;
  county: string | null;
  length_miles: number | null;
  geometry_wkt: string | null;
  data_source_id: string | null;
  created_at: string;
  updated_at: string;
}

function DetailRow({ label, value, highlight }: { label: string; value: string | number | null | undefined; highlight?: boolean }) {
  const displayValue = value != null && value !== "" ? String(value) : "--";
  return (
    <div className="flex items-start py-2.5 border-b border-gray-100 last:border-b-0">
      <dt className="w-48 flex-shrink-0 text-xs font-medium text-gray-500 uppercase tracking-wide pt-0.5">{label}</dt>
      <dd className={`text-sm ${highlight ? "font-semibold text-purple-700" : "text-gray-900"}`}>
        {displayValue}
      </dd>
    </div>
  );
}

export default function LineDetailPage() {
  const [line, setLine] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const hifld_id = params.get("hifld_id");

    if (!id && !hifld_id) {
      setError("No line ID provided. Use ?id=UUID or ?hifld_id=NUMBER in the URL.");
      setLoading(false);
      return;
    }

    const baseUrl = window.location.origin;
    const qp = new URLSearchParams();
    if (id) qp.set("id", id);
    else if (hifld_id) qp.set("hifld_id", hifld_id);

    fetch(withDemoToken(`${baseUrl}/api/grid/line?${qp.toString()}`))
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Transmission line not found" : `HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setLine(json.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Line Detail</h1>
        <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
          <div className="space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-4 bg-gray-200 rounded w-48" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <a href="/grid/search/" className="text-sm text-purple-600 hover:text-purple-800 hover:underline">
            &larr; Back to Lines
          </a>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Line Detail</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!line) return null;

  const hasErcotData = line.ercot_shadow_price != null || line.ercot_binding_count != null || line.ercot_mw_limit != null;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/grid/search/" className="text-sm text-purple-600 hover:text-purple-800 hover:underline">
          &larr; Back to Lines
        </a>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {line.naession || `${line.sub_1 || "?"} - ${line.sub_2 || "?"}`}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            HIFLD #{line.hifld_id} &middot; {line.state || "Unknown State"}
            {line.county ? `, ${line.county}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {line.upgrade_candidate && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Upgrade Candidate
            </span>
          )}
          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${
            line.status === "IN SERVICE"
              ? "bg-green-100 text-green-700"
              : line.status === "PROPOSED" || line.status === "UNDER CONSTRUCTION"
              ? "bg-yellow-100 text-yellow-700"
              : "bg-gray-100 text-gray-600"
          }`}>
            {line.status || "Unknown"}
          </span>
        </div>
      </div>

      {/* Key metrics cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Voltage</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {line.voltage_kv != null ? `${line.voltage_kv.toFixed(0)} kV` : "--"}
          </div>
          {line.volt_class && <div className="text-xs text-gray-400 mt-0.5">{line.volt_class}</div>}
        </div>
        <div className={`bg-white rounded-lg border p-4 ${line.upgrade_candidate ? "border-purple-200 bg-purple-50" : "border-gray-200"}`}>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Capacity</div>
          <div className={`text-xl font-bold mt-1 ${line.upgrade_candidate ? "text-purple-700" : "text-gray-900"}`}>
            {line.capacity_mw != null ? `${line.capacity_mw.toFixed(1)} MW` : "--"}
          </div>
          {line.upgrade_candidate && <div className="text-xs text-purple-500 mt-0.5">50-100 MW range</div>}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Static Rating</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {line.static_rating_amps != null ? `${line.static_rating_amps.toFixed(0)} A` : "--"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Length</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {line.length_miles != null ? `${line.length_miles.toFixed(1)} mi` : "--"}
          </div>
        </div>
      </div>

      {/* Line geometry map */}
      {line.geometry_wkt && (
        <div className="mb-8">
          <TransmissionMap
            lines={[{
              id: line.id,
              hifld_id: line.hifld_id,
              geometry_wkt: line.geometry_wkt,
              voltage_kv: line.voltage_kv,
              capacity_mw: line.capacity_mw,
              upgrade_candidate: line.upgrade_candidate,
              owner: line.owner,
              state: line.state,
              sub_1: line.sub_1,
              sub_2: line.sub_2,
              naession: line.naession,
            }]}
            height="400px"
            singleLine
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Line details */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Line Details</h2>
          <dl>
            <DetailRow label="Owner" value={line.owner} />
            <DetailRow label="From Substation" value={line.sub_1} />
            <DetailRow label="To Substation" value={line.sub_2} />
            <DetailRow label="Line Name" value={line.naession} />
            <DetailRow label="Line Type" value={line.line_type} />
            <DetailRow label="Status" value={line.status} />
            <DetailRow label="State" value={line.state} />
            <DetailRow label="County" value={line.county} />
          </dl>
        </div>

        {/* Capacity and upgrade info */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Capacity Analysis</h2>
            <dl>
              <DetailRow label="Voltage (kV)" value={line.voltage_kv != null ? line.voltage_kv.toFixed(1) : null} />
              <DetailRow label="Static Rating (A)" value={line.static_rating_amps != null ? line.static_rating_amps.toFixed(0) : null} />
              <DetailRow label="Capacity (MW)" value={line.capacity_mw != null ? line.capacity_mw.toFixed(1) : null} highlight={line.upgrade_candidate} />
              <DetailRow label="Upgrade Candidate" value={line.upgrade_candidate ? "Yes (50-100 MW)" : "No"} highlight={line.upgrade_candidate} />
              <DetailRow label="Length (miles)" value={line.length_miles != null ? line.length_miles.toFixed(2) : null} />
            </dl>
          </div>

          {/* ERCOT data (Texas only) */}
          {hasErcotData && (
            <div className="bg-white rounded-lg border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                ERCOT Congestion Data
                <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-100 px-2 py-0.5 rounded">Texas</span>
              </h2>
              <dl>
                <DetailRow label="Shadow Price" value={line.ercot_shadow_price != null ? `$${line.ercot_shadow_price.toFixed(2)}/MW` : null} />
                <DetailRow label="Binding Count" value={line.ercot_binding_count != null ? line.ercot_binding_count.toLocaleString() : null} />
                <DetailRow label="MW Limit" value={line.ercot_mw_limit != null ? `${line.ercot_mw_limit.toFixed(1)} MW` : null} />
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Metadata</h2>
        <dl>
          <DetailRow label="Database ID" value={line.id} />
          <DetailRow label="HIFLD ID" value={line.hifld_id} />
          <DetailRow label="Source Record ID" value={line.source_record_id} />
          <DetailRow label="Created" value={line.created_at ? new Date(line.created_at).toLocaleDateString() : null} />
          <DetailRow label="Updated" value={line.updated_at ? new Date(line.updated_at).toLocaleDateString() : null} />
        </dl>
      </div>
    </div>
  );
}

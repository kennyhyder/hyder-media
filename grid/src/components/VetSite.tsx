"use client";

// Vet-a-site UI — enter an address / town / lat,lng + a target build size and
// get a first-pass read: satellite view, jurisdiction, MW-gated regulatory
// climate, county power/water/hazard context, nearby scored sites, and latest
// local news. Calls the same-origin /api/grid/vet (all external calls are
// server-side). Satellite is an Esri World Imagery <img> (allowed by CSP).

import { useState } from "react";
import { fmtInt, fmtScore, fmtCents, scoreColor } from "@/lib/format";
import { siteTypeLabel } from "@/lib/geo";
import type { Posture } from "@/lib/dc-policy";

const POSTURE_CLS: Record<Posture, string> = {
  favorable: "bg-green-100 text-green-800",
  moderate: "bg-amber-100 text-amber-800",
  restrictive: "bg-red-100 text-red-800",
};

const MW_TIERS = [
  { label: "Not sure / any", value: "" },
  { label: "50 MW", value: "50" },
  { label: "150 MW", value: "150" },
  { label: "350 MW", value: "350" },
  { label: "500 MW", value: "500" },
  { label: "1 GW", value: "1000" },
  { label: "2 GW", value: "2000" },
];

interface VetResult {
  location: {
    lat: number; lng: number; label: string;
    state: string | null; stateName: string | null; county: string | null; fips: string | null;
  };
  targetMw: number | null;
  regulatory: { effective: Posture; label: string; summary: string; incentive: boolean; gated?: string };
  county: Record<string, number | string | boolean | null> | null;
  nearby: Array<{
    id: string; path: string | null; name: string | null; state: string | null; county: string | null;
    site_type: string | null; dc_score: number | null; available_capacity_mw: number | null; iso_region: string | null;
  }>;
  datacenters: Array<{
    id: string; name: string | null; operator: string | null; city: string | null; state: string | null;
    capacity_mw: number | null; hyperscaler: string | null; colo: string | null; distance_mi: number | null;
  }>;
  hyperscalerFootprint: string[];
  pipeline: Array<{ name: string; owner: string; off_takers: string[]; power_mw: number | null; distance_mi: number }>;
  news: Array<{ title: string; url: string; domain: string; date: string }>;
}

function satelliteUrl(lat: number, lng: number): string {
  const d = 0.008; // ~800 m half-box
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return (
    `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export` +
    `?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=680,420&format=jpg&f=image`
  );
}

function fmtMw(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)} GW` : `${fmtInt(n)} MW`;
}

function fmtDate(d: string): string {
  // API normalizes to YYYY-MM-DD; pass through, else blank.
  return /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "";
}

export default function VetSite() {
  const [q, setQ] = useState("");
  const [mw, setMw] = useState("350");
  const [result, setResult] = useState<VetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ q: query });
    if (mw) p.set("mw", mw);
    fetch(`${window.location.origin}/api/grid/vet?${p.toString()}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not vet that location.");
        return j as VetResult;
      })
      .then((j) => setResult(j))
      .catch((e) => { setError(e.message); setResult(null); })
      .finally(() => setLoading(false));
  };

  const c = result?.county;
  const selCls =
    "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500";

  return (
    <div>
      {/* Input */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Address, town, or coordinates
            </span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="e.g. Abilene, TX  ·  1000 Evans Ave, San Francisco  ·  32.45, -99.73"
              className={selCls + " w-full"}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Target size</span>
            <select className={selCls} value={mw} onChange={(e) => setMw(e.target.value)}>
              {MW_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button
            onClick={run}
            disabled={loading || !q.trim()}
            className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Vetting…" : "Vet site"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Results */}
      {result && (
        <div className="mt-6 space-y-6">
          {/* Location + satellite */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {result.location.county && result.location.state
                  ? `${result.location.county}, ${result.location.state}`
                  : result.location.label}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {result.location.label} · {result.location.lat.toFixed(4)}, {result.location.lng.toFixed(4)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`inline-block rounded px-2.5 py-1 text-sm font-semibold ${POSTURE_CLS[result.regulatory.effective]}`}>
                  {result.regulatory.label} regulatory climate
                </span>
                {result.regulatory.incentive && (
                  <span className="inline-block rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
                    DC tax incentive
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-gray-700">{result.regulatory.summary}</p>
              {result.regulatory.gated && (
                <p className="mt-1 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs text-amber-800">
                  {result.regulatory.gated}
                </p>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={satelliteUrl(result.location.lat, result.location.lng)}
              alt={`Satellite view of ${result.location.label}`}
              className="h-[220px] w-full rounded-xl border border-gray-200 object-cover"
              loading="lazy"
            />
          </div>

          {/* County context */}
          {c && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-bold text-gray-900">County power, water &amp; hazard</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <Ctx label="Commercial power" value={c.avg_commercial_rate_cents_kwh != null ? fmtCents(Number(c.avg_commercial_rate_cents_kwh)) : null} />
                <Ctx label="Industrial power" value={c.avg_industrial_rate_cents_kwh != null ? fmtCents(Number(c.avg_industrial_rate_cents_kwh)) : null} />
                <Ctx label="Load growth" value={c.ferc714_load_growth_pct != null ? `${Number(c.ferc714_load_growth_pct).toFixed(1)}%` : null} />
                <Ctx label="Water stress" value={c.water_stress_label != null ? String(c.water_stress_label) : null} />
                <Ctx label="FEMA risk" value={c.nri_rating != null ? String(c.nri_rating) : null} />
                <Ctx label="Fiber providers" value={c.fiber_provider_count != null ? fmtInt(Number(c.fiber_provider_count)) : null} />
              </div>
            </div>
          )}

          {/* Nearby sites */}
          {result.nearby.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-gray-900">Nearby scored candidate sites</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3 font-medium">Site</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium text-right">Est. capacity</th>
                      <th className="py-2 pr-3 font-medium">Grid</th>
                      <th className="py-2 font-medium text-right">Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.nearby.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3">
                          {s.path ? (
                            <a href={s.path} className="font-medium text-purple-700 hover:underline">{s.name}</a>
                          ) : (
                            <span className="font-medium text-gray-900">{s.name}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-gray-600">{s.site_type ? siteTypeLabel(s.site_type) : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-800">{fmtMw(s.available_capacity_mw)}</td>
                        <td className="py-2 pr-3 text-gray-500">{s.iso_region ?? "—"}</td>
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
            </div>
          )}

          {/* Datacenter / hyperscaler footprint */}
          {result.datacenters.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-bold text-gray-900">Datacenter footprint nearby</h3>
                {result.hyperscalerFootprint.length > 0 && (
                  <span className="text-xs text-gray-500">
                    Hyperscalers present:{" "}
                    {result.hyperscalerFootprint.map((h) => (
                      <span key={h} className="mr-1 inline-block rounded bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700 ring-1 ring-purple-200">
                        {h}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3 font-medium">Datacenter</th>
                      <th className="py-2 pr-3 font-medium">Operator</th>
                      <th className="py-2 pr-3 font-medium text-right">Capacity</th>
                      <th className="py-2 font-medium text-right">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.datacenters.slice(0, 8).map((dc) => (
                      <tr key={dc.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-900">{dc.name || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">
                          {dc.operator || "—"}
                          {dc.hyperscaler && (
                            <span className="ml-1 inline-block rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                              {dc.hyperscaler}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{fmtMw(dc.capacity_mw)}</td>
                        <td className="py-2 text-right tabular-nums text-gray-500">{dc.distance_mi != null ? `${dc.distance_mi} mi` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Who already operates near here — a proxy for likely off-takers and grid/ecosystem
                maturity when the specific tenant isn&apos;t public.
              </p>
            </div>
          )}

          {/* AI datacenter pipeline nearby */}
          {result.pipeline && result.pipeline.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-gray-900">AI datacenter projects nearby</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3 font-medium">Campus</th>
                      <th className="py-2 pr-3 font-medium">Owner</th>
                      <th className="py-2 pr-3 font-medium">Off-taker</th>
                      <th className="py-2 pr-3 font-medium text-right">Power</th>
                      <th className="py-2 font-medium text-right">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.pipeline.map((p, i) => (
                      <tr key={p.name + i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-900">{p.name}</td>
                        <td className="py-2 pr-3 text-gray-700">{p.owner || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{p.off_takers.length ? p.off_takers.join(", ") : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-800">{p.power_mw != null ? `${fmtInt(p.power_mw)} MW` : "—"}</td>
                        <td className="py-2 text-right tabular-nums text-gray-500">{p.distance_mi} mi</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-400">Frontier AI campuses within 75 mi — who&apos;s building here and for whom (Epoch AI, CC-BY).</p>
            </div>
          )}

          {/* News */}
          {result.news.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-gray-900">Latest local developments</h3>
              <ul className="space-y-1.5 text-sm">
                {result.news.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-gray-100 py-1.5 last:border-0">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-purple-700 hover:underline">{a.title}</a>
                    <span className="text-xs text-gray-400">{a.domain}{a.date ? ` · ${fmtDate(a.date)}` : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">Latest local news (Google News) — a recency signal, not a curated feed.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Ctx({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-2 border-b border-gray-50 py-1">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value ?? "—"}</span>
    </div>
  );
}

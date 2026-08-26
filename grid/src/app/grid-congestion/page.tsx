import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { fmtInt } from "@/lib/format";
import JsonLd from "@/components/JsonLd";
import Freshness from "@/components/Freshness";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import congestion from "@/data/ercot-congestion.json";

export const revalidate = 604800; // precomputed data; deploys refresh

export const metadata: Metadata = {
  title: "ERCOT Grid Congestion & Captive Power — Where Power Is Trapped",
  description:
    "The most-constrained transmission bottlenecks in ERCOT, ranked by how often they bind and how expensive relief is — a map of where generation is curtailed and underutilized 'captive' power sits, which a co-located datacenter could absorb with a faster interconnection.",
  alternates: { canonical: `${SITE_URL}/grid-congestion` },
};

function fmtUsd(n: number): string {
  return `$${fmtInt(n)}`;
}

export default function GridCongestionPage() {
  const rows = congestion.constraints;

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "ERCOT Grid Congestion", url: "/grid-congestion" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — ERCOT grid congestion & captive power`,
            description:
              "Distinct ERCOT SCED binding transmission constraints ranked by severity (binding frequency x shadow price).",
            url: `${SITE_URL}/grid-congestion`,
            spatialCoverage: "Texas (ERCOT)",
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <span className="text-gray-500">ERCOT grid congestion</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">ERCOT grid congestion &amp; captive power</h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          When a transmission line binds, generation on the trapped side gets curtailed — that
          underutilized <strong>&ldquo;captive&rdquo; power</strong> is exactly what a co-located
          datacenter can absorb, often with a faster interconnection than a greenfield build (the
          constraint relief a new load provides is already valued). These are the{" "}
          {congestion.distinct_constraints} most-constrained points in the ERCOT grid, ranked by how
          often they bind and how expensive relief gets, from{" "}
          {fmtInt(congestion.intervals)} priced SCED intervals.
        </p>
      </header>

      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50 p-4 text-sm text-gray-700">
        <strong>How to read this:</strong> a high <em>binding count</em> means the pinch point recurs;
        a high <em>shadow price</em> ($/MW to relieve) means it&apos;s expensive, i.e. severely
        constrained. Most sit on <strong>138&nbsp;kV lines in South &amp; West Texas</strong> (the
        Rio Grande / Laredo corridor) — the parts of ERCOT where trapped generation is most
        concentrated today.
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="w-8 py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Constraint</th>
              <th className="py-2 pr-3 font-medium">Corridor</th>
              <th className="py-2 pr-3 font-medium text-right">Binds</th>
              <th className="py-2 pr-3 font-medium text-right">Max $/MW</th>
              <th className="py-2 font-medium text-right">Avg $/MW</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.constraint + i} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-2 tabular-nums text-gray-400">{i + 1}</td>
                <td className="py-2 pr-3 font-mono text-xs font-medium text-gray-900">{c.constraint}</td>
                <td className="py-2 pr-3 text-gray-600">
                  {c.from_station ? (
                    <>
                      {c.from_station} → {c.to_station}
                      {c.kv ? <span className="ml-1 text-xs text-gray-400">{c.kv} kV</span> : null}
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{fmtInt(c.binding_intervals)}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold text-gray-900">{fmtUsd(c.max_shadow_price)}</td>
                <td className="py-2 text-right tabular-nums text-gray-600">{fmtUsd(c.avg_shadow_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Derived from ERCOT SCED binding-constraint disclosures (shadow prices &amp; overloaded
        elements). Station codes are ERCOT electrical buses; precise site-level mapping and non-ERCOT
        ISOs (CAISO, SPP) are on the roadmap. A screening signal of where captive power sits — confirm
        deliverable capacity with an interconnection study. Statewide ERCOT.
      </p>
    </div>
  );
}

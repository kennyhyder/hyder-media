import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { stateBySlug } from "@/lib/geo";
import { topSubstationsByState, getCount, type Substation } from "@/lib/db";
import { substationSlug } from "@/lib/entity-slug";
import { fmtInt, fmtKv } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [] as Array<{ state: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) return { title: "State not found", robots: { index: false, follow: false } };
  return {
    title: `Electric Substations in ${st.name} — Voltage, Operators & Lines | GridCensus`,
    description: `Electric transmission substations in ${st.name}, ranked by voltage. Operator, connected transmission lines, and nearby datacenter candidate sites for each substation.`,
    alternates: { canonical: `${SITE_URL}/substations/${st.slug}` },
  };
}

export default async function StateSubstationsIndex({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) notFound();

  const [subs, total] = await Promise.all([
    topSubstationsByState(st.code, 60),
    getCount("grid_substations", { state: st.code }),
  ]);

  if (!subs.length) notFound();

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Substations", url: "/substations" },
            { name: st.name, url: `/substations/${st.slug}` },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Electric substations in ${st.name}`,
            description: `Transmission substations in ${st.name} by voltage class, operator, and connected lines.`,
            url: `${SITE_URL}/substations/${st.slug}`,
            spatialCoverage: st.name,
          }),
          itemListSchema(
            subs.slice(0, 25).map((s) => ({
              name: s.name || "Substation",
              url: `${SITE_URL}/substations/${st.slug}/${substationSlug(s)}`,
            }))
          ),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/substations" className="hover:text-purple-600">Substations</a> /{" "}
        <span className="text-gray-500">{st.name}</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">Electric Substations in {st.name}</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          {total != null ? `${fmtInt(total)} catalogued substations` : "Catalogued substations"} in{" "}
          {st.name}, with the highest-voltage facilities listed first. Each substation profile shows
          voltage class, operator, connected transmission lines, and the datacenter candidate sites
          closest to it.
        </p>
      </header>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Substation</th>
              <th className="px-3 py-2">Max voltage</th>
              <th className="px-3 py-2">Connected lines</th>
              <th className="px-3 py-2">Operator</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subs.map((s: Substation) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">
                  <a
                    href={`/substations/${st.slug}/${substationSlug(s)}`}
                    className="text-purple-700 hover:underline"
                  >
                    {s.name || "Substation"}
                  </a>
                </td>
                <td className="px-3 py-2 text-gray-600">{fmtKv(s.max_voltage_kv)}</td>
                <td className="px-3 py-2 text-gray-600">
                  {s.connected_line_count != null ? fmtInt(s.connected_line_count) : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600">{s.owners?.[0] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm">
        <a href={`/datacenter-sites/${st.slug}`} className="font-medium text-purple-700 hover:underline">
          See datacenter candidate sites in {st.name} →
        </a>
      </p>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA context={`substations in ${st.name}`} />
    </div>
  );
}

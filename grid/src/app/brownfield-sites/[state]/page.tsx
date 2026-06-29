import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { stateBySlug } from "@/lib/geo";
import { brownfieldsByState, type BrownfieldSite } from "@/lib/db";
import { brownfieldSlug } from "@/lib/entity-slug";
import { fmtInt, fmtMwExact } from "@/lib/format";
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
    title: `Brownfield & Retired Power Plant Sites in ${st.name}`,
    description: `Brownfield and retired generation sites in ${st.name} evaluated for datacenter redevelopment — former capacity, retirement status, and existing grid hookup.`,
    alternates: { canonical: `${SITE_URL}/brownfield-sites/${st.slug}` },
  };
}

export default async function StateBrownfieldsIndex({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) notFound();

  const sites = await brownfieldsByState(st.code, 200);
  if (!sites.length) notFound();

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Brownfield Sites", url: "/brownfield-sites" },
            { name: st.name, url: `/brownfield-sites/${st.slug}` },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Brownfield sites in ${st.name}`,
            description: `Retired generation and brownfield redevelopment sites in ${st.name}.`,
            url: `${SITE_URL}/brownfield-sites/${st.slug}`,
            spatialCoverage: st.name,
          }),
          itemListSchema(
            sites.slice(0, 25).map((s) => ({
              name: s.name || "Brownfield site",
              url: `${SITE_URL}/brownfield-sites/${st.slug}/${brownfieldSlug(s)}`,
            }))
          ),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/brownfield-sites" className="hover:text-purple-600">Brownfield Sites</a> /{" "}
        <span className="text-gray-500">{st.name}</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">
          Brownfield & Retired Power Plant Sites in {st.name}
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          {fmtInt(sites.length)} catalogued brownfield and retired-generation sites in {st.name},
          listed by former capacity. Each carries an existing utility-scale grid interconnection that
          a new datacenter load may be able to re-use.
        </p>
      </header>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Former use</th>
              <th className="px-3 py-2">Capacity</th>
              <th className="px-3 py-2">Retired</th>
              <th className="px-3 py-2">County</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sites.map((s: BrownfieldSite) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">
                  <a
                    href={`/brownfield-sites/${st.slug}/${brownfieldSlug(s)}`}
                    className="text-purple-700 hover:underline"
                  >
                    {s.name || "Brownfield site"}
                  </a>
                </td>
                <td className="px-3 py-2 text-gray-600 capitalize">{s.former_use || "—"}</td>
                <td className="px-3 py-2 text-gray-600">
                  {s.existing_capacity_mw != null ? fmtMwExact(s.existing_capacity_mw) : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600">{s.retirement_date || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{s.county || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm">
        <a href={`/datacenter-sites/${st.slug}`} className="font-medium text-purple-700 hover:underline">
          See all datacenter candidate sites in {st.name} →
        </a>
      </p>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA context={`brownfield sites in ${st.name}`} />
    </div>
  );
}

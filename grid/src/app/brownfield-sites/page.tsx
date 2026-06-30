import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { stateByCode } from "@/lib/geo";
import { allBrownfieldsForSitemap } from "@/lib/db";
import { fmtInt } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Brownfield & Retired Power Plant Sites for Datacenters",
  description:
    "Browse 2,000+ brownfield and retired power plant sites across the United States, evaluated for datacenter redevelopment. Existing grid hookup, former capacity, retirement status, and nearby candidate sites by state.",
  alternates: { canonical: `${SITE_URL}/brownfield-sites` },
};

export default async function BrownfieldHub() {
  // Brownfields are ~2k rows — enumerate once and bucket by state client-side
  // (aggregates are disabled, so we count in memory rather than via SQL).
  const rows = await allBrownfieldsForSitemap();
  const byState = new Map<string, number>();
  for (const r of rows) {
    if (!r.state) continue;
    byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  }
  const states = Array.from(byState.entries())
    .map(([code, n]) => ({ st: stateByCode(code), n, code }))
    .filter((x): x is { st: NonNullable<ReturnType<typeof stateByCode>>; n: number; code: string } => !!x.st)
    .sort((a, b) => b.n - a.n);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Brownfield Sites", url: "/brownfield-sites" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Brownfield & retired power plant sites`,
            description:
              "Brownfield and retired generation sites across the US evaluated for datacenter redevelopment.",
            url: `${SITE_URL}/brownfield-sites`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            states.map((x) => ({ name: x.st.name, url: `${SITE_URL}/brownfield-sites/${x.st.slug}` }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Brownfield & Retired Power Plant Sites</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Retired generation sites are among the most attractive datacenter redevelopment targets:
          the existing interconnection was sized for utility-scale generation, so the grid hookup,
          transmission rights, and often cooling-water access are already in place — collapsing the
          speed-to-power timeline versus a greenfield build. Browse {SITE_NAME}&apos;s brownfield and
          retired-plant catalog by state.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {states.map(({ st, n }) => (
          <a
            key={st.code}
            href={`/brownfield-sites/${st.slug}`}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <span className="font-semibold text-gray-900">{st.name}</span>
            <span className="text-sm text-gray-500">{fmtInt(n)} sites</span>
          </a>
        ))}
      </div>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA />
    </div>
  );
}

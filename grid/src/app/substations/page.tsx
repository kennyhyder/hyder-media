import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { STATES } from "@/lib/geo";
import { getCount } from "@/lib/db";
import { fmtInt } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Electric Substations by State — Grid Infrastructure",
  description:
    "Browse 38,000+ electric transmission substations across the United States by state. Voltage class, operator, connected transmission lines, and nearby datacenter candidate sites for each substation.",
  alternates: { canonical: `${SITE_URL}/substations` },
};

export default async function SubstationsHub() {
  // Per-state substation counts (real-named only — mirrors the index gate).
  const counts = await Promise.all(
    STATES.map(async (s) => ({
      s,
      n: (await getCount("grid_substations", { state: s.code })) ?? 0,
    }))
  );
  const withData = counts.filter((c) => c.n > 0).sort((a, b) => b.n - a.n);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Substations", url: "/substations" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Electric substations by state`,
            description:
              "Electric transmission substation counts and voltage-class profiles across all 50 US states.",
            url: `${SITE_URL}/substations`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            withData.map((c) => ({ name: c.s.name, url: `${SITE_URL}/substations/${c.s.slug}` }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Electric Substations by State</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Substations are where high-voltage transmission steps down to usable power — and proximity
          to an energized, high-voltage substation is the single strongest speed-to-power signal for
          siting a datacenter. Browse the {SITE_NAME} catalog of electric transmission substations by
          state to see voltage class, operator, connected lines, and the candidate sites closest to
          each.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {withData.map(({ s, n }) => (
          <a
            key={s.code}
            href={`/substations/${s.slug}`}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <span className="font-semibold text-gray-900">{s.name}</span>
            <span className="text-sm text-gray-500">{fmtInt(n)} substations</span>
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

import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { STATES } from "@/lib/geo";
import { stateAgg, national } from "@/lib/rollups";
import { fmtInt, fmtScore, scoreColor } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Datacenter Sites by State",
  description: `Browse ${fmtInt(
    national.count
  )} scored datacenter candidate sites across all 50 US states and DC. Compare site counts and average DC Readiness scores by state.`,
  alternates: { canonical: `${SITE_URL}/datacenter-sites` },
};

export default function LocationsHub() {
  const cards = STATES.map((s) => ({ s, agg: stateAgg(s.code) })).filter(
    (c) => c.agg
  );
  const sorted = [...cards].sort((a, b) => (b.agg!.count) - (a.agg!.count));

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Locations", url: "/datacenter-sites" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Datacenter sites by US state`,
            description: `Datacenter candidate-site counts and average DC Readiness scores for all 51 US states.`,
            url: `${SITE_URL}/datacenter-sites`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            sorted.map((c) => ({
              name: c.s.name,
              url: `${SITE_URL}/datacenter-sites/${c.s.slug}`,
            }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Sites by State
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          {fmtInt(national.count)} scored candidate sites across all 50 states
          and the District of Columbia. Pick a state for its breakdown by site
          type, grid region, sub-score profile, top sites, and per-county
          detail.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map(({ s, agg }) => (
          <a
            key={s.code}
            href={`/datacenter-sites/${s.slug}`}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">{s.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${scoreColor(
                  agg!.avgScore
                )}`}
              >
                {fmtScore(agg!.avgScore)}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500">
              {fmtInt(agg!.count)} sites
            </div>
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

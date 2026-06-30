import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { METRICS } from "@/lib/rankings";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, itemListSchema, datasetSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Datacenter Rankings",
  description:
    "Datacenter site rankings: top US states by readiness, site count, candidate capacity, shortest interconnection queue, fastest speed-to-power, lowest water stress, and more — computed from public infrastructure data.",
  alternates: { canonical: `${SITE_URL}/rankings` },
};

export default function RankingsIndex() {
  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Rankings", url: "/rankings" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Datacenter rankings`,
            description: "Curated rankings of US states, ISO regions, and site types for datacenter development.",
            url: `${SITE_URL}/rankings`,
            spatialCoverage: "United States",
          }),
          itemListSchema(METRICS.map((m) => ({ name: m.title, url: `${SITE_URL}/rankings/${m.key}` }))),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Datacenter Rankings</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Where does the country stand for datacenter development? These
          rankings are computed directly from the {SITE_NAME} dataset and
          refresh monthly.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {METRICS.map((m) => (
          <a
            key={m.key}
            href={`/rankings/${m.key}`}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">{m.title}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600">{m.description}</p>
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

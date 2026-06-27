import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SITE_TYPES } from "@/lib/geo";
import { siteTypeAgg } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Datacenter Sites by Type",
  description:
    "Datacenter candidate sites by land type — greenfield, industrial, substation-adjacent, former mine, federal excess, manufacturing, shovel-ready, brownfield, and military BRAC — with what each means for siting.",
  alternates: { canonical: `${SITE_URL}/site-types` },
};

export default function SiteTypesHub() {
  const types = Object.values(SITE_TYPES)
    .map((t) => ({ t, agg: siteTypeAgg(t.key) }))
    .filter((x) => x.agg)
    .sort((a, b) => b.agg!.count - a.agg!.count);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Site Types", url: "/site-types" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Datacenter sites by type`,
            description: "Datacenter candidate-site counts and scores across nine land-use site types.",
            url: `${SITE_URL}/site-types`,
            spatialCoverage: "United States",
          }),
          itemListSchema(types.map((x) => ({ name: x.t.label, url: `${SITE_URL}/site-types/${x.t.slug}` }))),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Sites by Type
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          The kind of land a site sits on shapes its speed-to-power, existing
          infrastructure, and entitlement risk. Explore candidate sites across
          nine site types.
        </p>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {types.map(({ t, agg }) => (
          <a
            key={t.key}
            href={`/site-types/${t.slug}`}
            className="rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-gray-900">{t.label}</span>
              <span className="text-xs text-gray-500">{fmtScore(agg!.avgScore)} avg</span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-gray-600">{t.blurb}</p>
            <div className="mt-3 text-xs text-gray-500">{fmtInt(agg!.count)} sites</div>
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
